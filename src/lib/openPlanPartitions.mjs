import { repairOverlappingWalls } from './wallOverlapRepair.mjs';
// Only inferred room outlines may be removed here. Observed walls are evidence.
const key = (a, b) => [String(a), String(b)].sort().join('|');
const inside = (p, polygon = []) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit = !hit;
  }
  return hit;
};
const distance = (p, a, b) => {
  const dx = b.x-a.x, dy = b.y-a.y;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
};
const semanticOpen = (a,b) => {
  const types = [a.semanticType || a.type, b.semanticType || b.type];
  return types.includes('living') && types.some(t => t === 'kitchen_dining' || t === 'dining');
};

export function filterOpenPlanPartitions(partitions = [], rooms = [], relationships = [], openings = []) {
  const relations = new Map(relationships.map(r => [key(r.roomAId,r.roomBId), r]));
  const removedIds = [];
  const filtered = partitions.filter(wall => {
    if (wall.type === 'external' || !String(wall.id || '').startsWith('room_edge_') || wall.provenance === 'observed') return true;
    if (!wall.start || !wall.end) return true;
    // Keep every attached opening, including windows, and source door symbols
    // that have not yet been assigned a supporting wall.
    if (openings.some(o => o.wallId === wall.id || o.wallIdHint === wall.id ||
      (o.type !== 'window' && o.center && distance(o.center,wall.start,wall.end) <= 0.18))) return true;
    const dx = wall.end.x-wall.start.x, dy = wall.end.y-wall.start.y, length = Math.hypot(dx,dy);
    if (length < 0.2) return true;
    const offset = 0.12;
    const samples = [0.15,0.325,0.5,0.675,0.85].map(t => {
      const p = {x:wall.start.x+t*dx,y:wall.start.y+t*dy};
      return [
        rooms.filter(r => inside({x:p.x-dy/length*offset,y:p.y+dx/length*offset},r.polygon)),
        rooms.filter(r => inside({x:p.x+dy/length*offset,y:p.y-dx/length*offset},r.polygon)),
      ];
    });
    // Test all polygon memberships, not the first containing room: semantic
    // zones can overlap, so both sides may belong to the same larger room.
    for (let i=0;i<rooms.length;i++) for (let j=i+1;j<rooms.length;j++) {
      const a=rooms[i], b=rooms[j], relation=relations.get(key(a.id,b.id));
      if (relation && relation.relation !== 'open') continue;
      if (!(relation?.relation === 'open' && relation.confidence >= 0.45) && !(!relation && semanticOpen(a,b))) continue;
      const matches = samples.every(([left,right]) => {
        // An additional room is ambiguous evidence; do not remove its boundary.
        if ([...left,...right].some(r => r !== a && r !== b)) return false;
        return (left.includes(a) && right.includes(b)) || (left.includes(b) && right.includes(a));
      });
      if (matches) { removedIds.push(wall.id); return false; }
    }
    return true;
  });
  return { partitions: filtered, removed: removedIds.length, removedIds };
}

export function repairOpenPlanScene(scene) {
  if (!scene || scene.sceneType !== 'floorplan_interactive_preview' || !Array.isArray(scene.walls)) return scene;
  const result = filterOpenPlanPartitions(scene.walls, scene.rooms || [], scene.relationships || [], scene.openings || []);
  const overlap = repairOverlappingWalls(result.partitions, scene.openings || []);
  return result.removed || overlap.changed ? { ...scene, walls: overlap.walls, openings: overlap.openings } : scene;
}
