// src/services/object-engine/doorDetector.js

import {
  distance,
  midpoint,
  angle,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectDoors(geometry = {}) {
  const entities = geometry.entities || geometry.lines || [];

  const doors = [];

  entities.forEach((entity, index) => {
    if (!hasLayer(entity, ["door", "doors"])) return;

    const start = entity.start || entity.startPoint || entity.p1;
    const end = entity.end || entity.endPoint || entity.p2;

    if (!start || !end) return;

    doors.push({
      id: createObjectId("DOOR", index),

      type: "Door",

      layer: entity.layer || "Unknown",

      start,

      end,

      center: midpoint(start, end),

      width: Number(distance(start, end).toFixed(3)),

      angle: Number(angle(start, end).toFixed(4)),

      swing: entity.swing || null,

      elevation: entity.elevation || 0,

      color: entity.color || null,

      sourceId:
        entity.dbId ||
        entity.objectId ||
        entity.id ||
        null,

      raw: entity,
    });
  });

  return doors;
}

export default detectDoors;