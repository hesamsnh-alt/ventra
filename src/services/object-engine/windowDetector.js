// src/services/object-engine/windowDetector.js

import {
  distance,
  midpoint,
  angle,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectWindows(geometry = {}) {
  const entities = geometry.entities || geometry.lines || [];

  const windows = [];

  entities.forEach((entity, index) => {
    if (!hasLayer(entity, ["window", "windows"])) return;

    const start = entity.start || entity.startPoint || entity.p1;
    const end = entity.end || entity.endPoint || entity.p2;

    if (!start || !end) return;

    const width = Number(distance(start, end).toFixed(3));

    windows.push({
      id: createObjectId("WINDOW", index),

      type: "Window",

      layer: entity.layer || "Unknown",

      start,

      end,

      center: midpoint(start, end),

      width,

      height: entity.height || null,

      sillHeight: entity.sillHeight || null,

      angle: Number(angle(start, end).toFixed(4)),

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

  return windows;
}

export default detectWindows;