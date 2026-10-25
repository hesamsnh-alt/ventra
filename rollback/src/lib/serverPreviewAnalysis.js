import { createPrintedDimensionAlignment, mapPrintedDimensionPoint } from '@/lib/printedDimensionAlignment.mjs';
import { prepareObservedOpeningWalls } from '@/lib/sourceOpeningWalls.mjs';
import {outdoorBoundaries,observedDoorOrientation} from '@/lib/schematicBoundaries.mjs';
import { canonicalRoomType } from "@/lib/roomSemantics.mjs";
import {commercialRun} from '@/lib/serverCommercial';
import { repairFixedFurniture } from "@/lib/fixedFurnitureRepair.mjs";
import { compileSourceFurniture } from "@/lib/sourceFurniture.mjs";
import { applySourceFurnitureReview } from "@/lib/sourceFurnitureReview.mjs";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { repairOverlappingWalls } from "@/lib/wallOverlapRepair.mjs";
import { filterOpenPlanPartitions } from "@/lib/openPlanPartitions.mjs";
import { createHash } from "node:crypto";
import { getOpenAIClient } from "@/services/openaiClient";
import { prepareRasterImageEvidence, rasterEvidencePrompt } from "@/lib/rasterImageEvidence.mjs";

const VERSION = "room-design-defaults-v64-20261011";
const MODEL = process.env.OPENAI_3D_PREVIEW_MODEL || "gpt-5.6-sol";
const requestedReasoning = process.env.OPENAI_3D_PREVIEW_REASONING || "medium";
const REASONING_EFFORT = ["low", "medium", "high"].includes(requestedReasoning) ? requestedReasoning : "medium";
const MAX_OUTPUT_TOKENS = Math.max(3500, Math.min(8000, Number(process.env.VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS || 8000)));
const TIMEOUT_MS = Math.max(45000, Math.min(180000, Number(process.env.VENTRA_3D_PREVIEW_TIMEOUT_MS || 120000)));

const pointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
};

// Trace source geometry and furniture separately; materials/heights remain visual defaults.
const sceneSchema = {
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
          polygon: { type: "array", minItems: 3, maxItems: 24, items: pointSchema },
        },
      },
    },
    furniture: {
      type: "array", maxItems: 80,
      items: {type:"object",additionalProperties:false,
        required:["id","groupId","roomId","type","backLeft","backRight","frontCenter","confidence","embeddedInCounter"],
        properties:{id:{type:"string"},groupId:{type:"string"},roomId:{type:"string"},
          type:{type:"string",enum:["sofa","bed","armchair","chair","dining_table","coffee_table","rug","kitchen_counter","sink","stove","refrigerator","wardrobe","tv_unit","toilet","shower","washing_machine","desk","nightstand","cabinet","plant"]},
          backLeft:pointSchema,backRight:pointSchema,frontCenter:pointSchema,
          confidence:{type:"number"},embeddedInCounter:{type:"boolean"}}
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
          confidence: { type: "number" },
        },
      },
    },
    partitions: {
      type: "array",
      maxItems: 96,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "start", "end"],
        properties: { id: { type: "string" }, start: pointSchema, end: pointSchema },
      },
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
          swingDirection: { type: "string" },
        },
      },
    },
  },
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

// A plan-view symbol does not provide an opening's vertical dimensions.
// Zero is the legacy "not supplied" height, not a half-metre opening.
function openingVerticalDimensions(opening, type) {
  const supplied = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const rawHeight = Number(opening?.heightMeters);
  const hasHeight = supplied(opening?.heightMeters) && rawHeight > 0;
  const height = hasHeight ? Math.min(2.8, rawHeight) : type === 'window' ? 1.25 : 2.1;
  const rawSill = Number(opening?.sillHeightMeters);
  const hasSill = type === 'window' && supplied(opening?.sillHeightMeters) && rawSill >= 0 && (hasHeight || rawSill > 0);
  const sillHeight = type === 'window' ? hasSill ? Math.min(rawSill, Math.max(0, 2.8 - height)) : Math.min(.9, 2.8 - height) : 0;
  return {
    height, sillHeight,
    heightSource: hasHeight ? 'source_dimension' : 'visual_default_not_measured',
    sillHeightSource: type === 'door' ? 'door_floor_level' : hasSill ? 'source_dimension' : 'visual_default_not_measured',
  };
}

function dist(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}

function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(sum / 2);
}

function cleanPolygon(points = []) {
  const out = [];
  for (const point of points) {
    if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) continue;
    const p = { x: Number(point.x), y: Number(point.y) };
    if (!out.length || dist(out[out.length - 1], p) > 0.025) out.push(p);
  }
  if (out.length > 2 && dist(out[0], out[out.length - 1]) < 0.025) out.pop();
  return out;
}

function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const hit = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x);
    if (hit) inside = !inside;
  }
  return inside;
}

function projectToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2 : 0;
  const t = Math.max(0, Math.min(1, raw));
  const q = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point: q, distance: dist(point, q), length: Math.sqrt(len2) };
}



function normalizedPointBounds(points = []) {
  const valid = (Array.isArray(points) ? points : []).filter(
    (p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))
  );
  if (!valid.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...valid.map((p) => Number(p.x))),
    minY: Math.min(...valid.map((p) => Number(p.y))),
    maxX: Math.max(...valid.map((p) => Number(p.x))),
    maxY: Math.max(...valid.map((p) => Number(p.y))),
  };
}

function roomNormalizedBounds(room) {
  return normalizedPointBounds(Array.isArray(room?.polygon) ? room.polygon : []);
}

function mean(values = []) {
  const nums = values.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function axisScaleQuality(input, axis, meterPerPixel, imageWidth, imageHeight) {
  if (!(meterPerPixel > 0)) return { meanRelativeError: null, count: 0 };
  const errors = [];
  for (const room of Array.isArray(input?.rooms) ? input.rooms : []) {
    if (room?.labelVisible === false) continue;
    const b = roomNormalizedBounds(room);
    const normalizedSpan = axis === "x" ? (b.maxX - b.minX) : (b.maxY - b.minY);
    const pixels = normalizedSpan * (axis === "x" ? imageWidth : imageHeight);
    const printed = Number(axis === "x" ? room?.printedWidthMeters : room?.printedDepthMeters);
    if (!(pixels > 4 && printed > 0.25)) continue;
    const predicted = pixels * meterPerPixel;
    errors.push(Math.abs(predicted - printed) / Math.max(printed, 0.25));
  }
  return { meanRelativeError: mean(errors), count: errors.length };
}


function projectImageNormalizedSceneToMeters(input, imageMeta = {}) {
  if (input?.coordinateMode !== "image_normalized") {
    return { raw: input, diagnostics: { applied: false, reason: "legacy_metric_input" } };
  }

  const imageWidth = clamp(imageMeta?.width, 64, 20000, 1000);
  const imageHeight = clamp(imageMeta?.height, 64, 20000, 1000);
  const statedWidth = clamp(input?.widthMeters, 2, 80, 10);
  const statedDepth = clamp(input?.depthMeters, 2, 80, 8);
  const footprint = Array.isArray(input?.footprint) ? input.footprint : [];
  const bounds = normalizedPointBounds(footprint);

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (!(spanX > 0.05 && spanY > 0.05)) {
    throw Object.assign(
      new Error("The preview returned an unusable normalized building outline."),
      { code: "PREVIEW_BAD_NORMALIZED_BOUNDS" }
    );
  }

  const pixelSpanX = spanX * imageWidth;
  const pixelSpanY = spanY * imageHeight;

  const scaleFromX = statedWidth / Math.max(pixelSpanX, 1e-6);
  const scaleFromY = statedDepth / Math.max(pixelSpanY, 1e-6);

  const xQuality = axisScaleQuality(input, "x", scaleFromX, imageWidth, imageHeight);
  const yQuality = axisScaleQuality(input, "y", scaleFromY, imageWidth, imageHeight);

  // V15:
  // Use ONE global affine calibration for the whole plan, but allow a distinct
  // metres-per-pixel value for each image axis. This is NOT per-room resizing.
  // Footprint, rooms, partitions and openings all receive the exact same
  // X/Y transform, so source topology is preserved while printed overall
  // architectural width/depth remain authoritative.
  //
  // If one overall axis is missing/unusable, fall back to a uniform scale
  // inferred from the valid axis.
  const hasWidth = Number.isFinite(Number(input?.widthMeters)) && Number(input.widthMeters) > 0.5;
  const hasDepth = Number.isFinite(Number(input?.depthMeters)) && Number(input.depthMeters) > 0.5;

  let meterPerPixelX = scaleFromX;
  let meterPerPixelY = scaleFromY;
  let calibrationMode = "two_axis_global_affine";

  if (hasWidth && !hasDepth) {
    meterPerPixelY = meterPerPixelX;
    calibrationMode = "uniform_from_x_only";
  } else if (!hasWidth && hasDepth) {
    meterPerPixelX = meterPerPixelY;
    calibrationMode = "uniform_from_y_only";
  }

  const width = pixelSpanX * meterPerPixelX;
  const depth = pixelSpanY * meterPerPixelY;

  const mapPoint = (point) => {
    const nx = clamp(point?.x, 0, 1, bounds.minX);
    const ny = clamp(point?.y, 0, 1, bounds.minY);
    return {
      x: (nx - bounds.minX) * imageWidth * meterPerPixelX,
      y: (ny - bounds.minY) * imageHeight * meterPerPixelY,
    };
  };

  const raw = {
    ...input,
    widthMeters: width,
    depthMeters: depth,
    coordinateMode: "meters_from_image_normalized_global_affine_v15",
    footprint: footprint.map(mapPoint),
    rooms: (Array.isArray(input?.rooms) ? input.rooms : []).map((room) => ({
      ...room,
      polygon: (Array.isArray(room?.polygon) ? room.polygon : []).map(mapPoint),
    })),
    partitions: (Array.isArray(input?.partitions) ? input.partitions : []).map((wall) => ({
      ...wall,
      start: mapPoint(wall?.start),
      end: mapPoint(wall?.end),
    })),
    furniture: (input.furniture || []).map(item => ({...item,backLeft:mapPoint(item.backLeft),backRight:mapPoint(item.backRight),frontCenter:mapPoint(item.frontCenter)})),
    openings: (Array.isArray(input?.openings) ? input.openings : []).map((opening) => ({
      ...opening,
      center: mapPoint(opening?.center),
    })),
  };

  const anisotropyRatio =
    meterPerPixelX > 0 && meterPerPixelY > 0
      ? Math.max(meterPerPixelX, meterPerPixelY) / Math.min(meterPerPixelX, meterPerPixelY)
      : 1;

  return {
    raw,
    diagnostics: {
      applied: true,
      reason: "single_global_two_axis_affine_transform_v15",
      calibrationMode,
      imageWidth,
      imageHeight,
      sourceBounds: {
        minX: Number(bounds.minX.toFixed(4)),
        minY: Number(bounds.minY.toFixed(4)),
        maxX: Number(bounds.maxX.toFixed(4)),
        maxY: Number(bounds.maxY.toFixed(4)),
      },
      pixelSpanX: Number(pixelSpanX.toFixed(2)),
      pixelSpanY: Number(pixelSpanY.toFixed(2)),
      statedWidthMeters: Number(statedWidth.toFixed(3)),
      statedDepthMeters: Number(statedDepth.toFixed(3)),
      projectedWidthMeters: Number(width.toFixed(3)),
      projectedDepthMeters: Number(depth.toFixed(3)),
      meterPerPixelX: Number(meterPerPixelX.toFixed(6)),
      meterPerPixelY: Number(meterPerPixelY.toFixed(6)),
      anisotropyRatio: Number(anisotropyRatio.toFixed(4)),
      xValidationMeanRelativeError:
        Number.isFinite(xQuality.meanRelativeError)
          ? Number(xQuality.meanRelativeError.toFixed(4))
          : null,
      yValidationMeanRelativeError:
        Number.isFinite(yQuality.meanRelativeError)
          ? Number(yQuality.meanRelativeError.toFixed(4))
          : null,
      xValidationCount: xQuality.count,
      yValidationCount: yQuality.count,
    },
  };
}

function sourcePoint(point, width, depth) {
  // Model returns plan coordinates in metres with image-style Y down.
  // Viewer scene uses Y up the plan, so flip once and only once here.
  const x = clamp(point?.x, 0, width, 0);
  const yDown = clamp(point?.y, 0, depth, 0);
  return { x, y: depth - yDown };
}

function snapAxisWall(wall) {
  const a = { ...wall.start };
  const b = { ...wall.end };
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx > dy * 5) {
    const y = (a.y + b.y) / 2;
    a.y = y; b.y = y;
  } else if (dy > dx * 5) {
    const x = (a.x + b.x) / 2;
    a.x = x; b.x = x;
  }
  return { ...wall, start: a, end: b };
}

function wallKey(wall) {
  const a = `${wall.start.x.toFixed(3)},${wall.start.y.toFixed(3)}`;
  const b = `${wall.end.x.toFixed(3)},${wall.end.y.toFixed(3)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function roomBounds(room) {
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function canonicalRoomName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function fitAxisAlignedRoomToPrintedDimensions(room, width, depth) {
  const pw = Number(room?.printedWidthMeters || 0);
  const pd = Number(room?.printedDepthMeters || 0);
  if (!(pw > 0.35 && pd > 0.35) || room.polygon.length !== 4) return room;
  const b = roomBounds(room);
  const currentW = b.maxX - b.minX;
  const currentD = b.maxY - b.minY;
  if (!(currentW > 0.2 && currentD > 0.2)) return room;

  // Only correct rooms that are already approximately rectangular. This uses
  // printed dimensions as hard metric evidence without turning an irregular
  // room into a rectangle.
  const xs = [...new Set(room.polygon.map((p) => Number(p.x.toFixed(3))))];
  const ys = [...new Set(room.polygon.map((p) => Number(p.y.toFixed(3))))];
  if (xs.length > 2 || ys.length > 2) return room;

  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const targetW = clamp(pw, 0.35, width, currentW);
  const targetD = clamp(pd, 0.35, depth, currentD);
  let minX = cx - targetW / 2;
  let maxX = cx + targetW / 2;
  let minY = cy - targetD / 2;
  let maxY = cy + targetD / 2;
  if (minX < 0) { maxX -= minX; minX = 0; }
  if (maxX > width) { minX -= maxX - width; maxX = width; }
  if (minY < 0) { maxY -= minY; minY = 0; }
  if (maxY > depth) { minY -= maxY - depth; maxY = depth; }
  return { ...room, polygon: [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ] };
}


function pointToSegmentDistance(point, a, b) {
  return projectToSegment(point, a, b).distance;
}


function rectFromRoom(room) {
  if (!room?.polygon || room.polygon.length !== 4) return null;
  const xs = [...new Set(room.polygon.map((p) => Number(p.x.toFixed(3))))].sort((a, b) => a - b);
  const ys = [...new Set(room.polygon.map((p) => Number(p.y.toFixed(3))))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return null;
  const [minX, maxX] = xs;
  const [minY, maxY] = ys;
  if (maxX - minX < 0.2 || maxY - minY < 0.2) return null;
  return { minX, maxX, minY, maxY };
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
}

function roomCenter(room) {
  const b = roomBounds(room);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function shiftRoom(room, dx, dy, width, depth) {
  const moved = room.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  const b = roomBounds({ ...room, polygon: moved });
  let fixX = 0, fixY = 0;
  if (b.minX < 0) fixX = -b.minX;
  else if (b.maxX > width) fixX = width - b.maxX;
  if (b.minY < 0) fixY = -b.minY;
  else if (b.maxY > depth) fixY = depth - b.maxY;
  return { ...room, polygon: moved.map((p) => ({ x: p.x + fixX, y: p.y + fixY })) };
}

function pairKey(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function normalizeRelationships(rawRelationships, roomIds) {
  const valid = new Set(roomIds.map(String));
  const out = [];
  const seen = new Set();
  for (const rel of Array.isArray(rawRelationships) ? rawRelationships : []) {
    const a = String(rel?.roomAId || "");
    const b = String(rel?.roomBId || "");
    if (!a || !b || a === b || !valid.has(a) || !valid.has(b)) continue;
    const relation = ["wall", "open", "door", "separate"].includes(rel?.relation) ? rel.relation : "separate";
    const key = `${pairKey(a, b)}:${relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      roomAId: a,
      roomBId: b,
      relation,
      direction: ["left", "right", "above", "below", "overlap"].includes(rel?.direction) ? rel.direction : "overlap",
      confidence: clamp(rel?.confidence, 0, 1, 0.5),
    });
  }
  return out;
}

function inferRoomPairGeometry(roomA, roomB) {
  const a = rectFromRoom(roomA);
  const b = rectFromRoom(roomB);
  if (!a || !b) return null;
  const ca = roomCenter(roomA), cb = roomCenter(roomB);
  const overlapX = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapY = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) {
    if (ca.x <= cb.x) return { axis: "x", first: roomA, second: roomB, gap: b.minX - a.maxX, overlap: overlapY };
    return { axis: "x", first: roomB, second: roomA, gap: a.minX - b.maxX, overlap: overlapY };
  }
  if (ca.y <= cb.y) return { axis: "y", first: roomA, second: roomB, gap: b.minY - a.maxY, overlap: overlapX };
  return { axis: "y", first: roomB, second: roomA, gap: a.minY - b.maxY, overlap: overlapX };
}

function topologyRoomPriority(room) {
  const t = canonicalRoomType(room);
  if (t === "living" || t === "kitchen_dining" || t === "kitchen" || t === "dining") return 5;
  if (t === "bedroom") return 4;
  if (t === "office") return 3;
  if (t === "bathroom" || t === "storage") return 2;
  return 1;
}

function relationDirection(rel, roomA, roomB) {
  if (["left", "right", "above", "below"].includes(rel?.direction)) return rel.direction;
  const ca = roomCenter(roomA), cb = roomCenter(roomB);
  if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) return cb.x >= ca.x ? "right" : "left";
  return cb.y >= ca.y ? "below" : "above";
}

