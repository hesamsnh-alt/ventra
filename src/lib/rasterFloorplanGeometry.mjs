// Raster-only geometry contract. No CAD, storage, network or renderer dependencies.
export const RASTER_GEOMETRY_VERSION = "raster-metric-trace-v1";

const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items) => ({ type: "array", items });
const number = { type: "number" };
const text = { type: "string" };
const nullableNumber = { type: ["number", "null"] };
const choice = (...values) => ({ type: "string", enum: values });
const point = object({ x: number, y: number });

export const rasterFloorplanSchema = object({
  title: text,
  confidence: number,
  wallHeightMeters: nullableNumber,
  measurements: array(object({
    id: text,
    text,
    axis: choice("horizontal", "vertical", "aligned"),
    start: point,
    end: point,
    meters: number,
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
    swingDirection: choice("clockwise", "counterclockwise", "unknown"),
  })),
});

// Vision reports pixel coordinates against explicitly supplied image dimensions.
// The existing compiler/renderer contract remains normalized to 0..1000.
export const rasterPixelTraceSchema = object({
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
  measurements: rasterFloorplanSchema.properties.measurements,
});

export function normalizeRasterPixelTrace(raw, { imageWidth, imageHeight }) {
  if (raw?.coordinateSpace !== "image_pixels" || raw.imageWidth !== imageWidth || raw.imageHeight !== imageHeight) {
    fail("COORDINATE_FRAME_MISMATCH", "The AI trace does not use the supplied image pixel frame.", { expected: { imageWidth, imageHeight }, actual: { imageWidth: raw?.imageWidth, imageHeight: raw?.imageHeight, coordinateSpace: raw?.coordinateSpace } });
  }
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) fail("IMAGE_SIZE_UNAVAILABLE", "Image dimensions must be positive.");
  const convert = (p) => {
    const x = finite(p?.x, "pixel.x"), y = finite(p?.y, "pixel.y");
    if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) fail("INVALID_COORDINATE", "A traced pixel lies outside the supplied image.");
    return { x: x * 1000 / imageWidth, y: y * 1000 / imageHeight };
  };
  const poly = (p) => list(p, "polygon", 1000).map(convert);
  const span = (s) => ({ ...s, start: convert(s.start), end: convert(s.end) });
  return {
    title: raw.title, confidence: raw.confidence, wallHeightMeters: raw.wallHeightMeters,
    footprint: poly(raw.footprint),
    measurements: list(raw.measurements, "measurements", 80).map(span),
    walls: list(raw.walls, "walls", 400).map(span),
    openings: list(raw.openings, "openings", 150).map(span),
    rooms: list(raw.rooms, "rooms", 100).map((r) => ({ ...r, polygon: poly(r.polygon) })),
    holes: list(raw.holes, "holes", 50).map((h) => ({ ...h, polygon: poly(h.polygon) })),
  };
}

export class RasterGeometryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RasterGeometryError";
    this.code = code;
    this.details = details;
  }
}

const EPS = 1e-8;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const fail = (code, message, details) => { throw new RasterGeometryError(code, message, details); };

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("INVALID_COORDINATE", `${label} must be a finite number.`);
  return value;
}

function imagePoint(p, label) {
  const x = finite(p?.x, `${label}.x`), y = finite(p?.y, `${label}.y`);
  if (x < 0 || x > 1000 || y < 0 || y > 1000) fail("INVALID_COORDINATE", `${label} is outside the image.`);
  return { x, y };
}

function list(value, name, limit) {
  if (!Array.isArray(value) || value.length > limit) fail("INVALID_TRACE", `${name} must be an array with at most ${limit} entries.`);
  return value;
}

