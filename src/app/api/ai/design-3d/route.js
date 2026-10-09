import {commercialRun} from '@/lib/serverCommercial';
import { NextResponse } from "next/server";
import { createResponse, getOpenAIClient } from "@/services/openaiClient";
import sharp from "sharp";
import { requestRasterVision, consumeRasterVisionStream, shouldRetryRasterGeometry } from "@/lib/rasterVisionRequest.mjs";
import { compileRasterFloorplan, rasterFloorplanSchema, rasterPixelTraceSchema, normalizeRasterPixelTrace, RasterGeometryError, RASTER_GEOMETRY_VERSION } from "@/lib/rasterFloorplanGeometry.mjs";
import { prepareRasterImageEvidence, rasterEvidencePrompt, inspectRasterImageEvidence, requireRasterImageEvidence } from "@/lib/rasterImageEvidence.mjs";


const OPENAI_SOFT_TIMEOUT_MS = 30000;
const OPENAI_SCHEMATIC_TOPOLOGY_TIMEOUT_MS = 120000;
const OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS = 240000;
const OPENAI_SCHEMATIC_OPTIONAL_TIMEOUT_MS = 70000;
const VENTRA_JPG_FLOORPLAN_ROUTE_VERSION = "generic-floorplan-engine-v53-single-flight-timeout-resilient";
const RASTER_TRACE_BUILD = "raster-localized-evidence-20260918";
const RASTER_TRACE_MAX_ATTEMPTS = 2;

async function withSoftTimeout(promise, timeoutMs = OPENAI_SOFT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("OpenAI design request timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_DESIGN = {
  style: "modern neutral",
  palette: {
    interiorWall: "#E7E1D8",
    facade: "#D8D0C3",
    floor: "#C9B89F",
    ceiling: "#F5F2EA",
    door: "#6E4A32",
    glass: "#7896AA",
    accent: "#403D39",
  },
  floorFinish: "warm stone",
  facadeFinish: "smooth mineral finish",
  wallShininess: 18,
  facadeShininess: 12,
  floorShininess: 28,
  glassOpacity: 0.48,
  features: {
    floorFinish: true,
    baseboards: true,
    ceiling: false,
    facadeBand: false,
  },
};


async function prepareVisionImage(imageUrl, { maxDimension = 1600, quality = 88 } = {}) {
  const response = await fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(45000) });

  if (!response.ok) {
    throw new Error(`Could not download floor-plan image (${response.status}).`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());

  const { data: optimizedBuffer, info } = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  return {
    imageUrl: `data:image/jpeg;base64,${optimizedBuffer.toString("base64")}`,
    width: info.width,
    height: info.height,
    buffer: optimizedBuffer,
  };
}

function roomBounds(room) {
  const points = Array.isArray(room?.polygon) ? room.polygon : [];
  if (points.length < 3) return null;
  const xs = points.map((p) => Number(p?.x)).filter(Number.isFinite);
  const ys = points.map((p) => Number(p?.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function enrichFloorPlanAssets(scene) {
  if (!scene || !Array.isArray(scene.rooms) || scene.rooms.length === 0) return scene;
  // V42 fidelity rule: never synthesize furniture or sanitary fixtures.
  // Assets must come from the image-grounded vision analysis only.
  return {
    ...scene,
    assets: Array.isArray(scene.assets) ? scene.assets.slice(0, 120) : [],
  };
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "").trim())
    ? String(value).toUpperCase()
    : fallback;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeDesign(input = {}) {
  const palette = input?.palette || {};
  const features = input?.features || {};

  return {
    style: String(input?.style || DEFAULT_DESIGN.style).slice(0, 80),
    palette: {
      interiorWall: safeColor(palette.interiorWall, DEFAULT_DESIGN.palette.interiorWall),
      facade: safeColor(palette.facade, DEFAULT_DESIGN.palette.facade),
      floor: safeColor(palette.floor, DEFAULT_DESIGN.palette.floor),
      ceiling: safeColor(palette.ceiling, DEFAULT_DESIGN.palette.ceiling),
      door: safeColor(palette.door, DEFAULT_DESIGN.palette.door),
      glass: safeColor(palette.glass, DEFAULT_DESIGN.palette.glass),
      accent: safeColor(palette.accent, DEFAULT_DESIGN.palette.accent),
    },
    floorFinish: String(input?.floorFinish || DEFAULT_DESIGN.floorFinish).slice(0, 80),
    facadeFinish: String(input?.facadeFinish || DEFAULT_DESIGN.facadeFinish).slice(0, 80),
    wallShininess: clamp(input?.wallShininess, 0, 100, DEFAULT_DESIGN.wallShininess),
    facadeShininess: clamp(input?.facadeShininess, 0, 100, DEFAULT_DESIGN.facadeShininess),
    floorShininess: clamp(input?.floorShininess, 0, 100, DEFAULT_DESIGN.floorShininess),
    glassOpacity: clamp(input?.glassOpacity, 0.2, 0.85, DEFAULT_DESIGN.glassOpacity),
    features: {
      floorFinish: features.floorFinish !== false,
      baseboards: features.baseboards !== false,
      ceiling: features.ceiling === true,
      facadeBand: features.facadeBand === true,
    },
  };
}

function fallbackDesign(prompt) {
  const text = String(prompt || "").toLowerCase();
  const design = structuredClone(DEFAULT_DESIGN);

  if (/(luxury|لوکس|luxurious)/i.test(text)) {
    design.style = "modern luxury";
    design.palette.interiorWall = "#EEE6D8";
    design.palette.floor = "#D6C5AA";
    design.palette.door = "#5C3C2B";
    design.palette.accent = "#2E2B28";
    design.floorFinish = "beige marble";
    design.facadeFinish = "light stone cladding";
    design.floorShininess = 52;
  }

  if (/(minimal|مینیمال|scandinav|اسکاند)/i.test(text)) {
    design.style = "warm minimal";
    design.palette.interiorWall = "#E9E5DC";
    design.palette.floor = "#C9A97D";
    design.palette.door = "#9A7654";
    design.palette.facade = "#D9D2C5";
    design.floorFinish = "natural oak";
    design.floorShininess = 14;
  }

  if (/(black|charcoal|مشکی|ذغالی)/i.test(text)) {
    design.palette.accent = "#25282B";
  }
  if (/(white|سفید)/i.test(text)) {
    design.palette.interiorWall = "#F2F1EC";
  }
  if (/(wood|walnut|oak|چوب|گردو)/i.test(text)) {
    design.palette.door = "#66452F";
  }
  if (/(stone|limestone|سنگ|تراورتن)/i.test(text)) {
    design.palette.facade = "#D6CABB";
    design.facadeFinish = "natural stone";
  }
  if (/(marble|مرمر|ماربل)/i.test(text)) {
    design.palette.floor = "#D8D0C5";
    design.floorFinish = "marble";
    design.floorShininess = 58;
  }
  if (/(ceiling|سقف)/i.test(text)) {
    design.features.ceiling = true;
  }
  if (/(band|خط افقی|فریم نما|accent facade|facade accent)/i.test(text)) {
    design.features.facadeBand = true;
  }

  return design;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON design object returned.");
  return JSON.parse(unfenced.slice(first, last + 1));
}



const SCHEMATIC_ASSET_TYPES = [
  "bathtub", "sink", "faucet", "shower", "toilet", "bed", "wardrobe",
  "nightstand", "sofa", "armchair", "coffee_table", "dining_table", "chair",
  "tv_unit", "kitchen_counter", "kitchen_island", "cabinet", "desk", "generic",
  "refrigerator", "stove", "washing_machine", "mirror",
];

const pointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
};

const schematicSceneSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sceneType", "title", "width", "depth", "height", "palette",
    "footprint", "holes", "rooms", "walls", "openings", "assets",
  ],
  properties: {
    sceneType: { type: "string" },
    title: { type: "string" },
    width: { type: "number" },
    depth: { type: "number" },
    height: { type: "number" },
    palette: {
      type: "object",
      additionalProperties: false,
      required: ["wall", "floor", "ceiling", "accent", "glass", "door"],
      properties: {
        wall: { type: "string" },
        floor: { type: "string" },
        ceiling: { type: "string" },
        accent: { type: "string" },
        glass: { type: "string" },
        door: { type: "string" },
      },
    },
    footprint: {
      type: "array",
      minItems: 3,
      items: pointSchema,
    },
    holes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "polygon"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["shaft", "void", "courtyard", "opening"] },
          polygon: { type: "array", minItems: 3, items: pointSchema },
        },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "polygon"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          polygon: {
            type: "array",
            minItems: 3,
            items: pointSchema,
          },
        },
      },
    },
    walls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "start", "end"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["external", "internal"] },
          start: pointSchema,
          end: pointSchema,
        },
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "wallId", "offset", "width", "height", "sillHeight", "hinge", "swing"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["door", "window"] },
          wallId: { type: "string" },
          offset: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          sillHeight: { type: "number" },
          hinge: { type: "string" },
          swing: { type: "string" },
        },
      },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "x", "y", "width", "depth", "height", "rotation"],
        properties: {
          type: { type: "string", enum: SCHEMATIC_ASSET_TYPES },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          depth: { type: "number" },
          height: { type: "number" },
          rotation: { type: "number" },
        },
      },
    },
  },
};


const normalizedImagePointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
};

const genericFloorPlanGeometrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "confidence",
    "widthMeters",
    "depthMeters",
    "planBounds",
    "footprint",
    "holes",
    "rooms",
    "walls",
    "openings",
    "assets",
  ],
  properties: {
    title: { type: "string" },
    confidence: { type: "number" },
    widthMeters: { type: "number" },
    depthMeters: { type: "number" },
    planBounds: {
      type: "object",
      additionalProperties: false,
      required: ["minX", "minY", "maxX", "maxY"],
      properties: {
        minX: { type: "number" },
        minY: { type: "number" },
        maxX: { type: "number" },
        maxY: { type: "number" },
      },
    },
    footprint: {
      type: "array",
      minItems: 3,
      items: normalizedImagePointSchema,
    },
    holes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "polygon"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["shaft", "void", "courtyard", "opening"] },
          polygon: {
            type: "array",
            minItems: 3,
            items: normalizedImagePointSchema,
          },
        },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "polygon"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          polygon: {
            type: "array",
            minItems: 3,
            items: normalizedImagePointSchema,
          },
        },
      },
    },
    walls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "start", "end"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["external", "internal"] },
          start: normalizedImagePointSchema,
          end: normalizedImagePointSchema,
        },
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "wallId",
          "center",
          "widthMeters",
          "heightMeters",
          "sillHeightMeters",
          "hingeSide",
          "swingDirection"
        ],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["door", "window"] },
          wallId: { type: "string" },
          center: normalizedImagePointSchema,
          widthMeters: { type: "number" },
          heightMeters: { type: "number" },
          sillHeightMeters: { type: "number" },
          hingeSide: { type: "string" },
          swingDirection: { type: "string" },
        },
      },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "center",
          "widthMeters",
          "depthMeters",
          "heightMeters",
          "rotation",
          "roomHint"
        ],
        properties: {
          type: { type: "string", enum: SCHEMATIC_ASSET_TYPES },
          center: normalizedImagePointSchema,
          widthMeters: { type: "number" },
          depthMeters: { type: "number" },
          heightMeters: { type: "number" },
          rotation: { type: "number" },
          roomHint: { type: "string" },
        },
      },
    },
  },
};

const ventraFloorPlanTopologySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "confidence", "widthMeters", "depthMeters", "planBounds", "rooms", "adjacencies", "junctions", "expectedOpenings"],
  properties: {
    title: { type: "string" },
    confidence: { type: "number" },
    widthMeters: { type: "number" },
    depthMeters: { type: "number" },
    planBounds: {
      type: "object", additionalProperties: false,
      required: ["minX", "minY", "maxX", "maxY"],
      properties: { minX: { type: "number" }, minY: { type: "number" }, maxX: { type: "number" }, maxY: { type: "number" } },
    },
    rooms: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "name", "type", "labelCenter", "printedWidthMeters", "printedDepthMeters"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, type: { type: "string" },
          labelCenter: normalizedImagePointSchema,
          printedWidthMeters: { type: ["number", "null"] },
          printedDepthMeters: { type: ["number", "null"] },
        },
      },
    },
    adjacencies: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["roomAId", "roomBId", "relation"],
        properties: {
          roomAId: { type: "string" },
          roomBId: { type: "string" },
          relation: { type: "string", enum: ["shared_wall", "open_boundary", "door_connection"] },
        },
      },
    },
    junctions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["center", "kind"],
        properties: {
          center: normalizedImagePointSchema,
          kind: { type: "string", enum: ["corner", "T", "X"] },
        },
      },
    },
    expectedOpenings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "center", "roomAId", "roomBId"],
        properties: {
          kind: { type: "string", enum: ["door", "window"] },
          center: normalizedImagePointSchema,
          roomAId: { type: ["string", "null"] },
          roomBId: { type: ["string", "null"] },
        },
      },
    },
  },
};

