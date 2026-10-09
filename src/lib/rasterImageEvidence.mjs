// Raster-only pixel checks. These observations constrain the trace; they never
// move a wall, invent a boundary, choose a room template, or change scale.
import sharp from "sharp";

export const RASTER_IMAGE_EVIDENCE_VERSION = "raster-pixel-support-v1";

function evidenceError(code, message, details) {
  return Object.assign(new Error(message), { name: "RasterImageEvidenceError", code, details });
}

function exteriorBackground(mask, width, height) {
  // Remove broad border-connected fills, not every border-connected stroke:
  // a cropped drawing can have legitimate thin walls touching an image edge.
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) { sum += mask[y * width + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) * 0.012));
  const broad = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const dark = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
    broad[y * width + x] = dark / ((x1 - x0) * (y1 - y0)) >= 0.93 ? 1 : 0;
  }
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const add = (i) => { if (broad[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; } };
  const seedEdge = (indices) => {
    let start = -1;
    for (let j = 0; j <= indices.length; j++) {
      if (j < indices.length && broad[indices[j]]) { if (start < 0) start = j; }
      else if (start >= 0) {
        if (j - start >= indices.length * 0.5) for (let k = start; k < j; k++) add(indices[k]);
        start = -1;
      }
    }
  };
  seedEdge(Array.from({ length: width }, (_, x) => x));
  seedEdge(Array.from({ length: width }, (_, x) => (height - 1) * width + x));
  seedEdge(Array.from({ length: height }, (_, y) => y * width));
  seedEdge(Array.from({ length: height }, (_, y) => y * width + width - 1));
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) add(i - 1); if (x + 1 < width) add(i + 1);
    if (y) add(i - width); if (y + 1 < height) add(i + width);
  }
  // Restore the fill's thin boundary while stopping before a connected wall
  // network can be swallowed by the background component.
  const distance = new Uint16Array(mask.length);
  head = 0;
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (distance[i] >= radius) continue;
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (j >= 0 && mask[j] && !visited[j]) { visited[j] = 1; distance[j] = distance[i] + 1; queue[tail++] = j; }
    }
  }
  return visited;
}

function strokeGuides(mask, width, height, horizontal) {
  const major = horizontal ? width : height, minor = horizontal ? height : width;
  const minLength = Math.max(12, Math.round(Math.min(width, height) * 0.018));
  const maxThickness = Math.max(10, Math.round(Math.min(width, height) * 0.035));
  const groups = [], active = new Map();
  for (let row = 0; row < minor; row++) {
    const runs = [];
    let begin = -1;
    for (let col = 0; col <= major; col++) {
      const dark = col < major && mask[horizontal ? row * width + col : col * width + row];
      if (dark && begin < 0) begin = col;
      if (!dark && begin >= 0) { if (col - begin >= minLength) runs.push([begin, col - 1]); begin = -1; }
    }
    const next = new Map();
    for (const [start, end] of runs) {
      let previous = null;
      for (const g of active.values()) {
        if (Math.abs(g.start - start) <= 2 && Math.abs(g.end - end) <= 2) { previous = g; break; }
      }
      if (previous) {
        previous.last = row; previous.start = Math.max(previous.start, start); previous.end = Math.min(previous.end, end);
        next.set(previous, previous);
      } else {
        const group = { start, end, first: row, last: row };
        groups.push(group); next.set(group, group);
      }
    }
    active.clear(); for (const [key, g] of next) active.set(key, g);
  }
  return groups.filter(g => g.last - g.first >= 2 && g.last - g.first + 1 <= maxThickness && g.end - g.start >= minLength)
    .map(g => {
      const center = (g.first + g.last) / 2;
      return {
        start: horizontal ? { x: g.start, y: center } : { x: center, y: g.start },
        end: horizontal ? { x: g.end, y: center } : { x: center, y: g.end },
        thicknessPixels: g.last - g.first + 1,
      };
    });
}

export async function prepareRasterImageEvidence(buffer) {
  const { data, info } = await sharp(buffer).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = Uint8Array.from(data, v => v < 170 ? 1 : 0);
  const background = exteriorBackground(mask, width, height);
  for (let i = 0; i < mask.length; i++) if (background[i]) mask[i] = 0;
  const guides = [...strokeGuides(mask, width, height, true), ...strokeGuides(mask, width, height, false)]
    .sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y))
    .slice(0, 100).map((g, i) => ({ id: `pixel-stroke-${i + 1}`, ...g }));
  return { width, height, mask, guides };
}