function uniqueIds(items, label) {
  const ids = new Set();
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

const area = (poly) => Math.abs(signedArea(poly));
const edges = (poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);

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
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function polygon(points, label, transform) {
  let poly = list(points, label, 256).map((p, i) => transform(imagePoint(p, `${label}[${i}]`)));
  if (poly.length > 1 && distance(poly[0], poly.at(-1)) < EPS) poly = poly.slice(0, -1);
  if (poly.length < 3 || area(poly) < EPS) fail("INVALID_POLYGON", `${label} has no usable enclosed area.`);
  const boundary = edges(poly);
  for (let i = 0; i < boundary.length; i++) {
    const [a, b] = boundary[i];
    if (distance(a, b) < EPS) fail("INVALID_POLYGON", `${label} has a repeated consecutive point.`);
    const next = poly[(i + 2) % poly.length];
    if (Math.abs(cross(a, b, next)) < EPS && (b.x - a.x) * (next.x - b.x) + (b.y - a.y) * (next.y - b.y) < -EPS) {
      fail("SELF_INTERSECTING_POLYGON", `${label} backtracks along its boundary.`);
    }
    for (let j = i + 1; j < boundary.length; j++) {
      if (j === i + 1 || (i === 0 && j === boundary.length - 1)) continue;
      const [c, d] = boundary[j];
      const hit = intersection(a, b, c, d);
      const touching = hit
        ? hit.t >= -EPS && hit.t <= 1 + EPS && hit.u >= -EPS && hit.u <= 1 + EPS
        : Math.min(edgeDistance(a, c, d), edgeDistance(b, c, d), edgeDistance(c, a, b), edgeDistance(d, a, b)) <= EPS;
      if (touching) fail("SELF_INTERSECTING_POLYGON", `${label} crosses or touches itself.`, { edgeIndices: [i, j] });
    }
  }
  return poly;
}

// Partition at every boundary crossing; a midpoint-only check misses concave notches.
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
  return inside(a, poly, tolerance) && inside(b, poly, tolerance) &&
    ts.slice(1).every((t, i) => inside(lerp(a, b, (t + ts[i]) / 2), poly, tolerance));
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
      if (Math.abs(cross(a, b, c)) < EPS) { indices.splice(i, 1); removed = true; break; }
      if (cross(a, b, c) < 0) continue;
      if (indices.some((id) => id !== ia && id !== ib && id !== ic && cross(a, b, poly[id]) >= -EPS && cross(b, c, poly[id]) >= -EPS && cross(c, a, poly[id]) >= -EPS)) continue;
      result.push([a, b, c]); indices.splice(i, 1); removed = true; break;
    }
    if (!removed) fail("INVALID_POLYGON", "Could not triangulate a traced polygon.");
  }
  if (indices.length === 3) result.push(indices.map((id) => poly[id]));
  return result;
}

function triangleOverlap(a, b) {
  let output = a;
  for (const [c, d] of edges(b)) {
    const input = output; output = [];
    if (!input.length) break;
    for (const [p, q] of edges(input)) {
      const cp = cross(c, d, p), cq = cross(c, d, q);
      if (cp >= -EPS) output.push(p);
      if ((cp > EPS && cq < -EPS) || (cp < -EPS && cq > EPS)) output.push(lerp(p, q, cp / (cp - cq)));
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
    const dx = Math.abs(b.x - a.x) * imageWidth / 1000, dy = Math.abs(b.y - a.y) * imageHeight / 1000;
    const meters = finite(m.meters, `measurement ${m.id}.meters`);
    if (meters <= 0 || Math.hypot(dx, dy) < 5) fail("INVALID_MEASUREMENT", "A dimension has no usable reference span.", { id: m.id });
    if (m.axis === "horizontal" && dy > Math.max(3, dx * 0.03)) fail("INVALID_MEASUREMENT", "A horizontal dimension has inconsistent reference endpoints.", { id: m.id });
    if (m.axis === "vertical" && dx > Math.max(3, dy * 0.03)) fail("INVALID_MEASUREMENT", "A vertical dimension has inconsistent reference endpoints.", { id: m.id });
    if (!["horizontal", "vertical", "aligned"].includes(m.axis)) fail("INVALID_MEASUREMENT", "Unknown dimension axis.");
    return { ...m, dx, dy, meters, pixels: m.axis === "horizontal" ? dx : m.axis === "vertical" ? dy : Math.hypot(dx, dy) };
  });
  const fit = (items) => items.reduce((s, m) => s + m.pixels * m.meters, 0) / items.reduce((s, m) => s + m.pixels ** 2, 0);
  // Every supplied annotation is evidence. Conflicting dimensions cannot be
  // silently discarded, nor can independent X/Y scaling reshape the drawing.
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
    return { id: m.id, text: m.text, axis: m.axis, pixels: m.pixels, printedMeters: m.meters,
      tracedMeters: measured, errorMeters, toleranceMeters, accepted: errorMeters <= toleranceMeters + EPS };
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
    // Centerline endpoints are inset from outer-face corners by half a wall.
    // Allow that at the boundary's ends, without bridging gaps in its middle.
    const length = distance(a, b);
    if (low * length <= supportTolerance) low = 0;
    if ((1 - high) * length <= supportTolerance) high = 1;
    if (high > low) intervals.push([low, high]);
  }
  return mergeIntervals(intervals).reduce((sum, [low, high]) => sum + high - low, 0);
}