function ventraAssertStrictJsonSchema(schema, path = "root") {
  if (!schema || typeof schema !== "object") return;

  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const propertyKeys = Object.keys(schema.properties);
    const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
    const missing = propertyKeys.filter((key) => !requiredKeys.includes(key));
    if (missing.length) {
      throw new Error(`Invalid strict JSON schema at ${path}: required is missing ${missing.join(", ")}.`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      ventraAssertStrictJsonSchema(child, `${path}.${key}`);
    }
  }

  if (schema.type === "array" && schema.items) {
    ventraAssertStrictJsonSchema(schema.items, `${path}[]`);
  }
}

// Fail locally before making an OpenAI request if a future edit breaks strict
// structured-output requirements. This prevents another opaque HTTP 400 loop.
ventraAssertStrictJsonSchema(schematicSceneSchema, "schematicSceneSchema");
ventraAssertStrictJsonSchema(genericFloorPlanGeometrySchema, "genericFloorPlanGeometrySchema");
ventraAssertStrictJsonSchema(ventraFloorPlanTopologySchema, "ventraFloorPlanTopologySchema");
ventraAssertStrictJsonSchema(rasterFloorplanSchema, "rasterFloorplanSchema");
ventraAssertStrictJsonSchema(rasterPixelTraceSchema, "rasterPixelTraceSchema");


function ventraPlanBounds(input = {}) {
  const minX = clamp(input?.minX, 0, 1000, 0);
  const minY = clamp(input?.minY, 0, 1000, 0);
  const maxX = clamp(input?.maxX, 0, 1000, 1000);
  const maxY = clamp(input?.maxY, 0, 1000, 1000);
  if (maxX - minX < 80 || maxY - minY < 80) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  }
  return { minX, minY, maxX, maxY };
}

function ventraImagePointToMeters(point, bounds, widthMeters, depthMeters) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const px = clamp(point?.x, bounds.minX, bounds.maxX, bounds.minX);
  const py = clamp(point?.y, bounds.minY, bounds.maxY, bounds.minY);

  return {
    x: ((px - bounds.minX) / spanX) * widthMeters,
    // Vision coordinates use a top-left origin. The 3D scene uses a
    // conventional bottom-left plan origin, so Y must be flipped once here.
    // Rooms, walls, openings, footprint and furniture all pass through this
    // function, keeping every layer registered to the same metric frame.
    y: depthMeters - ((py - bounds.minY) / spanY) * depthMeters,
  };
}

function ventraProjectPointToSegment(point, start, end) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq < 1e-8) {
    return { t: 0, point: { ...start }, distance: Math.hypot(point.x - start.x, point.y - start.y) };
  }
  const rawT = ((point.x - start.x) * vx + (point.y - start.y) * vy) / lengthSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: start.x + vx * t, y: start.y + vy * t };
  return { t, point: projected, distance: Math.hypot(point.x - projected.x, point.y - projected.y) };
}

function ventraPolygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += Number(a?.x || 0) * Number(b?.y || 0) - Number(b?.x || 0) * Number(a?.y || 0);
  }
  return Math.abs(area) / 2;
}


function ventraConvexHull(points = []) {
  const unique = [];
  const seen = new Set();

  for (const point of Array.isArray(points) ? points : []) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ x, y });
  }

  if (unique.length < 3) return unique;

  unique.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) -
    (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function ventraFootprintContainment(sceneLike = {}) {
  const footprint =
    Array.isArray(sceneLike?.footprint)
      ? sceneLike.footprint
      : [];

  const rooms =
    Array.isArray(sceneLike?.rooms)
      ? sceneLike.rooms
      : [];

  if (footprint.length < 3 || !rooms.length) {
    return {
      roomCentroidRatio: 0,
      roomVertexRatio: 0,
    };
  }

  let centroidTotal = 0;
  let centroidInside = 0;
  let vertexTotal = 0;
  let vertexInside = 0;

  for (const room of rooms) {
    const polygon =
      Array.isArray(room?.polygon)
        ? room.polygon
        : [];

    if (polygon.length < 3) continue;

    const centroid =
      ventraPolygonCentroid(polygon);

    centroidTotal += 1;
    if (ventraPointInPolygon(centroid, footprint)) {
      centroidInside += 1;
    }

    for (const point of polygon) {
      vertexTotal += 1;
      if (ventraPointInPolygon(point, footprint)) {
        vertexInside += 1;
      }
    }
  }

  return {
    roomCentroidRatio:
      centroidTotal
        ? centroidInside / centroidTotal
        : 0,
    roomVertexRatio:
      vertexTotal
        ? vertexInside / vertexTotal
        : 0,
  };
}


function ventraBuildExternalWallLoop(walls = [], tolerance = 0.18) {
  const external = (Array.isArray(walls) ? walls : []).filter(
    (wall) =>
      String(wall?.type || "").toLowerCase() === "external" &&
      wall?.start &&
      wall?.end
  );

  if (external.length < 3) return [];

  const pointKey = (point) => {
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    return `${Math.round(x / tolerance)}:${Math.round(y / tolerance)}`;
  };

  const nodes = new Map();

  const addEdge = (from, to) => {
    const key = pointKey(from);
    if (!nodes.has(key)) {
      nodes.set(key, {
        point: { x: Number(from?.x) || 0, y: Number(from?.y) || 0 },
        next: [],
      });
    }
    nodes.get(key).next.push({
      point: { x: Number(to?.x) || 0, y: Number(to?.y) || 0 },
      key: pointKey(to),
    });
  };

  for (const wall of external) {
    addEdge(wall.start, wall.end);
    addEdge(wall.end, wall.start);
  }

  let best = [];

  for (const [startKey, startNode] of nodes) {
    const stack = [{
      key: startKey,
      pathKeys: [startKey],
      pathPoints: [startNode.point],
    }];

    while (stack.length) {
      const current = stack.pop();
      if (!current || current.pathKeys.length > external.length + 4) continue;

      const node = nodes.get(current.key);
      if (!node) continue;

      for (const edge of node.next) {
        if (
          edge.key === startKey &&
          current.pathPoints.length >= 3
        ) {
          const candidate = current.pathPoints.slice();
          if (ventraPolygonArea(candidate) > ventraPolygonArea(best)) {
            best = candidate;
          }
          continue;
        }

        if (current.pathKeys.includes(edge.key)) continue;

        stack.push({
          key: edge.key,
          pathKeys: current.pathKeys.concat(edge.key),
          pathPoints: current.pathPoints.concat(edge.point),
        });
      }
    }
  }

  return best;
}

function ventraSanitizeFootprint({ footprint, rooms, walls, widthMeters, depthMeters }) {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const assess = (candidate, source) => {
    const poly = Array.isArray(candidate) ? candidate.filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))).slice(0, 128) : [];
    if (poly.length < 3 || ventraPolygonArea(poly) < 1) return null;
    const containment = ventraFootprintContainment({ footprint: poly, rooms: roomList });
    const area = ventraPolygonArea(poly);
    const roomArea = roomList.reduce((sum, room) => sum + ventraPolygonArea(room?.polygon || []), 0);
    const areaRatio = roomArea / Math.max(1, area);
    const valid = containment.roomCentroidRatio >= 0.995 && containment.roomVertexRatio >= 0.88 && areaRatio >= 0.45 && areaRatio <= 1.35;
    return { footprint: poly, source, containment, area, areaRatio, valid };
  };

  // The AI-traced outer boundary is authoritative when it actually contains the rooms.
  // Do not replace a valid concave footprint with a wall-loop/hull merely because another
  // heuristic looks tidier; that was the source of several spatial regressions.
  const ai = assess(Array.isArray(footprint) ? footprint : [], "ai_outer_boundary");
  if (ai?.valid) return ai;
  // V49: never throw away a recognizably traced concave footprint merely because
  // a few room vertices slightly cross its inner wall centerline. A rectangular
  // plan-bounds fallback visually destroys the apartment topology.
  if (
    ai &&
    ai.containment.roomCentroidRatio >= 0.85 &&
    ai.areaRatio >= 0.35 &&
    ai.areaRatio <= 1.55
  ) {
    console.warn("[VENTRA FOOTPRINT SOFT ACCEPT v49]", {
      area: ai.area,
      areaRatio: ai.areaRatio,
      containment: ai.containment,
    });
    return ai;
  }

  const externalLoop = ventraBuildExternalWallLoop(
    walls,
    Math.max(0.12, Math.min(widthMeters, depthMeters) * 0.018)
  );
  const loop = assess(externalLoop, "external_wall_loop");
  if (loop?.valid) {
    console.warn("[VENTRA FOOTPRINT FALLBACK v47]", { source: loop.source, ai: ai ? { area: ai.area, areaRatio: ai.areaRatio, containment: ai.containment } : null });
    return loop;
  }

  const candidatePoints = [];
  for (const room of roomList) for (const point of (room?.polygon || [])) candidatePoints.push(point);
  for (const wall of Array.isArray(walls) ? walls : []) {
    if (String(wall?.type || "").toLowerCase() !== "external") continue;
    if (wall?.start) candidatePoints.push(wall.start);
    if (wall?.end) candidatePoints.push(wall.end);
  }
  const hull = assess(ventraConvexHull(candidatePoints), "room_external_wall_hull");
  if (hull?.valid) {
    console.warn("[VENTRA FOOTPRINT FALLBACK v47]", { source: hull.source });
    return hull;
  }

  // Last resort hierarchy: preserve the image trace before fabricating a box.
  // A slightly imperfect source footprint is preferable to a geometrically tidy
  // but false rectangular apartment.
  if (ai?.footprint?.length >= 3) {
    return { ...ai, source: "ai_outer_boundary_last_resort" };
  }
  if (loop?.footprint?.length >= 3) {
    return { ...loop, source: "external_wall_loop_last_resort" };
  }
  if (hull?.footprint?.length >= 3) {
    return { ...hull, source: "room_external_wall_hull_last_resort" };
  }

  throw new Error("No reliable exterior footprint could be reconstructed from the image.");
}

function ventraPointInPolygon(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.x || 0);
    const yi = Number(polygon[i]?.y || 0);
    const xj = Number(polygon[j]?.x || 0);
    const yj = Number(polygon[j]?.y || 0);
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}


function ventraPolygonCentroid(points = []) {
  if (!Array.isArray(points) || points.length < 3) {
    return { x: 0, y: 0 };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross =
      Number(a?.x || 0) * Number(b?.y || 0) -
      Number(b?.x || 0) * Number(a?.y || 0);

    signedArea += cross;
    cx += (Number(a?.x || 0) + Number(b?.x || 0)) * cross;
    cy += (Number(a?.y || 0) + Number(b?.y || 0)) * cross;
  }

  signedArea *= 0.5;

  if (Math.abs(signedArea) < 1e-8) {
    return {
      x:
        points.reduce(
          (sum, point) =>
            sum + Number(point?.x || 0),
          0
        ) / points.length,
      y:
        points.reduce(
          (sum, point) =>
            sum + Number(point?.y || 0),
          0
        ) / points.length,
    };
  }

  return {
    x: cx / (6 * signedArea),
    y: cy / (6 * signedArea),
  };
}

function ventraNearestRoomEdge(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 2) {
    return null;
  }

  let best = null;

  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const projected =
      ventraProjectPointToSegment(
        point,
        start,
        end
      );

    if (
      !best ||
      projected.distance < best.distance
    ) {
      const dx = Number(end.x) - Number(start.x);
      const dy = Number(end.y) - Number(start.y);
      const length = Math.max(1e-6, Math.hypot(dx, dy));
      const tangent = {
        x: dx / length,
        y: dy / length,
      };

      const normalA = {
        x: -tangent.y,
        y: tangent.x,
      };

      const normalB = {
        x: tangent.y,
        y: -tangent.x,
      };

      const testDistance = 0.12;
      const testA = {
        x:
          projected.point.x +
          normalA.x * testDistance,
        y:
          projected.point.y +
          normalA.y * testDistance,
      };
      const testB = {
        x:
          projected.point.x +
          normalB.x * testDistance,
        y:
          projected.point.y +
          normalB.y * testDistance,
      };

      const inward =
        ventraPointInPolygon(testA, polygon)
          ? normalA
          : ventraPointInPolygon(testB, polygon)
            ? normalB
            : normalA;

      best = {
        edgeIndex: i,
        start,
        end,
        projected:
          projected.point,
        t: projected.t,
        distance:
          projected.distance,
        tangent,
        inward,
      };
    }
  }

  return best;
}

function ventraFindRoomForPoint(point, rooms = []) {
  const direct =
    rooms.find((room) =>
      ventraPointInPolygon(
        point,
        room.polygon
      )
    );

  if (direct) {
    return direct;
  }

  let best = null;

  for (const room of rooms) {
    const centroid =
      ventraPolygonCentroid(
        room.polygon
      );

    const distance =
      Math.hypot(
        point.x - centroid.x,
        point.y - centroid.y
      );

    if (!best || distance < best.distance) {
      best = {
        room,
        distance,
      };
    }
  }

  return best && best.distance <= 0.75
    ? best.room
    : null;
}