function relationResidual(roomA, roomB, rel) {
  const a = rectFromRoom(roomA), b = rectFromRoom(roomB);
  if (!a || !b) return null;
  const dir = relationDirection(rel, roomA, roomB);
  if (dir === "right") return { axis: "x", gap: b.minX - a.maxX, crossGap: ((b.minY+b.maxY)-(a.minY+a.maxY))/2, overlap: Math.max(0, Math.min(a.maxY,b.maxY)-Math.max(a.minY,b.minY)), dir };
  if (dir === "left")  return { axis: "x", gap: a.minX - b.maxX, crossGap: ((b.minY+b.maxY)-(a.minY+a.maxY))/2, overlap: Math.max(0, Math.min(a.maxY,b.maxY)-Math.max(a.minY,b.minY)), dir };
  if (dir === "below") return { axis: "y", gap: b.minY - a.maxY, crossGap: ((b.minX+b.maxX)-(a.minX+a.maxX))/2, overlap: Math.max(0, Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)), dir };
  return { axis: "y", gap: a.minY - b.maxY, crossGap: ((b.minX+b.maxX)-(a.minX+a.maxX))/2, overlap: Math.max(0, Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)), dir };
}

function invertRelationDirection(dir) {
  if (dir === "left") return "right";
  if (dir === "right") return "left";
  if (dir === "above") return "below";
  if (dir === "below") return "above";
  return dir;
}

function orientRelationship(rel, fromId) {
  if (String(rel.roomAId) === String(fromId)) return { ...rel };
  return {
    ...rel,
    roomAId: rel.roomBId,
    roomBId: rel.roomAId,
    direction: invertRelationDirection(rel.direction),
  };
}

function placeAdjacentRoom(anchorRoom, movingRoom, rel, width, depth) {
  const a = rectFromRoom(anchorRoom), b = rectFromRoom(movingRoom);
  if (!a || !b) return movingRoom;
  let dir = relationDirection(rel, anchorRoom, movingRoom);
  if (dir === "overlap") dir = Math.abs(roomCenter(movingRoom).x-roomCenter(anchorRoom).x) >= Math.abs(roomCenter(movingRoom).y-roomCenter(anchorRoom).y)
    ? (roomCenter(movingRoom).x >= roomCenter(anchorRoom).x ? "right" : "left")
    : (roomCenter(movingRoom).y >= roomCenter(anchorRoom).y ? "below" : "above");

  const ac = roomCenter(anchorRoom), bc = roomCenter(movingRoom);
  let dx = 0, dy = 0;
  const minCrossOverlap = rel.relation === "open" ? 0.9 : 0.45;

  if (dir === "right" || dir === "left") {
    const targetMinX = dir === "right" ? a.maxX : a.minX - (b.maxX-b.minX);
    dx = targetMinX - b.minX;
    // Preserve the source cross-axis ordering, but guarantee a meaningful shared edge.
    const halfA=(a.maxY-a.minY)/2, halfB=(b.maxY-b.minY)/2;
    const maxOffset=Math.max(0, halfA+halfB-minCrossOverlap);
    const originalOffset=bc.y-ac.y;
    const targetCenterY=ac.y + Math.max(-maxOffset, Math.min(maxOffset, originalOffset));
    dy = targetCenterY - bc.y;
  } else {
    const targetMinY = dir === "below" ? a.maxY : a.minY - (b.maxY-b.minY);
    dy = targetMinY - b.minY;
    const halfA=(a.maxX-a.minX)/2, halfB=(b.maxX-b.minX)/2;
    const maxOffset=Math.max(0, halfA+halfB-minCrossOverlap);
    const originalOffset=bc.x-ac.x;
    const targetCenterX=ac.x + Math.max(-maxOffset, Math.min(maxOffset, originalOffset));
    dx = targetCenterX - bc.x;
  }
  return shiftRoom(movingRoom, dx, dy, width, depth);
}

function stabilizeRoomTopology(inputRooms, relationships, width, depth) {
  const originalRooms = inputRooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => ({ ...p })) }));
  const rooms = originalRooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => ({ ...p })) }));
  const diagnostics = {
    applied: false,
    shiftedRooms: 0,
    snappedPairs: 0,
    openPairs: 0,
    wallPairs: 0,
    rejectedLargeGaps: 0,
    maxShiftMeters: 0,
    relationshipResidualMean: null,
    sourceAnchorMeanShift: 0,
    maxAllowedShiftMeters: 0.8,
    guardedRelationships: 0,
  };

  const active = relationships.filter((r) => r.relation !== "separate" && r.confidence >= 0.45);
  const byId = new Map(rooms.map((r, i) => [String(r.id), i]));
  for (const rel of active) {
    if (!byId.has(String(rel.roomAId)) || !byId.has(String(rel.roomBId))) continue;
    if (rel.relation === "open") diagnostics.openPairs += 1;
    if (rel.relation === "wall" || rel.relation === "door") diagnostics.wallPairs += 1;
  }

  const originalCenters = new Map(originalRooms.map((r) => [String(r.id), roomCenter(r)]));
  const shiftBudgetFor = (room) => {
    const t = canonicalRoomType(room);
    if (t === "living" || t === "kitchen_dining") return 0.38;
    if (t === "bedroom") return 0.48;
    if (t === "bathroom" || t === "storage") return 0.80;
    return 0.55;
  };

  const anchorRoom = (room) => {
    const c = roomCenter(room);
    const o = originalCenters.get(String(room.id));
    if (!o) return room;
    const budget = shiftBudgetFor(room);
    const dx = c.x - o.x, dy = c.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget || dist < 1e-6) return room;
    const k = budget / dist;
    return shiftRoom(room, o.x + dx * k - c.x, o.y + dy * k - c.y, width, depth);
  };

  // V12: relationships may refine the image observation, but they are not
  // allowed to rebuild the whole apartment. V11 proved that graph propagation
  // can move rooms several metres when a single semantic relation is wrong.
  // Here every correction is local and each room remains tightly anchored to
  // the source-image position returned by the vision model.
  for (let iter = 0; iter < 4; iter += 1) {
    let changed = false;
    for (const rel of active) {
      const ia = byId.get(String(rel.roomAId));
      const ib = byId.get(String(rel.roomBId));
      if (ia == null || ib == null) continue;
      const rr = relationResidual(rooms[ia], rooms[ib], rel);
      if (!rr) continue;

      const absGap = Math.abs(rr.gap);
      const minimumOverlap = rel.relation === "open" ? 0.70 : 0.28;
      // A relationship several metres away is more likely a semantic mistake
      // than a geometry defect. Keep it for diagnostics but do not drag rooms.
      if (absGap > 1.15) {
        diagnostics.rejectedLargeGaps += 1;
        diagnostics.guardedRelationships += 1;
        continue;
      }

      const pa = topologyRoomPriority(rooms[ia]);
      const pb = topologyRoomPriority(rooms[ib]);
      let wa = 0.5, wb = 0.5;
      if (pa > pb) { wa = 0.20; wb = 0.80; }
      else if (pb > pa) { wa = 0.80; wb = 0.20; }

      let adx = 0, ady = 0, bdx = 0, bdy = 0;
      if (absGap > 0.035) {
        const correction = Math.max(-0.30, Math.min(0.30, rr.gap)) * 0.72;
        if (rr.dir === "right") { adx += correction * wa; bdx -= correction * wb; }
        else if (rr.dir === "left") { adx -= correction * wa; bdx += correction * wb; }
        else if (rr.dir === "below") { ady += correction * wa; bdy -= correction * wb; }
        else { ady -= correction * wa; bdy += correction * wb; }
      }

      // Only repair cross-axis alignment when the rooms almost touch already.
      // This avoids the V11 failure where a wrong graph relation pulled a room
      // across the apartment simply to manufacture a shared edge.
      if (absGap < 0.55 && rr.overlap < minimumOverlap) {
        const cross = Math.max(-0.22, Math.min(0.22, rr.crossGap)) * 0.30;
        if (rr.axis === "x") { ady += cross * wa; bdy -= cross * wb; }
        else { adx += cross * wa; bdx -= cross * wb; }
      }

      if (Math.hypot(adx, ady) + Math.hypot(bdx, bdy) < 0.005) continue;
      rooms[ia] = anchorRoom(shiftRoom(rooms[ia], adx, ady, width, depth));
      rooms[ib] = anchorRoom(shiftRoom(rooms[ib], bdx, bdy, width, depth));
      diagnostics.snappedPairs += 1;
      changed = true;
    }
    if (!changed) break;
  }

  let residualSum = 0, residualCount = 0, shiftSum = 0, shiftCount = 0;
  const finalMap = new Map(rooms.map((r) => [String(r.id), r]));
  for (const rel of active) {
    const a = finalMap.get(String(rel.roomAId));
    const b = finalMap.get(String(rel.roomBId));
    if (!a || !b) continue;
    const rr = relationResidual(a, b, rel);
    if (rr) { residualSum += Math.abs(rr.gap); residualCount += 1; }
  }
  diagnostics.relationshipResidualMean = residualCount ? residualSum / residualCount : null;

  for (const r of rooms) {
    const o = originalCenters.get(String(r.id));
    if (!o) continue;
    const c = roomCenter(r);
    const move = Math.hypot(c.x - o.x, c.y - o.y);
    if (move > 0.01) diagnostics.shiftedRooms += 1;
    diagnostics.maxShiftMeters = Math.max(diagnostics.maxShiftMeters, move);
    shiftSum += move;
    shiftCount += 1;
  }
  diagnostics.sourceAnchorMeanShift = shiftCount ? shiftSum / shiftCount : 0;
  diagnostics.applied = diagnostics.shiftedRooms > 0;
  return { rooms, diagnostics };
}

function separateServiceRoomOverlaps(inputRooms, width, depth) {
  const rooms = inputRooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => ({ ...p })) }));
  let adjustments = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        const a = rectFromRoom(rooms[i]), b = rectFromRoom(rooms[j]);
        if (!a || !b) continue;
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        if (ox <= 0.04 || oy <= 0.04) continue;
        const ta = canonicalRoomType(rooms[i]), tb = canonicalRoomType(rooms[j]);
        const serviceA = ["bathroom", "storage"].includes(ta);
        const serviceB = ["bathroom", "storage"].includes(tb);
        if (!serviceA && !serviceB) continue;
        // Only repair modest overlaps caused by vision/dimension snapping.
        if (Math.min(ox, oy) > 0.65) continue;
        const targetIndex = serviceA && !serviceB ? i : serviceB && !serviceA ? j : (polygonArea(rooms[i].polygon) <= polygonArea(rooms[j].polygon) ? i : j);
        const otherIndex = targetIndex === i ? j : i;
        const tc = roomCenter(rooms[targetIndex]), oc = roomCenter(rooms[otherIndex]);
        if (ox < oy) {
          const dir = tc.x <= oc.x ? -1 : 1;
          rooms[targetIndex] = shiftRoom(rooms[targetIndex], dir * (ox + 0.03), 0, width, depth);
        } else {
          const dir = tc.y <= oc.y ? -1 : 1;
          rooms[targetIndex] = shiftRoom(rooms[targetIndex], 0, dir * (oy + 0.03), width, depth);
        }
        adjustments += 1;
      }
    }
  }
  return { rooms, adjustments };
}

function roomAtOffsetPoint(point, rooms) {
  return rooms.find((room) => pointInPolygon(point, room.polygon))?.id || null;
}

function partitionPairAcrossWall(wall, rooms) {
  const length = dist(wall.start, wall.end);
  if (length < 0.20) return null;
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;
  for (const offset of [0.12, 0.20, 0.28]) {
    const a = roomAtOffsetPoint({ x: mx + nx * offset, y: my + ny * offset }, rooms);
    const b = roomAtOffsetPoint({ x: mx - nx * offset, y: my - ny * offset }, rooms);
    if (a && b && a !== b) return pairKey(a, b);
  }
  return null;
}

function sharedBoundaryForRelationship(roomA, roomB) {
  const a = rectFromRoom(roomA), b = rectFromRoom(roomB);
  if (!a || !b) return null;
  const g = inferRoomPairGeometry(roomA, roomB);
  if (!g) return null;
  if (g.axis === "x") {
    const y0 = Math.max(a.minY, b.minY), y1 = Math.min(a.maxY, b.maxY);
    if (y1 - y0 < 0.35 || Math.abs(g.gap) > 0.18) return null;
    const x = ((g.first === roomA ? a.maxX : b.maxX) + (g.second === roomB ? b.minX : a.minX)) / 2;
    return { start: { x, y: y0 }, end: { x, y: y1 } };
  }
  const x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX);
  if (x1 - x0 < 0.35 || Math.abs(g.gap) > 0.18) return null;
  const y = ((g.first === roomA ? a.maxY : b.maxY) + (g.second === roomB ? b.minY : a.minY)) / 2;
  return { start: { x: x0, y }, end: { x: x1, y } };
}

function ensureRelationshipWalls(partitions, rooms, relationships) {
  const roomById = new Map(rooms.map((r) => [String(r.id), r]));
  const out = [...partitions];
  let added = 0;
  for (const rel of relationships) {
    if (!(rel.relation === "wall" || rel.relation === "door") || rel.confidence < 0.60) continue;
    const a = roomById.get(String(rel.roomAId)), b = roomById.get(String(rel.roomBId));
    if (!a || !b) continue;
    const candidate = sharedBoundaryForRelationship(a, b);
    if (!candidate) continue;
    const duplicate = out.some((wall) => {
      const m = { x: (candidate.start.x + candidate.end.x) / 2, y: (candidate.start.y + candidate.end.y) / 2 };
      return pointToSegmentDistance(m, wall.start, wall.end) < 0.14;
    });
    if (!duplicate) {
      out.push({ id: `rel_${a.id}_${b.id}`.slice(0, 64), type: "internal", ...candidate });
      added += 1;
    }
  }
  return { partitions: out, added };
}

function getRelationshipForPair(relationships, aId, bId) {
  const key = pairKey(aId, bId);
  return (Array.isArray(relationships) ? relationships : []).find(
    (rel) => pairKey(rel.roomAId, rel.roomBId) === key
  ) || null;
}

function roomsAcrossWallDetailed(wall, rooms) {
  const length = dist(wall.start, wall.end);
  if (length < 0.20) return { a: null, b: null, ids: [] };
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;
  for (const offset of [0.10, 0.16, 0.22, 0.28, 0.34]) {
    const a = roomAtOffsetPoint({ x: mx + nx * offset, y: my + ny * offset }, rooms);
    const b = roomAtOffsetPoint({ x: mx - nx * offset, y: my - ny * offset }, rooms);
    const ids = [...new Set([a, b].filter(Boolean))];
    if (a || b) return { a, b, ids };
  }
  return { a: null, b: null, ids: [] };
}

function openingPlacementScore(type, wall, projection, rooms, relationships) {
  if (!wall || !projection || projection.length < 0.35) return Number.POSITIVE_INFINITY;
  let score = Number(projection.distance || 0);
  const side = roomsAcrossWallDetailed(wall, rooms);
  const ids = side.ids;
  const rel = ids.length === 2 ? getRelationshipForPair(relationships, ids[0], ids[1]) : null;
  const isExternal = String(wall?.type || '') === 'external';

  if (type === 'window') {
    score += isExternal ? -0.30 : 1.35;
    if (ids.length === 0) score += 0.25;
    return score;
  }

  if (isExternal) {
    score += ids.length === 1 ? -0.10 : 1.10;
    return score;
  }

  if (ids.length === 2) {
    if (rel?.relation === 'door') score -= 0.40;
    else if (rel?.relation === 'wall') score -= 0.02;
    else if (rel?.relation === 'open') score += 1.20;
    else score += 0.22;
  } else if (ids.length === 1) {
    // One labeled room + unlabeled corridor/entry/service circulation can still be a valid door.
    score += 0.12;
  } else {
    score += 1.30;
  }
  return score;
}

function chooseBestWallForOpening(center, type, walls, rooms, relationships, wallIdHint = null, wallAxis = "unknown", openingWidth = 0.9) {
  let candidateWalls = Array.isArray(walls) ? walls : [];
  if (wallIdHint) {
    const hinted = candidateWalls.find((wall) => String(wall.id) === String(wallIdHint));
    if (hinted) candidateWalls = [hinted, ...candidateWalls.filter((wall) => wall !== hinted)];
  }
  let best = null;
  for (const wall of candidateWalls) {
    const dx = Math.abs(wall.end.x - wall.start.x);
    const dy = Math.abs(wall.end.y - wall.start.y);
    // Source symbol orientation is stronger evidence than room semantics.
    if (wallAxis === "horizontal" && dy > dx * 0.2) continue;
    if (wallAxis === "vertical" && dx > dy * 0.2) continue;
    if (wallAxis === "diagonal" && (dx < dy * 0.2 || dy < dx * 0.2)) continue;
    const projection = projectToSegment(center, wall.start, wall.end);
    const measuredWidth = Number(openingWidth);
    const halfWidth = measuredWidth > 0 ? measuredWidth / 2 : 0.45;
    const endClearance = Math.min(projection.t, 1 - projection.t) * projection.length;
    // A source opening must fit at its observed center. Do not slide it along
    // the wall or attach it to the end of a segment beside the real gap.
    if (projection.distance > 0.18 || endClearance < halfWidth - 0.005) continue;
    // A nearby perpendicular return must not win when the opening cannot fit.
    const endpointPenalty = Math.max(0, halfWidth - endClearance) * 2;
    const hintBonus = String(wall.id) === String(wallIdHint) && projection.distance < 0.35 ? -0.2 : 0;
    // Room semantics must be sampled beside this opening, not at the middle
    // of a long wall that can border several unrelated rooms.
    const ux = (wall.end.x - wall.start.x) / projection.length;
    const uy = (wall.end.y - wall.start.y) / projection.length;
    const localWall = {...wall,
      start: {x:projection.point.x-ux*0.2,y:projection.point.y-uy*0.2},
      end: {x:projection.point.x+ux*0.2,y:projection.point.y+uy*0.2},
    };
    const score = endpointPenalty + hintBonus + openingPlacementScore(type, localWall, projection, rooms, relationships);
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { wall, projection, score };
  }
  return best;
}

function closeAlignedWallGaps(walls, tolerance = 0.18) {
  const out = (Array.isArray(walls) ? walls : []).map((wall) => ({
    ...wall,
    start: { ...wall.start },
    end: { ...wall.end },
  }));
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i], b = out[j];
      const av = Math.abs(a.start.x-a.end.x) < 0.05;
      const bv = Math.abs(b.start.x-b.end.x) < 0.05;
      const ah = Math.abs(a.start.y-a.end.y) < 0.05;
      const bh = Math.abs(b.start.y-b.end.y) < 0.05;
      if (av && bv && Math.abs(a.start.x-b.start.x) < 0.12) {
        if (dist(a.end,b.start) < tolerance) a.end = {x:a.start.x,y:b.start.y};
        if (dist(a.start,b.end) < tolerance) a.start = {x:a.start.x,y:b.end.y};
      }
      if (ah && bh && Math.abs(a.start.y-b.start.y) < 0.12) {
        if (dist(a.end,b.start) < tolerance) a.end = {x:b.start.x,y:a.start.y};
        if (dist(a.start,b.end) < tolerance) a.start = {x:b.end.x,y:a.start.y};
      }
    }
  }
  return out;
}

