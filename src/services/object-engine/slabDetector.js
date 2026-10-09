// src/services/object-engine/slabDetector.js

import {
  boundingBox,
  polylineLength,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectSlabs(geometry = {}) {
  const entities = geometry.entities || geometry.polygons || [];

  const slabs = [];

  entities.forEach((entity, index) => {
    if (!hasLayer(entity, ["slab", "floor", "deck"])) return;

    const points = entity.points || [];

    if (points.length < 3) return;

    const box = boundingBox(points);

    slabs.push({
      id: createObjectId("SLAB", index),

      type: "Slab",

      layer: entity.layer || "Unknown",

      points,

      boundingBox: box,

      area:
        entity.area != null
          ? Number(entity.area.toFixed(3))
          : null,

      perimeter: Number(polylineLength(points).toFixed(3)),

      thickness: entity.thickness || null,

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

  return slabs;
}

export default detectSlabs;