export function compileRasterFloorplan(raw, { imageWidth, imageHeight } = {}) {
  finite(imageWidth, "imageWidth"); finite(imageHeight, "imageHeight");
  if (imageWidth <= 0 || imageHeight <= 0) fail("IMAGE_SIZE_UNAVAILABLE", "The source image dimensions are unavailable.");
  const confidence = finite(raw?.confidence, "confidence");
  // Vision's self-reported confidence is not calibrated (the same model can
  // return a useful trace with a low score). Structural checks below are the
  // acceptance gate; retain the score only as review metadata.
  if (confidence < 0 || confidence > 1) fail("INVALID_CONFIDENCE", "The image trace confidence must be between 0 and 1.");
  const measurements = list(raw.measurements, "measurements", 80);
  const rawRooms = list(raw.rooms, "rooms", 100), rawWalls = list(raw.walls, "walls", 400);
  const rawHoles = list(raw.holes, "holes", 50), rawOpenings = list(raw.openings, "openings", 150);
  for (const [items, name] of [[measurements, "measurements"], [rawRooms, "rooms"], [rawWalls, "walls"], [rawHoles, "holes"], [rawOpenings, "openings"]]) uniqueIds(items, name);
  if (!rawRooms.length || rawWalls.length < 3) fail("INCOMPLETE_TRACE", "No complete floor-plan trace was returned.");
  const scale = scaleFromMeasurements(measurements, imageWidth, imageHeight);
  const footprintImage = polygon(raw.footprint, "footprint", (p) => p);
  const minX = Math.min(...footprintImage.map((p) => p.x)), maxX = Math.max(...footprintImage.map((p) => p.x));
  const minY = Math.min(...footprintImage.map((p) => p.y)), maxY = Math.max(...footprintImage.map((p) => p.y));
  const mx = imageWidth / 1000 * scale.sx, my = imageHeight / 1000 * scale.sy;
  // One affine transform for ALL layers, with one Y flip. No point clamping.
  const transform = (p) => ({ x: (p.x - minX) * mx, y: (maxY - p.y) * my });
  const width = (maxX - minX) * mx, depth = (maxY - minY) * my;
  const footprint = footprintImage.map(transform);
  const rooms = rawRooms.map((r) => ({ id: r.id, name: r.name, type: r.type, polygon: polygon(r.polygon, `room ${r.id}`, transform) }));
  const holes = rawHoles.map((h) => {
    if (!["shaft", "courtyard"].includes(h.type)) fail("INVALID_HOLE", "Only explicitly identified shafts/courtyards can remove floor.");
    return { id: h.id, type: h.type, polygon: polygon(h.polygon, `hole ${h.id}`, transform) };
  });
  const assumptions = ["Wall thickness is schematic: internal 0.12 m, external 0.18 m."];
  const height = raw.wallHeightMeters == null ? 2.8 : finite(raw.wallHeightMeters, "wallHeightMeters");
  if (raw.wallHeightMeters == null) assumptions.push("Wall height is assumed to be 2.80 m; it is not measurable from the plan view alone.");
  if (height <= 0) fail("INVALID_HEIGHT", "Wall height must be positive.");
  const walls = [], wallMap = new Map();
  for (const w of rawWalls) {
    if (!["external", "internal"].includes(w.type)) fail("INVALID_WALL", "Unknown wall type.", { id: w.id });
    const wall = { id: w.id, type: w.type, start: transform(imagePoint(w.start, `wall ${w.id}.start`)), end: transform(imagePoint(w.end, `wall ${w.id}.end`)) };
    if (distance(wall.start, wall.end) < 0.005) fail("INVALID_WALL", "A wall has no usable length.", { id: w.id });
    const duplicate = walls.find((v) => (distance(v.start, wall.start) < EPS && distance(v.end, wall.end) < EPS) || (distance(v.end, wall.start) < EPS && distance(v.start, wall.end) < EPS));
    if (duplicate && duplicate.type !== wall.type) fail("CONFLICTING_WALLS", "The same wall is classified as both internal and external.", { id: w.id });
    wallMap.set(w.id, { wall: duplicate || wall, reversed: duplicate ? distance(duplicate.end, wall.start) < EPS : false });
    if (!duplicate) walls.push(wall);
  }
  // Preserve oblique walls and narrow features. No global axis clustering/rectification.
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
  // Only image quantization and the declared schematic half-thickness explain
  // a face/centerline difference. This bound does not grow with room size.
  const pixelTolerance = Math.min(0.025, 2 * scale.sx);
  const externalTolerance = 0.09 + pixelTolerance;
  const externalEdges = walls.filter((w) => w.type === "external").map((w) => [w.start, w.end]);
  for (const [a, b] of edges(footprint)) {
    if (boundaryCoverage(a, b, externalEdges, externalTolerance) < 1 - EPS) fail("INCOMPLETE_EXTERIOR", "The exterior walls do not cover the traced footprint, including its recesses.");
  }
  const wallEdges = walls.map((w) => [w.start, w.end, (w.type === "external" ? 0.09 : 0.06) + pixelTolerance]);
  for (const room of rooms) {
    if (!edges(room.polygon).every(([a, b]) => segmentInside(a, b, footprint, 0.015))) fail("ROOM_OUTSIDE_FOOTPRINT", "A room crosses outside the traced footprint.", { roomId: room.id });
    const supports = [...wallEdges, ...edges(footprint).map(([a, b]) => [a, b, externalTolerance]),
      ...rooms.filter((r) => r.id !== room.id).flatMap((r) => edges(r.polygon).map(([a, b]) => [a, b, pixelTolerance]))];
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
    if (overlapArea > Math.max(0.002, Math.min(area(rooms[i].polygon), area(rooms[j].polygon)) * 0.002)) {
      fail("OVERLAPPING_ROOMS", "Room polygons overlap; shared walls cannot be validated.", { roomIds: [rooms[i].id, rooms[j].id], overlapArea });
    }
  }
  for (const hole of holes) {
    if (!edges(hole.polygon).every(([a, b]) => segmentInside(a, b, footprint))) fail("HOLE_OUTSIDE_FOOTPRINT", "A shaft/courtyard crosses outside the footprint.", { holeId: hole.id });
    if (rooms.some((r) => overlap(r.polygon, hole.polygon) > 0.002)) fail("HOLE_OVERLAPS_ROOM", "A shaft/courtyard overlaps a room.", { holeId: hole.id });
  }
  for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
    if (overlap(holes[i].polygon, holes[j].polygon) > 0.002) fail("OVERLAPPING_HOLES", "Shaft/courtyard polygons overlap.");
  }
  const openings = [], intervalsByWall = new Map();
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
    intervals.push([low, high]); intervalsByWall.set(wall.id, intervals);
    if (!["door", "window"].includes(o.type) || !["start", "end", "unknown"].includes(o.hingeSide) || !["clockwise", "counterclockwise", "unknown"].includes(o.swingDirection)) {
      fail("INVALID_OPENING", "A door/window has invalid type or swing metadata.", { openingId: o.id });
    }
    const openingHeight = o.heightMeters == null ? (o.type === "window" ? 1.2 : 2.1) : finite(o.heightMeters, `opening ${o.id}.height`);
    const sill = o.type === "door" ? 0 : o.sillHeightMeters == null ? 0.9 : finite(o.sillHeightMeters, `opening ${o.id}.sill`);
    if (openingHeight <= 0 || sill < 0 || openingHeight + sill > height + EPS) fail("INVALID_OPENING_HEIGHT", "The opening height/sill exceeds the wall height.", { openingId: o.id });
    if (o.heightMeters == null || (o.type === "window" && o.sillHeightMeters == null)) assumptions.push(`Opening ${o.id}: unannotated vertical dimensions use schematic defaults.`);
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
    roomCount: rooms.length, wallCount: walls.length, openingCount: openings.length, omittedOpeningCount: 0, omittedOpenings: [],
  };
  return {
    sceneType: "apartment_floorplan", title: raw.title || "Image floor plan",
    rasterGeometryVersion: RASTER_GEOMETRY_VERSION,
    width, depth, height, wallThickness: 0.12, externalWallThickness: 0.18, cutawayHeight: height,
    footprint, holes, rooms, walls, openings, assets: [],
    palette: { wall: "#B8B1A7", floor: "#92785D", ceiling: "#D7D1C7", accent: "#6D503B", glass: "#557F94", door: "#654736" },
    geometryValidation: validation,
  };
}