function cleanupWallStubs(walls, minKeep = 0.22) {
  return (Array.isArray(walls) ? walls : []).filter((wall) => dist(wall.start, wall.end) >= minKeep);
}

function dedupeOpenings(openings) {
  const out = [], seen = new Set();
  for (const opening of Array.isArray(openings) ? openings : []) {
    const key = [opening.type, opening.wallId, Number(opening.offset||0).toFixed(2), Number(opening.width||0).toFixed(2)].join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(opening);
  }
  return out;
}

// Relationships describe connectivity, not the observed location of a door.
// Do not convert a relationship into an invented opening at a wall midpoint.
function ensureRequiredDoors(openings) {
  return { openings: dedupeOpenings(openings), added: 0 };
}



function wallMidpoint(wall) {
  return {
    x: (Number(wall.start?.x || 0) + Number(wall.end?.x || 0)) / 2,
    y: (Number(wall.start?.y || 0) + Number(wall.end?.y || 0)) / 2,
  };
}

function wallAngle(wall) {
  return Math.atan2(
    Number(wall.end?.y || 0) - Number(wall.start?.y || 0),
    Number(wall.end?.x || 0) - Number(wall.start?.x || 0)
  );
}

function angleDeltaModuloPi(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

function segmentNearExistingWall(candidate, walls, distanceTolerance = 0.14, angleTolerance = 0.18) {
  const mid = wallMidpoint(candidate);
  const angle = wallAngle(candidate);
  return (Array.isArray(walls) ? walls : []).some((wall) => {
    const d = pointToSegmentDistance(mid, wall.start, wall.end);
    if (d > distanceTolerance) return false;
    return angleDeltaModuloPi(angle, wallAngle(wall)) <= angleTolerance;
  });
}

function edgeLiesOnExterior(edge, externalWalls) {
  const length = dist(edge.start, edge.end);
  if (length < 0.25) return true;
  const mid = wallMidpoint(edge);
  const angle = wallAngle(edge);
  return (Array.isArray(externalWalls) ? externalWalls : []).some((wall) => {
    if (pointToSegmentDistance(mid, wall.start, wall.end) > 0.18) return false;
    if (angleDeltaModuloPi(angle, wallAngle(wall)) > 0.18) return false;
    return true;
  });
}

function synthesizeRoomBoundaryPartitions(partitions, rooms, externalWalls) {
  const out = [...(Array.isArray(partitions) ? partitions : [])];
  let added = 0;

  for (const room of Array.isArray(rooms) ? rooms : []) {
    // Open zones describe floor finishes, not physical enclosures. Observed
    // partitions and explicit wall/door relationships supply their real walls.
    if (!isEnclosedAccessRoom(room)) continue;
    const poly = Array.isArray(room?.polygon) ? room.polygon : [];
    if (poly.length < 3) continue;

    for (let i = 0; i < poly.length; i += 1) {
      const edge = {
        id: `room_edge_${room.id}_${i + 1}`.slice(0, 64),
        provenance: "room_boundary",
        type: "internal",
        start: { ...poly[i] },
        end: { ...poly[(i + 1) % poly.length] },
      };

      if (dist(edge.start, edge.end) < 0.42) continue;
      if (edgeLiesOnExterior(edge, externalWalls)) continue;
      if (segmentNearExistingWall(edge, out, 0.13, 0.16)) continue;

      out.push(edge);
      added += 1;
    }
  }

  return { partitions: out, added };
}

function isEnclosedAccessRoom(room) {
  const type = canonicalRoomType(room);
  return ["bedroom", "bathroom", "storage", "office", "kitchen"].includes(type);
}

function wallTouchesRoom(wall, room) {
  if (!wall || !room?.polygon?.length) return false;
  const length = dist(wall.start, wall.end);
  if (length < 0.25) return false;

  const mid = wallMidpoint(wall);
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;

  for (const offset of [0.08, 0.12, 0.18, 0.24]) {
    const p1 = { x: mid.x + nx * offset, y: mid.y + ny * offset };
    const p2 = { x: mid.x - nx * offset, y: mid.y - ny * offset };
    if (pointInPolygon(p1, room.polygon) || pointInPolygon(p2, room.polygon)) return true;
  }
  return false;
}

function openingWall(opening, wallsById) {
  return wallsById.get(String(opening?.wallId || "")) || null;
}

function relationshipDoorBonus(wall, rooms, relationships) {
  const across = roomsAcrossWallDetailed(wall, rooms);
  if (across.ids.length !== 2) return 0;
  const rel = getRelationshipForPair(relationships, across.ids[0], across.ids[1]);
  return rel?.relation === "door" ? -2.0 : rel?.relation === "open" ? 2.0 : 0;
}

function chooseBestDoorForRoom(room, doors, wallsById, rooms, relationships) {
  let best = null;
  for (const door of doors) {
    const wall = openingWall(door, wallsById);
    if (!wall || String(wall.type) === "external") continue;
    if (!wallTouchesRoom(wall, room)) continue;

    const relBonus = relationshipDoorBonus(wall, rooms, relationships);
    const sourceDistance = Number.isFinite(Number(door._sourceDistance)) ? Number(door._sourceDistance) : 0.25;
    const sourceScore = Number.isFinite(Number(door._score)) ? Number(door._score) : 0.25;
    const score = relBonus + sourceDistance * 2.0 + sourceScore;

    if (!best || score < best.score) best = { door, score };
  }
  return best?.door || null;
}

function bestFallbackDoorWall(room, walls, footprint) {
  const footprintBox = {
    minX: Math.min(...footprint.map((p) => p.x)),
    maxX: Math.max(...footprint.map((p) => p.x)),
    minY: Math.min(...footprint.map((p) => p.y)),
    maxY: Math.max(...footprint.map((p) => p.y)),
  };
  const buildingCenter = {
    x: (footprintBox.minX + footprintBox.maxX) / 2,
    y: (footprintBox.minY + footprintBox.maxY) / 2,
  };

  let best = null;
  for (const wall of walls) {
    if (String(wall.type) === "external") continue;
    if (!wallTouchesRoom(wall, room)) continue;
    const len = dist(wall.start, wall.end);
    if (len < 0.90) continue;

    const mid = wallMidpoint(wall);
    const score = Math.hypot(mid.x - buildingCenter.x, mid.y - buildingCenter.y) - len * 0.04;
    if (!best || score < best.score) best = { wall, score };
  }
  return best?.wall || null;
}

// A room may have multiple observed doors. Preserve them all instead of
// choosing one and replacing missing access with a guessed door.
function normalizeEnclosedRoomDoors(openings) {
  return { openings: dedupeOpenings(openings), removedExtraDoors: 0, synthesizedDoors: 0 };
}

function clusterAxisValues(values, tolerance = 0.20) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      last.values.push(value);
      last.mean = last.values.reduce((sum, n) => sum + n, 0) / last.values.length;
    }
  }
  return clusters.map((c, index) => ({ id: index, initial: c.mean, value: c.mean }));
}

function nearestNodeIndex(nodes, value) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = Math.abs(nodes[i].initial - value);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

function solveDimensionAxis(rooms, axis, extent) {
  const rects = rooms.map((room) => ({ room, rect: rectFromRoom(room) })).filter((entry) => entry.rect);
  const values = [0, extent];
  for (const { rect } of rects) {
    if (axis === 'x') values.push(rect.minX, rect.maxX);
    else values.push(rect.minY, rect.maxY);
  }
  const nodes = clusterAxisValues(values, Math.max(0.12, Math.min(0.28, extent * 0.018)));
  if (nodes.length < 2) return { nodes, constraints: [], applied: false };

  // Fix the outer extrema. The model already reports overall width/depth from
  // the printed plan dimensions; room constraints must fit inside that metric frame.
  const minNode = nearestNodeIndex(nodes, 0);
  const maxNode = nearestNodeIndex(nodes, extent);
  nodes[minNode].fixed = true; nodes[minNode].value = 0;
  nodes[maxNode].fixed = true; nodes[maxNode].value = extent;

  const constraints = [];
  for (const { room, rect } of rects) {
    const target = axis === 'x' ? Number(room.printedWidthMeters || 0) : Number(room.printedDepthMeters || 0);
    if (!(target > 0.35 && target <= extent)) continue;
    const lo = axis === 'x' ? rect.minX : rect.minY;
    const hi = axis === 'x' ? rect.maxX : rect.maxY;
    const i = nearestNodeIndex(nodes, lo);
    const j = nearestNodeIndex(nodes, hi);
    if (i === j) continue;
    const current = Math.abs(nodes[j].initial - nodes[i].initial);
    const ratio = target / Math.max(0.001, current);
    if (ratio < 0.55 || ratio > 1.80) continue;
    const confidence = ratio >= 0.72 && ratio <= 1.38 ? 1.0 : 0.35;
    constraints.push({ roomId: room.id, i: Math.min(i, j), j: Math.max(i, j), target, confidence, current });
  }
  if (!constraints.length) return { nodes, constraints, applied: false };

  // Weighted Gauss-Seidel. Printed room dimensions are strong constraints, but
  // a light spring to the model's original topology prevents one bad label from
  // folding the entire plan. This is deliberately deterministic and local.
  for (let iter = 0; iter < 180; iter += 1) {
    for (const node of nodes) {
      if (node.fixed) continue;
      node.value += (node.initial - node.value) * 0.035;
    }
    for (const c of constraints) {
      const a = nodes[c.i];
      const b = nodes[c.j];
      const error = c.target - (b.value - a.value);
      const gain = 0.46 * c.confidence;
      if (!a.fixed && !b.fixed) {
        a.value -= error * gain * 0.5;
        b.value += error * gain * 0.5;
      } else if (!a.fixed) {
        a.value -= error * gain;
      } else if (!b.fixed) {
        b.value += error * gain;
      }
    }
    // Preserve ordering and a small minimum bay. This prevents inverted rooms.
    for (let i = 1; i < nodes.length; i += 1) {
      const minGap = 0.06;
      if (nodes[i].value < nodes[i - 1].value + minGap) {
        if (!nodes[i].fixed) nodes[i].value = nodes[i - 1].value + minGap;
        else if (!nodes[i - 1].fixed) nodes[i - 1].value = nodes[i].value - minGap;
      }
    }
    nodes[minNode].value = 0;
    nodes[maxNode].value = extent;
  }

  const residuals = constraints.map((c) => {
    const actual = nodes[c.j].value - nodes[c.i].value;
    return { ...c, actual, relativeError: Math.abs(actual - c.target) / Math.max(0.001, c.target) };
  });
  const strong = residuals.filter((r) => r.confidence >= 0.9);
  const meanError = (strong.length ? strong : residuals).reduce((s, r) => s + r.relativeError, 0) / Math.max(1, (strong.length ? strong : residuals).length);
  return { nodes, constraints: residuals, meanError, applied: meanError <= 0.14 };
}

function dimensionLockRooms(inputRooms, width, depth) {
  const original = inputRooms.map((room) => ({ ...room, polygon: room.polygon.map((p) => ({ ...p })) }));
  const sx = solveDimensionAxis(original, 'x', width);
  const sy = solveDimensionAxis(original, 'y', depth);
  if (!sx.applied && !sy.applied) return { rooms: inputRooms, applied: false, reason: 'no_stable_axis_solution', x: sx, y: sy };

  const mapped = original.map((room) => {
    const rect = rectFromRoom(room);
    if (!rect) return room;
    const ix0 = nearestNodeIndex(sx.nodes, rect.minX);
    const ix1 = nearestNodeIndex(sx.nodes, rect.maxX);
    const iy0 = nearestNodeIndex(sy.nodes, rect.minY);
    const iy1 = nearestNodeIndex(sy.nodes, rect.maxY);
    const minX = sx.applied ? Math.min(sx.nodes[ix0].value, sx.nodes[ix1].value) : rect.minX;
    const maxX = sx.applied ? Math.max(sx.nodes[ix0].value, sx.nodes[ix1].value) : rect.maxX;
    const minY = sy.applied ? Math.min(sy.nodes[iy0].value, sy.nodes[iy1].value) : rect.minY;
    const maxY = sy.applied ? Math.max(sy.nodes[iy0].value, sy.nodes[iy1].value) : rect.maxY;
    if (maxX - minX < 0.25 || maxY - minY < 0.25) return room;
    return { ...room, polygon: [
      { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
    ] };
  });

  // Reject a global solve if it creates meaningful room overlaps that were not
  // present before. A preview can be approximate; it must never self-intersect.
  for (let i = 0; i < mapped.length; i += 1) {
    const a0 = rectFromRoom(original[i]);
    const a1 = rectFromRoom(mapped[i]);
    if (!a0 || !a1) continue;
    const center0 = { x: (a0.minX + a0.maxX) / 2, y: (a0.minY + a0.maxY) / 2 };
    const center1 = { x: (a1.minX + a1.maxX) / 2, y: (a1.minY + a1.maxY) / 2 };
    if (dist(center0, center1) > Math.max(1.25, Math.min(width, depth) * 0.13)) {
      return { rooms: inputRooms, applied: false, reason: 'excessive_room_displacement', x: sx, y: sy };
    }
    for (let j = i + 1; j < mapped.length; j += 1) {
      const b0 = rectFromRoom(original[j]);
      const b1 = rectFromRoom(mapped[j]);
      if (!b0 || !b1) continue;
      const before = overlapArea(a0, b0);
      const after = overlapArea(a1, b1);
      if (after > Math.max(0.18, before + 0.12)) {
        return { rooms: inputRooms, applied: false, reason: 'room_overlap_guard', x: sx, y: sy };
      }
    }
  }
  return { rooms: mapped, applied: true, reason: sx.applied && sy.applied ? 'printed_dimension_grid_lock_xy' : sx.applied ? 'printed_dimension_grid_lock_x_only' : 'printed_dimension_grid_lock_y_only', x: sx, y: sy };
}

function roomBoundaryGrid(rooms) {
  const xs = [];
  const ys = [];
  for (const room of rooms) {
    const r = rectFromRoom(room);
    if (!r) continue;
    xs.push(r.minX, r.maxX); ys.push(r.minY, r.maxY);
  }
  return { xs, ys };
}

function snapPartitionToRoomGrid(wall, rooms) {
  const grid = roomBoundaryGrid(rooms);
  const out = snapAxisWall(wall);
  const dx = Math.abs(out.end.x - out.start.x);
  const dy = Math.abs(out.end.y - out.start.y);
  const snap = (value, values, tolerance = 0.32) => {
    let best = value, bestD = tolerance;
    for (const v of values) {
      const d = Math.abs(v - value);
      if (d < bestD) { best = v; bestD = d; }
    }
    return best;
  };
  if (dy > dx * 3) {
    const x = snap((out.start.x + out.end.x) / 2, grid.xs);
    out.start.x = x; out.end.x = x;
    out.start.y = snap(out.start.y, grid.ys);
    out.end.y = snap(out.end.y, grid.ys);
  } else if (dx > dy * 3) {
    const y = snap((out.start.y + out.end.y) / 2, grid.ys);
    out.start.y = y; out.end.y = y;
    out.start.x = snap(out.start.x, grid.xs);
    out.end.x = snap(out.end.x, grid.xs);
  }
  return out;
}

function polygonEdgeAxisRatio(polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  let aligned = 0;
  let total = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (Math.max(dx, dy) < 0.05) continue;
    total += 1;
    if (dx < Math.max(0.04, dy * 0.18) || dy < Math.max(0.04, dx * 0.18)) aligned += 1;
  }
  return total ? aligned / total : 0;
}

function simplifyOrthogonalPolygon(points = [], epsilon = 0.035) {
  if (!Array.isArray(points) || points.length < 4) return points;
  let out = [...points];
  let changed = true;
  while (changed && out.length >= 4) {
    changed = false;
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const after = out[(i + 1) % out.length];
      const vertical = Math.abs(prev.x - cur.x) <= epsilon && Math.abs(cur.x - after.x) <= epsilon;
      const horizontal = Math.abs(prev.y - cur.y) <= epsilon && Math.abs(cur.y - after.y) <= epsilon;
      if (vertical || horizontal || dist(prev, cur) < epsilon) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    if (next.length >= 4) out = next;
    else break;
  }
  return out;
}

