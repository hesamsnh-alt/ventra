// src/lib/serverRasterPreview.js
import { NextResponse as NextResponse2 } from "next/server.js";
import sharp7 from "sharp";
import { createHash as createHash2 } from "node:crypto";

// src/services/drawingJobRuntime.mjs
import { AsyncLocalStorage } from "node:async_hooks";
var scope = new AsyncLocalStorage();
var currentDrawingJob = () => scope.getStore();
function drawingOpenAIOptions() {
  const ctx = currentDrawingJob();
  if (!ctx?.deadline) return null;
  return { maxRetries: 0, timeout: 24e4, fetch: async (url, init = {}) => {
    const remaining = ctx.deadline - Date.now();
    if (remaining < 2e3) throw Object.assign(Error("Drawing worker time budget reached; saved evidence retained. No automatic restart."), { code: "DRAWING_WORKER_BUDGET", status: 503 });
    const limit = AbortSignal.timeout(Math.min(24e4, remaining));
    return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit });
  } };
}

// src/services/openaiClient.js
import OpenAI from "openai";
var openaiClient = null;
function getOpenAIClient() {
  if (openaiClient) {
    const options2 = drawingOpenAIOptions();
    return options2 ? openaiClient.withOptions(options2) : openaiClient;
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing from .env.local."
    );
  }
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  const options = drawingOpenAIOptions();
  return options ? openaiClient.withOptions(options) : openaiClient;
}
async function createResponse(payload) {
  const openai = getOpenAIClient();
  return openai.responses.create(payload);
}

// src/lib/rasterVisionRequest.mjs
var RASTER_RETRYABLE_GEOMETRY_CODES = Object.freeze([
  "INVALID_COORDINATE",
  "COORDINATE_FRAME_MISMATCH",
  "CONFLICTING_SCALE",
  "CONFLICTING_DIMENSIONS",
  "TRACE_IMAGE_MISMATCH",
  "UNSUPPORTED_ROOM_BOUNDARY",
  "WALL_CROSSES_ROOM",
  "ROOM_OVERLAP",
  "OVERLAPPING_ROOMS",
  "ROOM_NOT_CONTAINED",
  "SELF_INTERSECTING_POLYGON",
  "INVALID_POLYGON",
  "INVALID_WALL",
  "INCOMPLETE_TRACE",
  "DUPLICATE_OR_MISSING_ID",
  "INVALID_OPENING",
  "OPENING_OFF_WALL",
  "OPENING_OUTSIDE_WALL",
  "OPENING_WALL_MISSING",
  "OVERLAPPING_OPENINGS"
]);
function shouldRetryRasterGeometry(error2) {
  return RASTER_RETRYABLE_GEOMETRY_CODES.includes(String(error2?.code || ""));
}
async function requestRasterVision(create, payload, timeoutMs = 24e4) {
  const controller = new AbortController();
  let timer;
  const timeoutError = () => Object.assign(new Error("Image analysis exceeded its time limit. No new 3D scene was saved."), { code: "RASTER_VISION_TIMEOUT", status: 504 });
  try {
    return await Promise.race([
      Promise.resolve().then(() => create(payload, { signal: controller.signal, timeout: timeoutMs, maxRetries: 0 })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(timeoutError());
          controller.abort();
        }, timeoutMs);
      })
    ]);
  } catch (error2) {
    if (controller.signal.aborted || error2?.name === "APIConnectionTimeoutError") throw timeoutError();
    throw error2;
  } finally {
    clearTimeout(timer);
  }
}
async function consumeRasterVisionStream(create, payload, options, progress, notify = () => {
}) {
  const started = Date.now();
  const stage = (name2) => {
    progress.stage = name2;
    progress.elapsedMs = Date.now() - started;
    notify({ stage: name2, elapsedMs: progress.elapsedMs, responseId: progress.responseId || null });
  };
  progress.maxOutputTokens = payload.max_output_tokens ?? null;
  progress.reasoningEffort = payload.reasoning?.effort ?? null;
  progress.eventCount = 0;
  progress.outputCharacters = 0;
  stage("request_sent");
  try {
    const stream = await create({ ...payload, stream: true }, options);
    progress.headersMs = Date.now() - started;
    stage("stream_open");
    for await (const event of stream) {
      progress.eventCount++;
      progress.lastEventMs = Date.now() - started;
      if (progress.firstEventMs == null) progress.firstEventMs = progress.lastEventMs;
      if (event.type === "response.created") {
        progress.responseId = event.response?.id || null;
        stage("response_created");
      }
      if (event.type === "response.output_text.delta") {
        if (progress.firstTextMs == null) {
          progress.firstTextMs = Date.now() - started;
          stage("output_started");
        }
        progress.outputCharacters += typeof event.delta === "string" ? event.delta.length : 0;
      }
      if (event.type === "response.completed") {
        const response = event.response;
        if (response?.status !== "completed") throw Object.assign(new Error("Vision returned an invalid completion event."), { code: "RASTER_VISION_STREAM_ERROR", status: 502 });
        const outputText = (response.output || []).filter((item) => item.type === "message").flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text).join("");
        progress.usage = response.usage || null;
        stage("response_completed");
        return { ...response, output_text: outputText };
      }
      if (event.type === "response.incomplete" || event.type === "response.failed" || event.type === "error") {
        progress.providerStatus = event.response?.status || "error";
        progress.incompleteReason = event.response?.incomplete_details?.reason || null;
        progress.usage = event.response?.usage || null;
        progress.responseId = event.response?.id || progress.responseId || null;
        stage(event.type.replace(".", "_"));
        const outputLimit = progress.incompleteReason === "max_output_tokens";
        const failed = event.type !== "response.incomplete";
        const code = outputLimit ? "RASTER_VISION_OUTPUT_LIMIT" : failed ? "RASTER_VISION_PROVIDER_FAILED" : "RASTER_VISION_INCOMPLETE";
        const message = outputLimit ? "Vision reached its output token limit before completing the geometry. No new 3D scene was saved." : failed ? "The Vision provider failed before completing the geometry. No new 3D scene was saved." : "Vision did not complete its structured trace. No partial geometry was accepted.";
        throw Object.assign(new Error(message), { code, status: 502 });
      }
    }
    throw Object.assign(new Error("Vision stream ended before a completed response was received."), { code: "RASTER_VISION_STREAM_ENDED", status: 502 });
  } catch (error2) {
    progress.elapsedMs = Date.now() - started;
    progress.transportError = error2?.name || "Error";
    throw error2;
  }
}

// src/lib/rasterFloorplanGeometry.mjs
var RASTER_GEOMETRY_VERSION = "raster-metric-trace-v1";
var object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
var array = (items) => ({ type: "array", items });
var number = { type: "number" };
var text = { type: "string" };
var nullableNumber = { type: ["number", "null"] };
var choice = (...values) => ({ type: "string", enum: values });
var point = object({ x: number, y: number });
var rasterFloorplanSchema = object({
  title: text,
  confidence: number,
  wallHeightMeters: nullableNumber,
  measurements: array(object({
    id: text,
    text,
    axis: choice("horizontal", "vertical", "aligned"),
    start: point,
    end: point,
    meters: number
  })),
  footprint: array(point),
  holes: array(object({ id: text, type: choice("shaft", "courtyard"), polygon: array(point) })),
  rooms: array(object({ id: text, name: text, type: text, polygon: array(point) })),
  walls: array(object({ id: text, type: choice("external", "internal"), start: point, end: point })),
  openings: array(object({
    id: text,
    type: choice("door", "window"),
    wallId: text,
    start: point,
    end: point,
    heightMeters: nullableNumber,
    sillHeightMeters: nullableNumber,
    hingeSide: choice("start", "end", "unknown"),
    swingDirection: choice("clockwise", "counterclockwise", "unknown")
  }))
});
var rasterPixelTraceSchema = object({
  coordinateSpace: choice("image_pixels"),
  imageWidth: number,
  imageHeight: number,
  title: text,
  confidence: number,
  wallHeightMeters: nullableNumber,
  footprint: rasterFloorplanSchema.properties.footprint,
  holes: rasterFloorplanSchema.properties.holes,
  walls: rasterFloorplanSchema.properties.walls,
  rooms: rasterFloorplanSchema.properties.rooms,
  openings: rasterFloorplanSchema.properties.openings,
  measurements: rasterFloorplanSchema.properties.measurements
});
function rasterPixelTraceSchemaForImage(imageWidth, imageHeight) {
  if (![imageWidth, imageHeight].every((n) => Number.isSafeInteger(n) && n > 0)) {
    fail("IMAGE_SIZE_UNAVAILABLE", "Image dimensions must be positive integers.");
  }
  const schema = JSON.parse(JSON.stringify(rasterPixelTraceSchema));
  const visit = (node) => {
    if (node.type === "object" && node.properties?.x && node.properties?.y) {
      node.properties.x = { type: "number", minimum: 0, maximum: imageWidth };
      node.properties.y = { type: "number", minimum: 0, maximum: imageHeight };
    }
    if (node.properties) Object.values(node.properties).forEach(visit);
    if (node.items) visit(node.items);
  };
  visit(schema);
  schema.properties.imageWidth.enum = [imageWidth];
  schema.properties.imageHeight.enum = [imageHeight];
  return schema;
}
function normalizeRasterPixelTrace(raw, { imageWidth, imageHeight }) {
  if (raw?.coordinateSpace !== "image_pixels" || raw.imageWidth !== imageWidth || raw.imageHeight !== imageHeight) {
    fail("COORDINATE_FRAME_MISMATCH", "The AI trace does not use the supplied image pixel frame.", { expected: { imageWidth, imageHeight }, actual: { imageWidth: raw?.imageWidth, imageHeight: raw?.imageHeight, coordinateSpace: raw?.coordinateSpace } });
  }
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) fail("IMAGE_SIZE_UNAVAILABLE", "Image dimensions must be positive.");
  const convert = (p, path) => {
    const x = finite(p?.x, "pixel.x"), y = finite(p?.y, "pixel.y");
    if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) fail("INVALID_COORDINATE", "A traced pixel lies outside the supplied image.", { path, point: { x, y }, imageWidth, imageHeight });
    return { x: x * 1e3 / imageWidth, y: y * 1e3 / imageHeight };
  };
  const poly = (p, path) => list(p, "polygon", 1e3).map((point3, i) => convert(point3, `${path}[${i}]`));
  const span = (s, path) => ({ ...s, start: convert(s.start, `${path}.start`), end: convert(s.end, `${path}.end`) });
  return {
    title: raw.title,
    confidence: raw.confidence,
    wallHeightMeters: raw.wallHeightMeters,
    footprint: poly(raw.footprint, "footprint"),
    measurements: list(raw.measurements, "measurements", 80).map((s, i) => span(s, `measurements[${i}]`)),
    walls: list(raw.walls, "walls", 400).map((s, i) => span(s, `walls[${i}]`)),
    openings: list(raw.openings, "openings", 150).map((s, i) => span(s, `openings[${i}]`)),
    rooms: list(raw.rooms, "rooms", 100).map((r, i) => ({ ...r, polygon: poly(r.polygon, `rooms[${i}].polygon`) })),
    holes: list(raw.holes, "holes", 50).map((h, i) => ({ ...h, polygon: poly(h.polygon, `holes[${i}].polygon`) }))
  };
}
var RasterGeometryError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RasterGeometryError";
    this.code = code;
    this.details = details;
  }
};
var EPS = 1e-8;
var distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
var lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
var fail = (code, message, details) => {
  throw new RasterGeometryError(code, message, details);
};
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("INVALID_COORDINATE", `${label} must be a finite number.`);
  return value;
}
function imagePoint(p, label) {
  const x = finite(p?.x, `${label}.x`), y = finite(p?.y, `${label}.y`);
  if (x < 0 || x > 1e3 || y < 0 || y > 1e3) fail("INVALID_COORDINATE", `${label} is outside the image.`);
  return { x, y };
}
function list(value, name2, limit) {
  if (!Array.isArray(value) || value.length > limit) fail("INVALID_TRACE", `${name2} must be an array with at most ${limit} entries.`);
  return value;
}
function uniqueIds(items, label) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (typeof item?.id !== "string" || !item.id.trim() || ids.has(item.id)) {
      fail("DUPLICATE_OR_MISSING_ID", `${label} contains a missing or repeated ID.`, { id: item?.id });
    }
    ids.add(item.id);
  }
}
function projection(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 > EPS ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2 : 0;
  const projected = lerp(a, b, t);
  return { t, point: projected, distance: distance(p, projected) };
}
function edgeDistance(p, a, b) {
  return distance(p, lerp(a, b, Math.max(0, Math.min(1, projection(p, a, b).t))));
}
function signedArea(poly) {
  return poly.reduce((sum, p, i) => sum + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0) / 2;
}
var area = (poly) => Math.abs(signedArea(poly));
var edges = (poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);
function intersection(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < EPS) return null;
  return { t: ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator, u: ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator };
}
function inside(p, poly, tolerance = EPS) {
  if (edges(poly).some(([a, b]) => edgeDistance(p, a, b) <= tolerance)) return true;
  let result = false;
  for (const [a, b] of edges(poly)) {
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function polygon(points, label, transform) {
  let poly = list(points, label, 256).map((p, i) => transform(imagePoint(p, `${label}[${i}]`)));
  if (poly.length > 1 && distance(poly[0], poly.at(-1)) < EPS) poly = poly.slice(0, -1);
  if (poly.length < 3 || area(poly) < EPS) fail("INVALID_POLYGON", `${label} has no usable enclosed area.`);
  const boundary2 = edges(poly);
  for (let i = 0; i < boundary2.length; i++) {
    const [a, b] = boundary2[i];
    if (distance(a, b) < EPS) fail("INVALID_POLYGON", `${label} has a repeated consecutive point.`);
    const next = poly[(i + 2) % poly.length];
    if (Math.abs(cross(a, b, next)) < EPS && (b.x - a.x) * (next.x - b.x) + (b.y - a.y) * (next.y - b.y) < -EPS) {
      fail("SELF_INTERSECTING_POLYGON", `${label} backtracks along its boundary.`);
    }
    for (let j = i + 1; j < boundary2.length; j++) {
      if (j === i + 1 || i === 0 && j === boundary2.length - 1) continue;
      const [c, d] = boundary2[j];
      const hit = intersection(a, b, c, d);
      const touching = hit ? hit.t >= -EPS && hit.t <= 1 + EPS && hit.u >= -EPS && hit.u <= 1 + EPS : Math.min(edgeDistance(a, c, d), edgeDistance(b, c, d), edgeDistance(c, a, b), edgeDistance(d, a, b)) <= EPS;
      if (touching) fail("SELF_INTERSECTING_POLYGON", `${label} crosses or touches itself.`, { edgeIndices: [i, j] });
    }
  }
  return poly;
}
function segmentPartitions(a, b, poly) {
  const ts = [0, 1];
  for (const [c, d] of edges(poly)) {
    const hit = intersection(a, b, c, d);
    if (hit && hit.t > 0 && hit.t < 1 && hit.u >= 0 && hit.u <= 1) ts.push(hit.t);
  }
  ts.sort((x, y) => x - y);
  return ts;
}
function segmentInside(a, b, poly, tolerance = EPS) {
  const ts = segmentPartitions(a, b, poly);
  return inside(a, poly, tolerance) && inside(b, poly, tolerance) && ts.slice(1).every((t, i) => inside(lerp(a, b, (t + ts[i]) / 2), poly, tolerance));
}
function triangles(poly) {
  const indices = poly.map((_, i) => i);
  if (signedArea(poly) < 0) indices.reverse();
  const result = [];
  while (indices.length > 3) {
    let removed = false;
    for (let i = 0; i < indices.length; i++) {
      const ia = indices[(i + indices.length - 1) % indices.length], ib = indices[i], ic = indices[(i + 1) % indices.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (Math.abs(cross(a, b, c)) < EPS) {
        indices.splice(i, 1);
        removed = true;
        break;
      }
      if (cross(a, b, c) < 0) continue;
      if (indices.some((id) => id !== ia && id !== ib && id !== ic && cross(a, b, poly[id]) >= -EPS && cross(b, c, poly[id]) >= -EPS && cross(c, a, poly[id]) >= -EPS)) continue;
      result.push([a, b, c]);
      indices.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) fail("INVALID_POLYGON", "Could not triangulate a traced polygon.");
  }
  if (indices.length === 3) result.push(indices.map((id) => poly[id]));
  return result;
}
function triangleOverlap(a, b) {
  let output = a;
  for (const [c, d] of edges(b)) {
    const input = output;
    output = [];
    if (!input.length) break;
    for (const [p, q] of edges(input)) {
      const cp = cross(c, d, p), cq = cross(c, d, q);
      if (cp >= -EPS) output.push(p);
      if (cp > EPS && cq < -EPS || cp < -EPS && cq > EPS) output.push(lerp(p, q, cp / (cp - cq)));
    }
  }
  return output.length >= 3 ? area(output) : 0;
}
function overlap(a, b) {
  return triangles(a).reduce((total, ta) => total + triangles(b).reduce((sum, tb) => sum + triangleOverlap(ta, tb), 0), 0);
}
function scaleFromMeasurements(measurements, imageWidth, imageHeight) {
  if (!measurements.length) fail("MISSING_SCALE_EVIDENCE", "No readable dimension was found. Supply a clearer plan with at least one printed dimension; metric sizes will not be guessed.");
  const evidence = measurements.map((m) => {
    if (typeof m.text !== "string" || !m.text.trim()) fail("INVALID_MEASUREMENT", "A dimension is missing its visible text.", { id: m.id });
    const a = imagePoint(m.start, `measurement ${m.id}.start`), b = imagePoint(m.end, `measurement ${m.id}.end`);
    const dx = Math.abs(b.x - a.x) * imageWidth / 1e3, dy = Math.abs(b.y - a.y) * imageHeight / 1e3;
    const meters = finite(m.meters, `measurement ${m.id}.meters`);
    if (meters <= 0 || Math.hypot(dx, dy) < 5) fail("INVALID_MEASUREMENT", "A dimension has no usable reference span.", { id: m.id });
    if (m.axis === "horizontal" && dy > Math.max(3, dx * 0.03)) fail("INVALID_MEASUREMENT", "A horizontal dimension has inconsistent reference endpoints.", { id: m.id });
    if (m.axis === "vertical" && dx > Math.max(3, dy * 0.03)) fail("INVALID_MEASUREMENT", "A vertical dimension has inconsistent reference endpoints.", { id: m.id });
    if (!["horizontal", "vertical", "aligned"].includes(m.axis)) fail("INVALID_MEASUREMENT", "Unknown dimension axis.");
    return { ...m, dx, dy, meters, pixels: m.axis === "horizontal" ? dx : m.axis === "vertical" ? dy : Math.hypot(dx, dy) };
  });
  const fit = (items) => items.reduce((s, m) => s + m.pixels * m.meters, 0) / items.reduce((s, m) => s + m.pixels ** 2, 0);
  const horizontal = evidence.filter((m) => m.axis === "horizontal");
  const vertical = evidence.filter((m) => m.axis === "vertical");
  const uniform = fit(evidence);
  const horizontalScale = horizontal.length ? fit(horizontal) : uniform;
  const verticalScale = vertical.length ? fit(vertical) : uniform;
  const scaleSkew = Math.max(horizontalScale / verticalScale, verticalScale / horizontalScale) - 1;
  const residuals = evidence.map((m) => {
    const measured = m.pixels * uniform;
    const toleranceMeters = Math.max(2 * uniform, m.meters * 0.03);
    const errorMeters = Math.abs(measured - m.meters);
    return {
      id: m.id,
      text: m.text,
      axis: m.axis,
      pixels: m.pixels,
      printedMeters: m.meters,
      tracedMeters: measured,
      errorMeters,
      toleranceMeters,
      accepted: errorMeters <= toleranceMeters + EPS
    };
  });
  const diagnostics = { measurementScaleMode: "diagnostic_uniform_fit_not_accepted", measurements: residuals, conflictingIds: residuals.filter((r) => !r.accepted).map((r) => r.id), horizontalScale, verticalScale, scaleSkew };
  if (horizontal.length && vertical.length && scaleSkew > 0.05) {
    fail("CONFLICTING_SCALE", "Horizontal and vertical dimensions disagree with a uniform image scale.", diagnostics);
  }
  if (diagnostics.conflictingIds.length) {
    fail("CONFLICTING_DIMENSIONS", "The traced dimension spans do not agree with every supplied printed measurement.", diagnostics);
  }
  return { sx: uniform, sy: uniform, residuals, evidenceScaleSkew: scaleSkew, mode: "uniform_pixel_scale_all_evidence" };
}
function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1] + EPS) merged.push([...interval]);
    else last[1] = Math.max(last[1], interval[1]);
  }
  return merged;
}
function boundaryCoverage(a, b, supports, tolerance) {
  const intervals = [];
  for (const [c, d, supportTolerance = tolerance] of supports) {
    const pc = projection(c, a, b), pd = projection(d, a, b);
    if (pc.distance > supportTolerance || pd.distance > supportTolerance) continue;
    let low = Math.max(0, Math.min(pc.t, pd.t)), high = Math.min(1, Math.max(pc.t, pd.t));
    if (high <= low) continue;
    const length = distance(a, b);
    if (low * length <= supportTolerance) low = 0;
    if ((1 - high) * length <= supportTolerance) high = 1;
    if (high > low) intervals.push([low, high]);
  }
  return mergeIntervals(intervals).reduce((sum, [low, high]) => sum + high - low, 0);
}
function compileRasterFloorplan(raw, { imageWidth, imageHeight } = {}) {
  finite(imageWidth, "imageWidth");
  finite(imageHeight, "imageHeight");
  if (imageWidth <= 0 || imageHeight <= 0) fail("IMAGE_SIZE_UNAVAILABLE", "The source image dimensions are unavailable.");
  const confidence = finite(raw?.confidence, "confidence");
  if (confidence < 0 || confidence > 1) fail("INVALID_CONFIDENCE", "The image trace confidence must be between 0 and 1.");
  const measurements = list(raw.measurements, "measurements", 80);
  const rawRooms = list(raw.rooms, "rooms", 100), rawWalls = list(raw.walls, "walls", 400);
  const rawHoles = list(raw.holes, "holes", 50), rawOpenings = list(raw.openings, "openings", 150);
  for (const [items, name2] of [[measurements, "measurements"], [rawRooms, "rooms"], [rawWalls, "walls"], [rawHoles, "holes"], [rawOpenings, "openings"]]) uniqueIds(items, name2);
  if (!rawRooms.length || rawWalls.length < 3) fail("INCOMPLETE_TRACE", "No complete floor-plan trace was returned.");
  const scale = scaleFromMeasurements(measurements, imageWidth, imageHeight);
  const footprintImage = polygon(raw.footprint, "footprint", (p) => p);
  const minX = Math.min(...footprintImage.map((p) => p.x)), maxX = Math.max(...footprintImage.map((p) => p.x));
  const minY = Math.min(...footprintImage.map((p) => p.y)), maxY = Math.max(...footprintImage.map((p) => p.y));
  const mx = imageWidth / 1e3 * scale.sx, my = imageHeight / 1e3 * scale.sy;
  const transform = (p) => ({ x: (p.x - minX) * mx, y: (maxY - p.y) * my });
  const width = (maxX - minX) * mx, depth = (maxY - minY) * my;
  const footprint = footprintImage.map(transform);
  const rooms = rawRooms.map((r) => ({ id: r.id, name: r.name, type: r.type, polygon: polygon(r.polygon, `room ${r.id}`, transform) }));
  const holes = rawHoles.map((h) => {
    if (!["shaft", "courtyard"].includes(h.type)) fail("INVALID_HOLE", "Only explicitly identified shafts/courtyards can remove floor.");
    return { id: h.id, type: h.type, polygon: polygon(h.polygon, `hole ${h.id}`, transform) };
  });
  const assumptions = ["Wall thickness is schematic: internal 0.12 m, external 0.18 m."];
  const height = raw.wallHeightMeters == null ? 3.2 : finite(raw.wallHeightMeters, "wallHeightMeters");
  if (raw.wallHeightMeters == null) assumptions.push("Wall height is assumed to be 3.20 m; it is not measurable from the plan view alone.");
  if (height <= 0) fail("INVALID_HEIGHT", "Wall height must be positive.");
  const walls = [], wallMap = /* @__PURE__ */ new Map();
  for (const w of rawWalls) {
    if (!["external", "internal"].includes(w.type)) fail("INVALID_WALL", "Unknown wall type.", { id: w.id });
    const wall = { id: w.id, type: w.type, start: transform(imagePoint(w.start, `wall ${w.id}.start`)), end: transform(imagePoint(w.end, `wall ${w.id}.end`)) };
    if (distance(wall.start, wall.end) < 5e-3) fail("INVALID_WALL", "A wall has no usable length.", { id: w.id });
    const duplicate = walls.find((v) => distance(v.start, wall.start) < EPS && distance(v.end, wall.end) < EPS || distance(v.end, wall.start) < EPS && distance(v.start, wall.end) < EPS);
    if (duplicate && duplicate.type !== wall.type) fail("CONFLICTING_WALLS", "The same wall is classified as both internal and external.", { id: w.id });
    wallMap.set(w.id, { wall: duplicate || wall, reversed: duplicate ? distance(duplicate.end, wall.start) < EPS : false });
    if (!duplicate) walls.push(wall);
  }
  for (const wall of walls) {
    if (!segmentInside(wall.start, wall.end, footprint, 0.015)) fail("WALL_OUTSIDE_FOOTPRINT", "A wall crosses outside the traced exterior boundary.", { wallId: wall.id });
  }
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j];
    const p = projection(b.start, a.start, a.end), q = projection(b.end, a.start, a.end);
    if (p.distance < EPS && q.distance < EPS && Math.min(1, Math.max(p.t, q.t)) - Math.max(0, Math.min(p.t, q.t)) > EPS) {
      fail("OVERLAPPING_WALLS", "Partly overlapping wall runs were returned. Trace each physical wall once.", { wallIds: [a.id, b.id] });
    }
  }
  const pixelTolerance = Math.min(0.025, 2 * scale.sx);
  const externalTolerance = 0.09 + pixelTolerance;
  const externalEdges = walls.filter((w) => w.type === "external").map((w) => [w.start, w.end]);
  for (const [a, b] of edges(footprint)) {
    if (boundaryCoverage(a, b, externalEdges, externalTolerance) < 1 - EPS) fail("INCOMPLETE_EXTERIOR", "The exterior walls do not cover the traced footprint, including its recesses.");
  }
  const wallEdges = walls.map((w) => [w.start, w.end, (w.type === "external" ? 0.09 : 0.06) + pixelTolerance]);
  for (const room of rooms) {
    if (!edges(room.polygon).every(([a, b]) => segmentInside(a, b, footprint, 0.015))) fail("ROOM_OUTSIDE_FOOTPRINT", "A room crosses outside the traced footprint.", { roomId: room.id });
    const supports = [
      ...wallEdges,
      ...edges(footprint).map(([a, b]) => [a, b, externalTolerance]),
      ...rooms.filter((r) => r.id !== room.id).flatMap((r) => edges(r.polygon).map(([a, b]) => [a, b, pixelTolerance]))
    ];
    for (const [a, b] of edges(room.polygon)) {
      const coverage = boundaryCoverage(a, b, supports, pixelTolerance);
      if (coverage < 1 - EPS) fail("UNSUPPORTED_ROOM_BOUNDARY", "A room boundary is unsupported by the walls or an adjacent open-plan zone.", { roomId: room.id, roomName: room.name, start: a, end: b, coverage, requiredCoverage: 1, toleranceMeters: pixelTolerance });
    }
    for (const wall of walls) {
      const ts = segmentPartitions(wall.start, wall.end, room.polygon);
      const crossesInterior = ts.slice(1).some((t, i) => {
        const middle = lerp(wall.start, wall.end, (t + ts[i]) / 2);
        return inside(middle, room.polygon) && Math.min(...edges(room.polygon).map(([a, b]) => edgeDistance(middle, a, b))) > pixelTolerance;
      });
      if (crossesInterior) {
        fail("WALL_CROSSES_ROOM", "A wall runs through the interior of a room polygon.", { wallId: wall.id, roomId: room.id });
      }
    }
  }
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const overlapArea = overlap(rooms[i].polygon, rooms[j].polygon);
    if (overlapArea > Math.max(2e-3, Math.min(area(rooms[i].polygon), area(rooms[j].polygon)) * 2e-3)) {
      fail("OVERLAPPING_ROOMS", "Room polygons overlap; shared walls cannot be validated.", { roomIds: [rooms[i].id, rooms[j].id], overlapArea });
    }
  }
  for (const hole of holes) {
    if (!edges(hole.polygon).every(([a, b]) => segmentInside(a, b, footprint))) fail("HOLE_OUTSIDE_FOOTPRINT", "A shaft/courtyard crosses outside the footprint.", { holeId: hole.id });
    if (rooms.some((r) => overlap(r.polygon, hole.polygon) > 2e-3)) fail("HOLE_OVERLAPS_ROOM", "A shaft/courtyard overlaps a room.", { holeId: hole.id });
  }
  for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
    if (overlap(holes[i].polygon, holes[j].polygon) > 2e-3) fail("OVERLAPPING_HOLES", "Shaft/courtyard polygons overlap.");
  }
  const openings = [], intervalsByWall = /* @__PURE__ */ new Map();
  for (const o of rawOpenings) {
    const parent = wallMap.get(o.wallId);
    if (!parent) fail("OPENING_WALL_MISSING", "A door/window references a missing wall. It was not reassigned to another wall.", { openingId: o.id, wallId: o.wallId });
    const { wall, reversed } = parent;
    const a = transform(imagePoint(o.start, `opening ${o.id}.start`)), b = transform(imagePoint(o.end, `opening ${o.id}.end`));
    const pa = projection(a, wall.start, wall.end), pb = projection(b, wall.start, wall.end);
    if (Math.max(pa.distance, pb.distance) > pixelTolerance) {
      fail("OPENING_OFF_WALL", "A door/window jamb is off its stated wall; the trace cannot be accepted.", { openingId: o.id, wallId: wall.id, maxDistanceMeters: Math.max(pa.distance, pb.distance), toleranceMeters: pixelTolerance });
    }
    const low = Math.min(pa.t, pb.t), high = Math.max(pa.t, pb.t);
    if (low < -EPS || high > 1 + EPS || high - low < EPS) {
      fail("OPENING_OUTSIDE_WALL", "A door/window extends beyond its stated wall or has no width.", { openingId: o.id, wallId: wall.id });
    }
    const intervals = intervalsByWall.get(wall.id) || [];
    if (intervals.some(([start, end]) => Math.min(end, high) - Math.max(start, low) > EPS)) {
      fail("OVERLAPPING_OPENINGS", "Door/window intervals overlap on the same wall.", { openingId: o.id, wallId: wall.id });
    }
    intervals.push([low, high]);
    intervalsByWall.set(wall.id, intervals);
    if (!["door", "window"].includes(o.type) || !["start", "end", "unknown"].includes(o.hingeSide) || !["clockwise", "counterclockwise", "unknown"].includes(o.swingDirection)) {
      fail("INVALID_OPENING", "A door/window has invalid type or swing metadata.", { openingId: o.id });
    }
    const openingHeight = o.heightMeters == null ? o.type === "window" ? 1.2 : 2.1 : finite(o.heightMeters, `opening ${o.id}.height`);
    const sill = o.type === "door" ? 0 : o.sillHeightMeters == null ? 0.9 : finite(o.sillHeightMeters, `opening ${o.id}.sill`);
    if (openingHeight <= 0 || sill < 0 || openingHeight + sill > height + EPS) fail("INVALID_OPENING_HEIGHT", "The opening height/sill exceeds the wall height.", { openingId: o.id });
    if (o.heightMeters == null || o.type === "window" && o.sillHeightMeters == null) assumptions.push(`Opening ${o.id}: unannotated vertical dimensions use schematic defaults.`);
    let hinge = o.hingeSide;
    if (reversed) hinge = hinge === "start" ? "end" : hinge === "end" ? "start" : "unknown";
    openings.push({ id: o.id, type: o.type, wallId: wall.id, offset: (low + high) / 2, width: (high - low) * distance(wall.start, wall.end), height: openingHeight, sillHeight: sill, hinge, swing: o.swingDirection });
  }
  const validation = {
    version: RASTER_GEOMETRY_VERSION,
    structuralChecks: "passed",
    imageAgreement: "requires_visual_review",
    scaleMode: scale.mode,
    scaleSkew: Number(scale.evidenceScaleSkew.toFixed(4)),
    measurements: scale.residuals,
    assumptions,
    duplicateWallsRemoved: rawWalls.length - walls.length,
    roomCount: rooms.length,
    wallCount: walls.length,
    openingCount: openings.length,
    omittedOpeningCount: 0,
    omittedOpenings: []
  };
  return {
    sceneType: "apartment_floorplan",
    title: raw.title || "Image floor plan",
    rasterGeometryVersion: RASTER_GEOMETRY_VERSION,
    width,
    depth,
    height,
    wallThickness: 0.12,
    externalWallThickness: 0.18,
    cutawayHeight: height,
    heightSource: raw.wallHeightMeters == null ? "design_default_not_measured" : "source_dimension",
    footprint,
    holes,
    rooms,
    walls,
    openings,
    assets: [],
    palette: { wall: "#B8B1A7", floor: "#92785D", ceiling: "#D7D1C7", accent: "#6D503B", glass: "#557F94", door: "#654736" },
    geometryValidation: validation
  };
}

// src/lib/rasterImageEvidence.mjs
import sharp from "sharp";

// src/lib/rasterInkContrast.mjs
function rasterInkContrast(tone, width, height) {
  const stride = width + 1, integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += tone[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const mask = new Uint8Array(tone.length), strokeMask = new Uint8Array(tone.length);
  const radius = Math.max(6, Math.min(24, Math.round(Math.min(width, height) * 0.025)));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, v = tone[i], x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const mean = (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
    strokeMask[i] = v < 252 && mean - v >= 6 ? 1 : 0;
    mask[i] = v < 170 || strokeMask[i] ? 1 : 0;
  }
  return { mask, strokeMask };
}

// src/lib/rasterImageEvidence.mjs
var RASTER_IMAGE_EVIDENCE_VERSION = "raster-pixel-support-v2-contrast";
function evidenceError(code, message, details) {
  return Object.assign(new Error(message), { name: "RasterImageEvidenceError", code, details });
}
function exteriorBackground(mask, width, height) {
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += mask[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) * 0.012));
  const broad = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const dark = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
    broad[y * width + x] = dark / ((x1 - x0) * (y1 - y0)) >= 0.93 ? 1 : 0;
  }
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const add = (i) => {
    if (broad[i] && !visited[i]) {
      visited[i] = 1;
      queue[tail++] = i;
    }
  };
  const seedEdge = (indices) => {
    let start = -1;
    for (let j = 0; j <= indices.length; j++) {
      if (j < indices.length && broad[indices[j]]) {
        if (start < 0) start = j;
      } else if (start >= 0) {
        if (j - start >= indices.length * 0.5) for (let k = start; k < j; k++) add(indices[k]);
        start = -1;
      }
    }
  };
  seedEdge(Array.from({ length: width }, (_, x) => x));
  seedEdge(Array.from({ length: width }, (_, x) => (height - 1) * width + x));
  seedEdge(Array.from({ length: height }, (_, y) => y * width));
  seedEdge(Array.from({ length: height }, (_, y) => y * width + width - 1));
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) add(i - 1);
    if (x + 1 < width) add(i + 1);
    if (y) add(i - width);
    if (y + 1 < height) add(i + width);
  }
  const distance7 = new Uint16Array(mask.length);
  head = 0;
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (distance7[i] >= radius) continue;
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (j >= 0 && mask[j] && !visited[j]) {
        visited[j] = 1;
        distance7[j] = distance7[i] + 1;
        queue[tail++] = j;
      }
    }
  }
  return visited;
}
function strokeGuides(mask, width, height, horizontal) {
  const major = horizontal ? width : height, minor = horizontal ? height : width;
  const minLength = Math.max(12, Math.round(Math.min(width, height) * 0.018));
  const maxThickness = Math.max(10, Math.round(Math.min(width, height) * 0.035));
  const groups = [], active = /* @__PURE__ */ new Map();
  for (let row = 0; row < minor; row++) {
    const runs = [];
    let begin = -1;
    for (let col = 0; col <= major; col++) {
      const dark = col < major && mask[horizontal ? row * width + col : col * width + row];
      if (dark && begin < 0) begin = col;
      if (!dark && begin >= 0) {
        if (col - begin >= minLength) runs.push([begin, col - 1]);
        begin = -1;
      }
    }
    const next = /* @__PURE__ */ new Map();
    for (const [start, end] of runs) {
      let previous = null;
      for (const g of active.values()) {
        if (Math.abs(g.start - start) <= 2 && Math.abs(g.end - end) <= 2) {
          previous = g;
          break;
        }
      }
      if (previous) {
        previous.last = row;
        previous.start = Math.max(previous.start, start);
        previous.end = Math.min(previous.end, end);
        next.set(previous, previous);
      } else {
        const group = { start, end, first: row, last: row };
        groups.push(group);
        next.set(group, group);
      }
    }
    active.clear();
    for (const [key2, g] of next) active.set(key2, g);
  }
  return groups.filter((g) => g.last - g.first >= 2 && g.last - g.first + 1 <= maxThickness && g.end - g.start >= minLength).map((g) => {
    const center = (g.first + g.last) / 2;
    return {
      start: horizontal ? { x: g.start, y: center } : { x: center, y: g.start },
      end: horizontal ? { x: g.end, y: center } : { x: center, y: g.end },
      thicknessPixels: g.last - g.first + 1
    };
  });
}
async function prepareRasterImageEvidence(buffer) {
  const { data, info } = await sharp(buffer).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const { mask, strokeMask } = rasterInkContrast(data, width, height);
  const symbolMask = Uint8Array.from(data, (v, i) => v < 132 || strokeMask[i] ? 1 : 0);
  const background = exteriorBackground(mask, width, height);
  for (let i = 0; i < mask.length; i++) if (background[i]) mask[i] = 0;
  const guides = [...strokeGuides(mask, width, height, true), ...strokeGuides(mask, width, height, false)].sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y)).slice(0, 100).map((g, i) => ({ id: `pixel-stroke-${i + 1}`, ...g }));
  return { width, height, mask, guides, tone: data, symbolMask };
}
function rasterEvidencePrompt(evidence) {
  if (!evidence.guides.length) return "No long dark wall-stroke guides could be isolated. Trace only clearly visible structural lines; unreadable geometry must remain rejected.";
  return `Observed dark pixel strokes in the exact image frame (these are partial ink segments, NOT a completed plan or a wall classification):
${JSON.stringify(evidence.guides)}
Use the original image to classify wall strokes versus text/furniture. Match visible wall centerlines to these coordinates where relevant. Connect strokes only through visible wall junctions or real door/window gaps. The guide list may be incomplete and is never permission to infer a rectangle, extend a wall into white space, or fill a recess.`;
}
var point2 = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
function project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator : 0;
  return { t, distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) };
}
function inspectRasterImageEvidence(pixelTrace, evidence) {
  const { width, height, mask } = evidence;
  if (pixelTrace.imageWidth !== width || pixelTrace.imageHeight !== height) {
    throw evidenceError("COORDINATE_FRAME_MISMATCH", "The trace and pixel evidence use different image dimensions.", { imageWidth: width, imageHeight: height });
  }
  const tolerancePixels = Math.max(2, Math.min(5, Math.round(Math.min(width, height) * 4e-3)));
  const outlineRadius = Math.max(6, Math.min(14, Math.round(Math.min(width, height) * 0.018)));
  const at2 = (x, y) => {
    const ix = Math.round(x), iy = Math.round(y);
    return ix >= 0 && iy >= 0 && ix < width && iy < height ? mask[iy * width + ix] || 0 : 0;
  };
  const nearInk = (x, y, radius = 1) => {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) if (at2(x + dx, y + dy)) return true;
    return false;
  };
  const openings = Array.isArray(pixelTrace.openings) ? pixelTrace.openings : [];
  const walls = (Array.isArray(pixelTrace.walls) ? pixelTrace.walls : []).map((w) => {
    if (!point2(w.start) || !point2(w.end)) return { id: w.id, passed: false, reason: "invalid_endpoints" };
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, length = Math.hypot(dx, dy);
    if (!length) return { id: w.id, passed: false, reason: "empty_wall" };
    const nx = -dy / length, ny = dx / length;
    const inkAt = (t) => {
      const x = w.start.x + dx * t, y = w.start.y + dy * t;
      let dark = 0;
      for (let n = -tolerancePixels; n <= tolerancePixels; n++) dark += at2(x + nx * n, y + ny * n);
      if (dark >= 1) return true;
      let negative = 0, positive = 0;
      for (let n = 1; n <= outlineRadius; n++) {
        if (!negative && at2(x - nx * n, y - ny * n)) negative = n;
        if (!positive && at2(x + nx * n, y + ny * n)) positive = n;
      }
      return negative > 0 && positive > 0 && Math.abs(negative - positive) <= tolerancePixels;
    };
    const unsupportedOpeningIds = [];
    const openingIssues = [];
    const windowIntervals = [];
    const intervals = openings.filter((o) => o.wallId === w.id && point2(o.start) && point2(o.end)).flatMap((o) => {
      const a = project(o.start, w.start, w.end), b = project(o.end, w.start, w.end);
      if (a.distance > tolerancePixels || b.distance > tolerancePixels) {
        unsupportedOpeningIds.push(o.id);
        openingIssues.push({ id: o.id, reason: "jamb_off_wall", start: o.start, end: o.end, maximumDistancePixels: Math.max(a.distance, b.distance) });
        return [];
      }
      const low = Math.max(0, Math.min(a.t, b.t)), high = Math.min(1, Math.max(a.t, b.t));
      const jambHasInk = (t, direction) => {
        for (let step = 0; step <= tolerancePixels * 2; step++) {
          const sample = t + direction * step / length;
          if (sample >= 0 && sample <= 1 && inkAt(sample)) return true;
        }
        return false;
      };
      if (low >= high || !jambHasInk(low, -1) || !jambHasInk(high, 1)) {
        unsupportedOpeningIds.push(o.id);
        openingIssues.push({ id: o.id, reason: "jamb_ink_unverified" });
        return [];
      }
      const openingWidth = (high - low) * length;
      let along = 0;
      for (let n = 0; n < 20; n++) if (inkAt(low + (high - low) * (0.2 + 0.6 * n / 19))) along++;
      let symbolSupported = along / 20 >= 0.7;
      if (!symbolSupported && o.type === "door") {
        for (const [hinge, sign] of [[low, 1], [high, -1]]) {
          const hx = w.start.x + dx * hinge, hy = w.start.y + dy * hinge;
          const angleStep = Math.min(1, Math.atan2(1, openingWidth) * 180 / Math.PI);
          for (const leafFraction of [1, 0.5]) for (const side of [-1, 1]) for (let degrees = 1; degrees < 180; degrees += angleStep) {
            const angle = side * degrees * Math.PI / 180;
            const ux = sign * dx / length, uy = sign * dy / length;
            const rx = ux * Math.cos(angle) - uy * Math.sin(angle), ry = ux * Math.sin(angle) + uy * Math.cos(angle);
            let supported2 = 0;
            for (let n = 0; n < 20; n++) {
              const reach = openingWidth * leafFraction * (0.18 + 0.65 * n / 19);
              const x = hx + rx * reach, y = hy + ry * reach;
              let thickness = 0;
              for (let offset = -tolerancePixels; offset <= tolerancePixels; offset++) thickness += at2(x - ry * offset, y + rx * offset);
              if (nearInk(x, y, 1) && thickness <= Math.max(2, tolerancePixels)) supported2++;
            }
            if (supported2 / 20 >= 0.8) symbolSupported = true;
          }
        }
      }
      if (!symbolSupported) {
        unsupportedOpeningIds.push(o.id);
        openingIssues.push({ id: o.id, reason: "symbol_ink_unverified" });
        return [];
      }
      if (o.type === "window") windowIntervals.push([low, high]);
      return [[low, high]];
    });
    const samples = Math.max(2, Math.ceil(length));
    let tested = 0, supported = 0, longestMissing = 0, missing = 0;
    let missingStart = -1;
    const missingSpans = [];
    const samplePoint = (i) => ({ x: Number((w.start.x + dx * i / samples).toFixed(2)), y: Number((w.start.y + dy * i / samples).toFixed(2)) });
    const closeMissingSpan = (endIndex) => {
      if (missingStart < 0) return;
      const pixels = (endIndex - missingStart + 1) * length / samples;
      if (pixels > tolerancePixels * 2) missingSpans.push({ start: samplePoint(missingStart), end: samplePoint(endIndex), lengthPixels: Number(pixels.toFixed(1)) });
      missingStart = -1;
    };
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      if (intervals.some(([a, b]) => t >= a && t <= b)) {
        closeMissingSpan(i - 1);
        missing = 0;
        continue;
      }
      tested++;
      if (inkAt(t)) {
        closeMissingSpan(i - 1);
        supported++;
        missing = 0;
      } else {
        if (missingStart < 0) missingStart = i;
        missing++;
        longestMissing = Math.max(longestMissing, missing);
      }
    }
    closeMissingSpan(samples);
    const windowOnly = windowIntervals.some(([a, b]) => a <= 0 && b >= 1);
    const coverage = tested ? supported / tested : windowOnly ? 1 : 0;
    const longestMissingPixels = longestMissing * length / samples;
    const passed = !unsupportedOpeningIds.length && (tested >= 4 || windowOnly) && coverage >= 0.9 && longestMissingPixels <= tolerancePixels * 2;
    return { id: w.id, type: w.type, start: w.start, end: w.end, coverage: Number(coverage.toFixed(3)), longestMissingPixels: Number(longestMissingPixels.toFixed(1)), missingSpans, testedSamples: tested, windowOnly, unsupportedOpeningIds, openingIssues, passed };
  });
  return {
    version: RASTER_IMAGE_EVIDENCE_VERSION,
    status: walls.length && walls.every((w) => w.passed) ? "passed" : "rejected",
    tolerancePixels,
    walls,
    unsupportedWallIds: walls.filter((w) => !w.passed).map((w) => w.id),
    guideCount: evidence.guides.length,
    meaning: "Visible ink supports these traced wall positions; this does not certify labels, dimensions or completeness."
  };
}
function requireRasterImageEvidence(result) {
  if (result.status !== "passed") {
    throw evidenceError("TRACE_IMAGE_MISMATCH", "Traced walls do not follow the source image. No new 3D scene was saved.", { imageEvidence: result, unsupportedWallIds: result.unsupportedWallIds });
  }
  return result;
}

// src/lib/verifiedPreview.mjs
var VERIFIED_PREVIEW_VERSION = "pixel-graph-preview-v142-single-role-20261109";

// src/lib/rasterCoordinateReference.mjs
import sharp2 from "sharp";
async function rasterCoordinateReference(buffer, width, height) {
  const step = Math.max(100, Math.ceil(Math.max(width, height) / 12 / 100) * 100);
  const marks = [];
  for (let x = 0; x < width; x += step) {
    marks.push(`<path d="M${x} 0V${height}"/><text x="${x + 3}" y="16">x=${x}</text>`);
  }
  for (let y = step; y < height; y += step) {
    marks.push(`<path d="M0 ${y}H${width}"/><text x="3" y="${y - 4}">y=${y}</text>`);
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g stroke="#1675bb" stroke-opacity=".38" stroke-width="1" stroke-dasharray="3 6" fill="#07588e" font-family="sans-serif" font-size="14">${marks.join("")}</g></svg>`);
  const data = await sharp2(buffer).composite([{ input: overlay }]).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  return { type: "input_image", image_url: `data:image/jpeg;base64,${data.toString("base64")}`, detail: "high" };
}

// src/lib/serverPixelGraphPreview.js
import { NextResponse } from "next/server.js";
import sharp6 from "sharp";

// src/lib/rasterGraphPipeline.mjs
import sharp5 from "sharp";
import { createHash } from "node:crypto";

// src/lib/rasterPixelGraph.mjs
import sharp3 from "sharp";

// src/lib/rasterContentExtent.mjs
function rasterContentExtent(mask, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (right < left) return { left: 0, top: 0, width, height, scalePixels: Math.min(width, height), empty: true };
  const activeWidth = right - left + 1, activeHeight = bottom - top + 1;
  return { left, top, width: activeWidth, height: activeHeight, scalePixels: Math.min(activeWidth, activeHeight), empty: false };
}

// src/lib/rasterPixelGraph.mjs
var PIXEL_GRAPH_VERSION = "pixel-line-graph-v4-content-extent";
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var cross2 = (a, b) => a.x * b.y - a.y * b.x;
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
var at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
var area2 = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
var round = (p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
function error(code, message, details = {}) {
  return Object.assign(Error(message), { name: "PixelGraphError", code, details });
}
function project2(p, a, b) {
  const v = sub(b, a), length2 = v.x * v.x + v.y * v.y, t = length2 ? ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / length2 : 0;
  return { t, distance: dist(p, at(a, b, t)) };
}
function detectInkSegments(mask, width, height, { minLength = Math.max(18, Math.min(width, height) * 0.035), maxLines = 512 } = {}) {
  const edge = [], edgeMask = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) {
      edge.push({ x, y });
      edgeMask[i] = 1;
    }
  }
  if (!edge.length) return [];
  const diagonal = Math.ceil(Math.hypot(width, height)), stride = 2 * diagonal + 1, angles = 180, step = Math.max(1, Math.ceil(edge.length / 9e4));
  const votes = new Uint32Array(angles * stride), trig = Array.from({ length: angles }, (_, i) => ({ c: Math.cos(i * Math.PI / 180), s: Math.sin(i * Math.PI / 180) }));
  for (let a = 0; a < angles; a++) {
    const { c, s } = trig[a], base = a * stride;
    for (let i = 0; i < edge.length; i += step) {
      const p = edge[i];
      votes[base + Math.round(p.x * c + p.y * s) + diagonal]++;
    }
  }
  let peaks = [];
  for (let a = 0; a < angles; a++) for (let r = 2; r < stride - 2; r++) {
    const value = votes[a * stride + r];
    if (value < minLength * 0.65 / step) continue;
    let peak = true;
    for (let da = -1; da <= 1 && peak; da++) for (let dr = -2; dr <= 2; dr++) {
      const aa = a + da;
      if (aa < 0 || aa >= angles || !da && !dr) continue;
      const other = votes[aa * stride + r + dr];
      if (other > value || other === value && (da < 0 || !da && dr < 0)) {
        peak = false;
        break;
      }
    }
    if (peak) peaks.push({ a, rho: r - diagonal, value });
  }
  peaks.sort((a, b) => b.value - a.value || a.a - b.a || a.rho - b.rho);
  const angleDistance = (a, b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)), directions = [];
  for (const p of peaks) {
    if (p.value < Math.max(minLength * 3, Math.min(width, height) * 0.12) / step) break;
    if (directions.every((a) => angleDistance(a, p.a) > 3)) directions.push(p.a);
    if (directions.length === 12) break;
  }
  if (!directions.length) return [];
  peaks = peaks.filter((p) => directions.some((a) => angleDistance(a, p.a) <= 1));
  if (peaks.length > maxLines * 6) throw error("PIXEL_GRAPH_TOO_COMPLEX", "Too many source lines to classify safely.", { peakCount: peaks.length });
  const segments = [];
  for (const peak of peaks) {
    const { c, s } = trig[peak.a], v = { x: -s, y: c }, corners = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }], ts = corners.map((p) => p.x * v.x + p.y * v.y);
    let start = null, last = null, misses = 0;
    const emit = () => {
      if (start === null || last - start < minLength) return;
      const rawStart = { x: c * peak.rho + v.x * start, y: s * peak.rho + v.y * start }, rawEnd = { x: c * peak.rho + v.x * last, y: s * peak.rho + v.y * last };
      if ([rawStart, rawEnd].some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height)) return;
      const pts = [];
      for (const p of edge) {
        const q = project2(p, rawStart, rawEnd);
        if (q.t >= 0 && q.t <= 1 && q.distance <= 1.7) pts.push(p);
      }
      if (pts.length < minLength * 0.4) return;
      const mean = pts.reduce((q, p) => ({ x: q.x + p.x / pts.length, y: q.y + p.y / pts.length }), { x: 0, y: 0 });
      let xx = 0, xy2 = 0, yy = 0;
      for (const p of pts) {
        const x = p.x - mean.x, y = p.y - mean.y;
        xx += x * x;
        xy2 += x * y;
        yy += y * y;
      }
      const angle = 0.5 * Math.atan2(2 * xy2, xx - yy), u = { x: Math.cos(angle), y: Math.sin(angle) }, values = pts.map((p) => (p.x - mean.x) * u.x + (p.y - mean.y) * u.y), lo = Math.min(...values), hi = Math.max(...values);
      let a = round({ x: mean.x + u.x * lo, y: mean.y + u.y * lo }), b = round({ x: mean.x + u.x * hi, y: mean.y + u.y * hi });
      if (a.x > b.x || a.x === b.x && a.y > b.y) [a, b] = [b, a];
      const duplicate = segments.some((g) => project2(a, g.start, g.end).distance < 2.2 && project2(b, g.start, g.end).distance < 2.2 && Math.max(project2(a, g.start, g.end).t, project2(b, g.start, g.end).t) > 0.05 && Math.min(project2(a, g.start, g.end).t, project2(b, g.start, g.end).t) < 0.95);
      if (!duplicate) segments.push({ start: a, end: b, lengthPixels: Math.round(dist(a, b)), support: "observed_ink" });
    };
    for (let t = Math.floor(Math.min(...ts)); t <= Math.ceil(Math.max(...ts)); t++) {
      let ink = false;
      for (let n = -1; n <= 1; n++) {
        const x = Math.round(c * (peak.rho + n) + v.x * t), y = Math.round(s * (peak.rho + n) + v.y * t);
        if (x >= 0 && x < width && y >= 0 && y < height && edgeMask[y * width + x]) {
          ink = true;
          break;
        }
      }
      if (ink) {
        if (start === null) start = t;
        last = t;
        misses = 0;
      } else if (start !== null && ++misses > 1) {
        emit();
        start = last = null;
        misses = 0;
      }
    }
    emit();
    if (segments.length > maxLines) throw error("PIXEL_GRAPH_TOO_COMPLEX", "Source has more segments than the classifier budget; no geometry was truncated.", { segmentCount: segments.length });
  }
  return segments.sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x || b.lengthPixels - a.lengthPixels).map((s, i) => ({ id: `ink${i + 1}`, ...s }));
}
async function extractRasterPixelGraph(buffer) {
  const { data, info } = await sharp3(buffer).flatten({ background: "#fff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info, tone = new Uint8Array(width * height), chroma = new Uint8Array(width * height), mask = new Uint8Array(width * height), coloredMask = new Uint8Array(width * height);
  for (let i = 0; i < tone.length; i++) {
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2];
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
    tone[i] = Math.round((r + g + b) / 3);
  }
  const contrast = rasterInkContrast(tone, width, height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = chroma[i] < 55 && contrast.mask[i] ? 1 : 0;
    coloredMask[i] = chroma[i] >= 55 && (tone[i] < 210 || contrast.strokeMask[i]) ? 1 : 0;
  }
  const contentExtent = rasterContentExtent(Uint8Array.from(mask, (v, i) => v || coloredMask[i]), width, height), scalePixels = contentExtent.scalePixels;
  const ink = [...detectInkSegments(mask, width, height, { minLength: Math.max(18, scalePixels * 0.035) }), ...detectInkSegments(coloredMask, width, height, { minLength: Math.max(18, scalePixels * 0.035) }).map((s) => ({ ...s, id: `color_${s.id}`, colorEvidence: true }))];
  const eroded = new Uint8Array(mask.length), maximumBand = Math.max(12, scalePixels * 0.035);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    let full = true;
    for (let dy = -1; dy <= 1 && full; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[i + dy * width + dx]) {
      full = false;
      break;
    }
    eroded[i] = full ? 1 : 0;
  }
  const bands = [];
  for (const s of detectInkSegments(eroded, width, height, { minLength: 6, maxLines: 512 }).sort((a, b) => b.lengthPixels - a.lengthPixels)) {
    const length = dist(s.start, s.end), nx = -(s.end.y - s.start.y) / length, ny = (s.end.x - s.start.x) / length, offsets = [], thicknesses = [];
    const hit = (p, n) => {
      const x = Math.round(p.x + nx * n), y = Math.round(p.y + ny * n);
      return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
    };
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const p = at(s.start, s.end, t);
      let low = 0, high = 0;
      if (!hit(p, 0)) continue;
      while (low > -maximumBand && hit(p, low - 1)) low--;
      while (high < maximumBand && hit(p, high + 1)) high++;
      offsets.push((low + high) / 2);
      thicknesses.push(high - low + 1);
    }
    if (offsets.length !== 4 || thicknesses.some((v) => v < 3 || v > maximumBand) || Math.max(...thicknesses) - Math.min(...thicknesses) > 3) continue;
    const shift = offsets.reduce((a, b) => a + b, 0) / 4, start = round({ x: s.start.x + nx * shift, y: s.start.y + ny * shift }), end = round({ x: s.end.x + nx * shift, y: s.end.y + ny * shift }), thicknessPixels = thicknesses.reduce((a, b) => a + b, 0) / 4;
    const ux = (s.end.x - s.start.x) / length, uy = (s.end.y - s.start.y) / length;
    for (const [p, sign] of [[start, -1], [end, 1]]) for (let extension = 0; extension < Math.ceil(thicknessPixels); extension++) {
      const x = Math.round(p.x + sign * ux), y = Math.round(p.y + sign * uy);
      if (x < 0 || y < 0 || x >= width || y >= height || !mask[y * width + x]) break;
      p.x += sign * ux;
      p.y += sign * uy;
    }
    if (bands.some((b) => {
      const a = project2(start, b.start, b.end), z = project2(end, b.start, b.end);
      return a.distance < 2 && z.distance < 2 && Math.min(a.t, z.t) >= -0.02 && Math.max(a.t, z.t) <= 1.02;
    })) continue;
    const boundarySourceIds = ink.filter((b) => {
      if (b.colorEvidence) return false;
      const a = project2(start, b.start, b.end), z = project2(end, b.start, b.end);
      return Math.abs(cross2(sub(end, start), sub(b.end, b.start))) / (dist(start, end) * dist(b.start, b.end)) < 0.012 && a.distance < thicknessPixels / 2 + 2 && z.distance < thicknessPixels / 2 + 2 && Math.min(a.t, z.t) >= -0.05 && Math.max(a.t, z.t) <= 1.05;
    }).map((s2) => s2.id);
    bands.push({ id: `solid_band${bands.length + 1}`, start: round(start), end: round(end), lengthPixels: Math.round(dist(start, end)), thicknessPixels, boundarySourceIds, centerlineEvidence: true, support: "measured_solid_band" });
  }
  ink.push(...bands);
  const candidates = ink.map((s) => ({ ...s, sourceIds: [s.id, ...s.boundarySourceIds || []], kind: s.centerlineEvidence ? "solid_band" : "stroke" }));
  const maxThickness = Math.max(12, scalePixels * 0.035), sourceCuts = new Map(ink.map((s) => [s.id, [0, 1]])), pairOptions = [];
  for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length; j++) {
    const a = ink[i], b = ink[j], u = sub(a.end, a.start), v = sub(b.end, b.start), length = dist(a.start, a.end);
    if (a.centerlineEvidence || b.centerlineEvidence) continue;
    if (Math.abs(cross2(u, v)) / (length * dist(b.start, b.end)) > 0.012) continue;
    const separation = project2(b.start, a.start, a.end).distance;
    if (separation < 3 || separation > maxThickness) continue;
    const t0 = project2(b.start, a.start, a.end).t, t1 = project2(b.end, a.start, a.end).t, lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    if ((hi - lo) * length < 0.8 * Math.min(length, dist(b.start, b.end))) continue;
    const aa = at(a.start, a.end, lo), ab = at(a.start, a.end, hi), ba = at(b.start, b.end, project2(aa, b.start, b.end).t), bb = at(b.start, b.end, project2(ab, b.start, b.end).t);
    pairOptions.push({ candidate: { id: `pair${i + 1}_${j + 1}`, kind: "face_pair", start: round(at(aa, ba, 0.5)), end: round(at(ab, bb, 0.5)), sourceIds: [a.id, b.id], thicknessPixels: Math.round(separation * 100) / 100, support: "two_observed_faces" }, score: (hi - lo) * length / (1 + separation), a, b, lo, hi, ba, bb });
  }
  const preferred = new Map(ink.map((s) => [s.id, pairOptions.filter((p) => p.candidate.sourceIds.includes(s.id)).sort((a, b) => b.score - a.score).slice(0, 2)]));
  for (const pair of pairOptions) {
    const { a, b, lo, hi, ba, bb } = pair;
    if (!preferred.get(a.id).includes(pair) || !preferred.get(b.id).includes(pair)) continue;
    const c = pair.candidate, length = dist(c.start, c.end), nx = -(c.end.y - c.start.y) / length, ny = (c.end.x - c.start.x) / length;
    let filled = 0, total = 0;
    for (const t of [0.15, 0.35, 0.65, 0.85]) {
      const p = at(c.start, c.end, t);
      for (let n = -Math.floor(c.thicknessPixels / 2); n <= Math.floor(c.thicknessPixels / 2); n++) {
        const x = Math.round(p.x + nx * n), y = Math.round(p.y + ny * n);
        if (x >= 0 && y >= 0 && x < width && y < height) {
          total++;
          filled += mask[y * width + x];
        }
      }
    }
    c.filledBandRatio = Math.round(100 * filled / Math.max(1, total)) / 100;
    candidates.push(pair.candidate);
    sourceCuts.get(a.id).push(lo, hi);
    sourceCuts.get(b.id).push(project2(ba, b.start, b.end).t, project2(bb, b.start, b.end).t);
  }
  for (const source2 of ink) {
    const cuts = [...new Set(sourceCuts.get(source2.id).map((t) => Math.round(Math.max(0, Math.min(1, t)) * 1e4) / 1e4))].sort((a, b) => a - b);
    if (cuts.length === 2) continue;
    for (let i = 1; i < cuts.length; i++) {
      if ((cuts[i] - cuts[i - 1]) * source2.lengthPixels < 12) continue;
      candidates.push({ id: `${source2.id}_part${i}`, kind: "stroke_fragment", start: round(at(source2.start, source2.end, cuts[i - 1])), end: round(at(source2.start, source2.end, cuts[i])), sourceIds: [source2.id], support: "observed_ink_fragment" });
    }
  }
  if (candidates.length > 700) throw error("PIXEL_GRAPH_TOO_COMPLEX", "Too many alternative wall candidates; no paid classification started.", { candidateCount: candidates.length, inkCount: ink.length });
  const gaps = [];
  for (const wall of candidates.filter((c) => c.kind === "face_pair")) {
    const length = dist(wall.start, wall.end), dx = (wall.end.x - wall.start.x) / length, dy = (wall.end.y - wall.start.y) / length, half = wall.thicknessPixels / 2, samples = Math.floor(length), fill = [];
    for (let i = 0; i <= samples; i++) {
      const p = at(wall.start, wall.end, i / samples);
      let dark = 0, count = 0;
      for (let n = -Math.ceil(half); n <= Math.ceil(half); n++) {
        const x = Math.round(p.x - dy * n), y = Math.round(p.y + dx * n);
        if (x >= 0 && x < width && y >= 0 && y < height) {
          dark += mask[y * width + x];
          count++;
        }
      }
      fill.push(count ? dark / count : 0);
    }
    const sparse = [];
    let begin = -1;
    for (let i = 0; i <= fill.length; i++) {
      if (i < fill.length && fill[i] < 0.5) {
        if (begin < 0) begin = i;
      } else if (begin >= 0) {
        const low = begin, high = i - 1;
        begin = -1;
        if (high - low < 14 || low < 8 || high > samples - 8) continue;
        const before = fill.slice(Math.max(0, low - 12), low).filter((v) => v >= 0.6).length, after = fill.slice(high + 1, high + 13).filter((v) => v >= 0.6).length;
        if (before >= 6 && after >= 6) sparse.push([low / samples, high / samples]);
      }
    }
    if (!sparse.length) continue;
    const solids = [];
    let last = 0;
    for (const [low, high] of sparse) {
      solids.push([last, low]);
      last = high;
    }
    solids.push([last, 1]);
    const pieces = solids.map(([low, high], i) => ({ id: `${wall.id}_solid${i + 1}`, kind: "observed_wall_fragment", start: round(at(wall.start, wall.end, low)), end: round(at(wall.start, wall.end, high)), sourceIds: wall.sourceIds, thicknessPixels: wall.thicknessPixels, support: "filled_source_wall_band" }));
    candidates.push(...pieces);
    sparse.forEach(([low, high], i) => gaps.push({ id: `frame_gap${gaps.length + 1}`, a: pieces[i].id, b: pieces[i + 1].id, start: round(at(wall.start, wall.end, low)), end: round(at(wall.start, wall.end, high)), lengthPixels: Math.round((high - low) * length), support: "thin_frame_between_solid_jambs" }));
  }
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    if (a.sourceIds.some((id) => b.sourceIds.includes(id))) continue;
    if (project2(b.start, a.start, a.end).distance > 2.5 || project2(b.end, a.start, a.end).distance > 2.5) continue;
    const options = [[a.start, b.start], [a.start, b.end], [a.end, b.start], [a.end, b.end]].sort((p, q) => dist(...p) - dist(...q)), [start, end] = options[0], length = dist(start, end);
    if (length < 6 || length > scalePixels * 0.4) continue;
    const ta = project2(start, a.start, a.end).t, tb = project2(end, a.start, a.end).t;
    if (Math.min(ta, tb) < 1 - 0.01 && Math.max(ta, tb) > 0.01 && tb >= 0 && tb <= 1) continue;
    gaps.push({ id: `gap${gaps.length + 1}`, a: a.id, b: b.id, start, end, lengthPixels: Math.round(length), support: "opening_hypothesis_not_wall" });
  }
  if (candidates.length > 700 || gaps.length > 700) throw error("PIXEL_GRAPH_TOO_COMPLEX", "Opening hypotheses exceed the classification budget; nothing was truncated.");
  return { version: PIXEL_GRAPH_VERSION, imageWidth: width, imageHeight: height, contentExtent, ink, candidates, gaps };
}
function assemblePixelTopology(graph, selection) {
  const map = new Map(graph.candidates.map((s) => [s.id, s])), chosen = /* @__PURE__ */ new Set(), lines = [];
  for (const item of selection.walls || []) {
    const s = map.get(item.candidateId);
    if (!s || chosen.has(s.id)) throw error("INVALID_PIXEL_SELECTION", "Unknown or duplicate wall candidate.", { id: item.candidateId });
    chosen.add(s.id);
    if (!["external", "internal"].includes(item.type)) throw error("INVALID_PIXEL_SELECTION", "Wall classification is missing.");
    lines.push({ ...s, type: item.type });
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) for (const id of lines[i].sourceIds.filter((id2) => lines[j].sourceIds.includes(id2))) {
    const source2 = graph.ink.find((s) => s.id === id);
    if (!source2) throw error("OVERLAPPING_PIXEL_SELECTION", "Two selected alternatives share unknown source ink.");
    const interval = (line) => [project2(line.start, source2.start, source2.end).t, project2(line.end, source2.start, source2.end).t].sort((a2, b2) => a2 - b2), a = interval(lines[i]), b = interval(lines[j]);
    if ((Math.min(a[1], b[1]) - Math.max(a[0], b[0])) * dist(source2.start, source2.end) > 2) throw error("OVERLAPPING_PIXEL_SELECTION", "A stroke and a wall-face alternative cannot duplicate the same source span.", { ids: [lines[i].id, lines[j].id] });
  }
  const openings = [];
  for (const item of selection.openings || []) {
    const gap = graph.gaps.find((g) => g.id === item.gapId);
    if (!gap || openings.some((o) => o.id === gap.id) || !["door", "window"].includes(item.type)) throw error("INVALID_PIXEL_OPENING", "An opening must have selected source wall hosts.", { id: item.gapId });
    let hosts;
    if (gap.support === "observed_arc_and_leaf") {
      if (item.type !== "door") throw error("INVALID_PIXEL_OPENING", "A source door arc cannot become a window.");
      const start = gap.endpointHosts.start.filter((id) => chosen.has(id)), end = gap.endpointHosts.end.filter((id) => chosen.has(id));
      hosts = [.../* @__PURE__ */ new Set([...start, ...end])].map((id) => lines.find((s) => s.id === id));
      const u = sub(gap.end, gap.start), parallel = hosts.some((h) => {
        const v = sub(h.end, h.start);
        return Math.abs(cross2(u, v)) / (dist(gap.start, gap.end) * dist(h.start, h.end)) < 0.05;
      });
      if (!hosts.length || !parallel && (!start.length || !end.length)) throw error("INVALID_PIXEL_OPENING", "A discovered door needs a selected parallel host or selected wall junctions at both jambs.", { id: item.gapId });
    } else {
      if (!chosen.has(gap.a) || !chosen.has(gap.b)) throw error("INVALID_PIXEL_OPENING", "An opening must join two selected, observed collinear wall segments.", { id: item.gapId });
      hosts = [lines.find((s) => s.id === gap.a), lines.find((s) => s.id === gap.b)];
    }
    if (hosts.some((h) => h.type !== hosts[0].type)) throw error("INVALID_PIXEL_OPENING", "Opening hosts disagree.");
    lines.push({ ...gap, type: hosts[0].type, kind: "opening", id: gap.id });
    openings.push({ ...gap, type: item.type, hingeSide: gap.sourceDoor?.hingeSide || item.hingeSide || "unknown", swingDirection: gap.sourceDoor?.swingDirection || item.swingDirection || "unknown" });
  }
  if (lines.length < 3) throw error("INCOMPLETE_PIXEL_SELECTION", "Fewer than three supported wall runs were selected.");
  const tolerance = Math.max(2, Math.min(6, Math.max((graph.contentExtent?.scalePixels || Math.min(graph.imageWidth, graph.imageHeight)) * 4e-3, ...lines.map((s) => (s.thicknessPixels || 0) / 2))));
  const cuts = lines.map((s) => [{ t: 0, p: s.start }, { t: 1, p: s.end }]);
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j], u = sub(a.end, a.start), v = sub(b.end, b.start), den = cross2(u, v);
    if (Math.abs(den) > 1e-7) {
      const d = sub(b.start, a.start), t = cross2(d, v) / den, q = cross2(d, u) / den;
      if (t >= -tolerance / dist(a.start, a.end) && t <= 1 + tolerance / dist(a.start, a.end) && q >= -tolerance / dist(b.start, b.end) && q <= 1 + tolerance / dist(b.start, b.end)) {
        const p = at(a.start, a.end, t);
        cuts[i].push({ t, p });
        cuts[j].push({ t: q, p });
      }
    }
    for (const [p, k, l] of [[a.start, j, i], [a.end, j, i], [b.start, i, j], [b.end, i, j]]) {
      const segment = lines[k], q = project2(p, segment.start, segment.end);
      if (q.t >= 0 && q.t <= 1 && q.distance <= tolerance) {
        const value = at(segment.start, segment.end, q.t);
        cuts[k].push({ t: q.t, p: value });
        cuts[l].push({ t: dist(p, lines[l].start) < 1e-6 ? 0 : 1, p: value });
      }
    }
  }
  const nodes = [], edges2 = [], node = (p) => {
    let i = nodes.findIndex((n) => dist(n, p) <= tolerance);
    if (i < 0) {
      i = nodes.length;
      nodes.push({ id: `node${i + 1}`, ...round(p) });
    }
    return i;
  };
  for (let i = 0; i < lines.length; i++) {
    const sorted = cuts[i].sort((a, b) => a.t - b.t);
    for (let j = 1; j < sorted.length; j++) {
      const a = node(sorted[j - 1].p), b = node(sorted[j].p);
      if (a === b || edges2.some((e) => e.a === a && e.b === b || e.a === b && e.b === a)) continue;
      edges2.push({ id: `edge${edges2.length + 1}`, a, b, sourceId: lines[i].id, type: lines[i].type, opening: lines[i].kind === "opening" });
    }
  }
  const adjacency = nodes.map(() => []);
  edges2.forEach((e, i) => {
    adjacency[e.a].push({ to: e.b, index: i });
    adjacency[e.b].push({ to: e.a, index: i });
  });
  adjacency.forEach((list2, i) => list2.sort((a, b) => Math.atan2(nodes[a.to].y - nodes[i].y, nodes[a.to].x - nodes[i].x) - Math.atan2(nodes[b.to].y - nodes[i].y, nodes[b.to].x - nodes[i].x)));
  const faceAdjacency = adjacency.map((list2) => [...list2]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < faceAdjacency.length; i++) if (faceAdjacency[i].length === 1) {
      const other = faceAdjacency[i][0].to;
      faceAdjacency[i] = [];
      faceAdjacency[other] = faceAdjacency[other].filter((e) => e.to !== i);
      changed = true;
    }
  }
  const seen = /* @__PURE__ */ new Set(), cycles = [];
  for (let i = 0; i < nodes.length; i++) for (const adjacent of faceAdjacency[i]) {
    const first = `${i}:${adjacent.to}`;
    if (seen.has(first)) continue;
    let a = i, b = adjacent.to, points = [], ids = [], closed = false;
    for (let steps = 0; steps < edges2.length * 2 + 2; steps++) {
      const key2 = `${a}:${b}`;
      if (seen.has(key2)) {
        closed = key2 === first;
        break;
      }
      seen.add(key2);
      points.push(nodes[a]);
      ids.push(a);
      const list2 = faceAdjacency[b], reverse = list2.findIndex((e) => e.to === a), next = list2[(reverse + list2.length - 1) % list2.length];
      if (!next) break;
      [a, b] = [b, next.to];
    }
    if (closed && points.length >= 3 && new Set(ids).size === ids.length && Math.abs(area2(points)) > 16) cycles.push({ polygon: points.map(({ x, y }) => ({ x, y })), signedArea: area2(points) });
  }
  const exterior = cycles.filter((f) => f.signedArea < 0).sort((a, b) => a.signedArea - b.signedArea)[0];
  const regions = cycles.filter((f) => f.signedArea > 0).map((f, i) => ({ id: `region${i + 1}`, polygon: f.polygon, areaPixels: f.signedArea }));
  if (!exterior || !regions.length) throw error("OPEN_PIXEL_TOPOLOGY", "Selected pixel segments do not enclose usable floor regions. Missing walls/openings must be reviewed, not filled with a bounding box.", { nodeCount: nodes.length, edgeCount: edges2.length });
  return { nodes, edges: edges2, regions, enclosures: cycles.filter((f) => f.signedArea < 0).map((f, i) => ({ id: `symbol${i + 1}`, polygon: [...f.polygon].reverse() })), footprint: [...exterior.polygon].reverse(), lines, openings };
}
function pixelCandidateLabelAnchor(candidate, viewport) {
  let low = 0, high = 1;
  const { start: a, end: b } = candidate;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, viewport.left, viewport.right], [a.y, b.y - a.y, viewport.top, viewport.bottom]]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const p = (min - origin) / delta, q = (max - origin) / delta;
    low = Math.max(low, Math.min(p, q));
    high = Math.min(high, Math.max(p, q));
    if (low > high) return null;
  }
  return at(a, b, (low + high) / 2);
}
function pixelGraphOverlay(graph, { layer = "source", viewport = { left: 0, top: 0, right: graph.imageWidth, bottom: graph.imageHeight } } = {}) {
  const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const occupied = [];
  const segments = graph.candidates.filter((c) => layer === "all" || (layer === "alternatives" ? !["stroke", "solid_band"].includes(c.kind) : ["stroke", "solid_band"].includes(c.kind))).map((c) => {
    const anchor = pixelCandidateLabelAnchor(c, viewport);
    if (!anchor) return "";
    const width = Math.min(viewport.right - viewport.left - 4, String(c.id).length * 6 + 4);
    let label;
    for (let step = 0; step < 100; step++) {
      const offset = step === 0 ? -4 : (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 14;
      const x = Math.max(viewport.left + 2, Math.min(viewport.right - width - 2, anchor.x)), y = Math.max(viewport.top + 12, Math.min(viewport.bottom - 2, anchor.y + offset));
      const box = { left: x, right: x + width, top: y - 11, bottom: y + 2 };
      if (!occupied.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)) {
        label = { x, y, box };
        break;
      }
    }
    label ??= { x: Math.max(viewport.left + 2, Math.min(viewport.right - width - 2, anchor.x)), y: Math.max(viewport.top + 12, Math.min(viewport.bottom - 2, anchor.y - 4)) };
    if (label.box) occupied.push(label.box);
    return `<g stroke="${c.kind === "solid_band" ? "#e08012" : "#087bbf"}"><path d="M${c.start.x} ${c.start.y}L${c.end.x} ${c.end.y}"/><path d="M${anchor.x} ${anchor.y}L${label.x} ${label.y}" stroke-width=".5"/><text x="${label.x}" y="${label.y}" fill="#075a8a" stroke="white" stroke-width="2" paint-order="stroke" font-size="10">${esc(c.id)}</text></g>`;
  }).join("");
  const doors = graph.gaps.filter((g) => g.sourceDoor).map((g) => {
    const d = g.sourceDoor, h = d.start, dx = d.end.x - h.x, dy = d.end.y - h.y, theta = (d.swingDirection === "clockwise" ? 1 : -1) * d.angleDegrees * Math.PI / 180, tip = { x: h.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: h.y + dx * Math.sin(theta) + dy * Math.cos(theta) };
    return `<g stroke="#008030" stroke-width="2"><path d="M${h.x} ${h.y}L${d.end.x} ${d.end.y}M${h.x} ${h.y}L${tip.x} ${tip.y}M${d.end.x} ${d.end.y}A${d.widthPixels} ${d.widthPixels} 0 0 ${theta > 0 ? 1 : 0} ${tip.x} ${tip.y}"/><circle cx="${h.x}" cy="${h.y}" r="3" fill="#008030"/><text x="${h.x + 4}" y="${h.y - 6}" fill="#008030" stroke="white" stroke-width="2" paint-order="stroke" font-size="13">${esc(g.id)}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.imageWidth}" height="${graph.imageHeight}" viewBox="0 0 ${graph.imageWidth} ${graph.imageHeight}"><g fill="none" stroke-width="1.2" font-family="sans-serif">${segments}${doors}</g></svg>`;
}

// src/lib/rasterSpaceSemantics.mjs
var RASTER_SPACE_POLICY_VERSION = "hatch-context-v1";
function inferRasterRoomUse({ sourceText = "", fixtures = [] } = {}) {
  const normalized2 = String(sourceText).normalize("NFKC").replace(/[يى]/g, "\u06CC").replace(/ك/g, "\u06A9").replace(/\u200c/g, " ").trim().toLowerCase();
  const rules = [
    ["bathroom", /(?:^|\b)(?:b\s*\.?\s*r\s*\.?|bath\s*room|bathroom|bath|toilet|w\.?c\.?)(?:\b|$)|حمام|دستشویی|سرویس(?:\s+بهداشتی)?|دورة\s*المیاه/iu],
    ["bedroom", /bed\s*room|bedroom|master(?:\s+room|\s+bedroom)?|اتاق\s*خواب|مستر|غرفة\s*نوم/iu],
    ["kitchen", /kitchen|آشپزخانه|آشپز\s*خانه|مطبخ/iu],
    ["living", /living(?:\s*room)?|lounge|پذیرایی|نشیمن|هال|غرفة\s*معیشة/iu],
    ["laundry", /laundry|landry|رختشویخانه|رختشوی\s*خانه|غرفة\s*غسیل/iu],
    ["wardrobe", /wardrobe|closet|dressing|کمد|رختکن|خزانة/iu],
    ["balcony", /balcony|terrace|بالکن|تراس|شرفة/iu],
    ["stair", /stair|پله|درج/iu],
    ["corridor", /corridor|hallway|راهرو|ممر/iu]
  ];
  const matches = rules.filter(([, pattern]) => pattern.test(normalized2)).map(([type]) => type);
  if (matches.length === 1) return { type: matches[0], basis: "source_text", text: sourceText, needsReview: false };
  if (matches.length > 1) return { type: "other", basis: "conflicting_source_text", text: sourceText, needsReview: true };
  if (/^(?:room|اتاق|غرفة)$/iu.test(normalized2)) return { type: fixtures.includes("bed") ? "bedroom" : "room", basis: fixtures.includes("bed") ? "source_text_and_fixtures" : "source_text", text: sourceText, needsReview: fixtures.includes("bed") };
  const found = new Set(fixtures), types = [];
  if (found.has("toilet") || found.has("shower") || found.has("bathtub")) types.push("bathroom");
  if (found.has("bed")) types.push("bedroom");
  if (found.has("kitchen_cabinets") || found.has("hob") || found.has("oven")) types.push("kitchen");
  if (found.has("sofa") && !found.has("bed")) types.push("living");
  if (found.has("washing_machine") && !types.includes("bathroom") && !types.includes("kitchen")) types.push("laundry");
  if (types.length === 1) return { type: types[0], basis: "source_fixtures", text: sourceText, needsReview: true };
  return { type: "other", basis: types.length ? "conflicting_fixtures" : "insufficient_evidence", text: sourceText, needsReview: true };
}
function interpretRasterSpace(space) {
  const marked = ["hatch", "cross", "solid_fill"].includes(space?.pattern);
  const explicit = String(space?.explicitUse || "unknown");
  const enclosed = space?.enclosed === true;
  if (["shaft", "void", "courtyard", "lift_void"].includes(explicit)) return { role: "void", removeFloor: true, reason: "explicit_void_use" };
  if (explicit === "wardrobe") return { role: "wardrobe", removeFloor: false, reason: "explicit_wardrobe_use" };
  if (explicit === "room") return { role: "room", removeFloor: false, reason: "recognised_use" };
  if (marked && space?.context === "bedroom" && space?.details === "none") return { role: "wardrobe", removeFloor: false, reason: "bedroom_storage_pattern" };
  if (enclosed && marked && space?.details === "none" && ["entrance", "stair_core", "circulation", "unassigned"].includes(space?.context)) return { role: "void", removeFloor: true, reason: "enclosed_marked_core_without_details" };
  if (["room", "stair", "shower", "furniture"].includes(explicit)) return { role: explicit, removeFloor: false, reason: "recognised_use" };
  return { role: "unresolved", removeFloor: false, reason: "pattern_requires_context" };
}

// src/lib/rasterGraphCompiler.mjs
var distance2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var key = (p) => `${p.x},${p.y}`;
var fail2 = (code, message, details = {}) => {
  throw Object.assign(Error(message), { name: "PixelGraphError", code, details });
};
function containsPoint(point3, polygon3) {
  let inside5 = false;
  for (let i = 0, j = polygon3.length - 1; i < polygon3.length; j = i++) {
    const a = polygon3[i], b = polygon3[j];
    if (a.y > point3.y !== b.y > point3.y && point3.x < (b.x - a.x) * (point3.y - a.y) / (b.y - a.y) + a.x) inside5 = !inside5;
  }
  return inside5;
}
function pixelGraphAnchors(graph, topology) {
  const points = [...topology.nodes, ...graph.ink.flatMap((s) => [s.start, s.end])], unique6 = [];
  for (const p of points) if (!unique6.some((q) => distance2(p, q) < 0.05)) unique6.push({ id: `anchor${unique6.length + 1}`, x: p.x, y: p.y });
  return unique6;
}
function unionBoundaries(polygons) {
  const edges2 = /* @__PURE__ */ new Map(), removed = /* @__PURE__ */ new Set();
  for (const p of polygons) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], k = `${key(a)}>${key(b)}`, reverse = `${key(b)}>${key(a)}`;
    if (edges2.has(reverse)) {
      edges2.delete(reverse);
      removed.add(k);
      removed.add(reverse);
    } else edges2.set(k, { a, b });
  }
  if (!edges2.size) fail2("INVALID_STORAGE_PARENT", "Storage and parent do not form a usable floor.");
  const start = [...edges2.values()][0].a, polygon3 = [];
  let next = start;
  for (let i = 0; i <= edges2.size; i++) {
    polygon3.push(next);
    const options = [...edges2.values()].filter((e) => key(e.a) === key(next));
    if (options.length !== 1) fail2("INVALID_STORAGE_PARENT", "Storage must share an unambiguous boundary with its parent room.");
    next = options[0].b;
    if (key(next) === key(start)) break;
  }
  if (polygon3.length !== edges2.size || key(next) !== key(start)) fail2("INVALID_STORAGE_PARENT", "Storage must be adjacent to its parent room, not a separate nested polygon.");
  return { polygon: polygon3, removed };
}
function wallRuns(topology, removed) {
  const edges2 = topology.edges.filter((e) => !removed.has(`${key(topology.nodes[e.a])}>${key(topology.nodes[e.b])}`));
  const parent = edges2.map((_, i) => i), find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
  for (let i = 0; i < edges2.length; i++) for (let j = i + 1; j < edges2.length; j++) {
    const a = edges2[i], b = edges2[j];
    if (a.type !== b.type || ![a.a, a.b].some((n) => n === b.a || n === b.b)) continue;
    const p = topology.nodes[a.a], q = topology.nodes[a.b], r = topology.nodes[b.a], s = topology.nodes[b.b];
    const cosine = Math.abs(((q.x - p.x) * (s.x - r.x) + (q.y - p.y) * (s.y - r.y)) / (distance2(p, q) * distance2(r, s)));
    if (cosine > 0.9998) parent[find(j)] = find(i);
  }
  const groups = /* @__PURE__ */ new Map();
  edges2.forEach((e, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  });
  const walls = [], openings = [];
  for (const group of groups.values()) {
    const pts = [...new Set(group.flatMap((e) => [e.a, e.b]))].map((i) => topology.nodes[i]), longest = group.reduce((a, b) => distance2(topology.nodes[a.a], topology.nodes[a.b]) > distance2(topology.nodes[b.a], topology.nodes[b.b]) ? a : b);
    const p = topology.nodes[longest.a], q = topology.nodes[longest.b], dx = q.x - p.x, dy = q.y - p.y;
    pts.sort((a, b) => (a.x - b.x) * dx + (a.y - b.y) * dy);
    const wall = { id: `wall${walls.length + 1}`, type: group[0].type, start: { x: pts[0].x, y: pts[0].y }, end: { x: pts.at(-1).x, y: pts.at(-1).y } };
    walls.push(wall);
    for (const source2 of topology.openings) {
      const relevant = group.filter((e) => e.sourceId === source2.id);
      if (!relevant.length) continue;
      const ends = [...new Set(relevant.flatMap((e) => [e.a, e.b]))].map((i) => topology.nodes[i]).sort((a, b) => (a.x - b.x) * dx + (a.y - b.y) * dy);
      if (openings.some((o) => o.id === source2.id)) fail2("SPLIT_PIXEL_OPENING", "A source opening cannot belong to two noncollinear wall runs.");
      openings.push({ id: source2.id, type: source2.type, wallId: wall.id, start: { x: ends[0].x, y: ends[0].y }, end: { x: ends.at(-1).x, y: ends.at(-1).y }, heightMeters: null, sillHeightMeters: null, hingeSide: source2.hingeSide, swingDirection: source2.swingDirection });
    }
  }
  if (openings.length !== topology.openings.length) fail2("LOST_PIXEL_OPENING", "A classified source opening was lost during wall assembly.");
  return { walls, openings };
}
function compileClassifiedPixelGraph(graph, selection, semantics, providedTopology) {
  const topology = providedTopology || assemblePixelTopology(graph, selection), regionMap = new Map(topology.regions.map((r) => [r.id, r])), classifications = /* @__PURE__ */ new Map();
  for (const item of semantics.regions || []) {
    if (!regionMap.has(item.regionId) || classifications.has(item.regionId)) fail2("INVALID_REGION_SELECTION", "Unknown or duplicate region classification.", { regionId: item.regionId });
    const use = inferRasterRoomUse({ sourceText: item.sourceText ?? item.name, fixtures: item.fixtures || [] }), resolved = { ...item, useEvidence: use };
    if (!["other"].includes(use.type)) {
      resolved.type = use.type;
      resolved.context = use.type === "room" ? "unassigned" : use.type === "wardrobe" ? "bedroom" : use.type === "stair" ? "stair_core" : use.type;
      resolved.explicitUse = use.type === "wardrobe" ? "wardrobe" : use.type === "stair" ? "stair" : "room";
    } else if (item.explicitUse === "room" || item.pattern === "none") {
      resolved.type = "other";
      resolved.explicitUse = "room";
    }
    classifications.set(item.regionId, { ...resolved, interpretation: interpretRasterSpace({ ...resolved, enclosed: true }) });
  }
  if (classifications.size !== regionMap.size) fail2("INCOMPLETE_REGION_CLASSIFICATION", "Every enclosed source region must be classified or explicitly left unresolved.");
  const rooms = [], holes = [], storage = [], removed = /* @__PURE__ */ new Set(), merged = /* @__PURE__ */ new Set();
  for (const item of classifications.values()) {
    const region = regionMap.get(item.regionId), role = item.interpretation.role;
    if (role === "void") {
      holes.push({ id: item.regionId, type: item.explicitUse === "courtyard" ? "courtyard" : "shaft", polygon: region.polygon });
      continue;
    }
    if (role === "wardrobe" || role === "furniture") {
      const parent = classifications.get(item.parentRegionId);
      if (!parent || parent.interpretation.role !== "room" || role === "wardrobe" && parent.context !== "bedroom") fail2("INVALID_STORAGE_PARENT", "A wardrobe must belong to an adjacent bedroom; it cannot remove floor or become a stand-alone room.", { regionId: item.regionId, parentRegionId: item.parentRegionId });
      storage.push({ regionId: item.regionId, parentRegionId: item.parentRegionId, role, polygon: region.polygon, architectural: true });
      continue;
    }
    if (role === "unresolved" || item.type === "unresolved") fail2("UNRESOLVED_PIXEL_REGION", "An enclosed region is not understood; no complete model was accepted.", { regionId: item.regionId });
  }
  for (const item of classifications.values()) {
    if (item.interpretation.role !== "room" && item.interpretation.role !== "stair" && item.interpretation.role !== "shower") continue;
    const children = storage.filter((s) => s.parentRegionId === item.regionId && s.architectural), polygons = [regionMap.get(item.regionId).polygon, ...children.map((s) => s.polygon)];
    let polygon3 = polygons[0];
    if (children.length) {
      const result = unionBoundaries(polygons);
      polygon3 = result.polygon;
      for (const edge of result.removed) removed.add(edge);
      children.forEach((c) => merged.add(c.regionId));
    }
    rooms.push({ id: item.regionId, name: item.name, type: item.type, polygon: polygon3 });
  }
  if (storage.some((s) => !merged.has(s.regionId))) fail2("INVALID_STORAGE_PARENT", "Storage floor was not merged into its parent.");
  const symbolMap = new Map((topology.symbolEnclosures || []).map((s) => [s.id, s])), seenSymbols = /* @__PURE__ */ new Set();
  for (const symbol of semantics.symbols || []) {
    const enclosure = symbolMap.get(symbol.enclosureId), parent = classifications.get(symbol.parentRegionId), room = rooms.find((r) => r.id === symbol.parentRegionId);
    if (!enclosure || seenSymbols.has(symbol.enclosureId) || !parent || !room) fail2("INVALID_SYMBOL_PARENT", "A source furniture enclosure needs a real parent room.");
    seenSymbols.add(symbol.enclosureId);
    if (!enclosure.polygon.every((p) => containsPoint(p, room.polygon))) fail2("STORAGE_OUTSIDE_PARENT", "A wardrobe enclosure lies outside its stated room.");
    const interpretation = interpretRasterSpace({ ...symbol, context: parent.context, enclosed: true });
    if (interpretation.role === "void") fail2("FURNITURE_CANNOT_REMOVE_FLOOR", "A furniture symbol cannot remove structural floor.");
    if (interpretation.role === "wardrobe") {
      storage.push({ regionId: enclosure.id, parentRegionId: room.id, role: "wardrobe", polygon: enclosure.polygon, architectural: false });
      classifications.set(enclosure.id, { ...symbol, regionId: enclosure.id, name: symbol.sourceText || "Wardrobe", interpretation });
    }
  }
  if (seenSymbols.size !== symbolMap.size) fail2("INCOMPLETE_SYMBOL_CLASSIFICATION", "A closed furniture enclosure was not interpreted.");
  if (!rooms.length) fail2("INCOMPLETE_PIXEL_SELECTION", "No usable floor room was classified.");
  const anchors = pixelGraphAnchors(graph, topology), anchorMap = new Map(anchors.map((a) => [a.id, a]));
  const measurements = (semantics.measurements || []).map((m, i) => {
    const a = anchorMap.get(m.startAnchorId), b = anchorMap.get(m.endAnchorId);
    if (!a || !b || a.id === b.id) fail2("INVALID_MEASUREMENT_ANCHOR", "A dimension must use two distinct source-pixel anchors.");
    return { id: `measurement${i + 1}`, text: m.text, axis: Math.abs(a.x - b.x) < 0.5 ? "vertical" : Math.abs(a.y - b.y) < 0.5 ? "horizontal" : "aligned", start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, meters: m.meters };
  });
  if (!measurements.length) fail2("MISSING_SCALE_EVIDENCE", "No readable anchored dimension was classified.");
  const { walls, openings } = wallRuns(topology, removed);
  const trace = { coordinateSpace: "image_pixels", imageWidth: graph.imageWidth, imageHeight: graph.imageHeight, title: semantics.title || "Source-pixel floor plan", confidence: semantics.confidence, wallHeightMeters: semantics.wallHeightMeters ?? null, footprint: topology.footprint, rooms, holes, walls, openings, measurements };
  return { trace, topology, spacePolicyVersion: RASTER_SPACE_POLICY_VERSION, spaceInterpretations: [...classifications.values()], storage };
}
function sourceStorageAssets(compiled, scene) {
  const footprint = compiled.trace.footprint, minX = Math.min(...footprint.map((p) => p.x)), maxX = Math.max(...footprint.map((p) => p.x)), minY = Math.min(...footprint.map((p) => p.y)), maxY = Math.max(...footprint.map((p) => p.y));
  const assets = [];
  for (const storage of compiled.storage.filter((s) => s.role === "wardrobe")) {
    const polygon3 = storage.polygon.map((p) => ({ x: (p.x - minX) * scene.width / (maxX - minX), y: (maxY - p.y) * scene.depth / (maxY - minY) }));
    let best;
    for (let i = 0; i < polygon3.length; i++) {
      const a = polygon3[i], b = polygon3[(i + 1) % polygon3.length], angle = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(angle), s = Math.sin(angle), x2 = polygon3.map((p) => p.x * c + p.y * s), y2 = polygon3.map((p) => -p.x * s + p.y * c), loX = Math.min(...x2), hiX = Math.max(...x2), loY = Math.min(...y2), hiY = Math.max(...y2), area4 = (hiX - loX) * (hiY - loY);
      if (!best || area4 < best.area) best = { area: area4, angle, c, s, loX, hiX, loY, hiY };
    }
    const measuredArea = Math.abs(polygon3.reduce((sum, p, i) => {
      const q = polygon3[(i + 1) % polygon3.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2);
    if (!best || best.area <= 0 || Math.abs(best.area - measuredArea) > Math.max(2e-3, measuredArea * 0.01)) continue;
    const x = (best.loX + best.hiX) / 2, y = (best.loY + best.hiY) / 2;
    assets.push({ id: `source-${storage.regionId}`, type: "wardrobe", roomId: storage.parentRegionId, xMeters: x * best.c - y * best.s, yMeters: x * best.s + y * best.c, width: best.hiX - best.loX, depth: best.hiY - best.loY, height: Math.min(2.2, scene.height * 0.9), rotation: best.angle * 180 / Math.PI, placementSource: "source_pixel_graph", heightSource: "design_default_not_measured", sourceRegionId: storage.regionId });
  }
  return assets;
}

// src/lib/rasterDoorSymbols.mjs
var distance3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var rotate = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
function inside2(p, polygon3) {
  let value = false;
  for (let i = 0, j = polygon3.length - 1; i < polygon3.length; j = i++) {
    const a = polygon3[i], b = polygon3[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) value = !value;
  }
  return value;
}
function inspectRasterDoorSymbol(opening, evidence) {
  const { width, height, mask, tone, symbolMask } = evidence, w = distance3(opening.start, opening.end), tolerance = Math.max(1, Math.min(4, Math.round(w * 0.035)));
  const ink = (x, y) => {
    const xx = Math.round(x), yy = Math.round(y);
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) return false;
    const i = yy * width + xx;
    return symbolMask ? !!symbolMask[i] : tone ? tone[i] < 132 : !!mask[i];
  };
  const near4 = (p, r = 1) => {
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (ink(p.x + x, p.y + y)) return true;
    return false;
  };
  if (w < 12 || opening.type !== "door") return { status: "unresolved", hingeSide: "unknown", swingDirection: "unknown", reason: "door_arc_unreadable" };
  const options = [];
  for (const hingeSide of ["start", "end"]) for (const side of [-1, 1]) {
    const jamb = opening[hingeSide], other = opening[hingeSide === "start" ? "end" : "start"], closed = { x: (other.x - jamb.x) / w, y: (other.y - jamb.y) / w }, normal2 = { x: -closed.y, y: closed.x };
    let best2 = null;
    for (const offset of [0, -2, 2, -4, 4]) {
      const hinge = { x: jamb.x + normal2.x * offset, y: jamb.y + normal2.y * offset };
      for (let degrees = 20; degrees <= 160; degrees += 2) {
        const theta = degrees * Math.PI / 180, leaf = rotate(closed, side * theta);
        let leafSupport = 0;
        for (let i = 0; i < 18; i++) {
          const reach = w * (0.18 + 0.7 * i / 17), p = { x: hinge.x + leaf.x * reach, y: hinge.y + leaf.y * reach }, n = { x: -leaf.y, y: leaf.x };
          let dark = 0;
          for (let t = -tolerance - 2; t <= tolerance + 2; t++) if (ink(p.x + n.x * t, p.y + n.y * t)) dark++;
          if (near4(p, tolerance) && dark <= tolerance * 2 + 1) leafSupport++;
        }
        leafSupport /= 18;
        if (leafSupport < 0.78) continue;
        for (const radius of [w - 3, w, w + 3]) {
          let arcSupport = 0;
          for (let i = 0; i < 24; i++) {
            const ray = rotate(closed, side * theta * (0.08 + 0.84 * i / 23)), p = { x: hinge.x + ray.x * radius, y: hinge.y + ray.y * radius };
            if (near4(p, tolerance)) arcSupport++;
          }
          arcSupport /= 24;
          if (arcSupport < 0.58) continue;
          const score = 0.45 * leafSupport + 0.55 * arcSupport;
          if (!best2 || score > best2.score) best2 = { score, leafSupport, arcSupport, hingeSide, side, degrees, hinge, closed };
        }
      }
    }
    if (best2) options.push(best2);
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  if (!best || options[1] && options[1].score > best.score - 0.08) return { status: "unresolved", hingeSide: "unknown", swingDirection: "unknown", reason: best ? "ambiguous_door_arc" : "door_arc_unreadable" };
  const v = rotate(best.closed, best.side * best.degrees * Math.PI / 360);
  return { status: "observed", hingeSide: best.hingeSide, swingDirection: best.side > 0 ? "clockwise" : "counterclockwise", angleDegrees: best.degrees, leafSupport: best.leafSupport, arcSupport: best.arcSupport, sectorPoint: { x: best.hinge.x + v.x * w * 0.45, y: best.hinge.y + v.y * w * 0.45 }, basis: "source_leaf_and_arc" };
}
function applyRasterDoorSymbols(trace, evidence) {
  const walls = new Map(trace.walls.map((w) => [w.id, w]));
  return trace.openings.map((opening) => {
    if (opening.type !== "door") return { ...opening, swingEvidence: { status: "not_applicable" } };
    const wall = walls.get(opening.wallId), dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
    let start = opening.start, end = opening.end;
    if ((end.x - start.x) * dx + (end.y - start.y) * dy < 0) [start, end] = [end, start];
    const measured = inspectRasterDoorSymbol({ ...opening, start, end }, evidence), mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, length = distance3(start, end), n = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
    const adjacent = (trace.rooms || []).filter((r) => [-1, 1].some((side) => inside2({ x: mid.x + n.x * length * 0.15 * side, y: mid.y + n.y * length * 0.15 * side }, r.polygon)));
    const roomDirections = measured.status === "observed" ? adjacent.map((r) => ({ roomId: r.id, direction: inside2(measured.sectorPoint, r.polygon) ? "inward" : "outward" })) : [];
    return { ...opening, start, end, hingeSide: measured.hingeSide, swingDirection: measured.swingDirection, swingEvidence: measured, roomDirections, exteriorSwing: measured.status === "observed" && !inside2(measured.sectorPoint, trace.footprint) ? "outward" : measured.status === "observed" ? "inward" : "unknown" };
  });
}

// src/lib/rasterOpeningDiscovery.mjs
import sharp4 from "sharp";
var distance4 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function solve3(a, b) {
  a = a.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < 3; k++) {
    let best = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(a[i][k]) > Math.abs(a[best][k])) best = i;
    [a[k], a[best]] = [a[best], a[k]];
    const v = a[k][k];
    if (Math.abs(v) < 1e-9) return null;
    for (let j = k; j < 4; j++) a[k][j] /= v;
    for (let i = 0; i < 3; i++) if (i !== k) {
      const f = a[i][k];
      for (let j = k; j < 4; j++) a[i][j] -= f * a[k][j];
    }
  }
  return a.map((r) => r[3]);
}
function fitCircle(points) {
  const mean = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }), { x: 0, y: 0 }), matrix = Array.from({ length: 3 }, () => [0, 0, 0]), rhs = [0, 0, 0];
  for (const p of points) {
    const x2 = p.x - mean.x, y2 = p.y - mean.y, row = [x2, y2, 1], target = -(x2 * x2 + y2 * y2);
    for (let i = 0; i < 3; i++) {
      rhs[i] += row[i] * target;
      for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j];
    }
  }
  const v = solve3(matrix, rhs);
  if (!v) return null;
  const x = mean.x - v[0] / 2, y = mean.y - v[1] / 2, radius = Math.sqrt((v[0] * v[0] + v[1] * v[1]) / 4 - v[2]);
  if (!Number.isFinite(radius)) return null;
  const residual = points.reduce((s, p) => s + Math.abs(Math.hypot(p.x - x, p.y - y) - radius), 0) / points.length;
  const angles = points.map((p) => Math.atan2(p.y - y, p.x - x)).sort((a, b) => a - b);
  let gap = -1, after = 0;
  for (let i = 0; i < angles.length; i++) {
    const d = (i === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[i + 1]) - angles[i];
    if (d > gap) {
      gap = d;
      after = (i + 1) % angles.length;
    }
  }
  return { x, y, radius, residual, startAngle: angles[after], span: 2 * Math.PI - gap };
}
function robustArcs(points, maxRadius) {
  let seed = points.length;
  const groups = [];
  const random = () => {
    seed = 1664525 * seed + 1013904223 >>> 0;
    return seed % points.length;
  };
  for (let iteration = 0; iteration < 256; iteration++) {
    const a = points[random()], b = points[random()], c = points[random()];
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 24) continue;
    const trial = fitCircle([a, b, c]);
    if (!trial || trial.radius < 12 || trial.radius > maxRadius) continue;
    const inliers = points.filter((p) => Math.abs(distance4(p, trial) - trial.radius) < 1.4);
    if (inliers.length < 24 || inliers.length < points.length * 0.15) continue;
    const previous = groups.find((g) => distance4(g.circle, trial) < trial.radius * 0.2 && Math.abs(g.circle.radius - trial.radius) < trial.radius * 0.2);
    if (previous) {
      if (inliers.length > previous.inliers.length) {
        previous.circle = trial;
        previous.inliers = inliers;
      }
    } else groups.push({ circle: trial, inliers });
  }
  const results = [];
  for (const group of groups.sort((a, b) => b.inliers.length - a.inliers.length).slice(0, 12)) {
    let best = group.inliers;
    for (let i = 0; i < 3; i++) {
      const circle2 = fitCircle(best);
      if (!circle2) break;
      best = points.filter((p) => Math.abs(distance4(p, circle2) - circle2.radius) < 1.4);
    }
    const circle = fitCircle(best);
    if (circle && circle.radius >= 12 && circle.radius <= maxRadius) results.push({ ...circle, pixelCount: best.length });
  }
  return results;
}
async function discoverRasterOpenings(buffer, graph, { includeComponentDiagnostics = false } = {}) {
  const { data, info } = await sharp4(buffer).flatten({ background: "#fff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }), { width, height, channels } = info, tone = new Uint8Array(width * height), chroma = new Uint8Array(width * height);
  for (let i = 0; i < tone.length; i++) {
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2];
    tone[i] = Math.round((r + g + b) / 3);
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const { strokeMask } = rasterInkContrast(tone, width, height), mask = Uint8Array.from(tone, (v, i) => chroma[i] < 30 && (v < 132 || strokeMask[i]) ? 1 : 0), curves = mask.slice();
  const scalePixels = graph.contentExtent?.scalePixels || Math.min(width, height);
  const angle = (s) => Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x), angleDistance = (a, b) => Math.acos(Math.min(1, Math.abs(Math.cos(a - b))));
  const directionGroups = [];
  for (const s of [...graph.ink].filter((s2) => !s2.colorEvidence && s2.lengthPixels > scalePixels * 0.18).sort((a, b) => b.lengthPixels - a.lengthPixels)) {
    const a = angle(s), group = directionGroups.find((g) => angleDistance(a, g.angle) < 0.06);
    if (group) group.weight += s.lengthPixels;
    else directionGroups.push({ angle: a, weight: s.lengthPixels });
  }
  const maxWeight = Math.max(0, ...directionGroups.map((g) => g.weight)), directions = directionGroups.filter((g) => g.weight >= maxWeight * 0.15).map((g) => g.angle);
  for (const s of graph.ink.filter((s2) => !s2.colorEvidence && s2.lengthPixels >= 18 && directions.some((a) => angleDistance(a, angle(s2)) < 0.035))) {
    const length = distance4(s.start, s.end), nx = -(s.end.y - s.start.y) / length, ny = (s.end.x - s.start.x) / length;
    for (let t = 0; t <= length; t++) for (let n = -2; n <= 2; n++) {
      const x = Math.round(s.start.x + (s.end.x - s.start.x) * t / length + nx * n), y = Math.round(s.start.y + (s.end.y - s.start.y) * t / length + ny * n);
      if (x >= 0 && y >= 0 && x < width && y < height) curves[y * width + x] = 0;
    }
  }
  const visited = new Uint8Array(mask.length), arcs = [], componentDiagnostics = [], clusters = [];
  for (let seed = 0; seed < curves.length; seed++) {
    if (!curves[seed] || visited[seed]) continue;
    const queue = [seed], points = [];
    visited[seed] = 1;
    for (let at2 = 0; at2 < queue.length; at2++) {
      const i = queue[at2], x = i % width, y = Math.floor(i / width);
      points.push({ x, y });
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy, j = yy * width + xx;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && curves[j] && !visited[j]) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }
    if (points.length < 6 || points.length > scalePixels * 5) continue;
    const box = { x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)), x1: Math.max(...points.map((p) => p.x)), y1: Math.max(...points.map((p) => p.y)) };
    clusters.push(box);
    if (points.length < 16) continue;
    const initial = fitCircle(points), circles = initial && initial.residual <= 1.5 ? [initial] : robustArcs(points, scalePixels * 0.28);
    if (includeComponentDiagnostics) componentDiagnostics.push({ count: points.length, box, circles });
    for (const circle of circles) {
      if (!circle || circle.radius < 12 || circle.radius > scalePixels * 0.28 || circle.residual > 1.5 || circle.span < Math.PI * 0.2 || circle.span > Math.PI * 0.85) continue;
      arcs.push({ ...circle, pixelCount: circle.pixelCount || points.length });
    }
  }
  const near4 = (p, r = 1) => {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const x = Math.round(p.x + dx), y = Math.round(p.y + dy);
      if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) return true;
    }
    return false;
  };
  const doors = [], symbolDiagnostics = [], optionDiagnostics = [];
  for (const arc of arcs) {
    const options = [];
    for (const direction of directions) for (const closedAngle of [direction, direction + Math.PI]) for (const side of [-1, 1]) {
      const closed = { x: Math.cos(closedAngle), y: Math.sin(closedAngle) }, hinge = { x: arc.x, y: arc.y };
      let best2 = null;
      for (let degrees = 45; degrees <= 135; degrees += 2) {
        if (degrees * Math.PI / 180 < arc.span - 0.15) continue;
        const theta = closedAngle + side * degrees * Math.PI / 180, leaf = { x: Math.cos(theta), y: Math.sin(theta) };
        let leafHits = 0, arcHits = 0;
        const offsets = [];
        for (let i = 0; i < 24; i++) {
          const t = 0.15 + 0.7 * i / 23, p = { x: hinge.x + leaf.x * arc.radius * t, y: hinge.y + leaf.y * arc.radius * t };
          let dark = 0;
          for (let n = -5; n <= 5; n++) {
            const x = Math.round(p.x - leaf.y * n), y = Math.round(p.y + leaf.x * n);
            if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) dark++;
          }
          if (near4(p, 2) && dark <= 6) {
            leafHits++;
            let closest = null;
            for (let n = -4; n <= 4; n++) {
              const x = Math.round(p.x - leaf.y * n), y = Math.round(p.y + leaf.x * n);
              if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] && (closest === null || Math.abs(n) < Math.abs(closest))) closest = n;
            }
            if (closest !== null) offsets.push(closest);
          }
          const a = closedAngle + side * degrees * Math.PI / 180 * (0.1 + 0.8 * i / 23);
          const radial = { x: Math.cos(a), y: Math.sin(a) }, q = { x: hinge.x + radial.x * arc.radius, y: hinge.y + radial.y * arc.radius };
          let arcDark = 0;
          for (let n = -5; n <= 5; n++) {
            const x = Math.round(q.x + radial.x * n), y = Math.round(q.y + radial.y * n);
            if (x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x]) arcDark++;
          }
          if (near4(q, 2) && arcDark <= 6) arcHits++;
        }
        let beyond = 0;
        for (let j = 0; j < 8; j++) if (near4({ x: hinge.x + leaf.x * arc.radius * (1.1 + j * 0.04), y: hinge.y + leaf.y * arc.radius * (1.1 + j * 0.04) }, 2)) beyond++;
        const mean = offsets.reduce((s, v) => s + v, 0) / Math.max(1, offsets.length), deviation = Math.sqrt(offsets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, offsets.length));
        if (includeComponentDiagnostics && leafHits >= 18 && arcHits >= 18) optionDiagnostics.push({ arc, closedAngle, side, degrees, leafHits, arcHits, beyond, deviation });
        if (leafHits < 21 || arcHits < 20 || beyond > 4 || deviation > 1) continue;
        let tangentHits = 0;
        for (let j = 0; j < 16; j++) {
          const a = closedAngle + side * degrees * Math.PI / 180 * (0.15 + 0.7 * j / 15), q = { x: hinge.x + Math.cos(a) * arc.radius, y: hinge.y + Math.sin(a) * arc.radius }, points = [];
          for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
            if (dx * dx + dy * dy > 16) continue;
            const x = Math.round(q.x + dx), y = Math.round(q.y + dy);
            if (x >= 0 && y >= 0 && x < width && y < height && curves[y * width + x]) points.push({ x, y });
          }
          if (points.length < 3) continue;
          const mean2 = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }), { x: 0, y: 0 });
          let xx = 0, xy2 = 0, yy = 0;
          for (const p of points) {
            const dx = p.x - mean2.x, dy = p.y - mean2.y;
            xx += dx * dx;
            xy2 += dx * dy;
            yy += dy * dy;
          }
          const t = 0.5 * Math.atan2(2 * xy2, xx - yy);
          if (Math.abs(Math.cos(t - a)) < 0.3) tangentHits++;
        }
        if (includeComponentDiagnostics) optionDiagnostics.at(-1).tangentHits = tangentHits;
        if (tangentHits < 12) continue;
        const score = (leafHits + arcHits) / 48 - deviation * 0.08;
        if (!best2 || score > best2.score) best2 = { score, degrees, hinge, closed, side, leafSupport: leafHits / 24, arcSupport: arcHits / 24 };
      }
      if (best2) options.push(best2);
    }
    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    if (!best || options[1] && options[1].score > best.score - 0.035) continue;
    const glyphContext = directions.some((angle2) => {
      const glyphs = clusters.map((b) => {
        const x = (b.x0 + b.x1) / 2 - best.hinge.x, y = (b.y0 + b.y1) / 2 - best.hinge.y, major = Math.max(b.x1 - b.x0, b.y1 - b.y0), minor = Math.min(b.x1 - b.x0, b.y1 - b.y0);
        return { along: x * Math.cos(angle2) + y * Math.sin(angle2), across: -x * Math.sin(angle2) + y * Math.cos(angle2), major, minor };
      }).filter((g) => g.major >= arc.radius * 0.25 && g.major <= arc.radius * 2 && g.minor >= 2 && g.major / g.minor < 3 && Math.abs(g.along) < arc.radius * 6 && Math.abs(g.across) < arc.radius * 0.7).sort((a, b) => a.along - b.along);
      let group = [];
      const word = () => {
        if (group.length < 5 || group.at(-1).along - group[0].along < arc.radius * 2.5) return false;
        const mean = group.reduce((s, g) => s + g.across, 0) / group.length, spread = Math.sqrt(group.reduce((s, g) => s + (g.across - mean) ** 2, 0) / group.length), size = group.reduce((s, g) => s + g.minor, 0) / group.length;
        return spread < size * 0.55;
      };
      for (const g of glyphs) {
        if (group.length && g.along - group.at(-1).along > Math.max(arc.radius * 0.75, (g.major + group.at(-1).major) * 0.8)) {
          if (word()) return true;
          group = [];
        }
        group.push(g);
      }
      return word();
    });
    if (includeComponentDiagnostics) symbolDiagnostics.push({ arc, best, glyphContext });
    if (glyphContext) continue;
    const start = best.hinge, end = { x: start.x + best.closed.x * arc.radius, y: start.y + best.closed.y * arc.radius };
    if (doors.some((d) => distance4(d.start, start) < 5 && distance4(d.end, end) < 5)) continue;
    doors.push({ id: `source_door${doors.length + 1}`, type: "door", start, end, widthPixels: arc.radius, hingeSide: "start", swingDirection: best.side > 0 ? "clockwise" : "counterclockwise", angleDegrees: best.degrees, leafSupport: best.leafSupport, arcSupport: best.arcSupport, circleResidual: arc.residual, source: "source_arc_and_radial_leaf" });
  }
  return { version: "source-opening-discovery-v1", doors, arcCandidates: arcs, ...includeComponentDiagnostics ? { componentDiagnostics, symbolDiagnostics, optionDiagnostics } : {} };
}
function sourceDoorGapCandidates(graph, discovery) {
  const pointDistance = (p, s) => {
    const dx = s.end.x - s.start.x, dy = s.end.y - s.start.y, length2 = dx * dx + dy * dy, t = ((p.x - s.start.x) * dx + (p.y - s.start.y) * dy) / length2, q = { x: s.start.x + Math.max(0, Math.min(1, t)) * dx, y: s.start.y + Math.max(0, Math.min(1, t)) * dy };
    return distance4(p, q);
  };
  return discovery.doors.map((door) => {
    const dx = door.end.x - door.start.x, dy = door.end.y - door.start.y, length = distance4(door.start, door.end), mid = { x: (door.start.x + door.end.x) / 2, y: (door.start.y + door.end.y) / 2 };
    const eligible = graph.candidates.filter((c) => {
      if (c.colorEvidence) return false;
      const ux = c.end.x - c.start.x, uy = c.end.y - c.start.y, parallel = Math.abs((ux * dx + uy * dy) / (distance4(c.start, c.end) * length)) > 0.98, tolerance = Math.max(4, (c.thicknessPixels || 0) / 2 + 3);
      return !(parallel && pointDistance(mid, c) < tolerance && pointDistance(door.start, c) < tolerance && pointDistance(door.end, c) < tolerance);
    });
    const bands = eligible.filter((c) => (c.kind === "solid_band" || c.kind === "face_pair" && c.filledBandRatio >= 0.65) && Math.abs(((c.end.x - c.start.x) * dx + (c.end.y - c.start.y) * dy) / (distance4(c.start, c.end) * length)) > 0.98 && (pointDistance(door.start, c) < c.thicknessPixels / 2 + 4 || pointDistance(door.end, c) < c.thicknessPixels / 2 + 4)).sort((a, b) => (a.kind === "solid_band" ? 0 : 1) - (b.kind === "solid_band" ? 0 : 1) || Math.min(pointDistance(door.start, a), pointDistance(door.end, a)) - Math.min(pointDistance(door.start, b), pointDistance(door.end, b)));
    let start = { ...door.start }, end = { ...door.end }, attachmentEvidence = null;
    if (bands.length) {
      const band5 = bands[0], ux = (band5.end.x - band5.start.x) / distance4(band5.start, band5.end), uy = (band5.end.y - band5.start.y) / distance4(band5.start, band5.end), offset = (start.x - band5.start.x) * -uy + (start.y - band5.start.y) * ux;
      start = { x: start.x + uy * offset, y: start.y - ux * offset };
      end = { x: end.x + uy * offset, y: end.y - ux * offset };
      for (const p of [start, end]) {
        const nearby = bands.flatMap((b) => [b.start, b.end]).filter((q) => distance4(p, q) <= Math.max(5, band5.thicknessPixels / 2 + 3)).sort((a, b) => distance4(p, a) - distance4(p, b));
        if (nearby.length) {
          p.x = nearby[0].x;
          p.y = nearby[0].y;
        }
      }
      attachmentEvidence = { method: "measured_wall_band_jambs", bandId: band5.id, normalOffsetPixels: offset };
    }
    const hosts = (p) => eligible.filter((c) => pointDistance(p, c) <= Math.max(5, (c.thicknessPixels || 0) / 2 + 3)).map((c) => c.id);
    return { id: door.id, start, end, lengthPixels: distance4(start, end), support: "observed_arc_and_leaf", endpointHosts: { start: hosts(start), end: hosts(end) }, sourceDoor: door, attachmentEvidence };
  });
}

// src/lib/rasterClassificationInput.mjs
var distance5 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function intervalOn(line, source2) {
  const dx = source2.end.x - source2.start.x, dy = source2.end.y - source2.start.y, length = distance5(source2.start, source2.end);
  if (!length || !distance5(line.start, line.end)) return null;
  const project3 = (p) => ({ t: ((p.x - source2.start.x) * dx + (p.y - source2.start.y) * dy) / (length * length), d: Math.abs((p.x - source2.start.x) * dy - (p.y - source2.start.y) * dx) / length });
  const a = project3(line.start), b = project3(line.end), angle = Math.abs((line.end.x - line.start.x) * dy - (line.end.y - line.start.y) * dx) / (length * distance5(line.start, line.end));
  if (angle > 0.025 || Math.max(a.d, b.d) > Math.max(2.5, (source2.thicknessPixels || 0) / 2 + 1.5)) return null;
  return [Math.max(0, Math.min(a.t, b.t)), Math.min(1, Math.max(a.t, b.t))];
}
function measuredSpanCoverage(source2, lines) {
  const spans = lines.map((line) => intervalOn(line, source2)).filter((s) => s && s[1] > s[0]).sort((a, b) => a[0] - b[0]);
  let covered = 0, end = 0;
  for (const [a, b] of spans) {
    covered += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return covered;
}
function requiredSourceBands(graph) {
  return graph.candidates.filter((c) => c.kind === "solid_band" && c.thicknessPixels >= 5 && distance5(c.start, c.end) >= 6);
}
function measuredWallAlternatives(graph) {
  const sources = new Map((graph.ink || []).map((s) => [s.id, s]));
  return graph.candidates.filter((c) => c.kind === "solid_band").map((band5) => ({ candidateId: band5.id, overlappingAlternativeIds: graph.candidates.filter((c) => {
    if (c.id === band5.id) return false;
    return (band5.sourceIds || []).some((id) => {
      if (!c.sourceIds?.includes(id)) return false;
      const source2 = sources.get(id);
      if (!source2) return false;
      const dx = source2.end.x - source2.start.x, dy = source2.end.y - source2.start.y, length = distance5(source2.start, source2.end);
      if (!length) return false;
      const project3 = (p) => ((p.x - source2.start.x) * dx + (p.y - source2.start.y) * dy) / length;
      const a = [project3(band5.start), project3(band5.end)].sort((a2, b2) => a2 - b2), b = [project3(c.start), project3(c.end)].sort((a2, b2) => a2 - b2);
      return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 2;
    });
  }).map((c) => c.id) })).filter((g) => g.overlappingAlternativeIds.length);
}
function compactPixelClassificationInput(graph, sourceOpenings) {
  return {
    imageFrame: { width: graph.imageWidth, height: graph.imageHeight, coordinateSpace: "full_source_pixels" },
    candidates: graph.candidates.map((c) => ({ id: c.id, kind: c.kind, start: c.start, end: c.end, sourceIds: c.sourceIds || [c.id], ...c.thicknessPixels ? { thicknessPixels: c.thicknessPixels } : {}, ...c.colorEvidence ? { colorEvidence: true } : {}, ...c.filledBandRatio !== void 0 ? { filledBandRatio: c.filledBandRatio } : {} })),
    gaps: graph.gaps.map((g) => ({ id: g.id, a: g.a, b: g.b, start: g.start, end: g.end, support: g.support, ...g.endpointHosts ? { endpointHosts: g.endpointHosts } : {}, ...g.sourceDoor ? { sourceDoor: g.sourceDoor } : {} })),
    sourceDoors: sourceOpenings.doors,
    requiredSourceBandIds: requiredSourceBands(graph).map((c) => c.id),
    measuredWallAlternatives: measuredWallAlternatives(graph),
    selectionContract: "Assign exactly one candidateRoles value for every candidate ID. Use alternative_face for redundant representations, furniture for furniture enclosures and unresolved for unclear roles. complete=true confirms the whole source was reviewed."
  };
}
function validateSourceBandCoverage(graph, selection) {
  const selectedIds = new Set(selection.walls.map((w) => w.candidateId)), selected = graph.candidates.filter((c) => selectedIds.has(c.id)), reviewed = new Set((selection.nonWalls || []).map((c) => c.candidateId));
  return requiredSourceBands(graph).filter((c) => !reviewed.has(c.id) && measuredSpanCoverage(c, selected) < 0.9).map((c) => c.id);
}

// src/lib/rasterCandidateRoles.mjs
var PIXEL_CANDIDATE_ROLES = ["external_wall", "internal_wall", "alternative_face", "furniture", "door_symbol", "window_symbol", "text", "dimension", "noise", "unresolved"];
function pixelCandidateRolesSchema(graph) {
  const ids = graph.candidates.map((c) => c.id);
  return { type: "object", properties: Object.fromEntries(ids.map((id) => [id, { $ref: "#/$defs/pixelCandidateRole" }])), required: ids, additionalProperties: false };
}
function normalizePixelCandidateRoles(graph, selection) {
  if (!Object.hasOwn(selection, "candidateRoles")) return selection;
  const roles = selection.candidateRoles, ids = new Set(graph.candidates.map((c) => c.id));
  const invalid = () => {
    throw Object.assign(Error("Every source candidate needs exactly one recognized role."), { code: "INVALID_PIXEL_SELECTION" });
  };
  if (!roles || typeof roles !== "object" || Array.isArray(roles) || Object.keys(roles).length !== ids.size) invalid();
  if (["walls", "nonWalls", "unresolvedCandidateIds"].some((k) => Object.hasOwn(selection, k))) invalid();
  const walls = [], nonWalls = [], unresolvedCandidateIds = [];
  for (const [candidateId, role] of Object.entries(roles)) {
    if (!ids.has(candidateId) || !PIXEL_CANDIDATE_ROLES.includes(role)) invalid();
    if (role === "external_wall" || role === "internal_wall") walls.push({ candidateId, type: role === "external_wall" ? "external" : "internal" });
    else if (role === "unresolved") unresolvedCandidateIds.push(candidateId);
    else nonWalls.push({ candidateId, reason: role });
  }
  return { ...selection, walls, nonWalls, unresolvedCandidateIds };
}

// src/lib/rasterGraphPipeline.mjs
var object2 = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
var array2 = (items) => ({ type: "array", items });
var text2 = { type: "string" };
var number2 = { type: "number" };
var nullableNumber2 = { type: ["number", "null"] };
var choice2 = (...values) => ({ type: "string", enum: values });
var fail3 = (code, message, details = {}) => {
  throw Object.assign(Error(message), { name: "PixelGraphError", code, details });
};
function pixelWallClassificationSchema(graph) {
  const schema = object2({
    complete: { type: "boolean" },
    confidence: number2,
    title: text2,
    candidateRoles: pixelCandidateRolesSchema(graph),
    openings: array2(object2({ gapId: graph.gaps.length ? choice2(...graph.gaps.map((g) => g.id)) : text2, type: choice2("door", "window"), hingeSide: choice2("start", "end", "unknown"), swingDirection: choice2("clockwise", "counterclockwise", "unknown") })),
    rejectedSourceDoors: array2(object2({ sourceDoorId: graph.gaps.some((g) => g.sourceDoor) ? choice2(...graph.gaps.filter((g) => g.sourceDoor).map((g) => g.id)) : text2, reason: choice2("furniture", "text", "dimension", "unreadable"), evidence: text2 })),
    inventory: object2({ enclosedSpaceNames: array2(text2), doorCount: number2, windowCount: number2 }),
    missingFeatures: array2(text2)
  });
  schema.$defs = { pixelCandidateRole: { type: "string", enum: PIXEL_CANDIDATE_ROLES } };
  return schema;
}
function pixelRegionClassificationSchema(topology, anchors) {
  const regionId = choice2(...topology.regions.map((r) => r.id)), anchorId = anchors.length <= 400 ? choice2(...anchors.map((a) => a.id)) : text2;
  return object2({
    title: text2,
    confidence: number2,
    wallHeightMeters: nullableNumber2,
    regions: array2(object2({
      regionId,
      name: text2,
      sourceText: text2,
      fixtures: array2(choice2("bed", "toilet", "shower", "bathtub", "sofa", "kitchen_cabinets", "hob", "oven", "washing_machine", "wardrobe", "other")),
      type: choice2("room", "bedroom", "living", "kitchen", "bathroom", "corridor", "balcony", "laundry", "storage", "stair", "other", "unresolved"),
      context: choice2("bedroom", "entrance", "stair_core", "circulation", "unassigned", "living", "kitchen", "bathroom", "balcony", "laundry"),
      pattern: choice2("none", "hatch", "cross", "solid_fill", "unknown"),
      details: choice2("none", "present", "unknown"),
      explicitUse: choice2("room", "wardrobe", "shaft", "void", "courtyard", "lift_void", "stair", "shower", "furniture", "unknown"),
      parentRegionId: { type: ["string", "null"], enum: [...topology.regions.map((r) => r.id), null] }
    })),
    symbols: array2(object2({ enclosureId: text2, parentRegionId: regionId, sourceText: text2, pattern: choice2("none", "hatch", "cross", "solid_fill", "unknown"), details: choice2("none", "present", "unknown"), explicitUse: choice2("wardrobe", "furniture", "unknown") })),
    measurements: array2(object2({ text: text2, startAnchorId: anchorId, endAnchorId: anchorId, meters: number2 }))
  });
}
function validatePixelClassification(graph, selection) {
  if (!selection.complete || selection.missingFeatures?.length || selection.unresolvedCandidateIds?.length) fail3("INCOMPLETE_PIXEL_CLASSIFICATION", "The physical source lines are not fully classified; no replacement room grid was invented.", {
    complete: selection.complete === true,
    missingFeatures: selection.missingFeatures || [],
    unresolvedCandidateIds: selection.unresolvedCandidateIds || [],
    selectedWallCount: selection.walls?.length || 0,
    candidateCount: graph.candidates.length,
    uncoveredBands: validateSourceBandCoverage(graph, { walls: selection.walls || [], nonWalls: selection.nonWalls || [] })
  });
  const ids = new Set(graph.candidates.map((c) => c.id)), seen = /* @__PURE__ */ new Set();
  for (const item of [...selection.walls || [], ...selection.nonWalls || []]) {
    if (!ids.has(item.candidateId) || seen.has(item.candidateId)) fail3("INVALID_PIXEL_SELECTION", "Candidate classification contains unknown or repeated IDs.");
    seen.add(item.candidateId);
  }
  const uncoveredBands = validateSourceBandCoverage(graph, selection);
  if (uncoveredBands.length) fail3("INCOMPLETE_PIXEL_CLASSIFICATION", "Measured thick source bands need selected wall coverage or an explicit non-wall interpretation.", { uncoveredBands });
  const doors = selection.openings.filter((o) => o.type === "door").length, windows = selection.openings.filter((o) => o.type === "window").length;
  if (doors !== selection.inventory?.doorCount || windows !== selection.inventory?.windowCount) fail3("INCOMPLETE_OPENING_INVENTORY", "Visible opening inventory does not agree with selected source gaps.");
  const rejected = /* @__PURE__ */ new Map();
  for (const item of selection.rejectedSourceDoors || []) {
    if (!graph.gaps.some((g) => g.id === item.sourceDoorId && g.sourceDoor) || rejected.has(item.sourceDoorId) || selection.openings.some((o) => o.gapId === item.sourceDoorId)) fail3("INVALID_PIXEL_OPENING", "Unknown, duplicate or contradictory source-door review.");
    if (item.reason === "unreadable" || !String(item.evidence || "").trim()) fail3("INCOMPLETE_OPENING_INVENTORY", "A source door observation remains unresolved.");
    rejected.set(item.sourceDoorId, item);
  }
  for (const gap of graph.gaps.filter((g) => g.sourceDoor)) if (!selection.openings.some((o) => o.gapId === gap.id && o.type === "door") && !rejected.has(gap.id)) fail3("INCOMPLETE_OPENING_INVENTORY", "A locally observed door was silently omitted from classification.", { sourceDoorId: gap.id });
}
function regionOverlay(graph, topology, anchors) {
  const labels = [...topology.regions, ...topology.symbolEnclosures || []].map((r) => {
    const x = r.polygon.reduce((s, p) => s + p.x / r.polygon.length, 0), y = r.polygon.reduce((s, p) => s + p.y / r.polygon.length, 0);
    return `<polygon points="${r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}" fill="#1597cf" fill-opacity=".06" stroke="#1597cf"/><text x="${x}" y="${y}" font-size="15">${r.id}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.imageWidth}" height="${graph.imageHeight}"><g fill="#083e64" font-family="sans-serif">${labels}${anchors.map((a) => `<circle cx="${a.x}" cy="${a.y}" r="2"/><text x="${a.x + 3}" y="${a.y - 3}" font-size="8">${a.id}</text>`).join("")}</g></svg>`;
}
async function labelledImage(buffer, overlay) {
  const data = await sharp5(buffer).composite([{ input: Buffer.from(overlay) }]).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}
function pixelClassificationViewLayout(graph) {
  const views = [];
  const extent = graph.contentExtent || { left: 0, top: 0, width: graph.imageWidth, height: graph.imageHeight };
  const groups = ["stroke", "solid_band", "face_pair", "fragments"].map((kind) => graph.candidates.filter((c) => kind === "fragments" ? ["stroke_fragment", "observed_wall_fragment"].includes(c.kind) : c.kind === kind)).filter((g) => g.length);
  if (!groups.length) return views;
  const budget = Math.floor(9 / groups.length);
  let columns = Math.min(Math.ceil(extent.width / 850), budget), rows = Math.min(Math.ceil(extent.height / 850), Math.max(1, Math.floor(budget / columns)));
  if (extent.height > extent.width) {
    rows = Math.min(Math.ceil(extent.height / 850), budget);
    columns = Math.min(Math.ceil(extent.width / 850), Math.max(1, Math.floor(budget / rows)));
  }
  for (const candidates of groups) for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const left = Math.max(0, extent.left + Math.floor(col * extent.width / columns) - 35), top = Math.max(0, extent.top + Math.floor(row * extent.height / rows) - 35), right = Math.min(graph.imageWidth, extent.left + Math.ceil((col + 1) * extent.width / columns) + 35), bottom = Math.min(graph.imageHeight, extent.top + Math.ceil((row + 1) * extent.height / rows) + 35);
    const viewport = { left, top, right, bottom };
    views.push({ kind: candidates[0].kind, viewport, candidateIds: candidates.map((c) => c.id) });
  }
  return views;
}
async function pixelClassificationDetailViews(buffer, graph) {
  const images = [];
  for (const view of pixelClassificationViewLayout(graph)) {
    const ids = new Set(view.candidateIds), { left, top, right, bottom } = view.viewport;
    const labelled = await sharp5(buffer).composite([{ input: Buffer.from(pixelGraphOverlay({ ...graph, candidates: graph.candidates.filter((c) => ids.has(c.id)), gaps: [] }, { layer: "all", viewport: view.viewport })) }]).png().toBuffer();
    const data = await sharp5(labelled).extract({ left, top, width: right - left, height: bottom - top }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
    images.push(`data:image/jpeg;base64,${data.toString("base64")}`);
  }
  return images;
}
async function runPixelGraphPipeline({ buffer, classify, diagnostics = {} }) {
  diagnostics.format = "ventra-raster-diagnostic-v1";
  diagnostics.build = VERIFIED_PREVIEW_VERSION;
  diagnostics.accepted = false;
  diagnostics.trace = null;
  diagnostics.attempts = [];
  const graph = await extractRasterPixelGraph(buffer);
  const sourceOpenings = await discoverRasterOpenings(buffer, graph);
  graph.gaps.push(...sourceDoorGapCandidates(graph, sourceOpenings));
  if (graph.gaps.length > 700) fail3("PIXEL_GRAPH_TOO_COMPLEX", "Opening observations exceed the classification budget. No model request was made.");
  diagnostics.sourceOpeningDiscovery = sourceOpenings;
  diagnostics.pixelGraph = graph;
  diagnostics.imageWidth = graph.imageWidth;
  diagnostics.imageHeight = graph.imageHeight;
  diagnostics.imageHash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  if (graph.candidates.length < 3) fail3("NO_PIXEL_STRUCTURE", "No supported building lines were extracted. No model request was made.");
  const original = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  const rawSelection = await classify({
    stage: "classify_source_lines",
    schema: pixelWallClassificationSchema(graph),
    original,
    image: await labelledImage(buffer, pixelGraphOverlay(graph)),
    images: await pixelClassificationDetailViews(buffer, graph),
    data: { ...compactPixelClassificationInput(graph, sourceOpenings), detailViews: pixelClassificationViewLayout(graph) },
    prompt: "Do not discard a visible line solely because it is faint, gray, thin or lower contrast. Classify its architectural role using continuity, junctions and source context; faint text, dimensions and furniture are still non-walls. Classify the provided SOURCE-PIXEL candidate IDs. Coordinates are already measured; never write or invent coordinates. Select every actual physical wall, including thin outlined walls and all exterior balcony/recess boundaries. Measured solid_band candidates already represent the filled wall centre and retain short jambs. Prefer them when the source wall is filled; do not also select overlapping face alternatives. Face-pair candidates represent one wall between two visible faces: choose the pair OR its raw face strokes, never both. Select physical wall runs, not every alternative representation. candidateRoles requires EXACTLY ONE role for EVERY candidate ID: external_wall, internal_wall, alternative_face, furniture, door_symbol, window_symbol, text, dimension, noise or unresolved. Classify redundant representations as alternative_face; never classify both a measured band and one of its overlapping alternatives as a wall. Classify furniture enclosure boundary strokes as furniture. complete=true confirms you reviewed the whole source. A requiredSourceBandId not represented by a wall still needs its explicit visible non-wall role; ignore furniture/cabinet/wardrobe edges, door leaves/arcs, labels and dimension lines. sourceDoors are local pixel observations with arc and thin radial-leaf support, not AI guesses. Inspect each observed_arc_and_leaf gap and preserve its source ID when it represents a real door. Every local source-door observation must be selected or explicitly reviewed in rejectedSourceDoors with visible non-door evidence; never silently omit it. Its endpointHosts permit a door at a wall end or perpendicular junction: select a parallel host or hosts at both jambs; a leaf must not be selected as a wall. Other opening gaps are hypotheses, not walls: select only visibly supported door/window gaps with BOTH host candidates selected. Inventory all visible doors/windows and enclosed space names before returning. Report complete=false for missing geometry; do not simplify the drawing to its exterior rectangle. An image with real interior rooms requires its interior wall topology. The second image labels original ink/solid-band IDs. Following detail crops separate raw strokes, filled wall centres, face-pairs and fragments into DIFFERENT images so alternative representations never share a label layer. detailViews lists each crop in image order with its full-source pixel viewport and candidate IDs. measuredWallAlternatives explicitly lists incompatible overlapping representations: if selecting candidateId, do not also select any of its overlappingAlternativeIds. Alternatives may cover different extents; use their non-overlapping remainder fragments where a real wall continues. A solid_band sourceIds list includes its original boundary faces: these represent ONE physical wall, not extra partitions. A face_pair uses two measured faces; two raw faces do not become two physical walls. Review the clean original when a label or leader overlaps a fixture. Missing room-use semantics or furniture identification belong to the second stage; this first stage must still assign furniture roles to their boundary strokes and never silently omit a physical wall. These generated IDs and leader lines are not source geometry. SOURCE DATA coordinates locate candidates in the full original image, not within crop coordinates."
  });
  diagnostics.wallClassification = rawSelection;
  const selection = normalizePixelCandidateRoles(graph, rawSelection);
  diagnostics.wallClassification = selection;
  validatePixelClassification(graph, selection);
  const topology = assemblePixelTopology(graph, selection);
  diagnostics.pixelTopology = topology;
  const furniture = selection.nonWalls.filter((s) => s.reason === "furniture");
  topology.symbolEnclosures = [];
  if (furniture.length >= 3) {
    try {
      topology.symbolEnclosures = assemblePixelTopology(graph, { walls: furniture.map((s) => ({ candidateId: s.candidateId, type: "internal" })), openings: [] }).enclosures;
    } catch (error2) {
      if (error2.code !== "OPEN_PIXEL_TOPOLOGY") throw error2;
      diagnostics.unclosedFurnitureSymbols = true;
    }
  }
  if (topology.regions.length < selection.inventory.enclosedSpaceNames.length) fail3("INCOMPLETE_ROOM_TOPOLOGY", "Selected walls enclose fewer spaces than the visible source inventory.", { regions: topology.regions.length, inventory: selection.inventory.enclosedSpaceNames });
  const anchors = pixelGraphAnchors(graph, topology);
  const semantics = await classify({
    stage: "classify_enclosed_regions",
    schema: pixelRegionClassificationSchema(topology, anchors),
    original,
    image: await labelledImage(buffer, regionOverlay(graph, topology, anchors)),
    data: { regions: topology.regions, symbolEnclosures: topology.symbolEnclosures, anchors },
    prompt: "Name and interpret EVERY enclosed source region by regionId. All polygons and anchors are computed from pixels: never invent coordinates or change shapes. Copy the actual readable room label into sourceText (empty string if none); separately inventory only VISIBLE fixtures. Text has priority over furniture guesses. PROJECT DICTIONARY: B.R / BR = bathroom/toilet; ROOM = a room, not unknown; Bedroom / Master Room = bedroom; Living Room = living; Kitchen = kitchen; Landry / Laundry = laundry. If ROOM contains a bed, classify bedroom. Without readable labels use bed -> bedroom, toilet/shower -> bathroom, sofa -> living, kitchen cabinets/hob -> kitchen. If neither text nor fixtures identify its use, preserve the physical room as type other, not a fabricated bedroom. Drawing convention: an ENCLOSED hatched/crossed/solid-filled area with NO interior details in an entrance, stair core, circulation or unassigned core is an excluded void, with no floor; do not turn it into storage. Interpret EVERY symbolEnclosure separately in symbols, with its real parentRegionId; furniture enclosures are not architectural floor holes. A hatched/crossed SUBREGION within a BEDROOM is a wardrobe, not a floor hole; set its adjacent parentRegionId to that bedroom. A room-floor hatch is not automatically a wardrobe. Detailed stairs, showers and actual furniture are not voids merely because a symbol crosses them. Respect explicit labels. Use unresolved only for unclear physical region boundaries, not merely an unknown room use. A wardrobe is not a separate bedroom or empty floor opening. Copy only readable printed dimensions in metres, with endpoints identified by their exact source anchor IDs. Overall dimensions should use their actual reference faces/ticks, not arbitrary nearby room nodes. Include no guessed dimensions or furniture sizes. Use null for unannotated wall height. The labelled second image contains generated region/anchor IDs, not original dimensions."
  });
  diagnostics.regionClassification = semantics;
  const compiled = compileClassifiedPixelGraph(graph, selection, semantics, topology);
  const evidence = await prepareRasterImageEvidence(buffer);
  compiled.trace.openings = applyRasterDoorSymbols(compiled.trace, evidence);
  diagnostics.rawPixelTrace = compiled.trace;
  diagnostics.trace = normalizeRasterPixelTrace(compiled.trace, diagnostics);
  diagnostics.spaceInterpretations = compiled.spaceInterpretations;
  diagnostics.storage = compiled.storage;
  const alignment = inspectRasterImageEvidence(compiled.trace, evidence);
  diagnostics.imageEvidence = alignment;
  requireRasterImageEvidence(alignment);
  const scene = compileRasterFloorplan(diagnostics.trace, diagnostics);
  scene.assets = sourceStorageAssets(compiled, scene);
  for (const opening of scene.openings) {
    const source2 = compiled.trace.openings.find((o) => o.id === opening.id);
    if (source2) {
      opening.swingEvidence = source2.swingEvidence;
      opening.roomDirections = source2.roomDirections;
      opening.exteriorSwing = source2.exteriorSwing;
      opening.openAngleDegrees = source2.swingEvidence?.status === "observed" ? source2.swingEvidence.angleDegrees : 0;
      opening.orientationSource = source2.swingEvidence?.status === "observed" ? "source_image_y_down" : "unresolved";
    }
  }
  if (scene.assets.length) scene.geometryValidation.assumptions.push("Wardrobe floor footprints are source-measured; wardrobe height is a schematic default, not a printed dimension.");
  scene.geometryValidation.pixelSupport = alignment.status;
  scene.geometryValidation.acceptanceBuild = VERIFIED_PREVIEW_VERSION;
  scene.geometryValidation.coordinateAuthority = "source_pixel_graph";
  scene.geometryValidation.spacePolicyVersion = compiled.spacePolicyVersion;
  scene.sourceStorageRegions = compiled.storage;
  diagnostics.accepted = true;
  diagnostics.validation = scene.geometryValidation;
  return { scene, diagnostics, validation: scene.geometryValidation, mode: "analyze", source: "pixel-graph-with-semantic-classification", routeVersion: VERIFIED_PREVIEW_VERSION, needsManualReview: true, warning: "Geometry coordinates come from source pixels. Source-line classification, hatch context and opening completeness require visual review; unannotated heights remain assumptions." };
}

// src/lib/previewAIConfig.mjs
function previewAIKeyStatus(value) {
  if (typeof value !== "string" || !value.trim()) return "missing";
  if (value !== value.trim() || /[^\x21-\x7e]/.test(value) || /^\*+$/.test(value)) return "unusable_header";
  return "header_ready";
}

// src/lib/serverPixelGraphPreview.js
async function runPixelGraphPreview(body) {
  const diagnostics = { transportAttempts: [], transport: { stage: "preparing_image" } }, started = Date.now(), model = process.env.OPENAI_FLOORPLAN_GEOMETRY_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5.1";
  diagnostics.model = model;
  try {
    if (!body?.imageUrl) return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
    const response = await fetch(body.imageUrl, { cache: "no-store", signal: AbortSignal.timeout(45e3) });
    if (!response.ok) throw Error(`Could not download source image (${response.status}).`);
    const buffer = await sharp6(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true }).flatten({ background: "#fff" }).sharpen({ sigma: 0.6 }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    let calls = 0;
    const payload = await runPixelGraphPipeline({ buffer, diagnostics, classify: async (task) => {
      if (previewAIKeyStatus(process.env.OPENAI_API_KEY) !== "header_ready") throw Object.assign(Error("OpenAI is not configured with a usable key for this deploy. Set OPENAI_API_KEY securely in Netlify. No AI request was made."), { code: "OPENAI_CREDENTIAL_CONFIGURATION", status: 503 });
      if (++calls > 2) throw Error("Pixel graph classification budget exceeded.");
      const remaining = 24e4 - (Date.now() - started);
      if (remaining <= 0) throw Object.assign(Error("Image analysis exceeded its total time limit."), { code: "RASTER_VISION_TIMEOUT" });
      const transport = { stage: task.stage, attempt: calls };
      diagnostics.transport = transport;
      diagnostics.transportAttempts.push(transport);
      const result = await requestRasterVision((payload2, options) => consumeRasterVisionStream((p, o) => getOpenAIClient().responses.create(p, o), payload2, options, transport), {
        model,
        reasoning: { effort: "low" },
        max_output_tokens: 16e3,
        input: [{ role: "user", content: [{ type: "input_text", text: `${task.prompt}
SOURCE DATA: ${JSON.stringify(task.data)}` }, { type: "input_image", image_url: task.original, detail: "high" }, { type: "input_image", image_url: task.image, detail: "high" }, ...(task.images || []).map((image_url) => ({ type: "input_image", image_url, detail: "high" }))] }],
        text: { format: { type: "json_schema", name: task.stage, strict: true, schema: task.schema } }
      }, remaining);
      if (result.status !== "completed" || !result.output_text) throw Object.assign(Error("No complete semantic classification was returned."), { code: "RASTER_VISION_INCOMPLETE" });
      return JSON.parse(result.output_text);
    } });
    diagnostics.elapsedMs = Date.now() - started;
    return NextResponse.json(payload);
  } catch (error2) {
    diagnostics.elapsedMs = Date.now() - started;
    diagnostics.accepted = false;
    diagnostics.failure = { code: error2.code || "PIXEL_GRAPH_FAILED", message: error2.message, details: error2.details };
    return NextResponse.json({ error: error2.message, code: error2.code || "PIXEL_GRAPH_FAILED", diagnostics, routeVersion: VERIFIED_PREVIEW_VERSION, needsManualReview: true }, { status: error2.code === "OPENAI_CREDENTIAL_CONFIGURATION" ? 503 : error2.code === "RASTER_VISION_TIMEOUT" ? 504 : String(error2.code || "").startsWith("RASTER_VISION_") ? 502 : error2.status === 429 ? 429 : 422 });
  }
}

// src/lib/serverRasterPreview.js
var RASTER_PREVIEW_VERSION = VERIFIED_PREVIEW_VERSION;
var RASTER_TRACE_BUILD = RASTER_PREVIEW_VERSION;
var RASTER_TRACE_MAX_ATTEMPTS = 2;
var OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS = 24e4;
async function prepareVisionImage(imageUrl, { maxDimension = 1600, quality = 88 } = {}) {
  const response = await fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(45e3) });
  if (!response.ok) {
    throw new Error(`Could not download floor-plan image (${response.status}).`);
  }
  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const { data: optimizedBuffer, info } = await sharp7(sourceBuffer).rotate().resize({
    width: maxDimension,
    height: maxDimension,
    fit: "inside",
    withoutEnlargement: true
  }).flatten({ background: "#ffffff" }).sharpen({ sigma: 0.6 }).jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
  return {
    imageUrl: `data:image/jpeg;base64,${optimizedBuffer.toString("base64")}`,
    width: info.width,
    height: info.height,
    buffer: optimizedBuffer
  };
}
function extractJson(text3) {
  const raw = String(text3 || "").trim();
  const unfenced = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON design object returned.");
  return JSON.parse(unfenced.slice(first, last + 1));
}
async function runRasterPreview(body) {
  if (process.env.VENTRA_RASTER_ENGINE !== "legacy") return runPixelGraphPreview(body);
  const mode = "analyze";
  const imageUrl = String(body?.imageUrl || "").trim();
  if (!imageUrl) {
    return NextResponse2.json({ error: "imageUrl is required." }, { status: 400 });
  }
  const geometryModel = process.env.OPENAI_FLOORPLAN_GEOMETRY_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5.1";
  const baselinePrompt = `Trace the supplied architectural floor plan faithfully. Return one structured trace, not a redesigned layout. Establish the exterior contour and physical wall runs from the image FIRST. Read metric spans after fixing that pixel topology; never start from room dimension labels and turn them into a room grid.

IMAGE COORDINATES:
Use actual PIXEL coordinates of the ENTIRE supplied image: origin at its top-left, x right, y down. Exact width and height are supplied after these instructions. Return coordinateSpace="image_pixels" and echo those exact dimensions. Never use a 0..1000 normalized grid, a building-local frame, or a guessed room grid. The server converts pixels into its internal frame exactly once.

DIMENSION EVIDENCE:
- measurements contains only legible printed dimensions, converted to metres. Copy the visible dimension text into text.
- start/end identify the architectural reference points actually measured by that dimension: extension-line origins, or the two internal faces for a printed clear room dimension. Do not measure a clear room dimension between wall centerlines.
- Prefer long overall/chained dimensions with identifiable reference ticks. Room-label numbers are not a located dimension span: include them only when BOTH corresponding internal faces are unambiguous. horizontal/vertical refers to the reference span in the image; use aligned for an oblique span.
- Never estimate metres from a bed, a door, a room name, or a familiar layout. If no dimension is readable, return measurements as [].
- Return wallHeightMeters as null unless an annotation explicitly gives the wall height. Likewise use null for unannotated door/window heights and window sill heights.

ONE CONSISTENT TRACE:
1. A crossed rectangle can be a shaft/void, not a storage room. Preserve explicit lift/shaft labels and their floor holes. A gray hatch alone is not proof of a void. If its use is uncertain, keep it unresolved instead of manufacturing a storage room. Read KITCHEN and non-English kitchen labels even when counters are drawn as plain L/U linework; they are not sofas.
1A. Follow the exterior footprint, including EVERY visible notch/recess; do not use its bounding rectangle or a convex hull. The footprint follows the outer wall face. Include only explicitly labeled/recognizable shafts or courtyards in holes.
2. List every visible real room/zone exactly once, with its visible name. Never create a room for a wardrobe, a wall-thickness sliver, a door swing, or dimension text. Room polygons follow the clear internal boundaries. Named open-plan zones may share conceptual boundaries, but no wall may be invented there.
3. Trace each physical wall ONCE, on its CENTERLINE. Adjacent rooms must share the same physical wall. Preserve oblique/rotated walls; do not force them horizontal/vertical. At a junction, use matching coordinates. Split at corners and real T/X junctions.
4. A wall run must CONTINUE THROUGH its door/window gaps. Do NOT split the wall at door jambs. Each opening references the ID of the single wall run containing both jambs. No wall may cross a room's interior polygon or bridge an exterior recess.
5. For each door/window, start/end are its two visible jamb locations on that wall's centerline. The server measures its width from these points. Do not return the door arc tip, leaf tip, or furniture edge as a jamb. If ownership or jambs cannot be read, omit the uncertain opening and lower confidence.
6. For a door, hingeSide is start/end relative to the owning WALL's direction. swingDirection is the clockwise/counterclockwise rotation visible on the image from closed leaf toward open leaf. Use unknown when the hinge or arc is unclear. Sliding/unreadable doors must not receive an invented swing.
7. Never move, resize or recenter an individual room to fit its printed dimension. Preserve shared topology; contradictory evidence must lower confidence.
8. Return empty collections for absent features. Do not add furniture, fixtures, guessed openings, or missing structural features. This stage validates plan geometry only.
9. Trace the supplied plan even if it resembles a familiar template. No predetermined room count, dimensions, coordinates or topology.
10. Before returning, walk the complete exterior contour visually, including changes of direction at entrances and recesses. A rectangular footprint is permitted only if the actual outline is rectangular.
11. Check every wall against the room interiors, and every pair of room polygons for overlap. Shared open-plan boundaries do not imply physical walls. Measurements inside room labels are NOT permission to invent different room polygons.
12. For each dimension, identify the two visible reference ticks/faces before returning its endpoints. Do not reuse a nearby span for a different printed value. Exclude dimensions whose reference points cannot be located confidently. Do not adjust the visible geometry to force inconsistent annotations to fit.
13. Inventory every visible door arc and window symbol before tracing, then reconcile that inventory with the openings you return. Do not silently drop recognizable openings to make geometry validation pass.
14. Check each opening's two jamb points against its parent wall: BOTH must be collinear with that wall and fall between its endpoints. A leaf drawn perpendicular to the wall is not the jamb span. Inspect every exterior wall for window symbols before returning the openings array; do not silently omit visible windows while tracing doors.

Return only JSON conforming to the supplied schema.`;
  const requestStartedAt = Date.now();
  const rasterDiagnostics = {
    format: "ventra-raster-diagnostic-v1",
    build: RASTER_TRACE_BUILD,
    model: geometryModel,
    inputCoordinateSpace: "image_pixels",
    reasoningEffort: "low",
    trace: null,
    transport: { stage: "preparing_image" },
    transportAttempts: [],
    attempts: []
  };
  try {
    const prepared = await prepareVisionImage(imageUrl, { maxDimension: 2200, quality: 92 });
    const imageEvidence = await prepareRasterImageEvidence(prepared.buffer);
    const traceSchema = rasterPixelTraceSchemaForImage(prepared.width, prepared.height);
    const strokeEvidencePrompt = rasterEvidencePrompt(imageEvidence);
    console.log("[VENTRA RASTER GEOMETRY START]", {
      routeVersion: RASTER_GEOMETRY_VERSION,
      model: geometryModel,
      fileName: body?.fileName || null,
      imageWidth: prepared.width,
      imageHeight: prepared.height,
      strategy: "pixel_guided_trace_with_source_alignment"
    });
    rasterDiagnostics.imageHash = createHash2("sha256").update(prepared.buffer).digest("hex").slice(0, 16);
    rasterDiagnostics.imageWidth = prepared.width;
    rasterDiagnostics.imageHeight = prepared.height;
    rasterDiagnostics.imagePreparationMs = Date.now() - requestStartedAt;
    rasterDiagnostics.pixelGuideCount = imageEvidence.guides.length;
    let previousFailure = null;
    let previousTrace = null;
    for (let attempt = 1; attempt <= RASTER_TRACE_MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      const transport = { stage: "request_pending", attempt };
      rasterDiagnostics.transport = transport;
      rasterDiagnostics.transportAttempts.push(transport);
      const attemptDiagnostic = { attempt, accepted: false, trace: null };
      try {
        const remainingMs = OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS - (Date.now() - requestStartedAt);
        if (remainingMs <= 0) throw Object.assign(new Error("Image analysis exceeded its total time limit. No new 3D scene was saved."), { code: "RASTER_VISION_TIMEOUT", status: 504 });
        const coordinateReference = attempt > 1 ? await rasterCoordinateReference(prepared.buffer, prepared.width, prepared.height) : null;
        const correction = attempt === 1 ? "" : `Revise your previous JSON against the original image. Validator observations follow as data: ${JSON.stringify({ code: previousFailure?.code, details: previousFailure?.details?.imageEvidence ? { unsupportedWalls: previousFailure.details.imageEvidence.walls.filter((w) => !w.passed).map(({ id, start, end, longestMissingPixels, missingSpans, openingIssues }) => ({ id, start, end, longestMissingPixels, missingSpans, openingIssues })) } : previousFailure?.details })}. missingSpans gives exact image-pixel endpoints of unsupported intervals, not replacement walls. Inspect each interval in the original image: follow a recess around its visible corners rather than bridging it, and discard furniture strokes mistaken for walls. Keep the footprint consistent with the corrected exterior wall contour. Correct the identified spans and affected topology. Preserve verified walls, visible recesses and readable measurement evidence. Recheck window symbols and both jambs of each door. Do not replace jambs with leaf tips, remove evidence to gain acceptance, or repeat a completed invalid wall across blank exterior space.`;
        const response = await requestRasterVision(
          (payload, options) => consumeRasterVisionStream(
            (request, requestOptions) => getOpenAIClient().responses.create(request, requestOptions),
            payload,
            options,
            transport,
            (event) => console.log("[VENTRA RASTER REQUEST]", event)
          ),
          {
            model: geometryModel,
            reasoning: { effort: "low" },
            max_output_tokens: 16e3,
            input: [{
              role: "user",
              content: [
                { type: "input_text", text: `${baselinePrompt}

${strokeEvidencePrompt}

Exact supplied image dimensions: width=${prepared.width} pixels, height=${prepared.height} pixels. All coordinates must use that pixel frame.` },
                { type: "input_image", image_url: prepared.imageUrl, detail: "high" },
                ...coordinateReference ? [
                  { type: "input_text", text: "The next image is the SAME source with a blue PIXEL ruler overlay. It is a coordinate reference, not another plan. Blue dashed lines and x=/y= labels are generated guides, never walls or metric dimensions. Use this ruler to locate all points in the FIRST image. Every point must satisfy 0 <= x <= " + prepared.width + " and 0 <= y <= " + prepared.height + ". Dimension values never define pixel coordinates: locate the printed extension lines visually. In particular, do not add a printed centimetre value to an endpoint to invent the other pixel endpoint." },
                  coordinateReference
                ] : []
              ]
            }, ...previousTrace ? [{ role: "assistant", content: JSON.stringify(previousTrace) }, { role: "user", content: correction }] : []],
            text: { format: { type: "json_schema", name: "ventra_raster_metric_trace", strict: true, schema: traceSchema } }
          },
          remainingMs
        );
        if (response.status === "incomplete" || !response.output_text) {
          throw new RasterGeometryError("INCOMPLETE_VISION_RESPONSE", "The image analysis did not return a complete trace. No new 3D scene was accepted.");
        }
        rasterDiagnostics.rawOutputText = response.output_text;
        const pixelTrace = extractJson(response.output_text);
        rasterDiagnostics.rawPixelTrace = pixelTrace;
        rasterDiagnostics.trace = null;
        rasterDiagnostics.imageEvidence = null;
        attemptDiagnostic.rawPixelTrace = pixelTrace;
        const rawGeometry = normalizeRasterPixelTrace(pixelTrace, { imageWidth: prepared.width, imageHeight: prepared.height });
        rasterDiagnostics.trace = rawGeometry;
        rasterDiagnostics.traceAttempt = attempt;
        attemptDiagnostic.trace = rawGeometry;
        const imageAlignment = inspectRasterImageEvidence(pixelTrace, imageEvidence);
        rasterDiagnostics.imageEvidence = imageAlignment;
        attemptDiagnostic.imageEvidence = imageAlignment;
        requireRasterImageEvidence(imageAlignment);
        const scene = compileRasterFloorplan(rawGeometry, { imageWidth: prepared.width, imageHeight: prepared.height });
        scene.geometryValidation.pixelSupport = imageAlignment.status;
        scene.geometryValidation.acceptanceBuild = RASTER_TRACE_BUILD;
        rasterDiagnostics.attempts.push({ ...attemptDiagnostic, accepted: true, elapsedMs: Date.now() - startedAt });
        rasterDiagnostics.elapsedMs = Date.now() - requestStartedAt;
        console.log("[VENTRA RASTER GEOMETRY ACCEPTED]", {
          routeVersion: RASTER_GEOMETRY_VERSION,
          attempt,
          elapsedMs: Date.now() - startedAt,
          roomCount: scene.rooms.length,
          wallCount: scene.walls.length,
          openingCount: scene.openings.length,
          footprintPointCount: scene.footprint.length,
          width: scene.width,
          depth: scene.depth,
          structuralChecks: scene.geometryValidation.structuralChecks,
          imageAgreement: scene.geometryValidation.imageAgreement
        });
        return NextResponse2.json({
          scene,
          diagnostics: { ...rasterDiagnostics, accepted: true, validation: scene.geometryValidation },
          source: attempt > 1 ? "openai-bounded-correction-raster-metric-trace" : "openai-single-pass-raster-metric-trace",
          mode,
          confidence: rawGeometry.confidence,
          // Passing geometric invariants is not proof of correct image recognition.
          needsManualReview: true,
          warning: "Wall pixel support and structural checks passed. Room labels, opening interpretation and completeness still require comparison with the source image. Unannotated heights remain schematic assumptions.",
          validation: scene.geometryValidation,
          routeVersion: RASTER_PREVIEW_VERSION
        });
      } catch (error2) {
        const failure = { code: error2?.code || null, message: error2?.message || "Raster trace failed.", details: error2 instanceof RasterGeometryError || error2?.name === "RasterImageEvidenceError" ? error2.details : void 0 };
        rasterDiagnostics.attempts.push({ ...attemptDiagnostic, ...failure, failure, elapsedMs: Date.now() - startedAt });
        if (attempt < RASTER_TRACE_MAX_ATTEMPTS && shouldRetryRasterGeometry(error2) && Date.now() - requestStartedAt < OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS) {
          previousFailure = error2;
          previousTrace = attemptDiagnostic.rawPixelTrace || null;
          console.warn("[VENTRA RASTER GEOMETRY RETRY]", { attempt, nextAttempt: attempt + 1, code: error2.code, message: error2.message });
          continue;
        }
        throw error2;
      }
    }
    throw new RasterGeometryError("INCOMPLETE_TRACE", "The image analysis did not produce an accepted trace. No new 3D scene was saved.");
  } catch (error2) {
    rasterDiagnostics.elapsedMs = Date.now() - requestStartedAt;
    const geometryFailure = error2 instanceof RasterGeometryError || error2?.name === "RasterImageEvidenceError";
    const details = geometryFailure ? error2.details : void 0;
    console.error("[VENTRA RASTER GEOMETRY REJECTED]", JSON.stringify({ build: RASTER_TRACE_BUILD, code: error2?.code, message: error2?.message, attempts: rasterDiagnostics.attempts.map(({ attempt, code, elapsedMs }) => ({ attempt, code, elapsedMs })), transport: rasterDiagnostics.transport }, null, 2));
    return NextResponse2.json({
      error: error2?.message || "Could not reconstruct this floor plan.",
      diagnostics: { ...rasterDiagnostics, accepted: false, failure: { code: error2?.code, message: error2?.message, details } },
      code: String(error2?.code || "").startsWith("RASTER_VISION_") ? error2.code : error2?.status === 429 ? "OPENAI_BILLING_OR_RATE_LIMIT" : geometryFailure ? error2.code : "FLOORPLAN_NEEDS_REVIEW",
      details,
      needsManualReview: true,
      routeVersion: RASTER_PREVIEW_VERSION
    }, { status: error2?.code === "RASTER_VISION_TIMEOUT" ? 504 : String(error2?.code || "").startsWith("RASTER_VISION_") ? 502 : error2?.status === 429 ? 429 : 422 });
  }
}

// src/lib/operatorAllowance.mjs
function isOperator(owner, env) {
  return !!env.VENTRA_FREE_USER_ID && owner === env.VENTRA_FREE_USER_ID;
}
function operatorAllowance(owner, baseLimit, env) {
  return isOperator(owner, env) ? 2147483647 : baseLimit;
}

// src/lib/serverCommercial.js
import { createHash as createHash3 } from "node:crypto";
import { createClient as createClient2 } from "@supabase/supabase-js";

// src/lib/serverBilling.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
function billingError(message, status) {
  return Object.assign(new Error(message), { status });
}
function provider() {
  if (!process.env.STRIPE_SECRET_KEY) throw billingError("Billing has not been configured by the site operator.", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
async function account(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw billingError("Please sign in to manage billing.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key2 = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key2) throw billingError("Account authentication is not configured.", 503);
  const db = createClient(url, key2, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error: error2 } = await db.auth.getUser(token);
  if (error2 || !data.user) throw billingError("Please sign in again.", 401);
  return data.user;
}
async function customerFor(stripe, user, create = false) {
  if (!/^[a-f0-9-]{36}$/i.test(user.id)) throw billingError("Invalid account identifier.", 400);
  const result = await stripe.customers.search({ query: `metadata['supabase_user_id']:'${user.id}'`, limit: 10 });
  if (result.has_more || result.data.length > 1) throw billingError("Multiple billing profiles found. Contact support.", 409);
  let customer = result.data[0];
  if (!customer && user.email) {
    const legacy = await stripe.customers.list({ email: user.email, limit: 100 });
    if (legacy.has_more) throw billingError("Billing profile needs support review.", 409);
    for (const candidate of legacy.data) {
      const subscriptions = await stripe.subscriptions.list({ customer: candidate.id, status: "all", limit: 100 });
      if (subscriptions.data.some((row) => row.metadata?.supabase_user_id === user.id)) {
        if (customer) throw billingError("Multiple billing profiles found. Contact support.", 409);
        customer = await stripe.customers.update(candidate.id, { metadata: { supabase_user_id: user.id } });
      }
    }
  }
  if (!customer && create) customer = await stripe.customers.create({ email: user.email, metadata: { supabase_user_id: user.id } }, { idempotencyKey: `ventra-customer-${user.id}` });
  return customer;
}
async function subscriptionFor(stripe, customer) {
  if (!customer) return null;
  const rows = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 100 });
  return rows.data.sort((a, b) => Number(["active", "trialing", "past_due", "unpaid", "incomplete"].includes(b.status)) - Number(["active", "trialing", "past_due", "unpaid", "incomplete"].includes(a.status)) || b.created - a.created)[0] || null;
}

// src/lib/commercialAccess.mjs
var COMMERCIAL_LIMITS = { active: 30, trialing: 5 };
function subscriptionAccess(subscription, priceId) {
  if (!priceId) throw Object.assign(new Error("The operator must configure the subscription price."), { status: 503 });
  const eligible = subscription && Object.hasOwn(COMMERCIAL_LIMITS, subscription.status) && subscription.items?.data?.some((item) => item.price?.id === priceId);
  if (!eligible) throw Object.assign(new Error("An active Ventra subscription or trial is required. Open Billing."), { status: 402, code: "SUBSCRIPTION_REQUIRED" });
  return { status: subscription.status, limit: COMMERCIAL_LIMITS[subscription.status] };
}
function validProjectId(id) {
  return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

// src/lib/serverCommercial.js
var fail4 = (message, status = 503, code = "COMMERCIAL_UNAVAILABLE") => Object.assign(new Error(message), { status, code });
function commercialAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key2) throw fail4("Commercial services are not configured. Contact support.");
  return createClient2(url, key2, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function commercialContext(request, projectId, verifiedUser = null) {
  const user = verifiedUser || await account(request);
  if (!validProjectId(projectId)) throw fail4("A valid project ID is required.", 400, "PROJECT_REQUIRED");
  const db = commercialAdmin();
  const { data: project3, error: error2 } = await db.from("projects").select("user_id").eq("id", projectId).maybeSingle();
  if (error2) throw fail4("Could not verify project access.");
  if (!project3) throw fail4("Project unavailable.", 403, "PROJECT_ACCESS_DENIED");
  if (project3.user_id !== user.id) {
    const member = await db.from("ventra_project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
    if (member.error || !["manager", "supervisor"].includes(member.data?.role)) throw fail4("You cannot run analysis for this project.", 403, "PROJECT_ACCESS_DENIED");
  }
  if (isOperator(project3.user_id, process.env)) return { user, db, owner: project3.user_id, status: "operator", limit: operatorAllowance(project3.user_id, 0, process.env) };
  const stripe = provider(), customer = await customerFor(stripe, { id: project3.user_id, email: project3.user_id === user.id ? user.email : void 0 });
  const subscription = await subscriptionFor(stripe, customer);
  const access = subscriptionAccess(subscription, process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID);
  return { user, db, owner: project3.user_id, ...access, limit: operatorAllowance(project3.user_id, access.limit, process.env) };
}
function commercialError(error2) {
  return Response.json({ success: false, error: error2.status ? error2.message : "Commercial service unavailable. Try later.", code: error2.code || "COMMERCIAL_UNAVAILABLE" }, { status: error2.status || 503 });
}
var running = /* @__PURE__ */ new Map();
var done = /* @__PURE__ */ new Map();
async function commercialRun(request, action, handler2) {
  try {
    const user = await account(request);
    const raw = await request.clone().text();
    if (raw.length > 12 * 1024 * 1024) throw fail4("Analysis request exceeds 12 MB.", 413, "REQUEST_TOO_LARGE");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw fail4("Invalid JSON request.", 400, "BAD_REQUEST");
    }
    const context = await commercialContext(request, body.projectId, user);
    const digest = createHash3("sha256").update(raw).digest("hex");
    const suppliedId = String(request.headers.get("x-ventra-request-id") || body.requestId || digest).slice(0, 180);
    const key2 = `${user.id}:${action}:${suppliedId}:${digest}`;
    for (const [id, row] of done) if (row.until < Date.now()) done.delete(id);
    if (done.has(key2)) return done.get(key2).response.clone();
    if (running.has(key2)) return (await running.get(key2)).clone();
    const task = (async () => {
      let reserved = false;
      async function release() {
        if (!reserved) return;
        reserved = false;
        try {
          const { error: error2 } = await context.db.rpc("ventra_release_analysis", { p_owner: context.owner, p_actor: user.id, p_project: body.projectId, p_action: action, p_request: suppliedId, p_hash: digest });
          if (error2) throw error2;
        } catch {
          console.error("[VENTRA USAGE RELEASE] Failed to release unsuccessful analysis; operator reconciliation required.", { projectId: body.projectId, action, requestId: suppliedId });
        }
      }
      if (action !== "boq") {
        if (!process.env.OPENAI_API_KEY) throw fail4("AI analysis is not configured. Contact support.");
        if (!isOperator(context.owner, process.env)) {
          const { data, error: error2 } = await context.db.rpc("ventra_consume_analysis", { p_owner: context.owner, p_actor: user.id, p_project: body.projectId, p_action: action, p_request: suppliedId, p_hash: digest, p_limit: context.limit });
          if (error2) throw fail4("Usage tracking is unavailable. Contact support.");
          if (!data?.accepted) throw fail4(data?.duplicate ? "This analysis was already submitted. Check the project result before retrying." : "Monthly analysis allowance reached. Open Billing.", data?.duplicate ? 409 : 429, data?.duplicate ? "ANALYSIS_ALREADY_SUBMITTED" : "ANALYSIS_LIMIT_REACHED");
        }
      }
      reserved = action !== "boq" && !isOperator(context.owner, process.env);
      try {
        body.requestId = key2;
        const headers2 = new Headers(request.headers);
        headers2.set("x-ventra-request-id", key2);
        headers2.delete("content-length");
        const scoped = new Request(request.url, { method: "POST", headers: headers2, body: JSON.stringify(body), signal: request.signal });
        let response;
        response = await handler2(scoped);
        if (!response.ok) await release();
        if (response.ok) {
          if (done.size >= 50) done.delete(done.keys().next().value);
          done.set(key2, { response: response.clone(), until: Date.now() + 3e5 });
        }
        return response;
      } catch (error2) {
        await release();
        throw error2;
      }
    })();
    running.set(key2, task);
    try {
      return await task;
    } finally {
      if (running.get(key2) === task) running.delete(key2);
    }
  } catch (error2) {
    return commercialError(error2);
  }
}

// src/lib/interiorPresentation.mjs
var xy = (a, s) => ({ x: Number.isFinite(a.xMeters) ? a.xMeters : Number(a.x ?? 0.5) * s.width, y: Number.isFinite(a.yMeters) ? a.yMeters : Number(a.y ?? 0.5) * s.depth });
var shape = (a, s, pad = 0) => {
  const p = xy(a, s), t = (Number(a.rotation) || 0) * Math.PI / 180;
  return { ...p, u: { x: Math.cos(t), y: Math.sin(t) }, v: { x: -Math.sin(t), y: Math.cos(t) }, hx: (Number(a.width) || 0.8) / 2 + pad, hy: (Number(a.depth) || 0.8) / 2 + pad };
};
var dot = (a, b) => a.x * b.x + a.y * b.y;
function furnitureOverlaps(a, b, s, gap = 0) {
  const x = shape(a, s, gap / 2), y = shape(b, s, gap / 2), d = { x: y.x - x.x, y: y.y - x.y };
  return [x.u, x.v, y.u, y.v].every((n) => Math.abs(dot(d, n)) < x.hx * Math.abs(dot(x.u, n)) + x.hy * Math.abs(dot(x.v, n)) + y.hx * Math.abs(dot(y.u, n)) + y.hy * Math.abs(dot(y.v, n)) - 1e-6);
}

// src/lib/sourceFurniture.mjs
var inside3 = (p, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
var heights = { sofa: 0.82, bed: 0.82, armchair: 0.85, chair: 0.88, dining_table: 0.76, coffee_table: 0.42, rug: 0.018, kitchen_counter: 0.88, sink: 0.86, stove: 0.9, refrigerator: 1.82, wardrobe: 2.05, tv_unit: 0.58, toilet: 0.78, shower: 2.05, washing_machine: 0.88, desk: 0.76, nightstand: 0.5, cabinet: 1.4, plant: 0.9 };
function tuckedChairPair(a, b) {
  const chair = a.type === "chair" ? a : b.type === "chair" ? b : null;
  const table3 = a.type === "dining_table" ? a : b.type === "dining_table" ? b : null;
  if (!chair || !table3 || chair.roomId !== table3.roomId) return false;
  const r = chair.rotation * Math.PI / 180, fx = -Math.sin(r), fy = Math.cos(r);
  const tx = table3.xMeters - chair.xMeters, ty = table3.yMeters - chair.yMeters;
  if (tx * fx + ty * fy <= 0) return false;
  const cut = Math.min(0.18, chair.depth * 0.45);
  const rear = { ...chair, depth: chair.depth - cut, xMeters: chair.xMeters - fx * cut / 2, yMeters: chair.yMeters - fy * cut / 2 };
  return !furnitureOverlaps(rear, table3, { width: 0, depth: 0 }, 0);
}
function compileSourceFurniture(observations, footprint, rooms, walls = []) {
  const assets = [], rejected = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [index, o] of (observations || []).entries()) {
    const reject = (reason) => rejected.push({ id: o.id || String(index), reason });
    const room = rooms.find((r) => r.id === o.roomId);
    if (!(o.type in heights) || !room) {
      reject("unknown_type_or_room");
      continue;
    }
    if (o.id && seen.has(o.id)) {
      reject("duplicate_observation_id");
      continue;
    }
    if (o.id) seen.add(o.id);
    let a = o.backLeft, b = o.backRight;
    const f = o.frontCenter;
    if (![a, b, f].every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) || !Number.isFinite(o.confidence) || o.confidence < 0.65) {
      reject("uncertain_observation");
      continue;
    }
    let dx = b.x - a.x, dy = b.y - a.y;
    const width = Math.hypot(dx, dy);
    if (width < 0.12 || width > 6) {
      reject("invalid_width");
      continue;
    }
    let nx = -dy / width, ny = dx / width;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let depth = (f.x - mx) * nx + (f.y - my) * ny;
    if (depth < 0) {
      [a, b] = [b, a];
      dx = -dx;
      dy = -dy;
      nx = -nx;
      ny = -ny;
      depth = -depth;
    }
    if (depth < 0.1 || depth > 4 || Math.abs((f.x - mx) * dx / width + (f.y - my) * dy / width) > 0.15) {
      reject("invalid_front_axis");
      continue;
    }
    let rearInset = 0;
    if (["kitchen_counter", "cabinet", "wardrobe", "tv_unit"].includes(o.type)) for (const w of walls) {
      const wx = w.end.x - w.start.x, wy = w.end.y - w.start.y, wl = Math.hypot(wx, wy);
      if (!wl || Math.abs((wx * dy - wy * dx) / (wl * width)) > 0.01) continue;
      const distance7 = (p) => Math.abs((p.x - w.start.x) * wy - (p.y - w.start.y) * wx) / wl;
      const along = (p) => ((p.x - w.start.x) * wx + (p.y - w.start.y) * wy) / wl;
      if (distance7(a) > 0.015 || distance7(b) > 0.015 || Math.min(along(a), along(b)) < -0.01 || Math.max(along(a), along(b)) > wl + 0.01) continue;
      const thickness = Number(w.thickness) || 0.12;
      if (thickness <= 0 || thickness > 0.3) continue;
      rearInset = Math.max(rearInset, thickness / 2 + 5e-3);
    }
    if (rearInset) {
      if (depth - rearInset < 0.1) {
        reject("insufficient_depth_at_wall");
        continue;
      }
      a = { x: a.x + nx * rearInset, y: a.y + ny * rearInset };
      b = { x: b.x + nx * rearInset, y: b.y + ny * rearInset };
      depth -= rearInset;
    }
    const corners = [a, b, { x: b.x + nx * depth, y: b.y + ny * depth }, { x: a.x + nx * depth, y: a.y + ny * depth }];
    const center = { x: mx + nx * (rearInset + depth / 2), y: my + ny * (rearInset + depth / 2) };
    if (!corners.map((p) => ({ x: p.x * 0.98 + center.x * 0.02, y: p.y * 0.98 + center.y * 0.02 })).every((p) => inside3(p, footprint))) {
      reject("outside_footprint");
      continue;
    }
    if (room.polygon?.length >= 3 && !corners.map((p) => ({ x: p.x * 0.98 + center.x * 0.02, y: p.y * 0.98 + center.y * 0.02 })).every((p) => inside3(p, room.polygon))) {
      reject("outside_assigned_room");
      continue;
    }
    const forwardPositive = ["sofa", "bed", "armchair", "chair"].includes(o.type);
    const asset = { id: o.id, groupId: o.groupId, roomId: o.roomId, type: o.type, xMeters: center.x, yMeters: center.y, width, depth, height: heights[o.type], rotation: Math.atan2(dy, dx) * 180 / Math.PI + (forwardPositive ? 0 : 180), placementSource: "source_image_observation_v1", sourceConfidence: o.confidence, embeddedInCounter: !!o.embeddedInCounter };
    if (rearInset) asset.sourceAdjustment = { reason: "rear_face_wall_contact", rearInsetMeters: rearInset, frontPreserved: true };
    const embeddedPair = (a2, b2) => a2.embeddedInCounter && b2.type === "kitchen_counter" || b2.embeddedInCounter && a2.type === "kitchen_counter";
    if (o.type !== "rug" && assets.some((a2) => a2.type !== "rug" && !embeddedPair(a2, asset) && !tuckedChairPair(a2, asset) && furnitureOverlaps(a2, asset, { width: 0, depth: 0 }, -0.03))) {
      reject("overlapping_furniture");
      continue;
    }
    if (o.type !== "rug" && walls.some((w) => {
      const dx2 = w.end.x - w.start.x, dy2 = w.end.y - w.start.y;
      const wall = { xMeters: (w.start.x + w.end.x) / 2, yMeters: (w.start.y + w.end.y) / 2, width: Math.hypot(dx2, dy2), depth: Number(w.thickness) || 0.12, rotation: Math.atan2(dy2, dx2) * 180 / Math.PI };
      return furnitureOverlaps(asset, wall, { width: 0, depth: 0 }, -0.04);
    })) {
      reject("intersects_wall");
      continue;
    }
    assets.push(asset);
  }
  return { assets, rejected };
}

// src/lib/fixedFurnitureRepair.mjs
function repairFixedFurniture(scene, boxes) {
  const review = scene?.furnishingReview, p = scene?.geometryValidation?.sourceProjection, b = p?.sourceBounds;
  if (review?.observationCoordinateMode !== "scene_meters_y_up" || !b || !(b.maxX > b.minX) || !(b.maxY > b.minY)) throw new Error("This scene has no source alignment for furniture repair.");
  const original = review.observations || [], rejected = new Set((review.rejected || []).map((x) => x.id));
  const map = (q) => ({ x: (q.x - b.minX) / (b.maxX - b.minX) * scene.width, y: (b.maxY - q.y) / (b.maxY - b.minY) * scene.depth });
  const replacements = /* @__PURE__ */ new Map();
  for (const box of boxes || []) {
    const old = original.find((o) => o.id === box.id);
    if (!old || !rejected.has(box.id) || replacements.has(box.id)) continue;
    const { left: l, right: r, top: t, bottom: d, front } = box;
    if (![l, r, t, d, box.confidence].every(Number.isFinite) || l < 0 || t < 0 || r > 1 || d > 1 || l >= r || t >= d || box.confidence < 0.65 || !["left", "right", "top", "bottom"].includes(front)) continue;
    let a, c, f;
    if (front === "right") {
      a = { x: l, y: t };
      c = { x: l, y: d };
      f = { x: r, y: (t + d) / 2 };
    }
    if (front === "left") {
      a = { x: r, y: t };
      c = { x: r, y: d };
      f = { x: l, y: (t + d) / 2 };
    }
    if (front === "bottom") {
      a = { x: l, y: t };
      c = { x: r, y: t };
      f = { x: (l + r) / 2, y: d };
    }
    if (front === "top") {
      a = { x: l, y: d };
      c = { x: r, y: d };
      f = { x: (l + r) / 2, y: t };
    }
    replacements.set(box.id, { ...old, backLeft: map(a), backRight: map(c), frontCenter: map(f), confidence: box.confidence });
  }
  const ordered = [...original.filter((o) => !rejected.has(o.id)), ...original.filter((o) => rejected.has(o.id)).map((o) => replacements.get(o.id) || o)];
  const result = compileSourceFurniture(ordered, scene.footprint, scene.rooms, scene.walls);
  const preserved = (scene.assets || []).filter((a) => !rejected.has(a.id));
  const restored = result.assets.filter((a) => rejected.has(a.id)).filter((a) => !preserved.some((b2) => a.type !== "rug" && b2.type !== "rug" && !(a.embeddedInCounter && b2.type === "kitchen_counter") && !(b2.embeddedInCounter && a.type === "kitchen_counter") && furnitureOverlaps(a, b2, scene, -0.03)));
  result.assets = [...preserved, ...restored];
  const restoredIds = new Set(restored.map((a) => a.id));
  result.rejected = [...result.rejected.filter((a) => rejected.has(a.id)), ...Array.from(rejected).filter((id) => !restoredIds.has(id) && !result.rejected.some((r) => r.id === id)).map((id) => ({ id, reason: "repair_not_validated" }))];
  const repairedIds = result.assets.filter((a) => rejected.has(a.id)).map((a) => a.id);
  return { ...scene, assets: result.assets, furnishingReview: { ...review, observations: ordered, acceptedCount: result.assets.length, rejected: result.rejected, requiresReview: result.rejected.length > 0, repair: { mode: "fixed_geometry", repairedIds } }, geometryValidation: { ...scene.geometryValidation, furnishing: { ...scene.geometryValidation.furnishing, assetCount: result.assets.length, byType: result.assets.reduce((counts, a) => (counts[a.type] = (counts[a.type] || 0) + 1, counts), {}), byRoom: scene.rooms.map((r) => ({ roomId: r.id, type: r.type, assetCount: result.assets.filter((a) => a.roomId === r.id).length, assetTypes: result.assets.filter((a) => a.roomId === r.id).map((a) => a.type) })) } } };
}

// src/lib/serverPreviewAnalysis.js
import { NextResponse as NextResponse3 } from "next/server.js";
import sharp8 from "sharp";

// src/lib/previewSceneWire.mjs
var aliases = {
  title: "t",
  confidence: "c",
  coordinateMode: "cm",
  widthMeters: "w",
  depthMeters: "d",
  footprint: "fp",
  rooms: "r",
  relationships: "rel",
  partitions: "p",
  openings: "o",
  furniture: "f",
  id: "i",
  name: "n",
  type: "t",
  labelVisible: "lv",
  printedWidthMeters: "pw",
  printedDepthMeters: "pd",
  polygon: "pg",
  groupId: "g",
  roomId: "r",
  backLeft: "bl",
  backRight: "br",
  frontCenter: "fc",
  embeddedInCounter: "ec",
  roomAId: "a",
  roomBId: "b",
  relation: "r",
  direction: "d",
  start: "s",
  end: "e",
  center: "p",
  heightMeters: "h",
  sillHeightMeters: "sh",
  wallIdHint: "wh",
  wallAxis: "ax",
  hingeSide: "hs",
  swingDirection: "sd"
};
var fail5 = (code, message) => Object.assign(new Error(message), { code });
function createPreviewWireCodec(originalSchema) {
  const legend = [];
  function compile(node, path) {
    if (node.type === "object") {
      const keys = Object.keys(node.properties);
      if (keys.length === 2 && keys.includes("x") && keys.includes("y") && node.properties.x.type === "number" && node.properties.y.type === "number") {
        return {
          schema: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          decode: (value) => ({ x: value[0], y: value[1] })
        };
      }
      const entries = keys.map((key2) => ({
        key: key2,
        alias: aliases[key2] || key2,
        child: compile(node.properties[key2], `${path}.${key2}`)
      }));
      if (new Set(entries.map((e) => e.alias)).size !== entries.length) throw new Error(`Duplicate preview wire keys at ${path}.`);
      legend.push(`${path}: ${entries.map((e) => `${e.alias}=${e.key}`).join(", ")}`);
      return {
        schema: {
          ...node,
          required: node.required.map((key2) => aliases[key2] || key2),
          properties: Object.fromEntries(entries.map((e) => [e.alias, e.child.schema]))
        },
        decode: (value) => Object.fromEntries(entries.map((e) => [e.key, e.child.decode(value[e.alias])]))
      };
    }
    if (node.type === "array") {
      const child = compile(node.items, `${path}[]`);
      return { schema: { ...node, items: child.schema }, decode: (value) => value.map(child.decode) };
    }
    return { schema: { ...node }, decode: (value) => value };
  }
  const compiled = compile(originalSchema, "scene");
  return {
    schema: compiled.schema,
    instructions: `WIRE FORMAT (same source observations, shorter JSON): return short keys as listed below. Every point is [x,y], not an object; polygons/footprint remain arrays of points. All preceding geometry rules use the original field names; map them using this legend. Preserve ALL observed objects and coordinate precision; do not omit observations to save tokens. Use concise unique IDs and source room labels. No prose or Markdown.
${legend.join("\n")}`,
    decode(value) {
      validate(value, compiled.schema, "scene");
      return compiled.decode(value);
    }
  };
}
function validate(value, schema, path) {
  const invalid = () => {
    throw fail5("PREVIEW_SCHEMA_INVALID", `Preview returned invalid scene data at ${path}. No new scene was saved.`);
  };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    if (schema.required.some((key2) => !Object.hasOwn(value, key2)) || Object.keys(value).some((key2) => !Object.hasOwn(schema.properties, key2))) invalid();
    for (const [key2, child] of Object.entries(schema.properties)) validate(value[key2], child, `${path}.${key2}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid();
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  } else if (typeof value !== schema.type || schema.type === "number" && !Number.isFinite(value)) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
}

// src/lib/serverPreviewAnalysis.js
var MODEL = process.env.OPENAI_3D_PREVIEW_MODEL || "gpt-5.6-sol";
var requestedReasoning = process.env.OPENAI_3D_PREVIEW_REASONING || "low";
var REASONING_EFFORT = ["low", "medium", "high"].includes(requestedReasoning) ? requestedReasoning : "low";
var requestedOutputTokens = Number(process.env.VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS || 8e3);
var MAX_OUTPUT_TOKENS = Number.isFinite(requestedOutputTokens) ? Math.max(3500, Math.min(8e3, requestedOutputTokens)) : 8e3;
var TIMEOUT_MS = Math.max(45e3, Math.min(18e4, Number(process.env.VENTRA_3D_PREVIEW_TIMEOUT_MS || 12e4)));
var pointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } }
};
var sceneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "confidence", "widthMeters", "depthMeters", "coordinateMode", "footprint", "rooms", "relationships", "partitions", "openings", "furniture"],
  properties: {
    title: { type: "string" },
    confidence: { type: "number" },
    coordinateMode: { type: "string", enum: ["image_normalized"] },
    widthMeters: { type: "number" },
    depthMeters: { type: "number" },
    footprint: { type: "array", minItems: 4, maxItems: 48, items: pointSchema },
    rooms: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "labelVisible", "printedWidthMeters", "printedDepthMeters", "polygon"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          labelVisible: { type: "boolean" },
          printedWidthMeters: { type: "number" },
          printedDepthMeters: { type: "number" },
          polygon: { type: "array", minItems: 3, maxItems: 24, items: pointSchema }
        }
      }
    },
    furniture: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "groupId", "roomId", "type", "backLeft", "backRight", "frontCenter", "confidence", "embeddedInCounter"],
        properties: {
          id: { type: "string" },
          groupId: { type: "string" },
          roomId: { type: "string" },
          type: { type: "string", enum: ["sofa", "bed", "armchair", "chair", "dining_table", "coffee_table", "rug", "kitchen_counter", "sink", "stove", "refrigerator", "wardrobe", "tv_unit", "toilet", "shower", "washing_machine", "desk", "nightstand", "cabinet", "plant"] },
          backLeft: pointSchema,
          backRight: pointSchema,
          frontCenter: pointSchema,
          confidence: { type: "number" },
          embeddedInCounter: { type: "boolean" }
        }
      }
    },
    relationships: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomAId", "roomBId", "relation", "direction", "confidence"],
        properties: {
          roomAId: { type: "string" },
          roomBId: { type: "string" },
          relation: { type: "string", enum: ["wall", "open", "door", "separate"] },
          direction: { type: "string", enum: ["left", "right", "above", "below", "overlap"] },
          confidence: { type: "number" }
        }
      }
    },
    partitions: {
      type: "array",
      maxItems: 96,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "start", "end"],
        properties: { id: { type: "string" }, start: pointSchema, end: pointSchema }
      }
    },
    openings: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "center", "widthMeters", "heightMeters", "sillHeightMeters", "wallIdHint", "wallAxis", "hingeSide", "swingDirection"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["door", "window"] },
          center: pointSchema,
          widthMeters: { type: "number" },
          heightMeters: { type: "number" },
          sillHeightMeters: { type: "number" },
          wallIdHint: { type: "string" },
          wallAxis: { type: "string", enum: ["horizontal", "vertical", "diagonal", "unknown"] },
          hingeSide: { type: "string" },
          swingDirection: { type: "string" }
        }
      }
    }
  }
};
function parseJson(text3) {
  const value = String(text3 || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
  }
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1));
  return null;
}
var sceneWire = createPreviewWireCodec(sceneSchema);
var furnitureWire = createPreviewWireCodec({
  type: "object",
  additionalProperties: false,
  required: ["furniture"],
  properties: { furniture: sceneSchema.properties.furniture }
});
async function prepareImage(imageUrl, signal) {
  if (!imageUrl) throw Object.assign(new Error("No floor-plan image URL was supplied."), { code: "PREVIEW_NO_IMAGE" });
  const response = await fetch(imageUrl, { cache: "no-store", signal });
  if (!response.ok) throw Object.assign(new Error(`Could not download the floor-plan image (${response.status}).`), { code: "PREVIEW_IMAGE_DOWNLOAD_FAILED" });
  const buffer = Buffer.from(await response.arrayBuffer());
  const image = sharp8(buffer, { failOn: "none" });
  const meta = await image.metadata();
  const maxSide = 1800;
  let pipeline = image.rotate().flatten({ background: "#ffffff" });
  if (Math.max(Number(meta.width || 0), Number(meta.height || 0)) > maxSide) {
    pipeline = pipeline.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
  }
  const prepared = await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  return {
    width: prepared.info.width,
    height: prepared.info.height,
    buffer: prepared.data,
    imageUrl: `data:image/png;base64,${prepared.data.toString("base64")}`
  };
}
var IMAGE_SCENE_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var imageSceneCache = globalThis.__ventraImageSceneCacheV20 || (globalThis.__ventraImageSceneCacheV20 = /* @__PURE__ */ new Map());
var PREVIEW_JOB_TTL_MS = 2 * 60 * 1e3;
var previewInFlight = globalThis.__ventraPreviewInFlightV4 || (globalThis.__ventraPreviewInFlightV4 = /* @__PURE__ */ new Map());
var previewCompleted = globalThis.__ventraPreviewCompletedV4 || (globalThis.__ventraPreviewCompletedV4 = /* @__PURE__ */ new Map());
function cleanupPreviewCache() {
  const now = Date.now();
  for (const [key2, entry] of previewCompleted.entries()) {
    if (!entry || entry.expiresAt <= now) previewCompleted.delete(key2);
  }
}
async function runFurnitureRepair(body) {
  const scene = body?.scene;
  try {
    const review = scene?.furnishingReview;
    if (!review?.observations?.length || !scene.geometryValidation?.sourceProjection?.sourceBounds) throw new Error("Source observations are unavailable for this scene.");
    const prepared = await prepareImage(body.imageUrl);
    const projection2 = scene.geometryValidation.sourceProjection;
    if (prepared.width !== projection2.imageWidth || prepared.height !== projection2.imageHeight) throw new Error("Choose the original plan image with the same dimensions.");
    const ids = new Set((review.rejected || []).map((x) => x.id));
    const targets = review.observations.filter((o) => ids.has(o.id));
    if (!targets.length) return NextResponse3.json({ scene, repairedCount: 0 });
    const schema = { "type": "object", "additionalProperties": false, "required": ["items"], "properties": { "items": { "type": "array", "maxItems": 80, "items": { "type": "object", "additionalProperties": false, "required": ["left", "right", "top", "bottom", "confidence", "id", "front"], "properties": { "left": { "type": "number" }, "right": { "type": "number" }, "top": { "type": "number" }, "bottom": { "type": "number" }, "confidence": { "type": "number" }, "id": { "type": "string" }, "front": { "type": "string", "enum": ["left", "right", "top", "bottom"] } } } } } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await getOpenAIClient().responses.create({ model: MODEL, reasoning: { effort: "none" }, max_output_tokens: 5e3, input: [{ role: "user", content: [{ type: "input_text", text: `Locate ONLY the listed rejected furniture in the original plan. Return full-image normalized bounding rectangles and the direction their FRONT faces in image coordinates (Y down). Trace the WHOLE bed, not a pillow. Bed front points from headboard toward foot. Sofa front points from backrest to seating. TV front faces viewers. Counters front faces the room. Preserve exact source positions, no redesign. For components of the same L sofa/counter, rectangles must meet at the corner without overlapping area. Do not invent missing objects; omit uncertain objects. Use the exact supplied IDs. Do not return or modify architecture. The fixed room/wall coordinates are metres Y-up, mapped using sourceBounds and scene width/depth. Targets: ${JSON.stringify(targets)}. Fixed alignment: ${JSON.stringify(projection2)}. Width/depth: ${scene.width},${scene.depth}. Rooms: ${JSON.stringify(scene.rooms)}. Walls: ${JSON.stringify(scene.walls)}.` }, { type: "input_image", image_url: prepared.imageUrl, detail: "high" }] }], text: { format: { type: "json_schema", name: "fixed_furniture_repair", strict: true, schema } } }, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== "completed") throw new Error("Furniture extraction did not complete. The current scene was preserved.");
    const raw = parseJson(response.output_text || "");
    if (!Array.isArray(raw?.items)) throw new Error("Furniture response was invalid.");
    const next = repairFixedFurniture(scene, raw.items);
    return NextResponse3.json({ scene: next, repairedCount: next.furnishingReview.repair.repairedIds.length });
  } catch (error2) {
    return NextResponse3.json({ error: error2?.message || "Furniture repair failed; current scene preserved." }, { status: 422 });
  }
}
async function handleCommercialRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse3.json({ error: "Preview request body was empty or invalid JSON.", code: "PREVIEW_BAD_REQUEST" }, { status: 400 });
  }
  if (body?.mode === "repair_furniture") return runFurnitureRepair(body);
  cleanupPreviewCache();
  const requestId = String(body?.requestId || request.headers.get("x-ventra-request-id") || "").trim();
  const cacheKey = requestId || `${body?.projectId || "project"}:${body?.fileName || "image"}`;
  const completed = previewCompleted.get(cacheKey);
  if (completed?.response) {
    console.log("[VENTRA PREVIEW RESPONSE CACHE HIT v4]", { requestId: cacheKey });
    return completed.response.clone();
  }
  const existing = previewInFlight.get(cacheKey);
  if (existing) {
    console.log("[VENTRA PREVIEW REQUEST COALESCED v4]", { requestId: cacheKey });
    const response = await existing;
    return response.clone();
  }
  const task = runRasterPreview(body);
  previewInFlight.set(cacheKey, task);
  try {
    const response = await task;
    previewCompleted.set(cacheKey, { response: response.clone(), expiresAt: Date.now() + PREVIEW_JOB_TTL_MS });
    return response;
  } finally {
    if (previewInFlight.get(cacheKey) === task) previewInFlight.delete(cacheKey);
  }
}
async function runPreviewRequest(request) {
  return commercialRun(request, "preview", handleCommercialRequest);
}

// src/lib/serverPreviewJobs.js
import { createHash as createHash4, randomBytes } from "node:crypto";
var table = "ventra_preview_jobs";
var nonceHash = (value) => createHash4("sha256").update(value).digest("hex");
async function executePreviewJob(input, run) {
  if (!/^[a-f0-9-]{36}$/i.test(input?.id || "") || !/^\w{64}$/.test(input?.nonce || "") || !/^Bearer .+$/.test(input?.authorization || "")) return;
  const db = commercialAdmin(), { data: job, error: error2 } = await db.from(table).update({ status: "running" }).eq("id", input.id).eq("status", "queued").eq("nonce_hash", nonceHash(input.nonce)).select("request_body,actor_id").maybeSingle();
  if (error2) throw error2;
  if (!job) return;
  let result, httpStatus = 500;
  try {
    const { __backgroundAction = "preview", __expectedRasterBuild, ...body } = job.request_body;
    if (!["preview", "boq"].includes(__backgroundAction)) throw billingError("Invalid analysis action.", 400);
    const request = new Request(`https://ventra.internal/api/ai/${__backgroundAction === "boq" ? "generate-boq" : "design-3d-preview"}`, { method: "POST", headers: { authorization: input.authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
    const user = await account(request);
    if (user.id !== job.actor_id) throw billingError("Analysis job access denied.", 403);
    if (__expectedRasterBuild && __expectedRasterBuild !== VERIFIED_PREVIEW_VERSION) throw Object.assign(billingError("The background analysis build differs from the requesting build. No AI request was made.", 503), { code: "PREVIEW_WORKER_BUILD_MISMATCH" });
    const response = await run(request, __backgroundAction);
    httpStatus = response.status;
    result = await response.json();
  } catch (error3) {
    result = { error: error3.status ? error3.message : "Background analysis failed. Retry or contact support.", code: error3.code || "PREVIEW_BACKGROUND_FAILED" };
    httpStatus = error3.status || 500;
  }
  const saved = await db.from(table).update({ status: httpStatus < 400 ? "completed" : "failed", http_status: httpStatus, result, request_body: null, nonce_hash: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", input.id).eq("status", "running");
  if (saved.error) throw saved.error;
}

// src/lib/pdfRoomInventory.mjs
function recoverPdfRoomInventory(page) {
  if (page.page_evidence?.kind !== "floor_plan") return { page, warnings: [] };
  const rooms = /* @__PURE__ */ new Map(), warnings = [];
  for (const item of page.detected_items || []) {
    if (!["m2", "m\xB2"].includes(String(item.unit).toLowerCase()) || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const tag = String(item.name || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
    if (!tag) continue;
    if (rooms.has(tag)) {
      warnings.push(`Duplicate room area tag ${tag} on page ${page.pageNumber}; inventory withheld.`);
      return { page, warnings };
    }
    const name2 = String(item.name || ""), description = String(item.description || "");
    const finish = /\bVOID\b/i.test(name2) || /^VOID\b/i.test(description) ? "void" : /\bterrace\b|\bbalcony\b/i.test(name2) || /^OUTDOOR\b/i.test(description) ? "outdoor" : /^WOOD\b|^parquet\b/i.test(description) ? "wood" : /^EPOXY\b/i.test(description) ? "epoxy" : /^TILE\b|^ceramic\b/i.test(description) ? "tile" : null;
    rooms.set(tag, { ...item, tag, finish });
  }
  if (!rooms.size) return { page, warnings };
  const list2 = [...rooms.values()], enclosed = list2.filter((r) => !["void", "outdoor"].includes(r.finish)), outdoor = list2.filter((r) => r.finish === "outdoor");
  const inner = enclosed.reduce((s, r) => s + r.quantity, 0), outside = outdoor.reduce((s, r) => s + r.quantity, 0), walkable = inner + outside;
  if (Math.abs(page.floor_area - walkable) > 0.01 && Math.abs(page.floor_area - inner) > 0.01) {
    warnings.push(`Room area inventory on page ${page.pageNumber} does not reconcile to its floor summary; finish recovery withheld.`);
    return { page, warnings };
  }
  const values = { floor_area: walkable }, scope2 = page.page_evidence.scope_id;
  const materialKeys = { wood: "wood_floor_area", tile: "ceramic_floor_area", epoxy: "epoxy_floor_area", outdoor: "terrace_floor_area" };
  for (const [finish, key2] of Object.entries(materialKeys)) {
    const matching = list2.filter((r) => r.finish === finish);
    if (!matching.length) continue;
    if ((page.page_evidence.quantities || []).some((q) => q.key === key2)) continue;
    values[key2] = matching.reduce((s, r) => s + r.quantity, 0);
  }
  const quantities = (page.page_evidence.quantities || []).filter((q) => q.key !== "floor_area");
  for (const [key2, value] of Object.entries(values)) quantities.push({
    key: key2,
    value,
    unit: "m2",
    scope_id: scope2,
    evidence: `Tagged room inventory on page ${page.pageNumber} reconciles to floor summary; ${key2}: ` + list2.filter((r) => key2 === "floor_area" ? r.finish !== "void" : r.finish === Object.keys(materialKeys).find((k) => materialKeys[k] === key2)).map((r) => `${r.tag}=${r.quantity} m2 (${r.description})`).join(" + ") + `. AI room labels/materials require review.`
  });
  return { page: { ...page, floor_area: walkable, page_evidence: { ...page.page_evidence, quantities } }, warnings };
}

// src/lib/pdfNativeRoomInventory.mjs
var tagOf = (value) => String(value || "").trim().match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
var finishOf = (value) => {
  const text3 = String(value || "").toUpperCase(), values = new Set([...text3.matchAll(/(?:^|\||\/|M(?:2|²)\s+)\s*(WOOD|TILE|EPOXY|OUTDOOR|VOID)\b/g)].map((m) => m[1].toLowerCase()));
  if (/\bVOID\s*$/.test(text3)) values.add("void");
  return values.size === 1 ? [...values][0] : null;
};
var printedArea = (value) => String(value || "").match(/(?:^|\s|\|)(\d+(?:\.\d+)?)\s*m(?:2|²)(?=\s|$|\|)/i);
function recoverNativeRoomInventory(page, validatedSpaces) {
  const original = page.detected_items || [], native = page.native_plan_text;
  if (native?.status !== "readable" || !Array.isArray(native.spans) || native.spans.length > 3e3) return { items: original, recovered: [] };
  const shapes = new Map(validatedSpaces.map((s) => [tagOf(s.tag), s])), captions = /* @__PURE__ */ new Map(), recovered = [];
  for (const span of native.spans) {
    const tag = tagOf(span.text);
    if (!tag || !/^\S+\s+\S/.test(span.text)) continue;
    const list2 = captions.get(tag) || [];
    list2.push(span);
    captions.set(tag, list2);
  }
  const items = [...original];
  for (const [tag, rows] of captions) {
    if (rows.length !== 1 || original.some((i) => tagOf(i.name) === tag && ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()))) continue;
    const caption = rows[0], shape2 = shapes.get(tag), inline = printedArea(caption.text);
    const neighbours = native.spans.filter((s) => Math.abs(caption.angle || 0) < 1e-3 && s !== caption && Math.abs(s.angle || 0) < 1e-3 && s.y < caption.y && caption.y - s.y <= 2.5 * caption.height && Math.abs(s.x - caption.x) <= Math.max(20, 4 * caption.height) && printedArea(s.text) && finishOf(s.text));
    if (!inline && neighbours.length > 1) continue;
    const areaLine = inline ? caption : neighbours.length === 1 ? neighbours[0] : null;
    const finish = finishOf(caption.text) || finishOf(areaLine?.text);
    if (!finish) continue;
    if (finishOf(caption.text) && finishOf(areaLine?.text) && finishOf(caption.text) !== finishOf(areaLine.text)) continue;
    const match = areaLine && printedArea(areaLine.text), labelArea = match ? Number(match[1]) : null;
    const quantity = labelArea ?? shape2?.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) continue;
    if (shape2 && (finish === "void" ? shape2.kind !== "void" : finish === "outdoor" ? shape2.kind !== "outdoor" : shape2.kind !== "enclosed") || shape2 && finish !== "void" && shape2.finish !== finish) continue;
    const evidence = labelArea !== null ? `printed source label: ${caption.text}; ${areaLine.text}` : `independently dimensioned polygon for source label ${caption.text}; ${shape2.evidence}`;
    const name2 = caption.text.trim().replace(/\s*\|.*$/, "").replace(/\s*\/\s*(?:WOOD|TILE|EPOXY|OUTDOOR|VOID)\s*$/i, "");
    items.push({ name: name2, unit: "m2", quantity, description: `${finish.toUpperCase()} | ${evidence}` });
    recovered.push({ tag, page: page.pageNumber, basis: labelArea !== null ? "native_printed_area" : "existing_validated_polygon", source_label: caption.text });
  }
  return { items, recovered };
}

// src/lib/pdfNativeWallGeometry.mjs
var EPS2 = 1e-5;
var near = (a, b) => Math.abs(a - b) < EPS2;
var round2 = (n) => Math.round(n * 1e6) / 1e6;
var dist2 = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
var signed = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
function contains(poly, p) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > p.y !== poly[j].y > p.y && p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) yes = !yes;
  return yes;
}
function facesOf(walls) {
  const nodes = /* @__PURE__ */ new Map(), edges2 = [];
  const node = (p) => {
    const id = `${round2(p.x)},${round2(p.y)}`;
    if (!nodes.has(id)) nodes.set(id, { ...p, id, to: [] });
    return nodes.get(id);
  };
  for (const w of walls) {
    const points = [w.a, w.b];
    for (const other of walls) for (const p of [other.a, other.b]) if (dist2(p, w.a, w.b) < EPS2) points.push(p);
    for (const other of walls) if (w.axis !== other.axis) {
      const h = w.axis === "h" ? w : other, v = w.axis === "v" ? w : other, p = { x: v.a.x, y: h.a.y };
      if (dist2(p, h.a, h.b) < EPS2 && dist2(p, v.a, v.b) < EPS2) points.push(p);
    }
    const sorted = [...new Map(points.map((p) => [`${round2(p.x)},${round2(p.y)}`, p])).values()].sort((a, b) => w.axis === "h" ? a.x - b.x : a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      const a = node(sorted[i - 1]), b = node(sorted[i]);
      if (!a.to.includes(b.id)) {
        a.to.push(b.id);
        b.to.push(a.id);
        edges2.push([a.id, b.id], [b.id, a.id]);
      }
    }
  }
  for (const n of nodes.values()) n.to.sort((a, b) => Math.atan2(nodes.get(a).y - n.y, nodes.get(a).x - n.x) - Math.atan2(nodes.get(b).y - n.y, nodes.get(b).x - n.x));
  const visited = /* @__PURE__ */ new Set(), faces = [];
  for (const edge of edges2) {
    let [a, b] = edge;
    const start = a + "|" + b;
    if (visited.has(start)) continue;
    const polygon3 = [];
    let closed = false;
    for (let guard = 0; guard <= edges2.length; guard++) {
      const id = a + "|" + b;
      if (visited.has(id)) {
        closed = id === start;
        break;
      }
      visited.add(id);
      polygon3.push(nodes.get(a));
      const n = nodes.get(b), index = n.to.indexOf(a), next = n.to[(index + n.to.length - 1) % n.to.length];
      a = b;
      b = next;
    }
    if (closed && polygon3.length >= 3 && signed(polygon3) > EPS2) faces.push({ polygon: polygon3.map(({ x, y }) => ({ x, y })), area: signed(polygon3) });
  }
  return faces;
}
function measureNativeWallFloor(page, schedule) {
  const audit = { page: page.pageNumber, status: "pending", method: "calibrated_centreline_graph", warnings: [] };
  try {
    const text3 = page.native_plan_text, graphics = page.native_graphics;
    if (text3?.status !== "readable" || graphics?.status !== "readable" || schedule?.status !== "read") throw Error("Readable plan text, vectors and complete opening table are required");
    if (graphics.strokes.length > 5e3 || schedule.rows.length > 300) throw Error("Native wall graph size limit; independent extraction required");
    const all = text3.spans.map((s) => s.text).join(" "), envelopes = [...all.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)];
    const declared = [...all.matchAll(/all dimensions (?:in|are)\s*(millimet(?:re|er)s|centimet(?:re|er)s|met(?:re|er)s|mm|cm|m)\b/gi)].map((m) => /^milli|^mm$/i.test(m[1]) ? 1e-3 : /^centi|^cm$/i.test(m[1]) ? 0.01 : 1);
    if (envelopes.length !== 1 || !declared.length || new Set(declared).size !== 1 || !/datum\s*:\s*wall cent(?:re|er)lines/i.test(all)) throw Error("Explicit metric envelope and wall-centreline datum are required");
    const dimensionFactor = declared[0], ew = Number(envelopes[0][1]) * dimensionFactor, eh = Number(envelopes[0][2]) * dimensionFactor, ext = all.match(/External:\s*(\d+(?:\.\d+)?)\s*mm/i), int = all.match(/Internal:\s*(\d+(?:\.\d+)?)\s*mm/i);
    if (!(ew > 0 && eh > 0) || !ext || !int || !(Number(ext[1]) > 0 && Number(int[1]) > 0) || Number(ext[1]) === Number(int[1])) throw Error("Two explicit distinct source wall thickness classes are required");
    const styles = /* @__PURE__ */ new Map();
    for (const s of graphics.strokes) {
      if (s.dash?.length) continue;
      const id = s.width.toFixed(5) + "|" + s.color.map((n) => n.toFixed(5)).join(",");
      if (!styles.has(id)) styles.set(id, { width: s.width, color: s.color, paths: [] });
      styles.get(id).paths.push(s);
    }
    if (styles.size > 50) throw Error("Excessive source line styles");
    const pairs = [];
    for (const outer2 of styles.values()) for (const inner2 of styles.values()) {
      if (!(outer2.width > 0 && inner2.width > 0) || outer2.width === inner2.width || JSON.stringify(outer2.color) !== JSON.stringify(inner2.color) || Math.abs(outer2.width / inner2.width - Number(ext[1]) / Number(int[1])) > 0.01) continue;
      if (outer2.paths.some((p) => p.curved) || inner2.paths.some((p) => p.curved)) continue;
      const pts = outer2.paths.flatMap((s) => s.segments.flatMap((l) => [l.a, l.b]));
      if (!pts.length) continue;
      const x02 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), y02 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y)), sx = (x1 - x02) / ew, sy = (y1 - y02) / eh;
      if (sx > 0 && Math.abs(sx - sy) / sx < 1e-3) pairs.push({ outer: outer2, inner: inner2, x0: x02, y0: y02, scale: (sx + sy) / 2 });
    }
    if (pairs.length !== 1) throw Error("Wall stroke classes or envelope calibration are ambiguous");
    const { outer, inner, x0, y0, scale } = pairs[0], toMetres = (p) => ({ x: round2((p.x - x0) / scale), y: round2((p.y - y0) / scale) });
    const numeric = text3.spans.filter((s) => /^\d+(?:\.\d+)?$/.test(s.text));
    const widthAnchors = numeric.filter((s) => near(Number(s.text) * dimensionFactor, ew) && Math.abs(s.angle || 0) < EPS2 && s.y < y0 && y0 - s.y < 6 * s.height && Math.abs(s.x - (x0 + ew * scale / 2)) < 2 * s.height);
    const heightAnchors = numeric.filter((s) => near(Number(s.text) * dimensionFactor, eh) && Math.abs(Math.abs(s.angle || 0) - Math.PI / 2) < EPS2 && s.x < x0 && x0 - s.x < 6 * s.height && Math.abs(s.y - (y0 + eh * scale / 2)) < 2 * s.height);
    if (widthAnchors.length !== 1 || heightAnchors.length !== 1) throw Error("Independent overall dimension anchors do not confirm the envelope scale");
    const spans = text3.spans.filter((s) => Math.abs(s.angle || 0) < EPS2).map((s) => ({ ...s, ...toMetres(s), height: s.height / scale }));
    const groups = /* @__PURE__ */ new Map();
    for (const [style, classification] of [[outer, "external"], [inner, "internal"]]) for (const path of style.paths) for (const segment of path.segments) {
      let a = toMetres(segment.a), b = toMetres(segment.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < EPS2) continue;
      const axis = near(a.y, b.y) ? "h" : near(a.x, b.x) ? "v" : null;
      if (!axis) throw Error("Only orthogonal centreline walls are supported");
      if (axis === "h" ? a.x > b.x : a.y > b.y) [a, b] = [b, a];
      const fixed = axis === "h" ? a.y : a.x, id = `${classification}:${axis}:${fixed}`;
      if (!groups.has(id)) groups.set(id, { classification, axis, fixed, pieces: [] });
      groups.get(id).pieces.push({ a: axis === "h" ? a.x : a.y, b: axis === "h" ? b.x : b.y });
    }
    const gaps = [];
    for (const g of groups.values()) {
      const sorted = g.pieces.sort((a, b) => a.a - b.a), merged = [];
      for (const p of sorted) {
        const last = merged.at(-1);
        if (last && p.a <= last.b + EPS2) last.b = Math.max(last.b, p.b);
        else merged.push({ ...p });
      }
      g.pieces = merged;
      for (let i = 1; i < merged.length; i++) {
        const a = merged[i - 1].b, b = merged[i].a;
        gaps.push({ g, a, b, width: b - a });
      }
    }
    const bindings = [];
    for (const opening of schedule.rows) {
      const labels = spans.filter((s) => s.text.trim().toLowerCase() === opening.id.toLowerCase());
      if (labels.length !== 1) throw Error("Opening tag missing or repeated on the source plan: " + opening.id);
      const label = labels[0], candidates = gaps.filter((g) => Math.abs(g.width - opening.width) < 1e-3 && Math.abs((g.g.axis === "h" ? label.y : label.x) - g.g.fixed) < 3.5 * label.height && (g.g.axis === "h" ? label.x : label.y) > g.a - label.height && (g.g.axis === "h" ? label.x : label.y) < g.b + label.height);
      if (candidates.length !== 1 || bindings.some((b) => b.gap === candidates[0])) throw Error("Opening gap or tag location is ambiguous: " + opening.id);
      bindings.push({ opening, gap: candidates[0] });
    }
    const walls = [];
    for (const g of groups.values()) {
      const pieces = [];
      for (const piece of g.pieces) {
        const last = pieces.at(-1), bridge = last && bindings.find((b) => b.gap.g === g && near(b.gap.a, last.b) && near(b.gap.b, piece.a));
        if (bridge) last.b = piece.b;
        else pieces.push({ ...piece });
      }
      const divided = [];
      for (const p of pieces) {
        const attached = bindings.filter((o) => o.gap.g === g && o.gap.a >= p.a - EPS2 && o.gap.b <= p.b + EPS2).sort((a, b) => a.gap.a - b.gap.a), cuts = [];
        for (let i = 1; i < attached.length; i++) if (attached[i - 1].opening.wall_id && attached[i].opening.wall_id && attached[i - 1].opening.wall_id !== attached[i].opening.wall_id) {
          const junctions = [...new Set([...groups.values()].filter((other) => other.axis !== g.axis && other.fixed > attached[i - 1].gap.b + EPS2 && other.fixed < attached[i].gap.a - EPS2 && other.pieces.some((piece) => g.fixed >= piece.a - EPS2 && g.fixed <= piece.b + EPS2)).map((other) => other.fixed))];
          if (junctions.length !== 1) throw Error("Different source host IDs require one unambiguous intervening wall junction");
          cuts.push(junctions[0]);
        }
        const bounds2 = [p.a, ...cuts, p.b];
        for (let i = 1; i < bounds2.length; i++) divided.push({ a: bounds2[i - 1], b: bounds2[i] });
      }
      for (const p of divided) {
        const a = g.axis === "h" ? { x: p.a, y: g.fixed } : { x: g.fixed, y: p.a }, b = g.axis === "h" ? { x: p.b, y: g.fixed } : { x: g.fixed, y: p.b };
        const attached = bindings.filter((o) => o.gap.g === g && o.gap.a >= p.a - EPS2 && o.gap.b <= p.b + EPS2), hosts = [...new Set(attached.map((o) => o.opening.wall_id).filter(Boolean))];
        if (hosts.length > 1) throw Error(`Physical wall ${g.axis}:${g.fixed}:${p.a}:${p.b} maps to conflicting source host IDs: ${hosts.join(", ")}`);
        walls.push({ id: hosts[0] || `native:${g.axis}:${g.fixed}:${p.a}:${p.b}`, a, b, axis: g.axis, classification: g.classification, length: round2(p.b - p.a), openings: attached.map((o) => o.opening.id) });
      }
    }
    const discarded = [];
    if (walls.length > 300) throw Error("Native wall graph exceeds bounded connectivity check");
    for (const w of [...walls]) if (w.classification === "internal" && [w.a, w.b].every((p) => !walls.some((other) => other !== w && dist2(p, other.a, other.b) < EPS2))) {
      const tv = spans.find((s) => /^TV$/i.test(s.text.trim()) && dist2(s, w.a, w.b) < 3 * s.height);
      if (!tv) throw Error("Unclassified isolated wall-weight stroke");
      discarded.push({ a: w.a, b: w.b, source_label: tv.text, reason: "Isolated annotated TV object; requires source review" });
      walls.splice(walls.indexOf(w), 1);
    }
    for (const w of walls) for (const p of [w.a, w.b]) if (!walls.some((other) => other !== w && dist2(p, other.a, other.b) < EPS2)) throw Error("Unclosed wall endpoint; untagged gap or free-standing wall requires review");
    const external = walls.filter((w) => w.classification === "external");
    for (const w of external) for (const p of [w.a, w.b]) if (external.filter((other) => other !== w && dist2(p, other.a, other.b) < EPS2).length !== 1) throw Error("External centreline envelope is not a single closed boundary");
    const faces = facesOf(walls);
    if (!faces.length || faces.length > 200) throw Error("Closed wall faces unavailable");
    const roomSpans = text3.spans.map((s) => ({ ...s, ...toMetres(s) }));
    for (const face of faces) {
      face.tags = roomSpans.filter((s) => /^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i.test(s.text.trim()) && contains(face.polygon, s)).map((s) => s.text.trim().match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)[0]);
      face.opening_ids = bindings.filter((o) => {
        const g = o.gap, p = g.g.axis === "h" ? { x: (g.a + g.b) / 2, y: g.g.fixed } : { x: g.g.fixed, y: (g.a + g.b) / 2 };
        return face.polygon.some((a, i) => dist2(p, a, face.polygon[(i + 1) % face.polygon.length]) < EPS2);
      }).map((o) => o.opening.id);
    }
    for (const d of discarded) {
      const enclosing = faces.filter((f) => f.tags.length === 1 && contains(f.polygon, d.a) && contains(f.polygon, d.b));
      if (enclosing.length !== 1) throw Error("Isolated annotation is not inside one tagged source room");
      d.room_tag = enclosing[0].tags[0];
    }
    Object.assign(audit, {
      status: "provisional",
      calibration: { width_m: ew, height_m: eh, points_per_m: scale, source_dimension_factor_to_m: dimensionFactor, origin: { x: x0, y: y0 } },
      wall_styles: { external: outer.width, internal: inner.width },
      discarded_annotations: discarded,
      opening_bindings: bindings.map((o) => ({ id: o.opening.id, host: o.opening.wall_id, gap_width_m: o.gap.width })),
      wall_count: walls.length,
      requires_review: true
    });
    const openingPlacements = bindings.map(({ opening, gap }) => {
      const wall = walls.find((w) => w.openings.includes(opening.id));
      const middle = gap.g.axis === "h" ? { x: (gap.a + gap.b) / 2, y: gap.g.fixed } : { x: gap.g.fixed, y: (gap.a + gap.b) / 2 };
      const offset = wall.axis === "h" ? (middle.x - wall.a.x) / wall.length : (middle.y - wall.a.y) / wall.length;
      return { ...opening, wallId: wall.id, offset, center: middle };
    });
    return { status: "provisional", walls, faces, audit, openingPlacements, externalWallThickness: Number(ext[1]) * 1e-3, wallThickness: Number(int[1]) * 1e-3 };
  } catch (e) {
    audit.reason = e.message;
    return { status: "pending", walls: [], faces: [], audit };
  }
}

// src/lib/pdfNativeClearPlan.mjs
var E = 2e-4;
var near2 = (a, b) => Math.abs(a - b) < E;
var distance6 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var cross3 = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
var on = (p, a, b) => Math.abs(cross3(a, b, p)) < E && p.x >= Math.min(a.x, b.x) - E && p.x <= Math.max(a.x, b.x) + E && p.y >= Math.min(a.y, b.y) - E && p.y <= Math.max(a.y, b.y) + E;
var signed2 = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
var bounds = (p) => ({ x0: Math.min(...p.map((p2) => p2.x)), x1: Math.max(...p.map((p2) => p2.x)), y0: Math.min(...p.map((p2) => p2.y)), y1: Math.max(...p.map((p2) => p2.y)) });
function inside4(p, polygon3) {
  let yes = false;
  for (let i = 0, j = polygon3.length - 1; i < polygon3.length; j = i++) if (polygon3[i].y > p.y !== polygon3[j].y > p.y && p.x < (polygon3[j].x - polygon3[i].x) * (p.y - polygon3[i].y) / (polygon3[j].y - polygon3[i].y) + polygon3[i].x) yes = !yes;
  return yes;
}
var textOf = (p) => p.native_text_evidence?.status === "readable" ? p.native_text_evidence.spans.map((s) => s.text).join(" ") : "";
var unique = (values, label) => {
  if (values.length !== 1) throw Error("Ambiguous or missing " + label);
  return values[0];
};
function pairList(text3) {
  const pairs = [];
  for (const m of text3.matchAll(/\b([A-Z])\/([A-Z])(\d+)-to-\1\/\2(\d+)\b/g)) for (const prefix of [m[1], m[2]]) pairs.push([prefix + m[3], prefix + m[4]]);
  for (const m of text3.matchAll(/\b([A-Z]+\d+)-to-([A-Z]+\d+)\b/g)) pairs.push([m[1], m[2]]);
  return pairs;
}
function measureNativeClearPlan(page, sourcePages = []) {
  const audit = { page: page.pageNumber, status: "pending", method: "native_clear_axis_graph", requires_review: true };
  try {
    const text3 = page.native_plan_text, graphics = page.native_graphics;
    if (text3?.status !== "readable" || graphics?.status !== "readable" || graphics.strokes.length > 5e3 || text3.spans.length > 3e3) throw Error("Bounded readable plan text and vectors required");
    const all = text3.spans.map((s) => s.text).join(" "), source2 = sourcePages.map((p) => ({ page: p.pageNumber, text: textOf(p) }));
    if (!/Units:\s*metres unless noted/i.test(all)) throw Error("Explicit metre coordinate units required");
    const polyText = unique([...all.matchAll(/CL polygon:\s*((?:\([^()]+\)\s*)+)\./gi)], "source CL polygon")[1];
    const envelope = [...polyText.matchAll(/\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    if (envelope.length < 4 || envelope.length > 32 || envelope.some((a, i) => {
      const b = envelope[(i + 1) % envelope.length];
      return !near2(a.x, b.x) && !near2(a.y, b.y);
    }) || Math.abs(signed2(envelope)) < E) throw Error("Only bounded orthogonal source CL polygons supported");
    const scale = 72 / 0.0254 / Number(unique([...all.matchAll(/\bScale\s+1:(\d+)\b/gi)], "printed drawing scale")[1]);
    const classes = [...all.matchAll(/Solid (external|internal) wall\s+([A-Z]+\d+)\s*=\s*(\d+(?:\.\d+)?)\s*mm\b/gi)];
    const ext = unique(classes.filter((m) => m[1].toLowerCase() === "external"), "external wall class"), int = unique(classes.filter((m) => m[1].toLowerCase() === "internal"), "internal wall class");
    const offsets = source2.flatMap((p) => [...p.text.matchAll(/Room clear faces offset\s+(\d+(?:\.\d+)?)\s*mm from external CL;\s*(\d+(?:\.\d+)?)\s*mm from internal CL/gi)].map((m) => ({ external: Number(m[1]) / 1e3, internal: Number(m[2]) / 1e3, page: p.page })));
    const offset = unique(offsets, "source clear-face offset rule");
    if (!(scale > 0 && offset.external > 0 && offset.internal > 0) || !near2(offset.external * 2, Number(ext[3]) / 1e3) || !near2(offset.internal * 2, Number(int[3]) / 1e3)) throw Error("Wall weights and clear-face offset source disagree");
    const styles = /* @__PURE__ */ new Map();
    for (const s of graphics.strokes) {
      if (s.dash?.length || s.curved) continue;
      const id = JSON.stringify([s.width, s.color]);
      if (!styles.has(id)) styles.set(id, { width: s.width, color: s.color, segments: [] });
      styles.get(id).segments.push(...s.segments);
    }
    const external = unique([...styles.values()].filter((s) => near2(s.width / scale, Number(ext[3]) / 1e3)), "physical external-wall vector weight");
    const internal = unique([...styles.values()].filter((s) => near2(s.width / scale, Number(int[3]) / 1e3) && JSON.stringify(s.color) === JSON.stringify(external.color)), "physical internal-wall vector weight");
    const eb = bounds(envelope), gb = bounds(external.segments.flatMap((s) => [s.a, s.b]));
    const origin = { x: gb.x0 - eb.x0 * scale, y: gb.y0 - eb.y0 * scale };
    if (!near2((gb.x1 - gb.x0) / scale, eb.x1 - eb.x0) || !near2((gb.y1 - gb.y0) / scale, eb.y1 - eb.y0)) throw Error("Printed scale does not match the dimensioned source polygon");
    const axes = { x: [...new Set(envelope.map((p) => p.x))], y: [...new Set(envelope.map((p) => p.y))] };
    for (const axis of ["X", "Y"]) for (const m of all.matchAll(new RegExp(`Grid ${axis}:\\s*([\\d. /-]+)\\.`, "g"))) axes[axis.toLowerCase()].push(...m[1].split("/").map(Number).filter(Number.isFinite));
    const metres = (p) => Object.fromEntries(["x", "y"].map((axis) => {
      const v = (p[axis] - origin[axis]) / scale, matches = [...new Set(axes[axis])].filter((n) => near2(n, v));
      return [axis, matches.length === 1 ? matches[0] : Math.round(v * 1e6) / 1e6];
    }));
    const wall = (segment, classification) => {
      const a = metres(segment.a), b = metres(segment.b);
      if (!near2(a.x, b.x) && !near2(a.y, b.y) || distance6(a, b) < E) throw Error("Nonorthogonal or empty wall vector");
      return { a, b, classification, axis: near2(a.y, b.y) ? "h" : "v", length: distance6(a, b) };
    };
    const walls = [...external.segments.map((s) => wall(s, "external")), ...internal.segments.map((s) => wall(s, "internal"))];
    if (walls.length > 200) throw Error("Native room graph size limit");
    const boundaryLength = envelope.reduce((s, a, i) => s + distance6(a, envelope[(i + 1) % envelope.length]), 0);
    if (!near2(walls.filter((w) => w.classification === "external").reduce((s, w) => s + w.length, 0), boundaryLength) || walls.filter((w) => w.classification === "external").some((w) => !envelope.some((a, i) => on(w.a, a, envelope[(i + 1) % envelope.length]) && on(w.b, a, envelope[(i + 1) % envelope.length])))) throw Error("External vectors do not close the declared CL boundary");
    const glassDeclaration = [...all.matchAll(/\b([A-Z]+\d+):\s*full-height glass on the complete\s+([^.]+)\./gi)];
    const declaredGlass = glassDeclaration.length ? pairList(unique(glassDeclaration, "full-height glass boundary declaration")[2]) : [];
    const glass = [];
    if (declaredGlass.length) {
      for (const style of styles.values()) {
        if (style === external || style === internal || style.width >= internal.width || style.color.every((c) => c > 0.95)) continue;
        for (const s of style.segments) {
          let w;
          try {
            w = wall(s, "glass");
          } catch {
            continue;
          }
          const middle = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
          if (!inside4(middle, envelope) || walls.some((v) => on(middle, v.a, v.b)) || ![w.a, w.b].every((p) => walls.some((v) => on(p, v.a, v.b)))) continue;
          if (!glass.some((v) => on(w.a, v.a, v.b) && on(w.b, v.a, v.b))) glass.push(w);
        }
      }
      if (!glass.length) throw Error("Declared glass boundaries have no unambiguous closing vectors");
      walls.push(...glass);
    }
    for (const w of walls) for (const p of [w.a, w.b]) if (!walls.some((v) => v !== w && on(p, v.a, v.b))) throw Error("Unclosed room-wall endpoint");
    const faces = facesOf(walls);
    if (!faces.length || faces.length > 100 || !near2(faces.reduce((s, f) => s + f.area, 0), Math.abs(signed2(envelope)))) throw Error("Room CL cells do not cover the declared footprint");
    const tags = text3.spans.filter((s) => /^[A-Z]{1,4}\d{1,4}$/.test(s.text.trim()) && inside4(metres(s), envelope));
    const rooms = [], seen = /* @__PURE__ */ new Set();
    for (const face of faces) {
      const label = unique(tags.filter((s) => inside4(metres(s), face.polygon)), "one printed room tag per closed cell"), tag = label.text.trim();
      if (seen.has(tag)) throw Error("Repeated source room tag");
      seen.add(tag);
      const b = bounds(face.polygon);
      if (!near2((b.x1 - b.x0) * (b.y1 - b.y0), face.area)) throw Error("Nonrectangular clear cells require independent offset geometry");
      const offsetsBySide = {};
      for (const [name2, a, c] of [["left", { x: b.x0, y: b.y0 }, { x: b.x0, y: b.y1 }], ["right", { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }], ["bottom", { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }], ["top", { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 }]]) {
        const edges2 = walls.filter((w) => on(w.a, a, c) && on(w.b, a, c) || on(a, w.a, w.b) && on(c, w.a, w.b));
        const values = [...new Set(edges2.map((w) => w.classification === "external" ? offset.external : offset.internal))];
        offsetsBySide[name2] = unique(values, "consistent clear offset on cell side");
      }
      const clear = { x0: b.x0 + offsetsBySide.left, x1: b.x1 - offsetsBySide.right, y0: b.y0 + offsetsBySide.bottom, y1: b.y1 - offsetsBySide.top };
      const width = clear.x1 - clear.x0, depth = clear.y1 - clear.y0;
      if (!(width > 0 && depth > 0)) throw Error("Nonpositive clear room dimensions");
      const captions = text3.spans.filter((s) => s !== label && inside4(metres(s), face.polygon)), printed = captions.flatMap((s) => [...s.text.matchAll(/^Clear\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*m$/gi)].map((m) => [Number(m[1]), Number(m[2])]));
      if (printed.length > 1 || printed.length === 1 && (!near2(width, printed[0][0]) || !near2(depth, printed[0][1]))) throw Error("Printed room clear dimensions conflict with calibrated wall faces: " + tag);
      rooms.push({ tag, bounds: b, clear, width, depth, grossArea: width * depth, area: width * depth, deductions: [], void: captions.some((s) => /^VOID\s*-?\s*no floor\s*\/\s*no ceiling/i.test(s.text)), polygon: face.polygon, caption: captions.map((s) => s.text).join(" ") });
    }
    if (tags.length !== rooms.length) throw Error("Unmapped source room tag");
    for (const w of glass) {
      const touching = rooms.filter((r) => r.polygon.some((a, i) => on(w.a, a, r.polygon[(i + 1) % r.polygon.length]) && on(w.b, a, r.polygon[(i + 1) % r.polygon.length]))).map((r) => r.tag).sort();
      if (touching.length !== 2 || !declaredGlass.some((pair) => pair.slice().sort().join("|") === touching.join("|"))) throw Error("Glass vector does not match its declared room boundary");
      w.rooms = touching;
    }
    for (const pair of declaredGlass.filter((pair2) => rooms.some((r) => r.tag === pair2[0]))) if (glass.filter((w) => w.rooms?.slice().sort().join("|") === pair.slice().sort().join("|")).length !== 1) throw Error("Missing or repeated declared glass boundary");
    const stairs = [...all.matchAll(/Stair zone:\s*X(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\s*\/\s*Y(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\./gi)];
    if (stairs.length) {
      const m = unique(stairs, "explicit stair exclusion coordinates"), [x0, x1, y0, y1] = m.slice(1).map(Number);
      if (!(x1 > x0 && y1 > y0) || !/exclude\s+stair (?:footprint|opening)/i.test(all)) throw Error("Stair coordinates lack a floor exclusion rule");
      const r = unique(rooms.filter((r2) => x0 >= r2.clear.x0 - E && x1 <= r2.clear.x1 + E && y0 >= r2.clear.y0 - E && y1 <= r2.clear.y1 + E && !r2.void), "stair exclusion host room");
      const quantity = (x1 - x0) * (y1 - y0);
      if (quantity >= r.area) throw Error("Stair exclusion consumes the host room");
      r.area -= quantity;
      r.deductions.push({ kind: "stair", x0, x1, y0, y1, area: quantity });
    } else if (/exclude\s+stair (?:footprint|opening)/i.test(all)) throw Error("Explicit stair exclusion missing coordinates");
    const ceilingRule = source2.filter((p) => /Ceiling areas are net clear room areas, with the same\s+core stair-zone deductions as floors/i.test(p.text));
    const dimensions = { floor_area: rooms.filter((r) => !r.void).reduce((s, r) => s + r.area, 0) };
    if (ceilingRule.length === 1) dimensions.ceiling_area = dimensions.floor_area;
    Object.assign(audit, { status: "native_clear_geometry_checked", source_pages: [.../* @__PURE__ */ new Set([page.pageNumber, offset.page, ...ceilingRule.map((p) => p.page)])], calibration: { points_per_m: scale, origin }, envelope_area: Math.abs(signed2(envelope)), centrelines_cover_area: faces.reduce((s, f) => s + f.area, 0), rooms, wall_count: walls.length });
    return { status: "checked", audit, rooms, walls, dimensions, footprint: envelope, externalWallThickness: Number(ext[3]) / 1e3, wallThickness: Number(int[3]) / 1e3 };
  } catch (e) {
    audit.reason = e.message;
    return { status: "pending", audit, rooms: [], walls: [], dimensions: {} };
  }
}

// src/lib/pdfAreaGeometry.mjs
var EPS3 = 1e-8;
var cross4 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
var signed3 = (p) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0) / 2;
var area3 = (p) => Math.abs(signed3(p));
function on2(a, b, p) {
  return Math.abs(cross4(a, b, p)) < EPS3 && p.x >= Math.min(a.x, b.x) - EPS3 && p.x <= Math.max(a.x, b.x) + EPS3 && p.y >= Math.min(a.y, b.y) - EPS3 && p.y <= Math.max(a.y, b.y) + EPS3;
}
function intersects(a, b, c, d) {
  return cross4(a, b, c) * cross4(a, b, d) < -EPS3 && cross4(c, d, a) * cross4(c, d, b) < -EPS3 || on2(a, b, c) || on2(a, b, d) || on2(c, d, a) || on2(c, d, b);
}
function polygon2(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 64) throw Error("Polygon requires 3\u201364 dimensioned vertices.");
  let p = raw.map((v) => ({ x: v.x, y: v.y }));
  if (p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 1e6 || Math.abs(v.y) > 1e6)) throw Error("Invalid polygon coordinates.");
  if (p[0].x === p.at(-1).x && p[0].y === p.at(-1).y) p.pop();
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    if (j === i + 1 || i === 0 && j === p.length - 1) continue;
    if (intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) throw Error("Polygon crosses or touches itself.");
  }
  if (area3(p) < EPS3) throw Error("Polygon has no usable area.");
  if (signed3(p) < 0) p.reverse();
  return p;
}
function triangulate(p) {
  const points = [...p], triangles2 = [];
  let guard = p.length * p.length;
  while (points.length > 3 && guard--) {
    let cut = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
      if (Math.abs(cross4(a, b, c)) < EPS3) {
        points.splice(i, 1);
        cut = true;
        break;
      }
      if (cross4(a, b, c) < EPS3) continue;
      if (points.some((v) => v !== a && v !== b && v !== c && cross4(a, b, v) >= -EPS3 && cross4(b, c, v) >= -EPS3 && cross4(c, a, v) >= -EPS3)) continue;
      triangles2.push([a, b, c]);
      points.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) throw Error("Polygon triangulation failed.");
  }
  if (points.length === 3) triangles2.push(points);
  else if (points.length > 3) throw Error("Polygon triangulation exceeded limit.");
  return triangles2;
}
function clip(subject, triangle) {
  let out = subject;
  for (let i = 0; i < 3 && out.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], dp = cross4(a, b, p), dq = cross4(a, b, q), pin = dp >= -EPS3, qin = dq >= -EPS3;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = dp / (dp - dq);
        out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
  }
  return out.length >= 3 ? area3(out) : 0;
}
var bbox = (p) => ({ minX: Math.min(...p.map((v) => v.x)), maxX: Math.max(...p.map((v) => v.x)), minY: Math.min(...p.map((v) => v.y)), maxY: Math.max(...p.map((v) => v.y)) });
function intersection2(a, b) {
  const x = bbox(a.p), y = bbox(b.p);
  if (x.maxX <= y.minX + EPS3 || y.maxX <= x.minX + EPS3 || x.maxY <= y.minY + EPS3 || y.maxY <= x.minY + EPS3) return 0;
  return a.t.reduce((s, u) => s + b.t.reduce((n, v) => n + clip(u, v), 0), 0);
}
var metricKeys = ["floor_area", "ceiling_area", "wood_floor_area", "ceramic_floor_area", "epoxy_floor_area", "terrace_floor_area"];
var material = { wood: "wood_floor_area", tile: "ceramic_floor_area", epoxy: "epoxy_floor_area", outdoor: "terrace_floor_area" };
var inferred = /\binferred\b|\bassumed\b|\bremainder\b|\bderived\b|استنباط|تخمین/i;
var roomTag = (name2) => String(name2 || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
var labeledFinish = (r) => /\bVOID\b/i.test(r.name) || /^VOID\b/i.test(r.description) ? "void" : /^OUTDOOR\b/i.test(r.description) ? "outdoor" : /^WOOD\b|^parquet\b/i.test(r.description) ? "wood" : /^TILE\b|^ceramic\b/i.test(r.description) ? "tile" : /^EPOXY\b/i.test(r.description) ? "epoxy" : null;
function partialInventory(page, geometry, spaces, envelopeArea, tolerance) {
  if (geometry.basis !== "wall_centerline_zones") throw Error("Partial clear-area geometry cannot resolve missing wall footprints");
  const inventory = /* @__PURE__ */ new Map(), polygons = /* @__PURE__ */ new Map(), corrections = [], labels = [], unresolved = [];
  for (const r of spaces) {
    const tag = roomTag(r.tag);
    if (!tag || polygons.has(tag)) throw Error("Partial geometry requires unique printed room tags");
    polygons.set(tag, r);
  }
  const nativeInventory = recoverNativeRoomInventory(page, spaces);
  for (const item of nativeInventory.items) {
    if (!["m2", "m\xB2"].includes(String(item.unit).toLowerCase())) continue;
    const tag = roomTag(item.name);
    if (!tag) continue;
    if (inventory.has(tag)) throw Error(`Duplicate area inventory tag ${tag}`);
    const finish = labeledFinish(item), shape2 = polygons.get(tag);
    if (!finish || !Number.isFinite(item.quantity) || item.quantity <= 0) throw Error(`Missing printed room area/material for ${tag}`);
    if (shape2) {
      if (shape2.kind === "wall" || (finish === "void" ? shape2.kind !== "void" : finish === "outdoor" ? shape2.kind !== "outdoor" : shape2.kind !== "enclosed") || finish !== "void" && shape2.finish !== finish) throw Error(`Conflicting room identity/material for ${tag}`);
      if (Math.abs(item.quantity - shape2.quantity) > 0.01) corrections.push({ tag, reported: item.quantity, computed: shape2.quantity, evidence: shape2.evidence });
      inventory.set(tag, { ...item, quantity: shape2.quantity, finish, description: `${String(item.description).split("|")[0].trim()} | independently dimensioned polygon: ${shape2.evidence}` });
    } else {
      if (inferred.test(item.description || "")) unresolved.push(tag);
      else if (!/\bprinted\b|\breported\b|برچسب|چاپ|مذكور|مطبوعة/i.test(item.description || "")) throw Error(`Room ${tag} lacks an explicit printed area basis`);
      labels.push(tag);
      inventory.set(tag, { ...item, finish });
    }
  }
  for (const tag of polygons.keys()) if (!inventory.has(tag)) throw Error(`Dimensioned space ${tag} is absent from the tagged inventory`);
  if (unresolved.length) throw Error(`Inferred rooms still lack dimensioned polygons: ${unresolved.join(", ")}`);
  const list2 = [...inventory.values()], total = list2.reduce((s, r) => s + r.quantity, 0);
  if (!list2.length || Math.abs(total - envelopeArea) > tolerance) throw Error("Mixed polygon/printed-area inventory does not reconcile to the dimensioned envelope");
  const dimensions = { floor_area: list2.filter((r) => r.finish !== "void").reduce((s, r) => s + r.quantity, 0), ceiling_area: list2.filter((r) => !["void", "outdoor"].includes(r.finish)).reduce((s, r) => s + r.quantity, 0) };
  for (const [finish, key2] of Object.entries(material)) dimensions[key2] = list2.filter((r) => r.finish === finish).reduce((s, r) => s + r.quantity, 0);
  const quantities = (page.page_evidence.quantities || []).filter((q) => !metricKeys.includes(q.key));
  const basis = `Partial dimensioned geometry plus printed room labels on page ${page.pageNumber}; dimensioned tags: ${[...polygons.keys()].join(", ")}; label-only tags: ${labels.join(", ")}; ${geometry.envelope_evidence}. Inventory closure checked; unmeasured room boundaries and AI materials require review.`;
  for (const [key2, value] of Object.entries(dimensions)) quantities.push({ key: key2, value, unit: "m2", scope_id: page.page_evidence.scope_id, evidence: basis });
  const updated = { ...page, ...dimensions, __areaGeometryValidated: true, page_evidence: { ...page.page_evidence, quantities }, detected_items: nativeInventory.items.map((r) => inventory.has(roomTag(r.name)) && ["m2", "m\xB2"].includes(String(r.unit).toLowerCase()) ? Object.fromEntries(Object.entries(inventory.get(roomTag(r.name))).filter(([k]) => k !== "finish")) : r) };
  return { page: updated, audit: { page: page.pageNumber, status: "partial_geometry_with_printed_labels", basis: geometry.basis, envelope_area: envelopeArea, covered_area: spaces.reduce((s, r) => s + r.quantity, 0), dimensioned_tags: [...polygons.keys()], label_only_tags: labels, corrections, native_inventory_recovery: nativeInventory.recovered, withheld_metrics: [] }, warnings: [`PDF page ${page.pageNumber}: partial area geometry; printed room labels retained provisionally, full room boundaries are not verified.`] };
}
function withheld(page, keys, reason) {
  const original = page.__withheldAreaClaims || { claims: (page.page_evidence?.quantities || []).filter((q) => keys.includes(q.key)), fields: Object.fromEntries(keys.filter((k) => Number.isFinite(page[k])).map((k) => [k, page[k]])) };
  const quantities = (page.page_evidence?.quantities || []).filter((q) => !keys.includes(q.key));
  const next = { ...page, __withheldAreaClaims: original, page_evidence: { ...page.page_evidence, quantities } };
  for (const key2 of keys) next[key2] = 0;
  return { page: next, audit: { page: page.pageNumber, status: "withheld", reason, withheld_metrics: keys, original_area_evidence: original }, warnings: [`PDF page ${page.pageNumber}: ${reason}; ${keys.join(", ")} withheld.`] };
}
function auditPdfAreaGeometry(page, sourcePages = []) {
  if (page.page_evidence?.kind !== "floor_plan") return { page, audit: null, warnings: [] };
  const native = measureNativeClearPlan(page, sourcePages);
  if (native.status === "checked") {
    const quantities = (page.page_evidence.quantities || []).filter((q) => !metricKeys.includes(q.key));
    for (const [key2, value] of Object.entries(native.dimensions)) quantities.push({
      key: key2,
      value,
      unit: "m2",
      scope_id: page.page_evidence.scope_id,
      pages: native.audit.source_pages,
      native_calculated: true,
      evidence: `Original PDF calibrated CL graph, source clear-face offsets and printed room dimensions. Stair holes deducted within their host once; upper void excluded. ${native.rooms.map((r) => `${r.tag}: ${r.width} \xD7 ${r.depth}${r.deductions.map((d) => ` minus ${d.x1 - d.x0} \xD7 ${d.y1 - d.y0}`).join("")}${r.void ? " VOID" : ""}`).join("; ")}. Source drawing requires review.`
    });
    const withheldMetrics = metricKeys.filter((k) => !(k in native.dimensions));
    const dimensions = Object.fromEntries(metricKeys.map((k) => [k, native.dimensions[k] || 0]));
    const detected = native.rooms.map((r) => ({ name: r.tag, unit: "m2", quantity: r.area, description: `${r.void ? "VOID" : "UNKNOWN"} | original PDF clear dimensions ${r.width} x ${r.depth} m; explicit stair deductions ${r.deductions.reduce((s, d) => s + d.area, 0)} m2. Native geometry; finish code requires separate source reconciliation.` }));
    return { page: { ...page, ...dimensions, __areaGeometryValidated: true, native_clear_geometry: native.audit, page_evidence: { ...page.page_evidence, quantities }, detected_items: [...(page.detected_items || []).filter((i) => !["m2", "m\xB2"].includes(String(i.unit).toLowerCase())), ...detected] }, audit: { ...native.audit, withheld_metrics: withheldMetrics }, warnings: withheldMetrics.length ? [`PDF page ${page.pageNumber}: native clear geometry checked; floor material classifications remain unresolved.`] : [] };
  }
  const geometry = page.area_geometry;
  if (!geometry) {
    const ambiguous = (page.detected_items || []).filter((r) => ["m2", "m\xB2"].includes(String(r.unit).toLowerCase()) && inferred.test(r.description || ""));
    if (!ambiguous.length) return { page, audit: { page: page.pageNumber, status: "label_areas_only", reason: "Independent dimensioned polygons unavailable." }, warnings: [] };
    const keys = /* @__PURE__ */ new Set(["floor_area", "ceiling_area"]);
    for (const r of ambiguous) {
      const desc = String(r.description || "");
      if (/^WOOD\b/i.test(desc)) keys.add("wood_floor_area");
      else if (/^TILE\b/i.test(desc)) keys.add("ceramic_floor_area");
      else if (/^EPOXY\b/i.test(desc)) keys.add("epoxy_floor_area");
      else if (/^OUTDOOR\b/i.test(desc)) keys.add("terrace_floor_area");
      else for (const key2 of Object.values(material)) keys.add(key2);
    }
    return withheld(page, [...keys], "Inferred room areas lack independent dimensioned geometry");
  }
  try {
    if (!["wall_centerline_zones", "clear_internal"].includes(geometry.basis) || !geometry.envelope_evidence?.trim()) throw Error("Independent area measurement basis or envelope evidence missing");
    const envelope = polygon2(geometry.envelope), outer = { p: envelope, t: triangulate(envelope) }, envelopeArea = area3(envelope), tolerance = Math.max(0.01, envelopeArea * 1e-3);
    if (!Array.isArray(geometry.spaces) || !geometry.spaces.length || geometry.spaces.length > 200) throw Error("A complete tagged space inventory is required");
    const seen = /* @__PURE__ */ new Set(), spaces = [];
    for (const r of geometry.spaces) {
      if (!r.tag?.trim() || seen.has(r.tag.trim().toUpperCase()) || !r.evidence?.trim() || !["enclosed", "outdoor", "void", "wall"].includes(r.kind) || !["wood", "tile", "epoxy", "outdoor", "unknown"].includes(r.finish)) throw Error("Missing or duplicate room identity/material/geometry evidence");
      seen.add(r.tag.trim().toUpperCase());
      if (geometry.coverage === "partial" && Array.isArray(r.polygon) && r.polygon.length === 0) {
        const tag = roomTag(r.tag), items = (page.detected_items || []).filter((i) => roomTag(i.name) === tag && ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()));
        if (geometry.basis !== "wall_centerline_zones" || !tag || items.length !== 1 || !Number.isFinite(r.reported_area) || r.reported_area <= 0 || Math.abs(items[0].quantity - r.reported_area) > 0.01 || !/\bprinted\b|\breported\b|\blabel\b/i.test(r.evidence) || inferred.test(items[0].description || "") || !/\bprinted\b|\breported\b|برچسب|چاپ/i.test(items[0].description || "")) throw Error(`Unmeasured space ${r.tag} lacks a consistent printed label`);
        const finish = labeledFinish(items[0]);
        if (!finish || (finish === "void" ? r.kind !== "void" : finish === "outdoor" ? r.kind !== "outdoor" : r.kind !== "enclosed") || finish !== "void" && r.finish !== finish) throw Error(`Conflicting printed-label identity/material for ${r.tag}`);
        continue;
      }
      const p = polygon2(r.polygon), shape2 = { p, t: triangulate(p) }, quantity = area3(p);
      if (Math.abs(intersection2(shape2, outer) - quantity) > tolerance) throw Error(`Space ${r.tag} lies outside the dimensioned envelope`);
      for (const old of spaces) if (intersection2(shape2, old.shape) > tolerance) throw Error(`Spaces ${old.tag} and ${r.tag} overlap`);
      if (r.kind === "outdoor" && r.finish !== "outdoor" || r.kind === "enclosed" && r.finish === "outdoor") throw Error(`Space ${r.tag} has conflicting indoor/outdoor classification`);
      spaces.push({ ...r, quantity, shape: shape2 });
    }
    const total = spaces.reduce((s, r) => s + r.quantity, 0);
    if (geometry.coverage === "partial") return partialInventory(page, geometry, spaces, envelopeArea, tolerance);
    if (geometry.coverage != null && geometry.coverage !== "complete") throw Error("Unknown area geometry coverage mode");
    if (Math.abs(total - envelopeArea) > tolerance) throw Error("Space polygons do not cover the complete dimensioned envelope");
    const usable = (r) => ["enclosed", "outdoor"].includes(r.kind);
    const dimensions = { floor_area: spaces.filter(usable).reduce((s, r) => s + r.quantity, 0), ceiling_area: spaces.filter((r) => r.kind === "enclosed").reduce((s, r) => s + r.quantity, 0) };
    for (const [finish, key2] of Object.entries(material)) dimensions[key2] = spaces.filter((r) => usable(r) && r.finish === finish).reduce((s, r) => s + r.quantity, 0);
    const scope2 = page.page_evidence.scope_id, quantities = (page.page_evidence.quantities || []).filter((q) => !metricKeys.includes(q.key));
    for (const [key2, value] of Object.entries(dimensions)) quantities.push({ key: key2, value, unit: "m2", scope_id: scope2, evidence: `Area computed from dimensioned, non-overlapping space polygons (${geometry.basis}) on page ${page.pageNumber}; ${geometry.envelope_evidence}; AI dimension transcription and materials require review.` });
    const corrections = [];
    for (const r of spaces) if (Number.isFinite(r.reported_area) && Math.abs(r.reported_area - r.quantity) > 0.01) corrections.push({ tag: r.tag, reported: r.reported_area, computed: r.quantity, evidence: r.evidence });
    const unknown = spaces.filter((r) => usable(r) && r.finish === "unknown").map((r) => r.tag);
    const measuredRooms = spaces.filter((r) => r.kind !== "wall").map((r) => ({
      name: r.tag,
      unit: "m2",
      quantity: r.quantity,
      description: `${r.kind === "void" ? "VOID" : r.kind === "outdoor" ? "OUTDOOR" : r.finish.toUpperCase()} | source dimensioned space: ${r.evidence}`
    }));
    return {
      page: {
        ...page,
        ...dimensions,
        page_evidence: { ...page.page_evidence, quantities },
        __areaGeometryValidated: true,
        detected_items: [...(page.detected_items || []).filter((i) => !["m2", "m\xB2"].includes(String(i.unit).toLowerCase())), ...measuredRooms]
      },
      audit: { page: page.pageNumber, status: "dimension_geometry_checked", basis: geometry.basis, envelope_area: envelopeArea, covered_area: total, corrections, unknown_finish_spaces: unknown, withheld_metrics: unknown.length ? Object.values(material) : [] },
      warnings: unknown.length ? [`PDF page ${page.pageNumber}: unknown floor finishes; complete material totals withheld.`] : []
    };
  } catch (error2) {
    return withheld(page, metricKeys, error2.message);
  }
}

// src/lib/pdfNativeSchedules.mjs
var clean = (s) => String(s || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
var headers = { id: /^(?:id|tag|mark|reference)$/, host: /^(?:host wall|wall|host)$/, kind: /^(?:type|opening type|description)$/, width: /^width(?:\s*\((?:mm|m)\))?$/, height: /^height(?:\s*\((?:mm|m)\))?$/, sill: /^sill(?:\s*height)?(?:\s*\((?:mm|m)\))?$/, quantity: /^(?:quantity|qty|count)$/ };
var kindOf = (s) => /^(?:garage door|overhead door|roller shutter)$/.test(clean(s)) ? "garage_door" : /^(?:door|internal door|external door|entrance door|service door|main door)$/.test(clean(s)) ? "door" : /^(?:window|glazed window)$/.test(clean(s)) ? "window" : null;
var dimension = (s) => /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
function tableUnit(spans, head, inherited) {
  const text3 = spans.filter((s) => s.y > head.y).map((s) => s.text).join(" ");
  const source2 = [...text3.matchAll(/(?:all\s+)?dimensions\s+(?:are\s+|in\s+)(millimet(?:er|re)s?|met(?:er|re)s?|mm|m)\b/gi)].map((m) => /^mm|^milli/i.test(m[1]) ? 1e-3 : 1);
  const fromHeaders = ["width", "height"].map((k) => head.cols.find((c) => c.key === k)?.text.match(/\((mm|m)\)/i)?.[1]).filter(Boolean).map((u) => u.toLowerCase() === "mm" ? 1e-3 : 1);
  const signature = head.cols.map((c) => `${c.key}:${Math.round(c.x - head.cols[0].x)}`).join("|");
  const factors = [...source2, ...fromHeaders];
  if (!factors.length && inherited?.signature === signature && inherited.allow_continuation) return { ...inherited };
  if (!factors.length || new Set(factors).size !== 1) throw Error("Missing or conflicting schedule dimension units");
  return { factor: factors[0], signature, allow_continuation: /all\s+dimensions\s+(?:are|in)\s+/i.test(text3) };
}
function readNativeOpeningSchedule(page, normalizeScope, inherited) {
  const native = page.native_text_evidence;
  if (native?.version !== 1 || native.status !== "readable") return { status: "unavailable", rows: [] };
  const spans = native.spans, scope2 = normalizeScope(page.page_evidence?.scope_id);
  if (!scope2 || scope2 === "project") return { status: "pending", reason: "Schedule floor scope is unresolved", rows: [] };
  try {
    const heads = [];
    for (const s of spans.filter((s2) => headers.id.test(clean(s2.text)))) {
      const band5 = spans.filter((x) => Math.abs(x.y - s.y) < Math.min(2, s.height * 0.2));
      const cols = [];
      for (const x of band5) {
        const key2 = Object.keys(headers).find((k) => headers[k].test(clean(x.text)));
        if (key2) cols.push({ ...x, key: key2 });
      }
      if (["id", "kind", "width", "height"].every((k) => cols.filter((c) => c.key === k).length === 1)) heads.push({ y: s.y, cols: cols.sort((a, b) => a.x - b.x) });
    }
    if (heads.length !== 1) throw Error("A single complete opening table is required per schedule page");
    const head = heads[0], dimension_basis = tableUnit(spans, head, inherited), factor2 = dimension_basis.factor, rows = [], ids = /* @__PURE__ */ new Set();
    const printed = spans.filter((s) => s.y > head.y && s.y - head.y < 100 && /^(?:ground|first|second|third|basement|roof|floor\s+\d+)(?:\s+floor)?$/i.test(s.text.trim())).map((s) => normalizeScope(s.text));
    if (printed.length !== 1 || printed[0] !== scope2) throw Error("Printed schedule floor does not match selected scope");
    const below = spans.filter((s) => s.y < head.y - 3).sort((a, b) => b.y - a.y || a.x - b.x), bands = [];
    for (const s of below) {
      let b = bands.find((b2) => Math.abs(b2.y - s.y) < 2);
      if (!b) {
        b = { y: s.y, spans: [] };
        bands.push(b);
      }
      b.spans.push(s);
    }
    for (const band5 of bands) {
      const cells = {};
      for (const s of band5.spans) {
        let nearest = head.cols.reduce((a, b) => Math.abs(s.x - a.x) <= Math.abs(s.x - b.x) ? a : b);
        if (Math.abs(s.x - nearest.x) > 20) continue;
        (cells[nearest.key] ??= []).push(s.text.trim());
      }
      if (!cells.kind && !cells.width && !cells.height) {
        if (cells.id?.some((s) => /^[A-Za-z][A-Za-z0-9._/-]{1,39}$/.test(s))) throw Error("Tagged row without dimensions; partial schedule withheld");
        continue;
      }
      const raw = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(" ")])), kind = kindOf(raw.kind);
      if (head.cols.some((c) => c.key === "quantity") && raw.quantity !== "1") throw Error("Multi-instance or missing schedule row quantity requires explicit instance mapping");
      if (!kind || !raw.id || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,39}$/u.test(raw.id)) throw Error("Unrecognized opening row; partial table withheld");
      const width = dimension(raw.width), height = dimension(raw.height), sill = raw.sill === void 0 ? null : dimension(raw.sill);
      if (!(width > 0) || !(height > 0) || width * factor2 > 50 || height * factor2 > 50 || sill !== null && (!(sill >= 0) || sill * factor2 > 50) || head.cols.some((c) => c.key === "sill") && sill === null) throw Error("Missing or invalid opening dimensions");
      const id = raw.id.toLowerCase();
      if (ids.has(id)) throw Error("Repeated opening tag in schedule");
      ids.add(id);
      rows.push({ id: raw.id, wall_id: raw.host || null, kind, width: width * factor2, height: height * factor2, sill: sill === null ? null : sill * factor2, page: page.pageNumber, source_row: Object.values(raw).join(" | ") });
    }
    if (!rows.length || rows.length > 1e3) throw Error("Empty or excessive opening schedule");
    dimension_basis.pages = [.../* @__PURE__ */ new Set([...inherited && dimension_basis.pages || [], page.pageNumber])];
    for (const row of rows) row.dimension_pages = dimension_basis.pages;
    return { status: "read", scope_id: scope2, page: page.pageNumber, rows, dimension_basis };
  } catch (e) {
    return { status: "pending", reason: e.message, page: page.pageNumber, rows: [] };
  }
}
function nativeOpeningEvidence(pages, normalizeScope) {
  const schedules = [];
  for (const p of pages.filter((p2) => p2.page_evidence?.kind === "opening_schedule").sort((a, b) => a.pageNumber - b.pageNumber)) {
    const previous = schedules.at(-1), inherited = previous?.status === "read" && previous.page === p.pageNumber - 1 ? previous.dimension_basis : null;
    schedules.push(readNativeOpeningSchedule(p, normalizeScope, inherited));
  }
  const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan").map((p) => normalizeScope(p.page_evidence.scope_id));
  const warnings = [], claims = [], blocked = [];
  if (!schedules.some((s) => s.status === "read")) return { claims, blocked, warnings, schedules };
  if (new Set(floors).size !== floors.length || schedules.some((s) => s.status !== "read") || schedules.length !== floors.length || floors.some((f) => schedules.filter((s) => s.scope_id === f).length !== 1)) {
    warnings.push("Native opening schedule coverage incomplete; partial native totals withheld");
    return { claims, blocked, warnings, schedules };
  }
  for (const s of schedules) {
    for (const [kind, key2] of [["door", "door_count"], ["window", "window_count"]]) {
      const rows = s.rows.filter((r) => kind === "door" ? r.kind === "door" || r.kind === "garage_door" : r.kind === "window");
      for (const [metric, value, unit5] of [[key2, rows.length, "nr"], [`${kind}_area`, rows.reduce((v, r) => v + r.width * r.height, 0), "m2"]]) claims.push({
        key: metric,
        value,
        unit: unit5,
        scope_id: s.scope_id,
        pages: s.dimension_basis.pages,
        native_calculated: true,
        document_calculated: true,
        evidence: `Native PDF opening table, complete source rows including garage doors: ${rows.map((r) => r.source_row).join("; ")}. Dimensions read from printed table and source units; specification requires review.`
      });
    }
  }
  return { claims, blocked, warnings, schedules };
}

// src/lib/pdfSourceMeasurements.mjs
var PDF_SOURCE_MEASUREMENT_KEYS = ["internal_wall_length", "external_wall_length", "wall_length", "wall_area", "internal_block_area", "external_block_area", "plaster_area", "paint_area", "wet_wall_tile_area", "wet_wall_waterproofing_area", "ceiling_paint_area", "gypsum_ceiling_area"];
var floorScope = (s) => String(s || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
var canon = (s) => ["ground floor", "ground", "gf", "floor 0"].includes(floorScope(s)) ? "floor:0" : ["first floor", "first", "ff", "floor 1"].includes(floorScope(s)) ? "floor:1" : floorScope(s);
var name = (s) => String(s || "").trim().toLowerCase();
var roomTag2 = (s) => String(s || "").match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toLowerCase();
var unique2 = (rows, key2) => {
  const ids = rows.map((r) => name(r[key2]));
  if (ids.some((s) => !s) || new Set(ids).size !== ids.length) throw Error(`Missing or duplicated ${key2}`);
};
function calculatePdfSourceMeasurements(basis, pages, metricUnits, availablePages) {
  const calculations = [], blocked = /* @__PURE__ */ new Set(), issues = [];
  const source2 = (s, unit5) => {
    if (!s || !Number.isFinite(s.value) || s.value < 0 || s.value > 1e6 || !s.evidence?.trim() || !s.pages?.length || s.pages.some((p) => !availablePages.has(p))) throw Error("Missing or unsourced source dimension");
    return { value: s.value, unit: unit5, operation: "multiply", pages: s.pages, evidence: s.evidence, clip: null };
  };
  const rule = (r) => {
    if (typeof r?.value !== "boolean" || !r.evidence?.trim() || !r.pages?.length || r.pages.some((p) => !availablePages.has(p))) throw Error("Missing source finish rule");
    return r;
  };
  const term2 = (id, operation2, factors) => ({ id, operation: operation2, factors });
  const add = (key2, terms, evidence) => calculations.push({ key: key2, scope_id: "project", terms, evidence });
  const tryGroup = (keys, work) => {
    try {
      work();
    } catch (e) {
      keys.forEach((k) => blocked.add(k));
      issues.push(`${keys.join(", ")}: ${e.message}`);
    }
  };
  const selected = pages.filter((p) => p.page_evidence?.kind === "floor_plan");
  const native = nativeOpeningEvidence(pages, canon);
  const floors = basis?.floors || [];
  let matched = [];
  tryGroup(PDF_SOURCE_MEASUREMENT_KEYS, () => {
    if (!floors.length || floors.length > 30 || floors.length !== selected.length) throw Error("Source basis does not cover every selected floor");
    unique2(floors, "scope_id");
    if (new Set(floors.map((f) => canon(f.scope_id))).size !== floors.length) throw Error("Repeated floor aliases");
    matched = floors.map((f) => {
      const found = selected.filter((p) => canon(p.page_evidence.scope_id) === canon(f.scope_id));
      if (found.length !== 1) throw Error("Unresolved source floor identity");
      return { f, page: found[0] };
    });
  });
  if (!matched.length) return { calculations, blocked: [...blocked], issues };
  const wallTerms = { internal: [], external: [] }, wallLengths = { internal: [], external: [] }, openingIndex = /* @__PURE__ */ new Map();
  let plasterTerms = [], tileTerms = [];
  tryGroup(["internal_wall_length", "external_wall_length", "wall_length", "wall_area", "internal_block_area", "external_block_area", "paint_area"], () => {
    for (const { f } of matched) {
      if (!f.walls_complete || !f.wall_inventory_evidence?.trim() || !f.source_pages?.length || f.source_pages.some((p) => !availablePages.has(p)) || !f.walls?.length || f.walls.length > 500 || !Array.isArray(f.openings) || f.openings.length > 1e3) throw Error("Incomplete wall/opening inventory");
      unique2(f.walls, "id");
      unique2(f.openings, "id");
      const prefix = canon(f.scope_id), walls = new Map(f.walls.map((w) => [name(w.id), w]));
      for (const w of f.walls) {
        if (!["internal", "external"].includes(w.classification) || !["printed_dimensions", "calibrated_geometry"].includes(w.length_basis)) throw Error("Unresolved wall class or dimensional basis");
        const length = source2(w.length, "m"), height = source2(w.height, "m");
        if (length.value <= 0 || height.value <= 0) throw Error("Zero wall dimensions");
        const id = `${prefix}:${w.id}`;
        wallLengths[w.classification].push(term2(`${id}:length`, "add", [length]));
        wallTerms[w.classification].push(term2(`${id}:gross`, "add", [length, height]));
        let openingArea = 0;
        for (const o of f.openings.filter((o2) => name(o2.wall_id) === name(w.id))) {
          const width = source2(o.width, "m"), oh = source2(o.height, "m"), sill = source2(o.sill, "m");
          if (!["door", "window"].includes(o.kind) || width.value <= 0 || oh.value <= 0 || width.value > length.value || oh.value + sill.value > height.value + 1e-6) throw Error("Opening dimensions exceed its host wall");
          openingArea += width.value * oh.value;
          wallTerms[w.classification].push(term2(`${prefix}:${o.id}:opening`, "subtract", [width, oh]));
          openingIndex.set(`${prefix}:${name(o.id)}`, o);
        }
        if (openingArea > length.value * height.value + 1e-6) throw Error("Opening areas exceed host face area");
      }
      if (f.openings.some((o) => !walls.has(name(o.wall_id)))) throw Error("Opening host wall is missing");
      const nativeRows = native.claims.length ? native.schedules.find((s) => s.scope_id === prefix)?.rows : null;
      if (nativeRows) {
        if (nativeRows.length !== f.openings.length) throw Error("Opening inventory does not cover native source tags");
        for (const row of nativeRows) {
          const o = f.openings.find((o2) => name(o2.id) === name(row.id));
          if (!o || o.kind !== (row.kind === "window" ? "window" : "door") || Math.abs(o.width.value - row.width) > 1e-6 || Math.abs(o.height.value - row.height) > 1e-6 || row.sill !== null && Math.abs(o.sill.value - row.sill) > 1e-6 || row.wall_id && name(o.wall_id) !== name(row.wall_id)) throw Error("Opening facts conflict with native schedule dimensions or host");
        }
      }
      for (const kind of ["door", "window"]) {
        const key2 = `${kind}_count`, candidates = (native.claims.length ? native.claims : pages.flatMap((p) => (p.page_evidence?.quantities || []).filter((q) => p.page_evidence.kind === "opening_schedule" || q.document_calculated))).filter((q) => q.key === key2 && canon(q.scope_id) === prefix && q.unit === "nr");
        if (candidates.some((q) => q.value !== f.openings.filter((o) => o.kind === kind).length)) throw Error("Opening ledger does not reconcile to source schedule count");
      }
    }
    for (const cls of ["internal", "external"]) {
      if (!wallTerms[cls].length) throw Error("Both wall classes require complete source coverage");
      add(`${cls}_wall_length`, wallLengths[cls], "Complete source wall centreline inventory, shared walls counted once");
      add(`${cls}_block_area`, wallTerms[cls], "Net wall face area: source lengths \xD7 heights minus each hosted opening once");
    }
    add("wall_length", [...wallLengths.internal, ...wallLengths.external], "Complete internal and external wall inventory");
    add("wall_area", [...wallTerms.internal, ...wallTerms.external], "Net single wall faces, by source classification");
  });
  tryGroup(["plaster_area", "paint_area"], () => {
    if (blocked.has("internal_block_area") || blocked.has("external_block_area")) throw Error("Plaster needs complete net wall faces");
    const faces = { internal: source2(basis.rules.plaster_internal_faces, "count"), external: source2(basis.rules.plaster_external_faces, "count") };
    if (Object.values(faces).some((s) => !Number.isInteger(s.value) || s.value > 2)) throw Error("Invalid plaster face rule");
    plasterTerms = ["internal", "external"].flatMap((cls) => wallTerms[cls].map((t) => ({ ...t, id: `plaster:${t.id}`, factors: [...t.factors, faces[cls]] })));
    add("plaster_area", plasterTerms, "Source plaster face convention applied to net walls");
  });
  tryGroup(["wet_wall_tile_area", "wet_wall_waterproofing_area"], () => {
    const tileHeight = source2(basis.rules.wet_tile_height, "m"), membraneHeight = source2(basis.rules.wet_waterproof_height, "m");
    const wetTerms = (height) => matched.flatMap(({ f }) => {
      if (!f.wet_rooms_complete || !Array.isArray(f.wet_rooms) || f.wet_rooms.length > 500) throw Error("Incomplete wet-room boundary inventory");
      unique2(f.wet_rooms, "id");
      return f.wet_rooms.flatMap((r) => {
        const prefix = canon(f.scope_id);
        if (!r.boundary_complete || !Array.isArray(r.boundary_lengths) || r.boundary_lengths.length < 3 || r.boundary_lengths.length > 100) throw Error("Missing complete wet-room boundary");
        const terms = r.boundary_lengths.map((side, i) => {
          const length = source2(side, "m");
          if (length.value <= 0) throw Error("Zero wet-room boundary side");
          return term2(`${prefix}:${r.id}:wet-side-${i}`, "add", [length, height]);
        });
        if (!Array.isArray(r.opening_ids) || new Set(r.opening_ids.map(name)).size !== r.opening_ids.length) throw Error("Repeated wet-room opening");
        for (const id of r.opening_ids) {
          const o = openingIndex.get(`${prefix}:${name(id)}`);
          if (!o) throw Error("Wet-room opening is not in the source host ledger");
          const width = source2(o.width, "m"), h = source2(o.height, "m"), sill = source2(o.sill, "m");
          terms.push(term2(`${prefix}:${r.id}:${id}:wet-opening`, "subtract", [width, {
            value: null,
            unit: "m",
            operation: "multiply",
            pages: [.../* @__PURE__ */ new Set([...h.pages, ...sill.pages, ...height.pages])],
            evidence: `${h.evidence}; ${sill.evidence}; ${height.evidence}`,
            clip: { opening_height_m: h.value, sill_m: sill.value, finish_height_m: height.value }
          }]));
        }
        return terms;
      });
    });
    tileTerms = wetTerms(tileHeight);
    const membrane = wetTerms(membraneHeight);
    if (!tileTerms.length) throw Error("Wet-room scope is not confirmed");
    add("wet_wall_tile_area", tileTerms, "Wet-room perimeters \xD7 source tile height, openings clipped to that height");
    add("wet_wall_waterproofing_area", membrane, "Wet-room perimeters \xD7 source membrane height, openings clipped to that height");
  });
  tryGroup(["paint_area"], () => {
    if (!plasterTerms.length || blocked.has("plaster_area")) throw Error("Wall paint needs the complete net plaster basis");
    if (!rule(basis.rules.paint_uses_plastered_faces).value) throw Error("Source paint face convention is not confirmed");
    const paintTerms = [...plasterTerms];
    if (rule(basis.rules.paint_excludes_wet_tiles).value) {
      if (blocked.has("wet_wall_tile_area") || !tileTerms.length) throw Error("Wall paint exclusion needs a complete wet tile basis");
      paintTerms.push(...tileTerms.map((t) => ({ ...t, id: `paint-exclude:${t.id}`, operation: t.operation === "add" ? "subtract" : "add" })));
    }
    if (rule(basis.rules.paint_excludes_backsplash).value) paintTerms.push(term2("paint-exclude:backsplash", "subtract", [source2(basis.rules.backsplash_length, "m"), source2(basis.rules.backsplash_height, "m")]));
    add("paint_area", paintTerms, "Explicit source paint face and exclusion convention");
  });
  tryGroup(["ceiling_paint_area"], () => {
    const paint = rule(basis.rules.paint_enclosed_ceilings);
    if (!paint.value) throw Error("Enclosed ceiling paint rule is not confirmed");
    const terms = matched.map(({ page }) => {
      const checked = auditPdfAreaGeometry(page, pages);
      if (!checked.page.__areaGeometryValidated || checked.audit?.withheld_metrics?.includes("ceiling_area") || !(checked.page.ceiling_area > 0)) throw Error("Audited enclosed ceiling area unavailable");
      return term2(`${canon(page.page_evidence.scope_id)}:enclosed-ceiling-paint`, "add", [source2({ value: checked.page.ceiling_area, pages: [.../* @__PURE__ */ new Set([page.pageNumber, ...page.document_area_source_pages || [], ...paint.pages])], evidence: `Audited enclosed ceiling area; ${paint.evidence}` }, "m2")]);
    });
    add("ceiling_paint_area", terms, "Explicit paint-all-enclosed rule applied independently of gypsum exclusions");
  });
  tryGroup(["gypsum_ceiling_area"], () => {
    const gypsumRule = rule(basis.rules.gypsum_exclusions_confirmed);
    if (!gypsumRule.value) throw Error("Source gypsum finish rule is not confirmed");
    const gypsumTerms = [];
    for (const { f, page } of matched) {
      const checked = auditPdfAreaGeometry(page, pages);
      if (checked.audit?.withheld_metrics?.includes("ceiling_area") || !f.ceilings_complete || !Array.isArray(f.ceiling_spaces)) throw Error("Ceiling areas or finish coverage remain unresolved");
      const indoor = (checked.page.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(String(i.unit).toLowerCase()) && i.quantity > 0 && !/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name) && !/^VOID\b|^OUTDOOR\b/i.test(i.description));
      unique2(f.ceiling_spaces, "room_name");
      if (!indoor.length || Math.abs(indoor.reduce((s, i) => s + i.quantity, 0) - checked.page.ceiling_area) > 0.01 || f.ceiling_spaces.length !== indoor.length) throw Error("Ceiling inventory does not reconcile to audited enclosed area");
      const used = /* @__PURE__ */ new Set();
      let measuredCeilingArea = 0;
      for (const r of f.ceiling_spaces) {
        const matching = indoor.filter((i) => name(i.name) === name(r.room_name) || roomTag2(i.name) && roomTag2(i.name) === roomTag2(r.room_name));
        if (matching.length !== 1 || used.has(matching[0].name)) throw Error("Unknown or repeated ceiling room identity");
        used.add(matching[0].name);
        if (typeof r.include_gypsum !== "boolean" || !r.evidence?.trim() || !r.pages?.length || r.pages.some((p) => !availablePages.has(p))) throw Error("Missing source gypsum room classification");
        const item = matching[0], nativeArea = r.native_area ? source2(r.native_area, "m2") : null;
        measuredCeilingArea += nativeArea?.value ?? item.quantity;
        const id = `${canon(f.scope_id)}:${item.name}:ceiling`, factor2 = {
          value: nativeArea?.value ?? item.quantity,
          unit: "m2",
          operation: "multiply",
          clip: null,
          pages: [.../* @__PURE__ */ new Set([page.pageNumber, ...gypsumRule.pages, ...r.pages, ...nativeArea?.pages || []])],
          evidence: `${nativeArea?.evidence || `Audited source room area: ${item.name}; ${item.description}`}; ${gypsumRule.evidence}; ${r.evidence}`
        };
        if (r.include_gypsum) gypsumTerms.push(term2(id, "add", [factor2]));
      }
      if (Math.abs(measuredCeilingArea - checked.page.ceiling_area) > 0.01) throw Error("Native room areas do not close the audited enclosed ceiling scope");
    }
    if (!gypsumTerms.length) throw Error("No confirmed gypsum scope");
    add("gypsum_ceiling_area", gypsumTerms, "Audited room areas with source gypsum exclusions");
  });
  return { calculations: calculations.filter((c) => !blocked.has(c.key)), blocked: [...blocked], issues };
}

// src/lib/pdfNativeSupplementaryScope.mjs
function nativePdfSupplementaryScope(pages) {
  const readable = pages.filter((p) => p.native_text_evidence?.status === "readable");
  const texts = readable.map((p) => ({ page: p.pageNumber, text: p.native_text_evidence.spans.map((s) => s.text).join(" ") }));
  const calculations = [], issues = [], one = (xs, label) => {
    if (xs.length !== 1) throw Error("Missing or ambiguous " + label);
    return xs[0];
  };
  const f = (value, unit5, pages2, evidence) => ({ value, unit: unit5, operation: "multiply", pages: [...new Set(pages2)], evidence, clip: null });
  const calc2 = (key2, terms, evidence) => ({ key: key2, scope_id: "project", terms, evidence });
  const term2 = (id, operation2, factors) => ({ id, operation: operation2, factors });
  const collect = (re) => texts.flatMap((p) => [...p.text.matchAll(re)].map((m) => ({ m, page: p.page })));
  const waterproof = collect(/WATERPROOFING:\s*roof excludes open terrace; terrace is a separate line\./gi);
  if (waterproof.length) {
    try {
      const rule = one(waterproof, "roof/terrace waterproofing scope rule");
      const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan");
      const envelopes = floors.map((p) => {
        const text3 = p.native_plan_text?.status === "readable" ? p.native_plan_text.spans.map((s) => s.text).join(" ") : "";
        const entries = [...text3.matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)];
        const distinct = [...new Map(entries.map((m) => [m.slice(1).map(Number).sort((a, b) => a - b).join("|"), m])).values()];
        const match = one(distinct, "printed floor envelope");
        return { dims: match.slice(1).map(Number).sort((a, b) => a - b), page: p.pageNumber, evidence: match[0] };
      });
      if (!envelopes.length || new Set(envelopes.map((e) => e.dims.join("|"))).size !== 1) throw Error("Roof footprint is not uniquely defined by consistent source envelopes");
      const roof = one(collect(/Roof slab:\s*(\d*\.\d+|\d+)\s*;\s*omit\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+terrace\./gi), "explicit roof terrace omission");
      const dims = envelopes[0].dims, omission = roof.m.slice(2).map(Number).sort((a, b) => a - b);
      if (!texts.some((p) => p.page === roof.page && /All dimensions in metres/i.test(p.text)) || dims.some((v, i) => !(v > 0) || !(omission[i] > 0) || omission[i] >= v)) throw Error("Roof omission dimensions or metre units unresolved");
      const sourcePages = [...envelopes.map((e) => e.page), roof.page, rule.page];
      const gross = dims.map((v) => f(v, "m", sourcePages, "Printed source envelope: " + envelopes[0].evidence));
      const omit = omission.map((v) => f(v, "m", sourcePages, "Roof excludes terrace: " + roof.m[0]));
      calculations.push(calc2("roof_waterproofing_area", [term2("native-roof-gross", "add", gross), term2("native-roof-terrace", "subtract", omit)], rule.m[0] + " Source roof rectangle minus its explicitly omitted terrace."));
      calculations.push(calc2("terrace_waterproofing_area", [term2("native-terrace", "add", omit)], rule.m[0] + " Separate waterproofing of the explicitly dimensioned terrace."));
    } catch (e) {
      issues.push(e.message);
    }
  }
  const railing = collect(/Terrace railing\s+((?:south|east|north|west) edge\s*\d+(?:\.\d+)?\s*m(?:\s*\+\s*(?:south|east|north|west) edge\s*\d+(?:\.\d+)?\s*m)*),\s*height\s*(\d+(?:\.\d+)?)\s*m\./gi);
  if (railing.length) {
    try {
      const r = one(railing, "complete terrace railing statement"), legs = [...r.m[1].matchAll(/(south|east|north|west) edge\s*(\d+(?:\.\d+)?)\s*m/gi)];
      if (!legs.length || new Set(legs.map((m) => m[1].toLowerCase())).size !== legs.length || legs.some((m) => !(Number(m[2]) > 0))) throw Error("Repeated or invalid terrace railing segment");
      calculations.push(calc2("terrace_railing_length", legs.map((m, i) => term2("native-railing:" + i, "add", [f(Number(m[2]), "m", [r.page], r.m[0])])), r.m[0] + " Explicit measured edge lengths, not inferred perimeter."));
    } catch (e) {
      issues.push(e.message);
    }
  }
  const fixtures = collect(/Sanitary fixtures:\s*one toilet pan, one basin and one shower in each of\s+([A-Z]+\d+(?:\s*,\s*[A-Z]+\d+)*(?:\s*,?\s+and\s+[A-Z]+\d+)?)\.\s*Separate kitchen sink in\s+([A-Z]+\d+)\s+and laundry sink in\s+([A-Z]+\d+)\./g);
  if (fixtures.length) {
    try {
      const r = one(fixtures, "declared sanitary fixture inventory"), tags = r.m[1].split(/\s*,\s*|\s+and\s+/).filter(Boolean);
      if (!tags.length || tags.length > 100 || (/* @__PURE__ */ new Set([...tags, r.m[2], r.m[3]])).size !== tags.length + 2) throw Error("Repeated sanitary room identity");
      for (const [key2, n] of [["toilet_count", tags.length], ["basin_count", tags.length], ["shower_count", tags.length], ["kitchen_sink_count", 1], ["laundry_sink_count", 1]]) calculations.push(calc2(key2, [term2("native-fixtures:" + key2, "add", [f(n, "count", [r.page], r.m[0])])], r.m[0] + " Distinct fixture types; one scheduled item per named room."));
    } catch (e) {
      issues.push(e.message);
    }
  }
  return { calculations, issues };
}

// src/lib/pdfNativeSurfaceOperations.mjs
function readNativeSurfaceConventions(pages) {
  const found = [];
  for (const page of pages) {
    const spans = page.native_text_evidence?.status === "readable" ? page.native_text_evidence.spans : [];
    for (const head of spans.filter((s) => s.text === "Code")) {
      const band5 = (y) => spans.filter((s) => Math.abs(s.y - y) < 1.5).sort((a, b) => a.x - b.x);
      const cols = band5(head.y);
      if (cols.length !== 3 || cols[1].text !== "Material" || cols[2].text !== "Measurement rule") continue;
      for (const key2 of spans.filter((s) => s.y < head.y - 3 && Math.abs(s.x - head.x) < 15 && /^[A-Z]+\d*$/.test(s.text))) {
        const cells = band5(key2.y), description = cells.filter((s) => Math.abs(s.x - cols[1].x) < 10).map((s) => s.text).join(" "), rule = cells.filter((s) => Math.abs(s.x - cols[2].x) < 10).map((s) => s.text).join(" ");
        let family2 = null;
        if (/^Full-height fixed internal glass$/i.test(description) && /^Net CL length x local height less .+ glass door openings; BOQ m2$/i.test(rule)) family2 = "fixed-glazing";
        if (/^Exterior weather paint$/i.test(description) && /^Net [A-Z]+\d+ wall area; no parapets or reveals$/i.test(rule)) family2 = "external-paint";
        if (!family2) continue;
        if (found.some((c) => c.family === family2)) throw Error("Duplicate or conflicting surface measurement declaration");
        found.push({ sourceCode: key2.text, family: family2, sourceDescription: description, rule, page: page.pageNumber });
      }
    }
  }
  return found;
}
function measureNativeSurfaceOperations(plan, openings, height, conventions) {
  if (!(height > 0)) throw Error("Invalid local surface height");
  return conventions.flatMap((c) => {
    const classification = c.family === "fixed-glazing" ? "glass" : "external", walls = plan.walls.filter((w) => w.classification === classification);
    if (!walls.length) return [];
    const hostOpenings = openings.filter((o) => o.host?.classification === classification);
    if (c.family === "fixed-glazing" && hostOpenings.some((o) => o.kind !== "door")) throw Error("Unsupported opening in internal fixed glazing");
    const unique6 = /* @__PURE__ */ new Set();
    for (const o of hostOpenings) {
      if (unique6.has(o.id) || !(o.width > 0 && o.height > 0) || o.height + (o.sill || 0) > height) throw Error("Invalid or duplicated surface opening");
      unique6.add(o.id);
    }
    if (walls.some((w) => !(w.length > 0))) throw Error("Invalid surface wall length");
    const gross = walls.reduce((s, w) => s + w.length * height, 0), deduct = hostOpenings.reduce((s, o) => s + o.width * o.height, 0), quantity = gross - deduct;
    if (quantity < 0) throw Error("Surface opening deductions exceed host area");
    if (!quantity) return [];
    return [{ ...c, quantity, unit: "m2", pages: [c.page, plan.page.pageNumber, ...hostOpenings.map((o) => o.page)], basis: `${c.rule}; unique ${classification} CL runs: ${walls.map((w) => w.length).join(" + ")} m \xD7 ${height} m = ${gross} m2; subtract unique hosted openings ${hostOpenings.map((o) => `${o.id} ${o.width}\xD7${o.height}`).join(" + ") || "none"} = ${deduct} m2; net ${quantity} m2. No extra face multiplier.` }];
  });
}

// src/lib/pdfNativeCoordinatedQuantities.mjs
var E2 = 2e-4;
var near3 = (a, b) => Math.abs(a - b) < E2;
var clean2 = (s) => String(s || "").trim().replace(/\s+/g, " ");
var textOf2 = (p) => p.native_text_evidence?.status === "readable" ? p.native_text_evidence.spans.map((s) => s.text).join(" ") : "";
var unique3 = (a, label) => {
  if (a.length !== 1) throw Error("Ambiguous or missing " + label);
  return a[0];
};
var on3 = (p, w) => Math.abs((w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x)) < E2 && p.x >= Math.min(w.a.x, w.b.x) - E2 && p.x <= Math.max(w.a.x, w.b.x) + E2 && p.y >= Math.min(w.a.y, w.b.y) - E2 && p.y <= Math.max(w.a.y, w.b.y) + E2;
var boundary = (p, r) => (near3(p.x, r.bounds.x0) || near3(p.x, r.bounds.x1)) && p.y >= r.bounds.y0 - E2 && p.y <= r.bounds.y1 + E2 || (near3(p.y, r.bounds.y0) || near3(p.y, r.bounds.y1)) && p.x >= r.bounds.x0 - E2 && p.x <= r.bounds.x1 + E2;
var band = (spans, y) => spans.filter((s) => Math.abs(s.y - y) < 1.5).sort((a, b) => a.x - b.x);
var factor = (value, unit5, pages, evidence) => ({ value, unit: unit5, operation: "multiply", pages: [...new Set(pages)], evidence, clip: null });
var term = (id, operation2, factors) => ({ id, operation: operation2, factors });
var calc = (key2, scope_id, terms, evidence) => ({ key: key2, scope_id, terms, evidence });
function cellsAt(spans, y, cols) {
  const cells = cols.map(() => []);
  for (const s of band(spans, y)) {
    let i = 0;
    for (let j = 1; j < cols.length; j++) if (Math.abs(s.x - cols[j].x) < Math.abs(s.x - cols[i].x)) i = j;
    cells[i].push(s.text);
  }
  return cells.map((c) => clean2(c.join(" ")));
}
function readNativeInstanceTables(pages) {
  const result = [];
  for (const page of pages) {
    const text3 = textOf2(page), kind = /DOOR SCHEDULE\s*\/\s*UNIQUE INSTANCES/i.test(text3) ? "door" : /WINDOW SCHEDULE\s*\/\s*UNIQUE INSTANCES/i.test(text3) ? "window" : null;
    if (!kind) continue;
    const spans = page.native_text_evidence.spans;
    const header = unique3(spans.filter((s) => s.text === "Instance"), "instance-table header"), cols = band(spans, header.y);
    const expected = kind === "door" ? ["Instance", "Type", "W m", "H m", "Spaces", "CL endpoints (x,y) m"] : ["Instance", "Type", "W m", "H m", "Sill m", "Room", "CL endpoints (x,y) m"];
    if (cols.map((s) => s.text).join("|") !== expected.join("|")) throw Error("Unsupported instance table columns or units");
    const anchors = spans.filter((s) => s.y < header.y - 3 && Math.abs(s.x - header.x) < 10 && /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(s.text));
    if (!anchors.length || anchors.length > 500) throw Error("Empty or excessive unique instance schedule");
    for (const anchor of anchors) {
      const cells = cellsAt(spans, anchor.y, cols), last = cells.at(-1), coordinates = last.match(/^\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\) to \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/);
      const width = Number(cells[2]), height = Number(cells[3]), sill = kind === "window" ? Number(cells[4]) : 0;
      if (!coordinates || !/^\d+(?:\.\d+)?$/.test(cells[2]) || !/^\d+(?:\.\d+)?$/.test(cells[3]) || !(width > 0 && height > 0 && width <= 50 && height <= 50) || !Number.isFinite(sill) || sill < 0 || sill > 50) throw Error("Invalid sourced opening dimensions");
      const [x1, y1, x2, y2] = coordinates.slice(1).map(Number), a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
      if (!near3(x1, x2) && !near3(y1, y2) || !near3(Math.hypot(x2 - x1, y2 - y1), width)) throw Error("Opening width and source endpoints disagree");
      const spaces = cells[kind === "window" ? 5 : 4].split(/\s*\/\s*/);
      if (spaces.length !== (kind === "window" ? 1 : 2) || spaces.some((s) => !/^(?:[A-Z]+\d+|EXT)$/.test(s))) throw Error("Opening room identities unsupported");
      if (result.some((o) => o.id === cells[0])) throw Error("Duplicate physical opening instance");
      result.push({ id: cells[0], type: cells[1], kind, width, height, sill, a, b, spaces, page: page.pageNumber, evidence: cells.join(" | ") });
    }
  }
  if (!result.some((o) => o.kind === "door") || !result.some((o) => o.kind === "window")) throw Error("Both coordinated door and window instance schedules required");
  return result;
}
function finishRegister(pages, plans) {
  const tags = new Set(plans.flatMap((p) => p.rooms.map((r) => r.tag))), entries = /* @__PURE__ */ new Map();
  for (const page of pages) {
    const native = page.native_text_evidence;
    if (native?.status !== "readable") continue;
    const spans = native.spans, heads = spans.filter((s) => /^(?:GF|FF|[A-Z]+) room$/.test(s.text));
    if (!heads.length) continue;
    const y = unique3([...new Set(heads.map((s) => s.y))], "room finish-register header"), cols = band(spans, y);
    if (cols.length % 3 || cols.some((c, i) => i % 3 === 0 ? !/^[A-Z]+ room$/.test(c.text) : i % 3 === 1 ? c.text !== "Floor" : c.text !== "Ceiling")) throw Error("Unsupported room finish-register columns");
    const tableSpans = spans.filter((s) => s.x >= cols[0].x - 10);
    const roomColumns = cols.filter((_, i) => i % 3 === 0);
    const ys = [...new Set(tableSpans.filter((s) => s.y < y - 3 && tags.has(s.text) && roomColumns.some((c) => Math.abs(c.x - s.x) < 10)).map((s) => s.y))];
    for (const rowY of ys) {
      const cells = cellsAt(tableSpans, rowY, cols);
      for (let i = 0; i < cells.length; i += 3) {
        const [tag, floor2, ceiling] = cells.slice(i, i + 3);
        if (!tags.has(tag) || entries.has(tag) || !/^([A-Z]+\d+|VOID)$/.test(floor2) || !/^([A-Z]+\d+|VOID)$/.test(ceiling)) throw Error("Missing, duplicate or unknown finish-register room");
        entries.set(tag, { floor: floor2, ceiling, page: page.pageNumber });
      }
    }
  }
  if (entries.size !== tags.size || [...tags].some((t) => !entries.has(t))) throw Error("Finish register does not cover every source room");
  const legends = /* @__PURE__ */ new Map();
  for (const page of pages) {
    const spans = page.native_text_evidence?.status === "readable" ? page.native_text_evidence.spans : [];
    for (const head of spans.filter((s) => s.text === "Code")) {
      const cols = band(spans, head.y);
      if (cols.length !== 3 || !["Floor finish", "Description"].includes(cols[1].text)) continue;
      const keys = new Set([...entries.values()].map((r) => cols[1].text === "Description" ? r.ceiling : r.floor));
      for (const anchor of spans.filter((s) => s.y < head.y - 3 && Math.abs(s.x - head.x) < 15 && keys.has(s.text))) {
        const cells = cellsAt(spans, anchor.y, cols), old = legends.get(cells[0]);
        if (old && old.description !== cells[1]) throw Error("Conflicting source finish legend");
        legends.set(cells[0], { description: cells[1], rule: cells[2], page: page.pageNumber });
      }
    }
  }
  return { entries, legends };
}
function nativeCoordinatedPdfCalculations(pages) {
  const calculations = [], issues = [], details = [];
  const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan");
  if (!floors.some((p) => p.native_clear_geometry)) return { calculations, issues, details };
  try {
    const plans = floors.map((p) => ({ ...measureNativeClearPlan(p, pages), page: p }));
    if (plans.some((p) => p.status !== "checked")) throw Error("Every selected floor requires checked native CL geometry");
    const openings = readNativeInstanceTables(pages), source2 = pages.map((p) => ({ page: p.pageNumber, text: textOf2(p) })), all = source2.map((p) => p.text).join(" ");
    if (!/Partition lengths use full grid CL lengths\. Do not deduct T-junction overlaps/i.test(all) || !/deduct every scheduled door\/window opening, regardless of size/i.test(all)) throw Error("Complete CL wall/opening measurement conventions required");
    const finish = finishRegister(pages, plans);
    const wetRule = unique3(source2.flatMap((p) => [...p.text.matchAll(/([A-Z]+\d+(?:\/[A-Z]+\d+)+):\s*all four clear walls to\s*(\d+(?:\.\d+)?)\s*m;\s*less doors\/windows below\s*(\d+(?:\.\d+)?)/gi)].map((m) => ({ tags: m[1].split("/"), height: Number(m[2]), clip: Number(m[3]), page: p.page }))), "wet-room finish rule");
    if (!near3(wetRule.height, wetRule.clip)) throw Error("Contradictory wet finish clip height");
    const upstand = unique3(source2.flatMap((p) => [...p.text.matchAll(/(\d+(?:\.\d+)?)\s*m high x wet-room clear perimeter minus door widths/gi)].map((m) => ({ height: Number(m[1]), page: p.page }))), "wet upstand measurement rule");
    if (!/For each room, measure 2 x \(clear width \+ clear depth\) x local wall height/i.test(all) || !/Subtract the entire clear length of any full-height GL01 face/i.test(all) || !/All solid clear room wall faces, less openings; includes under wet wall tiles/i.test(all) || !/PL01 net faces minus WT01 tiled faces/i.test(all)) throw Error("Explicit clear-wall finish conventions required");
    const surfaceConventions = readNativeSurfaceConventions(pages);
    const baseRulePages = source2.filter((p) => /Partition lengths use full grid CL|For each room, measure 2 x/.test(p.text)).map((p) => p.page);
    const consumed = /* @__PURE__ */ new Set();
    for (const plan of plans) {
      const p = plan.page, scope2 = p.page_evidence.scope_id, planText = p.native_plan_text.spans.map((s) => s.text).join(" ");
      const floorName = unique3([...planText.matchAll(/\b(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF) FLOOR\s*\/\s*ARCHITECTURAL PLAN/gi)], "source architectural floor name")[1];
      const height = unique3(source2.flatMap((s) => [...s.text.matchAll(new RegExp(`\\b${floorName} external and internal walls\\s+(\\d+(?:\\.\\d+)?) m above`, "gi"))].map((m) => ({ value: Number(m[1]), page: s.page }))), "local floor wall height");
      const roomTags = new Set(plan.rooms.map((r) => r.tag)), local = openings.filter((o) => o.spaces.some((s) => roomTags.has(s)));
      const printedTags = p.native_plan_text.spans.filter((s) => /^[A-Z]+-[DW]\d+$/.test(s.text.trim())).map((s) => s.text.trim());
      if (printedTags.length !== local.length || new Set(printedTags).size !== printedTags.length || local.some((o) => !printedTags.includes(o.id))) throw Error("Opening instance ledger does not match every printed plan tag");
      for (const o of local) {
        if (consumed.has(o.id)) throw Error("Opening belongs to multiple floors");
        consumed.add(o.id);
        const host = unique3(plan.walls.filter((w) => on3(o.a, w) && on3(o.b, w)), "source opening vector host " + o.id), middle = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        const adjacent = plan.rooms.filter((r) => boundary(middle, r)).map((r) => r.tag).sort(), declared = o.spaces.filter((s) => s !== "EXT").sort();
        if (adjacent.join("|") !== declared.join("|") || host.classification === "external" && declared.length !== 1 || host.classification !== "external" && declared.length !== 2 || o.kind === "window" && host.classification !== "external") throw Error("Opening room relationship conflicts with native topology: " + o.id);
        o.host = host;
      }
      const proof = [.../* @__PURE__ */ new Set([p.pageNumber, ...plan.audit.source_pages, ...baseRulePages, height.page])];
      const f = (n, u, label, extra = []) => factor(n, u, [...proof, ...extra], label);
      const openingTerm = (o, id, faces = 1, clip2 = null) => term(id, "subtract", [f(o.width, "m", o.id + " source width", [o.page]), clip2 ? { value: null, unit: "m", operation: "multiply", pages: [...proof, o.page, wetRule.page], evidence: o.id + " source sill/height clipped to finish band", clip: { opening_height_m: o.height, sill_m: o.sill, finish_height_m: clip2 } } : f(o.height, "m", o.id + " source opening height", [o.page]), ...faces === 1 ? [] : [f(faces, "count", "Measured solid finished faces")]]);
      for (const [kind, countKey, areaKey] of [["door", "door_count", "door_area"], ["window", "window_count", "window_area"]]) {
        const rows = local.filter((o) => o.kind === kind);
        if (rows.length) {
          calculations.push(calc(countKey, scope2, rows.map((o) => term(o.id + ":count", "add", [f(1, "count", "Unique hosted source instance " + o.id, [o.page])])), "Count unique physically hosted source instances once"));
          calculations.push(calc(areaKey, scope2, rows.map((o) => term(o.id + ":area", "add", [f(o.width, "m", o.id + " scheduled width", [o.page]), f(o.height, "m", o.id + " scheduled height", [o.page])])), "Sum each unique scheduled source opening width times height once"));
        }
      }
      for (const [classification, key2] of [["external", "external_block_area"], ["internal", "internal_block_area"]]) {
        const terms = plan.walls.filter((w) => w.classification === classification).map((w, i) => term(`${scope2}:${classification}:${i}`, "add", [f(w.length, "m", "Calibrated full CL vector length"), f(height.value, "m", "Printed local floor wall height")]));
        terms.push(...local.filter((o) => o.host.classification === classification).map((o) => openingTerm(o, o.id + ":masonry")));
        calculations.push(calc(key2, scope2, terms, "Source CL wall lengths; no T-junction overlap deductions; all scheduled openings deducted once on their physical host"));
      }
      const plaster = [], tile = [], up = [], wetFloors = [], gypsum = [], ceilingPaint = [], roomDetails = [];
      for (const r of plan.rooms) {
        const register = finish.entries.get(r.tag), ceiling = finish.legends.get(register.ceiling);
        if (r.void !== (register.floor === "VOID") || r.void !== (register.ceiling === "VOID")) throw Error("Void and finish register disagree");
        const areaTerms = (label) => [term(r.tag + ":" + label, "add", [f(r.width, "m", r.tag + " clear width"), f(r.depth, "m", r.tag + " clear depth")]), ...r.deductions.map((d, i) => term(`${r.tag}:${label}:deduction:${i}`, "subtract", [f(d.x1 - d.x0, "m", "Explicit stair exclusion width"), f(d.y1 - d.y0, "m", "Explicit stair exclusion depth")]))];
        if (!r.void) {
          if (!ceiling) throw Error("Ceiling finish code has no source legend");
          if (/gypsum/i.test(ceiling.description)) gypsum.push(...areaTerms("gypsum").map((t) => ({ ...t, factors: t.factors.map((v) => ({ ...v, pages: [.../* @__PURE__ */ new Set([...v.pages, register.page, ceiling.page])] })) })));
          if (!/paint/i.test(ceiling.rule + " " + ceiling.description)) throw Error("Ceiling painting scope not explicitly declared");
          ceilingPaint.push(...areaTerms("ceiling-paint"));
        }
        const perim = (label) => [term(`${r.tag}:${label}:width-sides`, "add", [f(2, "count", "Two opposite room faces"), f(r.width, "m", r.tag + " clear width"), f(height.value, "m", "Printed local wall height")]), term(`${r.tag}:${label}:depth-sides`, "add", [f(2, "count", "Two opposite room faces"), f(r.depth, "m", r.tag + " clear depth"), f(height.value, "m", "Printed local wall height")])];
        const own = perim("plaster");
        let glassClearLength = 0;
        for (const glass of plan.walls.filter((w) => w.classification === "glass" && w.rooms.includes(r.tag))) {
          const adjacent = plan.rooms.filter((room) => glass.rooms.includes(room.tag)), axis = glass.axis === "h" ? "x" : "y";
          const length = Math.min(...adjacent.map((q) => q.clear[axis + "1"])) - Math.max(...adjacent.map((q) => q.clear[axis + "0"]));
          if (!(length > 0 && length <= glass.length)) throw Error("Glass clear-face length invalid");
          glassClearLength += length;
          own.push(term(`${r.tag}:glass:${glass.rooms.join("-")}`, "subtract", [f(length, "m", "Shared clear glass face; intersection of both adjoining room clear extents"), f(height.value, "m", "Full local wall height")]));
        }
        own.push(...local.filter((o) => o.spaces.includes(r.tag) && o.host.classification !== "glass").map((o) => openingTerm(o, r.tag + ":" + o.id + ":finish")));
        plaster.push(...own);
        if (wetRule.tags.includes(r.tag)) {
          if (plan.walls.some((w) => w.classification === "glass" && w.rooms.includes(r.tag))) throw Error("Wet glass finish rule unresolved");
          wetFloors.push(...areaTerms("wet-floor"));
          for (const [key2, h] of [["tile", wetRule.height], ["upstand", upstand.height]]) {
            const list2 = key2 === "tile" ? tile : up;
            list2.push(term(r.tag + ":" + key2 + ":width-sides", "add", [f(2, "count", "Two room faces"), f(r.width, "m", "Clear room width"), f(h, "m", "Explicit wet finish height", [key2 === "tile" ? wetRule.page : upstand.page])]), term(r.tag + ":" + key2 + ":depth-sides", "add", [f(2, "count", "Two room faces"), f(r.depth, "m", "Clear room depth"), f(h, "m", "Explicit wet finish height", [key2 === "tile" ? wetRule.page : upstand.page])]));
            for (const o of local.filter((o2) => o2.spaces.includes(r.tag) && (key2 === "tile" || o2.kind === "door"))) {
              if (key2 === "tile") list2.push(openingTerm(o, r.tag + ":" + o.id + ":tile", 1, h));
              else list2.push(term(r.tag + ":" + o.id + ":upstand", "subtract", [f(o.width, "m", "Door width excluded from upstand", [o.page]), f(h, "m", "Explicit upstand height", [upstand.page])]));
            }
          }
        }
        const skirting = r.void || wetRule.tags.includes(r.tag) ? 0 : 2 * (r.width + r.depth) - glassClearLength - local.filter((o) => o.kind === "door" && o.spaces.includes(r.tag) && o.host.classification !== "glass").reduce((s, o) => s + o.width, 0);
        if (skirting < 0) throw Error("Skirting deductions exceed clear room perimeter");
        roomDetails.push({
          tag: r.tag,
          width: r.width,
          depth: r.depth,
          floor_area: r.void ? 0 : r.area,
          floor_code: register.floor,
          ceiling_code: register.ceiling,
          skirting_length: skirting,
          skirting_description: finish.legends.get(register.floor)?.rule || null,
          floor_description: finish.legends.get(register.floor)?.description || null,
          ceiling_description: ceiling?.description || null,
          caption: r.caption,
          wet: wetRule.tags.includes(r.tag),
          finish_source_pages: [.../* @__PURE__ */ new Set([p.pageNumber, register.page, ...ceiling ? [ceiling.page] : [], ...finish.legends.get(register.floor) ? [finish.legends.get(register.floor).page] : []])],
          plaster_terms: own
        });
      }
      for (const [key2, terms] of [["plaster_area", plaster], ["paint_area", [...plaster, ...tile.map((t) => ({ ...t, id: "paint-exclude:" + t.id, operation: t.operation === "add" ? "subtract" : "add" }))]], ["wet_wall_tile_area", tile], ["wet_wall_waterproofing_area", up], ["wet_floor_area", wetFloors], ["wet_floor_waterproofing_area", wetFloors], ["gypsum_ceiling_area", gypsum], ["ceiling_paint_area", ceilingPaint]]) if (terms.length) calculations.push(calc(key2, scope2, terms, "Original PDF coordinated native room geometry, unique opening ledger and explicit finish/height conventions; no model-calculated totals used"));
      let surface_operations = [], surface_operations_valid = true;
      try {
        surface_operations = measureNativeSurfaceOperations(plan, local, height.value, surfaceConventions).map((o) => ({ ...o, pages: [.../* @__PURE__ */ new Set([...o.pages, ...proof])] }));
      } catch (error2) {
        surface_operations_valid = false;
        issues.push(`Native surface operations on page ${p.pageNumber} withheld: ${error2.message}`);
      }
      details.push({ page: p.pageNumber, scope: scope2, rooms: roomDetails, surface_operations, surface_operations_valid, source_openings: local.map((o) => ({ id: o.id, type: o.type, kind: o.kind, width: o.width, height: o.height, source_page: o.page, host: o.host.classification, spaces: o.spaces })) });
    }
    if (consumed.size !== openings.length) throw Error("Unmatched source opening floor");
    if (wetRule.tags.some((tag) => !details.some((d) => d.rooms.some((r) => r.tag === tag)))) throw Error("Unmatched wet-room finish scope");
  } catch (e) {
    return { calculations: [], issues: ["Native coordinated quantities withheld: " + e.message], details: [] };
  }
  return { calculations, issues, details };
}

// src/lib/pdfDeclaredScheduleOperations.mjs
var textOf3 = (p) => p.native_text_evidence?.status === "readable" ? p.native_text_evidence.spans.map((s) => s.text).join(" ") : "";
var band2 = (spans, y) => spans.filter((s) => Math.abs(s.y - y) < 1.5).sort((a, b) => a.x - b.x);
var clean3 = (s) => String(s || "").trim().replace(/\s+/g, " ");
var unit = (s) => ({ nos: "nr", no: "nr", each: "nr", point: "nr", set: "nr", "m\xB2": "m2", "m\xB3": "m3" })[s] || s;
function declaredOperationKind(description) {
  const d = clean3(description).toLowerCase().replace(/[-–]/g, " ");
  if (/pipe insulation/.test(d)) return { family: "pipe-insulation", replacesMetrics: [] };
  if (/\bpipe\b/.test(d)) {
    const metrics = /\b(?:fcu|chilled|chw)\b|supply\s*\+\s*return/.test(d) ? ["ac_pipe_length"] : /waste|soil|drain/.test(d) ? ["waste_pipe_length"] : /cold water|hot water|water supply/.test(d) ? ["water_pipe_length"] : [];
    return { family: "pipe", replacesMetrics: metrics };
  }
  if (/\bduct\b/.test(d)) return { family: "duct-sheet", replacesMetrics: [] };
  if (/power cable|cable tray|conduit/.test(d)) return { family: "electrical-route", replacesMetrics: [] };
  const kinds = [[/fan\s*coil|\bfcu\b/, "equipment", ["ac_count"]], [/led lights?|light fittings?/, "electrical", ["light_count"]], [/socket/, "electrical", ["socket_count"]], [/distribution board/, "electrical", ["distribution_board_count"]], [/smoke detector/, "electrical", ["smoke_detector_count"]], [/toilet pan|water closet/, "fixture", ["toilet_count"]], [/wash basin/, "fixture", ["basin_count"]], [/shower/, "fixture", ["shower_count"]], [/\bsink/, "fixture", ["kitchen_sink_count", "laundry_sink_count"]]];
  for (const [re, family2, replacesMetrics] of kinds) if (re.test(d)) return { family: family2, replacesMetrics };
  return null;
}
function nativeDeclaredScheduleOperations(pages, details) {
  const operations2 = [], issues = [], openingKinds = /* @__PURE__ */ new Set();
  const add = (o) => {
    if (operations2.some((x) => x.metricKey === o.metricKey)) throw Error("Duplicate declared source operation " + o.sourceCode);
    operations2.push(o);
  };
  for (const kind of ["door", "window"]) {
    const start = operations2.length;
    try {
      const instances = details.flatMap((d) => d.source_openings || []).filter((o) => o.kind === kind);
      if (!instances.length) continue;
      if (new Set(instances.map((o) => o.id)).size !== instances.length) throw Error("Repeated physical instance");
      const groups = /* @__PURE__ */ new Map();
      for (const o of instances) {
        const g = groups.get(o.type) || [];
        g.push(o);
        groups.set(o.type, g);
      }
      for (const [code, rows] of groups) {
        let descriptions = [];
        for (const p of pages) for (const s of p.native_text_evidence?.spans || []) {
          const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp("(?:^|[.;]\\s+)" + escaped + "(?::\\s*|\\s+)(.*?)(?=[.;]\\s+[A-Z]+\\d+[: ]|$)", "g");
          for (const m of s.text.matchAll(re)) if (m[1].trim()) descriptions.push(clean3(m[1]).replace(/[.;]$/, ""));
        }
        if (kind === "window") {
          const specs = pages.flatMap((p) => (p.native_text_evidence?.spans || []).filter((s) => /^Powder-coated aluminium double-glazed windows, measured by net scheduled opening area\.$/.test(s.text)).map((s) => s.text));
          if (specs.length) descriptions = ["Powder-coated aluminium double-glazed window"];
        }
        descriptions = [...new Set(descriptions)];
        if (descriptions.length > 1) throw Error("Conflicting type descriptions " + code);
        const variants = [...new Map(rows.map((o) => [o.width + "x" + o.height, { width: o.width, height: o.height }])).values()];
        const description = (descriptions[0] || `${kind === "window" ? "Window" : "Door"} type ${code}; material not declared`) + (variants.length === 1 ? ` ${variants[0].width.toFixed(3)} x ${variants[0].height.toFixed(3)} m` : "; varying scheduled dimensions");
        const family2 = kind + "-set", quantity = kind === "door" ? rows.length : rows.reduce((s, o) => s + o.width * o.height, 0);
        add({
          metricKey: `native-${family2}:${code}`,
          family: family2,
          sourceCode: code,
          sourceDescription: description,
          quantity,
          unit: kind === "door" ? "nr" : "m2",
          pages: [.../* @__PURE__ */ new Set([...rows.map((o) => o.source_page), ...details.filter((d) => d.source_openings?.some((o) => rows.some((r) => r.id === o.id))).map((d) => d.page)])],
          instances: rows.map((o) => ({ id: o.id, width: o.width, height: o.height })),
          basis: `Unique hosted ${kind} instances only: ${rows.map((o) => `${o.id} ${o.width} x ${o.height} m`).join("; ")}. ${kind === "door" ? "Count once per set" : "Sum each physical width x height once"}.`,
          replacesMetrics: kind === "door" ? ["door_count", "internal_door_count", "service_door_count", "entrance_door_count", "garage_door_count"] : ["window_area", "window_count"]
        });
      }
      openingKinds.add(kind);
    } catch (e) {
      operations2.splice(start);
      issues.push(`Declared ${kind} schedule withheld: ${e.message}`);
    }
  }
  for (const page of pages) {
    const spans = page.native_text_evidence?.status === "readable" ? page.native_text_evidence.spans : [];
    for (const head of spans.filter((s) => s.text === "Code")) {
      const cols = band2(spans, head.y), names = cols.map((s) => s.text);
      const lengthTable = names.join("|") === "Code|Source operation|Quantity|Unit";
      const countTable = names.join("|") === "Code|Description|Ground|First|Project qty";
      if (!lengthTable && !countTable) continue;
      const start = operations2.length;
      try {
        if (!/project (?:counts|totals)|declared MEP|total lengths/i.test(textOf3(page))) throw Error("Project scope of schedule is not declared");
        const anchors = spans.filter((s) => s.y < head.y - 3 && Math.abs(s.x - head.x) < 10 && /^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/.test(s.text));
        if (!anchors.length || anchors.length > 500) throw Error("Empty or excessive declared schedule");
        for (const anchor of anchors) {
          const cells = band2(spans, anchor.y);
          const at2 = (i) => {
            const matches = cells.filter((s) => Math.abs(s.x - cols[i].x) < 10);
            if (matches.length !== 1) throw Error("Missing/ambiguous schedule cell");
            return matches[0].text;
          };
          const description = at2(1), classification = declaredOperationKind(description);
          if (!classification) throw Error("Unknown source operation: " + description);
          const raw = countTable ? at2(4) : at2(2), u = countTable ? "nr" : unit(at2(3));
          if (!/^\d+(?:\.\d+)?$/.test(raw)) throw Error("Non-numeric declared quantity");
          const quantity = Number(raw);
          if (!(quantity >= 0 && quantity < 1e9) || !["m", "m2", "m3", "nr"].includes(u) || u === "nr" && !Number.isInteger(quantity)) throw Error("Unsupported quantity/unit");
          if (countTable && (!/^\d+$/.test(at2(2)) || !/^\d+$/.test(at2(3)) || Number(at2(2)) + Number(at2(3)) !== quantity)) throw Error("Floor counts do not reconcile to project count");
          if (!quantity) continue;
          const expected = classification.family === "pipe" || classification.family === "pipe-insulation" || classification.family === "electrical-route" ? "m" : classification.family === "duct-sheet" ? "m2" : "nr";
          if (u !== expected) throw Error("Unit conflicts with source operation");
          add({ metricKey: `native-${classification.family}:${anchor.text}`, sourceCode: anchor.text, sourceDescription: description, ...classification, quantity, unit: u, pages: [page.pageNumber], basis: `Original declared project schedule: ${anchor.text} | ${description} | ${quantity} ${u}; ${countTable ? "Ground " + at2(2) + " + First " + at2(3) + " = project total." : "Total already includes stated horizontal runs and risers; no extra multiplier."}` });
        }
      } catch (e) {
        operations2.splice(start);
        issues.push(`Declared schedule page ${page.pageNumber} withheld: ${e.message}`);
      }
    }
  }
  const skirt = pages.filter((p) => /skirting uses clear perimeter minus door widths and full-height glass clear faces/i.test(textOf3(p)));
  if (skirt.length === 1) {
    const groups = /* @__PURE__ */ new Map();
    for (const room of details.flatMap((d) => d.rooms).filter((r) => r.skirting_length > 0)) {
      const g = groups.get(room.floor_code) || { quantity: 0, description: room.skirting_description, rooms: [] };
      if (!g.description || g.description !== room.skirting_description) throw Error("Skirting legend unresolved");
      g.quantity += room.skirting_length;
      g.rooms.push(room.tag);
      groups.set(room.floor_code, g);
    }
    for (const [code, g] of groups) add({ metricKey: `native-skirting:${code}`, family: "skirting", sourceCode: code, sourceDescription: g.description, quantity: g.quantity, unit: "m", pages: [skirt[0].pageNumber, ...details.map((d) => d.page)], basis: `Source clear room perimeter less solid door widths and full shared glass faces; excludes wet rooms and void. Rooms: ${g.rooms.join(", ")}.` });
  }
  return { operations: operations2, issues, openingKinds };
}

// src/lib/pdfNativeServiceOperations.mjs
var textOf4 = (p) => p.native_text_evidence?.status === "readable" ? p.native_text_evidence.spans.map((s) => s.text).join(" ") : "";
var unique4 = (a, label) => {
  if (a.length !== 1) throw Error("Ambiguous or missing " + label);
  return a[0];
};
var band3 = (spans, y) => spans.filter((s) => Math.abs(s.y - y) < 1.5).sort((a, b) => a.x - b.x);
function panels(page, details, headerY) {
  const spans = page.native_text_evidence.spans, heads = spans.filter((s) => /^(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF)$/.test(s.text)).sort((a, b) => a.x - b.x);
  if (heads.length !== details.length || new Set(heads.map((h) => h.text)).size !== heads.length || heads.some((h) => Math.abs(h.y - heads[0].y) > 2)) throw Error("Service drawing floor panels unresolved");
  return heads.map((h, i) => {
    const x0 = h.x - 20, x1 = heads[i + 1]?.x - 20 || Infinity, inside5 = spans.filter((s) => s.x >= x0 && s.x < x1 && s.y < h.y && s.y > headerY + 5);
    const floor2 = unique4(details.filter((d) => d.rooms.some((r) => inside5.some((s) => s.text === r.tag))), "source service panel floor");
    if (floor2.rooms.some((r) => !inside5.some((s) => s.text === r.tag))) throw Error("Service panel does not cover all architectural rooms");
    return { heading: h.text, spans: inside5, floor: floor2 };
  });
}
function nativePdfServiceOperations(pages, details) {
  const declared = nativeDeclaredScheduleOperations(pages, details);
  const operations2 = [...declared.operations], issues = [...declared.issues];
  const roomCount = details.flatMap((d) => d.rooms).filter((r) => r.floor_code !== "VOID").length;
  const corridors = details.flatMap((d) => d.rooms).filter((r) => /\bcorridor\b/i.test(r.caption || "") && r.floor_code !== "VOID").length;
  const cores = details.flatMap((d) => d.rooms).filter((r) => /\bstair lobby\b|\bcore\b/i.test(r.caption || "") && r.floor_code !== "VOID").length;
  const wet = details.flatMap((d) => d.rooms).filter((r) => r.wet).length;
  const add = (page, code, family2, description, quantity, unit5, basis, replacesMetric = null) => {
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 || unit5 === "nr" && !Number.isInteger(quantity)) throw Error("Invalid native service operation");
    const metricKey = `native-${family2}:${code}`;
    if (operations2.some((o) => o.metricKey === metricKey)) throw Error("Repeated native service operation");
    operations2.push({ metricKey, family: family2, sourceCode: code, sourceDescription: description, quantity, unit: unit5, pages: [.../* @__PURE__ */ new Set([page, ...details.map((d) => d.page)])], basis, replacesMetric });
  };
  const surfaceGroups = /* @__PURE__ */ new Map();
  const surfacesComplete = details.every((d) => d.surface_operations_valid !== false);
  if (!surfacesComplete) issues.push("Native surface scope withheld across all floors: at least one floor has invalid surface measurements; no partial aggregate published.");
  for (const floor2 of surfacesComplete ? details : []) for (const op of floor2.surface_operations || []) {
    const key2 = op.family + ":" + op.sourceCode, g = surfaceGroups.get(key2) || { ...op, quantity: 0, pages: [], basis: [] };
    if (g.sourceDescription !== op.sourceDescription) throw Error("Conflicting source surface description");
    g.quantity += op.quantity;
    g.pages.push(...op.pages);
    g.basis.push(op.basis);
    surfaceGroups.set(key2, g);
  }
  for (const g of surfaceGroups.values()) {
    add(g.pages[0], g.sourceCode, g.family, g.sourceDescription, g.quantity, g.unit, g.basis.join(" | "));
    operations2.at(-1).pages = [...new Set(g.pages)];
  }
  for (const page of pages) {
    const text3 = textOf4(page);
    if (!text3) continue;
    const spans = page.native_text_evidence.spans;
    const start = operations2.length;
    try {
      if (/SECTIONS \/ STAIR \/ FINISH DETAILS/.test(text3)) {
        const row = (pattern) => {
          const anchor = unique4(spans.filter((s) => pattern.test(s.text)), "explicit stair detail label");
          return { label: anchor.text, text: band3(spans, anchor.y).filter((s) => s !== anchor).map((s) => s.text).join(" ") };
        };
        const stair = row(/^Stair [A-Z]+\d+$/), code = stair.label.split(" ")[1];
        for (const [name2, pattern, formula] of [["treads", /^Stair finish treads$/, /^(\d+) treads x (\d+(?:\.\d+)?) m wide x (\d+(?:\.\d+)?) m going$/], ["risers", /^Stair finish risers$/, /^(\d+) risers x (\d+(?:\.\d+)?) m wide x (\d+(?:\.\d+)?) m$/], ["landings", /^Stair finish landings$/, /^(\d+) landings x (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) m$/]]) {
          const value = row(pattern), m = unique4([...value.text.matchAll(new RegExp(formula.source, "g"))], "dimensioned stair " + name2);
          add(page.pageNumber, code + "-" + name2, "stair-finish", "Stair finish " + name2, Number(m[1]) * Number(m[2]) * Number(m[3]), "m2", value.label + ": " + value.text);
        }
        const hand = row(/^Stair handrail [A-Z]+\d+$/), hm = hand.text.match(/^(\d+) rails x (\d+(?:\.\d+)?) m; no extra allowance$/);
        if (!hm) throw Error("Handrail multipliers unresolved");
        add(page.pageNumber, hand.label.split(" ").at(-1), "railing", "Stair handrail", Number(hm[1]) * Number(hm[2]), "m", hand.label + ": " + hand.text);
        const guard = row(/^First void guardrail [A-Z]+\d+$/), gm = guard.text.match(/^(\d+) segments: ([\d. +]+) m$/);
        if (!gm) throw Error("Guardrail segment list unresolved");
        const legs = gm[2].split("+").map(Number);
        if (legs.length !== Number(gm[1]) || legs.some((n) => !(n > 0))) throw Error("Guardrail segment count conflict");
        add(page.pageNumber, guard.label.split(" ").at(-1), "railing", "Void guardrail", legs.reduce((s, n) => s + n, 0), "m", guard.label + ": " + guard.text);
      }
      const screed = spans.filter((s) => /^[A-Z]+\d+ screed: \d+(?:\.\d+)? mm on every net floor finish area; exclude upper void/.test(s.text));
      if (screed.length) {
        const rule = unique4(screed, "net screed convention").text, m = rule.match(/^([A-Z]+\d+) screed: (\d+(?:\.\d+)?) mm/);
        add(page.pageNumber, m[1], "screed", "Floor screed " + m[2] + " mm", details.flatMap((d) => d.rooms).reduce((s, r) => s + r.floor_area, 0) * Number(m[2]) / 1e3, "m3", rule + "; sum of checked net floor areas \xD7 source thickness in metres.");
        if (!/Skirting: clear room perimeter minus each door width\. Do NOT deduct windows\./.test(text3) || !/No skirting along full GL01 glass faces\./.test(text3)) throw Error("Skirting measurement convention incomplete");
        const groups = /* @__PURE__ */ new Map();
        for (const room of details.flatMap((d) => d.rooms).filter((r) => r.skirting_length > 0)) {
          if (!room.skirting_description) throw Error("Skirting finish unspecified");
          const g = groups.get(room.floor_code) || { quantity: 0, description: room.skirting_description, rooms: [] };
          if (g.description !== room.skirting_description) throw Error("Conflicting skirting specification");
          g.quantity += room.skirting_length;
          g.rooms.push(room.tag);
          groups.set(room.floor_code, g);
        }
        for (const [code, g] of groups) add(page.pageNumber, code, "skirting", g.description, g.quantity, "m", "Checked clear room perimeters, minus solid door widths and shared glass faces; wet rooms/upper void excluded; " + g.rooms.join(", "));
      }
      if (/DOOR SCHEDULE \/ UNIQUE INSTANCES/.test(text3) && !declared.openingKinds.has("door")) {
        const groups = /* @__PURE__ */ new Map();
        for (const door of details.flatMap((d) => d.source_openings).filter((o) => o.kind === "door")) {
          const g = groups.get(door.type) || { quantity: 0, width: door.width, height: door.height };
          if (Math.abs(g.width - door.width) > 1e-7 || Math.abs(g.height - door.height) > 1e-7) throw Error("Door type dimensions conflict");
          g.quantity++;
          groups.set(door.type, g);
        }
        for (const [code, g] of groups) {
          const statement = unique4(spans.filter((s) => new RegExp(`(?:^| )${code}: `).test(s.text)), "door type source description").text;
          const match = statement.match(new RegExp(`\\b${code}: ([\\s\\S]*?)(?=\\. [A-Z]+\\d+:|$)`));
          if (!match) throw Error("Door type description unreadable");
          add(page.pageNumber, code, "door-set", match[1], g.quantity, "nr", "Unique source instance IDs, matched to native hosts and room pairs; " + g.width + " \xD7 " + g.height + " m opening size.");
          operations2.at(-1).replacesMetrics = ["door_count", "internal_door_count", "service_door_count", "entrance_door_count"];
        }
      }
      if (/WINDOW SCHEDULE \/ UNIQUE INSTANCES/.test(text3) && !declared.openingKinds.has("window")) {
        const specification = unique4(spans.filter((s) => /^Powder-coated aluminium double-glazed windows, measured by net scheduled opening area\.$/.test(s.text)), "window material and area convention").text;
        const groups = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
        for (const w of details.flatMap((d) => d.source_openings).filter((o) => o.kind === "window")) {
          if (seen.has(w.id)) throw Error("Duplicate physical window");
          seen.add(w.id);
          const g = groups.get(w.type) || { quantity: 0, count: 0, width: w.width, height: w.height };
          if (Math.abs(g.width - w.width) > 1e-7 || Math.abs(g.height - w.height) > 1e-7) throw Error("Window type dimensions conflict");
          g.quantity += w.width * w.height;
          g.count++;
          groups.set(w.type, g);
        }
        for (const [code, g] of groups) {
          add(page.pageNumber, code, "window-set", `Powder-coated aluminium double-glazed window ${g.width.toFixed(3)} x ${g.height.toFixed(3)} m`, g.quantity, "m2", `${specification} Unique ${code} instances: ${g.count} \xD7 ${g.width} \xD7 ${g.height} m; count retained for checking, not a second priced quantity.`);
          operations2.at(-1).replacesMetrics = ["window_area", "window_count"];
        }
      }
      if (/PLUMBING \/ DIMENSIONED PIPE ROUTES/.test(text3)) {
        if (!/All unshown plumbing is excluded/.test(text3) || !/Add specified vertical lengths only/.test(pages.map(textOf4).join(" "))) throw Error("Pipe route scope incomplete");
        const header = unique4(spans.filter((s) => s.text === "System"), "pipe system header"), cols = band3(spans, header.y);
        if (cols.map((s) => s.text).join("|") !== "System|Material|Vertical / equipment rule") throw Error("Unsupported pipe table layout");
        const zones = panels(page, details, header.y), codes = spans.filter((s) => s.y < header.y && Math.abs(s.x - header.x) < 10 && /^[A-Z]+\d+$/.test(s.text));
        for (const code of codes) {
          const cells = band3(spans, code.y), material2 = unique4(cells.filter((s) => Math.abs(s.x - cols[1].x) < 10), "pipe material").text, rule = unique4(cells.filter((s) => Math.abs(s.x - cols[2].x) < 10), "pipe vertical rule").text;
          if (!/\bDN\d+\b/.test(material2)) throw Error("Pipe diameter unavailable");
          const vertical = unique4([...rule.matchAll(new RegExp(`One (\\d+(?:\\.\\d+)?) m interstorey riser on ([A-Z]+)-${code.text} only`, "g"))], "explicit pipe riser");
          const first = unique4(zones.filter((z) => z.floor.rooms.some((r) => r.tag.startsWith(vertical[2]))), "pipe riser floor");
          let total = Number(vertical[1]);
          const basis = [rule];
          for (const zone of zones) {
            const labels = zone.spans.filter((s) => new RegExp(`^${code.text} / \\d+(?:\\.\\d+)?$`).test(s.text));
            if (!labels.length) throw Error("Pipe route labels missing on a source floor");
            total += labels.reduce((s, l) => s + Number(l.text.split(" / ")[1]), 0);
            basis.push(`${zone.heading}: ${labels.map((s) => s.text).join(" + ")}${zone === first ? " + explicit riser" : ""}`);
          }
          add(page.pageNumber, code.text, "pipe", material2, total, "m", basis.join("; "));
        }
        if (!codes.length) throw Error("No dimensioned pipe systems");
        const fixtures = /* @__PURE__ */ new Map();
        for (const row of spans.filter((s) => /^Each (?:of )?[^:]+:\s*\d/.test(s.text))) {
          const match = row.text.match(/^Each (?:of )?([^:]+):\s*(.+?)\.?$/), rooms = match[1].split(/\s+and\s+|\s*,\s*/);
          if (new Set(rooms).size !== rooms.length || rooms.some((tag) => !details.some((d) => d.rooms.some((r) => r.tag === tag)))) throw Error("Fixture room identities unresolved");
          for (const entry of match[2].split(/\s*\+\s*/)) {
            const m = entry.match(/^(\d+)\s+(WC sets?|wash basins?|sinks?|floor drains?|electric water heaters?)$/i);
            if (!m) throw Error("Unknown fixture rule");
            const description = m[2].replace(/s$/i, "").toLowerCase(), old = fixtures.get(description) || { value: 0, rooms: /* @__PURE__ */ new Set(), basis: [] };
            for (const room of rooms) {
              if (old.rooms.has(room)) throw Error("Repeated fixture room");
              old.rooms.add(room);
            }
            old.value += Number(m[1]) * rooms.length;
            old.basis.push(row.text);
            fixtures.set(description, old);
          }
        }
        for (const [description, f] of fixtures) if (!["wc set", "wash basin"].includes(description)) add(page.pageNumber, description.replace(/\s+/g, "-"), "fixture", description, f.value, "nr", f.basis.join("; "));
      }
      if (/HVAC \/ DIMENSIONED DUCT ROUTES/.test(text3)) {
        const header = unique4(spans.filter((s) => s.text === "Code"), "HVAC code header"), cols = band3(spans, header.y);
        if (cols.map((s) => s.text).join("|") !== "Code|Item|Specification / quantity rule") throw Error("Unsupported HVAC schedule");
        const zones = panels(page, details, header.y), rows = spans.filter((s) => s.y < header.y && Math.abs(s.x - header.x) < 10 && /^[A-Z]+\d+$/.test(s.text)), areas = [];
        for (const row of rows) {
          const cells = band3(spans, row.y), item = unique4(cells.filter((s) => Math.abs(s.x - cols[1].x) < 10), "HVAC item").text, rule = unique4(cells.filter((s) => Math.abs(s.x - cols[2].x) < 10), "HVAC quantity rule").text;
          const size = rule.match(/^(\d+) x (\d+) mm GI; length CL\. Sheet-metal area = 2 x \((\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)\) x length\.$/);
          if (size) {
            if (Math.abs(Number(size[1]) / 1e3 - Number(size[3])) > 1e-9 || Math.abs(Number(size[2]) / 1e3 - Number(size[4])) > 1e-9) throw Error("Duct size and area formula conflict");
            const labels = zones.flatMap((z) => z.spans.filter((s) => new RegExp(`^${row.text} / \\d+(?:\\.\\d+)?$`).test(s.text)));
            if (!labels.length) throw Error("Measured duct route labels missing");
            const risers = [...text3.matchAll(new RegExp(`([A-Z]+-[A-Z]+\\d+) has an additional (\\d+(?:\\.\\d+)?) m VERTICAL ${row.text} riser`, "g"))];
            for (const m of risers) if (spans.filter((s) => s.text === m[1]).length !== 1) throw Error("Duct riser instance tag unresolved");
            const length = labels.reduce((s, l) => s + Number(l.text.split(" / ")[1]), 0) + risers.reduce((s, m) => s + Number(m[2]), 0);
            if (!/All other duct verticals = zero/.test(text3)) throw Error("Duct vertical coverage unresolved");
            const area4 = 2 * (Number(size[3]) + Number(size[4])) * length;
            areas.push(area4);
            add(page.pageNumber, row.text, "duct-sheet", `${item}; ${size[1]} x ${size[2]} mm GI`, area4, "m2", `${labels.map((s) => s.text).join(" + ")}; ${risers.map((m) => m[0]).join("; ")}; ${rule} Net CL length ${length} m (check only, not an extra priced line).`);
          } else if (/insulation/i.test(item)) {
            if (!/use SAME nominal sheet-metal areas/.test(rule) || !areas.length) throw Error("Duct insulation basis unresolved");
            add(page.pageNumber, row.text, "duct-insulation", item + "; " + rule, areas.reduce((s, a) => s + a, 0), "m2", rule);
          } else {
            let value = null, replaces = null;
            const diffusers = rule.match(/^(\d+) per occupied room except corridor: (\d+) each floor\. No diffuser in ([A-Z]+\d+)\.$/);
            const returns = rule.match(/^(\d+) per occupied room except ([A-Z0-9/]+); (\d+) per corridor\. No grille in ([A-Z]+\d+)\.$/);
            const extract = rule.match(/^(\d+) per wet room, both levels\. Ductwork for extract excluded\.$/);
            if (diffusers && corridors === details.length) {
              if (!details.some((d) => d.rooms.some((r) => r.tag === diffusers[3] && r.floor_code === "VOID"))) throw Error("Diffuser void exclusion unresolved");
              value = Number(diffusers[1]) * (roomCount - corridors) + Number(diffusers[2]) * details.length;
            } else if (returns && corridors === details.length) {
              const excluded = returns[2].split("/");
              if (new Set(excluded).size !== excluded.length || excluded.some((t) => !details.some((d) => d.rooms.some((r) => r.tag === t && r.wet))) || !details.some((d) => d.rooms.some((r) => r.tag === returns[4] && r.floor_code === "VOID"))) throw Error("Return grille exclusions unresolved");
              value = Number(returns[1]) * (roomCount - excluded.length - corridors) + Number(returns[3]) * corridors;
            } else if (extract && details.length === 2) value = Number(extract[1]) * wet;
            else if (/^\d+ per level; scope is unit count only\.$/.test(rule) && /Fan-coil units/i.test(item)) {
              value = Number(rule.match(/^\d+/)[0]) * details.length;
              replaces = "ac_count";
            }
            if (value === null) throw Error("Unsupported HVAC equipment rule");
            add(page.pageNumber, row.text, "equipment", item, value, "nr", rule, replaces);
          }
        }
      }
      if (/ELECTRICAL \/ EQUIPMENT COUNTS \/ MEASURED ROUTES/.test(text3)) {
        const header = unique4([...new Set(spans.filter((s) => s.text === "Room").map((s) => s.y))], "electrical matrix header y"), cols = band3(spans, header);
        if (cols.length !== 8 || cols[0].text !== "Room" || cols[4].text !== "Room") throw Error("Unsupported electrical matrix columns");
        const matrixSpans = spans.filter((s) => s.x >= cols[0].x - 10), roomTags = new Set(details.flatMap((d) => d.rooms.map((r) => r.tag))), rows = matrixSpans.filter((s) => s.y < header && roomTags.has(s.text) && [cols[0], cols[4]].some((c) => Math.abs(s.x - c.x) < 10)), seen = /* @__PURE__ */ new Set(), totals = /* @__PURE__ */ new Map();
        for (const y of new Set(rows.map((s) => s.y))) {
          const cells = band3(matrixSpans, y);
          for (const offset of [0, 4]) {
            const tag = unique4(cells.filter((s) => Math.abs(s.x - cols[offset].x) < 10), "electrical room").text;
            if (seen.has(tag) || !roomTags.has(tag)) throw Error("Duplicate electrical room");
            seen.add(tag);
            for (let i = 1; i < 4; i++) {
              const cell = unique4(cells.filter((s) => Math.abs(s.x - cols[offset + i].x) < 10), "electrical cell");
              if (!/^\d+$/.test(cell.text)) throw Error("Invalid equipment matrix count");
              const code = cols[offset + i].text;
              totals.set(code, (totals.get(code) || 0) + Number(cell.text));
            }
          }
        }
        if (seen.size !== roomTags.size) throw Error("Electrical matrix floor coverage incomplete");
        for (const [code, count] of totals) {
          const label = unique4([...text3.matchAll(new RegExp(`\\b${code}:\\s*([^;.]+)[;.]`, "g"))], "electrical matrix legend")[1];
          if (/twin socket points/i.test(label)) continue;
          add(page.pageNumber, code, "electrical", label, count, "nr", "Complete unique room equipment matrix; counts, not watts", /LED light fittings/i.test(label) ? "light_count" : null);
        }
        const switches = unique4([...text3.matchAll(/\b([A-Z]+\d+) light switches: (\d+) per occupied room except each corridor has (\d+)\. None at ([A-Z]+\d+)\./g)], "switch quantity rule");
        const emergency = unique4([...text3.matchAll(/\b([A-Z]+\d+) emergency lights: (\d+) per corridor \+ (\d+) per core\./g)], "emergency-light rule");
        const exits = unique4([...text3.matchAll(/\b([A-Z]+\d+) exit signs: (\d+) per level\./g)], "exit-sign rule");
        if (corridors !== details.length || cores !== details.length || !details.some((d) => d.rooms.some((r) => r.tag === switches[4] && r.floor_code === "VOID"))) throw Error("Electrical room-derived scope unresolved");
        for (const [m, description, qty] of [[switches, "light switches", Number(switches[2]) * (roomCount - corridors) + Number(switches[3]) * corridors], [emergency, "emergency lights", Number(emergency[2]) * corridors + Number(emergency[3]) * cores], [exits, "exit signs", Number(exits[2]) * details.length]]) add(page.pageNumber, m[1], "electrical", description, qty, "nr", m[0]);
        const riser = unique4([...text3.matchAll(/Every FIRST route adds one (\d+(?:\.\d+)?) m riser; ground adds none\./g)], "electrical route riser");
        const zones = panels(page, details, header), codes = [...new Set(zones.flatMap((z) => z.spans.flatMap((s) => s.text.match(/^([A-Z]+\d+) \/ \d+(?:\.\d+)?$/)?.[1] || [])))];
        for (const code of codes) {
          const definition = unique4(spans.filter((s) => s.text.startsWith(code + ": ")), "electrical route definition").text, labels = zones.flatMap((z) => z.spans.filter((s) => s.text.startsWith(code + " / ")));
          if (zones.some((z) => !z.spans.some((s) => s.text.startsWith(code + " / ")))) throw Error("Electrical route missing a floor");
          const value = labels.reduce((s, l) => s + Number(l.text.split(" / ")[1]), 0) + Number(riser[1]);
          add(page.pageNumber, code, "electrical-route", definition.slice(code.length + 2), value, "m", labels.map((s) => s.text).join(" + ") + "; " + riser[0]);
        }
      }
    } catch (e) {
      operations2.splice(start);
      issues.push(`Source service page ${page.pageNumber} withheld: ${e.message}`);
    }
  }
  return { operations: operations2, issues };
}

// src/lib/pdfNativeDocumentCalculations.mjs
function nativePdfDocumentCalculations(pages, review, validate2) {
  const supplementary = nativePdfSupplementaryScope(pages);
  const calculations = [...supplementary.calculations], issues = [...supplementary.issues], readable = pages.filter((p) => p.native_text_evidence?.status === "readable");
  const coordinated = nativeCoordinatedPdfCalculations(pages);
  const services2 = coordinated.details.length ? nativePdfServiceOperations(pages, coordinated.details) : { operations: [], issues: [] };
  calculations.push(...coordinated.calculations);
  issues.push(...coordinated.issues);
  issues.push(...services2.issues);
  const texts = readable.map((p) => ({ page: p.pageNumber, text: [...p.native_text_evidence.spans].sort((a, b) => b.y - a.y || a.x - b.x).map((s) => s.text).join(" ") }));
  const cabinets = [];
  for (const p of texts.filter((p2) => pages.find((x) => x.pageNumber === p2.page)?.page_evidence?.kind === "specification")) {
    const matches = [...p.text.matchAll(/\bbase cabinets?\s+measured\s+((?:\d+(?:\.\d+)?\s*\+\s*)+\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)\s+linear met(?:re|er)s\b/gi)];
    for (const m of matches) {
      const lengths = m[1].split("+").map(Number);
      if (lengths.length > 20 || lengths.some((v) => !Number.isFinite(v) || v <= 0) || Math.abs(lengths.reduce((a, b) => a + b, 0) - Number(m[2])) > 1e-6) {
        issues.push("Printed cabinet equation is inconsistent");
        continue;
      }
      cabinets.push({ key: "kitchen_cabinet_length", scope_id: "project", evidence: `Original PDF explicit cabinet measurement equation: ${m[0]}`, terms: lengths.map((v, i) => ({ id: `native-cabinet-leg:${i + 1}`, operation: "add", factors: [{ value: v, unit: "m", operation: "multiply", pages: [p.page], evidence: m[0], clip: null }] })) });
    }
  }
  if (cabinets.length === 1) calculations.push(cabinets[0]);
  else if (cabinets.length > 1) issues.push("Multiple cabinet statements require physical scope reconciliation");
  const convention = texts.filter((p) => /slab soffit includes beam (?:undersides|soffits)/i.test(p.text) && /beam formwork contains ONLY two downstand sides/i.test(p.text));
  if (convention.length === 1) {
    const terms = [];
    let valid2 = true;
    for (const [key2, label] of [["first_slab_volume", "First"], ["roof_slab_volume", "Roof"]]) {
      const candidates = (review.calculations || []).filter((c2) => c2.key === key2), thicknesses = texts.filter((p) => /All dimensions (?:in|are) metres/i.test(p.text)).flatMap((p) => [...p.text.matchAll(new RegExp(`\\b${label} slab:\\s*(\\d*\\.\\d+|\\d+)\\s*;\\s*omit\\s+(\\d+(?:\\.\\d+)?)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s+(?:stair void|terrace)\\b`, "gi"))].map((m) => ({ value: Number(m[1]), omit: [Number(m[2]), Number(m[3])].sort((a, b) => a - b), page: p.page, evidence: m[0] })));
      if (candidates.length !== 1 || thicknesses.length !== 1 || !(thicknesses[0].value > 0)) {
        valid2 = false;
        break;
      }
      const c = candidates[0], t = thicknesses[0];
      try {
        validate2(c);
      } catch {
        valid2 = false;
        break;
      }
      if (c.terms.length !== 2 || c.terms.filter((x) => x.operation === "add").length !== 1 || c.terms.filter((x) => x.operation === "subtract").length !== 1) {
        valid2 = false;
        break;
      }
      const envelopePairs = pages.filter((p) => p.page_evidence?.kind === "floor_plan" && c.terms.some((term2) => term2.factors.some((f) => f.pages.includes(p.pageNumber)))).flatMap((p) => (p.native_plan_text?.spans || []).flatMap((s) => [...s.text.matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)].map((m) => [Number(m[1]), Number(m[2])].sort((a, b) => a - b))));
      const uniqueEnvelopes = [...new Map(envelopePairs.map((pair) => [pair.join(","), pair])).values()];
      if (uniqueEnvelopes.length !== 1) {
        valid2 = false;
        break;
      }
      for (const term2 of c.terms) {
        const eligible = term2.factors.filter((f) => f.operation === "multiply" && !f.clip && ["m", "mm"].includes(f.unit) && /slab thickness/i.test(f.evidence) && Math.abs(f.value * (f.unit === "mm" ? 1e-3 : 1) - t.value) < 1e-7 && f.pages.includes(t.page));
        if (eligible.length !== 1) {
          valid2 = false;
          break;
        }
        const remaining = term2.factors.filter((f) => f !== eligible[0]), expected = term2.operation === "add" ? uniqueEnvelopes[0] : t.omit;
        const measured = remaining.map((f) => f.operation === "multiply" && !f.clip && ["m", "mm"].includes(f.unit) ? f.value * (f.unit === "mm" ? 1e-3 : 1) : NaN).sort((a, b) => a - b);
        if (measured.length !== 2 || measured.some((n, i) => !Number.isFinite(n) || Math.abs(n - expected[i]) > 1e-6)) {
          valid2 = false;
          break;
        }
        terms.push({ ...term2, id: `native-soffit:${key2}:${term2.id}`, factors: remaining.map((f) => ({ ...f, pages: [.../* @__PURE__ */ new Set([...f.pages, t.page, convention[0].page])], evidence: `${f.evidence}; original source ${t.evidence}; envelope ${uniqueEnvelopes[0].join(" x ")} m` })) });
      }
    }
    if (valid2 && terms.length) calculations.push({ key: "slab_formwork_area", scope_id: "project", terms, evidence: `Source suspended first/roof slab volume operands divided by their explicit source thickness; source page ${convention[0].page}: slab soffit includes beam undersides. Full original volume calculations and remaining area units validated; beam strips are not added again. Source operand transcription still requires review.` });
    else issues.push("Slab soffit could not be derived from complete source thickness/volume operands");
  }
  return {
    calculations,
    issues,
    coordinated_details: coordinated.details,
    source_operations: services2.operations,
    coordinated_identities: [...coordinated.calculations, ...supplementary.calculations].map((c) => [c.key, c.scope_id]),
    coordinated_complete_keys: [...supplementary.calculations.map((c) => c.key), ...[...new Set(coordinated.calculations.map((c) => c.key))].filter((key2) => coordinated.details.every((d) => coordinated.calculations.some((c) => c.key === key2 && c.scope_id === d.scope)))]
  };
}

// src/lib/pdfNativeSourceBasis.mjs
var source = (value, pages, evidence) => ({ value, pages, evidence });
var empty = () => source(null, [], "Source rule unavailable");
var roomTag3 = (s) => String(s || "").match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)?.[0]?.toLowerCase();
var words = (s) => String(s || "").toLowerCase().replace(/^[a-z]{1,4}[-_]?\d{1,4}\s*/, "").replace(/\bstairs?\s+landing\b/g, "landing").replace(/\bstairs\b/g, "stair").replace(/[^a-z0-9]+/g, " ").trim();
function buildNativePdfSourceBasis(pages, normalizeScope) {
  const floors = pages.filter((p) => p.page_evidence?.kind === "floor_plan"), native = nativeOpeningEvidence(pages, normalizeScope), sections = /* @__PURE__ */ new Map();
  for (const p of pages.filter((p2) => p2.page_evidence?.kind === "specification" && p2.native_text_evidence?.status === "readable")) {
    const text3 = [...p.native_text_evidence.spans].sort((a, b) => b.y - a.y || a.x - b.x).map((s) => s.text).join(" "), headers2 = [...text3.matchAll(/\b([A-Z][A-Z ]{2,30}):\s*/g)];
    for (let i = 0; i < headers2.length; i++) {
      const key2 = headers2[i][1].trim(), value = text3.slice(headers2[i].index + headers2[i][0].length, headers2[i + 1]?.index ?? text3.length).trim();
      if (!sections.has(key2)) sections.set(key2, []);
      sections.get(key2).push({ text: value, page: p.pageNumber });
    }
  }
  const get = (key2) => {
    const rows = sections.get(key2) || [];
    return rows.length && new Set(rows.map((r) => r.text)).size === 1 ? { text: rows[0].text, pages: rows.map((r) => r.page) } : null;
  };
  const dimension2 = (section, regex) => {
    const s = get(section), match = s?.text.match(regex);
    return match ? source(Number(match[1]) * ({ mm: 1e-3, cm: 0.01, m: 1 }[match[2]] || 1), s.pages, `${section}: ${match[0]}`) : empty();
  };
  const flag = (section, regex) => {
    const s = get(section);
    return s && regex.test(s.text) ? source(true, s.pages, `${section}: ${s.text}`) : empty();
  };
  const wallHeight = dimension2("WALLS", /clear height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i), plaster = get("PLASTER"), ceilings = get("CEILINGS"), wet = get("WET ROOMS"), kitchen = get("KITCHEN");
  const rules = {
    wall_height: wallHeight,
    plaster_internal_faces: plaster && /both faces of internal walls/i.test(plaster.text) ? source(2, plaster.pages, plaster.text) : empty(),
    plaster_external_faces: plaster && /inner face of external walls/i.test(plaster.text) ? source(1, plaster.pages, plaster.text) : empty(),
    wet_tile_height: dimension2("WET ROOMS", /\btile height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),
    wet_waterproof_height: dimension2("WET ROOMS", /wall waterproofing\s+height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),
    backsplash_length: dimension2("KITCHEN", /Backsplash\s+is\s+\d+(?:\.\d+)?\s+high\s+along\s*(\d+(?:\.\d+)?)\s*m\b/i),
    backsplash_height: kitchen && /Backsplash\s+is\s+(\d+(?:\.\d+)?)\s+high\s+along\s*\d+(?:\.\d+)?\s*m\b/i.test(kitchen.text) ? source(Number(kitchen.text.match(/Backsplash\s+is\s+(\d+(?:\.\d+)?)/i)[1]), kitchen.pages, kitchen.text) : empty(),
    paint_uses_plastered_faces: plaster && /both faces of internal walls plus inner face of external walls/i.test(plaster.text) && /Interior paint excludes/i.test(plaster.text) ? source(true, plaster.pages, plaster.text) : empty(),
    paint_excludes_wet_tiles: flag("PLASTER", /Interior paint excludes wet wall tiles/i),
    paint_excludes_backsplash: flag("PLASTER", /Interior paint excludes[^.]*kitchen backsplash/i),
    paint_enclosed_ceilings: flag("CEILINGS", /^paint all enclosed areas\./i),
    gypsum_exclusions_confirmed: empty()
  };
  const ceilingExclusions = [];
  let ceilingRuleKnown = false;
  const exclusionText = ceilings?.text.match(/Gypsum ceiling excludes\s+([^.]+)\./i)?.[1];
  if (exclusionText) {
    ceilingRuleKnown = true;
    for (const entry of exclusionText.split(/,|\s+and\s+/i)) {
      const match = entry.trim().match(/^(GF|FF|ground(?: floor)?|first(?: floor)?|floor\s+\d+)\s+(.+)$/i);
      if (!match) {
        ceilingRuleKnown = false;
        break;
      }
      const scope2 = normalizeScope(match[1]), matches = floors.filter((p) => normalizeScope(p.page_evidence.scope_id) === scope2).flatMap((p) => (p.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(i.unit) && words(i.name) === words(match[2])).map((i) => ({ scope: scope2, tag: roomTag3(i.name) })));
      if (matches.length !== 1) {
        ceilingRuleKnown = false;
        break;
      }
      ceilingExclusions.push(matches[0]);
    }
  }
  if (ceilingRuleKnown) rules.gypsum_exclusions_confirmed = source(true, ceilings.pages, ceilings.text);
  const wetNames = wet?.text.split(/\.\s+/)[0].match(/\b[A-Z]{1,4}[-_]?\d{1,4}\b/g) || [], geometry = [], basis = { floors: [], rules, exclusions: [], notes: "Native calibrated graph and explicitly recognized source rules; provisional, source review required." };
  for (const p of floors) {
    const scope2 = normalizeScope(p.page_evidence.scope_id), schedule = native.claims.length ? native.schedules.find((s) => s.scope_id === scope2) : null, measured = measureNativeWallFloor(p, schedule);
    geometry.push(measured.audit);
    const f = {
      scope_id: scope2,
      walls_complete: measured.status === "provisional",
      wall_inventory_evidence: `Native source centreline graph; calibration, opening gaps and connectivity checked. ${JSON.stringify(measured.audit)}`,
      source_pages: [p.pageNumber, ...schedule?.dimension_basis?.pages || []],
      walls: [],
      openings: [],
      wet_rooms_complete: false,
      wet_rooms: [],
      ceilings_complete: ceilingRuleKnown,
      ceiling_spaces: []
    };
    if (measured.status === "provisional") {
      f.walls = measured.walls.map((w) => ({ id: w.id, classification: w.classification, length_basis: "calibrated_geometry", length: source(w.length, [p.pageNumber], `Original vector wall ${w.id}: ${JSON.stringify(w.a)} to ${JSON.stringify(w.b)}; calibrated using printed envelope`), height: wallHeight }));
      f.openings = schedule.rows.map((o) => ({ id: o.id, wall_id: measured.walls.find((w) => w.openings.includes(o.id))?.id, kind: o.kind === "window" ? "window" : "door", width: source(o.width, o.dimension_pages, o.source_row), height: source(o.height, o.dimension_pages, o.source_row), sill: source(o.sill, o.dimension_pages, o.source_row) }));
      const planTags = new Set(p.native_plan_text.spans.flatMap((s) => {
        const m = s.text.match(/^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i);
        return m ? [m[0].toLowerCase()] : [];
      })), wanted = wetNames.filter((tag) => planTags.has(tag.toLowerCase()));
      f.wet_rooms_complete = !!wet && wetNames.length > 0;
      for (const tag of wanted) {
        const faces = measured.faces.filter((face2) => face2.tags.some((t) => t.toLowerCase() === tag.toLowerCase()));
        if (faces.length !== 1 || faces[0].tags.length !== 1) {
          f.wet_rooms_complete = false;
          continue;
        }
        const face = faces[0];
        f.wet_rooms.push({ id: tag, boundary_complete: true, boundary_lengths: face.polygon.map((a, i) => {
          const b = face.polygon[(i + 1) % face.polygon.length];
          return source(Math.hypot(b.x - a.x, b.y - a.y), [p.pageNumber, ...wet.pages], `Closed native wall face ${tag}, side ${i + 1}; ${wet.text}`);
        }), opening_ids: face.opening_ids });
      }
    }
    const indoors = (p.detected_items || []).filter((i) => ["m2", "m\xB2"].includes(i.unit) && i.quantity > 0 && !/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name) && !/^VOID\b|^OUTDOOR\b/i.test(i.description));
    f.ceiling_spaces = indoors.map((i) => {
      const matching = measured.faces.filter((face) => face.tags.length === 1 && face.tags[0].toLowerCase() === roomTag3(i.name));
      return {
        room_name: i.name,
        include_gypsum: ceilingRuleKnown ? !ceilingExclusions.some((e) => e.scope === scope2 && e.tag === roomTag3(i.name)) : null,
        pages: ceilings?.pages || [],
        evidence: ceilings?.text || "Source ceiling rule unavailable",
        ...matching.length === 1 ? { native_area: source(matching[0].area, [p.pageNumber], `Area of calibrated original closed wall face ${roomTag3(i.name)}; polygon ${JSON.stringify(matching[0].polygon)}`) } : {}
      };
    });
    basis.floors.push(f);
  }
  const wetResolved = basis.floors.flatMap((f) => f.wet_rooms.map((r) => r.id.toLowerCase()));
  if (wetNames.some((tag) => wetResolved.filter((t) => t === tag.toLowerCase()).length !== 1)) basis.floors.forEach((f) => f.wet_rooms_complete = false);
  return { basis, source_pages: [.../* @__PURE__ */ new Set([...floors.flatMap((p) => [p.pageNumber, ...p.document_area_source_pages || []]), ...native.schedules.flatMap((s) => s.dimension_basis?.pages || []), ...[...sections.values()].flatMap((a) => a.map((r) => r.page))])], geometry };
}

// src/lib/pdfMeasurementCalculations.mjs
var units = {
  scalar: [1, 0, 0],
  count: [1, 0, 0],
  nr: [1, 0, 0],
  m: [1, 1, 0],
  mm: [1e-3, 1, 0],
  m2: [1, 2, 0],
  m3: [1, 3, 0],
  kg: [1, 0, 1],
  ton: [1e3, 0, 1],
  kg_per_m: [1, -1, 1],
  m_mm2_per_kg: [1e-6, 3, -1]
};
var nonempty = (s) => typeof s === "string" && s.trim().length > 0;
var PDF_AREA_KEYS = ["floor_area", "ceiling_area", "wood_floor_area", "ceramic_floor_area", "epoxy_floor_area", "terrace_floor_area"];
function assertPdfSoffitCoverage(calculation, notes = "") {
  if (calculation?.key !== "slab_formwork_area") return;
  const convention = `${calculation.evidence || ""} ${notes}`;
  const includesBeams = /slab\s+soffit\s+(?:already\s+)?includes?\s+beam\s+(?:undersides?|soffits?)/i.test(convention) || /beam\s+(?:undersides?|soffits?)\s+(?:are\s+)?included\s+(?:within|in)\s+slab/i.test(convention);
  const addsBeamSoffit = (calculation.terms || []).some((term2) => term2.operation === "add" && /beam[\s_-]*(?:soffit|underside)|(?:soffit|underside)[\s_-]*beam/i.test(`${term2.id} ${(term2.factors || []).map((f) => f.evidence).join(" ")}`));
  if (includesBeams && addsBeamSoffit) throw Error("Slab soffit includes beam undersides but calculation adds them again; source coverage review required");
}
function reconcilePdfSoffitCoverage(calculation, notes, metricUnits, availablePages) {
  try {
    assertPdfSoffitCoverage(calculation, notes);
    return { calculation, adjustment: null };
  } catch (contradiction) {
    const rulePages = [...new Set([...String(calculation.evidence || "").matchAll(/\bp(?:age)?\s*(\d+)\b/gi)].map((m) => Number(m[1])))];
    if (!rulePages.length || rulePages.some((p) => !availablePages.has(p))) throw contradiction;
    const baseGroups = /* @__PURE__ */ new Map(), beamTerms = [];
    for (const term2 of calculation.terms || []) {
      const id = String(term2.id || "").toLowerCase();
      const gross = id.match(/^(.+?)[_-]slab[_-]soffit[_-]gross$/);
      const opening = id.match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/);
      const beam = id.match(/^(.+?)[_-]beam[_-](?:soffits?|undersides?)$/);
      if (!Array.isArray(term2.factors) || term2.factors.length !== 2 || term2.factors.some((f) => f.unit !== "m" || f.operation !== "multiply" || f.clip)) throw contradiction;
      calculatePdfMeasurement({ ...calculation, terms: [{ ...term2, operation: "add" }] }, metricUnits, availablePages);
      if (gross && term2.operation === "add" && term2.factors.every((f) => /envelope|\bgross\b/i.test(f.evidence))) {
        if (baseGroups.has(gross[1])) throw contradiction;
        baseGroups.set(gross[1], { area: term2.factors[0].value * term2.factors[1].value, omitted: 0, beamArea: 0 });
      } else if (opening && term2.operation === "subtract") {
      } else if (beam && term2.operation === "add") beamTerms.push({ term: term2, group: beam[1] });
      else throw contradiction;
    }
    if (!baseGroups.size || !beamTerms.length) throw contradiction;
    for (const term2 of calculation.terms) if (term2.operation === "subtract") {
      const group = term2.id.toLowerCase().match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/)?.[1];
      if (!baseGroups.has(group)) throw contradiction;
      baseGroups.get(group).omitted += term2.factors[0].value * term2.factors[1].value;
    }
    for (const { term: term2, group } of beamTerms) {
      if (!baseGroups.has(group)) throw contradiction;
      baseGroups.get(group).beamArea += term2.factors[0].value * term2.factors[1].value;
    }
    if ([...baseGroups.values()].some((g) => g.area - g.omitted <= 0 || g.beamArea > g.area - g.omitted)) throw contradiction;
    const removed = new Set(beamTerms.map((x) => x.term.id));
    const adjusted = {
      ...calculation,
      terms: calculation.terms.filter((t) => !removed.has(t.id)),
      evidence: `${calculation.evidence} Coverage reconciliation: full sourced envelope minus openings already includes beam undersides; omitted repeated strips ${[...removed].join(", ")}.`
    };
    calculatePdfMeasurement(calculation, metricUnits, availablePages);
    calculatePdfMeasurement(adjusted, metricUnits, availablePages);
    return { calculation: adjusted, adjustment: {
      key: calculation.key,
      scope_id: calculation.scope_id,
      removed_terms: [...removed],
      source_pages: rulePages,
      reason: "Explicit included beam undersides duplicated within fully sourced gross soffit envelopes"
    } };
  }
}
function calculatePdfMeasurement(calculation, metricUnits, availablePages) {
  const { key: key2, scope_id: scope2, evidence, terms } = calculation || {};
  const expected = units[metricUnits[key2]];
  if (!expected || !nonempty(scope2) || !nonempty(evidence)) throw Error("Missing metric, scope or measurement evidence");
  if (PDF_AREA_KEYS.includes(key2)) throw Error("Floor and finish areas require audited space geometry");
  if (!Array.isArray(terms) || !terms.length || terms.length > 500) throw Error("Missing or excessive calculation terms");
  let value = 0;
  const pages = /* @__PURE__ */ new Set(), termIds = /* @__PURE__ */ new Set(), basis = [];
  for (const term2 of terms) {
    if (!nonempty(term2.id) || termIds.has(term2.id)) throw Error("Missing or repeated physical term identity");
    termIds.add(term2.id);
    if (!["add", "subtract"].includes(term2.operation) || !Array.isArray(term2.factors) || !term2.factors.length || term2.factors.length > 16) throw Error("Invalid measurement term");
    let product = 1, length = 0, mass = 0;
    const factors = [];
    for (const input of term2.factors) {
      const unit5 = units[input.unit];
      let operand = input.value;
      if (input.clip) {
        const { opening_height_m: h, sill_m: s, finish_height_m: f } = input.clip;
        if (input.value !== null || input.unit !== "m" || ![h, s, f].every((n) => Number.isFinite(n) && n >= 0 && n <= 1e6)) throw Error("Invalid clipped opening heights");
        operand = Math.max(0, Math.min(h, f - s));
      }
      if (!unit5 || !Number.isFinite(operand) || operand < 0 || operand > 1e12 || !["multiply", "divide"].includes(input.operation) || !nonempty(input.evidence) || !Array.isArray(input.pages) || !input.pages.length || input.pages.some((p) => !availablePages.has(p))) throw Error("Invalid or unsourced measurement operand");
      if (["count", "nr"].includes(input.unit) && !Number.isInteger(operand)) throw Error("Fractional counted operand");
      const divisor = input.operation === "divide";
      if (divisor && operand === 0) throw Error("Zero measurement divisor");
      product = divisor ? product / (operand * unit5[0]) : product * operand * unit5[0];
      length += (divisor ? -1 : 1) * unit5[1];
      mass += (divisor ? -1 : 1) * unit5[2];
      input.pages.forEach((p) => pages.add(p));
      factors.push(`${divisor ? "/" : "*"} ${operand} ${input.unit} [${input.evidence}${input.clip ? "; clip " + JSON.stringify(input.clip) : ""}]`);
    }
    if (length !== expected[1] || mass !== expected[2] || !Number.isFinite(product)) throw Error("Calculation dimensions do not match metric unit");
    value += term2.operation === "subtract" ? -product : product;
    basis.push(`${term2.operation} ${term2.id}: ${factors.join(" ")}`);
  }
  if (!Number.isFinite(value) || value < -1e-8 || value > 1e12) throw Error("Invalid net measurement");
  value = Math.max(0, value);
  if (metricUnits[key2] === "nr" && !Number.isInteger(value)) throw Error("Fractional counted result");
  return {
    key: key2,
    scope_id: scope2,
    value,
    unit: metricUnits[key2],
    pages: [...pages].sort((a, b) => a - b),
    evidence: `${evidence}. Independently calculated: ${basis.join("; ")} = ${value} ${metricUnits[key2]}. Source transcription requires review.`
  };
}
function applyPdfDocumentReview(inputPages, metricUnits, normalizeScope = (s) => String(s).trim().toLowerCase()) {
  const host = inputPages.find((p) => p.document_measurement_review);
  if (!host) return { pages: inputPages, audit: null, warnings: [], blocked: [] };
  const review = host.document_measurement_review;
  const actualPages = new Set(inputPages.map((p) => p.pageNumber));
  const sourcePages = host.document_review_status?.source_pages;
  const available = new Set(sourcePages?.length ? sourcePages.filter((p) => actualPages.has(p)) : actualPages);
  const revisionsByDrawing = /* @__PURE__ */ new Map();
  for (const p of inputPages) {
    const e = p.page_evidence;
    const id = e?.drawing_id || (e?.kind === "floor_plan" ? normalizeScope(e.scope_id) : null);
    if (!id) continue;
    const revisions2 = revisionsByDrawing.get(id) || /* @__PURE__ */ new Set();
    revisions2.add(e.revision);
    revisionsByDrawing.set(id, revisions2);
  }
  if ([...revisionsByDrawing.values()].some((r) => r.size > 1)) return {
    pages: inputPages,
    blocked: [],
    audit: { status: "withheld", reason: "Conflicting source revisions" },
    warnings: ["PDF document review withheld: conflicting source revisions require selection."]
  };
  const pages = inputPages.map((p) => ({ ...p, page_evidence: p.page_evidence ? { ...p.page_evidence, quantities: [...p.page_evidence.quantities || []] } : void 0 }));
  const warnings = [], accepted = [], rejected = [], revised = [], adjustments = [], blocked = /* @__PURE__ */ new Set(), identities = /* @__PURE__ */ new Set();
  const revisions = review.floor_revisions || [];
  const targetCounts = /* @__PURE__ */ new Map();
  for (const r of revisions) targetCounts.set(r.pageNumber, (targetCounts.get(r.pageNumber) || 0) + 1);
  for (const r of revisions) {
    const p = pages.find((p2) => p2.pageNumber === r.pageNumber);
    if (!p || p.page_evidence?.kind !== "floor_plan" || targetCounts.get(r.pageNumber) !== 1 || !r.area_geometry || !nonempty(r.evidence) || !Array.isArray(r.source_pages) || !r.source_pages.includes(r.pageNumber) || r.source_pages.some((n) => !available.has(n)) || !Array.isArray(r.detected_items) || !r.detected_items.length) {
      warnings.push(`PDF document review: invalid floor revision on page ${r.pageNumber}`);
      continue;
    }
    p.document_original_area_evidence = p.document_original_area_evidence || {
      area_geometry: p.area_geometry,
      detected_items: p.detected_items,
      fields: Object.fromEntries(PDF_AREA_KEYS.map((k) => [k, p[k] || 0]))
    };
    p.area_geometry = r.area_geometry;
    p.detected_items = r.detected_items;
    p.document_area_source_pages = r.source_pages;
    delete p.__areaGeometryValidated;
    revised.push({ page: r.pageNumber, source_pages: r.source_pages, evidence: r.evidence });
  }
  for (const p of pages) if (p.page_evidence?.kind === "floor_plan" && p.native_plan_text?.status === "readable") {
    const checked = auditPdfAreaGeometry(p, pages);
    if (checked.audit?.status !== "withheld") Object.assign(p, checked.page);
  }
  const nativeFresh = host.native_measurement_basis && pages.some((p) => p.native_graphics?.status === "readable") ? buildNativePdfSourceBasis(pages, normalizeScope) : null;
  if (nativeFresh) {
    const target2 = pages.find((p) => p.pageNumber === host.pageNumber);
    target2.native_measurement_basis = nativeFresh.basis;
    target2.native_source_status = { source_pages: nativeFresh.source_pages, geometry: nativeFresh.geometry };
  }
  const sourceAvailable = new Set((host.source_measurement_status?.source_pages || []).filter((p) => available.has(p)));
  const sourceResult = review.measurement_basis ? calculatePdfSourceMeasurements(review.measurement_basis, pages, metricUnits, sourceAvailable) : null;
  const nativeAvailable = new Set((nativeFresh?.source_pages || host.native_source_status?.source_pages || []).filter((p) => available.has(p)));
  const nativeBasis = nativeFresh?.basis || host.native_measurement_basis;
  const nativeResult = nativeBasis ? calculatePdfSourceMeasurements(nativeBasis, pages, metricUnits, nativeAvailable) : null;
  const nativeDocument = nativePdfDocumentCalculations(pages, review, (c) => calculatePdfMeasurement(c, metricUnits, available));
  for (const p of pages) if (p.page_evidence) p.page_evidence.quantities = p.page_evidence.quantities.filter((q) => !q.native_coordinated && !nativeDocument.coordinated_complete_keys?.includes(q.key));
  const nativeKeys = /* @__PURE__ */ new Set([...nativeResult?.calculations.map((c) => c.key) || [], ...nativeDocument.calculations.map((c) => c.key)]);
  const derivedKeys = /* @__PURE__ */ new Set([...sourceResult?.calculations.map((c) => c.key) || [], ...nativeKeys]);
  const allCalculations = [...(review.calculations || []).filter((c) => !derivedKeys.has(c.key)), ...(sourceResult?.calculations || []).filter((c) => !nativeKeys.has(c.key)), ...nativeResult?.calculations || [], ...nativeDocument.calculations];
  for (const key2 of sourceResult?.blocked || []) if (!nativeKeys.has(key2)) blocked.add(key2);
  warnings.push(...(sourceResult?.issues || []).map((s) => `PDF source measurement withheld: ${s}`));
  warnings.push(...(nativeResult?.issues || []).map((s) => `PDF native source measurement pending: ${s}`));
  warnings.push(...nativeDocument.issues.map((s) => `PDF native document measurement pending: ${s}`));
  for (const c of allCalculations) {
    const id = `${c.key}|${normalizeScope(c.scope_id)}`;
    try {
      if (identities.has(id)) throw Error("Duplicate complete metric/scope calculation");
      identities.add(id);
      const reconciled = reconcilePdfSoffitCoverage(c, review.notes, metricUnits, available);
      assertPdfSoffitCoverage(reconciled.calculation, review.notes);
      const claim2 = calculatePdfMeasurement(reconciled.calculation, metricUnits, available);
      if (nativeDocument.coordinated_identities?.some(([key2, scope2]) => key2 === claim2.key && normalizeScope(scope2) === normalizeScope(claim2.scope_id))) claim2.native_coordinated = true;
      if (reconciled.adjustment) {
        claim2.pages = [.../* @__PURE__ */ new Set([...claim2.pages, ...reconciled.adjustment.source_pages])].sort((a, b) => a - b);
        adjustments.push(reconciled.adjustment);
      }
      accepted.push(claim2);
    } catch (error2) {
      rejected.push({ key: c.key, scope_id: c.scope_id, reason: error2.message });
      if (metricUnits[c.key] && !PDF_AREA_KEYS.includes(c.key)) blocked.add(c.key);
      warnings.push(`PDF document calculation ${c.key} withheld: ${error2.message}`);
    }
  }
  for (const key2 of blocked) {
    for (const p of pages) {
      if (Object.hasOwn(p, key2)) p[key2] = 0;
      p.page_evidence?.quantities.splice(
        0,
        p.page_evidence.quantities.length,
        ...p.page_evidence.quantities.filter((q) => q.key !== key2)
      );
    }
  }
  const target = pages.find((p) => p.pageNumber === host.pageNumber);
  for (const q of accepted.filter((q2) => !blocked.has(q2.key))) {
    for (const p of pages) if (p.page_evidence) p.page_evidence.quantities = p.page_evidence.quantities.filter((old) => old.key !== q.key || normalizeScope(old.scope_id) !== normalizeScope(q.scope_id));
    target.page_evidence.quantities = target.page_evidence.quantities.filter((old) => !(old.document_calculated && old.key === q.key && old.scope_id === q.scope_id));
    target.page_evidence.quantities.push({ ...q, document_calculated: true });
  }
  return { pages, blocked: [...blocked], warnings, audit: {
    status: "source_document_review",
    native_coordinated_measurements: nativeDocument.coordinated_details || [],
    native_source_operations: nativeDocument.source_operations || [],
    floor_revisions: revised,
    calculations: accepted.filter((q) => !blocked.has(q.key)),
    rejected,
    adjustments,
    source_measurements: sourceResult ? { status: sourceResult.blocked.length ? "incomplete" : "calculated", issues: sourceResult.issues } : null,
    native_source_measurements: nativeResult ? { status: nativeResult.blocked.length ? "partial" : "provisional", issues: nativeResult.issues, derived_keys: [...nativeKeys], geometry: host.native_source_status?.geometry || [], requires_review: true } : null,
    exclusions: [.../* @__PURE__ */ new Set([...(review.exclusions || []).filter((s) => !derivedKeys.has(s)), ...review.measurement_basis?.exclusions || []])].filter(nonempty),
    notes: [review.notes, review.measurement_basis?.notes].filter(nonempty).join("\n")
  } };
}

// src/lib/pdfCatalogScope.mjs
function pdfCatalogScope(description) {
  const d = String(description || "").toLowerCase().replace(/[-‐‑–—]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:disposal|haul|backfill|pool|tank|raft|pile|stairs?|staircase)\b/.test(d)) return null;
  const match = (key2, unit5, extra = {}) => ({ key: key2, unit: unit5, ...extra });
  if (/\bformwork\b/.test(d)) {
    if (/\bslabs?\b/.test(d) && (!/\bbeams?\b/.test(d) || /\bsoffit\b/.test(d))) return match("slab_formwork_area", "m2");
    if (/\bbeams?\b/.test(d) && !/\b(?:slabs?|soffits?|undersides?|bottoms?)\b/.test(d)) return match("beam_formwork_area", "m2");
    if (/\bcolumns?\b/.test(d) && !/\b(?:beam|slab|footing|pedestal)\b/.test(d)) return match("column_formwork_area", "m2");
    if (/\bfootings?\b/.test(d) && /\bpedestals?\b/.test(d) && !/\b(?:column|beam|slab)\b/.test(d)) return match("foundation_formwork_area", "m2");
    return null;
  }
  if (/\b(?:rc|reinforced concrete)\b/.test(d) && !/\bc\s*\d|\bmpa\b|\bgrade\b|\b(?:precast|prestressed|post tensioned)\b/.test(d)) {
    const members = [[/\bfootings?\b/, "foundation_volume"], [/\bpedestals?\b/, "pedestal_volume"], [/\bcolumns?\b/, "column_volume"], [/\bbeam downstands?\b/, "beam_volume"], [/\bground (?:floor )?slabs?\b/, "ground_slab_volume"], [/\bfirst (?:floor )?slabs?\b/, "first_slab_volume"], [/\broof slabs?\b/, "roof_slab_volume"]].filter(([re]) => re.test(d));
    if (members.length === 1) {
      const thickness = d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
      return match(members[0][1], "m3", thickness ? { sourceThicknessM: Number(thickness[1]) / 1e3 } : {});
    }
  }
  if (/^excavat(?:e|ion|ing)\b/.test(d) && !/\b(?:rock|trench|strip)\b/.test(d)) return match("excavation_volume", "m3");
  if (/^rebar\b/.test(d) && !/\b(?:footing|slab|beam|column|pedestal|mesh)\b/.test(d)) return match("rebar_kg", "kg");
  if (/\bterrace\b/.test(d) && /\bceramic\b/.test(d) && !/\b(?:wall|walls|balcony)\b/.test(d)) return match("terrace_floor_area", "m2");
  if (/^roof (?:waterproofing|membrane)$/.test(d)) return match("roof_waterproofing_area", "m2");
  if (/^terrace (?:floor )?(?:waterproofing|membrane)$/.test(d)) return match("terrace_waterproofing_area", "m2");
  if (/^wc pans?(?: complete)?$/.test(d)) return match("toilet_count", "nr");
  if (/^(?:water supply|water) pipes?(?: complete)?$/.test(d)) return match("water_pipe_length", "m");
  if (/^waste pipes?(?: complete)?$/.test(d)) return match("waste_pipe_length", "m");
  if (/^split (?:ac|air conditioning) units?(?: complete)?$/.test(d)) return match("ac_count", "nr");
  if (/^ac insulated pipe(?:work|s)?$/.test(d)) return match("ac_pipe_length", "m");
  if (/^kitchen and laundry sink sets?(?: complete)?$/.test(d)) return match("kitchen_sink_count+laundry_sink_count", "nr", { keys: ["kitchen_sink_count", "laundry_sink_count"] });
  if (/^kitchen sink sets?(?: complete)?$/.test(d)) return match("kitchen_sink_count", "nr");
  if (/^laundry sink sets?(?: complete)?$/.test(d)) return match("laundry_sink_count", "nr");
  if (/^kitchen (?:hob and hood|hob hood) package$/.test(d)) return match("kitchen_hob_hood_count", "nr");
  if (/^(?:glass and metal )?terrace railing$/.test(d)) return match("terrace_railing_length", "m");
  if (/^driveway paving$/.test(d)) return match("driveway_area", "m2");
  if (/^soft landscaping$/.test(d)) return match("landscape_area", "m2");
  return null;
}
function pdfCatalogThicknessMatches(metric, rows) {
  if (metric.sourceThicknessM === void 0) return true;
  const labels = { ground_slab_volume: "(?:gf|ground(?: floor)?)", first_slab_volume: "(?:ff|first(?: floor)?)", roof_slab_volume: "roof" };
  const slab = labels[metric.key] ? new RegExp(`^${labels[metric.key]}\\s+slab:\\s*(\\d*\\.\\d+|\\d+)\\.?$`, "i") : null;
  const values = rows.flatMap((r) => [...String(r.evidence || "").matchAll(/\*\s*(\d+(?:\.\d+)?)\s+(m|mm)\s*\[([^\]]*)\]/gi)].flatMap((m) => {
    const raw = Number(m[1]), source2 = m[3].trim(), explicit = slab?.exec(source2);
    if (!/\bthick(?:ness)?\b/i.test(source2) && !(explicit && Math.abs(Number(explicit[1]) - raw) < 1e-9)) return [];
    return [raw * (m[2].toLowerCase() === "mm" ? 1e-3 : 1)];
  }));
  return values.length > 0 && values.every((v) => Math.abs(v - metric.sourceThicknessM) < 1e-9);
}
function pdfCatalogHeightMatches(metric, rows, description) {
  if (!["wet_wall_tile_area", "wet_wall_waterproofing_area"].includes(metric.key)) return true;
  const text3 = String(description || "").toLowerCase(), dimension2 = text3.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\b/);
  if (!dimension2) return true;
  const height = Number(dimension2[1]) * (dimension2[2] === "mm" ? 1e-3 : 1), kind = metric.key === "wet_wall_tile_area" ? "tile" : "waterproofing";
  const operands = rows.flatMap((r) => [...String(r.evidence || "").matchAll(/\*\s*(\d+(?:\.\d+)?)\s+m\s*\[WET ROOMS:\s*([^\]]*height[^\]]*)\]/gi)].filter((m) => m[2].toLowerCase().includes(kind)).map((m) => Number(m[1])));
  return operands.length > 0 && operands.every((v) => Math.abs(v - height) < 1e-9);
}

// src/lib/pdfSourceSpecifications.mjs
var concrete = [["pcc_volume", /\b(?:pcc|blinding)\b/], ["foundation_volume", /\b(?:foundations?|footings?)\b/], ["pedestal_volume", /\bpedestals?\b/], ["column_volume", /\bcolumns?\b/], ["beam_volume", /\bbeams?\b/], ["ground_slab_volume", /\b(?:ground|gf)(?: floor)? slabs?\b/], ["first_slab_volume", /\b(?:first|ff)(?: floor)? slabs?\b/], ["roof_slab_volume", /\broof slabs?\b/]];
var normal = (s) => String(s || "").toLowerCase().replace(/[‐‑–—-]/g, " ").replace(/\s+/g, " ").trim();
var unique5 = (xs) => [...new Set(xs)];
function clauses(text3) {
  return String(text3).split(/;|\n|\.(?=\s+[A-Z])/).map((s) => s.trim()).filter(Boolean);
}
function factsIn(text3, page, scope2 = "project") {
  const facts = [];
  for (const quote of clauses(text3)) {
    if (quote.length > 2e3) continue;
    const d = normal(quote), local = d.match(/\b(gf|ff|ground floor|first floor|floor\s*-?\d+)\b/);
    const scopeId = local ? ["gf", "ground floor"].includes(local[1]) ? "floor:0" : ["ff", "first floor"].includes(local[1]) ? "floor:1" : local[1].replace(/floor\s*/, "floor:") : scope2;
    const add = (metric, property, values) => {
      for (const value of unique5(values)) facts.push({ metric, property, value, page, scope_id: scopeId, quote, source: "native_pdf_text" });
    };
    if (/\b(?:not|unless|option|optional|alternative|except|excluding)\b/.test(d)) continue;
    for (const m of d.matchAll(/\b(external|internal) wall\s+[a-z]+\d+\s*=\s*(\d+(?:\.\d+)?)\s*mm\s+(cmu|concrete|aac|clay|brick)\b/g)) {
      const key2 = m[1] + "_block_area";
      add(key2, "thickness_mm", [Number(m[2])]);
      add(key2, "block_material", [m[3] === "cmu" ? "concrete" : m[3] === "brick" ? "clay" : m[3]]);
    }
    for (const [word, key2] of [["external", "external_block_area"], ["exterior", "external_block_area"], ["internal", "internal_block_area"], ["interior", "internal_block_area"]]) {
      if (/\b(?:height|ffl)\b|\b(?:above|below)\b/.test(d)) continue;
      const material2 = "(?:autoclaved aerated concrete|hollow concrete|solid concrete|aac|concrete|clay|brick)";
      const pattern = new RegExp(`\\b${word}\\s*(?:${material2}\\s+)?(?:walls?|partitions?|blockwork|masonry)?\\s*[:=]?\\s*(?:${material2}\\s+)?(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\b`, "g");
      add(key2, "thickness_mm", [...d.matchAll(pattern)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2]]));
      const reversed = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\s+(?:thick\\s+)?${word}\\s+(?:${material2}\\s+)?(?:walls?|partitions?|blockwork|masonry)\\b`, "g");
      add(key2, "thickness_mm", [...d.matchAll(reversed)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2]]));
    }
    const grades = [...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map((m) => `C${m[1]}${m[2] ? "/" + m[2] : ""}`);
    for (const [key2, re] of concrete) if (re.test(d)) add(key2, "concrete_grade", grades);
    if (/\ball\s+(?:structural\s+)?concrete\b/.test(d) && !/\bexcept\b/.test(d)) for (const [key2] of concrete.filter(([k]) => k !== "pcc_volume")) add(key2, "concrete_grade", grades);
    for (const [key2, re] of [["water_pipe_length", /\b(?:water supply|domestic water|water pipes?)\b/], ["waste_pipe_length", /\b(?:waste|drainage|soil)\s*(?:water\s*)?pipes?\b/]]) if (re.test(d)) {
      const dn = [...d.matchAll(/(?:\b(?:dn|dia(?:meter)?|od)\s*[:=]?\s*|[ø⌀]\s*)(\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/g)].map((m) => Number(m[1]) * { mm: 1, cm: 10, m: 1e3 }[m[2] || "mm"]);
      const series = [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\/|and|,)\s*(\d+(?:\.\d+)?)\s*mm\b/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
      add(key2, "diameter_mm", series.length ? series : dn.length ? dn : [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/g)].map((m) => Number(m[1])));
      add(key2, "pipe_material", [...d.matchAll(/\b(ppr|cpvc|u?pvc|hdpe|copper|pex|steel|galvanized)\b/g)].map((m) => m[1].toUpperCase()));
    }
    if (/\b(?:ac|air conditioning|refrigerant)\b/.test(d) && /\b(?:pipes?|pipework|piping|line sets?)\b/.test(d)) {
      add("ac_pipe_length", "pipe_material", [...d.matchAll(/\b(copper|steel|aluminium|aluminum|ppr|u?pvc|hdpe)\b/g)].map((m) => m[1].toUpperCase()));
      const inches = [...d.matchAll(/\b(\d+)\s*\/\s*(\d+)\s*(?:["″]|inch(?:es)?\b|in\b)/g)].map((m) => Math.round(Number(m[1]) / Number(m[2]) * 25.4 * 1e6) / 1e6).filter((v) => Number.isFinite(v) && v > 0);
      if (inches.length === 2) add("ac_pipe_length", "diameter_pair_mm", [inches.sort((a, b) => a - b).join("+")]);
      if (inches.length && inches.length !== 2 || [...d.matchAll(/\b\d+\s*\/\s*\d+/g)].length !== inches.length) add("ac_pipe_length", "unparsed_pipe_detail", ["present"]);
      const insulation = [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm\b/g)].map((m) => Number(m[1] || m[2]));
      add("ac_pipe_length", "insulation_mm", insulation);
      const detail = d.replace(/\b\d+(?:\.\d+)?\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*\d+(?:\.\d+)?\s*mm\b/g, "");
      if (/\b(?:dn|diameter|dia|od)\b|\d\s*mm|[øØ]/.test(detail)) add("ac_pipe_length", "unparsed_pipe_detail", ["present"]);
    }
    if (/\b(?:ac|air conditioning|air conditioner|split)\b/.test(d)) add("ac_count", "capacity_tr", [...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/g)].map((m) => Number(m[1])));
    for (const [key2, re] of [["internal_block_area", /\b(?:internal|interior|partition)\b/], ["external_block_area", /\b(?:external|exterior)\b/]]) if (re.test(d) && /\b(?:blockwork|blocks?|masonry|walls?)\b/.test(d)) {
      const material2 = /\b(?:aac|autoclaved)\b/.test(d) ? "aac" : /\b(?:clay|brick)\b/.test(d) ? "clay" : /\bconcrete\b/.test(d) ? "concrete" : null;
      if (material2) add(key2, "block_material", [material2]);
    }
    if (/\b(?:wood(?:en)?|timber|parquet)\b/.test(d) && /\bfloor/.test(d)) {
      const system = /\bengineered\b/.test(d) ? "engineered_wood" : /\bsolid\b/.test(d) ? "solid_wood" : /\blaminate\b/.test(d) ? "laminate" : null;
      if (system) add("wood_floor_area", "floor_system", [system]);
    }
    for (const [key2, re] of [["terrace_floor_area", /\bterrace\b/], ["wet_wall_tile_area", /\bwet\s+(?:area\s+)?wall\b/], ["backsplash_area", /\bbacksplash\b/]]) if (re.test(d) && /\b(?:tile|tiling|ceramic|porcelain|marble|granite)\b/.test(d)) {
      const material2 = ["porcelain", "marble", "granite", "ceramic"].find((s) => new RegExp("\\b" + s + "\\b").test(d));
      if (material2) add(key2, "tile_material", [material2]);
    }
    for (const [key2, re] of [["roof_waterproofing_area", /\broof\b/], ["terrace_waterproofing_area", /\bterrace\b/], ["wet_floor_waterproofing_area", /\bwet\s+(?:area\s+)?floor\b/], ["wet_wall_waterproofing_area", /\bwet\s+(?:area\s+)?wall\b/]]) if (re.test(d) && /\b(?:waterproof|membrane)/.test(d)) {
      const system = /\b(?:polyurethane|pu)\b/.test(d) ? "polyurethane" : /\bcementitious\b/.test(d) ? "cementitious" : /\b(?:torch|bitumen|bituminous)\b/.test(d) ? "torch_bitumen" : null;
      if (system) add(key2, "waterproofing_system", [system]);
    }
    if (/\bkitchen\b/.test(d) && /\bcabinet/.test(d)) {
      const material2 = /\balumini?um\b/.test(d) ? "aluminium" : /\bmdf\b/.test(d) ? "mdf" : /\bplywood\b/.test(d) ? "plywood" : null;
      if (material2) add("kitchen_cabinet_length", "cabinet_material", [material2]);
    }
    if (/\b(?:ac|air conditioning|air conditioner)\b/.test(d)) {
      const system = /\bvrf\b/.test(d) ? "vrf" : /\bducted\s+split\b/.test(d) ? "ducted_split" : /\bsplit\b/.test(d) ? "split" : null;
      if (system) add("ac_count", "unit_system", [system]);
    }
  }
  return facts.filter((f) => typeof f.value !== "number" || Number.isFinite(f.value) && f.value > 0 && f.value < 1e6);
}
function readPdfSourceSpecifications(takeoff) {
  const pages = takeoff?.page_results || [], facts = [];
  let native = false;
  for (const p of pages) {
    if (["boq", "estimate", "quotation", "cost_schedule"].includes(p.page_evidence?.kind)) continue;
    const text3 = p.native_text_evidence?.status === "readable" ? p.native_text_evidence : p.native_plan_text?.status === "readable" ? p.native_plan_text : null;
    if (!text3) continue;
    native = true;
    if (!Number.isInteger(p.pageNumber) || p.pageNumber < 1 || !Array.isArray(text3.spans) || text3.spans.length > 1e4) continue;
    const bands = [];
    const spans = text3.spans.filter((s) => typeof s.text === "string" && Number.isFinite(s.y) && Number.isFinite(s.x)).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const s of spans) {
      let band5 = bands.at(-1);
      if (!band5 || Math.abs(band5.y - s.y) >= 1.5) {
        band5 = { y: s.y, spans: [] };
        bands.push(band5);
      }
      band5.spans.push(s);
    }
    const value = bands.map((b) => b.spans.sort((a, b2) => a.x - b2.x).map((s) => s.text).join(" ")).join("\n");
    let scope2 = normal(p.page_evidence?.scope_id || "project").replace(/floor\s*[: ]\s*/, "floor:");
    if (["gf", "ground floor"].includes(scope2)) scope2 = "floor:0";
    if (["ff", "first floor"].includes(scope2)) scope2 = "floor:1";
    if (value.length > 1e5) continue;
    facts.push(...factsIn(value, p.pageNumber, scope2));
  }
  if (!native && !pages.length) {
    for (const f of takeoff?.pdf_analysis?.specification_facts || []) {
      if (f?.source !== "native_pdf_text" || !Number.isInteger(f.page) || f.page < 1 || typeof f.scope_id !== "string" || typeof f.quote !== "string" || f.quote.length > 2e3) continue;
      if (factsIn(f.quote, f.page, f.scope_id).some((r) => r.metric === f.metric && r.property === f.property && r.value === f.value && r.scope_id === f.scope_id)) facts.push({ ...f });
    }
  }
  return [...new Map(facts.map((f) => [JSON.stringify([f.metric, f.property, f.value, f.page, f.scope_id, f.quote]), f])).values()];
}
function valueFor(facts, key2, property, takeoff) {
  const rows = facts.filter((f) => f.metric === key2 && f.property === property), found = unique5(rows.map((f) => f.value));
  if (found.length !== 1) return null;
  if (rows.some((f) => f.scope_id === "project")) return found[0];
  const intrinsic = { ground_slab_volume: "floor:0", first_slab_volume: "floor:1", roof_slab_volume: "roof" }[key2];
  const scopes = intrinsic ? [intrinsic] : unique5((takeoff?.pdf_analysis?.selected_floor_pages || []).map((p) => p.scope));
  return scopes.length && scopes.every((s) => rows.some((f) => f.scope_id === s)) ? found[0] : null;
}
function compatible(facts, key2, constraints, takeoff) {
  return Object.entries(constraints).every(([p, v]) => valueFor(facts, key2, p, takeoff) === v);
}
function resolvedPdfSpecifications(takeoff, key2, facts = readPdfSourceSpecifications(takeoff)) {
  return unique5(facts.filter((f) => f.metric === key2).map((f) => f.property)).flatMap((property) => {
    const value = valueFor(facts, key2, property, takeoff);
    return value === null ? [] : [{ property, value, pages: unique5(facts.filter((f) => f.metric === key2 && f.property === property).map((f) => f.page)) }];
  });
}
function pdfSpecificationConflicts(facts) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of facts) {
    const key2 = f.metric + "|" + f.property;
    if (!groups.has(key2)) groups.set(key2, []);
    groups.get(key2).push(f);
  }
  return [...groups.values()].filter((rows) => unique5(rows.map((f) => f.value)).length > 1).map((rows) => ({ metric: rows[0].metric, property: rows[0].property, values: unique5(rows.map((f) => f.value)), pages: unique5(rows.map((f) => f.page)), reason: "Mixed or conflicting specifications cannot price one aggregate quantity." }));
}
function sourceSpecificationMetric(description, unit5, takeoff, facts = readPdfSourceSpecifications(takeoff)) {
  const d = normal(description), finish = (keys, expected, constraints = {}) => {
    if (!keys.length || !["m2", "m3", "m", "nr", "nos", "no", "each", "ea"].includes(unit5) || !(unit5 === expected || expected === "nr" && ["nos", "no", "each", "ea"].includes(unit5))) return null;
    return { key: keys.join("+"), ...keys.length > 1 ? { keys } : {}, factor: 1, specificationFacts: facts.filter((f) => keys.includes(f.metric) && Object.keys(constraints).includes(f.property)) };
  };
  if (/\b(?:blockwork|blocks?|masonry)\b/.test(d) && unit5 === "m2") {
    const thickness = d.match(/\b(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/), constraints = thickness ? { thickness_mm: Number(thickness[1]) * { mm: 1, cm: 10, m: 1e3 }[thickness[2]] } : {};
    const ext = /\b(?:external|exterior)\b/.test(d), int = /\b(?:internal|interior|partition)\b/.test(d);
    if (ext && int || !thickness && !ext && !int || /\b(?:aac|autoclaved|gypsum|glass|clay|brick)\b/.test(d)) return null;
    const keys = (ext ? ["external_block_area"] : int ? ["internal_block_area"] : ["external_block_area", "internal_block_area"]).filter((k) => compatible(facts, k, constraints, takeoff));
    return keys.length === 1 ? finish(keys, "m2", constraints) : null;
  }
  const grades = [...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map((m) => `C${m[1]}${m[2] ? "/" + m[2] : ""}`);
  if (grades.length && /\b(?:concrete|rc|blinding)\b/.test(d)) {
    if (unique5(grades).length !== 1 || /\b(?:precast|prestressed|post tensioned|mesh)\b/.test(d)) return null;
    if (/\b\d+(?:\.\d+)?\s*(?:mm|cm)\b|\d\s*[x×]\s*\d/.test(d)) return null;
    const named = concrete.filter(([, re]) => re.test(d));
    const keys = (named.length ? named.map(([k]) => k) : concrete.filter(([k]) => k !== "pcc_volume").map(([k]) => k)).filter((k) => takeoff?.pdf_analysis?.quantity_evidence?.[k]?.length && compatible(facts, k, { concrete_grade: grades[0] }, takeoff));
    if (named.length && keys.length !== named.length) return null;
    return finish(keys, "m3", { concrete_grade: grades[0] });
  }
  if (/\bpipes?\b/.test(d) && /\b(?:water|waste|drainage|soil)\b/.test(d)) {
    const waste = /\b(?:waste|drainage|soil)\b/.test(d), water = /\bwater\b/.test(d) && !waste;
    const key2 = waste ? "waste_pipe_length" : water ? "water_pipe_length" : null, diameter = d.match(/\b(?:dn\s*)?(\d+(?:\.\d+)?)\s*(mm|cm)?\b/), material2 = d.match(/\b(ppr|u?pvc|hdpe|copper)\b/);
    if (!key2 || !diameter && !material2) return null;
    const constraints = { ...diameter ? { diameter_mm: Number(diameter[1]) * (diameter[2] === "cm" ? 10 : 1) } : {}, ...material2 ? { pipe_material: material2[1].toUpperCase() } : {} };
    return compatible(facts, key2, constraints, takeoff) ? finish([key2], "m", constraints) : null;
  }
  if (/\b(?:ac|air conditioning|air conditioner)\b/.test(d) && /\b(?:units?|split)\b/.test(d)) {
    const capacity = d.match(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/);
    if (!capacity) return null;
    const constraints = { capacity_tr: Number(capacity[1]) };
    return compatible(facts, "ac_count", constraints, takeoff) ? finish(["ac_count"], "nr", constraints) : null;
  }
  return null;
}
function hasSourceSpecificationScope(description) {
  const d = normal(description);
  return /\b(?:blockwork|blocks?|masonry)\b/.test(d) || /\bc\s*\d/.test(d) && /\b(?:concrete|rc|blinding)\b/.test(d) || /\bpipes?\b/.test(d) && /\b(?:ppr|u?pvc|hdpe|copper|dn)\b|\d\s*mm\b/.test(d) || /\b(?:ac|air conditioning|air conditioner)\b/.test(d) && /\d+(?:\.\d+)?\s*(?:tr|tons?|tonnes?)\b/.test(d);
}

// src/lib/pdfNativePageExtraction.mjs
var number3 = (text3) => /^\d+(?:\.\d+)?$/.test(String(text3).trim()) ? Number(text3) : NaN;
var clean4 = (text3) => String(text3 || "").trim().toLowerCase().replace(/\s+/g, " ");
var floor = (text3) => /^(?:ground|first|second|third|basement|roof)(?: floor)?$|^floor \d+$/i.test(text3.trim());
var zero = { rooms: 0, doors: 0, windows: 0, wall_length: 0, wall_area: 0, floor_area: 0, ceiling_area: 0, door_area: 0, window_area: 0 };
var claim = (key2, value, unit5, scope2, page, evidence) => ({ key: key2, value, unit: unit5, scope_id: scope2, pages: [page], evidence, native_calculated: true, document_calculated: true });
function table2(spans, columns) {
  const matches = [];
  for (const anchor of spans) {
    if (!columns[0].test(clean4(anchor.text))) continue;
    const band5 = spans.filter((s) => Math.abs(s.y - anchor.y) < 1.5);
    const cells = columns.map((pattern) => band5.filter((s) => pattern.test(clean4(s.text))));
    if (cells.every((c) => c.length === 1)) matches.push({ y: anchor.y, cols: cells.map((c) => c[0]) });
  }
  if (matches.length !== 1) throw Error("A single unambiguous table header is required");
  const head = matches[0];
  if (head.cols.some((c, i) => i && c.x - head.cols[i - 1].x < 25)) throw Error("Table columns overlap");
  const rows = [];
  for (const s of [...spans].filter((s2) => s2.y < head.y - 3).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((r) => Math.abs(r.y - s.y) < 1.5);
    if (!row) {
      row = { y: s.y, cells: head.cols.map(() => []) };
      rows.push(row);
    }
    let index = 0;
    for (let i = 1; i < head.cols.length; i++) if (Math.abs(s.x - head.cols[i].x) < 15) index = i;
    row.cells[index].push(s.text.trim());
  }
  return { head, rows: rows.filter((r) => r.cells.slice(1).some((c) => c.length)).map((r) => r.cells.map((c) => c.join(" "))) };
}
var services = /* @__PURE__ */ new Map([
  ["light points", ["light_count", "nr"]],
  ["lighting points", ["light_count", "nr"]],
  ["socket points", ["socket_count", "nr"]],
  ["distribution boards", ["distribution_board_count", "nr"]],
  ["split ac units", ["ac_count", "nr"]],
  ["insulated ac pipes", ["ac_pipe_length", "m"]],
  ["smoke detectors", ["smoke_detector_count", "nr"]],
  ["water supply pipes", ["water_pipe_length", "m"]],
  ["waste pipes", ["waste_pipe_length", "m"]],
  ["wc sets", ["toilet_count", "nr"]],
  ["wash basins", ["basin_count", "nr"]]
]);
function fixtureClaims(native, page) {
  const text3 = native.spans.map((s) => s.text).join(" ");
  if (!/\ball unshown plumbing is excluded\b/i.test(text3)) throw Error("Fixture schedule completeness unresolved");
  const rows = native.spans.filter((s) => /^Each (?:of )?[A-Z][A-Z0-9_-]*(?:\s*(?:,|and)\s*[A-Z][A-Z0-9_-]*)*:\s*\d/i.test(s.text.trim()));
  if (!rows.length || rows.length > 200) throw Error("Explicit fixture room rows unavailable");
  if (native.spans.some((s) => !rows.includes(s) && /\d+\s+(?:WC sets?|wash basins?|sinks?|floor drains?|electric water heaters?)\b/i.test(s.text))) throw Error("Unparsed fixture quantity outside the explicit room schedule");
  const inventory = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  const fixtureKeys = /* @__PURE__ */ new Map([["wc set", "toilet_count"], ["wc sets", "toilet_count"], ["wash basin", "basin_count"], ["wash basins", "basin_count"], ["sinks", null], ["sink", null], ["floor drain", null], ["floor drains", null], ["electric water heater", null], ["electric water heaters", null]]);
  for (const row of rows) {
    const m = row.text.trim().match(/^Each (?:of )?([^:]+):\s*(.+?)\.?$/i);
    const rooms = m[1].split(/\s*(?:,|\band\b)\s*/).map((s) => s.trim().toUpperCase());
    if (rooms.some((s) => !/[0-9]/.test(s) || !/^\w[\w-]*$/.test(s)) || new Set(rooms).size !== rooms.length) throw Error("Invalid or repeated fixture room identity");
    const entries = m[2].split(/\s*\+\s*/);
    for (const entry of entries) {
      const cells = entry.match(/^(\d+)\s+(.+)$/);
      if (!cells || !fixtureKeys.has(clean4(cells[2]))) throw Error("Unsupported fixture row");
      const key2 = fixtureKeys.get(clean4(cells[2])), count = Number(cells[1]);
      if (!Number.isSafeInteger(count) || count > 1e4) throw Error("Fixture count outside supported range");
      const identity = key2 || clean4(cells[2]).replace(/s$/, "");
      for (const room of rooms) {
        const id = room + "|" + identity;
        if (seen.has(id)) throw Error("Repeated physical fixture row");
        seen.add(id);
      }
      if (key2) {
        const items = inventory.get(key2) || [];
        items.push({ count, rooms, evidence: row.text });
        inventory.set(key2, items);
      }
    }
  }
  return [...inventory].map(([key2, items]) => claim(
    key2,
    items.reduce((s, r) => s + r.count * r.rooms.length, 0),
    "nr",
    "project",
    page,
    `Native explicit fixture schedule; each listed room counted once: ${items.map((r) => r.evidence).join("; ")}. Source excludes all unshown plumbing. Unmapped fixture types remain separate and unmeasured.`
  ));
}
function serviceClaims(native, page, normalizePdfScope2) {
  const t = table2(native.spans, [/^item$/, /^(?:ground|ground floor|gf)$/, /^(?:first|first floor|ff)$/, /^unit$/]);
  const scopes = t.head.cols.slice(1, 3).map((s) => normalizePdfScope2(/^(ground|first)$/i.test(s.text) ? s.text + " floor" : s.text));
  if (new Set(scopes).size !== 2 || !t.rows.length || t.rows.length > 500) throw Error("Invalid service scope/table");
  const seen = /* @__PURE__ */ new Set(), claims = [];
  for (const row of t.rows) {
    const mapping = services.get(clean4(row[0]));
    if (!mapping || seen.has(mapping[0])) throw Error("Unknown or repeated service row");
    seen.add(mapping[0]);
    const [key2, unit5] = mapping;
    if (clean4(row[3]) !== unit5) throw Error("Unsupported service unit");
    for (let i = 0; i < 2; i++) {
      const value = number3(row[i + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 1e6 || unit5 === "nr" && !Number.isInteger(value)) throw Error("Invalid service quantity");
      claims.push(claim(key2, value, unit5, scopes[i], page, `Native source table: ${row[0]}; ${t.head.cols[i + 1].text}: ${row[i + 1]} ${unit5}. Material, diameter and capacity are separate source requirements.`));
    }
  }
  return claims;
}
function barClaims(native, page) {
  const text3 = native.spans.map((s) => s.text).join(" ");
  const formula = [...text3.matchAll(/diameter\s*\(mm\)\s*\^\s*2\s*\/\s*(\d+(?:\.\d+)?)\s*kg\/m/gi)];
  if (formula.length !== 1 || !(Number(formula[0][1]) > 0) || !/sum all rows/i.test(text3) || !/(?:only scheduled\s+reinforcement|complete project reinforcement|all project reinforcement)/i.test(text3)) throw Error("Complete reinforcement scope/formula required");
  const t = table2(native.spans, [/^element$/, /^dia(?:meter)? mm$/, /^count$/, /^cut length m$/]);
  if (!t.rows.length || t.rows.length > 500) throw Error("Empty/excessive reinforcement table");
  const seen = /* @__PURE__ */ new Set(), terms = [];
  for (const row of t.rows) {
    const id = clean4(row[0]), [diameter, count, length] = row.slice(1).map(number3);
    if (!id || seen.has(id) || ![diameter, count, length].every((n) => Number.isFinite(n) && n > 0) || !Number.isInteger(count) || diameter > 100 || count > 1e6 || length > 1e6) throw Error("Invalid or repeated reinforcement row");
    seen.add(id);
    terms.push({ id, diameter, count, length, kg: count * length * diameter * diameter / Number(formula[0][1]) });
  }
  const value = terms.reduce((sum, t2) => sum + t2.kg, 0);
  if (!Number.isFinite(value)) throw Error("Invalid reinforcement total");
  return [claim("rebar_kg", value, "kg", "project", page, `Native complete bar table; ${formula[0][0]}; no intermediate rounding: ${terms.map((t2) => `${t2.id}: ${t2.count} \xD7 ${t2.length} m \xD7 ${t2.diameter} mm squared / ${formula[0][1]}`).join("; ")}. No unscheduled reinforcement or wastage added.`)];
}
function extractNativePdfPages(readings, normalizePdfScope2) {
  const pages = [], audits = [];
  let inherited = null;
  for (const reading of [...readings].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const { pageNumber, native_text_evidence: native } = reading;
    const audit = { page: pageNumber, text_status: native?.status || "unavailable", extracted: false };
    audits.push(audit);
    if (native?.status !== "readable" || !Array.isArray(native.spans) || native.spans.length > 3e3) {
      inherited = null;
      continue;
    }
    const spans = native.spans, text3 = spans.map((s) => s.text).join(" ");
    let kind = null, scope2 = "project", quantities = [];
    try {
      const openingHeader = ["id", "type", "width", "height"].every((h) => spans.some((s) => clean4(s.text) === h));
      if (openingHeader) {
        const headings = spans.filter((s) => floor(s.text));
        if (headings.length !== 1) throw Error("Opening floor heading unresolved");
        kind = "opening_schedule";
        scope2 = normalizePdfScope2(headings[0].text);
        const result = readNativeOpeningSchedule({ pageNumber, page_evidence: { kind, scope_id: scope2 }, native_text_evidence: native }, normalizePdfScope2, inherited?.page === pageNumber - 1 ? inherited.basis : null);
        if (result.status !== "read") throw Error(result.reason || "Opening table unavailable");
        inherited = { page: pageNumber, basis: result.dimension_basis };
      } else {
        inherited = null;
        if (/\bplumbing\b/i.test(text3) && /\ball unshown plumbing is excluded\b/i.test(text3)) {
          kind = "quantity_schedule";
          quantities = fixtureClaims(native, pageNumber);
        } else if (/\bdeclared services schedule\b|\bservices quantity schedule\b/i.test(text3)) {
          kind = "quantity_schedule";
          quantities = serviceClaims(native, pageNumber, normalizePdfScope2);
        } else if (/\b(?:declared bar schedule|reinforcement schedule)\b/i.test(text3)) {
          kind = "quantity_schedule";
          quantities = barClaims(native, pageNumber);
        } else if (/\b(?:measurement and finishes|construction specifications|finish specifications)\b/i.test(text3) && ["WALLS:", "FLOORS:", "CEILINGS:"].filter((s) => text3.includes(s)).length >= 2) {
          kind = "specification";
        } else throw Error("No fully supported local page contract");
      }
      const revisions = [...new Set([...text3.matchAll(/\bREV(?:ISION)?\s*[:.]?\s*(R?\d+|[A-Z])\b/gi)].map((m) => m[1].toUpperCase()))];
      if (revisions.length > 1) throw Error("Conflicting native source revisions");
      pages.push({
        ...zero,
        pageNumber,
        confidence: 0,
        detected_items: [],
        area_geometry: null,
        page_evidence: { kind, scope_id: scope2, drawing_id: null, revision: revisions[0] || null, quantities },
        native_text_evidence: native,
        native_extraction: { version: 1, method: "explicit_source_table_or_specification", parsed_keys: [...new Set(quantities.map((q) => q.key))], requires_source_review: true },
        notes: "Locally extracted source evidence. Unparsed prose and cross-page relationships require source review; not a complete or approved takeoff."
      });
      Object.assign(audit, { extracted: true, kind, scope: scope2, parsed_keys: [...new Set(quantities.map((q) => q.key))] });
    } catch (error2) {
      audit.reason = String(error2.message).slice(0, 180);
      inherited = null;
    }
  }
  return { pages, audits };
}

// src/lib/pdfNativeFinishLedger.mjs
function nativePdfFinishLedger(takeoff) {
  const report = takeoff?.pdf_analysis, details = report?.document_measurement_review?.native_coordinated_measurements;
  if (!details?.length || details.length !== report?.selected_floor_pages?.length) return null;
  const groups = /* @__PURE__ */ new Map(), tags = /* @__PURE__ */ new Set();
  let total = 0;
  for (const floor2 of details) {
    const audit = report.area_validation?.find((a) => a.page === floor2.page && a.status === "native_clear_geometry_checked");
    if (!audit || !floor2.rooms?.length || floor2.rooms.length !== audit.rooms?.length) return null;
    for (const room of floor2.rooms) {
      const actual = audit.rooms.find((r) => r.tag === room.tag);
      if (tags.has(room.tag) || !actual || !Number.isFinite(room.floor_area) || Math.abs(room.floor_area - (actual.void ? 0 : actual.area)) > 1e-7 || !room.finish_source_pages?.length) return null;
      tags.add(room.tag);
      if (room.floor_code === "VOID") {
        if (room.floor_area !== 0) return null;
        continue;
      }
      if (!(room.floor_area > 0) || !room.floor_description || !room.ceiling_description) return null;
      total += room.floor_area;
      const add = (family2, code, description) => {
        const key2 = `native-${family2}:${code}`, old = groups.get(key2);
        if (old && old.sourceDescription !== description) throw Error("Conflicting native finish descriptions");
        const group = old || { metricKey: key2, family: family2, sourceCode: code, sourceDescription: description, quantity: 0, unit: "m2", pages: [], rooms: [] };
        group.quantity += room.floor_area;
        group.pages = [.../* @__PURE__ */ new Set([...group.pages, ...room.finish_source_pages])];
        group.rooms.push(room.tag);
        groups.set(key2, group);
      };
      add("floor", room.floor_code, room.floor_description);
      if (/gypsum/i.test(room.ceiling_description)) add("ceiling-board", room.ceiling_code, room.ceiling_description);
      add("ceiling-paint", room.ceiling_code, "Paint to " + room.ceiling_description);
    }
  }
  if (Math.abs(total - (takeoff.scheduled_quantities?.floor_area ?? takeoff.floor_area)) > 1e-7) return null;
  return [...groups.values()];
}
function nativeFinishReplacesMetric(takeoff, key2) {
  return (["gypsum_ceiling_area", "ceiling_paint_area", "wood_floor_area", "ceramic_floor_area", "epoxy_floor_area", "terrace_floor_area"].includes(key2) || takeoff?.pdf_analysis?.document_measurement_review?.native_source_operations?.some((o) => o.replacesMetric === key2 || o.replacesMetrics?.includes(key2))) && !!nativePdfFinishLedger(takeoff);
}
function nativePdfSourceOperationLedger(takeoff) {
  if (!nativePdfFinishLedger(takeoff)) return [];
  return (takeoff.pdf_analysis.document_measurement_review.native_source_operations || []).filter((o) => o.metricKey?.startsWith("native-") && o.sourceCode && o.sourceDescription && Number.isFinite(o.quantity) && o.quantity > 0 && ["m", "m2", "m3", "nr"].includes(o.unit) && (o.unit !== "nr" || Number.isInteger(o.quantity)) && o.pages?.length && o.pages.every((n) => takeoff.page_results?.some((p) => p.pageNumber === n)) && o.basis);
}

// src/lib/pdfTakeoffEvidence.mjs
var PDF_METRIC_UNITS = Object.freeze({ rooms: "nr", door_count: "nr", window_count: "nr", door_area: "m2", window_area: "m2", wall_length: "m", wall_area: "m2", floor_area: "m2", ceiling_area: "m2", roof_area: "m2", pcc_volume: "m3", foundation_volume: "m3", pedestal_volume: "m3", column_volume: "m3", beam_volume: "m3", ground_slab_volume: "m3", first_slab_volume: "m3", roof_slab_volume: "m3", rebar_kg: "kg", foundation_formwork_area: "m2", column_formwork_area: "m2", beam_formwork_area: "m2", slab_formwork_area: "m2", external_block_area: "m2", internal_block_area: "m2", wood_floor_area: "m2", ceramic_floor_area: "m2", epoxy_floor_area: "m2", terrace_floor_area: "m2", wet_floor_area: "m2", wet_wall_area: "m2", plaster_area: "m2", paint_area: "m2", gypsum_ceiling_area: "m2", excavation_volume: "m3", toilet_count: "nr", basin_count: "nr", shower_count: "nr", socket_count: "nr", light_count: "nr", distribution_board_count: "nr", ac_count: "nr", smoke_detector_count: "nr", water_pipe_length: "m", waste_pipe_length: "m", ac_pipe_length: "m", kitchen_cabinet_length: "m", terrace_railing_length: "m", roof_waterproofing_area: "m2", terrace_waterproofing_area: "m2", wet_floor_waterproofing_area: "m2", wet_wall_waterproofing_area: "m2", wet_wall_tile_area: "m2", ceiling_paint_area: "m2", backsplash_area: "m2", driveway_area: "m2", landscape_area: "m2", kitchen_sink_count: "nr", laundry_sink_count: "nr", internal_wall_length: "m", external_wall_length: "m", internal_door_count: "nr", service_door_count: "nr", entrance_door_count: "nr", garage_door_count: "nr", kitchen_hob_hood_count: "nr" });
function normalizePdfScope(s) {
  const v = String(s || "").toLowerCase().trim().replace(/[ _-]+/g, " ");
  if (["gf", "ground", "ground floor", "floor 0", "\u0647\u0645\u06A9\u0641", "\u0627\u0644\u0637\u0627\u0628\u0642 \u0627\u0644\u0623\u0631\u0636\u064A"].includes(v)) return "floor:0";
  if (["ff", "first", "first floor", "floor 1", "\u0637\u0628\u0642\u0647 \u0627\u0648\u0644", "\u0627\u0644\u0637\u0627\u0628\u0642 \u0627\u0644\u0623\u0648\u0644"].includes(v)) return "floor:1";
  if (["project", "whole project", "all floors", "total"].includes(v)) return "project";
  return v;
}
var valid = (n) => Number.isFinite(n) && n >= 0;
function pdfExcludedMetricKeys(exclusions) {
  const declared = /* @__PURE__ */ new Set();
  for (const text3 of exclusions || []) for (const token of String(text3).match(/[A-Za-z_][A-Za-z_0-9]*/g) || [])
    if (Object.hasOwn(PDF_METRIC_UNITS, token)) declared.add(token);
  return [...declared];
}
function mergePdfEvidence(pages, failed = [], total = pages.length) {
  const warnings = [], selected = /* @__PURE__ */ new Map(), excluded = [], conflictedFloors = /* @__PURE__ */ new Set();
  const documentReview = applyPdfDocumentReview(pages, PDF_METRIC_UNITS, normalizePdfScope);
  pages = documentReview.pages;
  warnings.push(...documentReview.warnings);
  const reviewStatus = pages.find((p) => p.document_review_status)?.document_review_status;
  if (reviewStatus && ["failed", "pending"].includes(reviewStatus.status)) warnings.push("PDF cross-page measurement review " + reviewStatus.status + ": " + reviewStatus.reason);
  const areaValidation = [];
  pages = pages.map((p) => {
    const checked = auditPdfAreaGeometry(p, pages);
    if (checked.audit) areaValidation.push(checked.audit);
    warnings.push(...checked.warnings);
    if (checked.page.__areaGeometryValidated) return checked.page;
    const recovered = recoverPdfRoomInventory(checked.page);
    warnings.push(...recovered.warnings);
    return recovered.page;
  });
  for (const p of pages) {
    const e = p.page_evidence;
    if (e?.kind !== "floor_plan") {
      excluded.push({ page: p.pageNumber, reason: "not_an_architectural_floor_plan" });
      continue;
    }
    const scope2 = normalizePdfScope(e.scope_id);
    if (!scope2 || scope2 === "project") {
      excluded.push({ page: p.pageNumber, reason: "unresolved_floor_scope" });
      warnings.push("Floor scope missing on page " + p.pageNumber);
      continue;
    }
    const existing = selected.get(scope2);
    if (!existing) {
      selected.set(scope2, p);
      continue;
    }
    if (existing.page_evidence.revision !== e.revision) {
      warnings.push("Conflicting floor revisions: " + scope2);
      conflictedFloors.add(scope2);
    }
    if ((p.confidence || 0) > (existing.confidence || 0)) {
      excluded.push({ page: existing.pageNumber, reason: "duplicate_floor_scope" });
      selected.set(scope2, p);
    } else excluded.push({ page: p.pageNumber, reason: "duplicate_floor_scope" });
  }
  const floors = [...selected.entries()].filter(([scope2]) => !conflictedFloors.has(scope2)).map(([, p]) => p), fields = { rooms: 0, doors: 0, windows: 0, wall_length: 0, wall_area: 0, floor_area: 0, ceiling_area: 0, door_area: 0, window_area: 0 };
  const native = nativeOpeningEvidence(pages.filter((p) => p.page_evidence?.kind !== "floor_plan" || floors.includes(p)), normalizePdfScope);
  const nativeTables = extractNativePdfPages(pages.map((p) => ({ pageNumber: p.pageNumber, native_text_evidence: p.native_text_evidence })), normalizePdfScope);
  const tableClaims = nativeTables.pages.flatMap((p) => p.page_evidence.quantities);
  const nativeOpeningKeys = new Set(native.claims.map((q) => q.key));
  const nativeWholeTableKeys = new Set(tableClaims.filter((q) => normalizePdfScope(q.scope_id) === "project").map((q) => q.key));
  const nativeFloorTableKeys = new Set(tableClaims.filter((q) => normalizePdfScope(q.scope_id) !== "project").map((q) => q.key));
  const nativeTableIdentities = new Set(tableClaims.map((q) => q.key + "|" + normalizePdfScope(q.scope_id)));
  warnings.push(...native.warnings);
  const nativeKeys = new Set([...native.claims, ...tableClaims].map((q) => q.key));
  for (const p of floors) for (const k of Object.keys(fields)) {
    if (valid(p[k])) fields[k] += p[k];
  }
  const claims = /* @__PURE__ */ new Map(), rejected = [];
  const observations = pages.filter((p) => p.page_evidence?.kind !== "floor_plan" || floors.includes(p)).map((p) => {
    const direct = p.page_evidence?.kind === "floor_plan" ? Object.entries({ rooms: "rooms", doors: "door_count", windows: "window_count", floor_area: "floor_area", ceiling_area: "ceiling_area", wall_length: "wall_length", wall_area: "wall_area", window_area: "window_area", door_area: "door_area" }).filter(([k]) => valid(p[k]) && p[k] > 0).map(([k, key2]) => ({ key: key2, value: p[k], unit: PDF_METRIC_UNITS[key2], scope_id: p.page_evidence.scope_id, evidence: `Architectural plan page ${p.pageNumber}: ${k} summary; AI extraction requires review.` })) : [];
    return { ...p, claims: [...direct, ...p.page_evidence?.quantities || []] };
  });
  if (native.claims.length) observations.push({ pageNumber: native.schedules[0].page, page_evidence: { kind: "opening_schedule" }, claims: native.claims });
  for (const p of nativeTables.pages) if (p.page_evidence.quantities.length) observations.push({ pageNumber: p.pageNumber, page_evidence: p.page_evidence, claims: p.page_evidence.quantities });
  for (const p of observations) for (const q of p.claims) {
    const scope2 = normalizePdfScope(q.scope_id), unit5 = PDF_METRIC_UNITS[q.key];
    if (!q.native_calculated && (nativeOpeningKeys.has(q.key) || nativeWholeTableKeys.has(q.key) || nativeTableIdentities.has(q.key + "|" + scope2) || nativeFloorTableKeys.has(q.key) && scope2 === "project")) continue;
    if (!unit5 || q.unit !== unit5 || !scope2 || !valid(q.value) || unit5 === "nr" && !Number.isInteger(q.value) || !String(q.evidence || "").trim()) {
      rejected.push({ page: p.pageNumber, key: q.key, reason: "invalid_or_unsupported_evidence" });
      continue;
    }
    const id = q.key + "|" + scope2, priority = q.document_calculated ? 3 : p.page_evidence.kind === "floor_plan" ? 1 : 2;
    const sourcePages = q.document_calculated ? q.pages : PDF_AREA_KEYS.includes(q.key) && p.document_area_source_pages ? p.document_area_source_pages : [p.pageNumber];
    const row = { ...q, scope_id: scope2, pages: [...new Set(sourcePages)], priority };
    const old = claims.get(id);
    if (!old || priority > old.priority) claims.set(id, row);
    else if (priority === old.priority) {
      old.pages = [.../* @__PURE__ */ new Set([...old.pages, ...row.pages])];
      if (Math.abs(old.value - row.value) > 1e-3) old.conflict = true;
    }
  }
  const resolved = {}, evidence = {}, overlappingScopeClaims = [], nativeIncompleteKeys = /* @__PURE__ */ new Set();
  const floorScopes = new Set(floors.map((p) => normalizePdfScope(p.page_evidence.scope_id)));
  for (const key2 of Object.keys(PDF_METRIC_UNITS)) {
    const values = [...claims.values()].filter((q) => q.key === key2), whole = values.find((q) => q.scope_id === "project");
    const isFloorScope = (q) => floorScopes.has(q.scope_id) || /^floor:-?\d+$/.test(q.scope_id);
    const floorTotals = values.filter(isFloorScope);
    if (nativeFloorTableKeys.has(key2) && [...floorScopes].some((scope2) => !floorTotals.some((q) => q.scope_id === scope2))) {
      warnings.push("Native table does not cover every selected floor for " + key2 + "; project total withheld");
      resolved[key2] = 0;
      nativeIncompleteKeys.add(key2);
      continue;
    }
    const structural = /^(?:beam|column|foundation|pedestal|.*slab)_volume$|_formwork_area$/.test(key2);
    const use = whole ? [whole] : floorTotals.length ? values.filter((q) => isFloorScope(q) || structural && q.scope_id === "roof") : values;
    for (const q of values) if (!use.includes(q)) overlappingScopeClaims.push({ key: key2, scope: q.scope_id, pages: q.pages, value: q.value, reason: whole ? "project_total_precedes_subsets" : "qualified_subset_not_added_to_floor_totals" });
    if (!use.length) continue;
    if (use.some((q) => q.conflict)) {
      warnings.push("Conflicting scheduled quantity: " + key2);
      resolved[key2] = 0;
      continue;
    }
    resolved[key2] = use.reduce((n, q) => n + q.value, 0);
    evidence[key2] = use.map(({ priority, ...q }) => q);
  }
  const names = { door_count: "doors", window_count: "windows" };
  for (const [key2, n] of Object.entries(resolved)) fields[names[key2] || key2] = n;
  const blocked = /* @__PURE__ */ new Set([...areaValidation.flatMap((a) => a.withheld_metrics || []), ...documentReview.blocked, ...nativeIncompleteKeys]);
  for (const key2 of nativeKeys) if (!nativeIncompleteKeys.has(key2)) blocked.delete(key2);
  const omitted = pdfExcludedMetricKeys(documentReview.audit?.exclusions);
  for (const key2 of omitted) if (PDF_SOURCE_MEASUREMENT_KEYS.includes(key2) && !evidence[key2]?.some((q) => q.document_calculated)) {
    blocked.add(key2);
    warnings.push("PDF explicitly unresolved source measurement: " + key2);
  }
  for (const key2 of blocked) {
    fields[names[key2] || key2] = 0;
    resolved[key2] = 0;
    delete evidence[key2];
  }
  fields.window_area = resolved.window_area ?? fields.window_area;
  fields.door_area = resolved.door_area ?? fields.door_area;
  const report = { version: 108, measurement_review_version: 1, document_review_status: reviewStatus || null, document_measurement_review: documentReview.audit, total_pages: total, selected_floor_pages: floors.map((p) => ({ page: p.pageNumber, scope: normalizePdfScope(p.page_evidence.scope_id) })), excluded_pages: excluded, failed_pages: failed, conflicts: warnings, rejected_claims: rejected, quantity_evidence: evidence, area_validation: areaValidation, withheld_area_metrics: [...new Set(areaValidation.flatMap((a) => a.withheld_metrics || []))], withheld_measurement_metrics: [...blocked].filter((k) => !PDF_AREA_KEYS.includes(k)), overlapping_scope_claims: overlappingScopeClaims, unresolved_floor_scopes: [...conflictedFloors] };
  report.source_measurement_status = pages.find((p) => p.source_measurement_status)?.source_measurement_status || null;
  report.native_opening_schedules = native.schedules.map((s) => ({ page: s.page, status: s.status, scope_id: s.scope_id, rows: s.rows.length, reason: s.reason || null }));
  report.local_pdf_recovery = pages.find((p) => p.local_pdf_recovery)?.local_pdf_recovery || null;
  report.native_first_read = pages.find((p) => p.native_first_read)?.native_first_read || null;
  report.specification_facts = readPdfSourceSpecifications({ page_results: pages });
  report.specification_conflicts = pdfSpecificationConflicts(report.specification_facts);
  for (const issue of report.specification_conflicts) warnings.push(`PDF specifications ${issue.metric}/${issue.property}: ${issue.values.join(", ")} on pages ${issue.pages.join(", ")}; source breakdown required before selecting a catalog variant.`);
  const unmeasured = omitted.filter((k) => !evidence[k]?.length);
  report.measurement_completion = {
    status: failed.length || conflictedFloors.size || blocked.size || unmeasured.length || ["failed", "pending"].includes(reviewStatus?.status) || ["failed", "pending", "partial"].includes(report.source_measurement_status?.status) ? "incomplete" : "provisional",
    unmeasured_metrics: [...new Set(unmeasured)],
    withheld_metrics: [...blocked],
    reason: "AI-extracted evidence requires source review; completed requests do not establish a complete or approved BOQ."
  };
  const nativeHeight = pages.find((p) => p.native_measurement_basis)?.native_measurement_basis?.rules?.wall_height;
  const sourcedHeight = Number.isFinite(nativeHeight?.value) && nativeHeight.value > 0 && nativeHeight.evidence?.trim() && nativeHeight.pages?.length && nativeHeight.pages.every((n) => pages.some((p) => p.pageNumber === n));
  return { ...fields, confidence: floors.length ? Math.round(floors.reduce((s, p) => s + (p.confidence || 0), 0) / floors.length * 10) / 10 : 0, wall_height: sourcedHeight ? nativeHeight.value : 3.2, wall_length_estimated: false, wall_area_estimated: false, wall_length_source: "pdf_scoped_floor_plan", wall_area_source: "pdf_scoped_floor_plan", wall_height_source: sourcedHeight ? "pdf_native_source_rule" : "project_default", total_pages: total, analyzed_pages: pages.length, failed_pages: failed, page_results: pages, detected_items: floors.flatMap((p) => (p.detected_items || []).map((i) => ({ ...i, pages: [p.pageNumber] }))), scheduled_quantities: resolved, pdf_analysis: report, notes: `PDF reconciled by page role and floor scope. ${floors.length} distinct floor plans selected. Schedules override matching scope instead of adding duplicates. AI extraction requires review. ${warnings.join("; ")}` };
}
function pdfRuleMetric(description, unit5, takeoff = null, specificationFacts = void 0) {
  const d = String(description || "").toLowerCase().replace(/[-‐‑–—]/g, " ").replace(/\s+/g, " ").trim(), rawUnit = String(unit5 || "").toLowerCase().trim().replace("\xB2", "2").replace("\xB3", "3");
  const u = { "sqm": "m2", "sq.m": "m2", "sq m": "m2", "cum": "m3", "cu.m": "m3", "cu m": "m3", "lm": "m", "lin.m": "m", "linear metre": "m", "linear meter": "m", "no.": "nr", "nos.": "nr", "each": "nr", "ea": "nr", "set": "nr" }[rawUnit] || rawUnit;
  if (/disposal|cart\s*away|haul|backfill|downlight|luminaire|light fixture|\bled\b/.test(d)) return null;
  if (hasSourceSpecificationScope(d)) return sourceSpecificationMetric(d, u, takeoff, specificationFacts);
  if (/\bformwork\b/.test(d) && /\bbeams?\b/.test(d) && /\b(?:soffits?|undersides?|bottoms?)\b/.test(d) && !/\bslabs?\b/.test(d)) return null;
  if (/\bformwork\b/.test(d)) {
    const groups = [/\b(?:foundations?|footings?|pedestals?)\b/, /\bcolumns?\b/, /\bbeams?\b/, /\bslabs?\b/].filter((re) => re.test(d));
    const slabBeamSoffit = groups.length === 2 && /\bslabs?\b/.test(d) && /\bbeams?\b/.test(d) && /\bsoffit\b/.test(d);
    if (groups.length > 1 && !slabBeamSoffit) return null;
  }
  if (/\bplaster(?:ing)?\b/.test(d) && (!/\b(?:internal|interior)\b/.test(d) || /\b(?:external|exterior|facade|ceiling|render)\b/.test(d))) return null;
  const specific = [
    [/\b(?:ceiling\s+(?:emulsion\s+)?paint|paint(?:ing)?\s+(?:to\s+)?(?:internal\s+)?ceilings?)\b/, "ceiling_paint_area", "m2"],
    [/\b(?:wet\s+(?:area|room)s?\s+wall\s+(?:tiles?|tiling)|wall\s+(?:tiles?|tiling)\s+(?:to|in)\s+wet\s+(?:area|room)s?)\b/, "wet_wall_tile_area", "m2"],
    [/\bwet\s+(?:area|room)s?\s+wall\s+waterproofing\b/, "wet_wall_waterproofing_area", "m2"],
    [/\bwet\s+(?:area|room)s?\s+floor\s+waterproofing\b/, "wet_floor_waterproofing_area", "m2"],
    [/\bkitchen\s+backsplash\b/, "backsplash_area", "m2"],
    [/\b(?:kitchen\s+base\s+cabinets?|base\s+kitchen\s+cabinets?)\b/, "kitchen_cabinet_length", "m"]
  ];
  if (/\b(?:wall|walls)\b/.test(d) && /\b(?:floor|floors|ceiling|ceilings)\b/.test(d)) return null;
  for (const [pattern, key2, expected] of specific) if (pattern.test(d)) return u === expected ? { key: key2, factor: 1 } : null;
  const operation2 = pdfCatalogScope(d);
  if (operation2) {
    const { unit: expected, ...metric } = operation2;
    if (expected === "kg" && ["ton", "tonne", "t"].includes(u)) return { ...metric, factor: 1e-3 };
    if (u === expected || expected === "nr" && ["nos", "no", "number", "nr"].includes(u)) return { ...metric, factor: 1 };
    return null;
  }
  const rules = [[/blinding/, "pcc_volume", "m3"], [/\bexcavation\b/, "excavation_volume", "m3"], [/formwork.*found/, "foundation_formwork_area", "m2"], [/formwork.*column/, "column_formwork_area", "m2"], [/formwork.*beam/, "beam_formwork_area", "m2"], [/formwork.*slab/, "slab_formwork_area", "m2"], [/reinforcement|reinforcing steel/, "rebar_kg", "kg"], [/wood.*floor|parquet/, "wood_floor_area", "m2"], [/ceramic.*floor/, "ceramic_floor_area", "m2"], [/epoxy.*floor|garage.*epoxy/, "epoxy_floor_area", "m2"], [/plaster/, "plaster_area", "m2"], [/internal wall.*paint|wall emulsion/, "paint_area", "m2"], [/gypsum.*ceiling/, "gypsum_ceiling_area", "m2"], [/glazed window|aluminium.*window/, "window_area", "m2"], [/water closet|toilet pan/, "toilet_count", "nr"], [/wash\s*basin/, "basin_count", "nr"], [/shower/, "shower_count", "nr"], [/socket/, "socket_count", "nr"], [/lighting?\s+point|light\s+point/, "light_count", "nr"], [/distribution board/, "distribution_board_count", "nr"], [/smoke detector/, "smoke_detector_count", "nr"]];
  for (const [pattern, key2, expected] of rules) if (pattern.test(d)) {
    if (expected === "kg" && ["ton", "tonne", "t"].includes(u)) return { key: key2, factor: 1e-3 };
    if (u === expected || expected === "nr" && ["nos", "no", "number", "point", "nr"].includes(u)) return { key: key2, factor: 1 };
    return null;
  }
  return null;
}
function pdfScheduledRule(takeoff, description, unit5, specificationFacts = void 0) {
  const metric = pdfRuleMetric(description, unit5, takeoff, specificationFacts);
  if (!metric) return null;
  if (nativeFinishReplacesMetric(takeoff, metric.key)) return null;
  const keys = metric.keys || [metric.key], rows = [];
  let value = 0;
  for (const key2 of keys) {
    const claims = takeoff.pdf_analysis?.quantity_evidence?.[key2], quantity = takeoff.scheduled_quantities?.[key2];
    if (!claims?.length || !valid(quantity) || claims.some((r) => r.key !== key2 || r.unit !== PDF_METRIC_UNITS[key2] || !valid(r.value) || r.unit === "nr" && !Number.isInteger(r.value) || !String(r.evidence || "").trim() || !Array.isArray(r.pages) || !r.pages.length)) return null;
    if (Math.abs(claims.reduce((n, r) => n + r.value, 0) - quantity) > 1e-3) return null;
    rows.push(...claims);
    value += quantity;
  }
  if (!pdfCatalogThicknessMatches(metric, rows) || !pdfCatalogHeightMatches(metric, rows, description)) return null;
  const specifications = metric.specificationFacts || [];
  return { quantity: value * metric.factor, metricKey: metric.key, ...metric.keys ? { metricKeys: keys } : {}, source: "pdf_schedule_evidence", measured: true, pages: [.../* @__PURE__ */ new Set([...rows.flatMap((r) => r.pages), ...specifications.map((f) => f.page)])], evidence: [...rows.map((r) => r.evidence), ...specifications.map((f) => `Source specification p.${f.page}: ${f.quote}`)].join(" | ") };
}

// src/lib/boqCatalogRate.mjs
function resolvePdfCatalogRate(item, priceLevel = "standard") {
  const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0;
  const components = ["material_rate", "labor_rate", "equipment_rate", "transport_rate"].map((k) => Number(item?.[k] || 0));
  const rates = {
    standard: positive(item?.standard_rate),
    economy: positive(item?.economy_rate),
    premium: positive(item?.premium_rate),
    component: components.every((v) => Number.isFinite(v) && v >= 0) ? positive(components.reduce((a, b) => a + b, 0)) : 0
  };
  const level = String(priceLevel || "standard").toLowerCase();
  const order = level === "economy" ? ["economy", "standard", "premium", "component"] : level === "premium" ? ["premium", "standard", "economy", "component"] : ["standard", "economy", "premium", "component"];
  for (const key2 of order) if (rates[key2] > 0) return { rate: rates[key2], source: key2 === level ? `direct_${key2}_rate` : `fallback_${key2}_rate`, peerCount: 0, missingRate: false };
  return { rate: 0, source: "rate_missing_on_catalog_item", peerCount: 0, missingRate: true };
}

// src/lib/commercialDocument.mjs
function decimal(value, message) {
  if (typeof value !== "number" && typeof value !== "string" || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(message);
  }
  const [mantissa, exponent = "0"] = Number(value).toString().toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  let digits = BigInt((whole + fraction).replace(/^\+/, ""));
  let scale = fraction.length - Number(exponent);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits, scale };
}
function roundedDivision(value, divisor) {
  return (value + divisor / 2n) / divisor;
}
var MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
function moneyFromCents(cents) {
  if (cents > MAX_CENTS) throw new Error("Quotation amount is too large.");
  return Number(cents) / 100;
}
function lineCents(item) {
  const message = "Quantity and rate must be finite non-negative numbers.";
  const quantity = decimal(item?.quantity, message), rate = decimal(item?.rate, message);
  const cents = roundedDivision(quantity.digits * rate.digits * 100n, 10n ** BigInt(quantity.scale + rate.scale));
  moneyFromCents(cents);
  return cents;
}
function quotationLineAmount(item) {
  return moneyFromCents(lineCents(item));
}
function currencyPercentage(amount, percentage) {
  const cents = lineCents({ quantity: amount, rate: 1 });
  const pct = decimal(percentage, "Percentage must be finite and non-negative.");
  return moneyFromCents(roundedDivision(cents * pct.digits, 100n * 10n ** BigInt(pct.scale)));
}
function currencySum(values) {
  return moneyFromCents(values.reduce((sum, value) => sum + lineCents({ quantity: value, rate: 1 }), 0n));
}

// src/lib/boqBudget.mjs
var boqLineAmount = (item) => {
  const valid2 = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  return quotationLineAmount({ quantity: valid2(item?.quantity), rate: valid2(item?.rate) });
};
function calculateBoqBudget(sums = {}, settings = {}) {
  const number5 = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const pct = (base, value) => currencyPercentage(base, Math.max(0, number5(value)));
  const subtotal = currencySum([number5(sums.verified), number5(sums.provisional)]);
  const overhead = pct(subtotal, settings.overheadPercentage);
  const withOverhead = currencySum([subtotal, overhead]);
  const profit = pct(withOverhead, settings.profitPercentage);
  const beforeDiscount = currencySum([withOverhead, profit]);
  const discount = pct(beforeDiscount, settings.discountPercentage);
  const taxable = quotationLineAmount({ quantity: Math.max(0, beforeDiscount - discount), rate: 1 });
  const vat = pct(taxable, settings.vatPercentage);
  return {
    subtotal,
    overhead,
    profit,
    discount,
    vat,
    total: currencySum([taxable, vat]),
    displayed: currencySum([subtotal, number5(sums.pending)])
  };
}

// src/lib/boqEvidence.mjs
function requireBoqReview(item = {}) {
  if (item.review?.confirmed === true || item.source === "manual" || item.status === "manual") return item;
  const quantityVerification = item.quantityVerification || (item.status === "measured" || item.status === "measured_rate_pending" || item.measuredFromApsStructure === true || item.verification === "verified" ? "measured" : item.status === "quantity_pending" ? "pending" : "estimated");
  const next = { ...item, quantityVerification, specificationVerification: "unconfirmed", reviewRequired: true };
  if (item.status === "measured" || item.verification === "verified") {
    next.status = "provisional_estimate";
    next.verification = "provisional";
    next.includeInCommercialTotal = false;
  }
  const note = "REVIEW REQUIRED: Confirm drawing scope, specification, quantity/unit and applicable rate. Geometry alone does not confirm the catalog description.";
  next.notes = String(item.notes || "").includes(note) ? item.notes : [item.notes, note].filter(Boolean).join(" ");
  return next;
}

// src/lib/boqPriceSelection.mjs
function clearBoqGapNote(notes) {
  return String(notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, "").replace(/The matched catalog item has no own rate\. Quantity retained; no peer or median rate borrowed\./g, "").replace(/Quantity retained without assuming a catalog specification or rate\. Not included in tender or priced budget\./g, "").trim();
}

// src/lib/pdfDefaultSpecifications.mjs
var allowed = {
  water_pipe_length: ["pipe_material", "diameter_mm"],
  waste_pipe_length: ["pipe_material", "diameter_mm"],
  ac_pipe_length: ["pipe_material", "diameter_pair_mm", "insulation_mm"],
  internal_block_area: ["thickness_mm", "block_material"],
  external_block_area: ["thickness_mm", "block_material"],
  wood_floor_area: ["floor_system"],
  epoxy_floor_area: ["floor_system"],
  terrace_floor_area: ["tile_material"],
  wet_wall_tile_area: ["tile_material"],
  backsplash_area: ["tile_material"],
  ceiling_paint_area: ["paint_system"],
  roof_waterproofing_area: ["waterproofing_system"],
  terrace_waterproofing_area: ["waterproofing_system"],
  wet_floor_waterproofing_area: ["waterproofing_system"],
  wet_wall_waterproofing_area: ["waterproofing_system"],
  door_count: ["door_system"],
  internal_door_count: ["door_system"],
  service_door_count: ["door_system"],
  entrance_door_count: ["door_system"],
  garage_door_count: ["door_system"],
  ac_count: ["capacity_tr", "unit_system"],
  kitchen_cabinet_length: ["cabinet_material"],
  kitchen_hob_hood_count: ["appliance_package"],
  kitchen_sink_count: ["fixture_system"],
  laundry_sink_count: ["fixture_system"],
  shower_count: ["fixture_system"],
  terrace_railing_length: ["railing_system"],
  driveway_area: ["paving_system"],
  landscape_area: ["landscape_system"]
};
for (const key2 of ["pcc_volume", "foundation_volume", "pedestal_volume", "column_volume", "beam_volume", "ground_slab_volume", "first_slab_volume", "roof_slab_volume"]) allowed[key2] = ["concrete_grade"];
var unit2 = (s) => ({ nos: "nr", no: "nr", each: "nr", ea: "nr", set: "nr", sqm: "m2", cum: "m3", lm: "m" })[String(s || "").toLowerCase()] || String(s || "").toLowerCase().replace("\xB2", "2").replace("\xB3", "3");
function metadata(item) {
  try {
    return typeof item?.source_reference === "string" ? JSON.parse(item.source_reference) : item?.source_reference;
  } catch {
    return null;
  }
}
function isPdfDefaultOnlyPrice(item) {
  return metadata(item)?.fallback_only === true;
}
function policy(item) {
  if (item?.is_active === false) return null;
  const p = metadata(item), keys = Object.hasOwn(allowed, p?.metric) ? allowed[p.metric] : null;
  if (p?.kind !== "pricing_default" || p.enabled !== true || !keys || unit2(item.unit) !== PDF_METRIC_UNITS[p.metric] || item.currency && item.currency !== "AED" || typeof p.label !== "string" || !p.label.trim()) return null;
  const spec = p.specification;
  if (!spec || keys.some((k) => spec[k] === void 0) || Object.keys(spec).some((k) => !keys.includes(k))) return null;
  if (Object.values(spec).some((v) => typeof v === "string" ? !v.trim() : typeof v !== "number" || !Number.isFinite(v) || v <= 0)) return null;
  if (p.metric === "ac_pipe_length") {
    const pair = String(spec.diameter_pair_mm).split("+").map(Number);
    if (pair.length !== 2 || pair.some((v) => !Number.isFinite(v) || v <= 0) || !(Number(spec.insulation_mm) > 0)) return null;
  }
  if (typeof p.rate_basis !== "string" || !p.rate_basis.trim() || p.conditions !== void 0 && typeof p.conditions !== "string") return null;
  if (p.source_required !== void 0 && (!Array.isArray(p.source_required) || p.source_required.some((k) => !keys.includes(k)))) return null;
  return p;
}
function pricedRow(item, p, rateItem, resolution, known, extra = {}) {
  const quantity = Number(item.quantity), assumed = Object.fromEntries(Object.entries(p.specification).filter(([property]) => !known.some((k) => k.property === property)));
  const disclosure = `PRICING ASSUMPTION (EDITABLE; NOT A DRAWING SPECIFICATION): ${p.label}; rate item ${rateItem.item_code}; ${p.rate_basis}.${p.conditions ? " " + p.conditions : ""}`;
  return {
    ...item,
    description: `${p.label} [assumed specification \u2014 editable]`,
    rate: resolution.rate,
    referenceRate: resolution.rate,
    amount: Math.round((quantity * resolution.rate + Number.EPSILON) * 100) / 100,
    rateMissing: false,
    rateSource: `Assumed specification; catalog ${rateItem.item_code}; ${resolution.source}`,
    source: "PDF measured quantity + editable catalog specification assumption",
    status: "provisional_estimate",
    verification: "provisional",
    specificationVerification: "assumed",
    reviewRequired: true,
    includeInCommercialTotal: false,
    defaultSpecification: { status: "applied", metric: item.pdfEvidence.metricKey, assumed, sourceSpecifications: known, catalogItemCode: rateItem.item_code, catalogUnit: rateItem.unit, catalogRate: resolution.rate, rateBasis: p.rate_basis, policy: p, originalDescription: item.description, ...extra },
    completion: { code: "assumed_specification_review_required", required_information: ["Confirm or edit the assumed specification and its budget rate."] },
    notes: [clearBoqGapNote(item.notes), disclosure].filter(Boolean).join(" ")
  };
}
function doorParts(item, takeoff, p, catalog, priceLevel) {
  if (!p.opening_components) return null;
  const native = nativeOpeningEvidence(takeoff.page_results || [], normalizePdfScope);
  const rows = native.schedules.filter((s) => s.status === "read").flatMap((s) => s.rows.filter((r) => ["door", "garage_door"].includes(r.kind)));
  const count = native.claims.filter((c) => c.key === "door_count").reduce((n, c) => n + c.value, 0);
  if (!native.claims.length || native.schedules.some((s) => s.status !== "read") || count !== Number(item.quantity) || rows.length !== count) return null;
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const list2 = grouped.get(row.kind) || [];
    list2.push(row);
    grouped.set(row.kind, list2);
  }
  const result = [];
  for (const [kind, group] of grouped) {
    const config2 = p.opening_components[kind], matches = catalog.filter((c) => c.item_code === config2?.item_code && c.is_active !== false);
    if (!config2 || matches.length !== 1 || unit2(matches[0].unit) !== "nr") return null;
    const rateItem = matches[0], rate = resolvePdfCatalogRate(rateItem, priceLevel);
    if (rate.missingRate) return null;
    const pages = [...new Set(group.flatMap((r) => r.dimension_pages || [r.page]))];
    const basis = `Source opening table ${kind}: ${group.map((r) => r.source_row).join("; ")}. Count allocated from complete source table, not a pricing assumption.`;
    const child = {
      ...item,
      id: `${item.id || item.itemCode}:${kind}`,
      itemCode: `${item.itemCode}-${kind.toUpperCase()}`,
      quantity: group.length,
      pdfEvidence: { ...item.pdfEvidence, pages, basis, sourceAllocation: { kind, count: group.length, parentQuantity: count, tags: group.map((r) => r.id) } }
    };
    const partPolicy = { ...p, label: config2.label, specification: { door_system: config2.door_system }, rate_basis: config2.rate_basis || p.rate_basis, conditions: config2.conditions || p.conditions };
    const scaled = group.map((r) => Math.max(1, config2.reference_area_m2 > 0 ? r.width * r.height / config2.reference_area_m2 : 1));
    if (new Set(scaled.map((v) => v.toFixed(6))).size > 1) {
      for (let i = 0; i < group.length; i++) {
        const single = { ...child, id: child.id + ":" + group[i].id, itemCode: child.itemCode + "-" + group[i].id, quantity: 1, pdfEvidence: { ...child.pdfEvidence, sourceAllocation: { kind, count: 1, parentQuantity: count, tags: [group[i].id] } } };
        result.push(pricedRow(single, partPolicy, rateItem, { ...rate, rate: Math.round(rate.rate * scaled[i] * 100) / 100 }, [], { openingKind: kind, sizeFactor: scaled[i] }));
      }
    } else result.push(pricedRow(child, partPolicy, rateItem, { ...rate, rate: Math.round(rate.rate * scaled[0] * 100) / 100 }, [], { openingKind: kind, sizeFactor: scaled[0] }));
  }
  return result;
}
function applyPdfDefaultSpecifications(items, takeoff, catalog = [], priceLevel = "standard") {
  if (!takeoff?.pdf_analysis) return items;
  const facts = readPdfSourceSpecifications(takeoff), conflicts = pdfSpecificationConflicts(facts), byMetric = /* @__PURE__ */ new Map();
  const sourceText = (takeoff.page_results || []).flatMap((p) => p.native_text_evidence?.status === "readable" ? p.native_text_evidence.spans.map((s) => s.text) : []).join(" ");
  const hydronicSource = /fan[- ]?coil|chilled[- ]water|\bCHW\d*\b/i.test(sourceText);
  for (const rateItem of catalog) {
    const p = policy(rateItem);
    if (!p) continue;
    const entries = byMetric.get(p.metric) || [];
    entries.push({ p, rateItem });
    byMetric.set(p.metric, entries);
  }
  return items.flatMap((item) => {
    const key2 = item.pdfEvidence?.metricKey;
    if (item.review?.confirmed || item.source === "manual" || item.defaultSpecification?.rateOverridden || item.defaultSpecification?.status && item.defaultSpecification.status !== "applied" || !(Number(item.quantity) > 0) || Number(item.rate) > 0 || unit2(item.unit) !== PDF_METRIC_UNITS[key2]) return [item];
    if (items.filter((i) => i.quantity > 0 && (i.pdfEvidence?.metricKeys || [i.pdfEvidence?.metricKey]).includes(key2)).length !== 1 || conflicts.some((f) => f.metric === key2)) return [item];
    if (hydronicSource && ["ac_count", "ac_pipe_length"].includes(key2)) return [item];
    const source2 = facts.filter((f) => f.metric === key2), known = resolvedPdfSpecifications(takeoff, key2, facts);
    const policies = (byMetric.get(key2) || []).filter(({ p: p2 }) => !source2.some((f) => !known.some((k) => k.property === f.property)) && !known.some((k) => p2.specification[k.property] !== k.value) && !(p2.source_required || []).some((prop) => !known.some((k) => k.property === prop)));
    if (policies.length !== 1) return [item];
    const { p, rateItem } = policies[0], rate = resolvePdfCatalogRate(rateItem, priceLevel);
    if (rate.missingRate) return [item];
    const claims = takeoff.pdf_analysis.quantity_evidence?.[key2], quantity = Number(item.quantity), expected = PDF_METRIC_UNITS[key2];
    if (!claims?.length || claims.some((c) => c.key !== key2 || c.unit !== expected || !Number.isFinite(c.value) || c.value < 0 || !c.evidence?.trim() || !c.pages?.length) || Math.abs(claims.reduce((n, c) => n + c.value, 0) - quantity) > 1e-3) return [item];
    if (expected === "nr" && !Number.isInteger(quantity)) return [item];
    if (["water_pipe_length", "waste_pipe_length", "ac_pipe_length"].includes(key2) && !source2.length && claims.some((c) => /\b(?:dn|dia(?:meter)?)\s*[:=]?\s*\d+|\b(?:ppr|u?pvc|cpvc|hdpe|copper|steel|pex)\b|\d\s*mm|[øØ⌀]|\d\s*\/\s*\d/i.test(c.evidence))) return [item];
    if (key2 === "door_count" && p.opening_components) {
      const parts = doorParts(item, takeoff, p, catalog, priceLevel);
      if (parts) return parts;
      if (claims.some((c) => /garage[_ ]door|roller shutter|overhead door/i.test(c.evidence))) return [item];
    }
    return [pricedRow(item, p, rateItem, rate, known)];
  });
}

// src/lib/pdfOperationPricing.mjs
var unit3 = (v) => ({ "m\xB2": "m2", sqm: "m2", "m\xB3": "m3", cum: "m3", nos: "nr", no: "nr", each: "nr", point: "nr", lm: "m" })[String(v).toLowerCase()] || String(v).toLowerCase();
function operationRateContract(item) {
  try {
    const r = typeof item?.source_reference === "string" ? JSON.parse(item.source_reference) : item?.source_reference;
    return r?.kind === "construction_operation_rate" && r.version === 1 && r.enabled === true ? r : null;
  } catch {
    return null;
  }
}
function pdfOperationProfile(operation2) {
  const family2 = operation2.family, d = String(operation2.sourceDescription || "").toLowerCase().replace(/[-–]/g, " "), p = { family: family2 };
  const one = (name2, matches) => {
    const xs = [...new Set(matches)];
    if (xs.length === 1) p[name2] = xs[0];
  };
  if (family2 === "pipe") {
    one("material", [...d.matchAll(/\b(ppr|upvc|pvc|cpvc|hdpe|copper|pex)\b/g)].map((m) => m[1] === "pvc" ? "upvc" : m[1]));
    one("diameter_mm", [...d.matchAll(/(?:\bdn\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*mm\b)/g)].map((m) => Number(m[1] || m[2])));
    p.insulated = /\binsulated\b/.test(d) && !/\buninsulated\b/.test(d);
  }
  if (family2 === "floor" || family2 === "skirting") {
    one("material", ["porcelain", "lvt", "terrazzo", "ceramic", "mdf", "spc", "marble", "granite", "wood", "epoxy", "resin"].filter((m) => new RegExp("\\b" + m + "\\b").test(d)));
    p.anti_slip = /anti\s+slip/.test(d);
    if (/glue\s+down/.test(d)) p.installation_method = "glue_down";
    else if (/\bclick\b/.test(d)) p.installation_method = "click";
  }
  if (family2 === "ceiling-board") {
    p.material = "gypsum";
    p.moisture_resistant = /moisture\s+resistant/.test(d);
    p.fire_rated = /fire\s+rated/.test(d);
  }
  if (family2 === "ceiling-paint") p.system = "ceiling_paint";
  if (family2 === "external-paint") p.system = "exterior_weather_paint";
  if (family2 === "fixed-glazing" && /fixed internal glass/.test(d)) {
    p.system = "fixed_internal_glass";
    const m = d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
    if (m) p.glass_thickness_mm = Number(m[1]);
  }
  if (family2 === "window-set" && /aluminium double\s+glazed/.test(d)) {
    p.material = "aluminium";
    p.glazing = "double";
  }
  if (family2 === "door-set") {
    one("material", ["timber", "metal", "glazed", "glass"].filter((m) => new RegExp("\\b" + m + "\\b").test(d)));
    p.double_leaf = /\bdouble\b/.test(d);
    p.external = /\bexternal\b/.test(d);
    const dims = d.match(/\b(\d+\.\d+)\s*x\s*(\d+\.\d+)/);
    if (dims) {
      p.width_m = Number(dims[1]);
      p.height_m = Number(dims[2]);
    }
  }
  if (family2 === "screed") {
    const m = d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
    if (m) p.thickness_mm = Number(m[1]);
  }
  if (family2 === "duct-sheet") p.material = /\bgi\b|galvani[sz]ed/.test(d) ? "gi" : /stainless/.test(d) ? "stainless" : null;
  if (family2 === "duct-insulation") {
    const m = d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
    if (m) p.thickness_mm = Number(m[1]);
  }
  if (["electrical", "electrical-fixture", "electrical-point", "equipment", "fixture", "railing", "stair-finish"].includes(family2)) {
    const types = [["fan_coil", /fan\s+coil/], ["extract_fan", /extract fans?/], ["supply_diffuser", /supply diffusers?/], ["return_grille", /return grilles?/], ["data", /data outlets?/], ["emergency_light", /emergency lights?/], ["exit_sign", /exit signs?/], ["led_light", /led lights?|led light fittings?/], ["socket", /socket/], ["distribution_board", /distribution board/], ["smoke_detector", /smoke detector/], ["toilet", /toilet pan|water closet/], ["wash_basin", /wash basin/], ["shower", /shower/], ["switch", /light switches?/], ["water_heater", /water heater/], ["floor_drain", /floor drain/], ["sink", /\bsink\b/], ["handrail", /handrail/], ["guardrail", /guardrail/], ["stair_finish", /stair finish/]];
    one("type", types.filter(([, re]) => re.test(d)).map(([name2]) => name2));
    const capacity = d.match(/\b(\d+(?:\.\d+)?)\s*kw\b/);
    if (capacity) p.capacity_kw = Number(capacity[1]);
  }
  if (family2 === "electrical-route") {
    if (/cable tray/.test(d)) {
      p.type = "cable_tray";
      const m = d.match(/(\d+)\s*x\s*(\d+)\s*mm/);
      if (m) {
        p.width_mm = +m[1];
        p.depth_mm = +m[2];
      }
    } else if (/conduit/.test(d)) {
      p.type = "conduit";
      const m = d.match(/(\d+)\s*mm/);
      if (m) p.diameter_mm = +m[1];
    } else if (/power cable/.test(d)) {
      p.type = "power_cable";
      const m = d.match(/(\d+)\s*(?:c\s*x|x)\s*(\d+(?:\.\d+)?)\s*mm2/);
      if (m) {
        p.cores = +m[1];
        p.area_mm2 = +m[2];
      }
    }
  }
  return p;
}
function bindPdfOperationRates(items, catalog, priceLevel = "standard") {
  const configured = (catalog || []).filter((p) => p.is_active !== false).map((p) => ({ p, c: operationRateContract(p) })).filter((x) => x.c);
  const codes = new Set(configured.map(({ p }) => p.item_code));
  return items.filter((item) => !(codes.has(item.itemCode) && !(item.quantity > 0) && item.source !== "manual")).map((item) => {
    const op = item.pdfEvidence?.operation;
    if (!op || !(item.quantity > 0) || item.rate > 0 && !item.rateMissing || item.catalogSelection || item.review?.confirmed) return item;
    const profile = pdfOperationProfile(op), matches = [];
    for (const { p: p2, c: c2 } of configured) {
      if (!c2.match || c2.match.family !== profile.family || !c2.rate_basis || !c2.conditions || !c2.provenance || p2.currency !== "AED") continue;
      const entries = Object.entries(c2.match);
      if (entries.some(([k, v]) => !Object.hasOwn(profile, k) || profile[k] !== v)) continue;
      if (Object.entries(c2.assumed_specification || {}).some(([k, v]) => Object.hasOwn(profile, k) && profile[k] !== v)) continue;
      let factor3 = unit3(p2.unit) === unit3(item.unit) ? 1 : null;
      if (c2.unit_basis === "opening_area" && unit3(p2.unit) === "m2" && unit3(item.unit) === "nr" && profile.width_m > 0 && profile.height_m > 0) factor3 = profile.width_m * profile.height_m;
      if (c2.unit_basis === "area_from_thickness" && unit3(p2.unit) === "m2" && unit3(item.unit) === "m3" && profile.thickness_mm > 0) factor3 = 1e3 / profile.thickness_mm;
      if (!(factor3 > 0)) continue;
      matches.push({ p: p2, c: c2, factor: factor3, specificity: entries.length });
    }
    if (!matches.length) return item;
    const max = Math.max(...matches.map((m) => m.specificity)), best = matches.filter((m) => m.specificity === max);
    if (best.length !== 1) return { ...item, operationPricing: { status: "ambiguous", candidate_codes: best.map((m) => m.p.item_code) } };
    const { p, c, factor: factor2 } = best[0], resolution = resolvePdfCatalogRate(p, priceLevel);
    const section = { sectionCode: p.section_code, section: p.category, category: p.category };
    if (resolution.missingRate) return { ...item, ...section, operationPricing: { status: "catalog_rate_missing", candidate_codes: [p.item_code], required_information: c.required_information || [] } };
    const rate = resolution.rate * factor2;
    return {
      ...item,
      ...section,
      rate,
      referenceRate: rate,
      amount: Number(item.quantity) * rate,
      rateMissing: false,
      status: "provisional_estimate",
      verification: "provisional",
      reviewRequired: true,
      includeInCommercialTotal: false,
      rateSource: `Operation catalog ${p.item_code}: ${resolution.source}`,
      source: "PDF source operation + specification-matched budget catalog",
      operationPricing: { status: "priced_provisional", catalog_code: p.item_code, profile, match: c.match, catalog_unit: p.unit, catalog_rate: resolution.rate, rate_factor: factor2, rate_basis: c.rate_basis, conditions: c.conditions, provenance: c.provenance, assumed_specification: c.assumed_specification || {}, required_information: c.required_information || [] },
      notes: [String(item.notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, ""), `OPERATION RATE ${p.item_code}: ${resolution.rate} AED/${p.unit} \xD7 ${factor2} = ${rate} AED/${item.unit}. ${c.rate_basis}. Conditions: ${c.conditions}. Provisional editable budget only; not a supplier quote or tender approval.`].join(" ")
    };
  });
}

// src/lib/pdfBoqCoverage.mjs
function planPdfCatalogBindings(takeoff, candidates) {
  const byMetric = /* @__PURE__ */ new Map(), byCode = /* @__PURE__ */ new Map();
  const specificationFacts = readPdfSourceSpecifications(takeoff);
  const signatures = /* @__PURE__ */ new Map(), conflictingCodes = /* @__PURE__ */ new Set();
  for (const item of candidates || []) {
    if (!item || item.is_active === false || isPdfDefaultOnlyPrice(item) || operationRateContract(item)) continue;
    const code = String(item.item_code || item.itemCode || "").trim().toUpperCase();
    if (!code) continue;
    const signature = JSON.stringify([String(item.description || "").trim().toLowerCase(), String(item.unit || "").trim().toLowerCase()]);
    if (signatures.has(code) && signatures.get(code) !== signature) conflictingCodes.add(code);
    signatures.set(code, signature);
    const evidence = pdfScheduledRule(takeoff, item.description, item.unit, specificationFacts);
    if (!evidence || evidence.quantity <= 0) continue;
    byCode.set(code, evidence);
    for (const key2 of evidence.metricKeys || [evidence.metricKey]) {
      const group = byMetric.get(key2) || /* @__PURE__ */ new Map();
      group.set(code, evidence);
      byMetric.set(key2, group);
    }
  }
  const bindings = /* @__PURE__ */ new Map(), warnings = [];
  for (const [metric, group] of byMetric) {
    if (group.size !== 1 || conflictingCodes.has([...group.keys()][0])) {
      warnings.push(`PDF quantity ${metric} has ${group.size === 1 ? "inconsistent definitions for catalog code" : "competing catalog items"} (${[...group.keys()].join(", ")}). Specification selection required; quantity was not repeated across them.`);
    }
  }
  for (const [code, evidence] of byCode) if (!conflictingCodes.has(code) && (evidence.metricKeys || [evidence.metricKey]).every((k) => byMetric.get(k)?.size === 1)) bindings.set(code, evidence);
  return { bindings, warnings };
}
function planPdfCatalogRules(takeoff, rules, candidates) {
  const next = [...rules || []], codes = new Set(next.map((r) => String(r.item_code || "").trim().toUpperCase()));
  const allActive = (candidates || []).filter((i) => i && i.is_active !== false);
  const active = allActive.filter((i) => !isPdfDefaultOnlyPrice(i));
  const configuredCodes = new Set(active.filter((i) => {
    const code = String(i.item_code || i.itemCode || "").trim().toUpperCase();
    const section = String(i.section_code || "").trim();
    return codes.has(code) || Boolean(section && !/^unassigned$/i.test(section)) || Boolean(String(i.source_name || "").trim()) || !resolvePdfCatalogRate(i).missingRate;
  }).map((i) => String(i.item_code || i.itemCode || "").trim().toUpperCase()));
  const eligible = active.filter((i) => configuredCodes.has(String(i.item_code || i.itemCode || "").trim().toUpperCase()));
  const plan = planPdfCatalogBindings(takeoff, eligible);
  const ignored = active.length - eligible.length;
  if (ignored) plan.warnings.push(`PDF catalog: ${ignored} unconfigured scope entries have no section, source, own catalog rate or active formula rule; they were not treated as competing commercial items. No catalog records were changed.`);
  for (const item of eligible) {
    const code = String(item?.item_code || "").trim().toUpperCase();
    if (!plan.bindings.has(code) || codes.has(code)) continue;
    next.push({
      item_code: item.item_code,
      section_code: item.section_code,
      formula_type: "manual",
      rule_name: "PDF evidence: existing catalog item",
      notes: "Explicit PDF operation matched to a unique existing catalog item; review required."
    });
    codes.add(code);
  }
  return { ...plan, rules: next, catalogAudit: { activeEntries: allActive.length, defaultOnlyEntries: allActive.length - active.length, commercialCandidates: eligible.length, unconfiguredEntries: ignored } };
}
var operations = {
  excavation_volume: ["02", "Site Works", "Excavation"],
  pcc_volume: ["03", "Concrete Works", "Concrete blinding \u2014 grade requires confirmation"],
  foundation_volume: ["03", "Concrete Works", "Foundation concrete \u2014 grade requires confirmation"],
  pedestal_volume: ["03", "Concrete Works", "Pedestal concrete \u2014 grade requires confirmation"],
  column_volume: ["03", "Concrete Works", "Column concrete \u2014 grade requires confirmation"],
  beam_volume: ["03", "Concrete Works", "Beam concrete \u2014 grade requires confirmation"],
  ground_slab_volume: ["03", "Concrete Works", "Ground slab concrete \u2014 grade requires confirmation"],
  first_slab_volume: ["03", "Concrete Works", "First floor slab concrete \u2014 grade requires confirmation"],
  roof_slab_volume: ["03", "Concrete Works", "Roof slab concrete \u2014 grade requires confirmation"],
  rebar_kg: ["03", "Concrete Works", "Reinforcement \u2014 scheduled mass"],
  foundation_formwork_area: ["03", "Concrete Works", "Foundation formwork"],
  column_formwork_area: ["03", "Concrete Works", "Column formwork"],
  beam_formwork_area: ["03", "Concrete Works", "Beam formwork"],
  slab_formwork_area: ["03", "Concrete Works", "Slab formwork"],
  external_block_area: ["04", "Masonry Works", "External blockwork \u2014 specification requires confirmation"],
  internal_block_area: ["04", "Masonry Works", "Internal blockwork \u2014 specification requires confirmation"],
  wood_floor_area: ["07", "Finishes", "Wood floor finish"],
  ceramic_floor_area: ["07", "Finishes", "Ceramic floor finish"],
  epoxy_floor_area: ["07", "Finishes", "Epoxy floor finish"],
  terrace_floor_area: ["07", "Finishes", "Terrace floor finish \u2014 specification requires confirmation"],
  plaster_area: ["07", "Finishes", "Plaster"],
  paint_area: ["07", "Finishes", "Wall paint"],
  gypsum_ceiling_area: ["07", "Finishes", "Gypsum ceiling"],
  window_area: ["06", "Doors and Windows", "Windows \u2014 measured opening area; specification requires confirmation"],
  door_count: ["06", "Doors and Windows", "Door sets \u2014 material and type require confirmation"],
  internal_door_count: ["06", "Doors and Windows", "Internal door sets \u2014 material requires confirmation"],
  service_door_count: ["06", "Doors and Windows", "External service door sets \u2014 specification requires confirmation"],
  entrance_door_count: ["06", "Doors and Windows", "Entrance door sets \u2014 specification requires confirmation"],
  garage_door_count: ["06", "Doors and Windows", "Garage door sets \u2014 specification requires confirmation"],
  kitchen_hob_hood_count: ["07", "Finishes", "Kitchen hob and hood package \u2014 specification requires confirmation"],
  toilet_count: ["08", "Plumbing", "Toilet pans"],
  basin_count: ["08", "Plumbing", "Wash basins"],
  shower_count: ["08", "Plumbing", "Showers"],
  water_pipe_length: ["08", "Plumbing", "Water pipe \u2014 diameter and material require confirmation"],
  waste_pipe_length: ["08", "Plumbing", "Waste pipe \u2014 diameter and material require confirmation"],
  light_count: ["09", "Electrical", "Lighting points \u2014 fixture types require confirmation"],
  socket_count: ["09", "Electrical", "Socket points"],
  distribution_board_count: ["09", "Electrical", "Distribution boards"],
  ac_count: ["10", "HVAC", "Air conditioning units \u2014 capacities require confirmation"],
  ac_pipe_length: ["10", "HVAC", "Air conditioning pipe \u2014 specification requires confirmation"],
  smoke_detector_count: ["11", "Fire Fighting", "Smoke detectors"],
  kitchen_cabinet_length: ["07", "Finishes", "Kitchen cabinetry \u2014 specification requires confirmation"],
  terrace_railing_length: ["12", "External Works", "Terrace railing \u2014 specification requires confirmation"],
  roof_waterproofing_area: ["05", "Waterproofing", "Roof waterproofing"],
  terrace_waterproofing_area: ["05", "Waterproofing", "Terrace waterproofing"],
  wet_floor_waterproofing_area: ["05", "Waterproofing", "Wet area floor waterproofing"],
  wet_wall_waterproofing_area: ["05", "Waterproofing", "Wet area wall waterproofing"],
  wet_wall_tile_area: ["07", "Finishes", "Wet area wall tiles"],
  ceiling_paint_area: ["07", "Finishes", "Ceiling paint"],
  backsplash_area: ["07", "Finishes", "Kitchen backsplash"],
  driveway_area: ["12", "External Works", "Driveway \u2014 paving specification requires confirmation"],
  landscape_area: ["13", "Landscaping", "Landscaping \u2014 planting specification requires confirmation"],
  kitchen_sink_count: ["08", "Plumbing", "Kitchen sinks"],
  laundry_sink_count: ["08", "Plumbing", "Laundry sinks"]
};
function retainUnboundPdfQuantities(items, takeoff) {
  if (!takeoff.pdf_analysis) return { items, warnings: [] };
  const next = [...items], warnings = [];
  const doorKeys = ["internal_door_count", "service_door_count", "entrance_door_count", "garage_door_count"];
  const doorBreakdown = doorKeys.filter((k) => Number.isFinite(takeoff.scheduled_quantities?.[k]));
  const completeDoors = doorBreakdown.length > 0 && Math.abs(doorBreakdown.reduce((n, k) => n + takeoff.scheduled_quantities[k], 0) - (takeoff.scheduled_quantities?.door_count ?? -1)) < 1e-3;
  const bound = new Set(items.filter((i) => i.quantity > 0).flatMap((i) => i.pdfEvidence?.metricKeys || [i.pdfEvidence?.metricKey]).filter(Boolean));
  for (const [key2, [sectionCode, section, description]] of Object.entries(operations)) {
    if (nativeFinishReplacesMetric(takeoff, key2)) continue;
    if (key2 === "door_count" && completeDoors) continue;
    if (doorKeys.includes(key2) && Number.isFinite(takeoff.scheduled_quantities?.door_count) && !completeDoors) continue;
    const quantity = takeoff.scheduled_quantities?.[key2];
    const claims = takeoff.pdf_analysis.quantity_evidence?.[key2];
    if (bound.has(key2) || !Number.isFinite(quantity) || quantity <= 0 || !claims?.length) continue;
    const unit5 = PDF_METRIC_UNITS[key2];
    if (claims.some((c) => c.key !== key2 || c.unit !== unit5 || !Number.isFinite(c.value) || c.value < 0 || !c.evidence?.trim()) || Math.abs(claims.reduce((n, c) => n + c.value, 0) - quantity) > 1e-3) continue;
    const pages = [...new Set(claims.flatMap((c) => c.pages || []))];
    const basis = claims.map((c) => c.evidence).join(" | ");
    const itemCode = `PDF-${key2.toUpperCase()}`;
    if (next.some((i) => i.itemCode === itemCode)) continue;
    next.push({
      itemCode,
      sectionCode,
      section,
      category: section,
      subCategory: "",
      description,
      unit: unit5,
      quantity,
      materialRate: 0,
      laborRate: 0,
      equipmentRate: 0,
      transportRate: 0,
      rate: 0,
      referenceRate: 0,
      amount: 0,
      rateMissing: true,
      rateSource: "unavailable_specification_or_catalog_match",
      status: "measured_rate_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      quantityVerification: "pdf_evidence_requires_review",
      reviewRequired: true,
      quantityBasis: "pdf_schedule_evidence",
      quantitySource: "pdf_schedule_evidence",
      source: "PDF evidence - rate and specification pending",
      pdfEvidence: { metricKey: key2, pages, basis },
      notes: `PDF EVIDENCE (AI; REVIEW REQUIRED): pages ${pages.join(", ")}; ${basis}. Quantity retained without assuming a catalog specification or rate. Not included in tender or priced budget.`
    });
    warnings.push(`PDF quantity ${key2} retained as an unpriced row; confirm specification and rate.`);
  }
  for (const finish of [...nativePdfFinishLedger(takeoff) || [], ...nativePdfSourceOperationLedger(takeoff)]) {
    if (bound.has(finish.metricKey)) continue;
    const itemCode = `PDF-${finish.family.toUpperCase()}-${finish.sourceCode.toUpperCase()}`;
    if (next.some((i) => i.itemCode === itemCode)) continue;
    const basis = finish.basis || `Original PDF ${finish.family} finish ${finish.sourceCode}: ${finish.sourceDescription}; rooms ${finish.rooms.join(", ")}. Area from checked clear room geometry; separate source finish codes, no merged generic rate.`;
    const hvacPipe = finish.family === "pipe-insulation" || finish.family === "pipe" && /fcu|chilled|\bchw/i.test(finish.sourceDescription);
    const section = hvacPipe ? ["10", "HVAC"] : ["pipe", "fixture"].includes(finish.family) ? ["08", "Plumbing"] : finish.family.startsWith("electrical") ? ["09", "Electrical"] : ["equipment", "duct-sheet", "duct-insulation"].includes(finish.family) ? ["10", "HVAC"] : ["door-set", "window-set"].includes(finish.family) ? ["06", "Doors and Windows"] : ["07", "Finishes"];
    next.push({
      itemCode,
      sectionCode: section[0],
      section: section[1],
      category: section[1],
      subCategory: finish.family,
      description: `${finish.sourceCode} \u2014 ${finish.sourceDescription}`,
      unit: finish.unit,
      quantity: finish.quantity,
      materialRate: 0,
      laborRate: 0,
      equipmentRate: 0,
      transportRate: 0,
      rate: 0,
      referenceRate: 0,
      amount: 0,
      rateMissing: true,
      rateSource: "unavailable_specification_or_catalog_match",
      status: "measured_rate_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      quantityVerification: "pdf_evidence_requires_review",
      reviewRequired: true,
      quantityBasis: "pdf_schedule_evidence",
      quantitySource: "pdf_schedule_evidence",
      source: "Native PDF source schedule \u2014 own rate required",
      pdfEvidence: { metricKey: finish.metricKey, pages: finish.pages, basis, operation: { family: finish.family, sourceCode: finish.sourceCode, sourceDescription: finish.sourceDescription, ...finish.instances ? { instances: finish.instances } : {} } },
      notes: `PDF SOURCE FINISH; REVIEW REQUIRED. ${basis} Select the applicable rate for this specific finish before pricing.`
    });
    warnings.push(`PDF source finish ${finish.sourceCode} (${finish.family}) retained with measured quantity and no assumed generic rate.`);
  }
  return { items: next, warnings };
}

// src/lib/takeoffSource.mjs
function takeoffBoqIssue(takeoff) {
  if (!takeoff) return "";
  const status = String(takeoff.extraction_status || takeoff.raw_result?.extraction_status || "").toLowerCase();
  const cad = !!(takeoff.aps_urn || takeoff.apsUrn) || /autodesk|aps/i.test(takeoff.source || "") || /\.(dwg|dxf|ifc|rvt)$/i.test(takeoff.document_name || "");
  const legacyPending = /Autodesk translation completed[\s\S]*geometry quantities have not been extracted yet/i.test(takeoff.notes || "");
  if (legacyPending || cad && (["translation-complete", "geometry-ready-analysis-pending"].includes(status) || ["pending", "processing", "extracting"].includes(String(takeoff.geometry_status || "").toLowerCase())))
    return "BOQ generation stopped: CAD conversion is complete, but quantity extraction is incomplete. Complete geometry quantity extraction before pricing. The saved draft has been preserved.";
  return "";
}
function assertTakeoffReady(takeoff) {
  const issue = takeoffBoqIssue(takeoff);
  if (issue) throw Object.assign(new Error(issue), { code: "CAD_EXTRACTION_INCOMPLETE" });
}
function bindBoqSource(boq, takeoff = boq?.takeoff, projectId = boq?.projectId) {
  if (!takeoff) return boq;
  assertTakeoffSource(takeoff, null, projectId);
  const savedProject = boq?.projectId || boq?.project_id || boq?.takeoff?.project_id || boq?.takeoff?.projectId;
  if (savedProject && projectId && savedProject !== projectId) {
    throw new Error("BOQ belongs to another project. Generate a new BOQ for the current project.");
  }
  const previous = boq?.boqSource;
  if (previous?.documentId && takeoff.document_id && previous.documentId !== takeoff.document_id) {
    throw new Error("BOQ source belongs to another drawing. Generate a new BOQ from the selected analysis.");
  }
  if (boq?.takeoff?.document_id && takeoff !== boq.takeoff && !savedBoqMatchesTakeoff(boq, takeoff)) {
    throw new Error("BOQ source belongs to an earlier drawing or analysis.");
  }
  if (!takeoff.document_id) return boq;
  return { ...boq, takeoff, boqSource: {
    ...previous,
    documentId: takeoff.document_id,
    name: takeoff.document_name || previous?.name || "",
    analyzedAt: takeoff.analyzed_at,
    recordedBy: previous?.recordedBy || 157
  } };
}
function assertTakeoffSource(takeoff, documentId, projectId) {
  if (!takeoff) return;
  const owner = takeoff.project_id || takeoff.projectId;
  if (owner && projectId && owner !== projectId) {
    throw new Error("Saved analysis belongs to another project. Analyze the selected drawing before generating BOQ.");
  }
  if (documentId && takeoff.document_id !== documentId) {
    throw new Error("The selected drawing has no matching quantity takeoff. The saved analysis belongs to another drawing. Open Drawings and run Analyze for the selected file before generating BOQ. A 3D preview alone does not create a quantity takeoff.");
  }
  assertTakeoffReady(takeoff);
}
function savedBoqMatchesTakeoff(boq, takeoff) {
  if (takeoffBoqIssue(takeoff) || takeoffBoqIssue(boq?.takeoff)) return false;
  if (!takeoff) return true;
  const currentProject = takeoff.project_id || takeoff.projectId;
  const savedProjects = [boq?.projectId, boq?.project_id, boq?.takeoff?.project_id, boq?.takeoff?.projectId].filter(Boolean);
  if (currentProject && savedProjects.some((id) => id !== currentProject)) return false;
  const documentId = boq?.boqSource?.documentId || boq?.takeoff?.document_id;
  if (takeoff.document_id && documentId !== takeoff.document_id) return false;
  const previous = boq?.boqSource?.analyzedAt || boq?.takeoff?.analyzed_at;
  return !previous || !takeoff.analyzed_at || previous === takeoff.analyzed_at;
}

// src/lib/rasterMeasurementAudit.mjs
var round3 = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
var finite2 = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
var areaKeys = ["floor_area", "ceiling_area"];
function explicitHeight(t) {
  if (t.wall_height_source === "user_confirmed_printed_dimension" && finite2(t.wall_height) && t.wall_height > 0) return t.wall_height;
  const notes = String(t.notes || "");
  if (/varying|variable|sloping|stepped|double.height/i.test(notes)) return null;
  const values = [...notes.matchAll(/\b(?:wall|room|internal|enclosed)?\s*heights?\s*(?:=|:|is|of|at)?\s*(\d+(?:\.\d+)?)\s*m\b|\b(\d+(?:\.\d+)?)\s*m\s*(?:height|high)\b/gi)].map((m) => Number(m[1] || m[2]));
  if (finite2(t.wall_height) && t.wall_height > 0 && typeof t.wall_height_evidence === "string" && t.wall_height_evidence.trim()) values.push(t.wall_height);
  if (finite2(t.wall_height) && t.wall_height > 0 && /source|printed|explicit|measured/i.test(t.wall_height_source || "") && !/default|assum/i.test(t.wall_height_source || "")) values.push(t.wall_height);
  return values.length && values.every((v) => v > 0 && v === values[0]) ? values[0] : null;
}
function operation(t, key2) {
  const page = t.page_evidence || {}, rows = (page.quantities || []).filter((q) => q.key === key2);
  const totals = rows.filter((q) => ["project", page.scope_id, page.drawing_id].includes(q.scope_id));
  const selected = totals.length ? totals : rows;
  if (!selected.length || selected.some((q) => !finite2(q.value) || !q.evidence?.trim() || q.unit !== (/count$/.test(key2) ? "nr" : "m2")) || new Set(selected.map((q) => q.value)).size !== 1) return null;
  return selected[0].value;
}
function netWall(t, gross) {
  const doors = operation(t, "door_count"), windows = operation(t, "window_count");
  if (!Number.isInteger(doors) || !Number.isInteger(windows)) return null;
  const da = doors === 0 ? 0 : operation(t, "door_area"), wa = windows === 0 ? 0 : operation(t, "window_area");
  if (doors === 0 && operation(t, "door_area") > 0 || windows === 0 && operation(t, "window_area") > 0) return null;
  if (!finite2(da) || !finite2(wa) || doors > 0 && da <= 0 || windows > 0 && wa <= 0) return null;
  let extra = 0;
  if (doors > 0) {
    const internal = operation(t, "internal_door_count"), entrance = operation(t, "entrance_door_count");
    if (!Number.isInteger(internal) || !Number.isInteger(entrance) || internal + entrance !== doors) return null;
    const inventory = (t.detected_items || []).filter((i) => /\bdoor\b/i.test(i.name || "")).map((i) => {
      if (["m2", "m\xB2"].includes(i.unit)) return i;
      if (!["nr", "nos", "no", "each"].includes(i.unit) || i.quantity !== 1) return { ...i, quantity: null };
      const sizes = [...String(i.description || "").matchAll(/(\d+(?:\.\d+)?)\s*(?:m\s*)?[x×]\s*(\d+(?:\.\d+)?)\s*m\b/gi)];
      return { ...i, quantity: sizes.length === 1 ? round3(Number(sizes[0][1]) * Number(sizes[0][2])) : null };
    });
    if (inventory.length !== doors || new Set(inventory.map((i) => i.name)).size !== doors || inventory.some((i) => !finite2(i.quantity) || i.quantity <= 0) || Math.abs(inventory.reduce((s, i) => s + i.quantity, 0) - da) > 1e-3 || inventory.some((i) => Math.abs(i.quantity - da / doors) > 1e-3)) return null;
    extra = internal * da / doors;
  }
  const net = round3(gross - da - extra - wa);
  return net >= 0 ? { value: net, basis: `Checked room perimeters \xD7 explicit height = ${gross} m2; deduct ${da} m2 door openings, ${extra} m2 additional internal-door faces and ${wa} m2 window openings. Finish specification remains unconfirmed.` } : null;
}
function reconcileRasterMeasurements(t = {}) {
  if (t.pdf_analysis || t.page_evidence?.kind !== "floor_plan") return t;
  const height = explicitHeight(t);
  if (t.raster_measurement_audit?.version === 2 && t.raster_measurement_audit.height === height) return t;
  const geometry = t.area_geometry;
  if (geometry?.coverage !== "complete" || geometry?.basis !== "clear_internal") return t;
  const checked = auditPdfAreaGeometry({ ...t, pageNumber: 1 });
  const report = { version: 2, height, status: checked.audit?.status, wallMeasurementStatus: "height_required", corrections: [...t.raster_measurement_audit?.corrections || []], warnings: checked.warnings.map((s) => s.replaceAll("PDF", "Image")) };
  if (checked.audit?.status !== "dimension_geometry_checked") return { ...t, raster_measurement_audit: { ...report, status: "needs_review", reason: checked.audit?.reason } };
  const next = { ...t, page_evidence: { ...t.page_evidence, quantities: [...t.page_evidence.quantities] }, raster_measurement_audit: report };
  const record = (key2, value, basis) => {
    if (!finite2(value)) return;
    const claims = next.page_evidence.quantities.filter((q) => q.key === key2);
    if (Math.abs((t[key2] ?? 0) - value) > 1e-6 || claims.some((q) => Math.abs(q.value - value) > 1e-6)) report.corrections.push({ key: key2, reported: t[key2], reportedClaims: claims, computed: round3(value), basis });
    next[key2] = round3(value);
    next.page_evidence.quantities = next.page_evidence.quantities.filter((q) => q.key !== key2);
    next.page_evidence.quantities.push({ key: key2, value: next[key2], unit: "m2", scope_id: t.page_evidence.scope_id || "image", evidence: basis });
  };
  for (const key2 of areaKeys) record(key2, checked.page[key2], "Computed from complete, non-overlapping clear room polygons; wall footprints and voids excluded; outdoor spaces excluded from ceiling. Source dimensions require review.");
  const rooms = new Map(checked.page.detected_items.map((i) => [i.name, i]));
  next.detected_items = (t.detected_items || []).map((i) => {
    const measured = rooms.get(i.name);
    if (!measured || !["m2", "m\xB2"].includes(i.unit)) return i;
    if (Math.abs(i.quantity - measured.quantity) > 1e-6) report.corrections.push({ key: "room_area", tag: i.name, reported: i.quantity, computed: round3(measured.quantity) });
    return { ...i, quantity: round3(measured.quantity) };
  });
  const enclosed = geometry.spaces.filter((s) => s.kind === "enclosed");
  if (enclosed.length === t.rooms && height) {
    const gross = round3(enclosed.reduce((sum, s) => sum + s.polygon.reduce((n, p, i) => {
      const q = s.polygon[(i + 1) % s.polygon.length];
      return n + Math.hypot(q.x - p.x, q.y - p.y);
    }, 0) * height, 0));
    record("wall_area", gross, `Gross INTERNAL wall faces from all ${enclosed.length} enclosed room perimeters \xD7 explicit height ${height} m; not wall centreline length \xD7 height.`);
    report.wallMeasurementStatus = "computed";
    const net = netWall(next, gross);
    if (net) next.raster_measurement_audit.netInternalWall = net;
  }
  return next;
}

// src/lib/rasterBoqEvidence.mjs
function isRasterTakeoff(takeoff = {}) {
  return !takeoff.pdf_analysis && /\.(png|jpe?g|webp)$/i.test(takeoff.document_name || takeoff.analysis_source?.file_name || "");
}
var number4 = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
var round4 = (x) => Math.round((x + Number.EPSILON) * 1e6) / 1e6;
function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 500 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 0;
  const cross5 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length];
    if (cross5(a, b, c) * cross5(a, b, d) <= 0 && cross5(c, d, a) * cross5(c, d, b) <= 0 && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return 0;
  }
  return Math.abs(points.reduce((s, p, i) => {
    const q = points[(i + 1) % points.length];
    return s + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}
function wallPaintIssue(takeoff, page, quantities, evidence) {
  const claim2 = evidence.paint_area?.[0], geometry = takeoff.area_geometry || takeoff.raw_result?.area_geometry;
  if (!claim2 || page.kind !== "floor_plan" || geometry?.basis !== "clear_internal") return null;
  const spaces = geometry.spaces || [], rooms = spaces.filter((s) => s.kind === "enclosed");
  if (rooms.length < 2 || rooms.length !== takeoff.rooms || spaces.some((s) => !["enclosed", "outdoor"].includes(s.kind))) return null;
  if (page.drawing_id && claim2.scope_id !== page.drawing_id) return null;
  const basis = String(claim2.evidence || ""), notes = String(takeoff.notes || "");
  const allFaces = /\binternal faces:\s*external perimeter\b/i.test(basis) && /\bboth faces\b/i.test(basis) || /\ball internal (?:wall )?faces\b/i.test(basis) || /\bwalls of\b/i.test(basis) && rooms.every((s) => String(s.tag || "").trim() && basis.toLowerCase().includes(s.tag.toLowerCase()));
  if (!allFaces || !/\bnet\b/i.test(basis) || /\b(?:selected|partial|feature|half|cladding|panelling|tiled walls|wall tiles)\b/i.test(basis)) return null;
  const heights2 = [...notes.matchAll(/\b(?:internal|enclosed|room|wall) heights?\s*(?:=|:|is|of)?\s*(\d+(?:\.\d+)?)\s*m\b/gi)].map((m) => Number(m[1]));
  if (!heights2.length || heights2.some((h) => h <= 0 || h !== heights2[0]) || /\b(?:varying|variable|sloping|stepped|double.height)\b/i.test(notes)) return null;
  const tags = /* @__PURE__ */ new Set(), bounds2 = [];
  let perimeter = 0, enclosedArea = 0, totalArea = 0;
  for (const s of spaces) {
    const tag = String(s.tag || "").trim(), p = s.polygon, area4 = polygonArea(p);
    if (!tag || tags.has(tag) || !area4 || !number4(s.reported_area) || Math.abs(area4 - s.reported_area) > 0.02 || p.length !== 4) return null;
    tags.add(tag);
    if (p.some((a, i) => {
      const b = p[(i + 1) % 4];
      return a.x !== b.x && a.y !== b.y || a.x === b.x && a.y === b.y;
    })) return null;
    const box = { left: Math.min(...p.map((a) => a.x)), right: Math.max(...p.map((a) => a.x)), bottom: Math.min(...p.map((a) => a.y)), top: Math.max(...p.map((a) => a.y)) };
    if (bounds2.some((b) => Math.min(b.right, box.right) - Math.max(b.left, box.left) > 1e-3 && Math.min(b.top, box.top) - Math.max(b.bottom, box.bottom) > 1e-3)) return null;
    bounds2.push(box);
    totalArea += area4;
    if (s.kind === "enclosed") {
      enclosedArea += area4;
      perimeter += 2 * (box.right - box.left + box.top - box.bottom);
    }
  }
  if (!number4(takeoff.floor_area) || !number4(takeoff.ceiling_area) || Math.abs(totalArea - takeoff.floor_area) > 0.02 || Math.abs(enclosedArea - takeoff.ceiling_area) > 0.02) return null;
  for (const [count, area4] of [[takeoff.doors, quantities.door_area], [takeoff.windows, quantities.window_area]])
    if (!Number.isInteger(count) || count < 0 || !number4(area4) || count > 0 && area4 <= 0 || count === 0 && area4 !== 0) return null;
  const gross = round4(perimeter * heights2[0]);
  const minimum = round4(Math.max(0, gross - 2 * (quantities.door_area + quantities.window_area)));
  const tolerance = Math.max(0.02, gross * 1e-3);
  if (claim2.value >= minimum - tolerance && claim2.value <= gross + tolerance) return null;
  return {
    metricKey: "paint_area",
    claimedQuantity: claim2.value,
    unit: "m2",
    minimum,
    maximum: gross,
    basis: `Measurement conflict: saved net wall paint ${claim2.value} m2 is outside ${minimum}\u2013${gross} m2 from dimensioned room perimeters (${perimeter} m), stated height (${heights2[0]} m), and at most two faces per measured opening. Review the source; quantity withheld, not automatically corrected.`,
    originalEvidence: basis
  };
}
function rasterOperationEvidence(takeoff) {
  const page = takeoff.page_evidence || takeoff.raw_result?.page_evidence;
  if (!page || !Array.isArray(page.quantities)) throw Error("This image has no saved operation evidence. Complete quantity analysis before generating BOQ.");
  const warnings = [], groups = /* @__PURE__ */ new Map(), blocked = /* @__PURE__ */ new Set(), measurementIssues = [];
  for (const q of page.quantities) {
    if (!PDF_METRIC_UNITS[q.key] || q.unit !== PDF_METRIC_UNITS[q.key] || !number4(q.value) || q.unit === "nr" && !Number.isInteger(q.value) || !String(q.evidence || "").trim()) {
      if (q.key) blocked.add(q.key);
      warnings.push(`Image evidence rejected: ${q.key || "unknown metric"} has invalid units, value or measurement basis.`);
      continue;
    }
    const scopes = groups.get(q.key) || /* @__PURE__ */ new Map(), scope2 = String(q.scope_id || page.scope_id || "image");
    const old = scopes.get(scope2);
    if (old && Math.abs(old.value - q.value) > 1e-3) {
      blocked.add(q.key);
      warnings.push(`Conflicting image quantity: ${q.key}.`);
    } else scopes.set(scope2, { ...q, scope_id: scope2, pages: [1] });
    groups.set(q.key, scopes);
  }
  const quantities = {}, evidence = {};
  for (const [key2, scopes] of groups) {
    if (blocked.has(key2)) continue;
    const total = scopes.get("project") || scopes.get(String(page.scope_id || "")) || scopes.get(String(page.drawing_id || ""));
    if (!total && scopes.size !== 1) {
      blocked.add(key2);
      warnings.push(`Image quantity ${key2} needs scope reconciliation.`);
      continue;
    }
    const q = total || [...scopes.values()][0];
    quantities[key2] = q.value;
    evidence[key2] = [q];
  }
  const add = (key2, value, basis) => {
    if (blocked.has(key2) || Object.hasOwn(quantities, key2) || !number4(value) || value <= 0 || PDF_METRIC_UNITS[key2] === "nr" && !Number.isInteger(value)) return;
    quantities[key2] = round4(value);
    evidence[key2] = [{ key: key2, value: quantities[key2], unit: PDF_METRIC_UNITS[key2], scope_id: "image", pages: [1], evidence: basis }];
  };
  if (page.kind === "floor_plan") {
    for (const [key2, field] of [["door_count", "doors"], ["window_count", "windows"], ["window_area", "window_area"], ["door_area", "door_area"]])
      add(key2, takeoff[field], `Image extraction: ${field}; measured ${PDF_METRIC_UNITS[key2]}, review against source.`);
    const doorRoles = ["internal_door_count", "service_door_count", "entrance_door_count", "garage_door_count"];
    const knownRoles = doorRoles.filter((k) => Object.hasOwn(quantities, k));
    if (quantities.door_count === 0 && quantities.door_area > 0 || doorRoles.some((k) => blocked.has(k)) || knownRoles.reduce((s, k) => s + quantities[k], 0) > quantities.door_count || knownRoles.length === doorRoles.length && knownRoles.reduce((s, k) => s + quantities[k], 0) !== quantities.door_count) {
      const basis = "Door breakdown conflicts with the recorded total or has invalid count evidence. Door quantities and rates withheld; reconcile opening tags and roles.";
      measurementIssues.push({ metricKey: "door_count", basis, claimedQuantity: quantities.door_count, roleCounts: Object.fromEntries(knownRoles.map((k) => [k, quantities[k]])) });
      warnings.push(basis);
      for (const key2 of ["door_count", ...doorRoles]) {
        delete quantities[key2];
        delete evidence[key2];
        blocked.add(key2);
      }
    }
    if (quantities.window_count === 0 && quantities.window_area > 0) {
      const basis = "Positive window area conflicts with an explicit zero window count. Reconcile source openings before pricing.";
      measurementIssues.push({ metricKey: "window_area", claimedQuantity: quantities.window_area, basis });
      warnings.push(basis);
      delete quantities.window_area;
      delete evidence.window_area;
    }
    if (!Object.hasOwn(quantities, "door_count") && knownRoles.length) warnings.push("Only recorded door categories are available; the full opening inventory is unconfirmed.");
    const geometry = takeoff.area_geometry || takeoff.raw_result?.area_geometry;
    const spaces = geometry?.basis === "clear_internal" ? (geometry.spaces || []).filter((s) => s.kind === "enclosed") : [];
    const inventory = takeoff.detected_items || [];
    let ceramic = 0;
    const tags = /* @__PURE__ */ new Set();
    let valid2 = true;
    for (const s of spaces) {
      const tag = String(s.tag || "").trim();
      if (!tag || tags.has(tag)) {
        valid2 = false;
        break;
      }
      tags.add(tag);
      const matching = inventory.filter((i) => String(i.name || "").startsWith(tag));
      const text3 = [s.evidence, ...matching.map((i) => i.description)].join(" ");
      if (!/\bceramic\b/i.test(text3) || /\b(?:not|no|except|alternative)\b[^.;]*\bceramic\b/i.test(text3)) continue;
      const area4 = polygonArea(s.polygon);
      if (!area4 || number4(s.reported_area) && Math.abs(s.reported_area - area4) > 0.02) {
        valid2 = false;
        break;
      }
      ceramic += area4;
    }
    if (valid2 && Number(takeoff.rooms) === 1 && spaces.length === 1 && Math.abs(ceramic - Number(takeoff.floor_area)) <= 0.02)
      add("ceramic_floor_area", ceramic, "Explicit ceramic room finish; dimensioned clear internal room polygon agrees with the saved floor area.");
    const notes = String(takeoff.notes || "");
    if (Number(takeoff.rooms) === 1 && /\bgross\b/i.test(notes) && /\b(?:painted walls|wall paint)\b/i.test(
      [notes, ...spaces.map((s) => s.evidence), ...inventory.map((i) => i.description)].join(" ")
    ) && number4(takeoff.wall_area) && number4(takeoff.door_area) && number4(takeoff.window_area) && (!(takeoff.doors > 0) || takeoff.door_area > 0) && (!(takeoff.windows > 0) || takeoff.window_area > 0))
      add(
        "paint_area",
        Math.max(0, takeoff.wall_area - takeoff.door_area - takeoff.window_area),
        `Gross internal wall faces ${takeoff.wall_area} minus measured door area ${takeoff.door_area} and window area ${takeoff.window_area}; single room.`
      );
    const issue = wallPaintIssue(takeoff, page, quantities, evidence);
    if (issue) {
      measurementIssues.push(issue);
      warnings.push(issue.basis);
      delete quantities.paint_area;
      delete evidence.paint_area;
    }
    if (takeoff.raster_measurement_audit?.status === "dimension_geometry_checked") {
      const floors = ["ceramic_floor_area", "wood_floor_area", "epoxy_floor_area", "terrace_floor_area"];
      const conflicts = [];
      if (floors.reduce((s, k) => s + (quantities[k] || 0), 0) > takeoff.floor_area + 0.02) conflicts.push(...floors.filter((k) => quantities[k] > 0));
      for (const k of ["ceiling_paint_area", "gypsum_ceiling_area"]) if (quantities[k] > takeoff.ceiling_area + 0.02) conflicts.push(k);
      const wallMaximum = takeoff.raster_measurement_audit.netInternalWall?.value ?? takeoff.wall_area;
      if (quantities.paint_area > wallMaximum + 0.02) conflicts.push("paint_area");
      for (const metricKey of conflicts) {
        const basis = `Measured ${metricKey} exceeds the checked surface available to that operation. Original claim retained for review; no automatic material quantity correction.`;
        measurementIssues.push({ metricKey, claimedQuantity: quantities[metricKey], basis });
        warnings.push(basis);
        delete quantities[metricKey];
        delete evidence[metricKey];
      }
    }
  }
  return { adapter: { scheduled_quantities: quantities, pdf_analysis: { quantity_evidence: evidence } }, warnings, measurementIssues };
}
function applyRasterDoorBudget(items, takeoff, adapter, prices, priceLevel) {
  const page = takeoff.page_evidence || takeoff.raw_result?.page_evidence;
  if (page?.kind !== "floor_plan") return items;
  const claims = adapter.pdf_analysis.quantity_evidence.door_count || [];
  const detail = [
    ...String(takeoff.notes || "").split(/[.;\n]/).filter((s) => /\bdoors?\b/i.test(s)),
    ...claims.map((c) => c.evidence),
    ...(page.quantities || []).filter((q) => /door/.test(q.key)).map((q) => q.evidence),
    JSON.stringify(takeoff.object_details?.doors || [])
  ].join(" ");
  if (/\b(?:garage|roller|shutter|overhead|steel|stainless|metal|alumini?um|glass|glazed|fib(?:re|er)glass|frp|grp|wpc|composite|upvc|pvc|fire|fireproof|fd\d+|security|acoustic|external|weatherproof|double[- ]leaf|double[- ]door|sliding|folding|revolving)\b/i.test(detail)) return items;
  const count = adapter.scheduled_quantities.door_count, area4 = adapter.scheduled_quantities.door_area;
  if (area4 > 0 && count > 0 && area4 / count > 2.5) return items;
  const doorRows = items.filter((i) => ["door_count", "internal_door_count", "entrance_door_count", "service_door_count"].includes(i.pdfEvidence?.metricKey));
  if (!doorRows.length) return items;
  const priced = doorRows.map((row) => {
    const key2 = row.pdfEvidence.metricKey;
    const configured = prices.some((p) => {
      try {
        const meta = typeof p.source_reference === "string" ? JSON.parse(p.source_reference) : p.source_reference;
        return p.is_active !== false && meta?.kind === "pricing_default" && meta.enabled === true && meta.metric === key2;
      } catch {
        return false;
      }
    });
    const policies = configured || key2 === "door_count" ? prices : prices.map((p) => {
      try {
        const meta = typeof p.source_reference === "string" ? JSON.parse(p.source_reference) : p.source_reference;
        return meta?.kind === "pricing_default" && meta.metric === "door_count" ? { ...p, source_reference: JSON.stringify({ ...meta, metric: key2, opening_components: void 0 }) } : p;
      } catch {
        return p;
      }
    });
    return applyPdfDefaultSpecifications([row], adapter, policies, priceLevel)[0];
  });
  const replacements = new Map(doorRows.map((row, i) => [row, priced[i]]));
  return items.map((row) => {
    const next = replacements.get(row) || row;
    return next.defaultSpecification?.status === "applied" ? { ...next, source: "Image measured quantity + editable catalog specification assumption" } : next;
  });
}
function appendUnallocatedSurfaces(items, takeoff, warnings) {
  if (takeoff.raster_measurement_audit?.status !== "dimension_geometry_checked") return;
  const metric = (i) => i.imageEvidence?.metricKey || i.pdfEvidence?.metricKey;
  const total = (keys) => items.filter((i) => keys.includes(metric(i)) && i.quantity > 0).reduce((s, i) => s + i.quantity, 0);
  const add = (surface, value, basis) => {
    if (!(value > 1e-3)) return;
    const key2 = `unallocated_${surface}_finish_area`;
    items.push({
      itemCode: `IMG-${key2.toUpperCase()}`,
      section: "Internal finishes",
      boqTrade: "finishes",
      description: `${surface[0].toUpperCase() + surface.slice(1)} finish \u2014 measured area; select material/system`,
      unit: "m2",
      quantity: round4(value),
      rate: 0,
      amount: 0,
      rateMissing: true,
      status: "measured_rate_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      measurementPlaceholder: { surface, status: "selection_required" },
      pdfEvidence: { metricKey: key2, pages: [1], basis },
      imageEvidence: { metricKey: key2, basis },
      source: "Checked image room geometry; finish unspecified",
      notes: `${basis} Material/system is not specified by the drawing. Select an applicable existing catalog item or enable and review the editable scope defaults. Area is retained, not silently omitted.`,
      completion: { code: "finish_selection_required", required_information: ["Select floor/wall/ceiling finish and applicable catalog rate."] }
    });
    warnings.push(`${round4(value)} m2 of ${surface} finish remains unselected and is excluded from the priced budget. The displayed budget is incomplete.`);
  };
  add(
    "floor",
    takeoff.floor_area - total(["ceramic_floor_area", "wood_floor_area", "epoxy_floor_area", "terrace_floor_area", "stone_floor_area", "cement_floor_area"]),
    "Complete checked clear floor area less explicitly allocated floor finishes; walls and voids excluded."
  );
  add(
    "ceiling",
    takeoff.ceiling_area - Math.max(total(["ceiling_paint_area"]), total(["gypsum_ceiling_area"])),
    "Complete checked enclosed ceiling area less allocated ceiling finish; outdoor spaces and voids excluded."
  );
  const net = takeoff.raster_measurement_audit.netInternalWall;
  if (net && !items.some((i) => i.measurementIssue?.metricKey === "paint_area")) add("wall", net.value - total(["paint_area", "wet_wall_tile_area"]), net.basis);
}
function buildRasterBoq({ takeoff, prices = [], rules = [], projectId, projectName, priceLevel = "standard", vatPercentage = 5 }) {
  takeoff = reconcileRasterMeasurements(takeoff);
  const { adapter, warnings, measurementIssues } = rasterOperationEvidence(takeoff);
  warnings.push(...takeoff.raster_measurement_audit?.warnings || []);
  if (takeoff.raster_measurement_audit?.corrections?.length) warnings.push("Saved arithmetic reconciled against complete dimensioned room geometry. Original values and calculation basis are retained in the measurement audit.");
  const plan = planPdfCatalogRules(adapter, rules, prices);
  warnings.push(...plan.warnings.map((s) => s.replaceAll("PDF", "Image")));
  const items = [];
  const byCode = new Map(prices.map((p) => [String(p.item_code || "").toUpperCase(), p]));
  for (const [code, q] of plan.bindings) {
    const p = byCode.get(code);
    if (!p) continue;
    if (q.metricKey === "window_area" && /alumini?um/i.test(p.description)) {
      const specification = [q.evidence, ...(takeoff.detected_items || []).filter((i) => /window/i.test(i.name || "")).map((i) => i.description)].join(" ");
      if (/\b(?:steel|timber|wood|upvc|pvc)\b/i.test(specification)) {
        warnings.push("Recorded window material does not match the aluminium catalog package. Window quantity retained without that rate.");
        continue;
      }
    }
    const rate = resolvePdfCatalogRate(p, priceLevel);
    items.push({
      itemCode: code,
      sectionCode: p.section_code || "07",
      section: p.category || "Measured work",
      description: p.description,
      unit: p.unit,
      quantity: q.quantity,
      rate: rate.rate,
      amount: boqLineAmount({ quantity: q.quantity, rate: rate.rate }),
      rateSource: rate.source,
      rateMissing: rate.missingRate,
      status: rate.missingRate ? "measured_rate_pending" : "measured",
      verification: "pending",
      includeInCommercialTotal: false,
      source: "Image operation evidence",
      quantityBasis: "image_operation_evidence",
      pdfEvidence: { metricKey: q.metricKey, metricKeys: q.metricKeys, pages: [1], basis: q.evidence },
      imageEvidence: { metricKey: q.metricKey, basis: q.evidence },
      notes: q.evidence
    });
    const row = items.at(-1);
    if (q.metricKey === "window_area" && /alumini?um/i.test(p.description) && !/alumini?um/i.test(q.evidence || "")) {
      const basis = "Existing catalog window package used provisionally; frame material and glazing are not established by the opening dimensions.";
      row.description += " [assumed specification \u2014 editable]";
      row.defaultSpecification = {
        status: "applied",
        metric: "window_area",
        assumed: { window_system: p.description },
        catalogItemCode: code,
        rateBasis: basis,
        policy: { label: p.description, conditions: "Confirm frame, glazing, hardware and performance.", rate_basis: basis }
      };
      row.notes += " PRICING ASSUMPTION (EDITABLE; NOT A DRAWING SPECIFICATION): " + basis;
    }
  }
  const unbound = retainUnboundPdfQuantities(items, adapter);
  warnings.push(...unbound.warnings.map((s) => s.replaceAll("PDF", "Image")));
  for (const issue of measurementIssues) unbound.items.push({
    itemCode: `IMG-${issue.metricKey.toUpperCase()}-MEASUREMENT-CONFLICT`,
    section: issue.metricKey === "door_count" ? "Doors and Windows" : "Internal finishes",
    description: `${issue.metricKey === "paint_area" ? "Wall paint" : issue.metricKey.replaceAll("_", " ")} \u2014 conflicting measurement, source review required`,
    unit: PDF_METRIC_UNITS[issue.metricKey] || "m2",
    quantity: 0,
    rate: 0,
    amount: 0,
    rateMissing: true,
    status: "quantity_pending",
    verification: "pending",
    includeInCommercialTotal: false,
    source: "Image measurement consistency audit",
    imageEvidence: { metricKey: issue.metricKey, basis: issue.basis },
    measurementIssue: issue,
    notes: issue.basis
  });
  if (adapter.scheduled_quantities.window_count > 0 && !adapter.scheduled_quantities.window_area) {
    unbound.items.push({
      itemCode: "IMG-WINDOW-COUNT",
      section: "Doors and Windows",
      description: "Window sets \u2014 opening dimensions required",
      unit: "nr",
      quantity: adapter.scheduled_quantities.window_count,
      rate: 0,
      amount: 0,
      rateMissing: true,
      status: "measured_rate_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      imageEvidence: { metricKey: "window_count", basis: "Saved window count; area unavailable." },
      source: "Image operation evidence",
      notes: "Count retained as count. Supply measured window dimensions before area-based pricing."
    });
  }
  const doorItems = applyRasterDoorBudget(unbound.items, takeoff, adapter, prices, priceLevel);
  const budgetItems = doorItems.map((item) => {
    const key2 = item.pdfEvidence?.metricKey;
    if (!["wood_floor_area", "ceiling_paint_area"].includes(key2) || doorItems.filter((i) => i.pdfEvidence?.metricKey === key2).length !== 1) return item;
    const text3 = [
      ...(adapter.pdf_analysis.quantity_evidence[key2] || []).map((q) => q.evidence),
      ...(takeoff.detected_items || []).filter((i) => new RegExp(key2 === "wood_floor_area" ? "wood|timber|parquet" : "ceiling", "i").test(i.name || "")).map((i) => i.description)
    ].join(" ");
    if (key2 === "wood_floor_area" && /\b(?:solid|engineered|laminate|parquet|vinyl|lvt|spc|oak|teak|bamboo|herringbone|outdoor)\b/i.test(text3)) return item;
    if (key2 === "ceiling_paint_area" && /\b(?:epoxy|fire|acoustic|antibacterial|specialist|textured|enamel|exterior|exposed)\b/i.test(text3)) return item;
    const next = applyPdfDefaultSpecifications([item], adapter, prices, priceLevel)[0];
    return next.defaultSpecification?.status === "applied" ? { ...next, source: "Image measured quantity + editable catalog specification assumption" } : next;
  });
  for (let i = warnings.length - 1; i >= 0; i--) if (budgetItems.some((row) => row.rate > 0 && warnings[i].startsWith(`Image quantity ${row.pdfEvidence?.metricKey} retained as an unpriced row;`))) warnings.splice(i, 1);
  const assumedDoors = budgetItems.filter((i) => /door_count$/.test(i.pdfEvidence?.metricKey || "") && i.defaultSpecification?.status === "applied");
  if (assumedDoors.length) {
    for (let i = warnings.length - 1; i >= 0; i--) if (assumedDoors.some((row) => warnings[i].startsWith(`Image quantity ${row.pdfEvidence.metricKey} retained as an unpriced row;`))) warnings.splice(i, 1);
    warnings.push("Door budget uses the existing editable catalog specification assumption. Confirm material, opening size and required performance before tender approval.");
  }
  appendUnallocatedSurfaces(budgetItems, takeoff, warnings);
  const finalItems = budgetItems.map((item, i) => {
    const reviewed = requireBoqReview({
      ...item,
      itemNumber: String(i + 1).padStart(2, "0"),
      itemCode: item.itemCode?.replace(/^PDF-/, "IMG-"),
      source: String(item.source || "").replaceAll("PDF", "Image"),
      notes: String(item.notes || "").replaceAll("PDF", "Image"),
      quantityBasis: "image_operation_evidence",
      quantitySource: "image_operation_evidence",
      imageEvidence: item.imageEvidence || item.pdfEvidence,
      amount: boqLineAmount(item)
    });
    return item.defaultSpecification?.status === "applied" ? { ...reviewed, specificationVerification: "assumed" } : reviewed;
  });
  if (!finalItems.length) throw Error("No supported measurable operations were found in this image. Review dimensions and operation evidence; no allowance was invented.");
  const subtotal = currencySum(finalItems.filter((i) => !i.rateMissing).map(boqLineAmount));
  const budget = calculateBoqBudget({ provisional: subtotal }, { vatPercentage });
  return bindBoqSource({
    projectId,
    projectName,
    currency: "AED",
    priceLevel,
    takeoff,
    items: finalItems,
    calculationVersion: "image-operation-evidence-v1",
    measurementIssues,
    measurementAudit: takeoff.raster_measurement_audit || null,
    warnings: [...warnings, "Image quantities and catalog specifications require review. Unsupported work is not priced."],
    assumptions: [
      "Only saved image operation evidence is used. No CAD allowances or additional model requests.",
      ...finalItems.filter((i) => i.defaultSpecification?.status === "applied").map((i) => `Editable budget assumption: ${i.defaultSpecification.policy.label}; ${i.defaultSpecification.rateBasis}. ${i.defaultSpecification.policy.conditions || ""}`)
    ],
    summary: {
      totalItems: finalItems.length,
      unpricedMeasuredItems: finalItems.filter((i) => i.rateMissing && i.quantity > 0).length,
      verifiedSubtotal: 0,
      provisionalSubtotal: subtotal,
      subtotal,
      vatPercentage,
      vatAmount: budget.vat,
      grandTotal: budget.total,
      commercialSafe: false,
      scopeCoverage: "unconfirmed"
    }
  }, takeoff, projectId);
}

// src/lib/pdfSourceRateBook.mjs
var band4 = (spans, y) => spans.filter((s) => Math.abs(s.y - y) < 1.5).sort((a, b) => a.x - b.x);
var unit4 = (v) => ({ "m\xB2": "m2", "m\xB3": "m3", nos: "nr", no: "nr", point: "nr", set: "nr" })[String(v).toLowerCase()] || String(v).toLowerCase();
var normalized = (s) => String(s || "").toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();
function readPdfSourceRateBook(pages) {
  const rates = [], issues = [];
  for (const page of pages || []) {
    const spans = page.native_text_evidence?.status === "readable" ? page.native_text_evidence.spans : [];
    for (const head of spans.filter((s) => s.text === "Code")) {
      const cols = band4(spans, head.y);
      if (cols.map((s) => s.text).join("|") !== "Code|Operation|Unit|AED/unit") continue;
      const start = rates.length;
      try {
        const anchors = spans.filter((s) => s.y < head.y - 3 && Math.abs(s.x - head.x) < 10 && /^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/.test(s.text));
        if (!anchors.length || anchors.length > 500) throw Error("Empty/excessive source rate book");
        for (const anchor of anchors) {
          const row = band4(spans, anchor.y), at2 = (i) => {
            const matches = row.filter((s) => Math.abs(s.x - cols[i].x) < 10);
            if (matches.length !== 1) throw Error("Missing source rate cell");
            return matches[0].text;
          };
          const raw = at2(3), u = unit4(at2(2));
          if (!/^\d+(?:\.\d+)?$/.test(raw) || !["m", "m2", "m3", "nr"].includes(u) || !(Number(raw) > 0 && Number(raw) < 1e9)) throw Error("Unsupported source rate/unit");
          rates.push({ code: anchor.text, description: at2(1), unit: u, rate: Number(raw), currency: "AED", page: page.pageNumber });
        }
      } catch (e) {
        rates.splice(start);
        issues.push(`Source rate page ${page.pageNumber} withheld: ${e.message}`);
      }
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (const r of rates) {
    const old = groups.get(r.code);
    if (old && JSON.stringify([old.description, old.unit, old.rate]) !== JSON.stringify([r.description, r.unit, r.rate])) {
      issues.push("Conflicting source rates for " + r.code);
      groups.set(r.code, { invalid: true });
    } else if (!old) groups.set(r.code, r);
  }
  return { rates: [...groups.values()].filter((r) => !r.invalid), issues };
}
function rateScope(r) {
  const d = normalized(r.description), u = r.unit;
  if (u === "m2") {
    const metrics = [[/external masonry|external (?:blockwork|block wall)/, "external_block_area"], [/internal masonry|internal (?:blockwork|block wall)/, "internal_block_area"], [/internal plaster/, "plaster_area"], [/internal wall paint/, "paint_area"], [/wet room wall tile|wet wall tile/, "wet_wall_tile_area"], [/wet floor waterproof/, "wet_floor_waterproofing_area"], [/waterproof upstand/, "wet_wall_waterproofing_area"]];
    for (const [re, metric] of metrics) if (re.test(d)) return { metric };
    if (/ceiling paint/.test(d)) return { family: "ceiling-paint", generic: true };
    if (/gypsum ceiling/.test(d)) return { family: "ceiling-board", generic: !/(?:moisture|fire) resistant|fire rated/.test(d) };
    if (/fixed internal glass/.test(d)) return { family: "fixed-glazing" };
    if (/window/.test(d)) return { family: "window-set" };
    if (/porcelain|wood floor|epoxy floor|ceramic floor|terrazzo/.test(d)) return { family: "floor" };
  }
  if (u === "m" && /skirting/.test(d)) return { family: "skirting", generic: /^(?:dry room |dry-room )?skirting$/.test(d) };
  if (u === "nr" && /door set/.test(d)) return { family: "door-set" };
  return declaredOperationKind(r.description);
}
function bindPdfSourceRates(items, takeoff) {
  const book = readPdfSourceRateBook(takeoff?.page_results);
  if (!book.rates.length) return items;
  return items.map((item) => {
    if (!(item.quantity > 0) || item.source === "manual" || item.review?.confirmed || item.catalogSelection || item.defaultSpecification?.rateOverridden || item.projectRateOverride || item.projectRateSelection || item.quantitySource === "manual" || item.quantityBasis === "manual_quantity_override") return item;
    const op = item.pdfEvidence?.operation, key2 = item.pdfEvidence?.metricKey;
    if (!key2) return item;
    const candidates = book.rates.filter((r2) => {
      if (r2.unit !== unit4(item.unit)) return false;
      const scope2 = rateScope(r2);
      if (!scope2) return false;
      if (scope2.metric) {
        if (scope2.metric !== key2) return false;
        if (["external_block_area", "internal_block_area"].includes(key2)) {
          const thickness = r2.description.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i), kind = key2.startsWith("external") ? "external" : "internal";
          if (thickness) {
            const pattern = new RegExp("Solid " + kind + " wall\\s+[A-Z]+\\d+\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*mm", "gi");
            const values = (takeoff.page_results || []).flatMap((p) => (p.native_plan_text?.spans || []).flatMap((s) => [...s.text.matchAll(pattern)].map((m) => Number(m[1]))));
            if (!values.length || values.some((v) => v !== Number(thickness[1]))) return false;
          }
        }
        return true;
      }
      if (!op || op.family !== scope2.family) return false;
      const actual = pdfOperationProfile(op), offered = pdfOperationProfile({ family: scope2.family, sourceDescription: r2.description });
      if (Object.entries(offered).some(([k, v]) => k !== "family" && typeof v !== "boolean" && Object.hasOwn(actual, k) && actual[k] !== v)) return false;
      if (r2.code === op.sourceCode) return true;
      return scope2.generic === true;
    });
    const exact = candidates.filter((r2) => r2.code === op?.sourceCode), best = exact.length ? exact : candidates;
    if (best.length !== 1) return item;
    const r = best[0];
    return {
      ...item,
      rate: r.rate,
      referenceRate: r.rate,
      amount: Math.round((item.quantity * r.rate + Number.EPSILON) * 100) / 100,
      rateMissing: false,
      rateSource: `Original PDF rate book p.${r.page}: ${r.code}, ${r.rate} AED/${r.unit}`,
      sourceRate: { code: r.code, description: r.description, page: r.page, rate: r.rate, unit: r.unit, currency: r.currency, requires_review: true },
      status: "provisional_estimate",
      verification: "provisional",
      reviewRequired: true,
      includeInCommercialTotal: false,
      notes: [String(item.notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, "").replace(/Quantity retained without assuming a catalog specification or rate\. Not included in tender or priced budget\./g, ""), `SOURCE RATE BOOK: page ${r.page}, ${r.code} ${r.description}: ${r.rate} AED/${r.unit}. Editable source budget rate; not a current market quotation or tender approval.`].join(" ")
    };
  });
}

// src/lib/pdfBoqCompletion.mjs
var requirements = {
  internal_block_area: ["Block thickness/material matching the drawing", "An own catalog or project rate for that specification"],
  door_count: ["Door material/type breakdown including garage doors", "Applicable rate for each selected door type"],
  internal_door_count: ["Door material and set specification"],
  service_door_count: ["Service door classification and specification"],
  entrance_door_count: ["Entrance door classification and specification"],
  garage_door_count: ["Garage door system and specification"],
  water_pipe_length: ["Pipe material and diameter breakdown"],
  waste_pipe_length: ["Drainage material and diameter breakdown"],
  ac_count: ["Unit type and capacity breakdown"],
  ac_pipe_length: ["AC pipe material/diameter and insulation specification"],
  wet_wall_tile_area: ["Wall tile material and installation specification"],
  backsplash_area: ["Backsplash material and installation specification"],
  roof_waterproofing_area: ["Roof waterproofing system, layers and installation specification"],
  terrace_waterproofing_area: ["Terrace waterproofing system and installation specification"],
  wet_floor_waterproofing_area: ["Wet floor waterproofing system and installation specification"],
  wet_wall_waterproofing_area: ["Wet wall waterproofing system and installation specification"],
  ceiling_paint_area: ["Applicable ceiling paint system and its own rate"],
  epoxy_floor_area: ["Epoxy floor system and its own rate"],
  wood_floor_area: ["Wood flooring system/material and its own rate"],
  terrace_floor_area: ["Outdoor flooring material and installation specification"],
  kitchen_cabinet_length: ["Base cabinet material/finish and linear-metre rate"],
  kitchen_hob_hood_count: ["Hob/hood package specification and package rate"],
  kitchen_sink_count: ["Kitchen sink and fittings specification"],
  laundry_sink_count: ["Laundry sink and fittings specification"],
  shower_count: ["Shower/fittings package specification"],
  terrace_railing_length: ["Railing material/system and linear-metre rate"],
  driveway_area: ["Driveway paving material and construction specification"],
  landscape_area: ["Landscape planting/groundcover specification"]
};
function annotatePdfBoqCompletion(items, takeoff, catalog = [], priceLevel = "standard") {
  if (!takeoff.pdf_analysis) return { items, summary: null, gaps: [] };
  items = bindPdfSourceRates(items, takeoff);
  items = applyPdfDefaultSpecifications(items, takeoff, catalog, priceLevel);
  items = bindPdfOperationRates(items, catalog, priceLevel);
  const candidates = /* @__PURE__ */ new Map();
  const specificationFacts = readPdfSourceSpecifications(takeoff);
  const specificationConflicts = pdfSpecificationConflicts(specificationFacts);
  for (const p of catalog) {
    if (p?.is_active === false || isPdfDefaultOnlyPrice(p)) continue;
    const m = pdfRuleMetric(p?.description, p?.unit, takeoff, specificationFacts);
    if (!m) continue;
    const rows = candidates.get(m.key) || [];
    rows.push({ code: p.item_code || p.itemCode, unit: p.unit, rateAvailable: !resolvePdfCatalogRate(p).missingRate });
    candidates.set(m.key, rows);
  }
  const summary = { pricedMeasuredOperations: 0, unpricedMeasuredOperations: 0, catalogOptionsWithoutQuantity: 0, assumedSpecificationOperations: 0, unmeasuredCatalogRowsAreNotMissingProjectScope: true, completePricedBudget: false };
  const gaps = [];
  const next = items.map((item) => {
    const quantity = Number(item.quantity), rate = Number(item.rate);
    const existingNotes = String(item.notes || "").replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g, "").trim();
    if (!(quantity > 0)) {
      summary.catalogOptionsWithoutQuantity++;
      const completion2 = { code: "catalog_option_without_quantity", required_information: ["Select this catalog option only if it belongs to the project and has its own measured quantity."] };
      return { ...item, completion: completion2, notes: [existingNotes, "[BOQ GAP] Catalog option without a project quantity. This row is not evidence of an additional missing project scope. [/BOQ GAP]"].filter(Boolean).join(" ") };
    }
    if (rate > 0 && !item.rateMissing) {
      summary.pricedMeasuredOperations++;
      if (item.defaultSpecification?.status === "applied" || Object.keys(item.operationPricing?.assumed_specification || {}).length) summary.assumedSpecificationOperations++;
      return item;
    }
    summary.unpricedMeasuredOperations++;
    const key2 = item.pdfEvidence?.metricKey || String(item.itemCode || "").replace(/^PDF-/, "").toLowerCase();
    const matching = candidates.get(key2) || [];
    let required = /_volume$/.test(key2) && key2 !== "excavation_volume" ? ["Concrete grade/specification for this element", "Applicable own catalog or project rate"] : requirements[key2] || ["Applicable scope/material specification and matching own catalog or project rate"];
    let code = matching.length && matching.every((p) => !p.rateAvailable) ? "catalog_rate_missing" : matching.length > 1 ? "catalog_selection_required" : "specification_or_catalog_match_required";
    if (item.operationPricing?.status === "catalog_rate_missing") {
      code = "catalog_rate_missing";
      required = item.operationPricing.required_information?.length ? item.operationPricing.required_information : ["Applicable installed supplier/project rate for this source operation"];
    }
    if (item.operationPricing?.status === "ambiguous") {
      code = "catalog_selection_required";
      required = ["Resolve competing specification-matched operation catalog records: " + item.operationPricing.candidate_codes.join(", ")];
    }
    const known = resolvedPdfSpecifications(takeoff, key2, specificationFacts), conflicts = specificationConflicts.filter((f) => f.metric === key2);
    if (conflicts.length) {
      code = "source_specification_breakdown_required";
      required = ["Provide disjoint measured quantities for the mixed/conflicting source specifications before selecting rates."];
    } else if (known.length && !matching.length) {
      code = "source_specification_without_catalog_match";
      required = ["Select or provide an applicable rate matching the known source specification; the source quantity is retained."];
    }
    const completion = { code, metric: key2, required_information: required, candidate_codes: matching.map((p) => p.code), ...known.length ? { source_specifications: known } : {}, ...conflicts.length ? { specification_conflicts: conflicts } : {} };
    gaps.push({ itemCode: item.itemCode, description: item.description, quantity, unit: item.unit, ...completion });
    const sourceNote = known.length ? " Source: " + known.map((f) => `${f.property}=${f.value} (pages ${f.pages.join(", ")})`).join("; ") + "." : "";
    const note = `[BOQ GAP] ${code}: ${required.join("; ")}.${matching.length ? " Catalog candidates: " + matching.map((p) => p.code).join(", ") + "." : ""}${sourceNote} [/BOQ GAP]`;
    return { ...item, completion, notes: [existingNotes, note].filter(Boolean).join(" ") };
  });
  summary.knownMeasuredOperationsHaveRates = summary.pricedMeasuredOperations > 0 && summary.unpricedMeasuredOperations === 0;
  return { items: next, summary, gaps };
}

// src/lib/estimateClassification.mjs
function classifyEstimateItem(item = {}) {
  if (item.source === "manual" && (!(Number(item.quantity) > 0) || !(Number(item.rate) > 0) || /^New BOQ item$/i.test(String(item.description || "").trim()))) return "pending";
  if (item.rateMissing === true || ["quantity_pending", "measured_rate_pending"].includes(item.status) || item.verification === "pending") return "pending";
  if (item.reviewRequired === true || item.status === "provisional_estimate" || item.verification === "provisional") return "provisional";
  if (item.includeInCommercialTotal === false) return "pending";
  if (item.verification === "verified" || ["measured", "manual"].includes(item.status)) return "verified";
  return "pending";
}

// src/lib/dwgSchedule.mjs
var qtyHeader = (value) => /qty|quantity|count|number|no\.?\s*(of|required)|تعداد/i.test(value || "") || /^(no\.?|nos\.?)$/i.test(String(value || "").trim());
var norm = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
var family = (value) => {
  const s = norm(value);
  if (/(?:wood|timber|stud).*fram|fram.*(?:wood|timber)|wood stud/.test(s)) return "timber_frame";
  if (/steel.*fram|metal stud|light.gauge/.test(s)) return "steel_frame";
  if (/hardwood|oak flooring|wood floor/.test(s)) return "hardwood";
  if (/tile|ceramic|porcelain/.test(s)) return "tile";
  if (/alumin/.test(s)) return "aluminium";
  if (/upvc|u-pvc|vinyl|pvc/.test(s)) return "pvc";
  if (/wood|timber|oak/.test(s)) return "timber";
  if (/steel/.test(s)) return "steel";
  if (/block|brick|masonry/.test(s)) return "masonry";
  if (/standing.seam|metal roof|metal roofing/.test(s)) return "metal_roof";
  if (/\bfram(?:ing|ed)\b/.test(s)) return "frame_unspecified";
  if (/gypsum|drywall/.test(s)) return "gypsum";
  return "";
};
function applyDwgScheduleToBoq(input = [], evidence = {}, catalog = []) {
  let items = input.map((i) => ({ ...i }));
  const warnings = [...evidence.issues || []];
  const countUnit = (u) => /^(nos?\.?|ea|each|pcs?|item|number)$/.test(norm(u));
  function candidate(kind, material2, unit5) {
    const f = family(material2);
    if (!f) return null;
    return catalog.find((c) => new RegExp(kind).test(norm(c.description)) && family(c.description) === f && (unit5 === "nos" ? countUnit(c.unit) : norm(c.unit).replace("\xB2", "2") === unit5) && Number(c.resolvedRate) > 0 && !/repair|painting|ironmongery|sealant|cleaning/.test(norm(c.description))) || null;
  }
  for (const kind of ["door", "window"]) {
    const schedules = (evidence.tables || []).filter((t2) => t2.kind === kind && t2.accepted && t2.complete && t2.coversProject && qtyHeader(t2.quantityHeader) && Array.isArray(t2.rows) && t2.rows.length > 0 && t2.rows.every((r) => r.quantityAccepted && Number.isInteger(r.quantity) && r.quantity >= 0));
    if (schedules.length !== 1) continue;
    const t = schedules[0];
    const openingItem = (i) => new RegExp(kind).test(norm(i.description)) && !/repair|painting|ironmongery|sealant|cleaning|lintel|sill/.test(norm(i.description)) && (countUnit(i.unit) || ["m2", "m\xB2"].includes(norm(i.unit)));
    const old = items.filter(openingItem);
    if (old.length) warnings.push(`${kind}: geometry/catalog quantities ${old.map((i) => i.quantity).join(", ")} replaced by schedule total ${t.total}; rates remain subject to specification review.`);
    items = items.filter((i) => !openingItem(i));
    for (const [index, row] of t.rows.entries()) {
      if (!row.quantity) continue;
      const c = row.specificationAccepted ? candidate(kind, row.material, "nos") : null;
      const rate = Number(c?.resolvedRate) || 0;
      items.push({
        id: `dwg-${kind}-${index}-${row.mark}`,
        itemCode: c?.item_code || `DWG-${kind}-${index}`,
        section: "Doors & Windows",
        sectionCode: "08",
        description: `${kind === "door" ? "Door" : "Window"} ${row.mark}: ${row.description || kind} \u2014 ${row.material || "material not specified"}${row.dimensions ? " \xB7 " + row.dimensions : ""}`,
        unit: "nos",
        quantity: row.quantity,
        rate,
        amount: Math.round(row.quantity * rate * 100) / 100,
        rateMissing: !rate,
        status: rate ? "provisional_estimate" : "measured_rate_pending",
        verification: rate ? "provisional" : "pending",
        includeInCommercialTotal: false,
        quantityVerification: "schedule_checked",
        quantityBasis: "drawing_schedule_two_reads",
        quantitySource: "drawing_schedule",
        rateSource: c?.resolvedSource || "matching_specification_rate_pending",
        specificationVerification: row.specificationAccepted ? "drawing_transcribed" : "unconfirmed",
        reviewRequired: true,
        source: "Drawing schedule",
        notes: `SCHEDULE: ${t.kind} / ${t.scope}; mark ${row.mark}; QTY column "${t.quantityHeader}" = ${row.quantityText}. ${row.quote || ""} ${rate ? "Catalog budget rate for matching material/unit; dimensions and detailed specification require review." : "No compatible count-unit/material rate: obtain a matching quote; no area rate was applied to a count."}`
      });
    }
  }
  const specs = (evidence.specifications || []).filter((s) => s.accepted);
  const wallFrames = specs.filter((s) => s.scope === "wall" && ["timber_frame", "steel_frame", "frame_unspecified"].includes(family(s.material)));
  if (wallFrames.length && specs.filter((s) => s.scope === "wall").every((s) => ["timber_frame", "steel_frame", "frame_unspecified"].includes(family(s.material)))) {
    items = items.map((i) => /block wall|blockwork|brick wall|masonry wall/.test(norm(i.description)) ? {
      ...i,
      description: `Wall framing \u2014 ${wallFrames.map((s) => `${s.location}: ${s.material}`).join("; ")}`,
      section: wallFrames.every((s) => family(s.material) === "timber_frame") ? "Carpentry" : wallFrames.every((s) => family(s.material) === "steel_frame") ? "Metal Works" : "General",
      quantity: 0,
      rate: 0,
      amount: 0,
      rateMissing: true,
      referenceRate: 0,
      status: "quantity_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      reviewRequired: true,
      quantityBasis: "framing_scope_measurement_pending",
      source: "Drawing general notes",
      notes: `Blockwork assumption replaced by explicit framing specification. Measure each specified wall system separately. ${wallFrames.map((s) => s.quote).join(" ")}`
    } : i);
  }
  const floors = specs.filter((s) => s.scope === "floor");
  const finishFamily = (s) => family(s.material) || norm(s.material);
  const families = [...new Set(floors.map(finishFamily).filter(Boolean))];
  const oldFloors = items.filter((i) => /floor|flooring/.test(norm(i.description)) && ["hardwood", "tile"].includes(family(i.description)));
  if (families.length > 1 || oldFloors.some((i) => !families.includes(family(i.description))) && families.length > 0) {
    const old = oldFloors;
    if (old.length) {
      items = items.filter((i) => !old.includes(i));
      for (const f of families) {
        const relevant = floors.filter((s) => finishFamily(s) === f), c = candidate("floor", relevant[0]?.material, "m2");
        items.push({
          id: `dwg-floor-${f}`,
          itemCode: c?.item_code || `DWG-FLOOR-${f}`,
          section: "Finishes",
          sectionCode: "09",
          description: `${f === "hardwood" ? "Hardwood flooring" : f === "tile" ? "Tile flooring" : `Floor finish: ${relevant.map((s) => s.material).join("; ")}`} \u2014 ${relevant.map((s) => s.location).join("; ")}`,
          unit: "m2",
          quantity: 0,
          rate: 0,
          referenceRate: Number(c?.resolvedRate) || 0,
          amount: 0,
          status: "quantity_pending",
          verification: "pending",
          includeInCommercialTotal: false,
          reviewRequired: true,
          quantityBasis: "room_finish_area_pending",
          source: "Drawing room finish labels",
          notes: `Drawing finish scope: do not apply an unsupported finish to the entire floor area. Measure the listed rooms separately. ${relevant.map((s) => s.quote).join(" ")}`
        });
      }
    }
  }
  const roofNotes = specs.filter((s) => s.scope === "roof" && family(s.material) === "metal_roof");
  if (roofNotes.length) {
    const isCovering = (i) => /roof(?:ing)?|roof covering/.test(norm(i.description)) && /tile|slate|shingle|sheet|covering|standing.seam/.test(norm(i.description)) && !/waterproof|concrete|structur|insulation|truss/.test(norm(i.description));
    items = items.filter((i) => !isCovering(i));
    items.push({
      id: "dwg-roof-covering",
      itemCode: "DWG-ROOF-COVERING",
      section: "Finishes",
      sectionCode: "09",
      description: `Roof covering \u2014 ${roofNotes.map((s) => `${s.location}: ${s.material}`).join("; ")}`,
      unit: "m2",
      quantity: 0,
      rate: 0,
      amount: 0,
      rateMissing: true,
      status: "quantity_pending",
      verification: "pending",
      includeInCommercialTotal: false,
      reviewRequired: true,
      quantityBasis: "roof_covering_area_pending",
      source: "Drawing general notes",
      notes: `Measure the specified roof covering surface and obtain a matching rate; floor area is not roof surface area. ${roofNotes.map((s) => s.quote).join(" ")}`
    });
  }
  return { items, warnings };
}

// src/lib/drawingEvidence.mjs
function getDrawingEvidence(takeoff = {}) {
  return takeoff.drawing_evidence || takeoff.advanced_takeoff?.drawing_evidence || takeoff.raw_result?.drawing_evidence || null;
}

// src/lib/serverBoqAnalysis.js
import { NextResponse as NextResponse4 } from "next/server.js";
import { createClient as createClient3 } from "@supabase/supabase-js";

// src/services/localBoqBuilder.js
function toNumber(value) {
  const number5 = Number(value);
  return Number.isFinite(number5) ? number5 : 0;
}
function round5(value, digits = 2) {
  const factor2 = 10 ** digits;
  return Math.round((toNumber(value) + Number.EPSILON) * factor2) / factor2;
}
function objectValues(input) {
  return input && typeof input === "object" ? input : {};
}
function collectTakeoffSources(input) {
  const sources = [];
  const queue = [input];
  const seen = /* @__PURE__ */ new Set();
  const nestedKeys = [
    "raw_result",
    "takeoff",
    "result",
    "advanced_takeoff",
    "quantities",
    "summary",
    "geometry"
  ];
  while (queue.length > 0 && sources.length < 24) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    sources.push(current);
    for (const key2 of nestedKeys) {
      const nested = current[key2];
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return sources;
}
function firstPositive(sources, keys) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = toNumber(source2?.[key2]);
      if (value > 0) return value;
    }
  }
  return 0;
}
function firstValue(sources, keys, fallback = null) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = source2?.[key2];
      if (value !== void 0 && value !== null && value !== "") return value;
    }
  }
  return fallback;
}
function countDetected(sources, keys) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      const value = source2?.[key2];
      if (Array.isArray(value) && value.length > 0) return value.length;
      const number5 = toNumber(value);
      if (number5 > 0) return number5;
    }
  }
  return 0;
}
function firstArray(sources, keys) {
  for (const source2 of sources) {
    for (const key2 of keys) {
      if (Array.isArray(source2?.[key2]) && source2[key2].length > 0) return source2[key2];
    }
  }
  return [];
}
function getOpeningArea(opening) {
  const direct = toNumber(opening?.area ?? opening?.area_m2 ?? opening?.areaM2);
  if (direct > 0) return direct;
  const width = toNumber(opening?.width_m ?? opening?.widthM ?? opening?.width);
  const height = toNumber(opening?.height_m ?? opening?.heightM ?? opening?.height);
  return width > 0 && height > 0 ? width * height : 0;
}
function getOpeningMetrics(sources, type) {
  const singular = type === "door" ? "door" : "window";
  const plural = `${singular}s`;
  const details = firstArray(sources, [plural, `${singular}_details`, `${singular}Details`]);
  const count = details.length || countDetected(sources, [plural, `${singular}_count`, `${singular}Count`]);
  const explicitArea = firstPositive(sources, [`${singular}_area`, `${singular}Area`, `total_${singular}_area`, `total${singular[0].toUpperCase()}${singular.slice(1)}Area`]);
  const derivedArea = details.reduce((sum, opening) => sum + getOpeningArea(opening), 0);
  return { count, area: explicitArea || derivedArea };
}
function getRoomDetails(sources) {
  for (const source2 of sources) {
    const rooms = source2?.object_details?.rooms;
    if (Array.isArray(rooms) && rooms.length > 0) return rooms;
    if (Array.isArray(source2?.rooms) && source2.rooms.length > 0) return source2.rooms;
  }
  return [];
}
function getRoomPerimeter(sources) {
  return getRoomDetails(sources).reduce(
    (sum, room) => sum + toNumber(room?.perimeter ?? room?.perimeter_m),
    0
  );
}
function createItem({
  itemNumber,
  section,
  description,
  unit: unit5,
  quantity,
  rate,
  source: source2,
  confidence,
  notes = ""
}) {
  return {
    itemNumber,
    section,
    description,
    unit: unit5,
    quantity: round5(quantity),
    rate: round5(rate),
    amount: round5(toNumber(quantity) * toNumber(rate)),
    source: source2,
    confidence: toNumber(confidence),
    notes
  };
}
var DEFAULT_RATES = {
  floorFinish: 95,
  ceilingFinish: 25,
  wallFinish: 22,
  skirting: 18,
  door: 1200,
  window: 650,
  slabConcrete: 350
};
function buildLocalBoq({
  takeoff: inputTakeoff,
  projectName = "Untitled Project",
  vatPercentage = 5
}) {
  const sources = collectTakeoffSources(objectValues(inputTakeoff));
  const items = [];
  const warnings = [];
  let assumptions = [];
  const confidence = firstPositive(sources, ["confidence", "floor_area_confidence"]) || 60;
  const floorArea = firstPositive(sources, [
    "floor_area",
    "floorArea",
    "room_area",
    "roomArea",
    "total_floor_area",
    "totalFloorArea"
  ]);
  const ceilingArea = firstPositive(sources, ["ceiling_area", "ceilingArea"]) || floorArea;
  const wallArea = firstPositive(sources, ["wall_area", "wallArea", "total_wall_area", "totalWallArea"]);
  const wallLength = firstPositive(sources, ["wall_length", "wallLength", "total_wall_length", "totalWallLength"]);
  const roomPerimeter = getRoomPerimeter(sources);
  const doorMetrics = getOpeningMetrics(sources, "door");
  const windowMetrics = getOpeningMetrics(sources, "window");
  const doors = doorMetrics.count;
  const windows = windowMetrics.count;
  const totalOpeningArea = doorMetrics.area + windowMetrics.area;
  const netWallArea = wallArea > 0 && totalOpeningArea > 0 ? Math.max(0, wallArea - totalOpeningArea) : wallArea;
  assumptions = [
    "Rates are editable starter budget rates in AED and must be reviewed before quotation or contract use.",
    totalOpeningArea > 0 ? `Wall finishes use net wall area after deducting ${round5(totalOpeningArea)} m\xB2 of measured openings.` : "Wall finishes use gross wall area because opening dimensions are unavailable."
  ];
  const slabVolume = firstPositive(sources, ["slab_volume", "slabVolume"]);
  const skirtingLength = Math.max(0, roomPerimeter || wallLength || 0);
  const floorSource = firstValue(sources, ["floor_area_source", "floorAreaSource"], "quantity_takeoff");
  const wallAreaEstimated = Boolean(firstValue(sources, ["wall_area_estimated", "wallAreaEstimated"], false));
  if (floorArea > 0) {
    items.push(createItem({
      itemNumber: "08.01",
      section: "Finishes",
      description: "Floor finish allowance",
      unit: "m\xB2",
      quantity: floorArea,
      rate: DEFAULT_RATES.floorFinish,
      source: floorSource,
      confidence,
      notes: "Replace the allowance description and rate with the selected floor material."
    }));
  }
  if (ceilingArea > 0) {
    items.push(createItem({
      itemNumber: "08.02",
      section: "Finishes",
      description: "Ceiling finish / paint allowance",
      unit: "m\xB2",
      quantity: ceilingArea,
      rate: DEFAULT_RATES.ceilingFinish,
      source: ceilingArea !== floorArea ? "quantity_takeoff" : "derived_from_floor_area",
      confidence: ceilingArea !== floorArea ? confidence : Math.min(confidence, 70)
    }));
  }
  if (wallArea > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Internal cement sand plaster to walls",
      unit: "m\xB2",
      quantity: netWallArea,
      rate: 27,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable."
    }));
    items.push(createItem({
      itemNumber: "09.01",
      section: "Painting",
      description: "Internal wall emulsion paint including primer and finishing coats",
      unit: "m\xB2",
      quantity: netWallArea,
      rate: DEFAULT_RATES.wallFinish,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable."
    }));
  } else if (wallLength > 0) {
    warnings.push("Wall area is unavailable, so wall paint was not added. Confirm wall height and regenerate the takeoff.");
  }
  if (skirtingLength > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Skirting allowance",
      unit: "m",
      quantity: skirtingLength,
      rate: DEFAULT_RATES.skirting,
      source: roomPerimeter > 0 ? "room_perimeter" : "wall_length",
      confidence: roomPerimeter > 0 ? confidence : Math.min(confidence, 70),
      notes: "Door widths have not been deducted because opening widths are not available."
    }));
  }
  if (doors > 0) {
    items.push(createItem({
      itemNumber: "07.01",
      section: "Doors & Windows",
      description: "Door set allowance",
      unit: "nos",
      quantity: doors,
      rate: DEFAULT_RATES.door,
      source: "quantity_takeoff",
      confidence
    }));
  }
  if (windows > 0 || windowMetrics.area > 0) {
    const measuredByArea = windowMetrics.area > 0;
    items.push(createItem({
      itemNumber: "07.02",
      section: "Doors & Windows",
      description: measuredByArea ? "Aluminium framed glazed windows measured by area" : "Aluminium framed glazed window set allowance",
      unit: measuredByArea ? "m\xB2" : "nos",
      quantity: measuredByArea ? windowMetrics.area : windows,
      rate: measuredByArea ? 750 : DEFAULT_RATES.window,
      source: measuredByArea ? "measured_opening_area" : "quantity_takeoff_count",
      confidence,
      notes: measuredByArea ? "Quantity is total detected window area." : "Dimensions unavailable; priced per detected window."
    }));
  }
  if (slabVolume > 0) {
    items.push(createItem({
      itemNumber: "03.01",
      section: "Concrete",
      description: "Concrete slab allowance",
      unit: "m\xB3",
      quantity: slabVolume,
      rate: DEFAULT_RATES.slabConcrete,
      source: "quantity_takeoff",
      confidence
    }));
  }
  if (items.length === 0) {
    warnings.push("No measurable floor, wall, opening, or slab quantities were found in the latest takeoff.");
  }
  const subtotal = round5(items.reduce((sum, item) => sum + item.amount, 0));
  const vat = round5(subtotal * (toNumber(vatPercentage) / 100));
  return {
    projectName,
    currency: "AED",
    vatPercentage: toNumber(vatPercentage),
    items,
    warnings,
    assumptions,
    summary: { subtotal, vat, grandTotal: round5(subtotal + vat) },
    generatedBy: "Ventra deterministic BOQ fallback",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/services/aiBoqScopeService.js
var MODEL2 = process.env.OPENAI_BOQ_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5";
function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}
function compactRoom(room) {
  const bbox2 = room?.regionBBox && typeof room.regionBBox === "object" && Number.isFinite(
    Number(
      room.regionBBox.x
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.y
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.width
    )
  ) && Number.isFinite(
    Number(
      room.regionBBox.height
    )
  ) && Number(
    room.regionBBox.width
  ) > 0 && Number(
    room.regionBBox.height
  ) > 0 ? {
    x: Number(
      room.regionBBox.x
    ),
    y: Number(
      room.regionBBox.y
    ),
    width: Number(
      room.regionBBox.width
    ),
    height: Number(
      room.regionBBox.height
    )
  } : null;
  const rawCentroidX = room?.centroid?.x;
  const rawCentroidY = room?.centroid?.y;
  const directX = rawCentroidX !== null && rawCentroidX !== void 0 && rawCentroidX !== "" && Number.isFinite(
    Number(rawCentroidX)
  ) ? Number(rawCentroidX) : null;
  const directY = rawCentroidY !== null && rawCentroidY !== void 0 && rawCentroidY !== "" && Number.isFinite(
    Number(rawCentroidY)
  ) ? Number(rawCentroidY) : null;
  const centroid = directX !== null && directY !== null ? {
    x: directX,
    y: directY,
    coordinateSystem: room?.centroid?.coordinateSystem || "viewer_sheet_normalized",
    source: room?.centroid?.source || "semantic_room"
  } : bbox2 ? {
    x: bbox2.x + bbox2.width / 2,
    y: bbox2.y + bbox2.height / 2,
    coordinateSystem: "viewer_sheet_normalized",
    source: "region_bbox_center"
  } : null;
  return {
    name: String(
      room?.name || room?.label || "Room"
    ),
    type: String(
      room?.roomType || room?.detectedType || room?.type || "room"
    ),
    area: Number(room?.area) || 0,
    perimeter: Number(
      room?.perimeter
    ) || 0,
    confidence: Number(
      room?.roomTypeConfidence
    ) || Number(
      room?.confidence
    ) || 0,
    centroid,
    regionBBox: bbox2,
    planId: room?.planId || null,
    planTitle: room?.planTitle || null,
    spatialSource: room?.source || null,
    geometrySource: room?.geometrySource || null,
    geometryPolygonId: room?.geometryPolygonId || null,
    areaEstimated: room?.areaEstimated === true,
    perimeterEstimated: room?.perimeterEstimated === true
  };
}
function uniqueStrings(values) {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean)
    )
  ];
}
var scopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scopes", "catalog_search_terms"],
  properties: {
    scopes: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "room_type",
          "trade",
          "work",
          "quantity_basis",
          "reason"
        ],
        properties: {
          room_type: { type: "string" },
          trade: { type: "string" },
          work: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review"
            ]
          },
          reason: { type: "string" }
        }
      }
    },
    catalog_search_terms: {
      type: "array",
      maxItems: 100,
      items: { type: "string" }
    }
  }
};
var matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "item_code",
          "quantity_basis",
          "room_type",
          "reason"
        ],
        properties: {
          item_code: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review"
            ]
          },
          room_type: { type: "string" },
          reason: { type: "string" }
        }
      }
    }
  }
};
function responseJson(response) {
  const text3 = response?.output_text || response?.output?.flatMap((item) => item?.content || [])?.find((item) => item?.type === "output_text")?.text;
  if (!text3) {
    throw new Error("AI BOQ scope engine returned no JSON.");
  }
  return JSON.parse(text3);
}
function getSemanticRooms(rawTakeoff) {
  const rooms = rawTakeoff?.object_details?.rooms;
  return Array.isArray(rooms) ? rooms.map(compactRoom) : [];
}
function hydrateSemanticRoomQuantities(rooms, takeoff) {
  const list2 = Array.isArray(rooms) ? rooms.map(
    (room) => {
      const rawX = room?.centroid?.x;
      const rawY = room?.centroid?.y;
      const x = rawX !== null && rawX !== void 0 && rawX !== "" && Number.isFinite(
        Number(rawX)
      ) ? Number(rawX) : null;
      const y = rawY !== null && rawY !== void 0 && rawY !== "" && Number.isFinite(
        Number(rawY)
      ) ? Number(rawY) : null;
      return {
        ...room,
        centroid: x !== null && y !== null ? {
          ...room.centroid,
          x,
          y
        } : null
      };
    }
  ) : [];
  const floorArea = Number(takeoff?.floor_area) || 0;
  if (list2.length === 0 || floorArea <= 0) {
    return {
      rooms: list2,
      applied: false,
      source: "unavailable"
    };
  }
  const alreadyMeasured = list2.every(
    (room) => Number(room?.area) > 0
  );
  if (alreadyMeasured) {
    return {
      rooms: list2,
      applied: false,
      source: "existing_room_quantities"
    };
  }
  const hasCentroids = list2.every(
    (room) => Number.isFinite(
      Number(
        room?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        room?.centroid?.y
      )
    )
  );
  if (!hasCentroids) {
    const equalArea = floorArea / list2.length;
    return {
      rooms: list2.map((room) => ({
        ...room,
        area: Number(
          equalArea.toFixed(2)
        ),
        perimeter: Number(
          (4 * Math.sqrt(equalArea)).toFixed(2)
        ),
        areaEstimated: true,
        perimeterEstimated: true,
        quantitySource: "equal_distribution_of_autodesk_floor_area"
      })),
      applied: true,
      source: "equal_distribution_of_autodesk_floor_area"
    };
  }
  const gridSize = 140;
  const counts = new Array(list2.length).fill(0);
  for (let gy = 0; gy < gridSize; gy += 1) {
    const y = (gy + 0.5) / gridSize;
    for (let gx = 0; gx < gridSize; gx += 1) {
      const x = (gx + 0.5) / gridSize;
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < list2.length; index += 1) {
        const dx = x - Number(
          list2[index].centroid.x
        );
        const dy = y - Number(
          list2[index].centroid.y
        );
        const distance7 = dx * dx + dy * dy;
        if (distance7 < bestDistance) {
          bestDistance = distance7;
          bestIndex = index;
        }
      }
      counts[bestIndex] += 1;
    }
  }
  const totalCells = gridSize * gridSize;
  let assigned = 0;
  const hydrated = list2.map(
    (room, index) => {
      let area4;
      if (index === list2.length - 1) {
        area4 = floorArea - assigned;
      } else {
        area4 = floorArea * (counts[index] / totalCells);
        assigned += area4;
      }
      area4 = Math.max(
        0,
        area4
      );
      return {
        ...room,
        area: Number(
          area4.toFixed(2)
        ),
        perimeter: Number(
          (4 * Math.sqrt(area4)).toFixed(2)
        ),
        areaEstimated: true,
        perimeterEstimated: true,
        quantitySource: "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
      };
    }
  );
  return {
    rooms: hydrated,
    applied: true,
    source: "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
  };
}
async function inferConstructionScopes({
  rooms,
  takeoff
}) {
  if (!rooms.length) {
    return {
      scopes: [],
      catalog_search_terms: []
    };
  }
  const response = await createResponse({
    model: MODEL2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are Ventra's construction scope planner. Read semantic room labels detected from the drawing and decide which normal construction work scopes apply to each room type. Do not invent dimensions, quantities, room names, or products. Do not price anything. Examples: a kitchen can require suitable floor finish, wall finish/backsplash, ceiling finish, plumbing fixtures/points, cabinetry and electrical work; a bathroom can require waterproofing, floor/wall finishes, sanitary/plumbing, ceiling, exhaust and electrical work; bedrooms/living rooms typically require plaster/paint/ceiling/floor/skirting/electrical as applicable. Treat these as reasoning examples, not hard-coded rules. quantity_basis must describe how a downstream deterministic quantity engine could measure the work. Use manual_review when the drawing/takeoff does not contain enough measurable evidence."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              detected_rooms: rooms,
              measured_takeoff: {
                rooms: takeoff.rooms,
                floor_area: takeoff.floor_area,
                ceiling_area: takeoff.ceiling_area,
                wall_area: takeoff.wall_area,
                wall_length: takeoff.wall_length,
                opening_area: takeoff.opening_area,
                doors: takeoff.doors,
                windows: takeoff.windows,
                electrical_items: takeoff.electrical_items
              }
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_room_scope_plan",
        strict: true,
        schema: scopeSchema
      }
    }
  });
  return responseJson(response);
}
function shortlistPriceCatalog(prices, searchTerms, limit = 500) {
  const terms = uniqueStrings(searchTerms).flatMap((value) => {
    const normalized2 = normalizeText(value);
    const words2 = normalized2.split(/[^a-z0-9]+/i).filter((word) => word.length >= 4);
    return [normalized2, ...words2];
  }).filter((term2) => term2.length >= 3);
  if (!terms.length) {
    return [];
  }
  const scored = prices.map((item) => {
    const haystack = normalizeText(
      [
        item.item_code,
        item.description,
        item.category,
        item.sub_category,
        item.unit
      ].join(" ")
    );
    let score = 0;
    for (const term2 of terms) {
      if (haystack.includes(term2)) {
        score += term2.includes(" ") ? 4 : 1;
      }
    }
    return { item, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ item }) => ({
    item_code: item.item_code,
    description: item.description,
    category: item.category,
    sub_category: item.sub_category,
    unit: item.unit
  }));
}
async function matchScopesToCatalog({
  scopes,
  candidates
}) {
  if (!scopes.length || !candidates.length) {
    return { matches: [] };
  }
  const response = await createResponse({
    model: MODEL2,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Match Ventra construction scopes to the supplied UAE price catalog. You may ONLY return item_code values that exist in catalog_candidates. Match by actual construction meaning and compatible unit/quantity basis. Never invent an item code. Do not match an m2 scope to an item/lm/m3 price unless the basis is genuinely compatible. Prefer no match over a wrong match. Avoid duplicate item codes unless they apply to genuinely different room-specific measured quantities."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              scopes,
              catalog_candidates: candidates
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_scope_catalog_matches",
        strict: true,
        schema: matchSchema
      }
    }
  });
  return responseJson(response);
}
function countRoomsByType(rooms, roomType) {
  const target = normalizeText(roomType);
  return rooms.filter(
    (room) => normalizeText(room.type) === target
  ).length;
}
function sumRoomMetric(rooms, roomType, field) {
  const target = normalizeText(roomType);
  return rooms.reduce((sum, room) => {
    if (normalizeText(room.type) !== target) {
      return sum;
    }
    return sum + (Number(room[field]) || 0);
  }, 0);
}
function resolveAiQuantity({
  match,
  rooms,
  takeoff
}) {
  const basis = match.quantity_basis;
  const roomType = normalizeText(
    match.room_type
  );
  const isRoomSpecific = Boolean(roomType) && ![
    "all",
    "all_rooms",
    "building",
    "general",
    "project",
    "whole_building",
    "whole project"
  ].includes(roomType);
  const roomTypeCount = isRoomSpecific ? countRoomsByType(
    rooms,
    roomType
  ) : 0;
  const roomTypeFloorArea = isRoomSpecific ? sumRoomMetric(
    rooms,
    roomType,
    "area"
  ) : 0;
  const roomTypePerimeter = isRoomSpecific ? sumRoomMetric(
    rooms,
    roomType,
    "perimeter"
  ) : 0;
  const totalRoomPerimeter = rooms.reduce(
    (sum, room) => sum + (Number(
      room?.perimeter
    ) || 0),
    0
  );
  const buildingNetWallArea = Math.max(
    0,
    (Number(
      takeoff.wall_area
    ) || 0) - (Number(
      takeoff.opening_area
    ) || 0)
  );
  if (isRoomSpecific) {
    switch (basis) {
      case "room_type_count":
      case "room_count":
        return roomTypeCount;
      case "room_type_floor_area":
      case "floor_area":
      case "ceiling_area":
        return roomTypeFloorArea;
      case "room_type_perimeter":
        return roomTypePerimeter;
      case "net_wall_area":
        if (roomTypePerimeter > 0 && totalRoomPerimeter > 0 && buildingNetWallArea > 0) {
          return buildingNetWallArea * (roomTypePerimeter / totalRoomPerimeter);
        }
        return 0;
      case "door_count":
      case "window_count":
      case "electrical_items":
      case "manual_review":
      default:
        return 0;
    }
  }
  switch (basis) {
    case "floor_area":
      return Number(
        takeoff.floor_area
      ) || 0;
    case "ceiling_area":
      return Number(
        takeoff.ceiling_area
      ) || 0;
    case "net_wall_area":
      return buildingNetWallArea;
    case "door_count":
      return Number(
        takeoff.doors
      ) || 0;
    case "window_count":
      return Number(
        takeoff.windows
      ) || 0;
    case "electrical_items":
      return Number(
        takeoff.electrical_items
      ) || 0;
    case "room_count":
      return Number(
        takeoff.rooms
      ) || rooms.length || 0;
    case "room_type_count":
    case "room_type_floor_area":
    case "room_type_perimeter":
    case "manual_review":
    default:
      return 0;
  }
}

// src/lib/serverBoqAnalysis.js
function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key2 = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }
  if (!key2) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local."
    );
  }
  return createClient3(url, key2, {
    db: {
      schema: "public"
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
function toNumber2(value) {
  const number5 = Number(value);
  return Number.isFinite(number5) ? number5 : 0;
}
function round6(value, precision = 2) {
  const factor2 = 10 ** precision;
  return Math.round(
    (toNumber2(value) + Number.EPSILON) * factor2
  ) / factor2;
}
function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}
function normalizeTakeoff(rawTakeoff) {
  const takeoff = rawTakeoff?.pdf_analysis && rawTakeoff?.page_results?.length ? { ...rawTakeoff, ...mergePdfEvidence(rawTakeoff.page_results, rawTakeoff.failed_pages || [], rawTakeoff.total_pages) } : rawTakeoff || {};
  const doors = toNumber2(
    takeoff.doors ?? takeoff.door_count ?? takeoff.doorCount
  );
  const windows = toNumber2(
    takeoff.windows ?? takeoff.window_count ?? takeoff.windowCount
  );
  const measuredDoorArea = toNumber2(
    takeoff.door_area ?? takeoff.doorArea
  );
  const measuredWindowArea = toNumber2(
    takeoff.window_area ?? takeoff.windowArea
  );
  const measuredOpeningArea = toNumber2(
    takeoff.opening_area ?? takeoff.openingArea
  );
  const estimatedDoorArea = measuredDoorArea > 0 ? measuredDoorArea : !takeoff.pdf_analysis && doors > 0 ? doors * 1.89 : 0;
  const estimatedWindowArea = measuredWindowArea > 0 ? measuredWindowArea : !takeoff.pdf_analysis && windows > 0 ? windows * 1.44 : 0;
  const resolvedOpeningArea = measuredOpeningArea > 0 ? measuredOpeningArea : estimatedDoorArea + estimatedWindowArea;
  return {
    pdf_analysis: takeoff.pdf_analysis || (/pdf/i.test(takeoff.document_type || "") || /\.pdf$/i.test(takeoff.document_name || "") ? { version: 0, requiresReanalysis: true, quantity_evidence: {} } : null),
    scheduled_quantities: takeoff.scheduled_quantities || {},
    page_results: takeoff.pdf_analysis && Array.isArray(takeoff.page_results) ? takeoff.page_results : [],
    rooms: toNumber2(
      takeoff.rooms ?? takeoff.room_count ?? takeoff.roomCount
    ),
    doors,
    windows,
    walls: toNumber2(takeoff.walls),
    floors: toNumber2(takeoff.floors),
    slabs: toNumber2(takeoff.slabs),
    ceilings: toNumber2(takeoff.ceilings),
    columns: toNumber2(takeoff.columns),
    beams: toNumber2(takeoff.beams),
    foundations: toNumber2(takeoff.foundations),
    stairs: toNumber2(takeoff.stairs),
    ramps: toNumber2(takeoff.ramps),
    roofs: toNumber2(takeoff.roofs),
    pipes: toNumber2(takeoff.pipes),
    ducts: toNumber2(takeoff.ducts),
    electrical_items: toNumber2(
      takeoff.electrical_items ?? takeoff.electricalItems
    ),
    lighting_points: toNumber2(takeoff.lighting_points ?? takeoff.lightingPoints),
    socket_points: toNumber2(takeoff.socket_points ?? takeoff.socketPoints),
    switches: toNumber2(takeoff.switches),
    distribution_boards: toNumber2(takeoff.distribution_boards ?? takeoff.distributionBoards),
    other_electrical: toNumber2(takeoff.other_electrical ?? takeoff.otherElectrical),
    wall_length: toNumber2(
      takeoff.wall_length ?? takeoff.wallLength
    ),
    wall_area: toNumber2(
      takeoff.wall_area ?? takeoff.wallArea
    ),
    wall_volume: toNumber2(
      takeoff.wall_volume ?? takeoff.wallVolume
    ),
    room_area: toNumber2(
      takeoff.room_area ?? takeoff.roomArea
    ),
    floor_area: toNumber2(
      takeoff.floor_area ?? takeoff.floorArea ?? takeoff.slab_area ?? takeoff.slabArea
    ),
    wet_floor_area: toNumber2(takeoff.wet_floor_area ?? takeoff.wetFloorArea),
    wet_room_perimeter: toNumber2(takeoff.wet_room_perimeter ?? takeoff.wetRoomPerimeter),
    bathroom_floor_area: toNumber2(takeoff.bathroom_floor_area ?? takeoff.bathroomFloorArea),
    bathroom_perimeter: toNumber2(takeoff.bathroom_perimeter ?? takeoff.bathroomPerimeter),
    toilet_floor_area: toNumber2(takeoff.toilet_floor_area ?? takeoff.toiletFloorArea),
    toilet_perimeter: toNumber2(takeoff.toilet_perimeter ?? takeoff.toiletPerimeter),
    kitchen_floor_area: toNumber2(takeoff.kitchen_floor_area ?? takeoff.kitchenFloorArea),
    kitchen_perimeter: toNumber2(takeoff.kitchen_perimeter ?? takeoff.kitchenPerimeter),
    laundry_floor_area: toNumber2(takeoff.laundry_floor_area ?? takeoff.laundryFloorArea),
    laundry_perimeter: toNumber2(takeoff.laundry_perimeter ?? takeoff.laundryPerimeter),
    balcony_floor_area: toNumber2(takeoff.balcony_floor_area ?? takeoff.balconyFloorArea),
    balcony_perimeter: toNumber2(takeoff.balcony_perimeter ?? takeoff.balconyPerimeter),
    slab_area: toNumber2(
      takeoff.slab_area ?? takeoff.slabArea
    ),
    slab_volume: toNumber2(
      takeoff.slab_volume ?? takeoff.slabVolume
    ),
    ceiling_area: toNumber2(
      takeoff.ceiling_area ?? takeoff.ceilingArea ?? takeoff.floor_area ?? takeoff.floorArea
    ),
    column_volume: toNumber2(
      takeoff.column_volume ?? takeoff.columnVolume
    ),
    beam_volume: toNumber2(
      takeoff.beam_volume ?? takeoff.beamVolume
    ),
    foundation_volume: toNumber2(
      takeoff.foundation_volume ?? takeoff.foundationVolume
    ),
    column_formwork_area: toNumber2(
      takeoff.column_formwork_area ?? takeoff.columnFormworkArea
    ),
    beam_formwork_area: toNumber2(
      takeoff.beam_formwork_area ?? takeoff.beamFormworkArea
    ),
    foundation_formwork_area: toNumber2(
      takeoff.foundation_formwork_area ?? takeoff.foundationFormworkArea
    ),
    slab_formwork_area: toNumber2(
      takeoff.slab_formwork_area ?? takeoff.slabFormworkArea
    ),
    structural_measurement_status: takeoff.structural_measurement_status && typeof takeoff.structural_measurement_status === "object" ? takeoff.structural_measurement_status : null,
    roof_area: toNumber2(
      takeoff.roof_area ?? takeoff.roofArea
    ),
    pipe_length: toNumber2(
      takeoff.pipe_length ?? takeoff.pipeLength
    ),
    duct_length: toNumber2(
      takeoff.duct_length ?? takeoff.ductLength
    ),
    opening_area: round6(
      resolvedOpeningArea,
      2
    ),
    door_area: round6(
      estimatedDoorArea,
      2
    ),
    window_area: round6(
      measuredWindowArea,
      2
    ),
    opening_area_estimated: measuredOpeningArea <= 0 && (measuredDoorArea <= 0 || measuredWindowArea <= 0) && resolvedOpeningArea > 0,
    opening_area_source: measuredOpeningArea > 0 ? "takeoff_measured" : resolvedOpeningArea > 0 ? "verified_counts_with_standard_dimensions" : "unavailable",
    confidence: toNumber2(
      takeoff.confidence
    ),
    notes: String(
      takeoff.notes || ""
    )
  };
}
function getGeometryValue(rule, takeoff) {
  const geometryType = String(
    rule.geometry_type || ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const property = String(
    rule.geometry_property || ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (geometryType === "room" && ["", "count", "room_count", "rooms"].includes(property)) {
    return takeoff.rooms;
  }
  if (geometryType === "door" && ["", "count", "door_count", "doors"].includes(property)) {
    return takeoff.doors;
  }
  if (geometryType === "window" && ["", "count", "window_count", "windows"].includes(property)) {
    return takeoff.windows;
  }
  if (geometryType === "wall" && ["area", "wall_area"].includes(property)) {
    return takeoff.wall_area;
  }
  if (geometryType === "wall" && ["length", "wall_length", "perimeter"].includes(property)) {
    return takeoff.wall_length;
  }
  if (["floor", "slab"].includes(geometryType) && ["", "area", "floor_area", "slab_area"].includes(property)) {
    return takeoff.floor_area;
  }
  if (geometryType === "ceiling" && ["", "area", "ceiling_area"].includes(property)) {
    return takeoff.ceiling_area;
  }
  if (property === "room_count" || property === "rooms") {
    return takeoff.rooms;
  }
  if (property === "door_count" || property === "doors") {
    return takeoff.doors;
  }
  if (property === "window_count" || property === "windows") {
    return takeoff.windows;
  }
  if (property === "window_area") {
    return takeoff.window_area || 0;
  }
  if (property === "door_area") {
    return takeoff.door_area || takeoff.doors;
  }
  if (property === "floor_area" || property === "slab_area") {
    return takeoff.floor_area;
  }
  if (property === "ceiling_area") {
    return takeoff.ceiling_area;
  }
  if (property === "opening_area") {
    return takeoff.opening_area;
  }
  const countByGeometryType = {
    wall: takeoff.walls,
    floor: takeoff.floors,
    slab: takeoff.slabs,
    ceiling: takeoff.ceilings,
    column: takeoff.columns,
    beam: takeoff.beams,
    foundation: takeoff.foundations,
    stair: takeoff.stairs,
    ramp: takeoff.ramps,
    roof: takeoff.roofs,
    pipe: takeoff.pipes,
    duct: takeoff.ducts,
    electrical: takeoff.electrical_items
  };
  if (Object.prototype.hasOwnProperty.call(
    countByGeometryType,
    geometryType
  ) && ["", "count", `${geometryType}_count`, `${geometryType}s`].includes(property)) {
    return toNumber2(
      countByGeometryType[geometryType]
    );
  }
  if (geometryType === "wall" && property === "volume") {
    return takeoff.wall_volume;
  }
  if (geometryType === "slab") {
    if (["area", "slab_area"].includes(property)) {
      return takeoff.slab_area || takeoff.floor_area;
    }
    if (["volume", "slab_volume"].includes(property)) {
      return takeoff.slab_volume;
    }
  }
  if (geometryType === "column" && ["volume", "column_volume"].includes(property)) {
    return takeoff.column_volume;
  }
  if (geometryType === "beam" && ["volume", "beam_volume"].includes(property)) {
    return takeoff.beam_volume;
  }
  if (geometryType === "foundation" && ["volume", "foundation_volume"].includes(property)) {
    return takeoff.foundation_volume;
  }
  if (geometryType === "roof" && ["area", "roof_area"].includes(property)) {
    return takeoff.roof_area;
  }
  if (geometryType === "pipe" && ["length", "pipe_length"].includes(property)) {
    return takeoff.pipe_length;
  }
  if (geometryType === "duct" && ["length", "duct_length"].includes(property)) {
    return takeoff.duct_length;
  }
  if (geometryType === "electrical" && ["", "count", "electrical_count", "electrical_items"].includes(property)) {
    return takeoff.electrical_items;
  }
  if (property && Object.prototype.hasOwnProperty.call(
    takeoff,
    property
  )) {
    return toNumber2(
      takeoff[property]
    );
  }
  return 0;
}
function calculateQuantity(rule, takeoff) {
  const itemCode = normalizeCode(
    rule?.item_code
  );
  const measuredElectrical = {
    "ELE-001": toNumber2(
      takeoff?.lighting_points
    ),
    "ELE-002": toNumber2(
      takeoff?.socket_points
    ),
    "ELE-003": toNumber2(
      takeoff?.switches
    ),
    "ELE-004": toNumber2(
      takeoff?.distribution_boards
    )
  };
  if (Object.prototype.hasOwnProperty.call(
    measuredElectrical,
    itemCode
  )) {
    const measuredQuantity = measuredElectrical[itemCode];
    console.log(
      "[VENTRA ELECTRICAL BOQ v26.1]",
      {
        item: itemCode,
        measuredQuantity,
        source: "takeoff_electrical_subtype_count"
      }
    );
    return round6(
      measuredQuantity,
      Number.isInteger(
        rule.rounding_precision
      ) ? rule.rounding_precision : 2
    );
  }
  const formulaType = String(
    rule.formula_type || "multiply"
  ).toLowerCase();
  const multiplier = toNumber2(rule.multiplier) || 1;
  const openingMultiplier = toNumber2(
    rule.opening_multiplier
  ) || 1;
  const baseValue = getGeometryValue(
    rule,
    takeoff
  );
  let quantity = 0;
  switch (formulaType) {
    case "direct":
    case "count":
    case "multiply":
      quantity = baseValue * multiplier;
      break;
    case "wall_net_area": {
      const openingArea = takeoff.opening_area || takeoff.door_area + takeoff.window_area;
      quantity = Math.max(
        0,
        takeoff.wall_area - openingArea * openingMultiplier
      ) * multiplier;
      break;
    }
    case "wall_both_sides": {
      const openingArea = takeoff.opening_area || takeoff.door_area + takeoff.window_area;
      quantity = Math.max(
        0,
        takeoff.wall_area - openingArea * openingMultiplier
      ) * multiplier;
      break;
    }
    case "perimeter":
      quantity = takeoff.wall_length * multiplier;
      break;
    case "manual":
    default:
      quantity = 0;
      break;
  }
  const minimumQuantity = toNumber2(
    rule.minimum_quantity
  );
  if (quantity > 0 && quantity < minimumQuantity) {
    quantity = minimumQuantity;
  }
  return round6(
    quantity,
    Number.isInteger(
      rule.rounding_precision
    ) ? rule.rounding_precision : 2
  );
}
function directRateCandidates(priceItem) {
  const componentRate = toNumber2(
    priceItem?.material_rate
  ) + toNumber2(
    priceItem?.labor_rate
  ) + toNumber2(
    priceItem?.equipment_rate
  ) + toNumber2(
    priceItem?.transport_rate
  );
  return {
    economy: toNumber2(
      priceItem?.economy_rate
    ),
    standard: toNumber2(
      priceItem?.standard_rate
    ),
    premium: toNumber2(
      priceItem?.premium_rate
    ),
    component: componentRate
  };
}
function chooseDirectRate(priceItem, priceLevel) {
  const rates = directRateCandidates(
    priceItem
  );
  const level = String(
    priceLevel || "standard"
  ).toLowerCase();
  const preferredOrder = level === "economy" ? [
    ["economy", rates.economy],
    ["standard", rates.standard],
    ["premium", rates.premium],
    ["component", rates.component]
  ] : level === "premium" ? [
    ["premium", rates.premium],
    ["standard", rates.standard],
    ["economy", rates.economy],
    ["component", rates.component]
  ] : [
    ["standard", rates.standard],
    ["economy", rates.economy],
    ["premium", rates.premium],
    ["component", rates.component]
  ];
  for (const [source2, value] of preferredOrder) {
    if (Number(value) > 0) {
      return {
        rate: Number(value),
        source: source2 === level ? `direct_${source2}_rate` : `fallback_${source2}_rate`
      };
    }
  }
  return {
    rate: 0,
    source: "missing_direct_rate"
  };
}
function normalizeRateUnit(value) {
  return String(
    value || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
}
function median(values) {
  const sorted = values.filter(
    (value) => Number.isFinite(
      Number(value)
    ) && Number(value) > 0
  ).map(Number).sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(
    sorted.length / 2
  );
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
function resolveRate(priceItem, priceLevel, allPriceItems) {
  const direct = chooseDirectRate(
    priceItem,
    priceLevel
  );
  if (direct.rate > 0) {
    return {
      ...direct,
      peerCount: 0,
      missingRate: false
    };
  }
  const unit5 = normalizeRateUnit(
    priceItem?.unit
  );
  const category = String(
    priceItem?.category || ""
  ).trim().toLowerCase();
  const subCategory = String(
    priceItem?.sub_category || ""
  ).trim().toLowerCase();
  const sectionCode = String(
    priceItem?.section_code || ""
  ).trim().toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).trim().toLowerCase();
  const candidates = (Array.isArray(
    allPriceItems
  ) ? allPriceItems : []).filter(
    (item) => item && item !== priceItem && normalizeRateUnit(
      item.unit
    ) === unit5
  ).map((item) => {
    let score = 0;
    const itemCategory = String(
      item.category || ""
    ).trim().toLowerCase();
    const itemSubCategory = String(
      item.sub_category || ""
    ).trim().toLowerCase();
    const itemSectionCode = String(
      item.section_code || ""
    ).trim().toLowerCase();
    if (category && itemCategory === category) {
      score += 4;
    }
    if (subCategory && itemSubCategory === subCategory) {
      score += 5;
    }
    if (sectionCode && itemSectionCode === sectionCode) {
      score += 3;
    }
    const itemDescription = String(
      item.description || ""
    ).toLowerCase();
    const keywords = description.split(
      /[^a-z0-9]+/
    ).filter(
      (word) => word.length >= 4
    );
    const overlap2 = keywords.filter(
      (word) => itemDescription.includes(
        word
      )
    ).length;
    score += Math.min(
      overlap2,
      4
    );
    const directPeer = chooseDirectRate(
      item,
      priceLevel
    );
    return {
      item,
      score,
      rate: directPeer.rate
    };
  }).filter(
    (candidate) => candidate.rate > 0 && candidate.score >= 4
  ).sort(
    (a, b) => b.score - a.score
  );
  if (candidates.length > 0) {
    const bestScore = candidates[0].score;
    const closePeers = candidates.filter(
      (candidate) => candidate.score >= Math.max(
        4,
        bestScore - 2
      )
    ).slice(
      0,
      15
    );
    const peerMedian = median(
      closePeers.map(
        (candidate) => candidate.rate
      )
    );
    if (peerMedian > 0) {
      return {
        rate: peerMedian,
        source: "peer_database_median_rate",
        peerCount: closePeers.length,
        missingRate: false
      };
    }
  }
  const pricedPeers = (Array.isArray(
    allPriceItems
  ) ? allPriceItems : []).filter(
    (item) => item && item !== priceItem && normalizeRateUnit(
      item.unit
    ) === unit5
  ).map((item) => ({
    rate: chooseDirectRate(
      item,
      priceLevel
    ).rate,
    category: String(
      item.category || ""
    ).trim().toLowerCase(),
    subCategory: String(
      item.sub_category || ""
    ).trim().toLowerCase(),
    sectionCode: String(
      item.section_code || ""
    ).trim().toLowerCase()
  })).filter(
    (peer) => peer.rate > 0
  );
  if (String(
    priceItem?.item_code || ""
  ).trim().toUpperCase() === "TIL-007" || /(tile skirting|skirting|wall base|base trim)/.test(
    description
  )) {
    const skirtingPeers = pricedPeers.filter(
      (peer) => {
        const peerDescription = String(
          peer?.item?.description || ""
        ).toLowerCase();
        return /(tile skirting|skirting|wall base|base trim)/.test(
          peerDescription
        ) && Number(
          peer.rate
        ) > 0;
      }
    );
    const skirtingMedian = median(
      skirtingPeers.map(
        (peer) => peer.rate
      )
    );
    if (skirtingMedian > 0) {
      return {
        rate: skirtingMedian,
        source: "skirting_database_median_rate",
        peerCount: skirtingPeers.length,
        missingRate: false
      };
    }
    const sectionLinearPeers = pricedPeers.filter(
      (peer) => sectionCode && peer.sectionCode === sectionCode
    );
    const sectionLinearMedian = median(
      sectionLinearPeers.map(
        (peer) => peer.rate
      )
    );
    if (sectionLinearMedian > 0) {
      return {
        rate: sectionLinearMedian,
        source: "skirting_section_linear_median_rate",
        peerCount: sectionLinearPeers.length,
        missingRate: false
      };
    }
  }
  if (String(
    priceItem?.item_code || ""
  ).trim().toUpperCase() === "TIL-007") {
    const databaseItems = Array.isArray(
      allPriceItems
    ) ? allPriceItems : [];
    const floorTileReference = databaseItems.find(
      (item) => String(
        item?.item_code || ""
      ).trim().toUpperCase() === "FIN-003" && chooseDirectRate(
        item,
        priceLevel
      ).rate > 0
    ) || databaseItems.find(
      (item) => {
        const desc = String(
          item?.description || ""
        ).toLowerCase();
        const peerUnit = normalizeRateUnit(
          item?.unit
        );
        return ["m2", "sqm", "sq.m"].includes(
          peerUnit
        ) && /(ceramic|porcelain).*(floor|tile)|floor.*tile/.test(
          desc
        ) && chooseDirectRate(
          item,
          priceLevel
        ).rate > 0;
      }
    );
    if (floorTileReference) {
      const floorTileRate = chooseDirectRate(
        floorTileReference,
        priceLevel
      ).rate;
      const derivedRate = floorTileRate * 0.15;
      if (derivedRate > 0) {
        return {
          rate: derivedRate,
          source: "derived_tile_skirting_from_floor_tile_rate",
          peerCount: 1,
          missingRate: false
        };
      }
    }
  }
  const fallbackGroups = [
    {
      source: "section_subcategory_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode && subCategory && peer.subCategory === subCategory
      )
    },
    {
      source: "section_category_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode && category && peer.category === category
      )
    },
    {
      source: "section_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => sectionCode && peer.sectionCode === sectionCode
      )
    },
    {
      source: "category_unit_median_rate",
      peers: pricedPeers.filter(
        (peer) => category && peer.category === category
      )
    },
    {
      source: "unit_database_median_rate",
      peers: pricedPeers
    }
  ];
  for (const group of fallbackGroups) {
    const values = group.peers.map(
      (peer) => peer.rate
    ).filter(
      (rate) => Number(rate) > 0
    );
    const groupMedian = median(values);
    if (groupMedian > 0) {
      return {
        rate: groupMedian,
        source: group.source,
        peerCount: values.length,
        missingRate: false
      };
    }
  }
  return {
    rate: 0,
    source: "rate_missing_in_database",
    peerCount: 0,
    missingRate: true
  };
}
async function fetchAllActivePriceItems(supabase) {
  const pageSize = 1e3;
  const allItems = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error: error2 } = await supabase.from("price_items").select("*").eq("is_active", true).order("item_code", {
      ascending: true
    }).range(
      from,
      from + pageSize - 1
    );
    if (error2) {
      return {
        data: null,
        error: error2
      };
    }
    const page = data || [];
    allItems.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  return {
    data: allItems,
    error: null
  };
}
function getMeasuredRuleFamily(rule, priceItem) {
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const geometry = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const property = String(
    rule?.geometry_property || ""
  ).toLowerCase();
  if (geometry === "wall" && property === "area" && /block\s*wall|blockwork|block work|masonry/.test(
    description
  )) {
    return "wall_blockwork";
  }
  return null;
}
function shouldSuppressDatabaseAutoRule(rule, priceItem, claimedFamilies) {
  const ruleName = String(
    rule?.rule_name || ""
  );
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const isDatabaseAuto = ruleName.startsWith(
    "DB Auto:"
  );
  if (!isDatabaseAuto) {
    return false;
  }
  if (String(
    rule?.geometry_type || ""
  ).toLowerCase() === "wall" && String(
    rule?.geometry_property || ""
  ).toLowerCase() === "area" && /(external|weather resistant|weather-resistant|wall tile|wall tiling|backsplash|wet area)/.test(
    description
  )) {
    return true;
  }
  const family2 = getMeasuredRuleFamily(
    rule,
    priceItem
  );
  if (family2 && claimedFamilies.has(
    family2
  )) {
    return true;
  }
  return false;
}
function getSafeQuantityBasis(match, priceItem) {
  const original = String(
    match?.quantity_basis || "manual_review"
  );
  if (original !== "manual_review") {
    return original;
  }
  const roomType = String(
    match?.room_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit5 = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/\s+/g, "");
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit5);
  const isWetRoom = [
    "bathroom",
    "toilet",
    "powder_room",
    "laundry",
    "kitchen",
    "pantry"
  ].includes(roomType);
  const isFloorWaterproofing = /(waterproof|water proof|membrane)/.test(
    description
  ) && !/(wall|vertical|upstand|roof)/.test(
    description
  );
  if (isWetRoom && isAreaUnit && isFloorWaterproofing) {
    return "room_type_floor_area";
  }
  return original;
}
function estimatePendingRuleQuantity(rule, priceItem, takeoff) {
  const geometry = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit5 = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/\s+/g, "");
  const floorArea = Number(
    takeoff?.floor_area
  ) || 0;
  const wallLength = Number(
    takeoff?.wall_length
  ) || 0;
  const wallArea = Number(
    takeoff?.wall_area
  ) || 0;
  const columns = Number(
    takeoff?.columns
  ) || 0;
  const stairs = Number(
    takeoff?.stairs
  ) || 0;
  const electricalItems = Number(
    takeoff?.electrical_items
  ) || 0;
  const roomCount = Number(
    takeoff?.rooms
  ) || 0;
  const bathrooms = Number(
    takeoff?.classifications?.room_types?.bathroom
  ) || 0;
  const kitchens = Number(
    takeoff?.classifications?.room_types?.kitchen
  ) || 0;
  const wetRooms = bathrooms + kitchens + (Number(
    takeoff?.classifications?.room_types?.laundry
  ) || 0);
  if (geometry === "preliminaries" && ["item", "ls", "l.s", "sum"].includes(
    unit5
  )) {
    return {
      quantity: 1,
      source: "project_allowance",
      confidence: 55
    };
  }
  if (geometry === "earthwork") {
    if (/(excavat|soil removal|cut)/.test(
      description
    ) && ["m3", "cum", "cu.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.6,
        source: "floor_area_based_earthwork_allowance",
        confidence: 45
      };
    }
    if (/(backfill|fill)/.test(
      description
    ) && ["m3", "cum", "cu.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.3,
        source: "floor_area_based_backfill_allowance",
        confidence: 45
      };
    }
  }
  if (geometry === "foundation") {
    if (["m3", "cum", "cu.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.22,
        source: "floor_area_based_foundation_allowance",
        confidence: 42
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.85,
        source: "floor_area_based_foundation_formwork_allowance",
        confidence: 42
      };
    }
  }
  if (geometry === "column") {
    if (["m3", "cum", "cu.m"].includes(
      unit5
    ) && columns > 0) {
      return {
        quantity: columns * 0.32,
        source: "column_count_allowance",
        confidence: 48
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit5
    ) && columns > 0) {
      return {
        quantity: columns * 3.6,
        source: "column_count_formwork_allowance",
        confidence: 46
      };
    }
  }
  if (geometry === "beam") {
    if (["m3", "cum", "cu.m"].includes(
      unit5
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.045,
        source: "wall_length_beam_allowance",
        confidence: 40
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit5
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.55,
        source: "wall_length_beam_formwork_allowance",
        confidence: 40
      };
    }
  }
  if (geometry === "slab") {
    if (["m3", "cum", "cu.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.16,
        source: "floor_area_slab_concrete_allowance",
        confidence: 50
      };
    }
    if (["m2", "sqm", "sq.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea,
        source: "floor_area_slab_formwork_allowance",
        confidence: 60
      };
    }
  }
  if (geometry === "plumbing") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
      unit5
    )) {
      if (/(wc|toilet|water closet)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(basin|wash basin|lavatory)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(shower)/.test(
        description
      ) && bathrooms > 0) {
        return {
          quantity: bathrooms,
          source: "bathroom_count_fixture_allowance",
          confidence: 55
        };
      }
      if (/(sink)/.test(
        description
      ) && kitchens > 0) {
        return {
          quantity: kitchens,
          source: "kitchen_count_fixture_allowance",
          confidence: 60
        };
      }
      if (/(floor drain|drain)/.test(
        description
      ) && wetRooms > 0) {
        return {
          quantity: wetRooms,
          source: "wet_room_count_drain_allowance",
          confidence: 55
        };
      }
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit5
    ) && wetRooms > 0) {
      return {
        quantity: wetRooms * 8,
        source: "wet_room_pipe_length_allowance",
        confidence: 38
      };
    }
  }
  if (geometry === "electrical") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "point"].includes(
      unit5
    ) && electricalItems > 0) {
      if (/(lighting point|light point|downlight|led)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.4
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(socket|power outlet|13a)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.35
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(switch)/.test(
        description
      )) {
        return {
          quantity: Math.round(
            electricalItems * 0.2
          ),
          source: "electrical_total_split_allowance",
          confidence: 35
        };
      }
      if (/(distribution board|db panel|consumer unit)/.test(
        description
      )) {
        return {
          quantity: 1,
          source: "single_db_allowance",
          confidence: 40
        };
      }
    }
  }
  if (geometry === "hvac") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
      unit5
    ) && roomCount > 0) {
      if (/(split|ac unit|air conditioning unit|indoor unit|fan coil)/.test(
        description
      )) {
        return {
          quantity: Math.max(
            1,
            Math.round(
              roomCount * 0.55
            )
          ),
          source: "room_count_hvac_allowance",
          confidence: 35
        };
      }
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit5
    ) && roomCount > 0) {
      return {
        quantity: roomCount * 3.5,
        source: "room_count_duct_allowance",
        confidence: 30
      };
    }
  }
  if (geometry === "fire") {
    if (["no", "nos", "nr", "item", "each", "ea", "unit"].includes(
      unit5
    )) {
      if (/(smoke detector|heat detector|detector)/.test(
        description
      ) && roomCount > 0) {
        return {
          quantity: Math.max(
            1,
            roomCount
          ),
          source: "room_count_fire_detector_allowance",
          confidence: 35
        };
      }
      if (/(extinguisher)/.test(
        description
      )) {
        return {
          quantity: Math.max(
            2,
            Math.ceil(
              roomCount / 6
            )
          ),
          source: "room_count_fire_extinguisher_allowance",
          confidence: 35
        };
      }
    }
  }
  if (geometry === "external") {
    if (["m2", "sqm", "sq.m"].includes(
      unit5
    ) && floorArea > 0) {
      return {
        quantity: floorArea * 0.35,
        source: "floor_area_external_works_allowance",
        confidence: 30
      };
    }
    if (["m", "lm", "linear.m", "lin.m"].includes(
      unit5
    ) && wallLength > 0) {
      return {
        quantity: wallLength * 0.4,
        source: "wall_length_external_works_allowance",
        confidence: 30
      };
    }
  }
  if (geometry === "handover" || geometry === "commissioning") {
    if (["item", "ls", "l.s", "sum"].includes(
      unit5
    )) {
      return {
        quantity: 1,
        source: "project_allowance",
        confidence: 55
      };
    }
  }
  return {
    quantity: 0,
    source: "unavailable",
    confidence: 0
  };
}
function estimateRemainingPendingQuantity(rule, priceItem, takeoff) {
  const code = String(
    rule?.item_code || ""
  ).trim().toUpperCase();
  const geometry = String(
    rule?.geometry_type || ""
  ).toLowerCase();
  const description = String(
    priceItem?.description || ""
  ).toLowerCase();
  const unit5 = String(
    priceItem?.unit || ""
  ).trim().toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
  const floorArea = Number(takeoff?.floor_area) || 0;
  const ceilingArea = Number(takeoff?.ceiling_area) || floorArea;
  const wallLength = Number(takeoff?.wall_length) || 0;
  const wallArea = Number(takeoff?.wall_area) || 0;
  const slabVolume = Number(takeoff?.slab_volume) || 0;
  const columnVolume = Number(takeoff?.column_volume) || 0;
  const beamVolume = Number(takeoff?.beam_volume) || 0;
  const foundationVolume = Number(takeoff?.foundation_volume) || 0;
  const columnFormworkArea = Number(takeoff?.column_formwork_area) || 0;
  const beamFormworkArea = Number(takeoff?.beam_formwork_area) || 0;
  const foundationFormworkArea = Number(takeoff?.foundation_formwork_area) || 0;
  const slabFormworkArea = Number(takeoff?.slab_formwork_area) || 0;
  const structuralStatus = takeoff?.structural_measurement_status || {};
  const roomCount = Number(takeoff?.rooms) || 0;
  const doors = Number(takeoff?.doors) || 0;
  const windows = Number(takeoff?.windows) || 0;
  const bathrooms = Number(
    takeoff?.classifications?.room_types?.bathroom
  ) || 3;
  const kitchens = Number(
    takeoff?.classifications?.room_types?.kitchen
  ) || 1;
  const laundries = Number(
    takeoff?.classifications?.room_types?.laundry
  ) || 1;
  const wetRooms = Math.max(
    1,
    bathrooms + kitchens + laundries
  );
  const isCountUnit = [
    "no",
    "nos",
    "nr",
    "item",
    "each",
    "ea",
    "unit",
    "set",
    "point",
    "ls",
    "l.s",
    "sum"
  ].includes(unit5);
  const isAreaUnit = [
    "m2",
    "sqm",
    "sq.m"
  ].includes(unit5);
  const isLengthUnit = [
    "m",
    "lm",
    "lin.m",
    "linear.m",
    "linearm"
  ].includes(unit5);
  const isVolumeUnit = [
    "m3",
    "cum",
    "cu.m"
  ].includes(unit5);
  const saysConcrete = /\b(concrete|r\.?c\.?c\.?|reinforced\s+concrete)\b/i.test(
    description
  );
  const saysColumn = /\b(column|columns|column\s+concrete|rcc\s+column)\b/i.test(
    description
  );
  const saysBeam = /\b(beam|beams|beam\s+concrete|rcc\s+beam)\b/i.test(
    description
  );
  const saysSlab = /\b(slab|slabs|slab\s+concrete|rcc\s+slab)\b/i.test(
    description
  );
  const saysFoundation = /\b(foundation|footing|footings|raft|pile\s*cap|foundation\s+concrete)\b/i.test(
    description
  );
  const saysFormwork = /\b(formwork|shuttering|form\s*work)\b/i.test(
    description
  );
  if (geometry === "general" && isVolumeUnit && saysConcrete && saysColumn && columnVolume > 0 && structuralStatus?.columns?.volumeMeasured === true) {
    return {
      quantity: columnVolume,
      source: "aps_measured_column_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column"
    };
  }
  if (geometry === "general" && isAreaUnit && saysColumn && saysFormwork && columnFormworkArea > 0 && structuralStatus?.columns?.formworkComplete === true) {
    return {
      quantity: columnFormworkArea,
      source: "aps_measured_column_formwork_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column"
    };
  }
  if (geometry === "general" && isVolumeUnit && saysConcrete && saysBeam && beamVolume > 0 && structuralStatus?.beams?.volumeMeasured === true) {
    return {
      quantity: beamVolume,
      source: "aps_measured_beam_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "beam"
    };
  }
  if (geometry === "general" && isVolumeUnit && saysConcrete && saysSlab && slabVolume > 0 && structuralStatus?.slabs?.volumeMeasured === true) {
    return {
      quantity: slabVolume,
      source: "aps_measured_slab_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "slab"
    };
  }
  if (geometry === "general" && isVolumeUnit && saysConcrete && saysFoundation && foundationVolume > 0 && structuralStatus?.foundations?.volumeMeasured === true) {
    return {
      quantity: foundationVolume,
      source: "aps_measured_foundation_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "foundation"
    };
  }
  if (geometry === "foundation") {
    if (isVolumeUnit && foundationVolume > 0 && structuralStatus?.foundations?.volumeMeasured === true) {
      return {
        quantity: foundationVolume,
        source: "aps_measured_foundation_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && foundationFormworkArea > 0 && structuralStatus?.foundations?.formworkComplete === true) {
      return {
        quantity: foundationFormworkArea,
        source: "aps_measured_foundation_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry === "column") {
    if (isVolumeUnit && columnVolume > 0 && structuralStatus?.columns?.volumeMeasured === true) {
      return {
        quantity: columnVolume,
        source: "aps_measured_column_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && columnFormworkArea > 0 && structuralStatus?.columns?.formworkComplete === true) {
      return {
        quantity: columnFormworkArea,
        source: "aps_measured_column_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry === "beam") {
    if (isVolumeUnit && beamVolume > 0 && structuralStatus?.beams?.volumeMeasured === true) {
      return {
        quantity: beamVolume,
        source: "aps_measured_beam_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && beamFormworkArea > 0 && structuralStatus?.beams?.formworkComplete === true) {
      return {
        quantity: beamFormworkArea,
        source: "aps_measured_beam_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  if (geometry === "slab") {
    if (isVolumeUnit && slabVolume > 0 && structuralStatus?.slabs?.volumeMeasured === true) {
      return {
        quantity: slabVolume,
        source: "aps_measured_slab_volume",
        confidence: 95,
        measured: true
      };
    }
    if (isAreaUnit && slabFormworkArea > 0 && structuralStatus?.slabs?.formworkComplete === true) {
      return {
        quantity: slabFormworkArea,
        source: "aps_measured_slab_formwork",
        confidence: 95,
        measured: true
      };
    }
  }
  const exact = {
    "MAS-004": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.12,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.12,
        1
      ),
      source: "masonry_misc_allowance",
      confidence: 28
    }),
    "HVC-001": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.5
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 3.5,
        1
      ) : isAreaUnit ? Math.max(
        floorArea * 0.2,
        1
      ) : 1,
      source: "hvac_room_count_allowance",
      confidence: 32
    }),
    "HVC-002": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.5
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 3,
        1
      ) : isAreaUnit ? Math.max(
        wallArea * 0.08,
        1
      ) : 1,
      source: "hvac_distribution_allowance",
      confidence: 30
    }),
    "HVC-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.35
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 2.5,
        1
      ) : 1,
      source: "hvac_accessory_allowance",
      confidence: 28
    }),
    "HVC-004": () => ({
      quantity: isAreaUnit ? Math.max(
        ceilingArea * 0.25,
        1
      ) : isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount * 0.25
        )
      ) : 1,
      source: "hvac_ceiling_scope_allowance",
      confidence: 28
    }),
    "WAT-001": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea,
        1
      ) : isLengthUnit ? Math.max(
        wallLength,
        1
      ) : 1,
      source: "roof_waterproofing_floor_area_allowance",
      confidence: 35
    }),
    "WAT-002": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.18,
        1
      ) : isLengthUnit ? Math.max(
        wetRooms * 6,
        1
      ) : 1,
      source: "wet_area_waterproofing_allowance",
      confidence: 35
    }),
    "PLB-001": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 8 : 1,
      source: "bathroom_plumbing_allowance",
      confidence: 48
    }),
    "PLB-002": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 7 : 1,
      source: "bathroom_plumbing_allowance",
      confidence: 48
    }),
    "PLB-003": () => ({
      quantity: isCountUnit ? Math.max(
        kitchens,
        1
      ) : isLengthUnit ? wetRooms * 6 : 1,
      source: "kitchen_plumbing_allowance",
      confidence: 48
    }),
    "PLB-004": () => ({
      quantity: isCountUnit ? wetRooms : isLengthUnit ? wetRooms * 8 : 1,
      source: "wet_room_drainage_allowance",
      confidence: 45
    }),
    "PLB-005": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 5 : 1,
      source: "bathroom_fixture_allowance",
      confidence: 50
    }),
    "PLB-006": () => ({
      quantity: isCountUnit ? bathrooms : isLengthUnit ? wetRooms * 5 : 1,
      source: "bathroom_fixture_allowance",
      confidence: 50
    }),
    "FIR-002": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        roomCount
      ) : isLengthUnit ? Math.max(
        roomCount * 2,
        1
      ) : 1,
      source: "fire_detection_room_allowance",
      confidence: 30
    }),
    "FIR-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          roomCount / 4
        )
      ) : isLengthUnit ? Math.max(
        roomCount * 2,
        1
      ) : 1,
      source: "fire_system_allowance",
      confidence: 28
    }),
    "LAN-001": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.25,
        1
      ) : isVolumeUnit ? Math.max(
        floorArea * 0.08,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.2,
        1
      ),
      source: "landscape_area_allowance",
      confidence: 25
    }),
    "LAN-002": () => ({
      quantity: isAreaUnit ? Math.max(
        floorArea * 0.18,
        1
      ) : isCountUnit ? 1 : Math.max(
        wallLength * 0.15,
        1
      ),
      source: "landscape_hardscape_allowance",
      confidence: 25
    }),
    "LAN-003": () => ({
      quantity: isCountUnit ? Math.max(
        1,
        Math.ceil(
          floorArea / 60
        )
      ) : isAreaUnit ? Math.max(
        floorArea * 0.12,
        1
      ) : Math.max(
        wallLength * 0.1,
        1
      ),
      source: "landscape_misc_allowance",
      confidence: 22
    })
  };
  if (exact[code]) {
    return exact[code]();
  }
  if (isCountUnit) {
    if (/(door|window)/.test(
      description
    )) {
      return {
        quantity: /(door)/.test(description) ? Math.max(doors, 1) : Math.max(windows, 1),
        source: "opening_count_final_allowance",
        confidence: 25
      };
    }
    return {
      quantity: 1,
      source: "single_item_final_allowance",
      confidence: 18
    };
  }
  if (isAreaUnit) {
    if (geometry === "roof") {
      return {
        quantity: Math.max(
          floorArea,
          1
        ),
        source: "floor_area_final_allowance",
        confidence: 22
      };
    }
    if (geometry === "ceiling") {
      return {
        quantity: Math.max(
          ceilingArea,
          1
        ),
        source: "ceiling_area_final_allowance",
        confidence: 25
      };
    }
    if (geometry === "wall") {
      return {
        quantity: Math.max(
          wallArea * 0.1,
          1
        ),
        source: "wall_area_final_allowance",
        confidence: 18
      };
    }
    return {
      quantity: Math.max(
        floorArea * 0.25,
        1
      ),
      source: "floor_area_fraction_final_allowance",
      confidence: 18
    };
  }
  if (isLengthUnit) {
    return {
      quantity: Math.max(
        wallLength * 0.25,
        1
      ),
      source: "wall_length_final_allowance",
      confidence: 18
    };
  }
  if (isVolumeUnit) {
    return {
      quantity: Math.max(
        floorArea * 0.08,
        1
      ),
      source: "floor_area_volume_final_allowance",
      confidence: 18
    };
  }
  return {
    quantity: 1,
    source: "unknown_unit_single_allowance",
    confidence: 12
  };
}
function normalizeSpatialPoints(items) {
  const valid2 = (Array.isArray(items) ? items : []).filter(
    (item) => {
      const x = item?.centroid?.x;
      const y = item?.centroid?.y;
      return x !== null && x !== void 0 && x !== "" && y !== null && y !== void 0 && y !== "" && Number.isFinite(
        Number(x)
      ) && Number.isFinite(
        Number(y)
      );
    }
  );
  if (!valid2.length) {
    return [];
  }
  const xs = valid2.map(
    (item) => Number(item.centroid.x)
  );
  const ys = valid2.map(
    (item) => Number(item.centroid.y)
  );
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  return valid2.map(
    (item) => ({
      item,
      x: (Number(item.centroid.x) - minX) / width,
      y: (Number(item.centroid.y) - minY) / height
    })
  );
}
function collectElectricalObjectEvidence(item) {
  const values = [];
  const pushValue = (value) => {
    if (typeof value === "string" && value.trim()) {
      values.push(
        value.trim()
      );
    }
  };
  const visit = (value, depth = 0) => {
    if (depth > 3 || value == null) {
      return;
    }
    if (typeof value === "string") {
      pushValue(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 80)) {
        visit(
          child,
          depth + 1
        );
      }
      return;
    }
    if (typeof value === "object") {
      for (const [
        key2,
        child
      ] of Object.entries(
        value
      ).slice(0, 120)) {
        if ([
          "centroid",
          "boundingBox",
          "bbox"
        ].includes(key2)) {
          continue;
        }
        pushValue(key2);
        visit(
          child,
          depth + 1
        );
      }
    }
  };
  for (const key2 of [
    "name",
    "displayName",
    "objectName",
    "category",
    "family",
    "familyName",
    "type",
    "typeName",
    "layer",
    "layerName",
    "classification",
    "description",
    "symbol",
    "blockName",
    "properties",
    "rawProperties"
  ]) {
    visit(
      item?.[key2],
      0
    );
  }
  return values.join(" ").toLowerCase().replace(
    /[_/\\|:;,-]+/g,
    " "
  ).replace(
    /\s+/g,
    " "
  ).trim();
}
function classifyElectricalSubtypeFromAps(item) {
  const existing = String(
    item?.electricalSubtype || ""
  ).toLowerCase().trim();
  if ([
    "lighting",
    "socket",
    "switch",
    "distribution_board"
  ].includes(existing)) {
    return existing;
  }
  const text3 = collectElectricalObjectEvidence(
    item
  );
  if (!text3) {
    return "other";
  }
  const hasAny = (patterns) => patterns.some(
    (pattern) => pattern.test(text3)
  );
  if (hasAny([
    /\bdistribution\s*board\b/i,
    /\bpanel\s*board\b/i,
    /\bpanelboard\b/i,
    /\bswitch\s*board\b/i,
    /\bconsumer\s*unit\b/i,
    /\bmain\s*distribution\b/i,
    /\bsub\s*main\s*distribution\b/i,
    /\bmdb\b/i,
    /\bsmdb\b/i,
    /\bdb\s*\d*\b/i
  ])) {
    return "distribution_board";
  }
  if (hasAny([
    /\bsocket\b/i,
    /\breceptacle\b/i,
    /\bpower\s*outlet\b/i,
    /\boutlet\s*point\b/i,
    /\bpower\s*point\b/i,
    /\bgpo\b/i,
    /\b13a\b/i,
    /\b15a\b/i,
    /\b20a\b/i,
    /\be[\s-]*powr\b/i,
    /\be[\s-]*power\b/i
  ])) {
    return "socket";
  }
  if (hasAny([
    /\blight\s*switch\b/i,
    /\bswitch\s*point\b/i,
    /\bdimmer\b/i,
    /\bpush\s*button\b/i,
    /\b\d+\s*gang\s*switch\b/i,
    /\b1g\s*switch\b/i,
    /\b2g\s*switch\b/i,
    /\b3g\s*switch\b/i,
    /\be[\s-]*swch\b/i,
    /\be[\s-]*switch\b/i
  ])) {
    return "switch";
  }
  if (hasAny([
    /\blighting\b/i,
    /\bluminaire\b/i,
    /\bdown\s*light\b/i,
    /\bdownlight\b/i,
    /\bspot\s*light\b/i,
    /\bspotlight\b/i,
    /\bceiling\s*light\b/i,
    /\bwall\s*light\b/i,
    /\bpendant\s*light\b/i,
    /\bchandelier\b/i,
    /\bsconce\b/i,
    /\blamp\b/i,
    /\blight\s*fitting\b/i,
    /\blight\s*fixture\b/i,
    /\be[\s-]*lite\b/i,
    /\be[\s-]*light\b/i
  ])) {
    return "lighting";
  }
  return "other";
}
function summarizeElectricalSubtypes(electrical) {
  const counts = {
    lighting: 0,
    socket: 0,
    switch: 0,
    distribution_board: 0,
    other: 0
  };
  for (const item of electrical || []) {
    const subtype = classifyElectricalSubtypeFromAps(
      item
    );
    if (Object.prototype.hasOwnProperty.call(
      counts,
      subtype
    )) {
      counts[subtype] += 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}
function buildWorldRoomLocalMepCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => Number.isFinite(
      Number(
        room?.apsWorldCentroid?.x
      )
    ) && Number.isFinite(
      Number(
        room?.apsWorldCentroid?.y
      )
    )
  );
  const base = {
    valid: false,
    mapper: "aps_world_to_aps_world",
    worldRoomCount: rooms.length,
    totalCount: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    byRoomType: {},
    assignedCount: 0
  };
  if (electrical.length === 0 || rooms.length === 0) {
    return {
      ...base,
      reason: rooms.length === 0 ? "aps_world_room_centroids_unavailable" : "aps_world_electrical_centroids_unavailable"
    };
  }
  const xs = [
    ...electrical.map(
      (item) => Number(
        item.centroid.x
      )
    ),
    ...rooms.map(
      (room) => Number(
        room.apsWorldCentroid.x
      )
    )
  ];
  const ys = [
    ...electrical.map(
      (item) => Number(
        item.centroid.y
      )
    ),
    ...rooms.map(
      (room) => Number(
        room.apsWorldCentroid.y
      )
    )
  ];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  const normalizedRooms = rooms.map(
    (room) => ({
      room,
      x: (Number(
        room.apsWorldCentroid.x
      ) - minX) / width,
      y: (Number(
        room.apsWorldCentroid.y
      ) - minY) / height
    })
  );
  const rawAssignments = electrical.map(
    (item) => {
      const point3 = {
        x: (Number(
          item.centroid.x
        ) - minX) / width,
        y: (Number(
          item.centroid.y
        ) - minY) / height
      };
      const ranked = normalizedRooms.map(
        (candidate) => ({
          ...candidate,
          distance: Math.hypot(
            point3.x - candidate.x,
            point3.y - candidate.y
          )
        })
      ).sort(
        (a, b) => a.distance - b.distance
      );
      const nearest = ranked[0] || null;
      const second = ranked[1] || null;
      return {
        item,
        room: nearest?.room || null,
        distance: nearest?.distance ?? Infinity,
        separation: nearest && second ? second.distance - nearest.distance : 1
      };
    }
  );
  const finiteDistances = rawAssignments.map(
    (entry) => entry.distance
  ).filter(
    Number.isFinite
  ).sort(
    (a, b) => a - b
  );
  const medianDistance = finiteDistances.length ? finiteDistances[Math.floor(
    finiteDistances.length / 2
  )] : Infinity;
  const adaptiveLimit = Number.isFinite(
    medianDistance
  ) ? Math.max(
    0.04,
    Math.min(
      0.18,
      medianDistance * 3
    )
  ) : 0.1;
  const accepted = rawAssignments.filter(
    (entry) => entry.room && entry.distance <= adaptiveLimit
  );
  const coverage = electrical.length ? accepted.length / electrical.length : 0;
  if (coverage < 0.6) {
    return {
      ...base,
      reason: "aps_world_room_assignment_low_coverage",
      assignedCount: accepted.length,
      coverage: Number(
        coverage.toFixed(4)
      ),
      medianDistance: Number.isFinite(
        medianDistance
      ) ? Number(
        medianDistance.toFixed(
          4
        )
      ) : null,
      adaptiveLimit: Number(
        adaptiveLimit.toFixed(
          4
        )
      )
    };
  }
  const byRoomType = {};
  for (const assignment of accepted) {
    const roomType = String(
      assignment.room?.type || assignment.room?.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    valid: true,
    mapper: "aps_world_to_aps_world",
    reason: "aps_world_electrical_to_matched_aps_room",
    byRoomType,
    assignedCount: accepted.length,
    totalCount: electrical.length,
    worldRoomCount: rooms.length,
    coverage: Number(
      coverage.toFixed(4)
    ),
    medianDistance: Number(
      medianDistance.toFixed(
        4
      )
    ),
    adaptiveLimit: Number(
      adaptiveLimit.toFixed(
        4
      )
    )
  };
}
function normalizeRoomRegions(semanticRooms) {
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => room?.regionBBox && Number.isFinite(
      Number(
        room.regionBBox.x
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.y
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.width
      )
    ) && Number.isFinite(
      Number(
        room.regionBBox.height
      )
    ) && Number(
      room.regionBBox.width
    ) > 0 && Number(
      room.regionBBox.height
    ) > 0
  );
  if (!rooms.length) {
    return [];
  }
  const rawBoxes = rooms.map(
    (room) => ({
      room,
      x: Number(
        room.regionBBox.x
      ),
      y: Number(
        room.regionBBox.y
      ),
      width: Number(
        room.regionBBox.width
      ),
      height: Number(
        room.regionBBox.height
      )
    })
  );
  const alreadyNormalized = rawBoxes.every(
    (box) => box.x >= -0.05 && box.y >= -0.05 && box.x + box.width <= 1.05 && box.y + box.height <= 1.05
  );
  if (alreadyNormalized) {
    return rawBoxes.map(
      (box) => ({
        ...box.room,
        regionBBox: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height
        },
        centroid: {
          ...box.room.centroid,
          x: Number.isFinite(
            Number(
              box.room?.centroid?.x
            )
          ) ? Number(
            box.room.centroid.x
          ) : box.x + box.width / 2,
          y: Number.isFinite(
            Number(
              box.room?.centroid?.y
            )
          ) ? Number(
            box.room.centroid.y
          ) : box.y + box.height / 2
        }
      })
    );
  }
  const minX = Math.min(
    ...rawBoxes.map(
      (box) => box.x
    )
  );
  const minY = Math.min(
    ...rawBoxes.map(
      (box) => box.y
    )
  );
  const maxX = Math.max(
    ...rawBoxes.map(
      (box) => box.x + box.width
    )
  );
  const maxY = Math.max(
    ...rawBoxes.map(
      (box) => box.y + box.height
    )
  );
  const width = Math.max(
    maxX - minX,
    1e-9
  );
  const height = Math.max(
    maxY - minY,
    1e-9
  );
  return rawBoxes.map(
    (box) => {
      const x = (box.x - minX) / width;
      const y = (box.y - minY) / height;
      const w = box.width / width;
      const h = box.height / height;
      return {
        ...box.room,
        regionBBox: {
          x,
          y,
          width: w,
          height: h
        },
        centroid: {
          ...box.room.centroid,
          x: x + w / 2,
          y: y + h / 2
        }
      };
    }
  );
}
function buildRoomCentroidElectricalCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = (Array.isArray(
    semanticRooms
  ) ? semanticRooms : []).filter(
    (room) => {
      const x = room?.centroid?.x;
      const y = room?.centroid?.y;
      return x !== null && x !== void 0 && y !== null && y !== void 0 && Number.isFinite(
        Number(x)
      ) && Number.isFinite(
        Number(y)
      );
    }
  );
  const base = {
    valid: false,
    mapper: "aps_world_normalized_to_room_centroid_v11",
    roomCount: rooms.length,
    totalCount: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    byRoomType: {},
    assignedCount: 0
  };
  if (electrical.length === 0 || rooms.length < 4) {
    return {
      ...base,
      reason: electrical.length === 0 ? "electrical_centroids_unavailable" : "semantic_room_centroids_insufficient"
    };
  }
  const normalizedElectrical = normalizeSpatialPoints(
    electrical
  );
  const roomXs = rooms.map(
    (room) => Number(
      room.centroid.x
    )
  );
  const roomYs = rooms.map(
    (room) => Number(
      room.centroid.y
    )
  );
  const minRoomX = Math.min(...roomXs);
  const maxRoomX = Math.max(...roomXs);
  const minRoomY = Math.min(...roomYs);
  const maxRoomY = Math.max(...roomYs);
  const roomWidth = Math.max(
    maxRoomX - minRoomX,
    1e-9
  );
  const roomHeight = Math.max(
    maxRoomY - minRoomY,
    1e-9
  );
  const roomCentroids = rooms.map(
    (room) => ({
      room,
      x: (Number(
        room.centroid.x
      ) - minRoomX) / roomWidth,
      y: (Number(
        room.centroid.y
      ) - minRoomY) / roomHeight
    })
  );
  const transforms = [
    (point3) => ({
      x: point3.x,
      y: point3.y
    }),
    (point3) => ({
      x: point3.x,
      y: 1 - point3.y
    }),
    (point3) => ({
      x: 1 - point3.x,
      y: point3.y
    }),
    (point3) => ({
      x: 1 - point3.x,
      y: 1 - point3.y
    }),
    (point3) => ({
      x: point3.y,
      y: point3.x
    }),
    (point3) => ({
      x: point3.y,
      y: 1 - point3.x
    }),
    (point3) => ({
      x: 1 - point3.y,
      y: point3.x
    }),
    (point3) => ({
      x: 1 - point3.y,
      y: 1 - point3.x
    })
  ];
  const solutions = transforms.map(
    (transform, transformIndex) => {
      const assignments = normalizedElectrical.map(
        (entry) => {
          const point3 = transform(entry);
          const ranked = roomCentroids.map(
            (candidate) => ({
              ...candidate,
              distance: Math.hypot(
                point3.x - candidate.x,
                point3.y - candidate.y
              )
            })
          ).sort(
            (a, b) => a.distance - b.distance
          );
          const nearest = ranked[0] || null;
          const second = ranked[1] || null;
          if (!nearest) {
            return {
              entry,
              room: null,
              distance: Infinity,
              margin: 0
            };
          }
          return {
            entry,
            room: nearest.room,
            distance: nearest.distance,
            margin: second ? second.distance - nearest.distance : 1
          };
        }
      );
      const distances = assignments.map(
        (item) => item.distance
      ).filter(
        Number.isFinite
      ).sort(
        (a, b) => a - b
      );
      const medianDistance = distances.length ? distances[Math.floor(
        distances.length / 2
      )] : Infinity;
      const p80Distance = distances.length ? distances[Math.min(
        distances.length - 1,
        Math.floor(
          distances.length * 0.8
        )
      )] : Infinity;
      const roomUseCounts = /* @__PURE__ */ new Map();
      for (const assignment of assignments) {
        const key2 = String(
          assignment.room?.name || assignment.room?.type || "room"
        );
        roomUseCounts.set(
          key2,
          (roomUseCounts.get(
            key2
          ) || 0) + 1
        );
      }
      const usedRooms = roomUseCounts.size;
      const maxRoomShare = electrical.length ? Math.max(
        ...roomUseCounts.values()
      ) / electrical.length : 1;
      const distinctRoomTypes = new Set(
        assignments.map(
          (assignment) => String(
            assignment.room?.type || assignment.room?.roomType || "room"
          )
        )
      ).size;
      const averageMargin = assignments.length ? assignments.reduce(
        (sum, item) => sum + Math.max(
          0,
          Number(
            item.margin
          ) || 0
        ),
        0
      ) / assignments.length : 0;
      const score = (Number.isFinite(
        medianDistance
      ) ? 1 - Math.min(
        medianDistance,
        1
      ) : 0) * 4 + (Number.isFinite(
        p80Distance
      ) ? 1 - Math.min(
        p80Distance,
        1
      ) : 0) * 2 + Math.min(
        usedRooms,
        10
      ) * 0.12 + Math.min(
        distinctRoomTypes,
        8
      ) * 0.08 + Math.min(
        averageMargin,
        0.25
      ) * 2 - Math.max(
        0,
        maxRoomShare - 0.35
      ) * 4;
      return {
        transformIndex,
        assignments,
        medianDistance,
        p80Distance,
        usedRooms,
        distinctRoomTypes,
        maxRoomShare,
        averageMargin,
        score
      };
    }
  );
  solutions.sort(
    (a, b) => b.score - a.score
  );
  const best = solutions[0];
  if (!best) {
    return {
      ...base,
      reason: "room_centroid_transform_unavailable"
    };
  }
  const adaptiveLimit = Math.max(
    0.07,
    Math.min(
      0.2,
      (Number.isFinite(
        best.medianDistance
      ) ? best.medianDistance : 0.1) * 2.25
    )
  );
  const accepted = best.assignments.filter(
    (assignment) => assignment.room && assignment.distance <= adaptiveLimit
  );
  const coverage = electrical.length ? accepted.length / electrical.length : 0;
  const acceptedRoomUse = /* @__PURE__ */ new Map();
  for (const assignment of accepted) {
    const key2 = String(
      assignment.room?.name || assignment.room?.type || "room"
    );
    acceptedRoomUse.set(
      key2,
      (acceptedRoomUse.get(
        key2
      ) || 0) + 1
    );
  }
  const acceptedMaxRoomShare = accepted.length ? Math.max(
    ...acceptedRoomUse.values()
  ) / accepted.length : 1;
  const reliable = coverage >= 0.7 && best.usedRooms >= 4 && best.distinctRoomTypes >= 3 && best.medianDistance <= 0.16 && best.p80Distance <= 0.27 && acceptedMaxRoomShare <= 0.42;
  if (!reliable) {
    return {
      ...base,
      reason: "room_centroid_spatial_match_low_confidence",
      assignedCount: accepted.length,
      coverage: Number(
        coverage.toFixed(
          4
        )
      ),
      medianDistance: Number.isFinite(
        best.medianDistance
      ) ? Number(
        best.medianDistance.toFixed(
          4
        )
      ) : null,
      p80Distance: Number.isFinite(
        best.p80Distance
      ) ? Number(
        best.p80Distance.toFixed(
          4
        )
      ) : null,
      adaptiveLimit: Number(
        adaptiveLimit.toFixed(
          4
        )
      ),
      usedRooms: best.usedRooms,
      distinctRoomTypes: best.distinctRoomTypes,
      maxRoomShare: Number(
        acceptedMaxRoomShare.toFixed(
          4
        )
      ),
      transformIndex: best.transformIndex
    };
  }
  const byRoomType = {};
  for (const assignment of accepted) {
    const roomType = String(
      assignment.room?.type || assignment.room?.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.entry.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    ...base,
    valid: true,
    reason: "aps_electrical_to_semantic_room_centroid_v11",
    byRoomType,
    assignedCount: accepted.length,
    totalCount: electrical.length,
    coverage: Number(
      coverage.toFixed(
        4
      )
    ),
    medianDistance: Number(
      best.medianDistance.toFixed(
        4
      )
    ),
    p80Distance: Number(
      best.p80Distance.toFixed(
        4
      )
    ),
    adaptiveLimit: Number(
      adaptiveLimit.toFixed(
        4
      )
    ),
    usedRooms: best.usedRooms,
    distinctRoomTypes: best.distinctRoomTypes,
    maxRoomShare: Number(
      acceptedMaxRoomShare.toFixed(
        4
      )
    ),
    transformIndex: best.transformIndex
  };
}
function buildRoomLocalMepCounts(takeoff, semanticRooms) {
  const mep = Array.isArray(
    takeoff?.object_details?.mep
  ) ? takeoff.object_details.mep : [];
  const electrical = mep.filter(
    (item) => item?.detectedType === "electrical" && Number.isFinite(
      Number(
        item?.centroid?.x
      )
    ) && Number.isFinite(
      Number(
        item?.centroid?.y
      )
    )
  );
  const rooms = normalizeRoomRegions(
    semanticRooms
  );
  const baseResult = {
    fixVersion: "2026-08-17-electrical-subtype-v9",
    mapper: "aps_world_normalized_to_ai_room_bbox",
    electricalObjects: mep.filter(
      (item) => item?.detectedType === "electrical"
    ).length,
    electricalObjectsWithCentroid: electrical.length,
    electricalSubtypeCounts: summarizeElectricalSubtypes(
      electrical
    ),
    semanticRooms: rooms.length
  };
  if (electrical.length === 0 || rooms.length === 0) {
    return {
      ...baseResult,
      valid: false,
      reason: electrical.length === 0 ? "aps_electrical_centroids_missing_reanalyze_required" : "semantic_room_regions_missing",
      byRoomType: {},
      assignedCount: 0,
      totalCount: electrical.length
    };
  }
  const normalizedElectrical = normalizeSpatialPoints(
    electrical
  );
  const transforms = [
    (point3) => ({
      x: point3.x,
      y: point3.y
    }),
    (point3) => ({
      x: point3.x,
      y: 1 - point3.y
    }),
    (point3) => ({
      x: 1 - point3.x,
      y: point3.y
    }),
    (point3) => ({
      x: 1 - point3.x,
      y: 1 - point3.y
    }),
    (point3) => ({
      x: point3.y,
      y: point3.x
    }),
    (point3) => ({
      x: point3.y,
      y: 1 - point3.x
    }),
    (point3) => ({
      x: 1 - point3.y,
      y: point3.x
    }),
    (point3) => ({
      x: 1 - point3.y,
      y: 1 - point3.x
    })
  ];
  const distanceToRegion = (point3, room) => {
    const box = room.regionBBox;
    const dx = point3.x < box.x ? box.x - point3.x : point3.x > box.x + box.width ? point3.x - (box.x + box.width) : 0;
    const dy = point3.y < box.y ? box.y - point3.y : point3.y > box.y + box.height ? point3.y - (box.y + box.height) : 0;
    return Math.hypot(
      dx,
      dy
    );
  };
  const roomCenterDistance = (point3, room) => Math.hypot(
    point3.x - (room.regionBBox.x + room.regionBBox.width / 2),
    point3.y - (room.regionBBox.y + room.regionBBox.height / 2)
  );
  const solutions = transforms.map(
    (transform, transformIndex) => {
      const assignments = normalizedElectrical.map(
        (entry) => {
          const point3 = transform(entry);
          const ranked = rooms.map(
            (room) => ({
              room,
              regionDistance: distanceToRegion(
                point3,
                room
              ),
              centerDistance: roomCenterDistance(
                point3,
                room
              )
            })
          ).sort(
            (a, b) => a.regionDistance - b.regionDistance || a.centerDistance - b.centerDistance
          );
          const best2 = ranked[0] || null;
          const second = ranked[1] || null;
          if (!best2) {
            return {
              entry,
              room: null,
              insideRegion: false,
              regionDistance: Infinity,
              separation: 0
            };
          }
          const insideRegion = best2.regionDistance === 0;
          const accepted = insideRegion || best2.regionDistance <= 0.055;
          const separation = second ? second.regionDistance - best2.regionDistance : 1;
          return {
            entry,
            room: accepted ? best2.room : null,
            insideRegion,
            regionDistance: best2.regionDistance,
            centerDistance: best2.centerDistance,
            separation
          };
        }
      );
      const assigned = assignments.filter(
        (item) => item.room
      );
      const inside5 = assigned.filter(
        (item) => item.insideRegion
      ).length;
      const coverage = electrical.length ? assigned.length / electrical.length : 0;
      const regionCoverage = electrical.length ? inside5 / electrical.length : 0;
      const averageRegionDistance = assigned.length ? assigned.reduce(
        (sum, item) => sum + item.regionDistance,
        0
      ) / assigned.length : Infinity;
      const roomTypesUsed = new Set(
        assigned.map(
          (item) => String(
            item.room?.type || item.room?.roomType || "room"
          )
        )
      ).size;
      return {
        transformIndex,
        assignments,
        coverage,
        regionCoverage,
        averageRegionDistance,
        roomTypesUsed,
        score: regionCoverage * 8 + coverage * 3 + Math.min(
          roomTypesUsed,
          8
        ) * 0.12 - Math.min(
          averageRegionDistance,
          1
        ) * 2
      };
    }
  );
  solutions.sort(
    (a, b) => b.score - a.score
  );
  const best = solutions[0];
  const reliable = Boolean(
    best && best.coverage >= 0.6 && best.regionCoverage >= 0.35 && best.roomTypesUsed >= 2
  );
  if (!reliable) {
    return {
      ...baseResult,
      valid: false,
      reason: "room_region_spatial_match_low_confidence",
      byRoomType: {},
      assignedCount: best ? best.assignments.filter(
        (item) => item.room
      ).length : 0,
      totalCount: electrical.length,
      coverage: Number(
        (best?.coverage || 0).toFixed(4)
      ),
      regionCoverage: Number(
        (best?.regionCoverage || 0).toFixed(4)
      ),
      averageRegionDistance: Number.isFinite(
        best?.averageRegionDistance
      ) ? Number(
        best.averageRegionDistance.toFixed(
          4
        )
      ) : null,
      roomTypesUsed: best?.roomTypesUsed || 0,
      transformIndex: best?.transformIndex ?? null
    };
  }
  const byRoomType = {};
  for (const assignment of best.assignments) {
    if (!assignment.room) {
      continue;
    }
    const roomType = String(
      assignment.room.type || assignment.room.roomType || "room"
    );
    if (!byRoomType[roomType]) {
      byRoomType[roomType] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0
      };
    }
    const bucket = byRoomType[roomType];
    bucket.electrical_items += 1;
    const subtype = classifyElectricalSubtypeFromAps(
      assignment.entry.item
    );
    if (subtype === "lighting") {
      bucket.lighting_points += 1;
    } else if (subtype === "socket") {
      bucket.socket_points += 1;
    } else if (subtype === "switch") {
      bucket.switches += 1;
    } else if (subtype === "distribution_board") {
      bucket.distribution_boards += 1;
    } else {
      bucket.other_electrical += 1;
    }
  }
  return {
    ...baseResult,
    valid: true,
    reason: "aps_electrical_centroid_to_verified_ai_room_bbox",
    byRoomType,
    assignedCount: best.assignments.filter(
      (item) => item.room
    ).length,
    totalCount: electrical.length,
    coverage: Number(
      best.coverage.toFixed(
        4
      )
    ),
    regionCoverage: Number(
      best.regionCoverage.toFixed(
        4
      )
    ),
    averageRegionDistance: Number(
      best.averageRegionDistance.toFixed(
        4
      )
    ),
    roomTypesUsed: best.roomTypesUsed,
    transformIndex: best.transformIndex
  };
}
function resolveRoomLocalElectricalQuantity(match, roomLocalMep) {
  if (!roomLocalMep?.valid) {
    return 0;
  }
  const roomType = String(
    match?.room_type || ""
  );
  const bucket = roomLocalMep.byRoomType[roomType];
  if (!bucket) {
    return 0;
  }
  const code = String(
    match?.item_code || ""
  ).toUpperCase();
  if (code === "ELE-001") {
    return bucket.lighting_points || 0;
  }
  if (code === "ELE-002") {
    return bucket.socket_points || 0;
  }
  if (code === "ELE-003") {
    return bucket.switches || 0;
  }
  if (code === "ELE-004") {
    return bucket.distribution_boards || 0;
  }
  if (code === "ELE-005") {
    return bucket.lighting_points || 0;
  }
  return bucket.electrical_items || 0;
}
function buildDeterministicRoomElectricalMatches(roomLocalMep, pricesByCode) {
  if (!roomLocalMep?.valid || !roomLocalMep?.byRoomType || !(pricesByCode instanceof Map)) {
    return [];
  }
  const matches = [];
  const definitions = [
    {
      itemCode: "ELE-001",
      bucketKey: "lighting_points",
      label: "APS measured room lighting points"
    },
    {
      itemCode: "ELE-002",
      bucketKey: "socket_points",
      label: "APS measured room socket points"
    },
    {
      itemCode: "ELE-003",
      bucketKey: "switches",
      label: "APS measured room switches"
    },
    {
      itemCode: "ELE-004",
      bucketKey: "distribution_boards",
      label: "APS measured room distribution boards"
    }
  ];
  for (const [
    roomType,
    bucket
  ] of Object.entries(
    roomLocalMep.byRoomType
  )) {
    for (const definition of definitions) {
      const quantity = Number(
        bucket?.[definition.bucketKey]
      ) || 0;
      if (quantity <= 0) {
        continue;
      }
      const code = normalizeCode(
        definition.itemCode
      );
      if (!pricesByCode.has(code)) {
        console.warn(
          "[VENTRA ROOM ELECTRICAL] catalog item missing",
          {
            item_code: definition.itemCode,
            room_type: roomType,
            measuredQuantity: quantity
          }
        );
        continue;
      }
      matches.push({
        item_code: definition.itemCode,
        quantity_basis: "electrical_items",
        room_type: roomType,
        reason: `${definition.label}; injected deterministically because Autodesk APS measured this subtype in the matched room.`,
        deterministicRoomElectrical: true
      });
    }
  }
  return matches;
}
async function handleCommercialRequest2(request) {
  try {
    const body = await request.json();
    const projectId = body?.projectId || null;
    const projectName = body?.projectName || "Untitled Project";
    const priceLevel = body?.priceLevel || "standard";
    const vatPercentage = Math.max(
      0,
      toNumber2(
        body?.vatPercentage ?? 5
      )
    );
    const rawTakeoff = body?.takeoff || {};
    const pendingCad = takeoffBoqIssue(rawTakeoff);
    if (pendingCad) return NextResponse4.json({ success: false, code: "CAD_EXTRACTION_INCOMPLETE", error: pendingCad }, { status: 409 });
    if (rawTakeoff.pdf_analysis) {
      const total = Number(rawTakeoff.total_pages || rawTakeoff.pdf_analysis.total_pages || 0);
      const analyzed = Array.isArray(rawTakeoff.page_results) ? new Set(rawTakeoff.page_results.map((p) => p.pageNumber)).size : Number(rawTakeoff.analyzed_pages || 0);
      const review = rawTakeoff.pdf_analysis.document_review_status?.status;
      if (rawTakeoff.pdf_analysis.summaryOnly || rawTakeoff.failed_pages?.length || rawTakeoff.pdf_analysis.failed_pages?.length || total > 0 && analyzed < total || ["failed", "pending"].includes(review)) {
        return NextResponse4.json({ success: false, code: "PDF_ANALYSIS_INCOMPLETE", error: `BOQ generation stopped: PDF page extraction or document review is incomplete (${analyzed}/${total || "?"} pages; review: ${review || "unavailable"}). The saved BOQ was not replaced. Recover complete source evidence before generating again.` }, { status: 409 });
      }
    }
    const takeoff = normalizeTakeoff(
      rawTakeoff
    );
    const rawSemanticRooms = getSemanticRooms(rawTakeoff);
    const hydratedRoomResult = hydrateSemanticRoomQuantities(
      rawSemanticRooms,
      takeoff
    );
    const semanticRooms = hydratedRoomResult.rooms;
    const rawElectricalForSpatial = Array.isArray(
      rawTakeoff?.object_details?.mep
    ) ? rawTakeoff.object_details.mep.filter(
      (item) => item?.detectedType === "electrical"
    ) : [];
    const validElectricalForSpatial = rawElectricalForSpatial.filter(
      (item) => {
        const x = item?.centroid?.x;
        const y = item?.centroid?.y;
        return x !== null && x !== void 0 && x !== "" && y !== null && y !== void 0 && y !== "" && Number.isFinite(
          Number(x)
        ) && Number.isFinite(
          Number(y)
        );
      }
    );
    console.log(
      "[VENTRA ELECTRICAL SPATIAL INPUT v14]",
      {
        total: rawElectricalForSpatial.length,
        withValidCentroid: validElectricalForSpatial.length,
        distinctCentroids: new Set(
          validElectricalForSpatial.map(
            (item) => `${Number(
              item.centroid.x
            ).toFixed(6)}:${Number(
              item.centroid.y
            ).toFixed(6)}`
          )
        ).size,
        centroidSources: validElectricalForSpatial.reduce(
          (result, item) => {
            const source2 = item?.centroid?.source || "unknown";
            result[source2] = (result[source2] || 0) + 1;
            return result;
          },
          {}
        )
      }
    );
    const worldRoomLocalMep = buildWorldRoomLocalMepCounts(
      rawTakeoff,
      semanticRooms
    );
    const roomCentroidDiagnostic = buildRoomCentroidElectricalCounts(
      rawTakeoff,
      semanticRooms
    );
    const imageRoomLocalDiagnostic = buildRoomLocalMepCounts(
      rawTakeoff,
      semanticRooms
    );
    const roomLocalMep = worldRoomLocalMep.valid ? {
      ...worldRoomLocalMep,
      fixVersion: "2026-08-17-electrical-centroid-root-v14"
    } : roomCentroidDiagnostic.valid ? {
      ...roomCentroidDiagnostic,
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      mapper: "verified_room_centroid_fallback",
      worldDiagnostic: worldRoomLocalMep,
      roomRegionDiagnostic: imageRoomLocalDiagnostic
    } : imageRoomLocalDiagnostic.valid ? {
      ...imageRoomLocalDiagnostic,
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      mapper: "verified_ai_room_bbox_fallback",
      worldDiagnostic: worldRoomLocalMep,
      roomCentroidDiagnostic
    } : {
      valid: false,
      mapper: "room_local_unavailable",
      fixVersion: "2026-08-17-electrical-centroid-root-v14",
      reason: `${worldRoomLocalMep.reason}; ${roomCentroidDiagnostic.reason}; ${imageRoomLocalDiagnostic.reason}`,
      byRoomType: {},
      assignedCount: 0,
      totalCount: worldRoomLocalMep.totalCount || roomCentroidDiagnostic.totalCount || imageRoomLocalDiagnostic.totalCount || 0,
      worldRoomCount: worldRoomLocalMep.worldRoomCount || 0,
      coverage: roomCentroidDiagnostic.coverage ?? imageRoomLocalDiagnostic.coverage ?? worldRoomLocalMep.coverage ?? 0,
      worldDiagnostic: worldRoomLocalMep,
      roomCentroidDiagnostic,
      roomRegionDiagnostic: imageRoomLocalDiagnostic
    };
    console.log(
      "[VENTRA ROOM SPATIAL INPUT v12]",
      {
        semanticRoomCount: semanticRooms.length,
        roomsWithCentroid: semanticRooms.filter(
          (room) => {
            const x = room?.centroid?.x;
            const y = room?.centroid?.y;
            return x !== null && x !== void 0 && y !== null && y !== void 0 && Number.isFinite(
              Number(x)
            ) && Number.isFinite(
              Number(y)
            );
          }
        ).length,
        distinctRoomCentroids: new Set(
          semanticRooms.filter(
            (room) => room?.centroid && room.centroid.x !== null && room.centroid.x !== void 0 && room.centroid.y !== null && room.centroid.y !== void 0
          ).map(
            (room) => `${Number(
              room.centroid.x
            ).toFixed(6)}:${Number(
              room.centroid.y
            ).toFixed(6)}`
          )
        ).size,
        roomsWithRegionBBox: semanticRooms.filter(
          (room) => room?.regionBBox && Number(
            room.regionBBox.width
          ) > 0 && Number(
            room.regionBBox.height
          ) > 0
        ).length,
        plans: [...new Set(
          semanticRooms.map(
            (room) => room?.planId
          ).filter(Boolean)
        )],
        sample: semanticRooms.slice(0, 4).map(
          (room) => ({
            name: room?.name,
            type: room?.type,
            planId: room?.planId || null,
            centroid: room?.centroid || null,
            regionBBox: room?.regionBBox || null
          })
        )
      }
    );
    console.log(
      "[VENTRA ROOM LOCAL MEP]",
      roomLocalMep
    );
    console.log(
      "[VENTRA ELECTRICAL SUBTYPE CLASSIFIER]",
      {
        total: Array.isArray(
          rawTakeoff?.object_details?.mep
        ) ? rawTakeoff.object_details.mep.filter(
          (item) => item?.detectedType === "electrical"
        ).length : 0,
        counts: summarizeElectricalSubtypes(
          Array.isArray(
            rawTakeoff?.object_details?.mep
          ) ? rawTakeoff.object_details.mep.filter(
            (item) => item?.detectedType === "electrical"
          ) : []
        )
      }
    );
    console.log("[VENTRA AI BOQ SCOPE] input", {
      semanticRoomCount: semanticRooms.length,
      roomQuantityHydration: hydratedRoomResult.source,
      roomsWithArea: semanticRooms.filter(
        (room) => Number(room?.area) > 0
      ).length,
      roomAreaTotal: Number(
        semanticRooms.reduce(
          (sum, room) => sum + (Number(room?.area) || 0),
          0
        ).toFixed(2)
      ),
      rawRoomCount: toNumber2(rawTakeoff.rooms),
      hasObjectDetails: Boolean(rawTakeoff.object_details),
      objectRoomCount: Array.isArray(rawTakeoff?.object_details?.rooms) ? rawTakeoff.object_details.rooms.length : 0
    });
    console.log("========== TAKEOFF ==========");
    console.log(takeoff);
    console.log("=============================");
    const supabase = createServerSupabase();
    const [
      rulesResult,
      pricesResult,
      sectionsResult
    ] = await Promise.all([
      supabase.from("boq_rules").select("*").eq("is_active", true).order("priority", {
        ascending: true
      }),
      fetchAllActivePriceItems(
        supabase
      ),
      supabase.from("boq_sections").select(
        "section_code, section_name, sort_order"
      ).eq("is_active", true)
    ]);
    console.log("[BOQ DEBUG]", {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      rulesCount: rulesResult.data?.length || 0,
      pricesCount: pricesResult.data?.length || 0,
      sectionsCount: sectionsResult.data?.length || 0,
      rulesError: rulesResult.error?.message || null,
      pricesError: pricesResult.error?.message || null,
      sectionsError: sectionsResult.error?.message || null,
      takeoff
    });
    if (rulesResult.error) {
      throw rulesResult.error;
    }
    if (pricesResult.error) {
      throw pricesResult.error;
    }
    if (sectionsResult.error) {
      throw sectionsResult.error;
    }
    const rules = rulesResult.data || [];
    const prices = pricesResult.data || [];
    if (isRasterTakeoff(rawTakeoff)) {
      const boq = buildRasterBoq({ takeoff: rawTakeoff, prices, rules, projectId, projectName, priceLevel, vatPercentage });
      return NextResponse4.json({ success: true, boq });
    }
    if (prices.length === 0 || !takeoff.pdf_analysis && rules.length === 0) {
      const fallbackBoq = takeoff.pdf_analysis ? { items: [], warnings: [] } : buildLocalBoq({
        takeoff,
        projectName,
        vatPercentage
      });
      const fallbackDwg = takeoff.pdf_analysis ? { items: [], warnings: [] } : applyDwgScheduleToBoq(fallbackBoq?.items || [], getDrawingEvidence(rawTakeoff) || {}, []);
      const fallbackPdf = retainUnboundPdfQuantities(fallbackDwg.items, takeoff);
      const fallbackPdfCompletion = annotatePdfBoqCompletion(fallbackPdf.items.map(requireBoqReview), takeoff, prices, priceLevel);
      const fallbackItems = fallbackPdfCompletion.items;
      fallbackItems.forEach((item, index) => {
        item.itemNumber = String(index + 1).padStart(2, "0");
      });
      const fallbackSubtotal = fallbackItems.reduce((sum, item) => sum + (classifyEstimateItem(item) === "pending" ? 0 : Number(item.amount) || 0), 0);
      const fallbackVat = fallbackSubtotal * Number(vatPercentage || 0) / 100;
      if (fallbackItems.length === 0) {
        return NextResponse4.json(
          {
            success: false,
            error: "BOQ database is empty and the fallback builder found no measurable quantities.",
            debug: {
              rules: rules.length,
              prices: prices.length,
              wallArea: takeoff.wall_area,
              wallLength: takeoff.wall_length,
              floorArea: takeoff.floor_area,
              rooms: takeoff.rooms,
              doors: takeoff.doors,
              windows: takeoff.windows
            }
          },
          { status: 422 }
        );
      }
      return NextResponse4.json({
        success: true,
        boq: {
          ...fallbackBoq,
          items: fallbackItems,
          pdfCompletion: fallbackPdfCompletion.summary,
          summary: { subtotal: fallbackSubtotal, vat: fallbackVat, grandTotal: fallbackSubtotal + fallbackVat },
          projectId,
          priceLevel,
          warnings: [
            `Ventra UAE BOQ database is not populated (rules: ${rules.length}, prices: ${prices.length}).`,
            takeoff.pdf_analysis ? "PDF quantities retained without rates. No allowance pricing was used." : "Starter allowance rates are being used. Review/edit rates before quotation or contract use.",
            ...fallbackPdf.warnings,
            ...fallbackDwg.warnings,
            ...Array.isArray(fallbackBoq.warnings) ? fallbackBoq.warnings : []
          ],
          assumptions: [
            ...Array.isArray(fallbackBoq.assumptions) ? fallbackBoq.assumptions : [],
            "This BOQ used Ventra's deterministic local fallback because the database rule/price tables were empty."
          ]
        }
      });
    }
    const pricesByCode = new Map(
      (pricesResult.data || []).map(
        (item) => [
          normalizeCode(item.item_code),
          item
        ]
      )
    );
    const sectionsByCode = new Map(
      (sectionsResult.data || []).map((section) => [
        section.section_code,
        section
      ])
    );
    const warnings = [...takeoff.pdf_analysis?.conflicts || []];
    const items = [];
    const claimedMeasuredFamilies = /* @__PURE__ */ new Set();
    const ventraBoqMode = String(
      process.env.VENTRA_BOQ_MODE || "commercial_safe"
    ).trim().toLowerCase();
    const allowEstimatedQuantities = ventraBoqMode === "development_estimates";
    const allowProvisionalDerivation = ventraBoqMode === "commercial_safe" || allowEstimatedQuantities;
    console.log(
      "[VENTRA BOQ HARDENING v29]",
      {
        mode: ventraBoqMode,
        allowEstimatedQuantities,
        allowProvisionalDerivation,
        policy: allowEstimatedQuantities ? "development_estimates_enabled" : allowProvisionalDerivation ? "measured_plus_provisional_derived_scope" : "measured_only"
      }
    );
    const pdfCatalogPlan = takeoff.pdf_analysis ? planPdfCatalogRules(takeoff, rules, prices) : null;
    if (pdfCatalogPlan) warnings.push(...pdfCatalogPlan.warnings);
    const pdfConsumedCodes = /* @__PURE__ */ new Set();
    for (const rule of pdfCatalogPlan?.rules || rulesResult.data || []) {
      const priceItem = pricesByCode.get(
        normalizeCode(rule.item_code)
      );
      if (!priceItem) {
        warnings.push(
          `Missing price item: ${rule.item_code}`
        );
        continue;
      }
      if (!takeoff.pdf_analysis && shouldSuppressDatabaseAutoRule(
        rule,
        priceItem,
        claimedMeasuredFamilies
      )) {
        console.log(
          "[VENTRA RULE SAFETY] suppressed",
          {
            item: rule.item_code,
            description: priceItem.description,
            reason: "conflicting_or_location_specific_database_auto_rule"
          }
        );
        continue;
      }
      let quantity = calculateQuantity(
        rule,
        takeoff
      );
      let quantityEstimate = null;
      const pdfCode = normalizeCode(priceItem.item_code);
      if (takeoff.pdf_analysis && pdfConsumedCodes.has(pdfCode)) continue;
      if (takeoff.pdf_analysis) pdfConsumedCodes.add(pdfCode);
      const pdfQuantity = pdfCatalogPlan?.bindings.get(pdfCode) || null;
      if (takeoff.pdf_analysis) {
        quantity = pdfQuantity?.quantity ?? 0;
        quantityEstimate = pdfQuantity;
      }
      if (!takeoff.pdf_analysis && allowProvisionalDerivation && quantity <= 0 && String(
        rule.formula_type || ""
      ).toLowerCase() === "manual") {
        quantityEstimate = estimateRemainingPendingQuantity(
          rule,
          priceItem,
          takeoff
        );
        if (Number(
          quantityEstimate.quantity
        ) <= 0 || quantityEstimate.measured !== true && [
          "foundation",
          "column",
          "beam",
          "slab"
        ].includes(
          String(
            rule.geometry_type || ""
          ).toLowerCase()
        )) {
          const fallbackEstimate = estimatePendingRuleQuantity(
            rule,
            priceItem,
            takeoff
          );
          if (quantityEstimate.measured !== true && Number(
            fallbackEstimate.quantity
          ) > 0) {
            quantityEstimate = fallbackEstimate;
          }
        }
        if (Number(
          quantityEstimate.quantity
        ) > 0) {
          quantity = round6(
            Number(
              quantityEstimate.quantity
            ),
            Number.isInteger(
              rule.rounding_precision
            ) ? rule.rounding_precision : 2
          );
        }
      }
      console.log({
        item: rule.item_code,
        geometry: rule.geometry_type,
        property: rule.geometry_property,
        quantity,
        estimateSource: quantityEstimate?.source || null
      });
      if ([
        "foundation",
        "column",
        "beam",
        "slab"
      ].includes(
        String(
          rule.geometry_type || ""
        ).toLowerCase()
      ) || quantityEstimate?.mappedGeometry) {
        console.log(
          "[VENTRA STRUCTURAL BOQ BINDING v33]",
          {
            item: rule.item_code,
            geometry: rule.geometry_type,
            mappedGeometry: quantityEstimate?.mappedGeometry || null,
            description: priceItem.description,
            unit: priceItem.unit,
            quantity,
            source: quantityEstimate?.source || null,
            measured: quantityEstimate?.measured === true
          }
        );
      }
      const isManualRule = String(
        rule.formula_type || ""
      ).toLowerCase() === "manual";
      const isQuantityPending = quantity <= 0;
      const isMeasuredDerivedRule = Number(
        quantityEstimate?.quantity
      ) > 0 && quantityEstimate?.measured === true;
      const isEstimatedRule = Number(
        quantityEstimate?.quantity
      ) > 0 && !isMeasuredDerivedRule;
      if (isQuantityPending && !isManualRule && !takeoff.pdf_analysis) {
        continue;
      }
      const section = sectionsByCode.get(
        rule.section_code || priceItem.section_code
      );
      const rateResolution = takeoff.pdf_analysis ? resolvePdfCatalogRate(priceItem, priceLevel) : resolveRate(
        priceItem,
        priceLevel,
        prices
      );
      const pdfRatePending = Boolean(pdfQuantity && rateResolution.missingRate);
      if (pdfRatePending) warnings.push(`PDF catalog item ${pdfCode} has no own rate. Its measured quantity is retained without a peer or median rate.`);
      const unitRate = rateResolution.rate;
      if (rateResolution.source !== `direct_${String(
        priceLevel || "standard"
      ).toLowerCase()}_rate`) {
        console.log(
          "[VENTRA RATE RESOLVER]",
          {
            item: priceItem.item_code,
            description: priceItem.description,
            selectedPriceLevel: priceLevel,
            standardRate: toNumber2(
              priceItem.standard_rate
            ),
            economyRate: toNumber2(
              priceItem.economy_rate
            ),
            premiumRate: toNumber2(
              priceItem.premium_rate
            ),
            componentRate: toNumber2(
              priceItem.material_rate
            ) + toNumber2(
              priceItem.labor_rate
            ) + toNumber2(
              priceItem.equipment_rate
            ) + toNumber2(
              priceItem.transport_rate
            ),
            resolvedRate: unitRate,
            source: rateResolution.source,
            peerCount: rateResolution.peerCount
          }
        );
      }
      const amount = isQuantityPending ? 0 : round6(
        quantity * unitRate,
        2
      );
      const commercialRate = isQuantityPending ? 0 : unitRate;
      const measuredFamily = getMeasuredRuleFamily(
        rule,
        priceItem
      );
      if (measuredFamily) {
        claimedMeasuredFamilies.add(
          measuredFamily
        );
      }
      items.push({
        itemNumber: "",
        itemCode: priceItem.item_code,
        sectionCode: rule.section_code || priceItem.section_code || "00",
        section: section?.section_name || priceItem.category || "General",
        category: priceItem.category || "",
        subCategory: priceItem.sub_category || "",
        description: priceItem.description,
        unit: priceItem.unit || "item",
        quantity,
        materialRate: toNumber2(
          priceItem.material_rate
        ),
        laborRate: toNumber2(
          priceItem.labor_rate
        ),
        equipmentRate: toNumber2(
          priceItem.equipment_rate
        ),
        transportRate: toNumber2(
          priceItem.transport_rate
        ),
        rate: round6(
          commercialRate,
          2
        ),
        referenceRate: round6(
          unitRate,
          2
        ),
        rateSource: isQuantityPending ? "reference_rate_not_priced_until_quantity_verified" : rateResolution.source,
        rateMissing: rateResolution.missingRate,
        amount,
        priceLevel,
        source: isQuantityPending ? "Ventra Rule Library - Quantity Pending" : isEstimatedRule ? "Ventra Rule Library - Estimated Quantity" : pdfQuantity ? "PDF schedule - requires review" : priceItem.source_name || "Ventra UAE Base Rate",
        status: isQuantityPending ? "quantity_pending" : pdfRatePending ? "measured_rate_pending" : isEstimatedRule ? "provisional_estimate" : "measured",
        verification: isQuantityPending ? "pending" : pdfRatePending ? "pending" : isEstimatedRule ? "provisional" : "verified",
        includeInCommercialTotal: !isQuantityPending && !isEstimatedRule && !pdfRatePending,
        measuredFromApsStructure: isMeasuredDerivedRule && !pdfQuantity,
        pdfEvidence: pdfQuantity ? { metricKey: pdfQuantity.metricKey, ...pdfQuantity.metricKeys ? { metricKeys: pdfQuantity.metricKeys } : {}, pages: pdfQuantity.pages, basis: pdfQuantity.evidence } : null,
        confidence: isEstimatedRule ? Math.min(
          toNumber2(
            quantityEstimate?.confidence
          ) || 35,
          65
        ) : toNumber2(
          priceItem.confidence_score
        ),
        quantityBasis: isQuantityPending ? "unavailable" : quantityEstimate?.source || (isEstimatedRule ? "derived_allowance" : "measured_takeoff"),
        quantitySource: pdfQuantity ? "pdf_schedule_evidence" : isMeasuredDerivedRule ? "aps_measured_structural_properties" : isEstimatedRule ? "derived_from_verified_project_metrics" : isQuantityPending ? "unavailable" : "measured",
        notes: [
          pdfRatePending ? "The matched catalog item has no own rate. Quantity retained; no peer or median rate borrowed." : "",
          pdfQuantity ? "Quantity transcribed from PDF evidence; scope, specification and rate require review." : rule.notes || "",
          pdfQuantity ? `PDF SCHEDULE EVIDENCE (AI; REVIEW REQUIRED): pages ${pdfQuantity.pages.join(", ")}; ${pdfQuantity.evidence}` : isEstimatedRule ? `PROVISIONAL: ${quantityEstimate?.source || "derived allowance"}. Excluded from verified commercial subtotal until replaced by measured quantity.` : isMeasuredDerivedRule ? `MEASURED FROM APS STRUCTURAL PROPERTIES: ${quantityEstimate?.source || "structural measurement"}.` : ""
        ].filter(Boolean).join(" ")
      });
    }
    const v36ColumnVolume = Number(
      takeoff?.column_volume
    ) || 0;
    const v36ColumnMeasured = takeoff?.structural_measurement_status?.columns?.volumeMeasured === true;
    if (!takeoff.pdf_analysis && v36ColumnMeasured && v36ColumnVolume > 0) {
      const v36Quantity = Math.round(
        v36ColumnVolume * 100
      ) / 100;
      const v36ConcreteCandidates = (pricesResult.data || []).filter((candidate) => {
        const unit5 = normalizeRateUnit(
          candidate?.unit
        );
        const description = String(
          candidate?.description || ""
        ).toLowerCase();
        const sectionCode = String(
          candidate?.section_code || ""
        ).trim();
        return unit5 === "m3" && /concrete/.test(
          description
        ) && !/block|masonry|screed|precast|kerb|curb/.test(
          description
        ) && (sectionCode === "03" || /reinforced|structural|c25|c30/.test(
          description
        ));
      }).map((candidate) => {
        const rateResolution = resolveRate(
          candidate,
          priceLevel,
          pricesResult.data || []
        );
        const description = String(
          candidate?.description || ""
        ).toLowerCase();
        let score = 0;
        if (/c25/.test(description)) {
          score += 8;
        }
        if (/reinforced/.test(description)) {
          score += 5;
        }
        if (/structural/.test(description)) {
          score += 4;
        }
        if (/column/.test(description)) {
          score += 3;
        }
        if (String(
          candidate?.section_code || ""
        ).trim() === "03") {
          score += 3;
        }
        return {
          candidate,
          rate: Number(
            rateResolution?.rate
          ) || 0,
          rateSource: rateResolution?.source || "catalog_rate",
          score
        };
      }).filter(
        (candidate) => candidate.rate > 0
      ).sort(
        (a, b) => b.score - a.score || a.rate - b.rate
      );
      const v36SelectedConcrete = v36ConcreteCandidates[0] || null;
      const v36Rate = v36SelectedConcrete?.rate || 0;
      const v36Amount = Math.round(
        v36Quantity * v36Rate * 100
      ) / 100;
      items.push({
        itemNumber: "",
        itemCode: "VSTR-COLUMN-CONC",
        sectionCode: "03",
        section: "Concrete Works",
        category: "Concrete Works",
        subCategory: "Column Concrete",
        description: v36SelectedConcrete ? `Reinforced concrete to columns - priced from ${v36SelectedConcrete.candidate?.description || "UAE concrete catalog"}` : "Reinforced concrete to columns - rate pending",
        unit: "m\xB3",
        quantity: v36Quantity,
        materialRate: 0,
        laborRate: 0,
        equipmentRate: 0,
        transportRate: 0,
        rate: v36Rate,
        referenceRate: v36Rate,
        rateSource: v36SelectedConcrete ? `structural_catalog_${v36SelectedConcrete.rateSource}` : "rate_pending_no_safe_concrete_catalog_match",
        rateMissing: v36Rate <= 0,
        amount: v36Amount,
        priceLevel,
        source: "Autodesk APS Structural Measurement + Ventra UAE Price Library",
        status: v36Rate > 0 ? "measured" : "measured_rate_pending",
        verification: "verified",
        includeInCommercialTotal: v36Rate > 0,
        measuredFromApsStructure: true,
        confidence: v36Rate > 0 ? 94 : 90,
        quantityBasis: "aps_measured_column_volume",
        quantitySource: "aps_measured_structural_properties",
        notes: v36SelectedConcrete ? "Column volume measured from APS. Rate selected deterministically from the existing UAE concrete price catalog; no OpenAI call used." : "Column volume measured from APS. No safe concrete catalog rate was available."
      });
      console.log(
        "[VENTRA FINAL COLUMN CONCRETE v36]",
        {
          quantity: v36Quantity,
          rate: v36Rate,
          amount: v36Amount,
          selectedCatalogItem: v36SelectedConcrete?.candidate?.item_code || null,
          selectedDescription: v36SelectedConcrete?.candidate?.description || null,
          rateSource: v36SelectedConcrete?.rateSource || null,
          commercial: v36Rate > 0
        }
      );
    }
    let aiScopePlan = null;
    let aiScopeMatches = [];
    const ventraMode = String(
      process.env.NEXT_PUBLIC_VENTRA_MODE || process.env.VENTRA_MODE || "production"
    ).trim().toLowerCase();
    const allowBoqAi = !takeoff.pdf_analysis && (String(
      process.env.VENTRA_ENABLE_BOQ_AI || ""
    ).trim().toLowerCase() === "true" || ventraMode === "production" && String(
      process.env.VENTRA_DISABLE_BOQ_AI || ""
    ).trim().toLowerCase() !== "true");
    console.log(
      "[VENTRA LOW COST v23] BOQ AI gate",
      {
        ventraMode,
        allowBoqAi,
        semanticRoomCount: semanticRooms.length,
        behavior: allowBoqAi ? "openai_scope_expansion_enabled" : "deterministic_boq_only_openai_skipped"
      }
    );
    if (allowBoqAi && semanticRooms.length > 0) {
      try {
        aiScopePlan = await inferConstructionScopes({
          rooms: semanticRooms,
          takeoff
        });
        const scopeSearchTerms = [
          ...aiScopePlan.catalog_search_terms || [],
          ...(aiScopePlan.scopes || []).flatMap((scope2) => [
            scope2.work,
            scope2.trade,
            `${scope2.trade || ""} ${scope2.work || ""}`.trim()
          ])
        ];
        const catalogCandidates = shortlistPriceCatalog(
          prices,
          scopeSearchTerms,
          500
        );
        console.log("[VENTRA AI BOQ SCOPE] plan", {
          semanticRooms: semanticRooms.map((room) => ({
            name: room.name,
            type: room.type,
            area: room.area,
            perimeter: room.perimeter
          })),
          scopesCount: aiScopePlan.scopes?.length || 0,
          searchTermsCount: scopeSearchTerms.length,
          catalogCandidates: catalogCandidates.length
        });
        const matched = await matchScopesToCatalog({
          scopes: aiScopePlan.scopes || [],
          candidates: catalogCandidates
        });
        const deterministicElectricalMatches = buildDeterministicRoomElectricalMatches(
          roomLocalMep,
          pricesByCode
        );
        const mergedMatches = [];
        const mergedMatchKeys = /* @__PURE__ */ new Set();
        for (const match of [
          ...matched.matches || [],
          ...deterministicElectricalMatches
        ]) {
          const key2 = `${normalizeCode(
            match?.item_code
          )}|${String(
            match?.room_type || ""
          )}`;
          if (mergedMatchKeys.has(
            key2
          )) {
            continue;
          }
          mergedMatchKeys.add(
            key2
          );
          mergedMatches.push(
            match
          );
        }
        console.log("[VENTRA AI BOQ SCOPE] catalog matches", {
          returnedMatches: matched.matches?.length || 0,
          deterministicElectricalMatches: deterministicElectricalMatches.length,
          mergedMatches: mergedMatches.length,
          matches: mergedMatches.slice(
            0,
            80
          )
        });
        const candidateCodes = new Set(
          catalogCandidates.map(
            (item) => normalizeCode(
              item.item_code
            )
          )
        );
        const existingCodes = new Set(
          items.map(
            (item) => normalizeCode(
              item.itemCode
            )
          )
        );
        const measuredRoomLocalCodes = /* @__PURE__ */ new Set();
        for (const match of mergedMatches) {
          const code = normalizeCode(
            match.item_code
          );
          if (!candidateCodes.has(code) && match?.deterministicRoomElectrical !== true) {
            continue;
          }
          const existingItemIndex = items.findIndex(
            (item) => normalizeCode(
              item.itemCode
            ) === code
          );
          const existingItem = existingItemIndex >= 0 ? items[existingItemIndex] : null;
          const priceItem = pricesByCode.get(code);
          if (!priceItem) {
            continue;
          }
          const effectiveQuantityBasis = getSafeQuantityBasis(
            match,
            priceItem
          );
          const effectiveMatch = {
            ...match,
            quantity_basis: effectiveQuantityBasis
          };
          const roomLocalElectricalQuantity = effectiveQuantityBasis === "electrical_items" ? resolveRoomLocalElectricalQuantity(
            match,
            roomLocalMep
          ) : 0;
          const quantity = round6(
            roomLocalElectricalQuantity > 0 ? roomLocalElectricalQuantity : resolveAiQuantity({
              match: effectiveMatch,
              rooms: semanticRooms,
              takeoff
            }),
            2
          );
          if (quantity <= 0) {
            console.log(
              "[VENTRA AI BOQ SCOPE] rejected quantity",
              {
                item_code: priceItem.item_code,
                room_type: match.room_type,
                quantity_basis: effectiveQuantityBasis,
                reason: "no_safe_room_local_quantity"
              }
            );
            continue;
          }
          const section = sectionsByCode.get(
            priceItem.section_code
          );
          const rateResolution = resolveRate(
            priceItem,
            priceLevel,
            prices
          );
          const unitRate = rateResolution.rate;
          if (unitRate <= 0) {
            console.log(
              "[VENTRA RATE MISSING]",
              {
                item: priceItem.item_code,
                description: priceItem.description,
                selectedPriceLevel: priceLevel,
                standardRate: toNumber2(
                  priceItem.standard_rate
                ),
                economyRate: toNumber2(
                  priceItem.economy_rate
                ),
                premiumRate: toNumber2(
                  priceItem.premium_rate
                ),
                materialRate: toNumber2(
                  priceItem.material_rate
                ),
                laborRate: toNumber2(
                  priceItem.labor_rate
                ),
                equipmentRate: toNumber2(
                  priceItem.equipment_rate
                ),
                transportRate: toNumber2(
                  priceItem.transport_rate
                )
              }
            );
          }
          const amount = round6(
            quantity * unitRate,
            2
          );
          if (roomLocalElectricalQuantity > 0 && existingItem && existingItem.status === "measured_estimated") {
            const firstMeasuredRoomForCode = !measuredRoomLocalCodes.has(
              code
            );
            existingItem.quantity = round6(
              firstMeasuredRoomForCode ? quantity : (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round6(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round6(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.source = "Autodesk APS Room-local Measurement";
            existingItem.status = "measured";
            existingItem.notes = `${firstMeasuredRoomForCode ? "Replaced estimated electrical allowance with measured APS room-local quantities." : existingItem.notes || ""} Room ${match.room_type}: ${quantity}. ${match.reason}`.trim();
            measuredRoomLocalCodes.add(
              code
            );
          } else if (roomLocalElectricalQuantity > 0 && existingItem && existingItem.source === "Autodesk APS Room-local Measurement") {
            existingItem.quantity = round6(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round6(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.notes = `${existingItem.notes || ""} Room ${match.room_type}: ${quantity}.`.trim();
            measuredRoomLocalCodes.add(
              code
            );
          } else if (existingItem && existingItem.status === "quantity_pending") {
            existingItem.quantity = round6(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.rate = round6(
              unitRate,
              2
            );
            existingItem.rateSource = rateResolution.source;
            existingItem.rateMissing = rateResolution.missingRate;
            existingItem.amount = round6(
              existingItem.quantity * unitRate,
              2
            );
            existingItem.source = "Ventra AI Scope Engine";
            existingItem.status = "measured_estimated";
            existingItem.notes = `${existingItem.notes || ""} AI quantity upgrade: ${match.reason} Basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}. ${semanticRooms.some(
              (room) => room.type === match.room_type && room.areaEstimated
            ) ? "Room quantity is currently estimated from semantic room layout and Autodesk total floor area." : ""}`.trim();
          } else if (!existingItem) {
            items.push({
              itemNumber: "",
              itemCode: priceItem.item_code,
              sectionCode: priceItem.section_code || "00",
              section: section?.section_name || priceItem.category || "General",
              category: priceItem.category || "",
              subCategory: priceItem.sub_category || "",
              description: priceItem.description,
              unit: priceItem.unit || "item",
              quantity,
              materialRate: toNumber2(
                priceItem.material_rate
              ),
              laborRate: toNumber2(
                priceItem.labor_rate
              ),
              equipmentRate: toNumber2(
                priceItem.equipment_rate
              ),
              transportRate: toNumber2(
                priceItem.transport_rate
              ),
              rate: round6(
                unitRate,
                2
              ),
              amount,
              priceLevel,
              source: roomLocalElectricalQuantity > 0 ? "Autodesk APS Room-local Measurement" : "Ventra AI Scope Engine",
              status: roomLocalElectricalQuantity > 0 ? "measured" : semanticRooms.some(
                (room) => room.type === match.room_type && room.areaEstimated
              ) ? "measured_estimated" : "measured",
              confidence: toNumber2(
                priceItem.confidence_score
              ),
              notes: `AI scope: ${match.reason} Quantity basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}.`
            });
          } else if (existingItem.source === "Ventra AI Scope Engine" || existingItem.status === "measured_estimated") {
            existingItem.quantity = round6(
              (Number(
                existingItem.quantity
              ) || 0) + quantity,
              2
            );
            existingItem.amount = round6(
              existingItem.quantity * unitRate,
              2
            );
          } else {
            continue;
          }
          existingCodes.add(code);
          aiScopeMatches.push({
            item_code: priceItem.item_code,
            quantity_basis: effectiveQuantityBasis,
            room_type: match.room_type,
            quantity,
            roomLocalQuantity: roomLocalElectricalQuantity > 0,
            deterministicRoomElectrical: match?.deterministicRoomElectrical === true,
            upgradedPendingRule: Boolean(
              existingItem && existingItem.status === "measured_estimated"
            )
          });
        }
        console.log("[VENTRA AI BOQ SCOPE] accepted", {
          acceptedItems: aiScopeMatches.length,
          items: aiScopeMatches,
          safetyMode: "room_specific_scopes_require_room_local_quantities"
        });
      } catch (aiScopeError) {
        warnings.push(
          `AI scope expansion skipped: ${aiScopeError instanceof Error ? aiScopeError.message : "unknown error"}`
        );
        console.warn(
          "[VENTRA AI BOQ SCOPE]",
          aiScopeError
        );
      }
    }
    const dwgResult = takeoff.pdf_analysis ? { items: [...items], warnings: [] } : applyDwgScheduleToBoq(items, getDrawingEvidence(rawTakeoff) || {}, prices.map((price) => {
      const resolved = resolveRate(price, priceLevel, prices);
      return { ...price, resolvedRate: resolved.missingRate ? 0 : resolved.rate, resolvedSource: resolved.source };
    }));
    items.splice(0, items.length, ...dwgResult.items);
    warnings.push(...dwgResult.warnings);
    if (getDrawingEvidence(rawTakeoff)?.extractionError) warnings.push(`DWG schedule extraction: ${getDrawingEvidence(rawTakeoff).extractionError}`);
    const pdfCoverage = retainUnboundPdfQuantities(items, takeoff);
    items.splice(0, items.length, ...pdfCoverage.items);
    items.forEach((item, index) => {
      items[index] = requireBoqReview(item);
    });
    const pdfCompletion = annotatePdfBoqCompletion(items, takeoff, prices, priceLevel);
    if (pdfCompletion.summary) {
      items.splice(0, items.length, ...pdfCompletion.items);
      warnings.push(`PDF BOQ: ${pdfCompletion.summary.unpricedMeasuredOperations} measured operations need specification/catalog-rate resolution. ${pdfCompletion.summary.catalogOptionsWithoutQuantity} zero-quantity catalog rows are options, not a count of missing project measurements. See each row's notes for required information.`);
    }
    console.log("[VENTRA BOQ EVIDENCE v37]", { reviewRequiredItems: items.filter((item) => item.reviewRequired).length, automaticScheduleReconciliation: true });
    warnings.push("Catalog descriptions and budget rates require project-specific review. Measured quantities alone do not verify scope or specification. Accepted DWG schedule quantities and explicit material notes are reconciled separately; unreadable or conflicting evidence remains unresolved.");
    console.log(
      "[VENTRA STRUCTURAL MEASUREMENT v30]",
      {
        slabVolume: Number(takeoff?.slab_volume) || 0,
        columnVolume: Number(takeoff?.column_volume) || 0,
        beamVolume: Number(takeoff?.beam_volume) || 0,
        foundationVolume: Number(takeoff?.foundation_volume) || 0,
        columnFormworkArea: Number(takeoff?.column_formwork_area) || 0,
        beamFormworkArea: Number(takeoff?.beam_formwork_area) || 0,
        foundationFormworkArea: Number(takeoff?.foundation_formwork_area) || 0,
        slabFormworkArea: Number(takeoff?.slab_formwork_area) || 0,
        status: takeoff?.structural_measurement_status || null,
        measuredStructuralItems: items.filter(
          (item) => item.measuredFromApsStructure === true
        ).length
      }
    );
    console.log(
      "[VENTRA BOQ RULE VISIBILITY]",
      {
        totalVisibleItems: items.length,
        measuredItems: items.filter(
          (item) => item.status === "measured"
        ).length,
        provisionalItems: items.filter(
          (item) => item.status === "provisional_estimate"
        ).length,
        measuredStructuralItems: items.filter(
          (item) => item.measuredFromApsStructure === true
        ).length,
        quantityPendingItems: items.filter(
          (item) => item.status === "quantity_pending"
        ).length,
        zeroAmountItems: items.filter(
          (item) => Number(
            item.amount
          ) === 0
        ).length,
        missingRateItems: items.filter(
          (item) => item.rateMissing === true
        ).length,
        peerRateFallbackItems: items.filter(
          (item) => String(
            item.rateSource || ""
          ).includes(
            "median_rate"
          ) || String(
            item.rateSource || ""
          ).includes(
            "median"
          )
        ).length
      }
    );
    items.sort((a, b) => {
      const sectionCompare = String(
        a.sectionCode
      ).localeCompare(
        String(
          b.sectionCode
        )
      );
      if (sectionCompare !== 0) {
        return sectionCompare;
      }
      return String(
        a.itemCode
      ).localeCompare(
        String(
          b.itemCode
        )
      );
    });
    items.forEach(
      (item, index) => {
        item.itemNumber = `${item.sectionCode}.${String(
          index + 1
        ).padStart(2, "0")}`;
      }
    );
    const verifiedSubtotal = round6(
      items.filter(
        (item) => item.includeInCommercialTotal === true
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const provisionalSubtotal = round6(
      items.filter(
        (item) => item.status === "provisional_estimate"
      ).reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      2
    );
    const pendingItems = items.filter(
      (item) => ["quantity_pending", "measured_rate_pending"].includes(item.status)
    ).length;
    const subtotal = verifiedSubtotal;
    const vatAmount = round6(
      verifiedSubtotal * (vatPercentage / 100),
      2
    );
    const grandTotal = round6(
      verifiedSubtotal + vatAmount,
      2
    );
    console.log(
      "[VENTRA COMMERCIAL TOTAL v24]",
      {
        verifiedSubtotal,
        provisionalSubtotal,
        pendingItems,
        quotedSubtotal: subtotal
      }
    );
    if (projectId && items.length) {
      const {
        error: deleteError
      } = await supabase.from("project_boq_items").delete().eq(
        "project_id",
        projectId
      ).eq(
        "source",
        "Ventra Rule Engine"
      );
      if (deleteError) {
        throw deleteError;
      }
      const rows = items.map(
        (item, index) => ({
          project_id: projectId,
          section_code: item.sectionCode,
          item_code: item.itemCode,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          material_rate: item.materialRate,
          labor_rate: item.laborRate,
          equipment_rate: item.equipmentRate,
          transport_rate: item.transportRate,
          unit_rate: item.rate,
          total_amount: item.amount,
          source: item.source || "Ventra Rule Engine",
          notes: item.notes,
          sort_order: index + 1
        })
      );
      const {
        error: insertError
      } = await supabase.from("project_boq_items").insert(rows);
      if (insertError) {
        throw insertError;
      }
    }
    if (items.length === 0) {
      return NextResponse4.json(
        {
          success: false,
          error: `No BOQ items generated. Rules: ${rulesResult.data?.length || 0}, Prices: ${pricesResult.data?.length || 0}, Wall area: ${takeoff.wall_area}, Wall length: ${takeoff.wall_length}`,
          debug: {
            rules: (rulesResult.data || []).map((rule) => ({
              item_code: rule.item_code,
              geometry_type: rule.geometry_type,
              geometry_property: rule.geometry_property,
              formula_type: rule.formula_type,
              multiplier: rule.multiplier
            })),
            availablePriceCodes: (pricesResult.data || []).map(
              (item) => item.item_code
            )
          }
        },
        { status: 422 }
      );
    }
    return NextResponse4.json({
      success: true,
      boq: {
        projectId,
        projectName,
        currency: "AED",
        priceLevel,
        takeoff,
        items,
        assumptions: [
          "Quantities were generated from detected drawing geometry.",
          items.some((item) => item.sourceRate) ? "Applicable rates from the original PDF rate book were used; other rows retain their catalog rate or explicit missing-rate status. Source rates are provisional and editable." : "Rates were loaded from the Ventra UAE price database."
        ],
        warnings,
        pdfCatalogAudit: pdfCatalogPlan?.catalogAudit || null,
        pdfCompletion: pdfCompletion.summary,
        aiScope: {
          detectedRooms: semanticRooms.map((room) => ({
            name: room.name,
            type: room.type,
            area: room.area,
            perimeter: room.perimeter
          })),
          plannedScopes: aiScopePlan?.scopes || [],
          matchedItems: aiScopeMatches
        },
        summary: {
          totalItems: items.length,
          verifiedItems: items.filter(
            (item) => item.status === "measured"
          ).length,
          provisionalItems: items.filter(
            (item) => item.status === "provisional_estimate"
          ).length,
          pendingItems,
          verifiedSubtotal,
          provisionalSubtotal,
          subtotal,
          vatPercentage,
          vatAmount,
          grandTotal,
          commercialSafe: false,
          evidencePolicyVersion: 37,
          scopeCoverage: "unconfirmed",
          reviewRequiredItems: items.filter((item) => item.reviewRequired).length
        }
      }
    });
  } catch (error2) {
    console.error(
      "[Generate BOQ]",
      error2
    );
    return NextResponse4.json(
      {
        success: false,
        error: error2 instanceof Error ? error2.message : "Unable to generate BOQ."
      },
      {
        status: 500
      }
    );
  }
}
async function runBoqRequest(request) {
  return commercialRun(request, "boq", handleCommercialRequest2);
}

// netlify/worker/preview-background.mjs
async function handler(request) {
  const input = await request.json();
  await executePreviewJob(input, (request2, action) => action === "boq" ? runBoqRequest(request2) : runPreviewRequest(request2));
}
var config = { background: true };
export {
  config,
  handler as default
};
