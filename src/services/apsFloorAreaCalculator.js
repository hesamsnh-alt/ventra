function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getObjectSearchText(object) {
  const properties = Array.isArray(object?.properties)
    ? object.properties
    : Array.isArray(object?.rawProperties)
      ? object.rawProperties
      : [];

  return [
    object?.name,
    object?.category,
    object?.family,
    object?.type,
    ...properties.flatMap((property) => [
      property?.displayName,
      property?.displayValue,
      property?.displayCategory,
      property?.attributeName,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getWallDbIds(objects) {
  return new Set(
    (Array.isArray(objects) ? objects : [])
      .filter((object) =>
        /(^|[^a-z])(?:walls?|partitions?|room boundary|space boundary)([^a-z]|$)/i.test(
          getObjectSearchText(object)
        )
      )
      .map((object) => object?.dbId)
      .filter((dbId) => dbId !== null && dbId !== undefined)
  );
}

function getArchitecturalDbIds(objects) {
  const include = /(?:wall|partition|room boundary|space boundary|door|window|opening|column|shaft|stair|railing|curtain|glazing|architectural|a-wall|a-door|a-window)/i;
  const exclude = /(?:text|mtext|annotation|dimension|dim |hatch|pattern|furniture|fixture|equipment|sanitary|plumbing|electrical|lighting|ceiling|title|legend|schedule|symbol|detail|section|elevation|grid|axis|landscape|plant|vehicle|car|table|chair|bed|sofa|cabinet|wardrobe)/i;

  return new Set(
    (Array.isArray(objects) ? objects : [])
      .filter((object) => {
        const text = getObjectSearchText(object);
        return include.test(text) && !exclude.test(text);
      })
      .map((object) => object?.dbId)
      .filter((dbId) => dbId !== null && dbId !== undefined)
  );
}

function getExcludedAnnotationDbIds(objects) {
  const exclude = /(?:text|mtext|annotation|dimension|dim |hatch|pattern|furniture|fixture|equipment|sanitary|plumbing|electrical|lighting|ceiling|title|legend|schedule|symbol|detail|section|elevation|grid|axis|landscape|plant|vehicle|car|table|chair|bed|sofa|cabinet|wardrobe)/i;

  return new Set(
    (Array.isArray(objects) ? objects : [])
      .filter((object) => exclude.test(getObjectSearchText(object)))
      .map((object) => object?.dbId)
      .filter((dbId) => dbId !== null && dbId !== undefined)
  );
}

function getBounds(segments) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const segment of Array.isArray(segments) ? segments : []) {
    for (const point of [segment?.start, segment?.end]) {
      const x = toFiniteNumber(point?.x);
      const y = toFiniteNumber(point?.y);
      if (x === null || y === null) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    diagonal: Math.hypot(maxX - minX, maxY - minY),
  };
}

function signedPolygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function polygonPerimeter(points) {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    perimeter += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return perimeter;
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared
    )
  );
  const projected = { x: start.x + t * dx, y: start.y + t * dy };
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

function projectPointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return null;

  const t =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
    lengthSquared;
  if (t <= 1e-6 || t >= 1 - 1e-6) return null;

  return {
    t,
    point: { x: start.x + t * dx, y: start.y + t * dy },
  };
}

function segmentIntersection(a, b, tolerance) {
  const p = a.start;
  const q = b.start;
  const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const denominator = cross(r, s);
  const qMinusP = { x: q.x - p.x, y: q.y - p.y };
  const scale = Math.max(Math.hypot(r.x, r.y), Math.hypot(s.x, s.y), 1);

  if (Math.abs(denominator) <= tolerance * scale) return null;

  const t = cross(qMinusP, s) / denominator;
  const u = cross(qMinusP, r) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) {
    return null;
  }

  return { t, u, point: { x: p.x + t * r.x, y: p.y + t * r.y } };
}

function sanitizeSegments(segments, tolerance, meterFactor) {
  const factor = toFiniteNumber(meterFactor);
  const unitsPerMeter = factor && factor > 0 ? 1 / factor : 1;
  const minimumLength = Math.max(tolerance * 2, 0.025 * unitsPerMeter);
  const seen = new Set();
  const quantize = (value) => Math.round(value / tolerance);

  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const x1 = toFiniteNumber(segment?.start?.x);
      const y1 = toFiniteNumber(segment?.start?.y);
      const x2 = toFiniteNumber(segment?.end?.x);
      const y2 = toFiniteNumber(segment?.end?.y);
      if ([x1, y1, x2, y2].some((value) => value === null)) return null;

      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < minimumLength) return null;

      const first = `${quantize(x1)}:${quantize(y1)}`;
      const second = `${quantize(x2)}:${quantize(y2)}`;
      const key = first < second ? `${first}|${second}` : `${second}|${first}`;
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        ...segment,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        length,
      };
    })
    .filter(Boolean);
}