export function rasterEvidencePrompt(evidence) {
  if (!evidence.guides.length) return "No long dark wall-stroke guides could be isolated. Trace only clearly visible structural lines; unreadable geometry must remain rejected.";
  return `Observed dark pixel strokes in the exact image frame (these are partial ink segments, NOT a completed plan or a wall classification):\n${JSON.stringify(evidence.guides)}\nUse the original image to classify wall strokes versus text/furniture. Match visible wall centerlines to these coordinates where relevant. Connect strokes only through visible wall junctions or real door/window gaps. The guide list may be incomplete and is never permission to infer a rectangle, extend a wall into white space, or fill a recess.`;
}

const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
function project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator : 0;
  return { t, distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) };
}

export function inspectRasterImageEvidence(pixelTrace, evidence) {
  const { width, height, mask } = evidence;
  if (pixelTrace.imageWidth !== width || pixelTrace.imageHeight !== height) {
    throw evidenceError("COORDINATE_FRAME_MISMATCH", "The trace and pixel evidence use different image dimensions.", { imageWidth: width, imageHeight: height });
  }
  const tolerancePixels = Math.max(2, Math.min(5, Math.round(Math.min(width, height) * 0.004)));
  const outlineRadius = Math.max(6, Math.min(14, Math.round(Math.min(width, height) * 0.018)));
  const at = (x, y) => {
    const ix = Math.round(x), iy = Math.round(y);
    return ix >= 0 && iy >= 0 && ix < width && iy < height ? mask[iy * width + ix] || 0 : 0;
  };
  const nearInk = (x, y, radius = 1) => {
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) if (at(x + dx, y + dy)) return true;
    return false;
  };
  const openings = Array.isArray(pixelTrace.openings) ? pixelTrace.openings : [];
  const walls = (Array.isArray(pixelTrace.walls) ? pixelTrace.walls : []).map(w => {
    if (!point(w.start) || !point(w.end)) return { id: w.id, passed: false, reason: "invalid_endpoints" };
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, length = Math.hypot(dx, dy);
    if (!length) return { id: w.id, passed: false, reason: "empty_wall" };
    const nx = -dy / length, ny = dx / length;
    const inkAt = (t) => {
      const x = w.start.x + dx * t, y = w.start.y + dy * t;
      let dark = 0;
      for (let n = -tolerancePixels; n <= tolerancePixels; n++) dark += at(x + nx * n, y + ny * n);
      if (dark >= 1) return true;
      // Unfilled walls can have two thin faces around a white centerline.
      // Require evidence on BOTH sides, approximately symmetric: a single
      // nearby wall must not support a shifted trace.
      let negative = 0, positive = 0;
      for (let n = 1; n <= outlineRadius; n++) {
        if (!negative && at(x - nx * n, y - ny * n)) negative = n;
        if (!positive && at(x + nx * n, y + ny * n)) positive = n;
      }
      return negative > 0 && positive > 0 && Math.abs(negative - positive) <= tolerancePixels;
    };
    const unsupportedOpeningIds = [];
    const openingIssues = [];
    const windowIntervals = [];
    const intervals = openings.filter(o => o.wallId === w.id && point(o.start) && point(o.end)).flatMap(o => {
      const a = project(o.start, w.start, w.end), b = project(o.end, w.start, w.end);
      if (a.distance > tolerancePixels || b.distance > tolerancePixels) {
        unsupportedOpeningIds.push(o.id);
        openingIssues.push({ id: o.id, reason: "jamb_off_wall", start: o.start, end: o.end, maximumDistancePixels: Math.max(a.distance, b.distance) });
        return [];
      }
      const low = Math.max(0, Math.min(a.t, b.t)), high = Math.min(1, Math.max(a.t, b.t));
      // A claimed opening must not hide an arbitrary stretch of empty image.
      // Both jambs need nearby visible ink on the solid side of the wall.
      const jambHasInk = (t, direction) => {
        for (let step = 0; step <= tolerancePixels * 2; step++) {
          const sample = t + direction * step / length;
          if (sample >= 0 && sample <= 1 && inkAt(sample)) return true;
        }
        return false;
      };
      if (low >= high || !jambHasInk(low, -1) || !jambHasInk(high, 1)) {
        unsupportedOpeningIds.push(o.id);
        openingIssues.push({ id: o.id, reason: "jamb_ink_unverified" });
        return [];
      }
      const openingWidth = (high - low) * length;
      // A blank gap alone is not a door/window. Look for visible symbol ink:
      // a window/sliding track along the gap, or a door leaf attached to a jamb.
      let along = 0;
      for (let n = 0; n < 20; n++) if (inkAt(low + (high - low) * (0.2 + 0.6 * n / 19))) along++;
      let symbolSupported = along / 20 >= 0.7;
      if (!symbolSupported && o.type === "door") {
        for (const [hinge, sign] of [[low, 1], [high, -1]]) {
          const hx = w.start.x + dx * hinge, hy = w.start.y + dy * hinge;
          const angleStep = Math.min(1, Math.atan2(1, openingWidth) * 180 / Math.PI);
          for (const leafFraction of [1, 0.5]) for (const side of [-1, 1]) for (let degrees = 1; degrees < 180; degrees += angleStep) {
            const angle = side * degrees * Math.PI / 180;
            const ux = sign * dx / length, uy = sign * dy / length;
            const rx = ux * Math.cos(angle) - uy * Math.sin(angle), ry = ux * Math.sin(angle) + uy * Math.cos(angle);
            let supported = 0;
            for (let n = 0; n < 20; n++) {
              const reach = openingWidth * leafFraction * (0.18 + 0.65 * n / 19);
              const x = hx + rx * reach, y = hy + ry * reach;
              let thickness = 0;
              for (let offset = -tolerancePixels; offset <= tolerancePixels; offset++) thickness += at(x - ry * offset, y + rx * offset);
              if (nearInk(x, y, 1) && thickness <= Math.max(2, tolerancePixels)) supported++;
            }
            if (supported / 20 >= 0.8) symbolSupported = true;
          }
        }
      }
      if (!symbolSupported) { unsupportedOpeningIds.push(o.id); openingIssues.push({ id: o.id, reason: "symbol_ink_unverified" }); return []; }
      if (o.type === "window") windowIntervals.push([low, high]);
      return [[low, high]];
    });
    const samples = Math.max(2, Math.ceil(length));
    let tested = 0, supported = 0, longestMissing = 0, missing = 0;
    let missingStart = -1;
    const missingSpans = [];
    const samplePoint = i => ({ x: Number((w.start.x + dx * i / samples).toFixed(2)), y: Number((w.start.y + dy * i / samples).toFixed(2)) });
    const closeMissingSpan = endIndex => {
      if (missingStart < 0) return;
      const pixels = (endIndex - missingStart + 1) * length / samples;
      if (pixels > tolerancePixels * 2) missingSpans.push({ start: samplePoint(missingStart), end: samplePoint(endIndex), lengthPixels: Number(pixels.toFixed(1)) });
      missingStart = -1;
    };
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      if (intervals.some(([a, b]) => t >= a && t <= b)) { closeMissingSpan(i - 1); missing = 0; continue; }
      // Look only a few pixels perpendicular to the wall. A nearby parallel
      // wall tens of pixels away cannot vouch for a fabricated wall here.
      tested++;
      if (inkAt(t)) { closeMissingSpan(i - 1); supported++; missing = 0; }
      else { if (missingStart < 0) missingStart = i; missing++; longestMissing = Math.max(longestMissing, missing); }
    }
    closeMissingSpan(samples);
    const windowOnly = windowIntervals.some(([a, b]) => a <= 0 && b >= 1);
    const coverage = tested ? supported / tested : windowOnly ? 1 : 0;
    const longestMissingPixels = longestMissing * length / samples;
    const passed = !unsupportedOpeningIds.length && (tested >= 4 || windowOnly) && coverage >= 0.9 && longestMissingPixels <= tolerancePixels * 2;
    return { id: w.id, type: w.type, start: w.start, end: w.end, coverage: Number(coverage.toFixed(3)), longestMissingPixels: Number(longestMissingPixels.toFixed(1)), missingSpans, testedSamples: tested, windowOnly, unsupportedOpeningIds, openingIssues, passed };
  });
  return {
    version: RASTER_IMAGE_EVIDENCE_VERSION,
    status: walls.length && walls.every(w => w.passed) ? "passed" : "rejected",
    tolerancePixels,
    walls,
    unsupportedWallIds: walls.filter(w => !w.passed).map(w => w.id),
    guideCount: evidence.guides.length,
    meaning: "Visible ink supports these traced wall positions; this does not certify labels, dimensions or completeness.",
  };
}

export function requireRasterImageEvidence(result) {
  if (result.status !== "passed") {
    throw evidenceError("TRACE_IMAGE_MISMATCH", "Traced walls do not follow the source image. No new 3D scene was saved.", { imageEvidence: result, unsupportedWallIds: result.unsupportedWallIds });
  }
  return result;
}
