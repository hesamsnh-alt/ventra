// src/services/object-engine/beamDetector.js

import {
  distance,
  midpoint,
  angle,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectBeams(geometry = {}) {
  const entities = geometry.entities || geometry.lines || [];

  const beams = [];

  entities.forEach((entity, index) => {
    if (!hasLayer(entity, ["beam", "beams", "girder"])) return;

    const start = entity.start || entity.startPoint || entity.p1;
    const end = entity.end || entity.endPoint || entity.p2;

    if (!start || !end) return;

    beams.push({
      id: createObjectId("BEAM", index),

      type: "Beam",

      layer: entity.layer || "Unknown",

      start,

      end,

      center: midpoint(start, end),

      length: Number(distance(start, end).toFixed(3)),

      angle: Number(angle(start, end).toFixed(4)),

      width: entity.width || null,

      depth: entity.depth || null,

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

  return beams;
}

export default detectBeams;