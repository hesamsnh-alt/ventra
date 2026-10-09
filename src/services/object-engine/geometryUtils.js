// src/services/object-engine/geometryUtils.js

export function distance(p1, p2) {
  if (!p1 || !p2) return 0;

  const dx = (p2.x || 0) - (p1.x || 0);
  const dy = (p2.y || 0) - (p1.y || 0);

  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(p1, p2) {
  return {
    x: ((p1?.x || 0) + (p2?.x || 0)) / 2,
    y: ((p1?.y || 0) + (p2?.y || 0)) / 2,
  };
}

export function angle(p1, p2) {
  return Math.atan2(
    (p2?.y || 0) - (p1?.y || 0),
    (p2?.x || 0) - (p1?.x || 0)
  );
}

export function boundingBox(points = []) {
  if (!points.length) {
    return null;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function polylineLength(points = []) {
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }

  return total;
}

export function isHorizontal(p1, p2, tolerance = 0.01) {
  return Math.abs((p1?.y || 0) - (p2?.y || 0)) < tolerance;
}

export function isVertical(p1, p2, tolerance = 0.01) {
  return Math.abs((p1?.x || 0) - (p2?.x || 0)) < tolerance;
}

export function normalizeLayerName(name = "") {
  return String(name).trim().toLowerCase();
}

export function hasLayer(entity, keywords = []) {
  const layer = normalizeLayerName(entity?.layer);

  return keywords.some((k) => layer.includes(k.toLowerCase()));
}

export function createObjectId(prefix, index) {
  return `${prefix}_${index + 1}`;
}