function deriveRoomSupportedFootprint(rawFootprint, rooms, width, depth) {
  // Repair large hallucinated exterior lobes without asking the model for a
  // second paid pass. This is intentionally limited to predominantly
  // orthogonal plans, where a grid union is stable and predictable.
  if (!Array.isArray(rawFootprint) || rawFootprint.length < 4 || !Array.isArray(rooms) || rooms.length < 2) {
    return { footprint: rawFootprint, repaired: false, reason: "insufficient_geometry" };
  }
  const orthogonality = Math.max(
    polygonEdgeAxisRatio(rawFootprint),
    rooms.reduce((sum, room) => sum + polygonEdgeAxisRatio(room.polygon), 0) / Math.max(1, rooms.length),
  );
  if (orthogonality < 0.72) return { footprint: rawFootprint, repaired: false, reason: "non_orthogonal_plan" };

  const cell = clamp(Math.min(width, depth) / 120, 0.07, 0.14, 0.10);
  const nx = Math.max(8, Math.ceil(width / cell));
  const ny = Math.max(8, Math.ceil(depth / cell));
  const total = nx * ny;
  const insideRaw = new Uint8Array(total);
  const base = new Uint8Array(total);
  const idx = (x, y) => y * nx + x;
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const p = { x: Math.min(width, (gx + 0.5) * cell), y: Math.min(depth, (gy + 0.5) * cell) };
      if (!pointInPolygon(p, rawFootprint)) continue;
      insideRaw[idx(gx, gy)] = 1;
      if (rooms.some((room) => pointInPolygon(p, room.polygon))) base[idx(gx, gy)] = 1;
    }
  }

  const roomCenters = rooms.map((room) => {
    const b = roomBounds(room);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  });

  function dilate(source, radiusMeters) {
    const radius = Math.max(1, Math.ceil(radiusMeters / cell));
    const out = new Uint8Array(total);
    for (let gy = 0; gy < ny; gy += 1) for (let gx = 0; gx < nx; gx += 1) {
      if (!source[idx(gx, gy)]) continue;
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const k = idx(x, y);
        if (insideRaw[k]) out[k] = 1;
      }
    }
    return out;
  }

  function largestComponent(mask) {
    const seen = new Uint8Array(total);
    let best = [];
    const queue = new Int32Array(total);
    for (let start = 0; start < total; start += 1) {
      if (!mask[start] || seen[start]) continue;
      let head = 0, tail = 0;
      queue[tail++] = start; seen[start] = 1;
      const cells = [];
      while (head < tail) {
        const k = queue[head++]; cells.push(k);
        const x = k % nx, y = Math.floor(k / nx);
        for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const n = idx(xx, yy);
          if (mask[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      if (cells.length > best.length) best = cells;
    }
    const out = new Uint8Array(total);
    for (const k of best) out[k] = 1;
    return out;
  }

  function containsAllRoomCenters(mask) {
    return roomCenters.every((p) => {
      const gx = Math.max(0, Math.min(nx - 1, Math.floor(p.x / cell)));
      const gy = Math.max(0, Math.min(ny - 1, Math.floor(p.y / cell)));
      return mask[idx(gx, gy)] === 1;
    });
  }

  let supported = null;
  for (const radius of [0.45, 0.60, 0.75, 0.90, 1.05]) {
    const candidate = largestComponent(dilate(base, radius));
    if (containsAllRoomCenters(candidate)) { supported = candidate; break; }
  }
  if (!supported) return { footprint: rawFootprint, repaired: false, reason: "rooms_not_connected" };

  const edges = new Map();
  const addEdge = (a, b) => {
    const key = `${a.x},${a.y}|${b.x},${b.y}`;
    const reverse = `${b.x},${b.y}|${a.x},${a.y}`;
    if (edges.has(reverse)) edges.delete(reverse);
    else edges.set(key, { a, b });
  };
  let supportedCells = 0;
  for (let gy = 0; gy < ny; gy += 1) for (let gx = 0; gx < nx; gx += 1) {
    const k = idx(gx, gy);
    if (!supported[k]) continue;
    supportedCells += 1;
    const x0 = gx, x1 = gx + 1, y0 = gy, y1 = gy + 1;
    addEdge({ x: x0, y: y0 }, { x: x1, y: y0 });
    addEdge({ x: x1, y: y0 }, { x: x1, y: y1 });
    addEdge({ x: x1, y: y1 }, { x: x0, y: y1 });
    addEdge({ x: x0, y: y1 }, { x: x0, y: y0 });
  }
  if (!edges.size) return { footprint: rawFootprint, repaired: false, reason: "no_boundary" };

  const byStart = new Map();
  for (const edge of edges.values()) {
    const key = `${edge.a.x},${edge.a.y}`;
    if (!byStart.has(key)) byStart.set(key, []);
    byStart.get(key).push(edge);
  }
  const loops = [];
  const unused = new Set([...edges.keys()]);
  while (unused.size) {
    const firstKey = unused.values().next().value;
    const first = edges.get(firstKey);
    const loop = [first.a];
    let edge = first;
    unused.delete(firstKey);
    let guard = 0;
    while (guard++ < edges.size + 5) {
      loop.push(edge.b);
      if (edge.b.x === first.a.x && edge.b.y === first.a.y) break;
      const key = `${edge.b.x},${edge.b.y}`;
      const candidates = (byStart.get(key) || []).filter((e) => unused.has(`${e.a.x},${e.a.y}|${e.b.x},${e.b.y}`));
      if (!candidates.length) break;
      edge = candidates[0];
      unused.delete(`${edge.a.x},${edge.a.y}|${edge.b.x},${edge.b.y}`);
    }
    if (loop.length >= 5 && loop[loop.length - 1].x === loop[0].x && loop[loop.length - 1].y === loop[0].y) {
      loop.pop();
      loops.push(loop);
    }
  }
  if (!loops.length) return { footprint: rawFootprint, repaired: false, reason: "boundary_chain_failed" };

  const meterLoops = loops.map((loop) => simplifyOrthogonalPolygon(loop.map((p) => ({
    x: clamp(p.x * cell, 0, width, 0),
    y: clamp(p.y * cell, 0, depth, 0),
  }))));
  meterLoops.sort((a, b) => polygonArea(b) - polygonArea(a));
  const repaired = meterLoops[0];
  const rawArea = polygonArea(rawFootprint);
  const repairedArea = polygonArea(repaired);
  const ratio = rawArea > 0 ? repairedArea / rawArea : 0;
  if (repaired.length < 4 || repaired.length > 80 || ratio < 0.42 || ratio > 1.03) {
    return { footprint: rawFootprint, repaired: false, reason: `area_ratio_${ratio.toFixed(3)}` };
  }
  if (!roomCenters.every((p) => pointInPolygon(p, repaired))) {
    return { footprint: rawFootprint, repaired: false, reason: "room_center_outside_repair" };
  }
  return { footprint: repaired, repaired: true, reason: "room_supported_orthogonal_union", rawArea, repairedArea, supportedCells, cell };
}

function partitionCrossesRoomInterior(wall, rooms) {
  const length = dist(wall.start, wall.end);
  if (length < 0.25) return true;
  const mx = (wall.start.x + wall.end.x) / 2;
  const my = (wall.start.y + wall.end.y) / 2;
  const dx = (wall.end.x - wall.start.x) / length;
  const dy = (wall.end.y - wall.start.y) / length;
  const nx = -dy, ny = dx;
  const offset = Math.min(0.18, Math.max(0.08, length * 0.08));
  const left = { x: mx + nx * offset, y: my + ny * offset };
  const right = { x: mx - nx * offset, y: my - ny * offset };
  const roomAt = (p) => rooms.find((room) => pointInPolygon(p, room.polygon))?.id || null;
  const a = roomAt(left), b = roomAt(right);
  if (a && b && a === b) return true;
  const midRoom = roomAt({ x: mx, y: my });
  if (midRoom && a === midRoom && b === midRoom) return true;
  return false;
}

function asset(type, roomId, x, y, width, depth, height, rotation = 0, metadata = {}) {
  return {
    type,
    roomId,
    xMeters: x,
    yMeters: y,
    width,
    depth,
    height,
    rotation,
    placementSource: "ventra_wall_aware_furnishing_v16",
    ...metadata,
  };
}

// Use the table's own axes and footprint so a chair's near edge clears the
// table regardless of table size or orientation. Candidate order alternates
// sides, allowing smaller rooms to retain a balanced pair when only two fit.
function diningChairCandidates(table, chairSize = 0.44) {
  const radians = (Number(table.rotation) || 0) * Math.PI / 180;
  const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -tangent.y, y: tangent.x };
  const longOffset = (Number(table.width) || 1.4) / 2 + chairSize / 2 + 0.13;
  const shortOffset = (Number(table.depth) || 0.8) / 2 + chairSize / 2 + 0.13;
  return [
    [tangent, longOffset, 1, 90], [tangent, longOffset, -1, 90],
    [normal, shortOffset, 1, 0], [normal, shortOffset, -1, 0],
  ].map(([axis, offset, sign, facing]) => asset(
    "chair", table.roomId,
    table.xMeters + axis.x * offset * sign,
    table.yMeters + axis.y * offset * sign,
    chairSize, chairSize, 0.88,
    (Number(table.rotation) || 0) + facing
  ));
}


function floorFinishForRoom(room) {
  const type = canonicalRoomType(room);
  if (type === "bathroom") return "wet_tile";
  if (type === "storage" || type === "balcony" || type === "laundry") return "utility_tile";
  if (type === "bedroom") return "light_oak";
  if (["living", "kitchen", "kitchen_dining", "dining", "office"].includes(type)) return "light_stone";
  return "neutral_floor";
}

function polygonSamplePoints(polygon = []) {
  const pts = [...polygon];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  if (xs.length) pts.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
  return pts;
}

function roomInsideFootprint(room, footprint) {
  return polygonSamplePoints(room?.polygon || []).every((p) => pointInPolygon(p, footprint) || footprint.some((a, i) => pointToSegmentDistance(p, a, footprint[(i + 1) % footprint.length]) < 0.035));
}

function containRoomInFootprint(room, footprint) {
  if (!room?.polygon?.length || roomInsideFootprint(room, footprint)) return { room, adjusted: false };
  const b = roomBounds(room);
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  if (!pointInPolygon(center, footprint)) return { room, adjusted: false };
  for (let scale = 0.98; scale >= 0.55; scale -= 0.02) {
    const polygon = room.polygon.map((p) => ({
      x: center.x + (p.x - center.x) * scale,
      y: center.y + (p.y - center.y) * scale,
    }));
    const candidate = { ...room, polygon };
    if (roomInsideFootprint(candidate, footprint)) return { room: candidate, adjusted: true };
  }
  return { room, adjusted: false };
}

function rotatedAssetSize(a) {
  const quarterTurn = Math.abs((Number(a.rotation) || 0) % 180) > 45;
  return quarterTurn ? { w: Number(a.depth) || 0, d: Number(a.width) || 0 } : { w: Number(a.width) || 0, d: Number(a.depth) || 0 };
}

function assetBox(a, clearance = 0) {
  const size = rotatedAssetSize(a);
  return {
    minX: a.xMeters - size.w / 2 - clearance,
    maxX: a.xMeters + size.w / 2 + clearance,
    minY: a.yMeters - size.d / 2 - clearance,
    maxY: a.yMeters + size.d / 2 + clearance,
  };
}

function boxesOverlap(a, b) {
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0 && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0;
}

function assetFitsRoom(a, room, placed = [], openingCenters = []) {
  const box = assetBox(a, 0.04);
  const points = [
    { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
    { x: a.xMeters, y: a.yMeters },
  ];
  if (!points.every((p) => pointInPolygon(p, room.polygon))) return false;
  const ownClearance = a.compactWetFixture ? 0.02 : 0.055;
  const collisionBox = assetBox(a, ownClearance);
  const collides = placed.some((other) => {
    if (a.embeddedInCounter && other.type === "kitchen_counter") return false;
    if (other.embeddedInCounter && a.type === "kitchen_counter") return false;
    const otherClearance = other.compactWetFixture ? 0.02 : 0.05;
    return boxesOverlap(collisionBox, assetBox(other, otherClearance));
  });
  if (collides) return false;
  // Keep furniture out of the door swing/approach area. Windows are allowed to
  // have furniture nearby, but tall storage gets rejected separately by side scoring.
  if (openingCenters.some((o) => o.type === "door" && Math.hypot(o.x - a.xMeters, o.y - a.yMeters) < Math.max(0.52, Math.min(0.82, (a.width + a.depth) * 0.40)))) return false;
  return true;
}

function openingCenterFromScene(opening, wallMap) {
  const wall = wallMap.get(String(opening?.wallId || ""));
  if (!wall) return null;
  const t = clamp(opening?.offset, 0, 1, 0.5);
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
    type: opening?.type === "window" ? "window" : "door",
    wallId: wall.id,
  };
}


function roomWallSegments(room, openingCenters = [], walls = []) {
  const polygon = Array.isArray(room?.polygon) ? room.polygon : [];
  const result = [];
  if (polygon.length < 3) return result;

  const wallSupportForSegment = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { supported: false, supportScore: 0 };
    const ux = dx / len;
    const uy = dy / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best = 0;
    for (const wall of walls) {
      const wdx = wall.end.x - wall.start.x;
      const wdy = wall.end.y - wall.start.y;
      const wlen = Math.hypot(wdx, wdy);
      if (wlen < 1e-6) continue;
      const vux = wdx / wlen;
      const vuy = wdy / wlen;
      const parallel = Math.abs(ux * vux + uy * vuy);
      if (parallel < 0.985) continue;
      const dMid = pointToSegmentDistance(mid, wall.start, wall.end);
      if (dMid > 0.38) continue;
      const segMinX = Math.min(a.x, b.x), segMaxX = Math.max(a.x, b.x);
      const segMinY = Math.min(a.y, b.y), segMaxY = Math.max(a.y, b.y);
      const wallMinX = Math.min(wall.start.x, wall.end.x), wallMaxX = Math.max(wall.start.x, wall.end.x);
      const wallMinY = Math.min(wall.start.y, wall.end.y), wallMaxY = Math.max(wall.start.y, wall.end.y);
      const overlap = Math.abs(dx) >= Math.abs(dy)
        ? Math.max(0, Math.min(segMaxX, wallMaxX) - Math.max(segMinX, wallMinX))
        : Math.max(0, Math.min(segMaxY, wallMaxY) - Math.max(segMinY, wallMinY));
      const ratio = overlap / Math.max(0.01, Math.min(len, wlen));
      best = Math.max(best, ratio);
    }
    return { supported: best >= 0.12, supportScore: best };
  };

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.55) continue;
    const ux = dx / length;
    const uy = dy / length;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const n1 = { x: -uy, y: ux };
    const n2 = { x: uy, y: -ux };
    const probe = Math.min(0.16, Math.max(0.07, length * 0.04));
    const p1 = { x: mid.x + n1.x * probe, y: mid.y + n1.y * probe };
    const p2 = { x: mid.x + n2.x * probe, y: mid.y + n2.y * probe };
    let inward = n1;
    if (!pointInPolygon(p1, polygon) && pointInPolygon(p2, polygon)) inward = n2;
    const support = wallSupportForSegment(a, b);
    let doorCount = 0;
    let windowCount = 0;
    let openingPenalty = 0;
    for (const opening of openingCenters) {
      const d = pointToSegmentDistance(opening, a, b);
      if (d > 0.30) continue;
      if (opening.type === 'door') { doorCount += 1; openingPenalty += 4.5; }
      else { windowCount += 1; openingPenalty += 1.6; }
    }
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    const supportBonus = support.supported ? 2.2 + support.supportScore : -1.1;
    result.push({
      id: `edge-${i}`, start: a, end: b, x: mid.x, y: mid.y, length,
      dirX: ux, dirY: uy, inwardX: inward.x, inwardY: inward.y,
      rotation: angleDeg, wallSupported: support.supported,
      wallSupportScore: support.supportScore, windowCount, doorCount,
      openingPenalty, score: length + supportBonus - openingPenalty,
    });
  }
  return result.sort((a, b) => b.score - a.score);
}

function roomSideCandidates(room, openingCenters = [], walls = []) {
  const actual = roomWallSegments(room, openingCenters, walls);
  if (actual.length) return actual;
  const b = roomBounds(room);
  const margin = 0.10;
  return [
    { id: 'south', length: b.maxX-b.minX, x:(b.minX+b.maxX)/2, y:b.minY+margin, dirX:1,dirY:0,inwardX:0,inwardY:1,rotation:0,wallSupported:true,doorCount:0,windowCount:0,openingPenalty:0,score:b.maxX-b.minX },
    { id: 'north', length: b.maxX-b.minX, x:(b.minX+b.maxX)/2, y:b.maxY-margin, dirX:1,dirY:0,inwardX:0,inwardY:-1,rotation:0,wallSupported:true,doorCount:0,windowCount:0,openingPenalty:0,score:b.maxX-b.minX },
    { id: 'west', length: b.maxY-b.minY, x:b.minX+margin, y:(b.minY+b.maxY)/2, dirX:0,dirY:1,inwardX:1,inwardY:0,rotation:90,wallSupported:true,doorCount:0,windowCount:0,openingPenalty:0,score:b.maxY-b.minY },
    { id: 'east', length: b.maxY-b.minY, x:b.maxX-margin, y:(b.minY+b.maxY)/2, dirX:0,dirY:1,inwardX:-1,inwardY:0,rotation:90,wallSupported:true,doorCount:0,windowCount:0,openingPenalty:0,score:b.maxY-b.minY },
  ];
}

function againstSideAsset(type, roomId, side, widthAlongWall, depthIntoRoom, height, inset = 0.08, metadata = {}) {
  const along = Math.max(0.3, widthAlongWall);
  const dep = Math.max(0.25, depthIntoRoom);
  const x = side.x + side.inwardX * (dep / 2 + inset);
  const y = side.y + side.inwardY * (dep / 2 + inset);
  return asset(type, roomId, x, y, along, dep, height,
    Number.isFinite(side.rotation) ? side.rotation : 0,
    { wallSide: side.id, wallDirX: side.dirX, wallDirY: side.dirY, wallSupported: side.wallSupported !== false, ...metadata });
}

function oppositeSupportedSide(sides = [], source) {
  if (!source) return null;
  const candidates = sides.filter((s) => s.id !== source.id && s.wallSupported !== false);
  candidates.sort((a,b)=>{
    const da = source.inwardX*a.inwardX + source.inwardY*a.inwardY;
    const db = source.inwardX*b.inwardX + source.inwardY*b.inwardY;
    if (da !== db) return da - db;
    return Math.hypot(b.x-source.x,b.y-source.y)-Math.hypot(a.x-source.x,a.y-source.y);
  });
  return candidates.find((s)=>(source.inwardX*s.inwardX + source.inwardY*s.inwardY) < -0.55) || null;
}

