// src/services/object-engine/wallDetector.js

import {
  distance,
  midpoint,
  angle,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectWalls(geometry = {}) {
  const entities = geometry.entities || geometry.lines || [];

  const walls = [];

  entities.forEach((entity, index) => {
    // فقط آبجکت‌های لایه Wall
    if (!hasLayer(entity, ["wall", "walls"])) return;

    const start = entity.start || entity.startPoint || entity.p1;
    const end = entity.end || entity.endPoint || entity.p2;

    if (!start || !end) return;

    walls.push({
      id: createObjectId("WALL", index),

      type: "Wall",

      layer: entity.layer || "Unknown",

      start,

      end,

      center: midpoint(start, end),

      length: Number(distance(start, end).toFixed(3)),

      angle: Number(angle(start, end).toFixed(4)),

      thickness: entity.thickness || null,

      elevation: entity.elevation || 0,

      closed: entity.closed || false,

      color: entity.color || null,

      sourceId:
        entity.dbId ||
        entity.objectId ||
        entity.id ||
        null,

      raw: entity,
    });
  });

  return walls;
}

export default detectWalls;