// src/services/object-engine/columnDetector.js

import {
  boundingBox,
  createObjectId,
  hasLayer,
} from "./geometryUtils";

export function detectColumns(geometry = {}) {
  const entities = geometry.entities || geometry.lines || [];

  const columns = [];

  entities.forEach((entity, index) => {
    if (!hasLayer(entity, ["column", "columns", "col"])) return;

    const points =
      entity.points ||
      [
        entity.start || entity.startPoint || entity.p1,
        entity.end || entity.endPoint || entity.p2,
      ].filter(Boolean);

    if (points.length < 2) return;

    const box = boundingBox(points);

    columns.push({
      id: createObjectId("COLUMN", index),

      type: "Column",

      layer: entity.layer || "Unknown",

      boundingBox: box,

      center: {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
      },

      width: Number(box.width.toFixed(3)),

      height: Number(box.height.toFixed(3)),

      area: Number((box.width * box.height).toFixed(3)),

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

  return columns;
}

export default detectColumns;