function furnishRoom(room, { walls = [], openings = [] } = {}) {
  const b = roomBounds(room);
  const w = Math.max(0.8, b.maxX - b.minX);
  const d = Math.max(0.8, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const type = canonicalRoomType(room);
  const wallMap = new Map(walls.map((wall) => [String(wall.id), wall]));
  const openingCenters = openings.map((o) => openingCenterFromScene(o, wallMap)).filter(Boolean).filter((p) => {
    const nearRoom = p.x >= b.minX - 0.35 && p.x <= b.maxX + 0.35 && p.y >= b.minY - 0.35 && p.y <= b.maxY + 0.35;
    return nearRoom;
  });
  const sides = roomSideCandidates(room, openingCenters, walls);
  const placed = [];
  const add = (a) => {
    if (a && assetFitsRoom(a, room, placed, openingCenters)) { placed.push(a); return true; }
    return false;
  };

  // V18 essential-placement fallback:
  // For core room functions, it is better to use a slightly smaller,
  // still-contained fixture than to return an obviously empty room.
  // This fallback NEVER lets an asset leave the room polygon and it still
  // rejects severe overlaps. It only relaxes door clearance / small-clearance
  // collisions after the normal wall-aware pass has failed.
  const addEssential = (a) => {
    if (!a) return false;
    const box = assetBox(a, 0.015);
    const points = [
      { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
      { x: a.xMeters, y: a.yMeters },
    ];
    if (!points.every((p) => pointInPolygon(p, room.polygon))) return false;

    const severeCollision = placed.some((other) => {
      if (a.embeddedInCounter && other.type === "kitchen_counter") return false;
      if (other.embeddedInCounter && a.type === "kitchen_counter") return false;
      const overlapA = assetBox(a, 0.005);
      const overlapB = assetBox(other, 0.005);
      if (!boxesOverlap(overlapA, overlapB)) return false;
      const ix = Math.max(0, Math.min(overlapA.maxX, overlapB.maxX) - Math.max(overlapA.minX, overlapB.minX));
      const iy = Math.max(0, Math.min(overlapA.maxY, overlapB.maxY) - Math.max(overlapA.minY, overlapB.minY));
      const overlapArea = ix * iy;
      const ownArea = Math.max(0.01, (overlapA.maxX - overlapA.minX) * (overlapA.maxY - overlapA.minY));
      return overlapArea / ownArea > 0.22;
    });
    if (severeCollision) return false;

    placed.push({ ...a, essentialFallback: true });
    return true;
  };

  const tryEssentialAgainstSides = (assetType, candidateSides, sizes, height, inset = 0.02, metadata = {}) => {
    for (const side of candidateSides) {
      for (const size of sizes) {
        const candidate = againstSideAsset(
          assetType,
          room.id,
          side,
          Math.min(size.width, Math.max(0.55, side.length * size.sideFraction)),
          size.depth,
          height,
          inset,
          metadata
        );
        if (add(candidate) || addEssential(candidate)) return candidate;
      }
    }
    return null;
  };

  const tryEssentialGrid = (assetType, width, depth, height, rotation = 0, metadata = {}) => {
    const candidates = [
      [cx, cy],
      [b.minX + w*0.22, b.minY + d*0.22],
      [b.maxX - w*0.22, b.minY + d*0.22],
      [b.minX + w*0.22, b.maxY - d*0.22],
      [b.maxX - w*0.22, b.maxY - d*0.22],
      [cx, b.minY + d*0.22],
      [cx, b.maxY - d*0.22],
      [b.minX + w*0.22, cy],
      [b.maxX - w*0.22, cy],
    ];
    for (const [x, y] of candidates) {
      const candidate = asset(assetType, room.id, x, y, width, depth, height, rotation, metadata);
      if (add(candidate) || addEssential(candidate)) return candidate;
    }
    return null;
  };

  if (type === "bedroom") {
    const bedSide = sides.find((s) => s.length >= 1.65 && s.doorCount === 0 && s.windowCount === 0) || sides.find((s) => s.length >= 1.65 && s.doorCount === 0) || sides[0];
    const bedAlong = Math.min(1.8, Math.max(1.35, bedSide.length * 0.55));
    const bedPerpendicularSpan = Math.abs(bedSide.dirX) >= Math.abs(bedSide.dirY) ? d : w;
    const bedDepth = Math.min(2.05, Math.max(1.72, bedPerpendicularSpan * 0.50));
    add(againstSideAsset("bed", room.id, bedSide, bedAlong, bedDepth, 0.82, 0.06));
    const wardrobeSide = sides.find((s) => s.id !== bedSide.id && s.length >= 1.2 && s.doorCount === 0 && s.windowCount === 0);
    if (wardrobeSide) add(againstSideAsset("wardrobe", room.id, wardrobeSide, Math.min(1.8, wardrobeSide.length * 0.62), 0.56, 2.15, 0.03));
    // Nightstands are optional and only appear if there is truly free space.
    const bed = placed.find((a) => a.type === "bed");
    if (bed) {
      const tangentX = Number.isFinite(Number(bed.wallDirX)) ? Number(bed.wallDirX) : 1;
      const tangentY = Number.isFinite(Number(bed.wallDirY)) ? Number(bed.wallDirY) : 0;
      const offset = (Number(bed.width)||1.6)/2 + 0.29;
      add(asset("nightstand", room.id, bed.xMeters + tangentX*offset, bed.yMeters + tangentY*offset, 0.42,0.42,0.52, bed.rotation));
      add(asset("nightstand", room.id, bed.xMeters - tangentX*offset, bed.yMeters - tangentY*offset, 0.42,0.42,0.52, bed.rotation));
    }
  } else if (type === "living") {
    const sofaSide = sides.find((s)=>s.wallSupported && s.length>=2.0 && s.openingPenalty<3.5) || sides.find((s)=>s.length>=2.0 && s.openingPenalty<3.5) || sides[0];
    const sofaPlaced = add(againstSideAsset("sofa", room.id, sofaSide, Math.min(2.8, Math.max(1.8, sofaSide.length*0.58)), 0.92, 0.82, 0.08));
    const opposite = oppositeSupportedSide(sides, sofaSide);
    if (opposite && opposite.openingPenalty < 4.0) add(againstSideAsset("tv_unit", room.id, opposite, Math.min(1.9, opposite.length*0.46), 0.36, 0.62, 0.03));
    const coffeeCandidates = [
      {x:cx,y:cy},
      {x:cx + sofaSide.inwardX*0.28,y:cy + sofaSide.inwardY*0.28},
      {x:cx - sofaSide.inwardX*0.28,y:cy - sofaSide.inwardY*0.28},
    ];
    for (const c of coffeeCandidates) {
      if (add(asset("coffee_table", room.id, c.x, c.y, Math.min(1.10,w*0.28), Math.min(0.64,d*0.22), 0.42))) break;
    }
    if (w*d >= 15 && sofaPlaced) {
      const secondarySide = sides.find((s)=>s.id!==sofaSide.id && s.wallSupported && s.doorCount===0 && s.length>=1.25);
      if (secondarySide) add(againstSideAsset("armchair", room.id, secondarySide, 0.92, 0.88, 0.82, 0.10));
    }
  } else if (type === "kitchen" || type === "kitchen_dining") {
    const kitchenSides = sides.filter((s)=>s.wallSupported && s.length>=1.45 && s.openingPenalty<4.5);
    let counter = null;
    let counterSide = null;
    for (const side of kitchenSides) {
      const candidate = againstSideAsset("kitchen_counter", room.id, side, Math.min(3.0,Math.max(1.45,side.length*0.68)), 0.58,0.92,0.055);
      if (add(candidate)) { counter = candidate; counterSide = side; break; }
    }
    if (counter && counterSide) {
      const tx = Number.isFinite(counter.wallDirX) ? counter.wallDirX : 1, ty = Number(counter.wallDirY)||0, span = Math.max(counter.width,1.45);
      add(asset("sink", room.id, counter.xMeters-tx*span*0.18, counter.yMeters-ty*span*0.18, 0.58,0.50,0.86,counter.rotation,{embeddedInCounter:true}));
      add(asset("stove", room.id, counter.xMeters+tx*span*0.22, counter.yMeters+ty*span*0.22, 0.58,0.54,0.90,counter.rotation,{embeddedInCounter:true}));
      for (const sign of [-1, 1]) {
        const offset = span / 2 + 0.46;
        if (add(asset("refrigerator", room.id,
          counter.xMeters + sign * tx * offset + counterSide.inwardX * 0.06,
          counter.yMeters + sign * ty * offset + counterSide.inwardY * 0.06,
          0.68, 0.68, 1.82, counter.rotation))) break;
      }
    }
    if (type === "kitchen_dining") {
      const tableCandidates = [{x:cx,y:cy},{x:cx+w*0.14,y:cy},{x:cx-w*0.14,y:cy},{x:cx,y:cy+d*0.14},{x:cx,y:cy-d*0.14}];
      let table=null;
      for (const c of tableCandidates) {
        const candidate = asset("dining_table", room.id, c.x,c.y,Math.min(1.55,w*0.38),Math.min(0.90,d*0.28),0.76);
        if (add(candidate)) { table=candidate; break; }
      }
      if (table) for (const chair of diningChairCandidates(table)) add(chair);
    }
  } else if (type === "dining") {
    const table = asset("dining_table", room.id, cx, cy, Math.min(1.65, w * 0.48), Math.min(0.92, d * 0.40), 0.76);
    if (add(table)) {
      for (const chair of diningChairCandidates(table)) add(chair);
    }
  } else if (type === "bathroom") {
    // Wet fixtures use a deterministic perimeter layout: shower in a clear
    // corner, toilet on a different wall zone, basin in the remaining clear
    // zone. This prevents the floating/stacked fixture mess of earlier builds.
    const doorPoints = openingCenters.filter((o) => o.type === "door");
    const cornerCandidates = [
      { x: b.minX + Math.min(0.46, w * 0.30), y: b.minY + Math.min(0.46, d * 0.24) },
      { x: b.maxX - Math.min(0.46, w * 0.30), y: b.minY + Math.min(0.46, d * 0.24) },
      { x: b.minX + Math.min(0.46, w * 0.30), y: b.maxY - Math.min(0.46, d * 0.24) },
      { x: b.maxX - Math.min(0.46, w * 0.30), y: b.maxY - Math.min(0.46, d * 0.24) },
    ].sort((a, b2) => {
      const da = doorPoints.length ? Math.min(...doorPoints.map((o) => Math.hypot(o.x - a.x, o.y - a.y))) : 10;
      const db = doorPoints.length ? Math.min(...doorPoints.map((o) => Math.hypot(o.x - b2.x, o.y - b2.y))) : 10;
      return db - da;
    });
    for (const c of cornerCandidates) {
      if (add(asset("shower", room.id, c.x, c.y, Math.min(0.82, w * 0.42), Math.min(0.82, d * 0.34), 2.05, 0, { compactWetFixture: true }))) break;
    }
    const toiletCandidates = [
      asset("toilet", room.id, b.minX + Math.min(0.38, w * 0.26), cy, 0.55, 0.70, 0.78, 90, { compactWetFixture: true }),
      asset("toilet", room.id, b.maxX - Math.min(0.38, w * 0.26), cy, 0.55, 0.70, 0.78, 90, { compactWetFixture: true }),
      asset("toilet", room.id, cx, b.minY + Math.min(0.42, d * 0.22), 0.55, 0.70, 0.78, 0, { compactWetFixture: true }),
      asset("toilet", room.id, cx, b.maxY - Math.min(0.42, d * 0.22), 0.55, 0.70, 0.78, 0, { compactWetFixture: true }),
    ];
    for (const candidate of toiletCandidates) { if (add(candidate)) break; }
    const sinkCandidates = [
      // Side-mid positions are preferred in compact bathrooms because the
      // corners are usually occupied by shower/toilet fixtures.
      asset("sink", room.id, b.maxX - Math.min(0.36, w * 0.24), cy, 0.44, 0.52, 0.84, 90, { compactWetFixture: true }),
      asset("sink", room.id, b.minX + Math.min(0.36, w * 0.24), cy, 0.44, 0.52, 0.84, 90, { compactWetFixture: true }),
      asset("sink", room.id, cx, b.maxY - Math.min(0.30, d * 0.18), 0.52, 0.44, 0.84, 0, { compactWetFixture: true }),
      asset("sink", room.id, cx, b.minY + Math.min(0.30, d * 0.18), 0.52, 0.44, 0.84, 0, { compactWetFixture: true }),
      asset("sink", room.id, b.maxX - Math.min(0.30, w * 0.22), b.maxY - Math.min(0.34, d * 0.18), 0.52, 0.44, 0.84, 0, { compactWetFixture: true }),
      asset("sink", room.id, b.minX + Math.min(0.30, w * 0.22), b.maxY - Math.min(0.34, d * 0.18), 0.52, 0.44, 0.84, 0, { compactWetFixture: true }),
    ];
    for (const candidate of sinkCandidates) { if (add(candidate)) break; }
  } else if (type === "storage") {
    for (const side of sides.slice(0, 2)) {
      if (side.openingPenalty < 2.0) add(againstSideAsset("cabinet", room.id, side, Math.min(1.5, side.length * 0.72), 0.45, 1.85, 0.02));
    }
  } else if (type === "office") {
    const deskSide = sides.find((s) => s.openingPenalty < 2.5) || sides[0];
    add(againstSideAsset("desk", room.id, deskSide, Math.min(1.5, deskSide.length * 0.55), 0.70, 0.75, 0.08));
    add(asset("chair", room.id, cx, cy, 0.50, 0.50, 0.88));
  }

  // V9 minimum furnishing profiles. The collision-aware first pass stays
  // authoritative; these conservative fallbacks only fill obviously missing
  // essentials using smaller footprints. This prevents empty or nonsensical
  // rooms without turning the preview into a furniture catalogue.
  if (type === "bedroom") {
    if (!placed.some((a) => a.type === "wardrobe")) {
      for (const side of sides) {
        if (side.doorCount > 0 || side.windowCount > 0 || side.length < 1.05) continue;
        if (add(againstSideAsset("wardrobe", room.id, side, Math.min(1.45, side.length * 0.55), 0.50, 2.10, 0.02))) break;
      }
    }
  } else if (type === "living") {
    if (!placed.some((a) => a.type === "tv_unit")) {
      for (const side of sides) {
        if (side.doorCount > 0 || side.length < 1.0) continue;
        if (add(againstSideAsset("tv_unit", room.id, side, Math.min(1.45, side.length * 0.42), 0.30, 0.58, 0.02))) break;
      }
    }
  } else if (type === "kitchen_dining") {
    if (!placed.some((a) => a.type === "dining_table")) {
      const offsets = [[0,0],[w*0.16,0],[-w*0.16,0],[0,d*0.15],[0,-d*0.15]];
      for (const [ox, oy] of offsets) {
        const table = asset("dining_table", room.id, cx + ox, cy + oy, Math.min(1.35, w * 0.34), Math.min(0.82, d * 0.26), 0.76);
        if (add(table)) break;
      }
    }
  } else if (type === "bathroom") {
    // Compact bathrooms may reject one fixture because of conservative door
    // clearance. Keep at least a toilet and basin when a shower already exists.
    if (!placed.some((a) => a.type === "toilet")) {
      const candidates = [
        asset("toilet", room.id, b.minX + Math.min(0.34,w*0.22), cy, 0.50, 0.64, 0.78, 90, { compactWetFixture: true }),
        asset("toilet", room.id, b.maxX - Math.min(0.34,w*0.22), cy, 0.50, 0.64, 0.78, 90, { compactWetFixture: true }),
      ];
      for (const c of candidates) if (add(c)) break;
    }
    if (!placed.some((a) => a.type === "sink")) {
      const candidates = [
        asset("sink", room.id, cx, b.maxY - Math.min(0.28,d*0.16), 0.46, 0.40, 0.84, 0, { compactWetFixture: true }),
        asset("sink", room.id, cx, b.minY + Math.min(0.28,d*0.16), 0.46, 0.40, 0.84, 0, { compactWetFixture: true }),
      ];
      for (const c of candidates) if (add(c)) break;
    }
  }


  // V18 general essential profiles. These are deliberately room-type based,
  // not plan-specific. They run only after the normal furnishing pass.
  if (type === "bedroom") {
    if (!placed.some((a) => a.type === "wardrobe")) {
      const wardrobeSides = [
        ...sides.filter((s) => s.doorCount === 0 && s.windowCount === 0),
        ...sides.filter((s) => s.doorCount === 0),
        ...sides,
      ];
      tryEssentialAgainstSides(
        "wardrobe",
        wardrobeSides,
        [
          { width: 1.35, depth: 0.46, sideFraction: 0.52 },
          { width: 1.05, depth: 0.42, sideFraction: 0.46 },
          { width: 0.82, depth: 0.38, sideFraction: 0.40 },
        ],
        2.05,
        0.015
      );
    }
  } else if (type === "living") {
    if (!placed.some((a) => a.type === "tv_unit")) {
      const sofa = placed.find((a) => a.type === "sofa");
      const sofaSideId = sofa?.wallSide;
      const tvSides = [
        ...sides.filter((s) => s.id !== sofaSideId && s.doorCount === 0 && s.wallSupported),
        ...sides.filter((s) => s.id !== sofaSideId && s.doorCount === 0),
        ...sides.filter((s) => s.id !== sofaSideId),
      ];
      tryEssentialAgainstSides(
        "tv_unit",
        tvSides,
        [
          { width: 1.35, depth: 0.28, sideFraction: 0.44 },
          { width: 1.00, depth: 0.24, sideFraction: 0.38 },
        ],
        0.58,
        0.015
      );
    }
  } else if (type === "kitchen" || type === "kitchen_dining") {
    let counter = placed.find((a) => a.type === "kitchen_counter");
    let counterSide = counter ? sides.find((s) => s.id === counter.wallSide) : null;

    if (!counter) {
      const preferred = sides.filter((s) => s.wallSupported && s.doorCount === 0);
      counter = tryEssentialAgainstSides(
        "kitchen_counter",
        preferred,
        [
          { width: 2.10, depth: 0.52, sideFraction: 0.64 },
          { width: 1.65, depth: 0.48, sideFraction: 0.56 },
          { width: 1.20, depth: 0.44, sideFraction: 0.48 },
        ],
        0.92,
        0.015
      );
      counterSide = counter ? sides.find((s) => s.id === counter.wallSide) : null;
    }

    if (counter) {
      const tx = Number.isFinite(counter.wallDirX) ? counter.wallDirX : 1;
      const ty = Number(counter.wallDirY) || 0;
      const span = Math.max(1.15, Number(counter.width) || 1.4);

      if (!placed.some((a) => a.type === "sink")) {
        const sink = asset(
          "sink", room.id,
          counter.xMeters - tx * span * 0.18,
          counter.yMeters - ty * span * 0.18,
          0.50, 0.44, 0.86, counter.rotation,
          { embeddedInCounter: true, essentialPlacement: true }
        );
        add(sink) || addEssential(sink);
      }

      if (!placed.some((a) => a.type === "stove")) {
        const stove = asset(
          "stove", room.id,
          counter.xMeters + tx * span * 0.20,
          counter.yMeters + ty * span * 0.20,
          0.50, 0.48, 0.90, counter.rotation,
          { embeddedInCounter: true, essentialPlacement: true }
        );
        add(stove) || addEssential(stove);
      }

      if (!placed.some((a) => a.type === "refrigerator") && counterSide) {
        for (const sign of [-1, 1]) {
          const offset = span / 2 + 0.42;
          const fridge = asset("refrigerator", room.id,
            counter.xMeters + sign * tx * offset + counterSide.inwardX * 0.06,
            counter.yMeters + sign * ty * offset + counterSide.inwardY * 0.06,
            0.62, 0.62, 1.80, counter.rotation, { essentialPlacement: true });
          if (add(fridge)) break;
        }
      }
    }

    if (type === "kitchen_dining" && !placed.some((a) => a.type === "dining_table")) {
      const candidates = [
        [cx, cy],
        [cx + w * 0.15, cy],
        [cx - w * 0.15, cy],
        [cx, cy + d * 0.15],
        [cx, cy - d * 0.15],
      ];
      for (const [x, y] of candidates) {
        const table = asset("dining_table", room.id, x, y, Math.min(1.25, w * 0.32), Math.min(0.76, d * 0.24), 0.76);
        if (add(table) || addEssential(table)) break;
      }
    }
  } else if (type === "storage") {
    if (!placed.some((a) => a.type === "cabinet")) {
      const cabinetSides = [
        ...sides.filter((s) => s.doorCount === 0),
        ...sides,
      ];
      const cabinetPlaced = tryEssentialAgainstSides(
        "cabinet",
        cabinetSides,
        [
          { width: 1.15, depth: 0.38, sideFraction: 0.60 },
          { width: 0.80, depth: 0.34, sideFraction: 0.48 },
          { width: 0.62, depth: 0.30, sideFraction: 0.40 },
        ],
        1.75,
        0.01
      );
      if (!cabinetPlaced) {
        tryEssentialGrid("cabinet", Math.min(0.72, w*0.46), Math.min(0.32, d*0.34), 1.55, 0, { essentialPlacement: true });
      }
    }
  } else if (type === "bathroom") {
    if (!placed.some((a) => a.type === "toilet")) {
      const candidates = [
        asset("toilet", room.id, b.minX + Math.min(0.30, w * 0.20), cy, 0.48, 0.60, 0.78, 90, { compactWetFixture: true }),
        asset("toilet", room.id, b.maxX - Math.min(0.30, w * 0.20), cy, 0.48, 0.60, 0.78, 90, { compactWetFixture: true }),
        asset("toilet", room.id, cx, b.minY + Math.min(0.34, d * 0.20), 0.48, 0.60, 0.78, 0, { compactWetFixture: true }),
      ];
      for (const c of candidates) if (add(c) || addEssential(c)) break;
    }
    if (!placed.some((a) => a.type === "sink")) {
      const candidates = [
        asset("sink", room.id, b.maxX - Math.min(0.28, w * 0.20), cy, 0.42, 0.38, 0.84, 90, { compactWetFixture: true }),
        asset("sink", room.id, b.minX + Math.min(0.28, w * 0.20), cy, 0.42, 0.38, 0.84, 90, { compactWetFixture: true }),
      ];
      for (const c of candidates) if (add(c) || addEssential(c)) break;
    }
  }


  // Final completeness pass for obvious room essentials.
  if (type === "bathroom") {
    if (!placed.some((a) => a.type === "toilet")) {
      tryEssentialGrid("toilet", 0.44, 0.56, 0.78, 90, { compactWetFixture: true, essentialPlacement: true });
    }
    if (!placed.some((a) => a.type === "sink")) {
      tryEssentialGrid("sink", 0.40, 0.34, 0.84, 90, { compactWetFixture: true, essentialPlacement: true });
    }
  }

  if (type === "kitchen" || type === "kitchen_dining") {
    const counter = placed.find((a) => a.type === "kitchen_counter");
    if (counter) {
      const tx = Number.isFinite(counter.wallDirX) ? counter.wallDirX : 1;
      const ty = Number(counter.wallDirY) || 0;
      const span = Math.max(1.1, Number(counter.width) || 1.5);

      if (!placed.some((a) => a.type === "sink")) {
        const sink = asset("sink", room.id,
          counter.xMeters - tx * span * 0.18,
          counter.yMeters - ty * span * 0.18,
          0.52, 0.46, 0.86, counter.rotation,
          { embeddedInCounter: true, essentialPlacement: true });
        add(sink) || addEssential(sink);
      }
      if (!placed.some((a) => a.type === "stove")) {
        const stove = asset("stove", room.id,
          counter.xMeters + tx * span * 0.22,
          counter.yMeters + ty * span * 0.22,
          0.52, 0.48, 0.90, counter.rotation,
          { embeddedInCounter: true, essentialPlacement: true });
        add(stove) || addEssential(stove);
      }
      if (!placed.some((a) => a.type === "refrigerator")) {
        for (const side of sides.filter((s) => s.wallSupported && s.doorCount === 0 && s.windowCount === 0)) {
          if (add(againstSideAsset("refrigerator", room.id, side, 0.66, 0.66, 1.82, 0.055))) break;
        }
      }
    }
  }

  return placed;
}

function assetPriority(a) {
  const rank = {
    kitchen_counter: 100,
    bed: 95,
    toilet: 94,
    sink: 92,
    shower: 90,
    stove: 88,
    refrigerator: 86,
    wardrobe: 84,
    sofa: 82,
    dining_table: 80,
    tv_unit: 78,
    coffee_table: 70,
    nightstand: 62,
    desk: 58,
    cabinet: 56,
    chair: 48,
    armchair: 46,
    plant: 25,
    rug: 10,
  };
  return rank[String(a?.type || "")] || 40;
}

function requiredAssetTypesForRoom(room) {
  const type = canonicalRoomType(room);
  if (type === "bedroom") return ["bed", "wardrobe"];
  if (type === "living") return ["sofa", "coffee_table", "tv_unit"];
  if (type === "kitchen") return ["kitchen_counter", "sink", "stove", "refrigerator"];
  if (type === "kitchen_dining") return ["kitchen_counter", "sink", "stove", "refrigerator", "dining_table"];
  if (type === "dining") return ["dining_table"];
  if (type === "bathroom") return /shower|حمام|دوش|استحمام/i.test(String(room.name)) ? ["toilet", "sink", "shower"] : ["toilet", "sink"];
  if (type === "storage") return ["cabinet"];
  if (type === "office") return ["desk", "chair"];
  return [];
}

function normalizeAssetForValidation(a, index = 0) {
  return {
    ...a,
    id: String(a?.id || `${a?.type || "asset"}_${index + 1}`).slice(0, 80),
    xMeters: Number(a?.xMeters),
    yMeters: Number(a?.yMeters),
    width: Math.max(0.05, Number(a?.width) || 0),
    depth: Math.max(0.05, Number(a?.depth) || 0),
    height: Math.max(0.01, Number(a?.height) || 0.5),
    rotation: Number.isFinite(Number(a?.rotation)) ? Number(a.rotation) : 0,
  };
}

function validateAndCompleteFurniture(assets, rooms, walls, openings) {
  const wallMap = new Map((walls || []).map((wall) => [String(wall.id), wall]));
  const openingCenters = (openings || []).map((opening) => openingCenterFromScene(opening, wallMap)).filter(Boolean);
  const accepted = [];
  const rejected = [];
  const added = [];
  const byRoom = new Map((rooms || []).map((room) => [String(room.id), []]));

  const roomForAsset = (a) => rooms.find((room) => String(room.id) === String(a.roomId))
    || rooms.find((room) => pointInPolygon({ x: a.xMeters, y: a.yMeters }, room.polygon));
  const roomOpeningCenters = (room) => {
    const b = roomBounds(room);
    return openingCenters.filter((p) => p.x >= b.minX - 0.35 && p.x <= b.maxX + 0.35 && p.y >= b.minY - 0.35 && p.y <= b.maxY + 0.35);
  };
  const candidateAssets = (Array.isArray(assets) ? assets : [])
    .map(normalizeAssetForValidation)
    .filter((a) => Number.isFinite(a.xMeters) && Number.isFinite(a.yMeters) && a.width > 0 && a.depth > 0)
    .map((a, index) => ({ a, index }))
    .sort((left, right) => assetPriority(right.a) - assetPriority(left.a) || left.index - right.index);

  for (const { a } of candidateAssets) {
    const room = roomForAsset(a);
    if (!room) {
      rejected.push({ id: a.id, type: a.type, reason: "no_containing_room" });
      continue;
    }
    const placed = byRoom.get(String(room.id)) || [];
    const candidate = { ...a, roomId: room.id };
    if (!assetFitsRoom(candidate, room, placed, roomOpeningCenters(room))) {
      rejected.push({ id: a.id, type: a.type, roomId: room.id, reason: "collision_or_door_clearance" });
      continue;
    }
    placed.push(candidate);
    byRoom.set(String(room.id), placed);
    accepted.push(candidate);
  }

  for (const room of rooms || []) {
    const existing = byRoom.get(String(room.id)) || [];
    const required = requiredAssetTypesForRoom(room);
    if (!required.length) continue;
    const missing = required.filter((type) => !existing.some((a) => a.type === type));
    if (!missing.length) continue;
    const generated = furnishRoom(room, { walls, openings })
      .filter((a) => missing.includes(a.type))
      .sort((left, right) => required.indexOf(left.type) - required.indexOf(right.type));
    for (const generatedAsset of generated) {
      if (!missing.includes(generatedAsset.type)) continue;
      if (existing.some((a) => a.type === generatedAsset.type)) continue;
      const candidate = normalizeAssetForValidation({
        ...generatedAsset,
        id: `completed_${room.id}_${generatedAsset.type}_${existing.length + 1}`,
        placementSource: "ventra_validated_completion_v1",
        completionReason: "missing_room_essential",
      }, existing.length);
      if (!assetFitsRoom(candidate, room, existing, roomOpeningCenters(room))) continue;
      existing.push(candidate);
      accepted.push(candidate);
      added.push({ id: candidate.id, roomId: room.id, type: candidate.type, reason: "missing_room_essential" });
    }
    byRoom.set(String(room.id), existing);
  }

  const ordered = [...accepted].sort((left, right) => {
    const roomDelta = String(left.roomId).localeCompare(String(right.roomId));
    return roomDelta || assetPriority(right) - assetPriority(left);
  });
  return {
    assets: ordered.slice(0, 140),
    rejected,
    added,
    collisionAware: true,
    doorClearanceAware: true,
  };
}


function clusterGuideCoordinates(values = [], tolerance = 5) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(value - last.mean) > tolerance) {
      clusters.push({ values: [value], mean: value });
    } else {
      last.values.push(value);
      last.mean = last.values.reduce((s, n) => s + n, 0) / last.values.length;
    }
  }
  return clusters.map((c) => c.mean);
}

