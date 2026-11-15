import {curveIntersections, dist, EPS, segments} from './geometry.mjs';

const point = (x, y) => ({x, y});
const polyline = (points, closed = false) => ({type: 'polyline', points, closed});
const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function stairStations(doc, start, end) {
  const length = dist(start, end);
  if (length < EPS) throw Error('Pick two different points across the treads. / دو نقطهٔ مجزا در امتداد بازوی پله بزن.');
  const axis = {type: 'line', a: start, b: end};
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const visibleLayers = new Set(doc.layers.filter(layer => layer.visible !== false).map(layer => layer.id));
  const crossings = [];
  for (const entity of doc.entities) {
    if (!visibleLayers.has(entity.layer) || entity.hatch || (entity.role && entity.role !== 'line')) continue;
    for (const segment of segments(entity)) {
      if (segment.type !== 'line') continue;
      const projection = (segment.b.x - segment.a.x) * ux + (segment.b.y - segment.a.y) * uy;
      // The pick line should run along the flight, crossing the tread edges.
      if (Math.abs(projection) > dist(segment.a, segment.b) * .5) continue;
      for (const p of curveIntersections(axis, segment)) {
        crossings.push((p.x - start.x) * ux + (p.y - start.y) * uy);
      }
    }
  }
  const stations = [];
  for (const crossing of crossings.sort((a, b) => a - b)) {
    if (!stations.length || crossing - stations.at(-1) > .003) stations.push(crossing);
  }
  if (stations.length < 2 || stations.length > 40) {
    throw Error('Cross 2–40 tread lines on one flight. / خط انتخاب باید از ۲ تا ۴۰ خط پله در یک بازو عبور کند.');
  }
  return stations.map(station => station - stations[0]);
}

export function projectedStairSection(stations, origin, options) {
  const {stepRiseMode, stepRise, stepTotal, stepDirection, stepRun, stepStartLanding, stepEndLanding, stepWaist, stepHatch} = options;
  const rise = stepRiseMode === 'total' ? stepTotal / stations.length : stepRise;
  if (!range(rise, .01, 1) || !range(stepStartLanding, 0, 10) || !range(stepEndLanding, 0, 10) || !range(stepWaist, 0, 2)) {
    throw Error('Check the rise, landing lengths and waist depth. / ارتفاع پله، طول پاگرد و ضخامت شمشیری را بررسی کن.');
  }
  const ySign = stepDirection === 'down' ? -1 : 1;
  const xSign = stepRun === 'left' ? -1 : 1;
  const upper = [point(-stepStartLanding, 0)];
  const lower = stepStartLanding ? [point(-stepStartLanding, -stepWaist)] : [];
  const append = (path, p) => {
    if (!path.length || dist(path.at(-1), p) > EPS) path.push(p);
  };
  stations.forEach((x, i) => {
    const before = i * rise * ySign;
    const after = (i + 1) * rise * ySign;
    append(upper, point(x, before));
    append(upper, point(x, after));
    append(lower, point(x, Math.min(before, after) - stepWaist));
  });
  const last = upper.at(-1);
  append(upper, point(last.x + stepEndLanding, last.y));
  if (stepEndLanding) {
    if (ySign > 0) append(lower, point(last.x + Math.min(stepEndLanding / 2, rise), last.y - stepWaist));
    append(lower, point(last.x + stepEndLanding, last.y - stepWaist));
  }
  const toSection = p => point(origin.x + p.x * xSign, origin.y + p.y);
  if (!stepWaist) return [polyline(upper.map(toSection))];

  // A terminal riser without a landing shares the vertical edge of the waist.
  // Keep the visible extension as a separate segment to avoid a self-overlapping ring.
  const edges = [];
  if (!stepStartLanding && ySign < 0) edges.push([upper.shift(), upper[0]]);
  if (!stepEndLanding && ySign > 0) edges.push([upper.pop(), upper.at(-1)]);
  const profile = polyline([...upper, ...lower.reverse()].map(toSection), true);
  return [
    stepHatch === 'concrete' ? {...profile, hatch: 'concrete', hatchScale: .1} : profile,
    ...edges.map(([a, b]) => ({type: 'line', a: toSection(a), b: toSection(b)})),
  ];
}

export function railingElevation(a, b, options) {
  const [start, end] = a.x <= b.x ? [a, b] : [b, a];
  const width = end.x - start.x;
  const {railHeight, handrailSize, handrailExtension, railBottomGap, railTopGap, railBar, railPost, railSpacing, railPostSpacing, railEndPosts} = options;
  if (width < .12 || !range(railHeight, .15, 3) || !range(handrailSize, .005, .3) ||
      !range(handrailExtension, 0, 2) || !range(railBottomGap, 0, railHeight) ||
      !range(railTopGap, 0, railHeight) || !range(railBar, .005, .3) || !range(railPost, .005, .3) ||
      !range(railSpacing, railBar, 2) || !range(railPostSpacing, Math.max(railSpacing, railPost * 2), 10) ||
      railBottomGap + railTopGap + handrailSize + 2 * railBar >= railHeight) {
    throw Error('Check the railing span, heights and spacing. / طول دهانه، ارتفاع و فواصل نرده را بررسی کن.');
  }
  const bayCount = Math.ceil(width / railPostSpacing);
  const bay = width / bayCount;
  const slots = Math.ceil(bay / railSpacing);
  if (bayCount * slots > 350 || bay / slots <= (railPost + railBar) / 2) {
    throw Error('Use fewer bars or smaller sections. / تعداد میله‌ها را کم کن یا مقطع کوچک‌تری انتخاب کن.');
  }
  const slope = (end.y - start.y) / width;
  const at = (x, offset) => point(start.x + x, start.y + x * slope + offset);
  const band = (from, to, bottom, top) =>
    polyline([at(from, bottom), at(to, bottom), at(to, top), at(from, top)], true);
  const handrailBottom = railHeight - handrailSize;
  const upperRail = handrailBottom - railTopGap;
  const geometry = [
    band(-handrailExtension, width + handrailExtension, handrailBottom, railHeight),
    band(0, width, railBottomGap, railBottomGap + railBar),
  ];
  if (railTopGap > EPS) geometry.push(band(0, width, upperRail - railBar, upperRail));
  for (let i = 0; i <= bayCount; i++) {
    if (railEndPosts === 'yes' || (i > 0 && i < bayCount)) {
      const x = i * bay;
      geometry.push(band(Math.max(0, x - railPost / 2), Math.min(width, x + railPost / 2), 0, handrailBottom));
    }
    if (i === bayCount) break;
    for (let j = 1; j < slots; j++) {
      const x = (i + j / slots) * bay;
      geometry.push(band(x - railBar / 2, x + railBar / 2, railBottomGap + railBar, upperRail - (railTopGap > EPS ? railBar : 0)));
    }
  }
  return geometry;
}