function snapDanglingEndpointsToSegments(segments, tolerance, meterFactor) {
  const source = Array.isArray(segments) ? segments : [];
  if (source.length < 3) return source;

  const factor = toFiniteNumber(meterFactor);
  const unitsPerMeter = factor && factor > 0 ? 1 / factor : 1;
  const maximumSnap = Math.max(tolerance * 8, 0.18 * unitsPerMeter);
  const endpointTolerance = Math.max(tolerance * 3, 0.02 * unitsPerMeter);

  const endpoints = [];
  source.forEach((segment, segmentIndex) => {
    endpoints.push({ segmentIndex, side: "start", point: segment.start });
    endpoints.push({ segmentIndex, side: "end", point: segment.end });
  });

  const degrees = endpoints.map((endpoint, index) => {
    let degree = 1;
    for (let other = 0; other < endpoints.length; other += 1) {
      if (other === index) continue;
      if (
        Math.hypot(
          endpoint.point.x - endpoints[other].point.x,
          endpoint.point.y - endpoints[other].point.y
        ) <= endpointTolerance
      ) {
        degree += 1;
      }
    }
    return degree;
  });

  const connectors = [];
  const used = new Set();

  endpoints.forEach((endpoint, endpointIndex) => {
    if (degrees[endpointIndex] > 1 || used.has(endpointIndex)) return;

    let best = null;
    source.forEach((target, targetIndex) => {
      if (targetIndex === endpoint.segmentIndex) return;
      const projection = projectPointToSegment(endpoint.point, target.start, target.end);
      if (!projection) return;
      const distance = Math.hypot(
        endpoint.point.x - projection.point.x,
        endpoint.point.y - projection.point.y
      );
      if (distance > maximumSnap) return;

      const sourceSegment = source[endpoint.segmentIndex];
      const sdx = sourceSegment.end.x - sourceSegment.start.x;
      const sdy = sourceSegment.end.y - sourceSegment.start.y;
      const tdx = target.end.x - target.start.x;
      const tdy = target.end.y - target.start.y;
      const sourceLength = Math.hypot(sdx, sdy) || 1;
      const targetLength = Math.hypot(tdx, tdy) || 1;
      const perpendicularity = Math.abs((sdx * tdx + sdy * tdy) / (sourceLength * targetLength));

      const score = distance + perpendicularity * maximumSnap * 0.35;
      if (!best || score < best.score) {
        best = { targetIndex, projection, distance, score };
      }
    });

    if (!best) return;
    used.add(endpointIndex);
    connectors.push({
      dbId: null,
      fragmentId: null,
      viewportId: source[endpoint.segmentIndex]?.viewportId ?? null,
      start: { ...endpoint.point },
      end: { ...best.projection.point },
      length: best.distance,
      synthetic: true,
      syntheticReason: "snap_dangling_partition_to_boundary",
    });
  });

  return connectors.length ? [...source, ...connectors] : source;
}

function bridgeLikelyDoorOpenings(segments, tolerance, meterFactor) {
  const source = Array.isArray(segments) ? segments : [];
  if (source.length < 3) return source;

  const factor = toFiniteNumber(meterFactor);
  const unitsPerMeter = factor && factor > 0 ? 1 / factor : 1;
  const minimumGap = Math.max(tolerance * 4, 0.06 * unitsPerMeter);
  const maximumGap = 1.8 * unitsPerMeter;
  const endpointTolerance = Math.max(tolerance * 3, 0.025 * unitsPerMeter);

  const endpoints = [];
  source.forEach((segment, segmentIndex) => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= tolerance) return;
    endpoints.push({
      segmentIndex,
      point: segment.start,
      ux: dx / length,
      uy: dy / length,
      viewportId: segment?.viewportId ?? null,
    });
    endpoints.push({
      segmentIndex,
      point: segment.end,
      ux: dx / length,
      uy: dy / length,
      viewportId: segment?.viewportId ?? null,
    });
  });

  const degrees = endpoints.map((endpoint, index) => {
    let degree = 1;
    for (let other = 0; other < endpoints.length; other += 1) {
      if (other === index || endpoints[other].segmentIndex === endpoint.segmentIndex) continue;
      if (
        Math.hypot(
          endpoint.point.x - endpoints[other].point.x,
          endpoint.point.y - endpoints[other].point.y
        ) <= endpointTolerance
      ) {
        degree += 1;
      }
    }
    return degree;
  });

  const bridgeIntersectsExisting = (bridge) => {
    for (const segment of source) {
      const intersection = segmentIntersection(bridge, segment, tolerance);
      if (!intersection) continue;
      const atBridgeEnd = intersection.t <= 1e-5 || intersection.t >= 1 - 1e-5;
      const atSegmentEnd = intersection.u <= 1e-5 || intersection.u >= 1 - 1e-5;
      if (!atBridgeEnd && !atSegmentEnd) return true;
    }
    return false;
  };

  const candidates = [];
  for (let i = 0; i < endpoints.length; i += 1) {
    if (degrees[i] > 3) continue;
    for (let j = i + 1; j < endpoints.length; j += 1) {
      if (degrees[j] > 3 || endpoints[i].segmentIndex === endpoints[j].segmentIndex) continue;
      if (
        endpoints[i].viewportId !== null &&
        endpoints[j].viewportId !== null &&
        endpoints[i].viewportId !== endpoints[j].viewportId
      ) {
        continue;
      }

      const vx = endpoints[j].point.x - endpoints[i].point.x;
      const vy = endpoints[j].point.y - endpoints[i].point.y;
      const distance = Math.hypot(vx, vy);
      if (distance < minimumGap || distance > maximumGap) continue;

      const cx = vx / distance;
      const cy = vy / distance;
      const parallel = Math.abs(endpoints[i].ux * endpoints[j].ux + endpoints[i].uy * endpoints[j].uy);
      const alignedA = Math.abs(endpoints[i].ux * cx + endpoints[i].uy * cy);
      const alignedB = Math.abs(endpoints[j].ux * cx + endpoints[j].uy * cy);

      const collinearGap = parallel >= 0.92 && alignedA >= 0.86 && alignedB >= 0.86;
      const shortDraftingGap = distance <= 0.22 * unitsPerMeter && parallel >= 0.72;
      if (!collinearGap && !shortDraftingGap) continue;

      const bridge = {
        dbId: null,
        fragmentId: null,
        viewportId: endpoints[i].viewportId ?? endpoints[j].viewportId ?? null,
        start: { ...endpoints[i].point },
        end: { ...endpoints[j].point },
        length: distance,
        synthetic: true,
        syntheticReason: "close_collinear_door_or_wall_gap",
      };
      if (bridgeIntersectsExisting(bridge)) continue;

      const score =
        distance +
        (1 - parallel) * maximumGap +
        (1 - alignedA) * maximumGap +
        (1 - alignedB) * maximumGap +
        Math.max(0, degrees[i] - 1) * maximumGap * 0.03 +
        Math.max(0, degrees[j] - 1) * maximumGap * 0.03;

      candidates.push({ i, j, bridge, score });
    }
  }

  candidates.sort((left, right) => left.score - right.score);
  const used = new Set();
  const bridges = [];
  const maxBridgeCount = Math.min(500, Math.ceil(source.length * 0.12));

  for (const candidate of candidates) {
    if (bridges.length >= maxBridgeCount) break;
    if (used.has(candidate.i) || used.has(candidate.j)) continue;
    used.add(candidate.i);
    used.add(candidate.j);
    bridges.push(candidate.bridge);
  }

  return bridges.length ? [...source, ...bridges] : source;
}