function snapRawSceneToPixelGuides(raw, evidence) {
  if (!raw || raw.coordinateMode !== "image_normalized" || !evidence?.guides?.length) {
    return { raw, diagnostics: { applied: false, reason: "no_usable_pixel_guides" } };
  }

  const width = Number(evidence.width) || 1;
  const height = Number(evidence.height) || 1;
  const minDim = Math.max(1, Math.min(width, height));

  // V19: long, thin orthogonal strokes are the most useful deterministic
  // evidence for wall alignment. We do NOT create walls from these guides.
  // We only snap AI-observed vertices that are already very close to them.
  const minGuideLength = minDim * 0.055;
  const verticalGuides = [];
  const horizontalGuides = [];

  for (const g of evidence.guides) {
    const dx = Number(g?.end?.x) - Number(g?.start?.x);
    const dy = Number(g?.end?.y) - Number(g?.start?.y);
    const len = Math.hypot(dx, dy);
    if (!(len >= minGuideLength)) continue;
    if (Math.abs(dx) <= Math.abs(dy) * 0.12) {
      verticalGuides.push({
        coord: (Number(g.start.x) + Number(g.end.x)) / 2,
        min: Math.min(Number(g.start.y), Number(g.end.y)),
        max: Math.max(Number(g.start.y), Number(g.end.y)),
        length: len,
      });
    } else if (Math.abs(dy) <= Math.abs(dx) * 0.12) {
      horizontalGuides.push({
        coord: (Number(g.start.y) + Number(g.end.y)) / 2,
        min: Math.min(Number(g.start.x), Number(g.end.x)),
        max: Math.max(Number(g.start.x), Number(g.end.x)),
        length: len,
      });
    }
  }

  // Merge double wall faces / near-duplicate detected strokes.
  const xClusters = clusterGuideCoordinates(verticalGuides.map((g) => g.coord), 5);
  const yClusters = clusterGuideCoordinates(horizontalGuides.map((g) => g.coord), 5);

  const remapGuides = (guides, clusters) => guides.map((g) => ({
    ...g,
    coord: clusters.reduce((best, c) =>
      Math.abs(c - g.coord) < Math.abs(best - g.coord) ? c : best,
      clusters[0] ?? g.coord),
  }));

  const vGuides = remapGuides(verticalGuides, xClusters);
  const hGuides = remapGuides(horizontalGuides, yClusters);

  const tolerancePx = Math.max(5, Math.min(13, Math.round(minDim * 0.015)));
  const spanMarginPx = Math.max(10, Math.min(24, Math.round(minDim * 0.025)));

  let pointsSeen = 0;
  let pointsSnapped = 0;
  let xSnaps = 0;
  let ySnaps = 0;
  let totalSnapDistance = 0;

  const snapPoint = (point) => {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return point;
    pointsSeen += 1;
    const px = Number(point.x) * width;
    const py = Number(point.y) * height;
    let nx = px;
    let ny = py;
    let changed = false;

    let localDistance = 0;

    let bestV = null;
    for (const g of vGuides) {
      if (py < g.min - spanMarginPx || py > g.max + spanMarginPx) continue;
      const d = Math.abs(px - g.coord);
      if (d <= tolerancePx && (!bestV || d < bestV.d)) bestV = { d, coord: g.coord };
    }
    if (bestV) {
      nx = bestV.coord;
      changed = true;
      xSnaps += 1;
      localDistance += bestV.d;
    }

    let bestH = null;
    for (const g of hGuides) {
      if (px < g.min - spanMarginPx || px > g.max + spanMarginPx) continue;
      const d = Math.abs(py - g.coord);
      if (d <= tolerancePx && (!bestH || d < bestH.d)) bestH = { d, coord: g.coord };
    }
    if (bestH) {
      ny = bestH.coord;
      changed = true;
      ySnaps += 1;
      localDistance += bestH.d;
    }

    if (changed) {
      pointsSnapped += 1;
      totalSnapDistance += localDistance;
    }
    return {
      x: clamp(nx / width, 0, 1, Number(point.x)),
      y: clamp(ny / height, 0, 1, Number(point.y)),
    };
  };

  const snapped = {
    ...raw,
    footprint: (Array.isArray(raw.footprint) ? raw.footprint : []).map(snapPoint),
    rooms: (Array.isArray(raw.rooms) ? raw.rooms : []).map((room) => ({
      ...room,
      polygon: (Array.isArray(room?.polygon) ? room.polygon : []).map((p) => ({ ...p })),
    })),
    partitions: (Array.isArray(raw.partitions) ? raw.partitions : []).map((wall) => ({
      ...wall,
      start: snapPoint(wall?.start),
      end: snapPoint(wall?.end),
    })),
    openings: (Array.isArray(raw.openings) ? raw.openings : []).map((opening) => ({
      ...opening,
      center: { ...(opening?.center || {}) },
    })),
  };

  return {
    raw: snapped,
    diagnostics: {
      applied: pointsSnapped > 0,
      reason: "structural_pixel_guide_snap_final",
      tolerancePixels: tolerancePx,
      spanMarginPixels: spanMarginPx,
      verticalGuideCount: vGuides.length,
      horizontalGuideCount: hGuides.length,
      pointsSeen,
      pointsSnapped,
      xSnaps,
      ySnaps,
      meanSnapDistancePixels: pointsSnapped
        ? Number((totalSnapDistance / Math.max(1, xSnaps + ySnaps)).toFixed(2))
        : 0,
    },
  };
}

