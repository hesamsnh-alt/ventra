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
  const replacements = new Map();
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
    // A corridor may join only part of a living-room edge; the remainder can
    // bound a WC. Remove only the explicitly open interval, never that WC wall.
    const partialOffset=Math.max(offset,Math.min(0.3,Number(wall.thickness||wall.width)||0.3));
    const cuts=[0,1];
    for(const room of rooms) for(let i=0;i<(room.polygon||[]).length;i++) {
      const a=room.polygon[i],b=room.polygon[(i+1)%room.polygon.length];
      const ex=b.x-a.x,ey=b.y-a.y,den=dx*ey-dy*ex;
      if(Math.abs(den)<1e-10)continue;
      for(const side of [-1,1]) {
        const origin={x:wall.start.x-side*dy/length*partialOffset,y:wall.start.y+side*dx/length*partialOffset};
        const ax=a.x-origin.x,ay=a.y-origin.y;
        const t=(ax*ey-ay*ex)/den,u=(ax*dy-ay*dx)/den;
        if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
      }
    }
    const sorted=[...new Set(cuts.map(t=>Number(t.toFixed(9))))].sort((a,b)=>a-b),kept=[];
    let changed=false;
    for(let i=1;i<sorted.length;i++) {
      const start=sorted[i-1],end=sorted[i],t=(start+end)/2;
      const p={x:wall.start.x+t*dx,y:wall.start.y+t*dy};
      const left=rooms.filter(r=>inside({x:p.x-dy/length*partialOffset,y:p.y+dx/length*partialOffset},r.polygon));
      const right=rooms.filter(r=>inside({x:p.x+dy/length*partialOffset,y:p.y-dx/length*partialOffset},r.polygon));
      const open=relationships.some(r=>r.relation==='open'&&r.confidence>=0.45&&
        [...left,...right].every(room=>room.id===r.roomAId||room.id===r.roomBId)&&
        ((left.some(a=>a.id===r.roomAId)&&right.some(b=>b.id===r.roomBId))||
         (left.some(a=>a.id===r.roomBId)&&right.some(b=>b.id===r.roomAId))));
      if(open&&(end-start)*length>=0.15){changed=true;continue;}
      const last=kept.at(-1);if(last&&Math.abs(last[1]-start)<1e-8)last[1]=end;else kept.push([start,end]);
    }
    if(changed){removedIds.push(wall.id);replacements.set(wall.id,kept.filter(([a,b])=>(b-a)*length>1e-8).map(([a,b],i)=>({...wall,id:`${wall.id}__open_trim_${i+1}`,start:{x:wall.start.x+a*dx,y:wall.start.y+a*dy},end:{x:wall.start.x+b*dx,y:wall.start.y+b*dy}})));}
    return true;
  });
  return { partitions: filtered.flatMap(w=>replacements.get(w.id)||[w]), removed: removedIds.length, removedIds };
}

export function repairOpenPlanScene(scene) {
  if (!scene || scene.sceneType !== 'floorplan_interactive_preview' || !Array.isArray(scene.walls)) return scene;
  const result = filterOpenPlanPartitions(scene.walls, scene.rooms || [], scene.relationships || [], scene.openings || []);
  const overlap = repairOverlappingWalls(result.partitions, scene.openings || []);
  return result.removed || overlap.changed ? { ...scene, walls: overlap.walls, openings: overlap.openings } : scene;
}
