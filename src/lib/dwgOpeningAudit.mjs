// Reject uncertain bindings instead of moving doors onto unrelated windows/walls.
export function auditDwgOpenings(openings,walls){
 const rejected=new Map(),resolved=[];
 for(const opening of openings||[]){
  const wall=walls.find(w=>w.id===opening.wallId);
  const length=wall&&Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
  const width=Number(opening.width),offset=Number(opening.offset);
  if(!length||!Number.isFinite(width)||width<=0||!Number.isFinite(offset)||offset*length-width/2<-.02||offset*length+width/2>length+.02){rejected.set(opening.id,'opening_exceeds_bound_wall');continue;}
  if(Number.isFinite(opening.snapDistance)&&opening.snapDistance>.4){rejected.set(opening.id,'uncertain_wall_binding');continue;}
  const dx=(wall.end.x-wall.start.x)/length,dy=(wall.end.y-wall.start.y)/length;
  resolved.push({opening,x:wall.start.x+dx*offset*length,y:wall.start.y+dy*offset*length,dx,dy,width});
 }
 for(let i=0;i<resolved.length;i++)for(let j=i+1;j<resolved.length;j++){
  const a=resolved[i],b=resolved[j];
  if(a.opening.openingGroupId&&a.opening.openingGroupId===b.opening.openingGroupId)continue;
  if(Math.abs(a.dx*b.dx+a.dy*b.dy)<.995)continue;
  const delta={x:b.x-a.x,y:b.y-a.y};
  if(Math.abs(delta.x*a.dy-delta.y*a.dx)>.22)continue;
  if((a.width+b.width)/2-Math.abs(delta.x*a.dx+delta.y*a.dy)<=.04)continue;
  const bottom=o=>Number(o.sillHeight)||0,top=o=>bottom(o)+(Number(o.height)||2.1);
  if(Math.min(top(a.opening),top(b.opening))-Math.max(bottom(a.opening),bottom(b.opening))<=.02)continue;
  rejected.set(a.opening.id,'overlapping_opening_binding');rejected.set(b.opening.id,'overlapping_opening_binding');
 }
 return {openings:resolved.filter(a=>!rejected.has(a.opening.id)).map(a=>a.opening),rejected:[...rejected].map(([id,reason])=>({id,reason}))};
}