function ventraWallIdForRoomEdge(edge, walls = []) {
  if (!edge) return null;

  const midpoint = {
    x:
      (Number(edge.start.x) +
        Number(edge.end.x)) /
      2,
    y:
      (Number(edge.start.y) +
        Number(edge.end.y)) /
      2,
  };

  let best = null;

  for (const wall of walls) {
    const projected =
      ventraProjectPointToSegment(
        midpoint,
        wall.start,
        wall.end
      );

    const dx1 =
      Number(edge.end.x) -
      Number(edge.start.x);
    const dy1 =
      Number(edge.end.y) -
      Number(edge.start.y);

    const dx2 =
      Number(wall.end.x) -
      Number(wall.start.x);
    const dy2 =
      Number(wall.end.y) -
      Number(wall.start.y);

    const len1 =
      Math.max(
        1e-6,
        Math.hypot(dx1, dy1)
      );

    const len2 =
      Math.max(
        1e-6,
        Math.hypot(dx2, dy2)
      );

    const parallel =
      Math.abs(
        (dx1 / len1) *
          (dx2 / len2) +
        (dy1 / len1) *
          (dy2 / len2)
      );

    const score =
      projected.distance +
      (1 - parallel) * 1.2;

    if (!best || score < best.score) {
      best = {
        wall,
        score,
      };
    }
  }

  return best && best.score < 0.45
    ? best.wall.id
    : null;
}

function ventraAssetPlacementRule(type) {
  const wallBacked = new Set([
    "bed",
    "wardrobe",
    "sofa",
    "armchair",
    "tv_unit",
    "kitchen_counter",
    "cabinet",
    "refrigerator",
    "stove",
    "sink",
    "washing_machine",
    "mirror",
    "toilet",
    "shower",
    "bathtub",
  ]);

  const parallelToWall = new Set([
    "wardrobe",
    "tv_unit",
    "kitchen_counter",
    "cabinet",
    "refrigerator",
    "stove",
    "sink",
    "washing_machine",
    "mirror",
    "toilet",
    "shower",
    "bathtub",
  ]);

  return {
    wallBacked:
      wallBacked.has(type),
    parallelToWall:
      parallelToWall.has(type),
  };
}

function ventraOpeningMetricCenter(opening, walls = []) {
  const wall =
    walls.find(
      (item) =>
        item.id === opening.wallId
    );

  if (!wall) return null;

  const t =
    clamp(
      opening.offset,
      0,
      1,
      0.5
    );

  return {
    x:
      wall.start.x +
      (wall.end.x -
        wall.start.x) *
        t,
    y:
      wall.start.y +
      (wall.end.y -
        wall.start.y) *
        t,
    type:
      opening.type,
    width:
      Number(opening.width) || 0.9,
  };
}

function ventraAssetClearOfOpenings(
  point,
  asset,
  openings,
  walls
) {
  for (const opening of openings) {
    const center =
      ventraOpeningMetricCenter(
        opening,
        walls
      );

    if (!center) continue;

    const radius =
      center.type === "door"
        ? Math.max(
            0.72,
            center.width * 0.72
          )
        : Math.max(
            0.28,
            center.width * 0.28
          );

    const assetRadius =
      Math.max(
        0.18,
        Math.min(
          0.65,
          Math.max(
            Number(asset.width) || 0.8,
            Number(asset.depth) || 0.8
          ) * 0.28
        )
      );

    if (
      Math.hypot(
        point.x - center.x,
        point.y - center.y
      ) <
      radius + assetRadius
    ) {
      return false;
    }
  }

  return true;
}

function ventraAssetClearOfAssets(
  point,
  asset,
  placedAssets = []
) {
  const currentRadius =
    Math.max(
      0.18,
      Math.min(
        0.95,
        Math.max(
          Number(asset.width) || 0.8,
          Number(asset.depth) || 0.8
        ) * 0.38
      )
    );

  for (const existing of placedAssets) {
    if (
      existing.roomId !==
      asset.roomId
    ) {
      continue;
    }

    const existingRadius =
      Math.max(
        0.18,
        Math.min(
          0.95,
          Math.max(
            Number(existing.width) || 0.8,
            Number(existing.depth) || 0.8
          ) * 0.38
        )
      );

    const minimum =
      (currentRadius +
        existingRadius) *
      0.72;

    if (
      Math.hypot(
        point.x -
          existing.xMeters,
        point.y -
          existing.yMeters
      ) <
      minimum
    ) {
      return false;
    }
  }

  return true;
}

function ventraResolveRoomLockedAsset({
  asset,
  type,
  center,
  room,
  walls,
  openings,
  placedAssets,
}) {
  const defaults =
    ventraAssetDefault(type);

  const width =
    clamp(
      asset?.widthMeters,
      0.15,
      6,
      defaults[0]
    );

  const depth =
    clamp(
      asset?.depthMeters,
      0.15,
      6,
      defaults[1]
    );

  const height =
    clamp(
      asset?.heightMeters,
      0.1,
      3.2,
      defaults[2]
    );

  const rule =
    ventraAssetPlacementRule(
      type
    );

  let point = {
    x: center.x,
    y: center.y,
  };

  let rotation =
    clamp(
      asset?.rotation,
      -360,
      360,
      0
    );

  let againstWallId =
    null;

  let placementSource =
    "vision_center";

  const edge =
    ventraNearestRoomEdge(
      point,
      room.polygon
    );

  if (
    rule.wallBacked &&
    edge
  ) {
    const snapThreshold =
      [
        "bed",
        "wardrobe",
        "kitchen_counter",
        "tv_unit",
        "refrigerator",
        "stove",
        "sink",
        "toilet",
        "shower",
        "bathtub",
        "mirror",
      ].includes(type)
        ? 0.85
        : 0.60;

    if (
      edge.distance <=
      snapThreshold
    ) {
      const clearance =
        Math.max(
          0.12,
          depth / 2 +
            0.06
        );

      const snapped = {
        x:
          edge.projected.x +
          edge.inward.x *
            clearance,
        y:
          edge.projected.y +
          edge.inward.y *
            clearance,
      };

      if (
        ventraPointInPolygon(
          snapped,
          room.polygon
        )
      ) {
        point = snapped;
        placementSource =
          "room_wall_snap";

        againstWallId =
          ventraWallIdForRoomEdge(
            edge,
            walls
          );

        const wallAngle =
          Math.atan2(
            edge.tangent.y,
            edge.tangent.x
          );

        if (
          rule.parallelToWall
        ) {
          rotation =
            (wallAngle *
              180) /
            Math.PI;
        } else {
          // local +Y points from the backed wall into the room
          rotation =
            (Math.atan2(
              -edge.inward.x,
              edge.inward.y
            ) *
              180) /
            Math.PI;
        }
      }
    }
  }

  const centroid =
    ventraPolygonCentroid(
      room.polygon
    );

  const candidateWorks =
    (candidate) =>
      ventraPointInPolygon(
        candidate,
        room.polygon
      ) &&
      ventraAssetClearOfOpenings(
        candidate,
        {
          width,
          depth,
        },
        openings,
        walls
      ) &&
      ventraAssetClearOfAssets(
        candidate,
        {
          width,
          depth,
          roomId:
            room.id,
        },
        placedAssets
      );

  if (!candidateWorks(point)) {
    let solved = null;

    for (
      let step = 1;
      step <= 10;
      step += 1
    ) {
      const t =
        step / 10;

      const candidate = {
        x:
          point.x +
          (centroid.x -
            point.x) *
            t,
        y:
          point.y +
          (centroid.y -
            point.y) *
            t,
      };

      if (
        candidateWorks(
          candidate
        )
      ) {
        solved =
          candidate;
        break;
      }
    }

    if (solved) {
      point = solved;
      placementSource +=
        "+clearance_nudge";
    } else if (
      candidateWorks(
        centroid
      )
    ) {
      point = {
        ...centroid,
      };
      placementSource =
        "room_centroid_fallback";
      againstWallId =
        null;
    } else {
      return null;
    }
  }

  return {
    type,
    roomId:
      room.id,
    xMeters:
      point.x,
    yMeters:
      point.y,
    width,
    depth,
    height,
    rotation,
    againstWallId,
    placementSource,
  };
}


function ventraMetricRoomBounds(room) {
  const polygon =
    Array.isArray(
      room?.polygon
    )
      ? room.polygon
      : [];

  if (
    polygon.length < 3
  ) {
    return null;
  }

  const xs =
    polygon
      .map(
        (point) =>
          Number(point?.x)
      )
      .filter(
        Number.isFinite
      );

  const ys =
    polygon
      .map(
        (point) =>
          Number(point?.y)
      )
      .filter(
        Number.isFinite
      );

  if (
    !xs.length ||
    !ys.length
  ) {
    return null;
  }

  const minX =
    Math.min(...xs);
  const maxX =
    Math.max(...xs);
  const minY =
    Math.min(...ys);
  const maxY =
    Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width:
      Math.max(
        0.1,
        maxX - minX
      ),
    depth:
      Math.max(
        0.1,
        maxY - minY
      ),
    center: {
      x:
        (minX + maxX) /
        2,
      y:
        (minY + maxY) /
        2,
    },
  };
}