function normalizeScene(inputRaw, imageMeta = {}, imageEvidence = null) {
  const guideSnap = snapRawSceneToPixelGuides(inputRaw, imageEvidence);
  const sourceProjection = projectImageNormalizedSceneToMeters(guideSnap.raw, imageMeta);
  const raw = sourceProjection.raw;
  const width = clamp(raw?.widthMeters, 2, 80, 10);
  const depth = clamp(raw?.depthMeters, 2, 80, 8);
  let footprint = cleanPolygon((raw?.footprint || []).map((p) => sourcePoint(p, width, depth)));
  if (footprint.length < 4 || polygonArea(footprint) < width * depth * 0.18) {
    throw Object.assign(new Error("The preview did not return a usable building outline."), { code: "PREVIEW_BAD_FOOTPRINT" });
  }

  const rawRooms = Array.isArray(raw?.rooms) ? raw.rooms : [];
  const roomCandidates = rawRooms.map((room, index) => {
    const polygon = cleanPolygon((room?.polygon || []).map((p) => sourcePoint(p, width, depth)));
    const visible = room?.labelVisible !== false;
    const printedWidth = clamp(room?.printedWidthMeters, 0, 40, 0);
    const printedDepth = clamp(room?.printedDepthMeters, 0, 40, 0);
    return {
      id: String(room?.id || `room_${index + 1}`).slice(0, 64),
      name: String(room?.name || `Room ${index + 1}`).slice(0, 100),
      type: String(room?.type || "room").slice(0, 64),
      labelVisible: visible,
      printedWidthMeters: printedWidth,
      printedDepthMeters: printedDepth,
      polygon,
    };
  }).filter((room) => room.polygon.length >= 3 && polygonArea(room.polygon) > 0.20);

  // Labels are optional; distinct spaces can share the same name.
  const roomIds = new Set();
  const observedRooms = roomCandidates.map(room => {
    if (roomIds.has(room.id)) throw Object.assign(new Error("Duplicate room identifier in trace."), {code:"PREVIEW_DUPLICATE_ROOM_ID"});
    roomIds.add(room.id); return room;
  });
  const dimensionAlignment = createPrintedDimensionAlignment(observedRooms, width, depth, footprint);
  const alignedPoint = p => mapPrintedDimensionPoint(p, dimensionAlignment);
  const sourceScenePoint = p => alignedPoint(sourcePoint(p, width, depth));
  footprint = footprint.map(alignedPoint);
  const roomsBeforeLock = observedRooms.map(room => ({...room, polygon:room.polygon.map(alignedPoint)}));
  const dimensionDiagnostic = dimensionLockRooms(roomsBeforeLock, width, depth);
  const dimensionLock = {...dimensionDiagnostic, rooms:roomsBeforeLock, applied:dimensionAlignment.applied, reason:dimensionAlignment.applied?'shared_printed_dimension_alignment_v54':'source_dimensions_preserved'};
  const relationships = normalizeRelationships(raw?.relationships, roomsBeforeLock.map((r) => r.id));
  const topology = {
    rooms: roomsBeforeLock,
    diagnostics: {
      version: "source_image_global_affine_layout_v15",
      applied: false, snappedPairs: 0, openPairs: relationships.filter((r) => r.relation === "open").length,
      wallPairs: relationships.filter((r) => r.relation === "wall" || r.relation === "door").length,
      relationshipResidualMean: 0, maxShiftMeters: 0, sourceAnchorMeanShift: 0, guardedRelationships: 0, maxAllowedShiftMeters: 0,
    },
  };
  const overlapCleanup = { rooms: topology.rooms, adjustments: 0 };
  let roomContainmentAdjustments = 0;
  const rooms = overlapCleanup.rooms.map((room) => {
    const semanticType = canonicalRoomType(room);
    const normalized = {
      ...room,
      semanticType,
      // The unchanged V7 viewer maps room.type to its floor material. Integrated
      // kitchen+dining zones are dry open-plan space, so expose them as dining
      // for rendering while preserving semanticType/name for furnishing logic.
      type: ["kitchen_dining", "dining"].includes(semanticType) ? "living" : semanticType,
      floorFinish: floorFinishForRoom({ ...room, type: semanticType }),
    };
    const contained = containRoomInFootprint(normalized, footprint);
    if (contained.adjusted) roomContainmentAdjustments += 1;
    return contained.room;
  });

  // Keep visually grounded spaces even when the drawing does not print a label.

  if (!rooms.length) {
    throw Object.assign(new Error("The preview did not return usable room zones."), { code: "PREVIEW_NO_ROOMS" });
  }

  // V7: preserve the model-traced OUTER building contour.
  // V5/V6 rebuilt the footprint from the union of labeled rooms. That was a
  // category error: unlabeled circulation / entrance / open-plan areas are
  // still inside the building, so the room-union carved them out and produced
  // the jagged/shrunken footprint seen in V6. Printed room dimensions may lock
  // room rectangles, but they must never redefine the exterior shell.
  const rawFootprint = footprint;
  footprint = simplifyOrthogonalPolygon(rawFootprint, 0.045);
  const footprintRepair = {
    repaired: false,
    reason: "model_outer_contour_preserved_v7",
    rawPointCount: rawFootprint.length,
    finalPointCount: footprint.length,
  };

  const externalWalls = footprint.map((p, index) => ({
    id: `ext_${index + 1}`,
    type: "external",
    start: { ...p },
    end: { ...footprint[(index + 1) % footprint.length] },
  }));

  const rawPartitions = (Array.isArray(raw?.partitions) ? raw.partitions : []).map((wall, index) => snapPartitionToRoomGrid({
    id: String(wall?.id || `int_${index + 1}`).slice(0, 64),
    provenance: "observed",
    type: "internal",
    start: sourceScenePoint(wall?.start),
    end: sourceScenePoint(wall?.end),
  }, rooms)).filter((wall) => dist(wall.start, wall.end) > 0.15 && !partitionCrossesRoomInterior(wall, rooms));
  const synthesizedRoomWalls = synthesizeRoomBoundaryPartitions(rawPartitions, rooms, externalWalls);
  const openPlanFiltered = filterOpenPlanPartitions(synthesizedRoomWalls.partitions, rooms, relationships, (raw.openings || []).map((opening) => ({ ...opening, center: sourceScenePoint(opening.center) })));
  const relationshipWalls = ensureRelationshipWalls(openPlanFiltered.partitions, rooms, relationships);
  let partitions = relationshipWalls.partitions;

  const seen = new Set();
  let walls = [...externalWalls, ...partitions].filter((wall) => {
    const key = wallKey(wall);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  walls = cleanupWallStubs(closeAlignedWallGaps(walls));

  const sourceOpeningObservations = (raw.openings || []).map(opening => ({...opening, center:sourceScenePoint(opening.center)}));
  const openingSupport = prepareObservedOpeningWalls(walls, rooms, sourceOpeningObservations, relationships);
  walls = openingSupport.walls;
  const detectedOpenings = [];
  for (const opening of Array.isArray(raw?.openings) ? raw.openings : []) {
    const center = sourceScenePoint(opening?.center);
    const type = opening?.type === 'window' ? 'window' : 'door';
    const best = chooseBestWallForOpening(center, type, walls, rooms, relationships, opening?.wallIdHint, opening?.wallAxis, opening?.widthMeters);
    if (!best || !best.projection || best.projection.length < 0.35) continue;
    if (best.projection.distance > Math.max(0.9, Math.min(width, depth) * 0.09)) continue;

    // Reject very implausible internal door assignments. This is what prevents
    // a random opening from being attached to the nearest wall simply because
    // the visual symbol happened to be nearby.
    if (type === 'door' && best.score > 1.05) continue;
    if (type === 'window' && String(best.wall.type) !== 'external' && best.score > 0.85) continue;

    const observedWidth = Number(opening?.widthMeters);
    detectedOpenings.push({
      id: String(opening?.id || `opening_${detectedOpenings.length + 1}`).slice(0,64),
      type,
      wallId: best.wall.id,
      offset: best.projection.t,
      width: observedWidth > 0 ? observedWidth : type==='window'?1.4:0.9,
      ...openingVerticalDimensions(opening, type),
      ...observedDoorOrientation(opening,best.wall),
      provenance: "source_observed",
      _sourceDistance: Number(best.projection.distance || 0),
      _score: Number(best.score || 0),
    });
  }

  const requiredDoorPass = ensureRequiredDoors(dedupeOpenings(detectedOpenings), walls, rooms, relationships);
  const accessDoorPass = normalizeEnclosedRoomDoors(
    requiredDoorPass.openings,
    walls,
    rooms,
    relationships,
    footprint
  );
  const overlapRepair = repairOverlappingWalls(walls, accessDoorPass.openings);
  walls = overlapRepair.walls;
  const outdoor = outdoorBoundaries(walls, rooms, overlapRepair.openings);
  walls = outdoor.walls;
  const finalOpenings = outdoor.openings;


  const furnitureObservations = (raw.furniture || []).map(item => ({...item,
    backLeft:sourceScenePoint(item.backLeft),backRight:sourceScenePoint(item.backRight),frontCenter:sourceScenePoint(item.frontCenter)
  }));
  const sourceFurniture = compileSourceFurniture(furnitureObservations,footprint,rooms,walls);
  // Source furniture has already passed oriented geometry checks. Generic
  // room profiles inflate adjacent L legs and relocate rejected beds/fixtures.
  // They must never replace observations in the source-fidelity path.
  const furnitureValidation = {assets:sourceFurniture.assets,rejected:[],added:[],collisionAware:true,doorClearanceAware:false};
  let assets = furnitureValidation.assets;

  return {
    sceneType: "floorplan_interactive_preview",
    title: String(raw?.title || "Interactive 3D Preview").slice(0, 120),
    previewMode: "interactive_architectural_cutaway_v20",
    presentationStyle: "ventra_architectural_cutaway_v21",
    width,
    depth,
    height: 3.2,
    cutawayHeight: 3.2,
    heightSource: 'design_default_not_measured',
    wallThickness: 0.12,
    externalWallThickness: 0.20,
    footprint,
    holes: [],
    rooms,
    relationships,
    walls,
    openings: finalOpenings,
    assets,
    furnishingMode: 'source_observed',
    furnishingReview: {
      observedCount:(raw.furniture||[]).length,
      acceptedCount:assets.length,
      rejected:[...sourceFurniture.rejected, ...furnitureValidation.rejected],
      added:furnitureValidation.added,
      observations:furnitureObservations,
      observationCoordinateMode:"scene_meters_y_up",
      requiresReview:sourceFurniture.rejected.length>0||furnitureValidation.rejected.length>0||assets.length===0
    },
    palette: {
      wall: "#ECEAE5",
      externalWall: "#45484D",
      floor: "#E3DED6",
      ceiling: "#F7F4EE",
      accent: "#7C624E",
      glass: "#9FC2D0",
      door: "#7B573E",
      furniture: "#AF8460",
      upholstery: "#DDD5CA",
      textileAccent: "#88956F",
      metal: "#6B7074",
      bathroomTile: "#F5F6F4",
      bedroomWood: "#C89C6C",
      mainStone: "#E5E1DA"
    },
    backgroundColor: "#D5D7DA",
    showRoomLabels: false,
    geometryValidation: {
      version: VERSION,
      mode: "visual_interactive_preview",
      confidence: clamp(raw?.confidence, 0, 1, 0.5),
      footprintRepair: { repaired: footprintRepair.repaired, reason: footprintRepair.reason },
      sourceProjection: sourceProjection.diagnostics,
      guideSnap: guideSnap.diagnostics,
      dimensionAlignment,
      dimensionLock: {
        applied: dimensionLock.applied,
        reason: dimensionLock.reason,
        xApplied: Boolean(dimensionLock.x?.applied),
        yApplied: Boolean(dimensionLock.y?.applied),
        xMeanError: Number.isFinite(dimensionLock.x?.meanError) ? Number(dimensionLock.x.meanError.toFixed(4)) : null,
        yMeanError: Number.isFinite(dimensionLock.y?.meanError) ? Number(dimensionLock.y.meanError.toFixed(4)) : null,
        xConstraintCount: dimensionLock.x?.constraints?.length || 0,
        yConstraintCount: dimensionLock.y?.constraints?.length || 0,
      },
      topology: {
        version: "source_image_global_affine_layout_v15",
        relationshipCount: relationships.length,
        applied: topology.diagnostics.applied,
        snappedPairs: topology.diagnostics.snappedPairs,
        openPairs: topology.diagnostics.openPairs,
        wallPairs: topology.diagnostics.wallPairs,
        removedOpenPlanPartitions: openPlanFiltered.removed,
        addedRelationshipWalls: relationshipWalls.added,
        addedRequiredDoors: requiredDoorPass.added,
        serviceOverlapAdjustments: overlapCleanup.adjustments,
        relationshipResidualMean: Number.isFinite(topology.diagnostics.relationshipResidualMean) ? Number(topology.diagnostics.relationshipResidualMean.toFixed(4)) : null,
        maxShiftMeters: Number(topology.diagnostics.maxShiftMeters.toFixed(4)),
        sourceAnchorMeanShift: Number((topology.diagnostics.sourceAnchorMeanShift || 0).toFixed(4)),
        guardedRelationships: topology.diagnostics.guardedRelationships || 0,
        maxAllowedShiftMeters: topology.diagnostics.maxAllowedShiftMeters || 0.8,
      },
      openings: {
        observations: sourceOpeningObservations,
        observationCoordinateMode: "scene_meters_y_up",
        sharedBoundarySupports: openingSupport.added,
        sourceObservedCount: (raw.openings || []).length,
        preservedCount: finalOpenings.length,
        rejectedObservationIds: (raw.openings || []).filter(o => !finalOpenings.some(f => f.id === String(o.id))).map(o => o.id),
        syntheticCount: 0,
        sourceVerified: false,
      },
      roomContainmentAdjustments,
      furnishing: {
        version: "source_image_observation_validated_v2",
        assetCount: assets.length,
        collisionAware: furnitureValidation.collisionAware,
        doorClearanceAware: furnitureValidation.doorClearanceAware,
        roomTypeAware: true,
        rejectedCount: furnitureValidation.rejected.length,
        completedEssentialCount: furnitureValidation.added.length,
        byType: assets.reduce((acc, a) => {
          const key = String(a?.type || "unknown");
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        essentialFallbackCount: assets.filter((a) => a.essentialFallback).length,
        byRoom: rooms.map((room) => ({
          roomId: room.id,
          type: canonicalRoomType(room),
          assetCount: assets.filter((a) => String(a.roomId) === String(room.id)).length,
          assetTypes: assets.filter((a) => String(a.roomId) === String(room.id)).map((a) => a.type),
        })),
      },
      materialZoning: {
        version: "room_polygon_material_zoning_v20",
        roomFinishCount: rooms.filter((room) => room.floorFinish).length,
      },
      presentation: {
        version: "ventra_architectural_cutaway_v21",
        deterministicFurniture: true,
        darkExternalWalls: true,
        roomSpecificMaterials: true,
        imageGuideSnap: Boolean(guideSnap?.diagnostics?.applied),
        guideSnapScope: "footprint_and_partitions_only",
        targetStyle: "warm_modern_architectural_cutaway",
        openingPlacementMode: "source_axis_and_relationship_attachment_v22"
      },
      note: "Visual interactive preview. Engineering quantities remain on the APS/takeoff pipeline.",
    },
  };
}

function parseJson(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try { return JSON.parse(value); } catch {}
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(value.slice(first, last + 1));
  return null;
}

async function prepareImage(imageUrl, signal) {
  if (!imageUrl) throw Object.assign(new Error("No floor-plan image URL was supplied."), { code: "PREVIEW_NO_IMAGE" });
  const response = await fetch(imageUrl, { cache: "no-store", signal });
  if (!response.ok) throw Object.assign(new Error(`Could not download the floor-plan image (${response.status}).`), { code: "PREVIEW_IMAGE_DOWNLOAD_FAILED" });
  const buffer = Buffer.from(await response.arrayBuffer());
  const image = sharp(buffer, { failOn: "none" });
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
    imageUrl: `data:image/png;base64,${prepared.data.toString("base64")}`,
  };
}


const IMAGE_SCENE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const imageSceneCache =
  globalThis.__ventraImageSceneCacheV20 ||
  (globalThis.__ventraImageSceneCacheV20 = new Map());

function cleanupImageSceneCache() {
  const now = Date.now();
  for (const [key, entry] of imageSceneCache.entries()) {
    if (!entry || entry.expiresAt <= now) imageSceneCache.delete(key);
  }
  while (imageSceneCache.size > 24) {
    const oldest = imageSceneCache.keys().next().value;
    imageSceneCache.delete(oldest);
  }
}

async function runPreview(body) {
  const startedAt = Date.now();
  const diagnostics = {
    format: "ventra-interactive-preview-diagnostic-v2",
    build: VERSION,
    model: MODEL,
    stage: "starting",
    accepted: false,
  };

  try {
    diagnostics.stage = "preparing_image";
    const prepared = await prepareImage(body?.imageUrl);
    diagnostics.imageWidth = prepared.width;
    diagnostics.imageHeight = prepared.height;

    cleanupImageSceneCache();
    const imageHash = createHash("sha256").update(prepared.buffer).digest("hex");
    diagnostics.imageHash = imageHash.slice(0, 16);
    const stableCacheKey = `${VERSION}:${imageHash}`;
    const stableCached = imageSceneCache.get(stableCacheKey);
    if (stableCached?.scene) {
      const cachedScene = JSON.parse(JSON.stringify(stableCached.scene));
      diagnostics.stage = "completed";
      diagnostics.accepted = true;
      diagnostics.cacheHit = true;
      diagnostics.elapsedMs = Date.now() - startedAt;
      diagnostics.roomCount = cachedScene.rooms?.length || 0;
      diagnostics.wallCount = cachedScene.walls?.length || 0;
      diagnostics.openingCount = cachedScene.openings?.length || 0;
      diagnostics.assetCount = cachedScene.assets?.length || 0;
      diagnostics.footprintPointCount = cachedScene.footprint?.length || 0;
      diagnostics.guideSnap = cachedScene.geometryValidation?.guideSnap || null;
      diagnostics.furnishing = cachedScene.geometryValidation?.furnishing || null;
      diagnostics.materialZoning = cachedScene.geometryValidation?.materialZoning || null;
      diagnostics.presentation = cachedScene.geometryValidation?.presentation || null;
      return NextResponse.json({
        scene: cachedScene,
        diagnostics,
        source: "ventra-stable-image-cache-v20",
        routeVersion: VERSION,
        warning: "Visual 3D preview only. APS/engineering geometry remains authoritative for quantities and BOQ."
      });
    }

    const imageEvidence = await prepareRasterImageEvidence(prepared.buffer);
    diagnostics.pixelGuideCount = imageEvidence.guides.length;
    const strokeGuideText = rasterEvidencePrompt(imageEvidence);

    const prompt = `You are reconstructing ONE architectural floor plan into a compact interactive 3D scene graph. Accuracy to the visible plan is more important than decoration.

THIS IS NOT A DESIGN TASK. Do not redesign, improve, simplify, mirror, rotate, add rooms, invent corridors, or reinterpret the plan. Reconstruct what is visibly drawn.

READ THE WHOLE PLAN BEFORE TRACING:
First understand the building layout, entrance, connected spaces, room labels, furniture symbols and outdoor areas together. Then trace architecture and furniture as separate evidence layers. Do not let the stroke guides replace your visual understanding.
For handwritten sketches, room labels may be generic ("Room") and the photograph may be rotated. Read text in its readable orientation to understand meaning, but return ALL coordinates in the original image orientation. A bed symbol can identify a bedroom even when the label is generic. A sofa/TV pair identifies a living use. Counters with a sink or cooker identify kitchen use. Persian/Arabic labels for balcony or terrace identify an outdoor zone; preserve its actual drawn location.
Distinguish physical partitions from furniture edges, leader arrows, handwriting, dimension lines, door leaves and window strokes. An L-shaped sofa or kitchen counter is furniture, never a room boundary. A terrace separator follows the drawn boundary, never a conventional layout you expect.
If a living area and kitchen are visibly one connected open space, represent them as one non-overlapping room of type kitchen_dining or living, or as adjacent use zones with an open relationship. Never add a wall between them. Each observed furniture item belongs to its containing zone regardless of whether that zone's label names the object.
Use room.type for the understood use (bedroom, living, kitchen, kitchen_dining, bathroom, balcony, circulation, storage, laundry); preserve the actual source label in room.name. Do not erase generic or non-English labels.
Where evidence is unclear, lower confidence and omit uncertain objects instead of substituting an invented partition or furnishing. Do not turn uncertain evidence into certainty to produce a complete-looking result.


EVIDENCE PRIORITY, strongest first:
A. Printed overall dimensions and printed room dimensions.
B. Visible heavy wall lines / recesses / projections / entrance notches.
C. Printed room labels.
D. Door/window symbols.
E. Pixel proportions only when no printed dimension exists.

ROOM RULES:
1. Return every visible enclosed space and distinct open-plan use zone, including unlabeled spaces supported by walls or furniture. Use unique IDs even when room names repeat.
2. Do not invent a room without visual evidence. Unlabeled circulation can be recorded when its boundaries are visible.
3. Set labelVisible=true only when the name itself is visibly printed. Otherwise use false and a descriptive inferred name. Both are preserved.
4. Copy visible printed room dimensions into printedWidthMeters/printedDepthMeters. Use 0 only if no dimension is printed for that room.
5. A room polygon must occupy the same location as its visible label and enclosing walls.
5A. Preserve shared room boundaries: if two labeled rooms visibly meet at one wall line, use the SAME coordinate for that shared boundary. Do not center each room independently.
5B. Copy printed room dimensions accurately, but DO NOT resize or relocate a room to force those numbers. The room polygon must follow the visible source-image walls. Printed dimensions are used by the server as validation evidence after one global transform.

RELATIONSHIP RULES:
5C. Return relationships for every pair of labeled rooms that visibly touch or directly open into each other.
5D. relation="open" means there is NO physical wall between the two zones (for example a truly open living + dining/kitchen zone).
5E. relation="wall" means the rooms share a continuous physical wall. relation="door" means the shared physical boundary contains a visible doorway. relation="separate" means they do not directly touch.
5F. direction is the visible relative location of roomB from roomA in the source image. Do not invent adjacency merely because two labels are close.

FOOTPRINT RULES:
6. footprint is the REAL OUTER FACE of the building, not the page rectangle, not a bounding box. Include all recesses/notches/projections, especially entrance cut-ins and side setbacks.
7. Do not make footprint rectangular if the visible building outline is not rectangular. A 4-point footprint is allowed ONLY when all four outer sides are visibly continuous straight boundaries with no setback, notch, projection or entrance cut-in.
8. Inspect the TOP, RIGHT, BOTTOM and LEFT outer boundary independently before emitting footprint vertices. Every change of direction in the visible exterior wall requires a footprint vertex.
9. widthMeters/depthMeters are the overall architectural extents from printed dimensions when available.
9A. The exterior footprint MUST include unlabeled circulation, entrance and open-plan floor area. Never derive or shrink the outer shell from the union of labeled rooms.

PARTITION RULES:
10. partitions contains ONLY physical interior wall centerlines that are visibly present.
11. Do not place a partition merely because two room labels differ. Open-plan living/dining/kitchen zones can share one open space.
12. Partition endpoints must terminate on another physical wall or the footprint, except where a visible doorway gap interrupts it.
12A. Unlabeled circulation is NOT an excuse to omit walls. If a corridor, passage or service strip is visibly bounded by walls, return those walls in partitions and include its visible circulation zone.
12B. Preserve TV/service-core nib walls, corridor separator walls and short return walls when they are physically drawn. A missing separator wall is a geometry error.
12C. Do not create a doorway gap unless a visible door leaf / swing arc / opening symbol supports it. Continuous wall line means continuous wall.

OPENING RULES:
13. Return ALL visible doors AND ALL visible windows. Count them separately before answering. A window must not disappear merely because it sits inside a thick exterior wall.
14. Return visible doors and windows only. Put each opening center on or very near its supporting wall.
15. Doors must correspond to visible swing/opening symbols. Windows must correspond to visible window symbols.
15A. Before returning a door, verify that it sits on the wall actually interrupted by the swing symbol. Never assign a door to a nearby parallel wall merely because it is spatially close.
15C. wallAxis describes the supporting wall as drawn in the source image, NOT the swung door leaf: horizontal, vertical, diagonal, or unknown only if genuinely unclear. Set wallIdHint to the matching partition id when identifiable.
15D. hingeSide must identify the hinge in SOURCE IMAGE coordinates: left, right, top, bottom or unknown. swingDirection must be clockwise or counterclockwise as drawn in the image (Y down), or unknown. Do not guess a hinge or swing.
15E. Only return heightMeters and sillHeightMeters from explicit vertical dimension annotations; never infer them from the plan symbol size. Use -1 for an unknown vertical dimension. A dimensioned floor-level window may have sillHeightMeters=0.
15B. If a visible swing symbol interrupts a wall, include that door even when one side is an unlabeled corridor or passage.

COORDINATES:
16. coordinateMode MUST be "image_normalized". Every footprint / room / partition / opening coordinate is normalized to the SOURCE IMAGE: x=0 left image edge, x=1 right image edge, y=0 top image edge, y=1 bottom image edge. Preserve the SOURCE IMAGE geometry and proportions exactly; do not compensate for printed dimensions by stretching one axis.
16A. Do NOT convert individual rooms to metres. Preserve their visible image positions and shared boundaries. The server applies ONE global image-to-metre transform to the entire plan.
16B. widthMeters/depthMeters still contain the printed overall architectural dimensions in metres when visible.
17. Keep every coordinate between 0 and 1. The footprint should tightly trace the actual exterior walls, not the page margins.

FINAL SELF-CHECK BEFORE ANSWERING:
- Account for every visible space; verify no zone is lost merely because it has no printed label.
- Trace the outer boundary clockwise and verify every visible recess/projection is present. If the footprint has only 4 points, explicitly re-check whether every outer side is truly straight before answering.
- Compare bedroom/bath/store positions to their labels.
- Verify the main entrance is on the same side and same notch as the source.
- Verify no invented corridor/hall room exists.
- Verify relationships includes every directly touching labeled-room pair and correctly distinguishes OPEN from WALL/DOOR adjacency.
- Verify no wall crosses through a room that is visibly open-plan.
- Count visible window symbols and door swing symbols and ensure openings contains both categories.

Trace ALL visible furniture into furniture, including toilets, basins, shower trays and washing_machine symbols in laundry rooms. Do not add a shower to a WC when no shower symbol or explicit shower label exists. Trace ALL visible furniture into furniture; do not invent objects or substitute a generic room furnishing profile. Include dining tables with each visible chair, coffee tables, rugs, kitchen counter runs and embedded fixtures, beds and wardrobes. Include unlabeled spaces (balcony, circulation, dining, study) as separate zones when supported by visible boundaries/use. Room IDs must be unique; names need not be unique. Do not combine zones into overlapping room polygons.
Each furniture item is an oriented rectangle: backLeft/backRight are the ends of its BACK edge and frontCenter is the midpoint of its FRONT edge. Use normalized FULL-IMAGE coordinates, like the walls. Either ordering of the back-edge endpoints is accepted; frontCenter determines the facing direction. Bed back is its headboard; sofa back is its backrest; TV front faces viewers. Other objects face their access side. Trace L-shaped sofas and L/U kitchen counters as multiple non-overlapping rectangular components sharing groupId. Use one sofa component for each leg. Keep every component at its observed location. Never fill the empty corner of an L shape with a bounding rectangle. Empty groupId for single objects. embeddedInCounter=true only for a sink/stove drawn in a counter. Confidence below 0.65 is rejected for review. Heights/materials are visual defaults, not measured evidence.

DETERMINISTIC PIXEL-STROKE EVIDENCE FROM THE SAME IMAGE:
${strokeGuideText}
Treat these guides as supporting evidence only. They are especially useful for locating long physical wall runs and recess corners, but they can include furniture/text and can omit walls interrupted by openings. Do not blindly copy them.

Return only the strict schema.`;

    diagnostics.stage = "model_request";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await getOpenAIClient().responses.create({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `${prompt}\n\nSource image size: ${prepared.width}x${prepared.height}px (reference only).` },
            { type: "input_image", image_url: prepared.imageUrl, detail: "high" },
          ],
        }],
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "ventra_interactive_plan_scene_v2", strict: true, schema: sceneSchema },
        },
      }, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error("Interactive preview timed out."), { code: "PREVIEW_TIMEOUT" });
      throw error;
    } finally {
      clearTimeout(timer);
    }

    diagnostics.responseId = response?.id || null;
    diagnostics.status = response?.status || null;
    diagnostics.usage = response?.usage || null;
    diagnostics.incompleteDetails = response?.incomplete_details || null;

    const outputText = String(response?.output_text || "").trim();
    if (!outputText) {
      const reason = response?.incomplete_details?.reason || response?.status || "no_text";
      throw Object.assign(new Error(`Preview model returned no scene JSON (${reason}).`), { code: "PREVIEW_EMPTY_OUTPUT" });
    }

    diagnostics.stage = "normalizing_scene";
    const raw = parseJson(outputText);
    if (!raw) throw Object.assign(new Error("Preview scene JSON could not be parsed."), { code: "PREVIEW_JSON_PARSE_FAILED" });
    let scene = normalizeScene(raw, { width: prepared.width, height: prepared.height }, imageEvidence);
    // Separate visual attention to fixtures from the much larger wall/room task.
    // Only furniture is returned; all architecture remains fixed.
    diagnostics.stage = "source_furniture_review";
    const remainingMs = Math.min(60000, TIMEOUT_MS - (Date.now() - startedAt));
    if (remainingMs > 5000) {
      const furnitureController = new AbortController();
      const furnitureTimer = setTimeout(() => furnitureController.abort(), remainingMs);
      try {
        const reviewResponse = await getOpenAIClient().responses.create({
          model: MODEL, reasoning: { effort: REASONING_EFFORT }, max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [{role:"user",content:[
            {type:"input_text",text:`Review ONLY furniture and fixtures in this original floor plan. Read Persian, Arabic and English labels. Return ALL visible objects, not a generic furnished design. The attached fixed scene supplies room IDs and metre/Y-up polygons; use these IDs. Return coordinates normalized to the FULL ORIGINAL IMAGE, Y down. backLeft/backRight are BACK-edge endpoints; frontCenter is the midpoint of the FRONT edge. For beds the back is the pillow/headboard edge: trace the whole bed and preserve its position and facing. Split every L/U sofa or counter into non-overlapping rectangles sharing groupId, one rectangle per leg. Do not drop the shorter leg or fill its empty corner. Trace each visible toilet, basin, shower and washing-machine symbol, including narrow laundry rooms labeled رخت‌شوی‌خانه, لباس‌شویی, laundry or غرفة غسيل. A square with a circle inside may be a washing machine or basin: use its room and other symbols to distinguish them. Do not infer a shower from WC alone. Do not add refrigerators, wardrobes or fixtures absent from the drawing. Confidence below .65 must remain uncertain. Do not modify walls, rooms, doors or windows. Fixed scene: ${JSON.stringify({width:scene.width,depth:scene.depth,sourceBounds:scene.geometryValidation.sourceProjection.sourceBounds,rooms:scene.rooms})}`},
            {type:"input_image",image_url:prepared.imageUrl,detail:"high"}
          ]}],
          text:{format:{type:"json_schema",name:"source_furniture_coverage",strict:true,schema:{type:"object",additionalProperties:false,required:["furniture"],properties:{furniture:sceneSchema.properties.furniture}}}}
        },{signal:furnitureController.signal});
        if(reviewResponse.status!=="completed")throw new Error("Furniture review did not complete.");
        const reviewed=parseJson(reviewResponse.output_text||"");
        if(!Array.isArray(reviewed?.furniture))throw new Error("Furniture review returned invalid observations.");
        const reviewedScene=applySourceFurnitureReview(scene,reviewed.furniture);
        // A failed/empty pass must not silently erase the first pass.
        if(!reviewedScene.assets.length&&scene.assets.length)throw new Error("Furniture review found no validated objects.");
        for(const prior of scene.assets){
          const before=scene.assets.filter(a=>a.roomId===prior.roomId&&a.type===prior.type).length;
          const after=reviewedScene.assets.filter(a=>a.roomId===prior.roomId&&a.type===prior.type).length;
          if(after<before)throw new Error(`Furniture review lost source objects in room ${prior.roomId}; the first trace was preserved.`);
        }
        scene=reviewedScene;
        diagnostics.furnitureReview={responseId:reviewResponse.id,usage:reviewResponse.usage,status:"completed"};
      } catch(error) {
        scene={...scene,furnishingReview:{...scene.furnishingReview,requiresReview:true,coverageReview:{status:"failed",reason:error?.message||"Furniture review failed"}}};
        diagnostics.furnitureReview={status:"failed",message:error?.message};
      } finally {clearTimeout(furnitureTimer);}
    } else {
      scene={...scene,furnishingReview:{...scene.furnishingReview,requiresReview:true,coverageReview:{status:"skipped",reason:"analysis_time_budget"}}};
    }

    diagnostics.stage = "completed";
    diagnostics.accepted = true;
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.roomCount = scene.rooms.length;
    diagnostics.wallCount = scene.walls.length;
    diagnostics.openingCount = scene.openings.length;
    diagnostics.assetCount = scene.assets.length;
    diagnostics.footprintPointCount = scene.footprint.length;
    diagnostics.footprintRepair = scene.geometryValidation?.footprintRepair || null;
    diagnostics.sourceProjection = scene.geometryValidation?.sourceProjection || null;
    diagnostics.guideSnap = scene.geometryValidation?.guideSnap || null;
    diagnostics.dimensionLock = scene.geometryValidation?.dimensionLock || null;
    diagnostics.topology = scene.geometryValidation?.topology || null;
    diagnostics.roomContainmentAdjustments = scene.geometryValidation?.roomContainmentAdjustments || 0;
    diagnostics.furnishing = scene.geometryValidation?.furnishing || null;
    diagnostics.materialZoning = scene.geometryValidation?.materialZoning || null;
    diagnostics.presentation = scene.geometryValidation?.presentation || null;

    imageSceneCache.set(stableCacheKey, {
      scene: JSON.parse(JSON.stringify(scene)),
      expiresAt: Date.now() + IMAGE_SCENE_CACHE_TTL_MS,
    });

    return NextResponse.json({
      scene,
      diagnostics,
      source: "openai-interactive-preview-consolidated-v20",
      routeVersion: VERSION,
      warning: "Visual 3D preview only. APS/engineering geometry remains authoritative for quantities and BOQ.",
    });
  } catch (error) {
    diagnostics.stage = "failed";
    diagnostics.elapsedMs = Date.now() - startedAt;
    diagnostics.error = error?.message || String(error);
    diagnostics.failure = { code: error?.code || "INTERACTIVE_PREVIEW_FAILED", message: diagnostics.error };
    console.warn("[VENTRA INTERACTIVE PREVIEW V2 REJECTED]", diagnostics);
    const status = error?.status === 429 ? 429 : error?.code === "PREVIEW_TIMEOUT" ? 504 : 422;
    return NextResponse.json({
      error: diagnostics.error,
      code: diagnostics.failure.code,
      diagnostics,
      routeVersion: VERSION,
    }, { status });
  }
}

