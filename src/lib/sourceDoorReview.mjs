// Remove only generated duplicate access doors. Never delete observed openings.
export function reviewSourceDoors(scene) {
  if (!scene || !Array.isArray(scene.openings)) return scene;
  const walls = new Map((scene.walls || []).map(w => [String(w.id), w]));
  const observed = scene.openings.filter(o => o.type === 'door' && !o._syntheticAccess && !String(o.id).startsWith('synthetic_door_'));
  const distance = (p,a,b) => {
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  const touches = (o,r) => {
    const w=walls.get(String(o.wallId)),p=r.polygon;
    if(!w || !Array.isArray(p) || p.length<3) return false;
    const t=Number(o.offset); if(!Number.isFinite(t))return false;
    const c={x:w.start.x+(w.end.x-w.start.x)*t,y:w.start.y+(w.end.y-w.start.y)*t};
    return p.some((a,i)=>distance(c,a,p[(i+1)%p.length])<0.12);
  };
  const openings=scene.openings.filter(o=>{
    if(o._syntheticAccess===true)return false;
    if(!String(o.id).startsWith('synthetic_door_'))return true;
    const rooms=(scene.rooms||[]).filter(r=>['bathroom','bedroom','office','toilet','bath'].includes(r.type) && String(o.id).includes(String(r.id)));
    return !rooms.some(r=>touches(o,r)&&observed.some(d=>touches(d,r)));
  });
  return openings.length===scene.openings.length?scene:{...scene,openings};
}