function ventraRoomTypeText(room) {
  return String(
    [
      room?.type,
      room?.name,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function ventraIsBathroomRoom(room) {
  return /(bath|bathroom|wc|toilet|washroom|shower|حمام|سرویس|توالت)/i.test(
    ventraRoomTypeText(room)
  );
}

function ventraFindPlacedAsset(
  assets,
  roomId,
  types
) {
  const wanted =
    new Set(
      Array.isArray(types)
        ? types
        : [types]
    );

  return (
    assets.find(
      (asset) =>
        asset?.roomId ===
          roomId &&
        wanted.has(
          asset?.type
        )
    ) ||
    null
  );
}

function ventraBathroomCandidatePoints(room) {
  const bounds =
    ventraMetricRoomBounds(
      room
    );

  if (!bounds) {
    return [];
  }

  const fractions = [
    [0.18, 0.18],
    [0.82, 0.18],
    [0.18, 0.82],
    [0.82, 0.82],
    [0.50, 0.16],
    [0.16, 0.50],
    [0.84, 0.50],
    [0.50, 0.84],
    [0.50, 0.50],
  ];

  return fractions
    .map(
      ([rx, ry]) => ({
        x:
          bounds.minX +
          bounds.width *
            rx,
        y:
          bounds.minY +
          bounds.depth *
            ry,
      })
    )
    .filter(
      (point) =>
        ventraPointInPolygon(
          point,
          room.polygon
        )
    );
}

function ventraPlaceRequiredBathroomAsset({
  type,
  room,
  walls,
  openings,
  assets,
  preferredPoints = [],
}) {
  if (
    ventraFindPlacedAsset(
      assets,
      room.id,
      type
    )
  ) {
    return null;
  }

  const defaults =
    ventraAssetDefault(type);

  const candidates = [
    ...preferredPoints,
    ...ventraBathroomCandidatePoints(
      room
    ),
  ];

  for (
    const center of
    candidates
  ) {
    const locked =
      ventraResolveRoomLockedAsset({
        asset: {
          type,
          widthMeters:
            defaults[0],
          depthMeters:
            defaults[1],
          heightMeters:
            defaults[2],
          rotation: 0,
        },
        type,
        center,
        room,
        walls,
        openings,
        placedAssets:
          assets,
      });

    if (locked) {
      const result = {
        ...locked,
        x: null,
        y: null,
        placementSource:
          `interior_completeness_${type}`,
      };

      assets.push(
        result
      );

      return result;
    }
  }

  return null;
}

function ventraAddBathroomMirror({
  room,
  walls,
  assets,
}) {
  if (
    ventraFindPlacedAsset(
      assets,
      room.id,
      "mirror"
    )
  ) {
    return null;
  }

  const sink =
    ventraFindPlacedAsset(
      assets,
      room.id,
      "sink"
    );

  const sourcePoint =
    sink
      ? {
          x:
            sink.xMeters,
          y:
            sink.yMeters,
        }
      : ventraPolygonCentroid(
          room.polygon
        );

  const edge =
    ventraNearestRoomEdge(
      sourcePoint,
      room.polygon
    );

  if (!edge) {
    return null;
  }

  const mirrorDepth =
    0.045;

  const point = {
    x:
      edge.projected.x +
      edge.inward.x *
        (mirrorDepth /
          2 +
          0.025),
    y:
      edge.projected.y +
      edge.inward.y *
        (mirrorDepth /
          2 +
          0.025),
  };

  if (
    !ventraPointInPolygon(
      point,
      room.polygon
    )
  ) {
    return null;
  }

  const wallAngle =
    Math.atan2(
      edge.tangent.y,
      edge.tangent.x
    );

  const mirror = {
    type: "mirror",
    roomId:
      room.id,
    xMeters:
      point.x,
    yMeters:
      point.y,
    width: 0.78,
    depth:
      mirrorDepth,
    height: 1.00,
    rotation:
      (wallAngle *
        180) /
      Math.PI,
    againstWallId:
      ventraWallIdForRoomEdge(
        edge,
        walls
      ),
    placementSource:
      "interior_completeness_mirror_above_sink",
  };

  assets.push(
    mirror
  );

  return mirror;
}

function ventraEnsureInteriorCompleteness({
  rooms,
  walls,
  openings,
  assets,
  widthMeters,
  depthMeters,
}) {
  const completed =
    Array.isArray(assets)
      ? assets.map(
          (asset) => ({
            ...asset,
          })
        )
      : [];

  let added = 0;

  for (
    const room of
    Array.isArray(rooms)
      ? rooms
      : []
  ) {
    if (
      !ventraIsBathroomRoom(
        room
      )
    ) {
      continue;
    }

    const area =
      ventraPolygonArea(
        room.polygon
      );

    const typeText =
      ventraRoomTypeText(
        room
      );

    const isSmallWc =
      /(wc|toilet|powder|سرویس|توالت)/i.test(
        typeText
      ) &&
      !/(bath|bathroom|حمام)/i.test(
        typeText
      );

    const bounds =
      ventraMetricRoomBounds(
        room
      );

    const candidates =
      ventraBathroomCandidatePoints(
        room
      );

    const toilet =
      ventraPlaceRequiredBathroomAsset({
        type: "toilet",
        room,
        walls,
        openings,
        assets:
          completed,
        preferredPoints:
          candidates.slice(
            0,
            3
          ),
      });

    if (toilet) {
      added += 1;
    }

    const sink =
      ventraPlaceRequiredBathroomAsset({
        type: "sink",
        room,
        walls,
        openings,
        assets:
          completed,
        preferredPoints:
          candidates.slice(
            1,
            5
          ),
      });

    if (sink) {
      added += 1;
    }

    const hasBathtub =
      Boolean(
        ventraFindPlacedAsset(
          completed,
          room.id,
          "bathtub"
        )
      );

    const hasShower =
      Boolean(
        ventraFindPlacedAsset(
          completed,
          room.id,
          "shower"
        )
      );

    if (
      !hasBathtub &&
      !hasShower
    ) {
      const shouldUseBathtub =
        !isSmallWc &&
        area >= 3.2 &&
        Math.max(
          bounds?.width ||
            0,
          bounds?.depth ||
            0
        ) >= 1.75;

      const wetType =
        shouldUseBathtub
          ? "bathtub"
          : "shower";

      const wet =
        ventraPlaceRequiredBathroomAsset({
          type:
            wetType,
          room,
          walls,
          openings,
          assets:
            completed,
          preferredPoints:
            candidates
              .slice()
              .reverse(),
        });

      if (wet) {
        added += 1;
      }
    }

    const mirror =
      ventraAddBathroomMirror({
        room,
        walls,
        assets:
          completed,
      });

    if (mirror) {
      added += 1;
    }
  }

  // Recompute normalized fallback coordinates.
  for (
    const asset of
    completed
  ) {
    if (
      Number.isFinite(
        Number(
          asset?.xMeters
        )
      )
    ) {
      asset.x =
        clamp(
          Number(
            asset.xMeters
          ) /
            Math.max(
              0.001,
              widthMeters
            ),
          0.01,
          0.99,
          0.5
        );
    }

    if (
      Number.isFinite(
        Number(
          asset?.yMeters
        )
      )
    ) {
      asset.y =
        clamp(
          Number(
            asset.yMeters
          ) /
            Math.max(
              0.001,
              depthMeters
            ),
          0.01,
          0.99,
          0.5
        );
    }
  }

  console.log(
    "[VENTRA INTERIOR COMPLETENESS v17]",
    {
      bathroomCount:
        (rooms || []).filter(
          ventraIsBathroomRoom
        ).length,
      addedFixtureCount:
        added,
      totalAssetCount:
        completed.length,
      bathroomFixtures:
        completed.filter(
          (asset) =>
            [
              "toilet",
              "sink",
              "shower",
              "bathtub",
              "mirror",
            ].includes(
              asset?.type
            )
        ).length,
    }
  );

  return completed;
}

function ventraAssetDefault(type) {
  const defaults = {
    bed: [1.7, 2.0, 0.7], wardrobe: [1.6, 0.55, 2.1], nightstand: [0.48, 0.42, 0.5],
    sofa: [2.4, 0.95, 0.88], armchair: [0.9, 0.9, 0.88], coffee_table: [1.1, 0.65, 0.42],
    dining_table: [1.5, 0.9, 0.76], chair: [0.48, 0.5, 0.9], tv_unit: [1.6, 0.4, 0.85],
    kitchen_counter: [2.0, 0.62, 0.92], kitchen_island: [1.8, 0.9, 0.92], cabinet: [1.0, 0.45, 1.8],
    refrigerator: [0.8, 0.72, 1.9], stove: [0.7, 0.62, 0.9], washing_machine: [0.65, 0.65, 0.88],
    sink: [0.65, 0.48, 0.85], toilet: [0.68, 0.78, 0.75], shower: [0.9, 0.9, 2.05],
    bathtub: [1.7, 0.75, 0.55], mirror: [0.7, 0.05, 0.9], desk: [1.2, 0.6, 0.75], generic: [0.8, 0.8, 0.8],
  };
  return defaults[type] || defaults.generic;
}

function ventraWallsFromRooms(rawRooms = []) {
  const edgeMap = new Map();
  for (const room of rawRooms) {
    const polygon = Array.isArray(room?.polygon) ? room.polygon : [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const keyPoint = (p) => `${Math.round(Number(p?.x || 0) / 4) * 4},${Math.round(Number(p?.y || 0) / 4) * 4}`;
      const ka = keyPoint(a);
      const kb = keyPoint(b);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const current = edgeMap.get(key) || { count: 0, start: a, end: b };
      current.count += 1;
      edgeMap.set(key, current);
    }
  }
  let index = 0;
  return Array.from(edgeMap.values()).map((edge) => ({
    id: `derived_wall_${++index}`,
    type: edge.count > 1 ? "internal" : "external",
    start: edge.start,
    end: edge.end,
  }));
}


// V48: deterministic raster-plan reconstruction. Vision detects wall evidence;
// Ventra, not the model, owns the final room polygons and outer footprint.
function ventraSignedPolygonArea(points = []) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += Number(a?.x || 0) * Number(b?.y || 0) - Number(b?.x || 0) * Number(a?.y || 0);
  }
  return area / 2;
}

function ventraDistance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}

function ventraSnapWallEvidence(rawWalls = [], tolerance = 10) {
  const walls = (Array.isArray(rawWalls) ? rawWalls : []).map((wall, index) => {
    let a = { x: Number(wall?.start?.x), y: Number(wall?.start?.y) };
    let b = { x: Number(wall?.end?.x), y: Number(wall?.end?.y) };
    if (![a.x,a.y,b.x,b.y].every(Number.isFinite) || ventraDistance(a,b) < 5) return null;
    const dx = b.x-a.x, dy=b.y-a.y;
    if (Math.abs(dy) <= Math.max(tolerance, Math.abs(dx)*0.10)) {
      const y=(a.y+b.y)/2; a={x:a.x,y}; b={x:b.x,y};
    } else if (Math.abs(dx) <= Math.max(tolerance, Math.abs(dy)*0.10)) {
      const x=(a.x+b.x)/2; a={x,y:a.y}; b={x,y:b.y};
    }
    return { id:String(wall?.id||`wall_${index+1}`), type:wall?.type==='external'?'external':'internal', start:a, end:b };
  }).filter(Boolean);

  // Cluster nearly coincident horizontal/vertical centerlines. This removes the
  // few-pixel vision jitter that otherwise turns one shared wall into two walls.
  for (const axis of ['x','y']) {
    const candidates=[];
    for (const w of walls) {
      const vertical=Math.abs(w.end.x-w.start.x)<1e-6;
      const horizontal=Math.abs(w.end.y-w.start.y)<1e-6;
      if ((axis==='x'&&vertical)||(axis==='y'&&horizontal)) candidates.push(axis==='x'?w.start.x:w.start.y);
    }
    candidates.sort((a,b)=>a-b);
    const groups=[];
    for (const value of candidates) {
      const g=groups[groups.length-1];
      if (!g || Math.abs(value-g[g.length-1])>tolerance) groups.push([value]); else g.push(value);
    }
    const centers=groups.map(g=>g.reduce((a,b)=>a+b,0)/g.length);
    for (const w of walls) {
      const vertical=Math.abs(w.end.x-w.start.x)<1e-6;
      const horizontal=Math.abs(w.end.y-w.start.y)<1e-6;
      if ((axis==='x'&&vertical)||(axis==='y'&&horizontal)) {
        const value=axis==='x'?w.start.x:w.start.y;
        const c=centers.reduce((best,v)=>Math.abs(v-value)<Math.abs(best-value)?v:best, centers[0]??value);
        if (axis==='x') { w.start.x=c; w.end.x=c; } else { w.start.y=c; w.end.y=c; }
      }
    }
  }

  // Extend endpoints onto nearby perpendicular walls, closing tiny T/corner gaps.
  const pointOnSpan=(v,a,b,pad=12)=>v>=Math.min(a,b)-pad&&v<=Math.max(a,b)+pad;
  for (const w of walls) for (const endName of ['start','end']) {
    const p=w[endName]; let best=null;
    for (const other of walls) {
      if (other===w) continue;
      const ov=Math.abs(other.end.x-other.start.x)<1e-6;
      const oh=Math.abs(other.end.y-other.start.y)<1e-6;
      const wv=Math.abs(w.end.x-w.start.x)<1e-6;
      const wh=Math.abs(w.end.y-w.start.y)<1e-6;
      let q=null;
      if (wh&&ov&&pointOnSpan(p.x,other.start.x,other.end.x)&&pointOnSpan(p.y,other.start.y,other.end.y)) q={x:other.start.x,y:p.y};
      if (wv&&oh&&pointOnSpan(p.y,other.start.y,other.end.y)&&pointOnSpan(p.x,other.start.x,other.end.x)) q={x:p.x,y:other.start.y};
      if (q) { const d=ventraDistance(p,q); if (d<=14&&(!best||d<best.d)) best={q,d}; }
    }
    if (best) w[endName]=best.q;
  }
  return walls;
}

function ventraSplitWallGraph(walls = []) {
  const eps=1e-6, segments=[];
  const cross=(a,b,c,d)=>{
    const den=(a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x);
    if (Math.abs(den)<eps) return null;
    const x=((a.x*b.y-a.y*b.x)*(c.x-d.x)-(a.x-b.x)*(c.x*d.y-c.y*d.x))/den;
    const y=((a.x*b.y-a.y*b.x)*(c.y-d.y)-(a.y-b.y)*(c.x*d.y-c.y*d.x))/den;
    const within=(v,p,q)=>v>=Math.min(p,q)-0.5&&v<=Math.max(p,q)+0.5;
    return within(x,a.x,b.x)&&within(y,a.y,b.y)&&within(x,c.x,d.x)&&within(y,c.y,d.y)?{x,y}:null;
  };
  for (let i=0;i<walls.length;i+=1) {
    const w=walls[i], pts=[w.start,w.end];
    for (let j=0;j<walls.length;j+=1) if(i!==j) { const q=cross(w.start,w.end,walls[j].start,walls[j].end); if(q) pts.push(q); }
    const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len2=dx*dx+dy*dy;
    const unique=[]; const seen=new Set();
    for(const p of pts){ const t=len2?((p.x-w.start.x)*dx+(p.y-w.start.y)*dy)/len2:0; const key=Math.round(t*10000); if(!seen.has(key)){seen.add(key);unique.push({p,t});}}
    unique.sort((a,b)=>a.t-b.t);
    for(let k=0;k<unique.length-1;k+=1) if(ventraDistance(unique[k].p,unique[k+1].p)>2) segments.push({id:`${w.id}__${k}`,sourceWallId:w.id,type:w.type,start:unique[k].p,end:unique[k+1].p});
  }
  return segments;
}

function ventraGraphFaces(segments = []) {
  const nodeKey=p=>`${Math.round(p.x*10)/10},${Math.round(p.y*10)/10}`;
  const nodes=new Map(), edges=[];
  const nodeFor=p=>{const k=nodeKey(p); if(!nodes.has(k))nodes.set(k,{key:k,x:p.x,y:p.y,out:[]}); return nodes.get(k);};
  for(const s of segments){const a=nodeFor(s.start),b=nodeFor(s.end); if(a===b)continue; const e1={from:a,to:b,seg:s,twin:null,used:false},e2={from:b,to:a,seg:s,twin:null,used:false};e1.twin=e2;e2.twin=e1;a.out.push(e1);b.out.push(e2);edges.push(e1,e2);}
  for(const n of nodes.values()) n.out.sort((a,b)=>Math.atan2(a.to.y-n.y,a.to.x-n.x)-Math.atan2(b.to.y-n.y,b.to.x-n.x));
  const faces=[];
  for(const start of edges){ if(start.used)continue; const poly=[]; let e=start,guard=0;
    while(e&&!e.used&&guard++<1000){e.used=true;poly.push({x:e.from.x,y:e.from.y});const outs=e.to.out;const twinIndex=outs.indexOf(e.twin);if(twinIndex<0)break;/* keep the face on the left in image coordinates */e=outs[(twinIndex-1+outs.length)%outs.length];if(e===start)break;}
    if(e===start&&poly.length>=3){const area=ventraSignedPolygonArea(poly);if(Math.abs(area)>150)faces.push({polygon:poly,area});}
  }
  return faces;
}