function splitSegmentsAtIntersections(segments, tolerance) {
  const validSegments = (Array.isArray(segments) ? segments : []).filter(
    (segment) =>
      segment?.start &&
      segment?.end &&
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y
      ) > tolerance
  );

  const splitParameters = validSegments.map(() => [0, 1]);
  const addParameter = (list, value) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(1, Math.max(0, value));
    if (!list.some((existing) => Math.abs(existing - clamped) <= 1e-9)) {
      list.push(clamped);
    }
  };

  for (let i = 0; i < validSegments.length; i += 1) {
    for (let j = i + 1; j < validSegments.length; j += 1) {
      const intersection = segmentIntersection(validSegments[i], validSegments[j], tolerance);
      if (intersection) {
        addParameter(splitParameters[i], intersection.t);
        addParameter(splitParameters[j], intersection.u);
        continue;
      }

      for (const [point, ownerIndex, targetIndex] of [
        [validSegments[i].start, i, j],
        [validSegments[i].end, i, j],
        [validSegments[j].start, j, i],
        [validSegments[j].end, j, i],
      ]) {
        const target = validSegments[targetIndex];
        const projection = projectPointToSegment(point, target.start, target.end);
        if (!projection) continue;
        if (pointSegmentDistance(point, target.start, target.end) <= tolerance * 2.5) {
          addParameter(splitParameters[targetIndex], projection.t);
          addParameter(
            splitParameters[ownerIndex],
            Math.hypot(
              point.x - validSegments[ownerIndex].start.x,
              point.y - validSegments[ownerIndex].start.y
            ) <= tolerance
              ? 0
              : 1
          );
        }
      }
    }
  }

  return validSegments.flatMap((segment, index) => {
    const parameters = splitParameters[index].sort((a, b) => a - b);
    const pieces = [];
    for (let p = 0; p < parameters.length - 1; p += 1) {
      const startT = parameters[p];
      const endT = parameters[p + 1];
      if (endT - startT <= 1e-9) continue;
      const start = {
        x: segment.start.x + (segment.end.x - segment.start.x) * startT,
        y: segment.start.y + (segment.end.y - segment.start.y) * startT,
      };
      const end = {
        x: segment.start.x + (segment.end.x - segment.start.x) * endT,
        y: segment.start.y + (segment.end.y - segment.start.y) * endT,
      };
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length <= tolerance) continue;
      pieces.push({ ...segment, start, end, length });
    }
    return pieces;
  });
}

