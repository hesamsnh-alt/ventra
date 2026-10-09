// A scene can contain several descriptions of the same physical wall. Keep
// the best-supported centerline and retain only the uncovered portions of the
// others. The small distance/angle limits deliberately exclude adjacent walls.
const EPS = 1e-6;
const point = p => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y));
const geometry = wall => {
  if (!point(wall?.start) || !point(wall?.end)) return null;
  const dx = Number(wall.end.x) - Number(wall.start.x);
  const dy = Number(wall.end.y) - Number(wall.start.y);
  const length = Math.hypot(dx, dy);
  return length > EPS ? { x: Number(wall.start.x), y: Number(wall.start.y), ux: dx / length, uy: dy / length, length } : null;
};
const at = (g, t) => ({ x: g.x + g.ux * t, y: g.y + g.uy * t });
const projection = (g, p) => (Number(p.x) - g.x) * g.ux + (Number(p.y) - g.y) * g.uy;
const separation = (g, p) => Math.abs((Number(p.x) - g.x) * g.uy - (Number(p.y) - g.y) * g.ux);
const rank = (wall, openings) =>
  (openings.some(o => String(o?.wallId) === String(wall?.id)) ? 8 : 0) +
  (wall?.type === 'external' ? 4 : 0) +
  (wall?.provenance === 'observed' ? 2 : 0) +
  (wall?.provenance === 'room_boundary' || String(wall?.id || '').startsWith('room_edge_') ? 0 : 1);

export function repairOverlappingWalls(walls = [], openings = [], { distanceTolerance = 0.04, angleToleranceDegrees = 1 } = {}) {
  if (!Array.isArray(walls) || walls.length < 2) return { walls, openings, changed: false };
  const ordered = walls.map((wall, index) => ({ wall, index, g: geometry(wall) }))
    .sort((a, b) => rank(b.wall, openings) - rank(a.wall, openings) || a.index - b.index);
  const accepted = [];
  const output = new Map();
  let changed = false;
  const angleLimit = Math.sin(angleToleranceDegrees * Math.PI / 180);

  for (const entry of ordered) {
    const { wall, g } = entry;
    if (!g) { output.set(entry.index, [wall]); continue; }
    let spans = [[0, g.length]];
    for (const higher of accepted) {
      const h = higher.g;
      if (Math.abs(g.ux * h.uy - g.uy * h.ux) > angleLimit ||
          separation(g, higher.wall.start) > distanceTolerance ||
          separation(g, higher.wall.end) > distanceTolerance) continue;
      const lo = Math.max(0, Math.min(projection(g, higher.wall.start), projection(g, higher.wall.end)));
      const hi = Math.min(g.length, Math.max(projection(g, higher.wall.start), projection(g, higher.wall.end)));
      if (hi <= lo + EPS) continue;
      spans = spans.flatMap(([a, b]) => {
        if (hi <= a + EPS || lo >= b - EPS) return [[a, b]];
        const pieces = [];
        if (lo > a + EPS) pieces.push([a, lo]);
        if (hi < b - EPS) pieces.push([hi, b]);
        return pieces;
      });
      if (!spans.length) break;
    }
    const pieces = spans.map(([a, b], i) => a < EPS && b > g.length - EPS
      ? wall
      : { ...wall, id: `${wall.id || `wall_${entry.index}`}__residual_${i + 1}`, start: at(g, a), end: at(g, b) });
    if (pieces.length !== 1 || pieces[0] !== wall) changed = true;
    output.set(entry.index, pieces);
    for (const piece of pieces) accepted.push({ wall: piece, g: geometry(piece) });
  }

  if (!changed) return { walls, openings, changed: false };
  const repairedWalls = walls.flatMap((_, index) => output.get(index));
  let unsafe = false;
  const remappedOpenings = openings.map(opening => {
    const original = walls.find(w => String(w?.id) === String(opening?.wallId));
    const g = geometry(original);
    if (!g || !Number.isFinite(Number(opening?.offset))) return opening;
    const center = at(g, Number(opening.offset) * g.length);
    const candidates = repairedWalls.map(w => ({ wall: w, g: geometry(w) })).filter(({ wall, g: candidate }) =>
      candidate && separation(candidate, center) <= distanceTolerance &&
      Math.abs(g.ux * candidate.uy - g.uy * candidate.ux) <= angleLimit &&
      projection(candidate, center) >= -EPS && projection(candidate, center) <= candidate.length + EPS);
    // A full width is needed so an opening is never squeezed into a remnant.
    const width = Math.max(0, Number(opening.width) || 0);
    const supporting = candidates.find(({ wall, g: candidate }) => wall.id === opening.wallId &&
      projection(candidate, center) >= width / 2 - EPS && candidate.length - projection(candidate, center) >= width / 2 - EPS)
      || candidates.find(({ g: candidate }) => projection(candidate, center) >= width / 2 - EPS &&
        candidate.length - projection(candidate, center) >= width / 2 - EPS);
    if (!supporting) {
      if (!repairedWalls.includes(original)) unsafe = true;
      return opening;
    }
    const offset = projection(supporting.g, center) / supporting.g.length;
    if (supporting.wall.id === opening.wallId && Math.abs(offset - Number(opening.offset)) <= EPS) return opening;
    const reversed = g.ux * supporting.g.ux + g.uy * supporting.g.uy < 0;
    return {
      ...opening,
      wallId: supporting.wall.id,
      offset,
      ...(reversed && opening.hinge ? { hinge: opening.hinge === 'start' ? 'end' : opening.hinge === 'end' ? 'start' : opening.hinge } : {}),
      ...(reversed && opening.swing ? { swing: opening.swing === 'clockwise' ? 'counterclockwise' : opening.swing === 'counterclockwise' ? 'clockwise' : opening.swing } : {}),
    };
  });
  // Keep original evidence if a doorway would straddle multiple residuals.
  if (unsafe) return { walls, openings, changed: false };
  return { walls: repairedWalls, openings: remappedOpenings, changed: true };
}