function ventraPointSegmentDistancePx(point, a, b) {
  const px = Number(point?.x), py = Number(point?.y);
  const ax = Number(a?.x), ay = Number(a?.y), bx = Number(b?.x), by = Number(b?.y);
  if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return Infinity;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function ventraPolygonBoundaryDistancePx(polyA = [], polyB = []) {
  if (!Array.isArray(polyA) || !Array.isArray(polyB) || polyA.length < 2 || polyB.length < 2) return Infinity;
  let best = Infinity;
  const scan = (points, edges) => {
    for (const p of points) {
      for (let i = 0; i < edges.length; i += 1) {
        const a = edges[i], b = edges[(i + 1) % edges.length];
        best = Math.min(best, ventraPointSegmentDistancePx(p, a, b));
      }
    }
  };
  scan(polyA, polyB);
  scan(polyB, polyA);
  return best;
}

function ventraCandidateRoomById(candidateRooms = [], id) {
  const exact = candidateRooms.find((room) => String(room?.id || '') === String(id || ''));
  return exact || null;
}

function ventraCandidateAdjacencyEvidence(topology = {}, candidate = {}) {
  const expected = Array.isArray(topology?.adjacencies) ? topology.adjacencies : [];
  const rooms = Array.isArray(candidate?.rooms) ? candidate.rooms : [];
  if (!expected.length) return { ratio: 1, checked: 0, hits: 0 };
  let checked = 0, hits = 0;
  for (const rel of expected) {
    const a = ventraCandidateRoomById(rooms, rel?.roomAId);
    const b = ventraCandidateRoomById(rooms, rel?.roomBId);
    if (!a || !b) continue;
    checked += 1;
    const d = ventraPolygonBoundaryDistancePx(a?.polygon || [], b?.polygon || []);
    const threshold = rel?.relation === 'open_boundary' ? 28 : 16;
    if (Number.isFinite(d) && d <= threshold) hits += 1;
  }
  return { ratio: checked ? hits / checked : 0, checked, hits };
}

function ventraCandidateJunctionEvidence(topology = {}, candidate = {}) {
  const expected = Array.isArray(topology?.junctions) ? topology.junctions : [];
  const walls = Array.isArray(candidate?.walls) ? candidate.walls : [];
  if (!expected.length) return { ratio: 1, checked: 0, hits: 0 };
  let checked = 0, hits = 0;
  for (const junction of expected) {
    const c = junction?.center;
    if (!c) continue;
    checked += 1;
    let incident = 0;
    for (const wall of walls) {
      const d = ventraPointSegmentDistancePx(c, wall?.start, wall?.end);
      if (d <= 15) incident += 1;
    }
    const required = junction?.kind === 'X' ? 4 : junction?.kind === 'T' ? 3 : 2;
    if (incident >= required) hits += 1;
  }
  return { ratio: checked ? hits / checked : 0, checked, hits };
}

function ventraCandidateOpeningEvidence(topology = {}, candidate = {}) {
  const expected = Array.isArray(topology?.expectedOpenings) ? topology.expectedOpenings : [];
  const openings = Array.isArray(candidate?.openings) ? candidate.openings : [];
  if (!expected.length) return { ratio: 1, checked: 0, hits: 0 };
  let checked = 0, hits = 0;
  const used = new Set();
  for (const exp of expected) {
    const center = exp?.center;
    if (!center) continue;
    checked += 1;
    let bestIndex = -1, bestDistance = Infinity;
    for (let i = 0; i < openings.length; i += 1) {
      if (used.has(i)) continue;
      const opening = openings[i];
      if (String(opening?.type || '') !== String(exp?.kind || '')) continue;
      const d = ventraDistance(center, opening?.center || {});
      if (d < bestDistance) { bestDistance = d; bestIndex = i; }
    }
    if (bestIndex >= 0 && bestDistance <= 28) {
      hits += 1;
      used.add(bestIndex);
    }
  }
  return { ratio: checked ? hits / checked : 0, checked, hits };
}

function ventraCandidateWallEvidenceCoverage(topology = {}, candidate = {}) {
  const junctions = Array.isArray(topology?.junctions) ? topology.junctions : [];
  const walls = Array.isArray(candidate?.walls) ? candidate.walls : [];
  if (!junctions.length || !walls.length) return 0.5;
  let total = 0, hit = 0;
  for (const j of junctions) {
    if (!j?.center) continue;
    total += 1;
    let best = Infinity;
    for (const wall of walls) best = Math.min(best, ventraPointSegmentDistancePx(j.center, wall?.start, wall?.end));
    if (best <= 12) hit += 1;
  }
  return total ? hit / total : 0.5;
}


async function ventraExtractPixelWallEvidence(imageDataUrl, planBoundsInput = {}) {
  try {
    const base64 = String(imageDataUrl || '').split(',')[1];
    if (!base64) return { segments: [], source: 'unavailable' };
    const bounds = ventraPlanBounds(planBoundsInput || {});
    const raw = await sharp(Buffer.from(base64, 'base64'))
      .resize(1000, 1000, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    const dark = (x, y) => {
      x = Math.max(0, Math.min(999, Math.round(x)));
      y = Math.max(0, Math.min(999, Math.round(y)));
      return raw[y * 1000 + x] < 105;
    };
    const minX=Math.max(0,Math.floor(bounds.minX)), maxX=Math.min(999,Math.ceil(bounds.maxX));
    const minY=Math.max(0,Math.floor(bounds.minY)), maxY=Math.min(999,Math.ceil(bounds.maxY));
    const segments=[];
    const scanVertical=(x)=>{
      let start=null,last=null;
      for(let y=minY;y<=maxY;y+=2){
        let hits=0,total=0;
        for(let dx=-5;dx<=5;dx+=2){total++;if(dark(x+dx,y))hits++;}
        const on=hits/total>=0.34;
        if(on){if(start===null)start=y;last=y;} else if(start!==null){if(last-start>=34)segments.push({axis:'v',start:{x,y:start},end:{x,y:last},length:last-start});start=null;last=null;}
      }
      if(start!==null&&last-start>=34)segments.push({axis:'v',start:{x,y:start},end:{x,y:last},length:last-start});
    };
    const scanHorizontal=(y)=>{
      let start=null,last=null;
      for(let x=minX;x<=maxX;x+=2){
        let hits=0,total=0;
        for(let dy=-5;dy<=5;dy+=2){total++;if(dark(x,y+dy))hits++;}
        const on=hits/total>=0.34;
        if(on){if(start===null)start=x;last=x;} else if(start!==null){if(last-start>=34)segments.push({axis:'h',start:{x:start,y},end:{x:last,y},length:last-start});start=null;last=null;}
      }
      if(start!==null&&last-start>=34)segments.push({axis:'h',start:{x:start,y},end:{x:last,y},length:last-start});
    };
    for(let x=minX;x<=maxX;x+=4)scanVertical(x);
    for(let y=minY;y<=maxY;y+=4)scanHorizontal(y);
    // Merge near-duplicate raster scans into stable centerline evidence.
    const merged=[];
    for(const axis of ['v','h']){
      const arr=segments.filter(s=>s.axis===axis).sort((a,b)=>(axis==='v'?a.start.x-b.start.x:a.start.y-b.start.y));
      for(const seg of arr){
        const coord=axis==='v'?seg.start.x:seg.start.y;
        const a0=axis==='v'?seg.start.y:seg.start.x, a1=axis==='v'?seg.end.y:seg.end.x;
        let best=null;
        for(const m of merged){if(m.axis!==axis)continue;const mc=axis==='v'?m.start.x:m.start.y;const b0=axis==='v'?m.start.y:m.start.x,b1=axis==='v'?m.end.y:m.end.x;const overlap=Math.min(a1,b1)-Math.max(a0,b0);if(Math.abs(coord-mc)<=10&&overlap>=Math.min(a1-a0,b1-b0)*0.45){best=m;break;}}
        if(best){
          const mc=axis==='v'?best.start.x:best.start.y; const c=(mc+coord)/2;
          const b0=axis==='v'?best.start.y:best.start.x,b1=axis==='v'?best.end.y:best.end.x;
          const lo=Math.min(a0,b0),hi=Math.max(a1,b1);
          if(axis==='v'){best.start={x:c,y:lo};best.end={x:c,y:hi};}else{best.start={x:lo,y:c};best.end={x:hi,y:c};}
          best.length=hi-lo;
        } else merged.push(JSON.parse(JSON.stringify(seg)));
      }
    }
    const stable=merged.filter(s=>s.length>=42).sort((a,b)=>b.length-a.length).slice(0,80).map((s,i)=>({id:`px_${i+1}`,axis:s.axis,start:s.start,end:s.end,confidence:Math.min(0.99,0.55+s.length/900)}));
    return { segments: stable, source: 'sharp_grayscale_direct_pixels', bounds };
  } catch (error) {
    console.warn('[VENTRA JPG PIXEL WALL EXTRACTION FAILED v51]', error?.message || error);
    return { segments: [], source: 'failed' };
  }
}

function ventraCandidatePixelWallAgreement(pixelEvidence = {}, candidate = {}) {
  const observed=Array.isArray(pixelEvidence?.segments)?pixelEvidence.segments:[];
  const walls=Array.isArray(candidate?.walls)?candidate.walls:[];
  if(!observed.length||!walls.length)return {ratio:0.5,checked:0,hits:0};
  let checked=0,hits=0,weighted=0,totalWeight=0;
  for(const seg of observed){
    checked++; const mid={x:(seg.start.x+seg.end.x)/2,y:(seg.start.y+seg.end.y)/2};
    const weight=Math.max(0.2,Number(seg.confidence)||0.5); totalWeight+=weight;
    let best=Infinity;
    for(const wall of walls){
      const dx=Math.abs(Number(wall?.end?.x)-Number(wall?.start?.x));
      const dy=Math.abs(Number(wall?.end?.y)-Number(wall?.start?.y));
      const axis=dx>=dy?'h':'v'; if(axis!==seg.axis)continue;
      best=Math.min(best,ventraPointSegmentDistancePx(mid,wall?.start,wall?.end));
    }
    if(best<=14){hits++;weighted+=weight;}
  }
  return {ratio:totalWeight?weighted/totalWeight:0,checked,hits};
}

function ventraScoreImageGeometryCandidate(topology = {}, candidate = {}, pixelEvidence = null) {
  const topologyRooms = Array.isArray(topology?.rooms) ? topology.rooms : [];
  const candidateRooms = Array.isArray(candidate?.rooms) ? candidate.rooms : [];
  const footprint = Array.isArray(candidate?.footprint) ? candidate.footprint : [];
  const walls = Array.isArray(candidate?.walls) ? candidate.walls : [];
  const openings = Array.isArray(candidate?.openings) ? candidate.openings : [];
  const bounds = ventraPlanBounds(topology?.planBounds || candidate?.planBounds || {});
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const widthMeters = Number(topology?.widthMeters || candidate?.widthMeters) || 0;
  const depthMeters = Number(topology?.depthMeters || candidate?.depthMeters) || 0;

  let anchorHits = 0;
  let dimensionChecks = 0;
  let dimensionError = 0;
  const used = new Set();

  const roomForAnchor = (anchor) => {
    const byId = candidateRooms.find((room, index) => !used.has(index) && String(room?.id || '') === String(anchor?.id || ''));
    if (byId) return { room: byId, index: candidateRooms.indexOf(byId) };
    let best = null;
    for (let i = 0; i < candidateRooms.length; i += 1) {
      if (used.has(i)) continue;
      const room = candidateRooms[i];
      const poly = Array.isArray(room?.polygon) ? room.polygon : [];
      if (poly.length < 3) continue;
      const label = anchor?.labelCenter;
      if (label && ventraPointInPolygon(label, poly)) return { room, index: i };
      const c = ventraPolygonCentroid(poly);
      const d = label ? ventraDistance(label, c) : Infinity;
      if (!best || d < best.d) best = { room, index: i, d };
    }
    return best;
  };

  for (const anchor of topologyRooms) {
    const matched = roomForAnchor(anchor);
    if (!matched?.room) continue;
    used.add(matched.index);
    const poly = Array.isArray(matched.room?.polygon) ? matched.room.polygon : [];
    const label = anchor?.labelCenter;
    if (label && poly.length >= 3 && ventraPointInPolygon(label, poly)) anchorHits += 1;

    const printedW = Number(anchor?.printedWidthMeters);
    const printedD = Number(anchor?.printedDepthMeters);
    if (Number.isFinite(printedW) && printedW > 0.4 && Number.isFinite(printedD) && printedD > 0.4 && poly.length >= 3 && widthMeters > 0 && depthMeters > 0) {
      const xs = poly.map((p) => Number(p?.x)).filter(Number.isFinite);
      const ys = poly.map((p) => Number(p?.y)).filter(Number.isFinite);
      if (xs.length && ys.length) {
        const measuredW = (Math.max(...xs) - Math.min(...xs)) / spanX * widthMeters;
        const measuredD = (Math.max(...ys) - Math.min(...ys)) / spanY * depthMeters;
        // Printed dimensions can appear in either visual orientation after rotation conventions,
        // so score the better of direct or swapped pairing without modifying geometry.
        const direct = Math.abs(measuredW - printedW) / printedW + Math.abs(measuredD - printedD) / printedD;
        const swapped = Math.abs(measuredW - printedD) / printedD + Math.abs(measuredD - printedW) / printedW;
        dimensionError += Math.min(direct, swapped) / 2;
        dimensionChecks += 1;
      }
    }
  }

  const anchorRatio = topologyRooms.length ? anchorHits / topologyRooms.length : 0;
  const roomCountRatio = topologyRooms.length
    ? Math.min(candidateRooms.length, topologyRooms.length) / Math.max(candidateRooms.length, topologyRooms.length)
    : candidateRooms.length ? 1 : 0;

  let footprintContainment = 0;
  if (footprint.length >= 3 && candidateRooms.length) {
    let inside = 0;
    for (const room of candidateRooms) {
      const c = ventraPolygonCentroid(Array.isArray(room?.polygon) ? room.polygon : []);
      if (ventraPointInPolygon(c, footprint)) inside += 1;
    }
    footprintContainment = inside / candidateRooms.length;
  }

  let aspectScore = 0.5;
  if (footprint.length >= 3 && widthMeters > 0 && depthMeters > 0) {
    const xs = footprint.map((p) => Number(p?.x)).filter(Number.isFinite);
    const ys = footprint.map((p) => Number(p?.y)).filter(Number.isFinite);
    if (xs.length && ys.length) {
      const fpAspect = (Math.max(...xs) - Math.min(...xs)) / Math.max(1, Math.max(...ys) - Math.min(...ys));
      const metricAspect = widthMeters / depthMeters;
      const rel = Math.abs(fpAspect - metricAspect) / Math.max(0.1, metricAspect);
      aspectScore = Math.max(0, 1 - rel);
    }
  }

  let openingAttachRatio = 1;
  if (openings.length && walls.length) {
    const wallIds = new Set(walls.map((w) => String(w?.id || '')));
    openingAttachRatio = openings.filter((o) => wallIds.has(String(o?.wallId || ''))).length / openings.length;
  }

  const avgDimensionError = dimensionChecks ? dimensionError / dimensionChecks : 0.25;
  const dimensionScore = Math.max(0, 1 - avgDimensionError);
  const wallPlausibility = Math.min(1, walls.length / Math.max(6, topologyRooms.length * 1.7));
  const adjacency = ventraCandidateAdjacencyEvidence(topology, candidate);
  const junctions = ventraCandidateJunctionEvidence(topology, candidate);
  const expectedOpenings = ventraCandidateOpeningEvidence(topology, candidate);
  const wallEvidenceScore = ventraCandidateWallEvidenceCoverage(topology, candidate);
  const pixelWall = ventraCandidatePixelWallAgreement(pixelEvidence || {}, candidate);

  // V50: topology invariants dominate cosmetic/statistical plausibility. A neat rectangle
  // is not allowed to beat the actual apartment merely because labels happen to land inside it.
  const score =
    anchorRatio * 0.16 +
    roomCountRatio * 0.09 +
    footprintContainment * 0.08 +
    aspectScore * 0.05 +
    dimensionScore * 0.08 +
    openingAttachRatio * 0.04 +
    wallPlausibility * 0.03 +
    adjacency.ratio * 0.20 +
    junctions.ratio * 0.14 +
    expectedOpenings.ratio * 0.07 +
    wallEvidenceScore * 0.04 +
    pixelWall.ratio * 0.16;

  const hardEvidencePass =
    anchorRatio >= 0.82 &&
    roomCountRatio >= 0.90 &&
    footprintContainment >= 0.90 &&
    (adjacency.checked === 0 || adjacency.ratio >= 0.72) &&
    (junctions.checked === 0 || junctions.ratio >= 0.58) &&
    (expectedOpenings.checked === 0 || expectedOpenings.ratio >= 0.60) &&
    (pixelWall.checked === 0 || pixelWall.ratio >= 0.58);

  return {
    score: Number(score.toFixed(4)),
    hardEvidencePass,
    anchorRatio: Number(anchorRatio.toFixed(4)),
    roomCountRatio: Number(roomCountRatio.toFixed(4)),
    footprintContainment: Number(footprintContainment.toFixed(4)),
    aspectScore: Number(aspectScore.toFixed(4)),
    dimensionScore: Number(dimensionScore.toFixed(4)),
    openingAttachRatio: Number(openingAttachRatio.toFixed(4)),
    adjacencyRatio: Number(adjacency.ratio.toFixed(4)),
    adjacencyChecks: adjacency.checked,
    junctionRatio: Number(junctions.ratio.toFixed(4)),
    junctionChecks: junctions.checked,
    expectedOpeningRatio: Number(expectedOpenings.ratio.toFixed(4)),
    expectedOpeningChecks: expectedOpenings.checked,
    wallEvidenceScore: Number(wallEvidenceScore.toFixed(4)),
    pixelWallRatio: Number(pixelWall.ratio.toFixed(4)),
    pixelWallChecked: pixelWall.checked,
    roomCount: candidateRooms.length,
    wallCount: walls.length,
    footprintPoints: footprint.length,
  };
}

function ventraDeterministicGeometryFromEvidence(topology = {}, evidence = {}) {
  const bounds=ventraPlanBounds(topology?.planBounds||evidence?.planBounds||{});
  const snapped=ventraSnapWallEvidence(evidence?.walls||[]);
  const split=ventraSplitWallGraph(snapped);
  const allFaces=ventraGraphFaces(split);
  const bounded=allFaces.filter(f=>f.area>250).sort((a,b)=>b.area-a.area);
  if(!bounded.length) throw new Error('Deterministic wall graph did not close any architectural faces.');

  const externalSplit=ventraSplitWallGraph(snapped.filter(w=>w.type==='external'));
  const externalFaces=ventraGraphFaces(externalSplit).filter(f=>f.area>1000).sort((a,b)=>b.area-a.area);
  let footprint=(externalFaces[0]?.polygon||bounded[0]?.polygon||[]).map(p=>({x:p.x,y:p.y}));
  if(footprint.length<3) throw new Error('Could not close the exterior wall loop deterministically.');

  const roomAnchors=Array.isArray(topology?.rooms)?topology.rooms:[];
  const available=bounded.slice(); const rooms=[];
  const centroid=poly=>ventraPolygonCentroid(poly);
  for(let i=0;i<roomAnchors.length;i+=1){const r=roomAnchors[i],label={x:Number(r?.labelCenter?.x),y:Number(r?.labelCenter?.y)};let bestIndex=-1,bestScore=Infinity;
    for(let j=0;j<available.length;j+=1){const f=available[j];const inside=ventraPointInPolygon(label,f.polygon);const c=centroid(f.polygon);const score=inside?0:ventraDistance(label,c);if(score<bestScore){bestScore=score;bestIndex=j;}}
    if(bestIndex>=0){const face=available.splice(bestIndex,1)[0];rooms.push({id:String(r?.id||`room_${i+1}`),name:String(r?.name||`Room ${i+1}`),type:String(r?.type||r?.name||'room'),polygon:face.polygon});}
  }
  if(!rooms.length) throw new Error('No room labels could be matched to deterministic wall faces.');

  // Convert graph-owned polygons back into the schema's image coordinate frame;
  // compileGenericScene will perform the single metric/Y-axis conversion for every layer.
  return {
    title:String(topology?.title||evidence?.title||'AI Floor Plan'),
    confidence:Math.min(Number(topology?.confidence||0.8),Number(evidence?.confidence||0.8)),
    widthMeters:Number(topology?.widthMeters||evidence?.widthMeters),
    depthMeters:Number(topology?.depthMeters||evidence?.depthMeters),
    planBounds:bounds,
    footprint,
    holes:[],
    rooms,
    walls:snapped,
    openings:Array.isArray(evidence?.openings)?evidence.openings:[],
    assets:Array.isArray(evidence?.assets)?evidence.assets:[],
  };
}

function ventraCompileGenericScene(geometryInput, assetsInput = {}) {
  const confidence = clamp(geometryInput?.confidence, 0, 1, 0);
  if (confidence < 0.50) {
    throw new Error(`Floor-plan geometry confidence is too low (${confidence.toFixed(2)}).`);
  }

  const bounds = ventraPlanBounds(geometryInput?.planBounds || {});
  let widthMeters = Number(geometryInput?.widthMeters);
  let depthMeters = Number(geometryInput?.depthMeters);
  const imageAspect = Math.max(0.2, (bounds.maxX - bounds.minX) / Math.max(1, bounds.maxY - bounds.minY));

  if (!Number.isFinite(widthMeters) || widthMeters <= 1) widthMeters = 0;
  if (!Number.isFinite(depthMeters) || depthMeters <= 1) depthMeters = 0;
  if (widthMeters > 0 && depthMeters <= 0) depthMeters = widthMeters / imageAspect;
  if (depthMeters > 0 && widthMeters <= 0) widthMeters = depthMeters * imageAspect;
  if (!(widthMeters > 1 && depthMeters > 1)) {
    throw new Error("Could not resolve reliable metric width/depth from the plan dimensions.");
  }

  widthMeters = clamp(widthMeters, 1.8, 80, 10);
  depthMeters = clamp(depthMeters, 1.8, 80, 8);

  // V40: the vision model returns footprint/holes in the SAME image coordinate
  // system as rooms/walls. Convert them into metres and then validate them.
  // Previous versions discarded both fields entirely, which forced a convex-hull
  // fallback and destroyed genuine exterior recesses/notches.
  const rawFootprint = (Array.isArray(geometryInput?.footprint) ? geometryInput.footprint : [])
    .slice(0, 128)
    .map((point) => ventraImagePointToMeters(point, bounds, widthMeters, depthMeters));

  const rawRooms = Array.isArray(geometryInput?.rooms) ? geometryInput.rooms : [];
  const rooms = rawRooms.map((room, index) => ({
    id: String(room?.id || `room_${index + 1}`).slice(0, 60),
    name: String(room?.name || `Room ${index + 1}`).slice(0, 100),
    type: String(room?.type || room?.name || "room").slice(0, 60),
    polygon: (Array.isArray(room?.polygon) ? room.polygon : [])
      .slice(0, 32)
      .map((point) => ventraImagePointToMeters(point, bounds, widthMeters, depthMeters)),
  })).filter((room) => room.polygon.length >= 3 && ventraPolygonArea(room.polygon) > 0.35);

  if (!rooms.length) {
    throw new Error("No valid room polygons were detected.");
  }

  let rawWalls = Array.isArray(geometryInput?.walls) ? geometryInput.walls : [];
  if (rawWalls.length < 4) rawWalls = ventraWallsFromRooms(rawRooms);

  const walls = rawWalls.slice(0, 180).map((wall, index) => ({
    id: String(wall?.id || `wall_${index + 1}`).slice(0, 60),
    type: wall?.type === "external" ? "external" : "internal",
    start: ventraImagePointToMeters(wall?.start, bounds, widthMeters, depthMeters),
    end: ventraImagePointToMeters(wall?.end, bounds, widthMeters, depthMeters),
  })).filter((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) > 0.08);

  if (walls.length < 4) {
    throw new Error(`Only ${walls.length} valid walls were detected.`);
  }

  const sanitizedFootprint =
    ventraSanitizeFootprint({
      footprint: rawFootprint,
      rooms,
      walls,
      widthMeters,
      depthMeters,
    });

  const footprint = sanitizedFootprint.footprint;

  const holes = (Array.isArray(geometryInput?.holes) ? geometryInput.holes : [])
    .slice(0, 24)
    .map((hole, index) => ({
      id: String(hole?.id || `hole_${index + 1}`).slice(0, 60),
      type: ["shaft", "courtyard"].includes(hole?.type) ? hole.type : "void",
      polygon: (Array.isArray(hole?.polygon) ? hole.polygon : [])
        .slice(0, 32)
        .map((point) => ventraImagePointToMeters(point, bounds, widthMeters, depthMeters)),
    }))
    .filter((hole) => {
      // V41: raster plans routinely contain unlabeled circulation pockets and
      // white-space gaps. Those are floor, not holes. Only explicit architectural
      // shafts/courtyards are allowed to cut the floor plate.
      if (!["shaft", "courtyard"].includes(hole.type)) return false;
      if (hole.polygon.length < 3 || ventraPolygonArea(hole.polygon) < 0.20) return false;
      const centroid = ventraPolygonCentroid(hole.polygon);
      if (!ventraPointInPolygon(centroid, footprint)) return false;
      if (rooms.some((room) => ventraPointInPolygon(centroid, room.polygon))) return false;
      return hole.polygon.every((point) => ventraPointInPolygon(point, footprint));
    });

  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  const openings = [];
  for (const opening of Array.isArray(geometryInput?.openings) ? geometryInput.openings : []) {
    const center = ventraImagePointToMeters(opening?.center, bounds, widthMeters, depthMeters);
    let wall = wallMap.get(String(opening?.wallId || ""));
    let projection = wall ? ventraProjectPointToSegment(center, wall.start, wall.end) : null;

    if (!wall || !projection || projection.distance > 0.7) {
      let best = null;
      for (const candidate of walls) {
        const projected = ventraProjectPointToSegment(center, candidate.start, candidate.end);
        if (!best || projected.distance < best.projected.distance) best = { wall: candidate, projected };
      }
      if (best) {
        wall = best.wall;
        projection = best.projected;
      }
    }

    if (!wall || !projection || projection.distance > 1.5) continue;
    const type = opening?.type === "window" ? "window" : "door";
    openings.push({
      id: String(opening?.id || `opening_${openings.length + 1}`).slice(0, 60),
      type,
      wallId: wall.id,
      offset: clamp(projection.t, 0.02, 0.98, 0.5),
      width: clamp(opening?.widthMeters, 0.45, 4, type === "window" ? 1.4 : 0.9),
      height: clamp(opening?.heightMeters, 0.5, 3.2, type === "window" ? 1.2 : 2.1),
      sillHeight: type === "window" ? clamp(opening?.sillHeightMeters, 0, 2.2, 0.9) : 0,
      hinge: String(opening?.hingeSide || "start").slice(0, 20),
      swing: String(opening?.swingDirection || "").slice(0, 30),
    });
  }

  const assets = [];
  for (
    const rawAsset of
    Array.isArray(
      assetsInput?.assets
    )
      ? assetsInput.assets
      : []
  ) {
    const type =
      SCHEMATIC_ASSET_TYPES.includes(
        rawAsset?.type
      )
        ? rawAsset.type
        : "generic";

    const center =
      ventraImagePointToMeters(
        rawAsset?.center,
        bounds,
        widthMeters,
        depthMeters
      );

    let room =
      ventraFindRoomForPoint(
        center,
        rooms
      );

    if (!room && rawAsset?.roomHint) {
      const hint = String(rawAsset.roomHint).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      room = rooms.find((candidate) => {
        const hay = `${candidate?.id || ""} ${candidate?.name || ""} ${candidate?.type || ""}`
          .toLowerCase().replace(/[^a-z0-9]+/g, " ");
        return hint && (hay.includes(hint) || hint.includes(String(candidate?.name || "").toLowerCase()));
      }) || null;
    }

    if (!room) {
      continue;
    }

    const locked =
      ventraResolveRoomLockedAsset({
        asset: {
          ...rawAsset,
          // Image rotation is clockwise in a Y-down frame. After the Y flip
          // used by the metric scene, Three.js needs the opposite signed angle.
          rotation: -Number(rawAsset?.rotation || 0),
        },
        type,
        center,
        room,
        walls,
        openings,
        placedAssets:
          assets,
      });

    const fallbackDims = ventraAssetDefault(type);
    const roomCentroid = ventraPolygonCentroid(room.polygon);
    const preserved = locked || {
      type,
      roomId: room.id,
      xMeters: ventraPointInPolygon(center, room.polygon) ? center.x : roomCentroid.x,
      yMeters: ventraPointInPolygon(center, room.polygon) ? center.y : roomCentroid.y,
      width: clamp(rawAsset?.widthMeters, 0.15, widthMeters, fallbackDims[0]),
      depth: clamp(rawAsset?.depthMeters, 0.15, depthMeters, fallbackDims[1]),
      height: clamp(rawAsset?.heightMeters, 0.10, 3.2, fallbackDims[2]),
      rotation: -Number(rawAsset?.rotation || 0),
      placementSource: "vision_preserved_v41",
      againstWallId: null,
    };

    assets.push({
      ...preserved,

      // Keep legacy normalized coordinates for old consumers,
      // but the renderer now prefers xMeters/yMeters.
      x:
        clamp(
          preserved.xMeters /
            widthMeters,
          0.01,
          0.99,
          0.5
        ),

      y:
        clamp(
          preserved.yMeters /
            depthMeters,
          0.01,
          0.99,
          0.5
        ),
    });
  }

  console.log(
    "[VENTRA ROOM LOCKED ASSETS v17]",
    {
      detected:
        Array.isArray(
          assetsInput?.assets
        )
          ? assetsInput.assets
              .length
          : 0,
      placed:
        assets.length,
      rooms:
        rooms.length,
      withWallSnap:
        assets.filter(
          (asset) =>
            Boolean(
              asset.againstWallId
            )
        ).length,
    }
  );

  // V41: exact reconstruction means detected assets only. No inferred fixtures.
  const completedAssets = assets;

  const roomArea =
    rooms.reduce(
      (sum, room) =>
        sum +
        ventraPolygonArea(
          room.polygon
        ),
      0
    );

  const footprintArea =
    footprint.length >= 3
      ? ventraPolygonArea(footprint)
      : widthMeters * depthMeters;

  const areaRatio =
    roomArea /
    Math.max(
      1,
      footprintArea
    );

  if (
    areaRatio < 0.18 ||
    areaRatio > 1.45
  ) {
    throw new Error(
      `Room coverage validation failed (${areaRatio.toFixed(2)} of plan footprint).`
    );
  }

  return normalizeSchematicScene({
    sceneType: "apartment_floorplan",
    title: String(geometryInput?.title || "AI Floor Plan").slice(0, 120),
    width: widthMeters,
    depth: depthMeters,
    height: 2.8,
    footprint,
    holes,
    palette: {
      wall: "#B8B1A7",
      floor: "#92785D",
      ceiling: "#D7D1C7",
      accent: "#6D503B",
      glass: "#557F94",
      door: "#654736",
    },
    rooms,
    walls,
    openings,
    assets:
      completedAssets,
  });
}

function normalizePoint(point, width, depth) {
  return {
    x: clamp(point?.x, 0, width, 0),
    y: clamp(point?.y, 0, depth, 0),
  };
}

function normalizeSchematicScene(input = {}) {
  const width = clamp(input.width, 1.8, 80, 12.5);
  const depth = clamp(input.depth, 1.8, 80, 9.5);
  const height = clamp(input.height, 2.2, 6, 2.8);
  const palette = input.palette || {};

  const rooms = (Array.isArray(input.rooms) ? input.rooms : [])
    .slice(0, 30)
    .map((room, index) => ({
      id: String(room?.id || `room_${index + 1}`).slice(0, 60),
      name: String(room?.name || `Room ${index + 1}`).slice(0, 100),
      type: String(room?.type || "room").slice(0, 60),
      polygon: (Array.isArray(room?.polygon) ? room.polygon : [])
        .slice(0, 24)
        .map((point) => normalizePoint(point, width, depth)),
    }))
    .filter((room) => room.polygon.length >= 3);

  const walls = (Array.isArray(input.walls) ? input.walls : [])
    .slice(0, 120)
    .map((wall, index) => ({
      id: String(wall?.id || `wall_${index + 1}`).slice(0, 60),
      type: wall?.type === "external" ? "external" : "internal",
      start: normalizePoint(wall?.start, width, depth),
      end: normalizePoint(wall?.end, width, depth),
    }))
    .filter((wall) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) > 0.05);

  const wallIds = new Set(walls.map((wall) => wall.id));
  const openings = (Array.isArray(input.openings) ? input.openings : [])
    .slice(0, 60)
    .map((opening, index) => ({
      id: String(opening?.id || `opening_${index + 1}`).slice(0, 60),
      type: opening?.type === "window" ? "window" : "door",
      wallId: String(opening?.wallId || "").slice(0, 60),
      offset: clamp(opening?.offset, 0.02, 0.98, 0.5),
      width: clamp(opening?.width, 0.45, 4, opening?.type === "window" ? 1.4 : 0.9),
      height: clamp(opening?.height, 0.5, height, opening?.type === "window" ? 1.2 : 2.1),
      sillHeight: opening?.type === "window" ? clamp(opening?.sillHeight, 0, height - 0.3, 0.9) : 0,
      hinge: String(opening?.hinge || opening?.hingeSide || "start").slice(0, 20),
      swing: String(opening?.swing || opening?.swingDirection || "").slice(0, 30),
    }))
    .filter((opening) => wallIds.has(opening.wallId));

  const assets =
    (Array.isArray(
      input.assets
    )
      ? input.assets
      : []
    )
      .slice(0, 120)
      .map((asset) => {
        const xMeters =
          Number(
            asset?.xMeters
          );

        const yMeters =
          Number(
            asset?.yMeters
          );

        const resolvedX =
          Number.isFinite(
            xMeters
          )
            ? clamp(
                xMeters,
                0,
                width,
                width / 2
              )
            : clamp(
                asset?.x,
                0.01,
                0.99,
                0.5
              ) *
              width;

        const resolvedY =
          Number.isFinite(
            yMeters
          )
            ? clamp(
                yMeters,
                0,
                depth,
                depth / 2
              )
            : clamp(
                asset?.y,
                0.01,
                0.99,
                0.5
              ) *
              depth;

        return {
          type:
            SCHEMATIC_ASSET_TYPES.includes(
              asset?.type
            )
              ? asset.type
              : "generic",

          roomId:
            asset?.roomId
              ? String(
                  asset.roomId
                ).slice(
                  0,
                  60
                )
              : null,

          againstWallId:
            asset?.againstWallId
              ? String(
                  asset.againstWallId
                ).slice(
                  0,
                  60
                )
              : null,

          placementSource:
            String(
              asset?.placementSource ||
              ""
            ).slice(
              0,
              60
            ),

          xMeters:
            resolvedX,

          yMeters:
            resolvedY,

          x:
            clamp(
              resolvedX /
                width,
              0.01,
              0.99,
              0.5
            ),

          y:
            clamp(
              resolvedY /
                depth,
              0.01,
              0.99,
              0.5
            ),

          width:
            clamp(
              asset?.width,
              0.15,
              width,
              0.8
            ),

          depth:
            clamp(
              asset?.depth,
              0.15,
              depth,
              0.8
            ),

          height:
            clamp(
              asset?.height,
              0.1,
              height,
              0.8
            ),

          rotation:
            clamp(
              asset?.rotation,
              -360,
              360,
              0
            ),
        };
      });

  return {
    sceneType: String(input.sceneType || (rooms.length > 1 ? "apartment_floorplan" : "room")).slice(0, 60),
    title: String(input.title || "AI Structured Floor Plan").slice(0, 120),
    width,
    depth,
    height,
    wallThickness: 0.12,
    externalWallThickness: 0.18,
    cutawayHeight: 1.35,
    footprint: (Array.isArray(input.footprint) ? input.footprint : [])
      .slice(0, 64)
      .map((point) => normalizePoint(point, width, depth)),
    holes: (Array.isArray(input.holes) ? input.holes : [])
      .slice(0, 24)
      .map((hole, index) => ({
        id: String(hole?.id || `hole_${index + 1}`).slice(0, 60),
        type: ["shaft", "void", "courtyard", "opening"].includes(hole?.type)
          ? hole.type
          : "void",
        polygon: (Array.isArray(hole?.polygon) ? hole.polygon : [])
          .slice(0, 32)
          .map((point) => normalizePoint(point, width, depth)),
      }))
      .filter((hole) => hole.polygon.length >= 3),
    palette: {
      wall: safeColor(palette.wall, "#E2DDD4"),
      floor: safeColor(palette.floor, "#C7B18E"),
      ceiling: safeColor(palette.ceiling, "#F3F0E8"),
      accent: safeColor(palette.accent, "#765A44"),
      glass: safeColor(palette.glass, "#7897AA"),
      door: safeColor(palette.door, "#745039"),
    },
    rooms,
    walls,
    openings,
    assets,
  };
}

// V42: no plan-specific hard-coded reconstruction templates.
// JPG/PNG/WebP geometry is always image-grounded.

function ventraSceneHealth(scene = {}) {
  const rooms = Array.isArray(scene?.rooms) ? scene.rooms : [];
  const walls = Array.isArray(scene?.walls) ? scene.walls : [];
  const openings = Array.isArray(scene?.openings) ? scene.openings : [];
  const assets = Array.isArray(scene?.assets) ? scene.assets : [];
  const width = Number(scene?.width) || 0;
  const depth = Number(scene?.depth) || 0;
  const footprint = Array.isArray(scene?.footprint) ? scene.footprint : [];
  const holes = Array.isArray(scene?.holes) ? scene.holes : [];
  const measuredFootprintArea = footprint.length >= 3 ? ventraPolygonArea(footprint) : 0;
  const holeArea = holes.reduce(
    (sum, hole) => sum + ventraPolygonArea(Array.isArray(hole?.polygon) ? hole.polygon : []),
    0
  );
  const footprintArea = Math.max(1, (measuredFootprintArea - holeArea) || (width * depth));
  const roomArea = rooms.reduce((sum, room) => sum + ventraPolygonArea(room?.polygon || []), 0);
  const coverage = roomArea / footprintArea;
  const wallIds = new Set(walls.map((wall) => String(wall?.id || "")));
  const attachedOpenings = openings.filter((opening) => wallIds.has(String(opening?.wallId || ""))).length;
  const roomIds = new Set(rooms.map((room) => String(room?.id || "")));
  const anchoredAssets = assets.filter((asset) => roomIds.has(String(asset?.roomId || ""))).length;
  let overlapArea = 0;
  for (let i = 0; i < rooms.length; i += 1) {
    const a = ventraMetricRoomBounds(rooms[i]);
    if (!a) continue;
    for (let j = i + 1; j < rooms.length; j += 1) {
      const b = ventraMetricRoomBounds(rooms[j]);
      if (!b) continue;
      const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
      const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
      overlapArea += ix * iy;
    }
  }
  const overlapRatio = overlapArea / footprintArea;
  const openingRatio = openings.length ? attachedOpenings / openings.length : 1;
  const assetRatio = assets.length ? anchoredAssets / assets.length : 1;
  let score = 1;
  if (rooms.length < 2) score -= 0.45;
  if (walls.length < Math.max(4, rooms.length + 2)) score -= 0.20;
  if (coverage < 0.72) score -= Math.min(0.45, (0.72 - coverage) * 1.15);
  if (coverage > 1.04) score -= Math.min(0.45, (coverage - 1.04) * 1.25);
  if (overlapRatio > 0.03) score -= Math.min(0.40, overlapRatio * 2.4);
  if (openingRatio < 0.82) score -= (0.82 - openingRatio) * 0.45;
  if (assetRatio < 0.72) score -= (0.72 - assetRatio) * 0.30;
  const footprintPointCount = footprint.length;
  const gapRatio = Math.max(0, 1 - Math.min(1, coverage));
  if (footprintPointCount < 3) score -= 0.18;
  if (gapRatio > 0.05) score -= Math.min(0.35, (gapRatio - 0.05) * 1.25);
  return { score: Math.max(0, Math.min(1, score)), roomCount: rooms.length, wallCount: walls.length, openingCount: openings.length, assetCount: assets.length, footprintPointCount, footprintArea, coverage, gapRatio, overlapRatio, openingRatio, assetRatio };
}

async function handleSchematicRequest(body) {
  const mode = body?.mode === "schematic_edit" ? "edit" : "analyze";

  console.log("[VENTRA GENERIC FLOORPLAN ENGINE v15]", {
    version: VENTRA_JPG_FLOORPLAN_ROUTE_VERSION,
    mode,
    fileName: body?.fileName || null,
    hasImageUrl: Boolean(body?.imageUrl),
  });

  if (mode === "edit") {
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required." }, { status: 400 });
    }

    try {
      const model = process.env.OPENAI_SCHEMATIC_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5-mini";
      const response = await withSoftTimeout(
        createResponse({
          model,
          input: [{
            role: "user",
            content: [{
              type: "input_text",
              text: `Edit this existing schematic scene according to the user's visual/style request. Preserve ALL room polygons, walls, openings, dimensions and topology unless the user explicitly asks to change layout. User prompt: ${prompt}\nCurrent scene: ${JSON.stringify(body?.scene || {})}`,
            }],
          }],
          text: { format: { type: "json_schema", name: "ventra_schematic_edit", strict: true, schema: schematicSceneSchema } },
        }),
        OPENAI_SOFT_TIMEOUT_MS
      );
      const scene = normalizeSchematicScene(extractJson(response.output_text));
      return NextResponse.json({ scene, source: "openai-schematic-edit-v15", mode, routeVersion: VENTRA_JPG_FLOORPLAN_ROUTE_VERSION });
    } catch (error) {
      const existing = normalizeSchematicScene(body?.scene || {});
      return NextResponse.json({ scene: existing, source: "existing-scene-edit-fallback-v15", mode, routeVersion: VENTRA_JPG_FLOORPLAN_ROUTE_VERSION });
    }
  }

  const imageUrl = String(body?.imageUrl || "").trim();
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
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
1. Follow the exterior footprint, including EVERY visible notch/recess; do not use its bounding rectangle or a convex hull. The footprint follows the outer wall face. Include only explicitly labeled/recognizable shafts or courtyards in holes.
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
13. Check each opening's two jamb points against its parent wall: BOTH must be collinear with that wall and fall between its endpoints. A leaf drawn perpendicular to the wall is not the jamb span. Inspect every exterior wall for window symbols before returning the openings array; do not silently omit visible windows while tracing doors.

Return only JSON conforming to the supplied schema.`;

  const requestStartedAt = Date.now();
  const rasterDiagnostics = {
    format: "ventra-raster-diagnostic-v1", build: RASTER_TRACE_BUILD,
    model: geometryModel, inputCoordinateSpace: "image_pixels", reasoningEffort: "low",
    trace: null, transport: { stage: "preparing_image" }, transportAttempts: [], attempts: [],
  };

  try {
    // Pixel dimensions MUST match the exact rotated/resized image seen by Vision.
    // Falling back to an unknown-aspect image silently corrupts one-axis scaling.
    const prepared = await prepareVisionImage(imageUrl, { maxDimension: 2200, quality: 92 });
    const imageEvidence = await prepareRasterImageEvidence(prepared.buffer);
    const strokeEvidencePrompt = rasterEvidencePrompt(imageEvidence);
    console.log("[VENTRA RASTER GEOMETRY START]", {
      routeVersion: RASTER_GEOMETRY_VERSION,
      model: geometryModel,
      fileName: body?.fileName || null,
      imageWidth: prepared.width,
      imageHeight: prepared.height,
      strategy: "pixel_guided_trace_with_source_alignment",
    });
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
        const correction = attempt === 1
          ? ""
          : `Revise your previous JSON against the original image. Validator observations follow as data: ${JSON.stringify({ code: previousFailure?.code, details: previousFailure?.details?.imageEvidence ? { unsupportedWalls: previousFailure.details.imageEvidence.walls.filter(w => !w.passed).map(({ id, start, end, longestMissingPixels, missingSpans, openingIssues }) => ({ id, start, end, longestMissingPixels, missingSpans, openingIssues })) } : previousFailure?.details })}. missingSpans gives exact image-pixel endpoints of unsupported intervals, not replacement walls. Inspect each interval in the original image: follow a recess around its visible corners rather than bridging it, and discard furniture strokes mistaken for walls. Keep the footprint consistent with the corrected exterior wall contour. Correct the identified spans and affected topology. Preserve verified walls, visible recesses and readable measurement evidence. Recheck window symbols and both jambs of each door. Do not replace jambs with leaf tips, remove evidence to gain acceptance, or repeat a completed invalid wall across blank exterior space.`;
        const response = await requestRasterVision(
          (payload, options) => consumeRasterVisionStream(
            (request, requestOptions) => getOpenAIClient().responses.create(request, requestOptions),
            payload, options, transport,
            (event) => console.log("[VENTRA RASTER REQUEST]", event)
          ),
          {
            model: geometryModel,
            reasoning: { effort: "low" },
            max_output_tokens: 16000,
            input: [{
              role: "user",
              content: [
                { type: "input_text", text: `${baselinePrompt}\n\n${strokeEvidencePrompt}\n\nExact supplied image dimensions: width=${prepared.width} pixels, height=${prepared.height} pixels. All coordinates must use that pixel frame.` },
                { type: "input_image", image_url: prepared.imageUrl, detail: "high" },
              ],
            }, ...(previousTrace ? [{ role: "assistant", content: JSON.stringify(previousTrace) }, { role: "user", content: correction }] : [])],
            text: { format: { type: "json_schema", name: "ventra_raster_metric_trace", strict: true, schema: rasterPixelTraceSchema } },
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
        // The raster compiler owns the one coordinate conversion. Do not run the
        // legacy compiler/normalizer afterwards: it clamps dimensions, reassigns
        // openings, truncates polygons and may replace the footprint with a hull.
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
          imageAgreement: scene.geometryValidation.imageAgreement,
        });
        return NextResponse.json({
          scene,
          diagnostics: { ...rasterDiagnostics, accepted: true, validation: scene.geometryValidation },
          source: attempt > 1 ? "openai-bounded-correction-raster-metric-trace" : "openai-single-pass-raster-metric-trace",
          mode,
          confidence: rawGeometry.confidence,
          // Passing geometric invariants is not proof of correct image recognition.
          needsManualReview: true,
          warning: "Wall pixel support and structural checks passed. Room labels, opening interpretation and completeness still require comparison with the source image. Unannotated heights remain schematic assumptions.",
          validation: scene.geometryValidation,
          routeVersion: RASTER_GEOMETRY_VERSION,
        });
      } catch (error) {
        const failure = { code: error?.code || null, message: error?.message || "Raster trace failed.", details: error instanceof RasterGeometryError || error?.name === "RasterImageEvidenceError" ? error.details : undefined };
        rasterDiagnostics.attempts.push({ ...attemptDiagnostic, ...failure, failure, elapsedMs: Date.now() - startedAt });
        if (attempt < RASTER_TRACE_MAX_ATTEMPTS && shouldRetryRasterGeometry(error) && Date.now() - requestStartedAt < OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS) {
          previousFailure = error;
          previousTrace = attemptDiagnostic.rawPixelTrace || null;
          console.warn("[VENTRA RASTER GEOMETRY RETRY]", { attempt, nextAttempt: attempt + 1, code: error.code, message: error.message });
          continue;
        }
        throw error;
      }
    }
    throw new RasterGeometryError("INCOMPLETE_TRACE", "The image analysis did not produce an accepted trace. No new 3D scene was saved.");
  } catch (error) {
    rasterDiagnostics.elapsedMs = Date.now() - requestStartedAt;
    const geometryFailure = error instanceof RasterGeometryError || error?.name === "RasterImageEvidenceError";
    const details = geometryFailure ? error.details : undefined;
    console.error("[VENTRA RASTER GEOMETRY REJECTED]", JSON.stringify({ build: RASTER_TRACE_BUILD, code: error?.code, message: error?.message, attempts: rasterDiagnostics.attempts.map(({ attempt, code, elapsedMs }) => ({ attempt, code, elapsedMs })), transport: rasterDiagnostics.transport }, null, 2));
    return NextResponse.json({
      error: error?.message || "Could not reconstruct this floor plan.",
      diagnostics: { ...rasterDiagnostics, accepted: false, failure: { code: error?.code, message: error?.message, details } },
      code: String(error?.code || "").startsWith("RASTER_VISION_") ? error.code : error?.status === 429 ? "OPENAI_BILLING_OR_RATE_LIMIT" : geometryFailure ? error.code : "FLOORPLAN_NEEDS_REVIEW",
      details,
      needsManualReview: true,
      routeVersion: RASTER_GEOMETRY_VERSION,
    }, { status: error?.code === "RASTER_VISION_TIMEOUT" ? 504 : String(error?.code || "").startsWith("RASTER_VISION_") ? 502 : error?.status === 429 ? 429 : 422 });
  }
}

async function handleCommercialRequest(request) {
  try {
    const body = await request.json();
    if (body?.mode === "schematic_analyze" || body?.mode === "schematic_edit") {
      // Important: await here so asynchronous failures from the schematic
      // pipeline are caught by this POST handler instead of escaping as a
      // framework-generated 500/HTML response.
      return await handleSchematicRequest(body);
    }

    const prompt = String(body?.prompt || "").trim();

    if (!prompt) {
      return NextResponse.json({ error: "Design prompt is required." }, { status: 400 });
    }

    try {
      const response = await withSoftTimeout(createResponse({
        model: process.env.OPENAI_DESIGN_MODEL || "gpt-5.1",
        input: [
          {
            role: "system",
            content: `You are the Ventra 3D design controller. Translate an architectural interior/facade design request into a SAFE visual design configuration. Never change structural dimensions, wall positions, door/window positions, storey count, BOQ, quantities, or engineering data. Return ONLY one JSON object, no markdown. Required schema: {"style":"short name","palette":{"interiorWall":"#RRGGBB","facade":"#RRGGBB","floor":"#RRGGBB","ceiling":"#RRGGBB","door":"#RRGGBB","glass":"#RRGGBB","accent":"#RRGGBB"},"floorFinish":"short description","facadeFinish":"short description","wallShininess":0-100,"facadeShininess":0-100,"floorShininess":0-100,"glassOpacity":0.2-0.85,"features":{"floorFinish":true,"baseboards":true,"ceiling":false,"facadeBand":false}}. Enable ceiling only when the user explicitly asks for a ceiling. Enable facadeBand only when useful or explicitly requested.`,
          },
          {
            role: "user",
            content: JSON.stringify({ prompt, projectContext: body?.context || {} }),
          },
        ],
      }));

      const parsed = extractJson(response.output_text);
      return NextResponse.json({ design: normalizeDesign(parsed), source: "openai" });
    } catch (error) {
      console.warn("[VENTRA DESIGN AI] falling back to deterministic design parser", error?.message || error);
      return NextResponse.json({ design: normalizeDesign(fallbackDesign(prompt)), source: "fallback" });
    }
  } catch (error) {
    console.error(
      "[VENTRA DESIGN-3D API UNHANDLED v36.1]",
      error?.stack ||
      error?.message ||
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Could not create a 3D design plan.",
        code:
          "DESIGN_3D_API_UNHANDLED",
        routeVersion:
          VENTRA_JPG_FLOORPLAN_ROUTE_VERSION,
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}

export async function POST(request){return commercialRun(request,'design',handleCommercialRequest);}