function buildPlanarFaces(segments, tolerance) {
  const vertices = [];
  const buckets = new Map();
  const adjacency = new Map();
  const edgeSet = new Set();
  const bucketKey = (x, y) => `${Math.round(x / tolerance)}:${Math.round(y / tolerance)}`;

  const getVertexId = (point) => {
    const key = bucketKey(point.x, point.y);
    const nearbyKeys = [];
    const qx = Math.round(point.x / tolerance);
    const qy = Math.round(point.y / tolerance);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) nearbyKeys.push(`${qx + dx}:${qy + dy}`);
    }

    for (const nearbyKey of nearbyKeys) {
      for (const id of buckets.get(nearbyKey) || []) {
        if (Math.hypot(vertices[id].x - point.x, vertices[id].y - point.y) <= tolerance) {
          return id;
        }
      }
    }

    const id = vertices.length;
    vertices.push({ x: point.x, y: point.y });
    buckets.set(key, [...(buckets.get(key) || []), id]);
    adjacency.set(id, new Set());
    return id;
  };

  for (const segment of segments) {
    const startId = getVertexId(segment.start);
    const endId = getVertexId(segment.end);
    if (startId === endId) continue;
    const key = startId < endId ? `${startId}:${endId}` : `${endId}:${startId}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    adjacency.get(startId).add(endId);
    adjacency.get(endId).add(startId);
  }

  const sortedNeighbors = new Map();
  for (const [id, neighbors] of adjacency.entries()) {
    const origin = vertices[id];
    sortedNeighbors.set(
      id,
      [...neighbors].sort((a, b) =>
        Math.atan2(vertices[a].y - origin.y, vertices[a].x - origin.x) -
        Math.atan2(vertices[b].y - origin.y, vertices[b].x - origin.x)
      )
    );
  }

  const visited = new Set();
  const faces = [];
  const halfEdgeKey = (from, to) => `${from}>${to}`;
  const maxSteps = Math.max(edgeSet.size * 2 + 20, 50);

  for (const edgeKey of edgeSet) {
    const [a, b] = edgeKey.split(":").map(Number);
    for (const [startFrom, startTo] of [[a, b], [b, a]]) {
      if (visited.has(halfEdgeKey(startFrom, startTo))) continue;

      const ids = [];
      let from = startFrom;
      let to = startTo;
      let closed = false;

      for (let step = 0; step < maxSteps; step += 1) {
        const key = halfEdgeKey(from, to);
        if (visited.has(key)) break;
        visited.add(key);
        ids.push(from);

        const neighbors = sortedNeighbors.get(to) || [];
        const reverseIndex = neighbors.indexOf(from);
        if (reverseIndex < 0 || neighbors.length < 2) break;

        const next = neighbors[(reverseIndex - 1 + neighbors.length) % neighbors.length];
        from = to;
        to = next;
        if (from === startFrom && to === startTo) {
          closed = true;
          break;
        }
      }

      if (!closed || ids.length < 3) continue;
      const points = ids.map((id) => vertices[id]);
      const signedArea = signedPolygonArea(points);
      const perimeter = polygonPerimeter(points);
      if (Math.abs(signedArea) <= tolerance * tolerance || perimeter <= tolerance) continue;
      faces.push({ points, vertexIds: ids, signedArea, area: Math.abs(signedArea), perimeter });
    }
  }

  return faces;
}

function canonicalFaceKey(face, tolerance) {
  const keys = face.points.map(
    (point) => `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`
  );
  const rotateToSmallest = (values) => {
    let best = null;
    for (let index = 0; index < values.length; index += 1) {
      const rotated = [...values.slice(index), ...values.slice(0, index)].join("|");
      if (best === null || rotated < best) best = rotated;
    }
    return best || "";
  };
  const forward = rotateToSmallest(keys);
  const reverse = rotateToSmallest([...keys].reverse());
  return forward < reverse ? forward : reverse;
}

function selectBoundedFaces(faces, tolerance) {
  const unique = [];
  const seen = new Set();
  for (const face of faces) {
    const key = canonicalFaceKey(face, tolerance);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(face);
  }

  const vertexSets = unique.map((face) => new Set(face.vertexIds || []));
  const componentIds = new Array(unique.length).fill(-1);
  let componentCount = 0;

  for (let index = 0; index < unique.length; index += 1) {
    if (componentIds[index] !== -1) continue;
    const queue = [index];
    componentIds[index] = componentCount;
    while (queue.length) {
      const current = queue.shift();
      for (let other = 0; other < unique.length; other += 1) {
        if (componentIds[other] !== -1) continue;
        const shares = [...vertexSets[other]].some((vertexId) => vertexSets[current].has(vertexId));
        if (shares) {
          componentIds[other] = componentCount;
          queue.push(other);
        }
      }
    }
    componentCount += 1;
  }

  const bounded = [];
  for (let componentId = 0; componentId < componentCount; componentId += 1) {
    const component = unique.filter((_, index) => componentIds[index] === componentId);
    if (component.length <= 1) {
      bounded.push(...component);
      continue;
    }

    const positive = component.filter((face) => face.signedArea > 0);
    const negative = component.filter((face) => face.signedArea < 0);

    if (positive.length && negative.length) {
      const boundedOrientation =
        positive.reduce((sum, face) => sum + face.area, 0) <
        negative.reduce((sum, face) => sum + face.area, 0)
          ? positive
          : negative;
      bounded.push(...boundedOrientation);
      continue;
    }

    const exterior = component.reduce(
      (largest, face) => (!largest || face.area > largest.area ? face : largest),
      null
    );
    bounded.push(...component.filter((face) => face !== exterior));
  }

  return bounded;
}

function createPolygon(face, linearFactor, tolerance, index) {
  let centroidX = 0;
  let centroidY = 0;
  let centroidDenominator = 0;
  for (let i = 0; i < face.points.length; i += 1) {
    const current = face.points[i];
    const next = face.points[(i + 1) % face.points.length];
    const cross = current.x * next.y - next.x * current.y;
    centroidX += (current.x + next.x) * cross;
    centroidY += (current.y + next.y) * cross;
    centroidDenominator += cross;
  }

  const denominator = 3 * centroidDenominator;
  const fallback = face.points.reduce(
    (result, point) => ({
      x: result.x + point.x / face.points.length,
      y: result.y + point.y / face.points.length,
    }),
    { x: 0, y: 0 }
  );
  const centroid =
    Math.abs(denominator) > tolerance * tolerance
      ? { x: centroidX / denominator, y: centroidY / denominator }
      : fallback;

  const points = face.points.map((point) => ({
    x: point.x * linearFactor,
    y: point.y * linearFactor,
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    id: `room-${index + 1}`,
    area: face.area * linearFactor * linearFactor,
    areaModelUnits: face.area,
    perimeter: face.perimeter * linearFactor,
    centroid: { x: centroid.x * linearFactor, y: centroid.y * linearFactor },
    points,
    bounds: { minX, minY, maxX, maxY },
    length: Math.max(width, height),
    width: Math.min(width, height),
    pointCount: face.points.length,
    orientation: face.signedArea >= 0 ? "counter_clockwise" : "clockwise",
  };
}

function isPlausibleRoomPolygon(polygon) {
  const minimumDimension = Math.min(polygon.length, polygon.width);
  const compactness =
    polygon.perimeter > 0
      ? (4 * Math.PI * polygon.area) / (polygon.perimeter * polygon.perimeter)
      : 0;
  const hydraulicDiameter =
    polygon.perimeter > 0 ? (4 * polygon.area) / polygon.perimeter : 0;
  const aspectRatio =
    minimumDimension > 0
      ? Math.max(polygon.length, polygon.width) / minimumDimension
      : Number.POSITIVE_INFINITY;

  return (
    polygon.area >= 1.2 &&
    polygon.area <= 250 &&
    minimumDimension >= 0.55 &&
    hydraulicDiameter >= 0.72 &&
    compactness >= 0.012 &&
    aspectRatio <= 18
  );
}

function runGeometryPipeline(segments, tolerance, meterFactor) {
  const sanitized = sanitizeSegments(segments, tolerance, meterFactor);
  const snapped = snapDanglingEndpointsToSegments(sanitized, tolerance, meterFactor);
  const bridged = bridgeLikelyDoorOpenings(snapped, tolerance, meterFactor);
  const planar = splitSegmentsAtIntersections(bridged, tolerance);
  const faces = buildPlanarFaces(planar, tolerance);
  const bounded = selectBoundedFaces(faces, tolerance).filter(
    (face) => face.area > tolerance * tolerance * 10
  );

  return {
    inputSegments: sanitized,
    snappedSegments: snapped,
    gapClosedSegments: bridged,
    planarSegments: planar,
    faces,
    boundedFaces: bounded,
  };
}


function simplifyOrthogonalLoop(points, epsilon = 1e-9) {
  const source = Array.isArray(points) ? points : [];
  if (source.length < 4) return source;

  const deduped = [];
  for (const point of source) {
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > epsilon) {
      deduped.push(point);
    }
  }

  const simplified = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const previous = deduped[(index - 1 + deduped.length) % deduped.length];
    const current = deduped[index];
    const next = deduped[(index + 1) % deduped.length];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    if (Math.abs(cross) > epsilon) simplified.push(current);
  }

  return simplified.length >= 3 ? simplified : deduped;
}

function traceComponentBoundary(componentCells, columns, rows, originX, originY, cellSize) {
  const cellSet = new Set(componentCells);
  const edges = [];
  const key = (x, y) => `${x}:${y}`;
  const addEdge = (x1, y1, x2, y2) => {
    edges.push({ from: key(x1, y1), to: key(x2, y2), x1, y1, x2, y2 });
  };

  for (const cellIndex of componentCells) {
    const x = cellIndex % columns;
    const y = Math.floor(cellIndex / columns);
    const top = (y - 1) * columns + x;
    const right = y * columns + x + 1;
    const bottom = (y + 1) * columns + x;
    const left = y * columns + x - 1;

    if (y === 0 || !cellSet.has(top)) addEdge(x, y, x + 1, y);
    if (x === columns - 1 || !cellSet.has(right)) addEdge(x + 1, y, x + 1, y + 1);
    if (y === rows - 1 || !cellSet.has(bottom)) addEdge(x + 1, y + 1, x, y + 1);
    if (x === 0 || !cellSet.has(left)) addEdge(x, y + 1, x, y);
  }

  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }

  const unused = new Set(edges.map((_, index) => index));
  const loops = [];
  const edgeIndexesByFrom = new Map();
  edges.forEach((edge, index) => {
    if (!edgeIndexesByFrom.has(edge.from)) edgeIndexesByFrom.set(edge.from, []);
    edgeIndexesByFrom.get(edge.from).push(index);
  });

  while (unused.size > 0) {
    const startIndex = unused.values().next().value;
    const startEdge = edges[startIndex];
    const loop = [{ x: startEdge.x1, y: startEdge.y1 }];
    let currentIndex = startIndex;
    let currentTo = startEdge.to;
    unused.delete(currentIndex);

    for (let guard = 0; guard < edges.length + 5; guard += 1) {
      const edge = edges[currentIndex];
      loop.push({ x: edge.x2, y: edge.y2 });
      if (currentTo === startEdge.from) break;
      const nextCandidates = (edgeIndexesByFrom.get(currentTo) || []).filter((index) => unused.has(index));
      if (nextCandidates.length === 0) break;
      currentIndex = nextCandidates[0];
      currentTo = edges[currentIndex].to;
      unused.delete(currentIndex);
    }

    if (loop.length >= 4 && key(loop[0].x, loop[0].y) === key(loop[loop.length - 1].x, loop[loop.length - 1].y)) {
      const modelLoop = loop.slice(0, -1).map((point) => ({
        x: originX + point.x * cellSize,
        y: originY + point.y * cellSize,
      }));
      const simplified = simplifyOrthogonalLoop(modelLoop, cellSize * 1e-6);
      if (simplified.length >= 3) loops.push(simplified);
    }
  }

  if (loops.length === 0) return [];
  return loops.reduce((largest, loop) =>
    Math.abs(signedPolygonArea(loop)) > Math.abs(signedPolygonArea(largest)) ? loop : largest
  );
}

function buildRasterRoomPolygons(segments, meterFactor) {
  const source = Array.isArray(segments) ? segments : [];
  if (source.length < 3) return { polygons: [], metadata: null };

  const factor = toFiniteNumber(meterFactor);
  const linearFactor = factor !== null && factor > 0 ? factor : 1;
  const modelUnitsPerMeter = 1 / linearFactor;
  const bounds = getBounds(source);
  if (!bounds || bounds.diagonal <= 0) return { polygons: [], metadata: null };

  const targetCellMeters = 0.08;
  const minimumCellBySize = bounds.diagonal / 700;
  const maximumCellBySize = bounds.diagonal / 180;
  const cellSize = Math.max(
    targetCellMeters * modelUnitsPerMeter,
    minimumCellBySize,
    Math.min(maximumCellBySize, 0.18 * modelUnitsPerMeter)
  );
  const padding = cellSize * 4;
  const originX = bounds.minX - padding;
  const originY = bounds.minY - padding;
  const columns = Math.max(8, Math.min(900, Math.ceil((bounds.width + padding * 2) / cellSize)));
  const rows = Math.max(8, Math.min(900, Math.ceil((bounds.height + padding * 2) / cellSize)));
  const blocked = new Uint8Array(columns * rows);
  const wallRadiusCells = Math.max(1, Math.ceil((0.09 * modelUnitsPerMeter) / cellSize));

  const markCell = (x, y) => {
    if (x >= 0 && x < columns && y >= 0 && y < rows) blocked[y * columns + x] = 1;
  };

  for (const segment of source) {
    const x1 = Number(segment?.start?.x);
    const y1 = Number(segment?.start?.y);
    const x2 = Number(segment?.end?.x);
    const y2 = Number(segment?.end?.y);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length <= 0) continue;
    const steps = Math.max(1, Math.ceil(length / (cellSize * 0.45)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const gx = Math.round((x1 + (x2 - x1) * t - originX) / cellSize);
      const gy = Math.round((y1 + (y2 - y1) * t - originY) / cellSize);
      for (let oy = -wallRadiusCells; oy <= wallRadiusCells; oy += 1) {
        for (let ox = -wallRadiusCells; ox <= wallRadiusCells; ox += 1) {
          if (ox * ox + oy * oy <= wallRadiusCells * wallRadiusCells) markCell(gx + ox, gy + oy);
        }
      }
    }
  }

  const exterior = new Uint8Array(columns * rows);
  const queue = [];
  const enqueue = (x, y) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    const index = y * columns + x;
    if (blocked[index] || exterior[index]) return;
    exterior[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < columns; x += 1) {
    enqueue(x, 0);
    enqueue(x, rows - 1);
  }
  for (let y = 0; y < rows; y += 1) {
    enqueue(0, y);
    enqueue(columns - 1, y);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const x = index % columns;
    const y = Math.floor(index / columns);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  const visited = new Uint8Array(columns * rows);
  const polygons = [];
  const cellAreaSquareMeters = cellSize * cellSize * linearFactor * linearFactor;

  for (let start = 0; start < blocked.length; start += 1) {
    if (blocked[start] || exterior[start] || visited[start]) continue;
    const component = [];
    const componentQueue = [start];
    visited[start] = 1;
    for (let head = 0; head < componentQueue.length; head += 1) {
      const index = componentQueue[head];
      component.push(index);
      const x = index % columns;
      const y = Math.floor(index / columns);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
        const next = ny * columns + nx;
        if (blocked[next] || exterior[next] || visited[next]) continue;
        visited[next] = 1;
        componentQueue.push(next);
      }
    }

    const area = component.length * cellAreaSquareMeters;
    if (area < 1.0 || area > 350) continue;
    const boundaryModel = traceComponentBoundary(component, columns, rows, originX, originY, cellSize);
    if (boundaryModel.length < 3) continue;
    const face = {
      points: boundaryModel,
      area: Math.abs(signedPolygonArea(boundaryModel)),
      perimeter: polygonPerimeter(boundaryModel),
      signedArea: signedPolygonArea(boundaryModel),
    };
    const polygon = createPolygon(face, linearFactor, cellSize, polygons.length);
    polygon.rasterCellCount = component.length;
    polygon.detectionMethod = "raster_enclosed_space";
    if (isPlausibleRoomPolygon(polygon)) polygons.push(polygon);
  }

  return {
    polygons,
    metadata: {
      columns,
      rows,
      cellSizeModelUnits: cellSize,
      cellSizeMeters: cellSize * linearFactor,
      wallRadiusCells,
    },
  };
}

function scorePolygonCollection(polygons) {
  const source = Array.isArray(polygons) ? polygons : [];
  const oversized = source.filter((polygon) => polygon.area > 70).length;
  const veryLarge = source.filter((polygon) => polygon.area > 120).length;
  const tiny = source.filter((polygon) => polygon.area < 2).length;
  const totalArea = source.reduce((sum, polygon) => sum + polygon.area, 0);
  const plausibleCountBonus = source.length >= 3 && source.length <= 40 ? 18 : 0;
  return (
    source.length * 14 +
    plausibleCountBonus -
    oversized * 22 -
    veryLarge * 45 -
    tiny * 1.5 +
    Math.min(totalArea, 500) * 0.01
  );
}

function scorePipelineResult(result, linearFactor) {
  const polygons = result.boundedFaces
    .map((face, index) => createPolygon(face, linearFactor, 1e-9, index))
    .filter(isPlausibleRoomPolygon);

  const oversized = polygons.filter((polygon) => polygon.area > 70).length;
  const veryLarge = polygons.filter((polygon) => polygon.area > 120).length;
  const tiny = polygons.filter((polygon) => polygon.area < 2).length;
  const totalArea = polygons.reduce((sum, polygon) => sum + polygon.area, 0);

  return {
    polygons,
    score: scorePolygonCollection(polygons),
  };
}

function dedupeRoomPolygons(polygons) {
  const source = Array.isArray(polygons) ? polygons : [];
  const unique = [];

  for (const polygon of source) {
    const area = Number(polygon?.area);
    const perimeter = Number(polygon?.perimeter);
    const cx = Number(polygon?.centroid?.x);
    const cy = Number(polygon?.centroid?.y);

    if (![area, perimeter, cx, cy].every(Number.isFinite)) {
      unique.push(polygon);
      continue;
    }

    const duplicate = unique.some((existing) => {
      const existingArea = Number(existing?.area);
      const existingPerimeter = Number(existing?.perimeter);
      const ex = Number(existing?.centroid?.x);
      const ey = Number(existing?.centroid?.y);
      if (![existingArea, existingPerimeter, ex, ey].every(Number.isFinite)) return false;

      const areaTolerance = Math.max(0.03, Math.min(area, existingArea) * 0.003);
      const perimeterTolerance = Math.max(0.03, Math.min(perimeter, existingPerimeter) * 0.003);
      const centroidTolerance = 0.08; // metres; only same physical face is removed

      return (
        Math.abs(area - existingArea) <= areaTolerance &&
        Math.abs(perimeter - existingPerimeter) <= perimeterTolerance &&
        Math.hypot(cx - ex, cy - ey) <= centroidTolerance
      );
    });

    if (!duplicate) unique.push(polygon);
  }

  return unique;
}

export function calculateFloorAreaFromGeometry({
  lineSegments,
  objects,
  meterFactor,
  segmentMode = "walls",
} = {}) {
  const allSegments = Array.isArray(lineSegments) ? lineSegments : [];

  if (allSegments.length < 3) {
    return {
      area: 0,
      areaModelUnits: 0,
      polygonCount: 0,
      polygons: [],
      roomCount: 0,
      roomArea: 0,
      source: "unavailable",
      confidence: 0,
    };
  }

  const wallDbIds = getWallDbIds(objects);
  const architecturalDbIds = getArchitecturalDbIds(objects);
  const excludedDbIds = getExcludedAnnotationDbIds(objects);

  const wallSegments = wallDbIds.size
    ? allSegments.filter((segment) => wallDbIds.has(segment?.dbId))
    : [];
  const architecturalSegments = architecturalDbIds.size
    ? allSegments.filter((segment) => architecturalDbIds.has(segment?.dbId))
    : [];
  const broadArchitecturalSegments = excludedDbIds.size
    ? allSegments.filter((segment) => !excludedDbIds.has(segment?.dbId))
    : allSegments;

  const candidateSets = [];
  const addCandidate = (name, segments) => {
    if (!Array.isArray(segments) || segments.length < 3) return;
    const signature = segments
      .map((segment) => `${segment?.dbId ?? "x"}:${segment?.fragmentId ?? "x"}:${segment?.start?.x}:${segment?.start?.y}:${segment?.end?.x}:${segment?.end?.y}`)
      .slice(0, 20)
      .join("|");
    if (candidateSets.some((candidate) => candidate.signature === signature && candidate.segments.length === segments.length)) return;
    candidateSets.push({ name, segments, signature });
  };

  if (segmentMode === "walls") {
    addCandidate("wall_geometry_closed_faces", wallSegments);
    addCandidate("architectural_geometry_closed_faces", architecturalSegments);
    addCandidate("broad_architectural_geometry_closed_faces", broadArchitecturalSegments);
  } else if (segmentMode === "architectural") {
    addCandidate("architectural_geometry_closed_faces", architecturalSegments);
    addCandidate("broad_architectural_geometry_closed_faces", broadArchitecturalSegments);
    addCandidate("wall_geometry_closed_faces", wallSegments);
  } else {
    addCandidate("drawing_geometry_closed_faces", broadArchitecturalSegments);
  }
  addCandidate("drawing_geometry_closed_faces", allSegments);

  const factor = toFiniteNumber(meterFactor);
  const linearFactor = factor !== null && factor > 0 ? factor : 1;

  const evaluated = [];
  for (const candidate of candidateSets) {
    const bounds = getBounds(candidate.segments);
    if (!bounds || bounds.diagonal <= 0) continue;
    const tolerance = Math.max(bounds.diagonal * 1e-5, 1e-7);
    const result = runGeometryPipeline(candidate.segments, tolerance, meterFactor);
    const graphScored = scorePipelineResult(result, linearFactor);
    const rasterInput = result.gapClosedSegments.length >= 3
      ? result.gapClosedSegments
      : candidate.segments;
    const rasterResult = buildRasterRoomPolygons(rasterInput, meterFactor);
    const rasterScore = scorePolygonCollection(rasterResult.polygons);
    const useRaster =
      rasterResult.polygons.length > 0 &&
      (rasterScore > graphScored.score + 2 ||
        graphScored.polygons.length <= 2 ||
        graphScored.polygons.some((polygon) => polygon.area > 120));
    evaluated.push({
      ...candidate,
      bounds,
      tolerance,
      result,
      polygons: useRaster ? rasterResult.polygons : graphScored.polygons,
      score: useRaster ? rasterScore : graphScored.score,
      detectionMethod: useRaster ? "raster_enclosed_spaces" : "planar_graph_faces",
      rasterMetadata: rasterResult.metadata,
      graphPolygonCount: graphScored.polygons.length,
      rasterPolygonCount: rasterResult.polygons.length,
    });
  }

  if (!evaluated.length) {
    return {
      area: 0,
      areaModelUnits: 0,
      polygonCount: 0,
      polygons: [],
      roomCount: 0,
      roomArea: 0,
      source: "unavailable",
      confidence: 0,
    };
  }

  evaluated.sort((left, right) => right.score - left.score);
  const selected = evaluated[0];

  const polygons = dedupeRoomPolygons(selected.polygons)
    .sort((left, right) => right.area - left.area)
    .map((polygon, index) => ({
      ...polygon,
      id: `room-${index + 1}`,
      name: `Room ${index + 1}`,
    }));

  const roomArea = polygons.reduce((total, polygon) => total + polygon.area, 0);
  const meaningfulFacesAreaModelUnits =
    selected.detectionMethod === "raster_enclosed_spaces"
      ? roomArea / (linearFactor * linearFactor)
      : selected.result.boundedFaces.reduce((total, face) => total + face.area, 0);
  const area = roomArea > 0
    ? roomArea
    : meaningfulFacesAreaModelUnits * linearFactor * linearFactor;

  const confidenceBase =
    selected.name === "architectural_geometry_closed_faces"
      ? 90
      : selected.name === "wall_geometry_closed_faces"
        ? 84
        : selected.name === "broad_architectural_geometry_closed_faces"
          ? 78
          : 68;
  const confidence = Math.max(
    30,
    Math.min(
      96,
      confidenceBase - polygons.filter((polygon) => polygon.area > 70).length * 6
    )
  );

  return {
    area,
    areaModelUnits: meaningfulFacesAreaModelUnits,
    polygonCount: selected.result.boundedFaces.length,
    polygons,
    roomCount: polygons.length,
    roomArea,
    source: `${selected.name}:${selected.detectionMethod}`,
    confidence,
    roomDetectionMethod: selected.detectionMethod,
    rasterMetadata: selected.rasterMetadata || null,
    graphPolygonCount: selected.graphPolygonCount,
    rasterPolygonCount: selected.rasterPolygonCount,
    tolerance: selected.tolerance,
    inputSegmentCount: selected.segments.length,
    sanitizedSegmentCount: selected.result.inputSegments.length,
    snappedConnectorCount: Math.max(
      0,
      selected.result.snappedSegments.length - selected.result.inputSegments.length
    ),
    syntheticBridgeCount: Math.max(
      0,
      selected.result.gapClosedSegments.length - selected.result.snappedSegments.length
    ),
    planarSegmentCount: selected.result.planarSegments.length,
    detectedFaceCount: selected.result.faces.length,
    boundedFaceCount: selected.result.boundedFaces.length,
    candidateSourceScores: evaluated.map((candidate) => ({
      source: candidate.name,
      score: Number(candidate.score.toFixed(3)),
      polygonCount: candidate.polygons.length,
      graphPolygonCount: candidate.graphPolygonCount,
      rasterPolygonCount: candidate.rasterPolygonCount,
      detectionMethod: candidate.detectionMethod,
      segmentCount: candidate.segments.length,
    })),
  };
}