const PREVIEW_JOB_TTL_MS = 2 * 60 * 1000;
const previewInFlight = globalThis.__ventraPreviewInFlightV4 || (globalThis.__ventraPreviewInFlightV4 = new Map());
const previewCompleted = globalThis.__ventraPreviewCompletedV4 || (globalThis.__ventraPreviewCompletedV4 = new Map());

function cleanupPreviewCache() {
  const now = Date.now();
  for (const [key, entry] of previewCompleted.entries()) {
    if (!entry || entry.expiresAt <= now) previewCompleted.delete(key);
  }
}

async function runFurnitureRepair(body) {
 const scene=body?.scene;
 try {
  const review=scene?.furnishingReview;
  if(!review?.observations?.length||!scene.geometryValidation?.sourceProjection?.sourceBounds)throw new Error("Source observations are unavailable for this scene.");
  const prepared=await prepareImage(body.imageUrl);
  const projection=scene.geometryValidation.sourceProjection;
  if(prepared.width!==projection.imageWidth||prepared.height!==projection.imageHeight)throw new Error("Choose the original plan image with the same dimensions.");
  const ids=new Set((review.rejected||[]).map(x=>x.id));
  const targets=review.observations.filter(o=>ids.has(o.id));
  if(!targets.length)return NextResponse.json({scene,repairedCount:0});
  const schema={"type": "object", "additionalProperties": false, "required": ["items"], "properties": {"items": {"type": "array", "maxItems": 80, "items": {"type": "object", "additionalProperties": false, "required": ["left", "right", "top", "bottom", "confidence", "id", "front"], "properties": {"left": {"type": "number"}, "right": {"type": "number"}, "top": {"type": "number"}, "bottom": {"type": "number"}, "confidence": {"type": "number"}, "id": {"type": "string"}, "front": {"type": "string", "enum": ["left", "right", "top", "bottom"]}}}}}};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);let response;
  try {response=await getOpenAIClient().responses.create({model:MODEL,reasoning:{effort:"none"},max_output_tokens:5000,input:[{role:"user",content:[{type:"input_text",text:`Locate ONLY the listed rejected furniture in the original plan. Return full-image normalized bounding rectangles and the direction their FRONT faces in image coordinates (Y down). Trace the WHOLE bed, not a pillow. Bed front points from headboard toward foot. Sofa front points from backrest to seating. TV front faces viewers. Counters front faces the room. Preserve exact source positions, no redesign. For components of the same L sofa/counter, rectangles must meet at the corner without overlapping area. Do not invent missing objects; omit uncertain objects. Use the exact supplied IDs. Do not return or modify architecture. The fixed room/wall coordinates are metres Y-up, mapped using sourceBounds and scene width/depth. Targets: ${JSON.stringify(targets)}. Fixed alignment: ${JSON.stringify(projection)}. Width/depth: ${scene.width},${scene.depth}. Rooms: ${JSON.stringify(scene.rooms)}. Walls: ${JSON.stringify(scene.walls)}.`},{type:"input_image",image_url:prepared.imageUrl,detail:"high"}]}],text:{format:{type:"json_schema",name:"fixed_furniture_repair",strict:true,schema}}},{signal:controller.signal});}finally{clearTimeout(timer);}
  if(response.status!=="completed")throw new Error("Furniture extraction did not complete. The current scene was preserved.");
  const raw=parseJson(response.output_text||"");if(!Array.isArray(raw?.items))throw new Error("Furniture response was invalid.");
  const next=repairFixedFurniture(scene,raw.items);
  return NextResponse.json({scene:next,repairedCount:next.furnishingReview.repair.repairedIds.length});
 }catch(error){return NextResponse.json({error:error?.message||"Furniture repair failed; current scene preserved."},{status:422});}
}

async function handleCommercialRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Preview request body was empty or invalid JSON.", code: "PREVIEW_BAD_REQUEST" }, { status: 400 });
  }

  if(body?.mode === "repair_furniture") return runFurnitureRepair(body);
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

  const task = runPreview(body);
  previewInFlight.set(cacheKey, task);
  try {
    const response = await task;
    previewCompleted.set(cacheKey, { response: response.clone(), expiresAt: Date.now() + PREVIEW_JOB_TTL_MS });
    return response;
  } finally {
    if (previewInFlight.get(cacheKey) === task) previewInFlight.delete(cacheKey);
  }
}

export async function runPreviewRequest(request){return commercialRun(request,'preview',handleCommercialRequest);}

export async function previewImageFingerprint(imageUrl){
 const prepared=await prepareImage(imageUrl,AbortSignal.timeout(12000));
 return {hash:createHash('sha256').update(prepared.buffer).digest('hex').slice(0,16),version:VERSION};
}
