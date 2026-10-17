const fail=m=>{throw new Error(m);};
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(distance(p,a,b)<.002)return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
export function snapWallPoint(scene,point,anchor=null){
 if(!point||![point.x,point.y].every(Number.isFinite))return point;
 const ends=(scene.walls||[]).flatMap(w=>[w.start,w.end]).filter(Boolean);
 const nearest=ends.map(p=>({p,d:Math.hypot(point.x-p.x,point.y-p.y)})).sort((a,b)=>a.d-b.d)[0];
 if(nearest?.d<=.3)return {...nearest.p};
 const projected=(scene.walls||[]).map(w=>{
  const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,t=Math.max(0,Math.min(1,((point.x-w.start.x)*dx+(point.y-w.start.y)*dy)/(dx*dx+dy*dy||1)));
  const p={x:w.start.x+t*dx,y:w.start.y+t*dy};return {p,d:Math.hypot(point.x-p.x,point.y-p.y)};
 }).sort((a,b)=>a.d-b.d)[0];
 if(projected?.d<=.18)return projected.p;
 const p={...point};if(anchor){if(Math.abs(p.x-anchor.x)<=.12)p.x=anchor.x;else if(Math.abs(p.y-anchor.y)<=.12)p.y=anchor.y;}
 return p;
}
export function wallDrawingPoints(scene,edit){const start=snapWallPoint(scene,edit.start);return {start,end:snapWallPoint(scene,edit.end,start)};}
export function nearestEditableWall(scene,point){
 if(!point)return null;
 return (scene.walls||[]).map(w=>({w,d:distance(point,w.start,w.end)})).filter(({w,d})=>d<=Math.max(.15,(w.thickness||.12)/2+.08)).sort((a,b)=>a.d-b.d)[0]?.w.id||null;
}
export function assertWallOnlyEdit(before,after){
 for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!['walls','openings','manualWallEditor','updatedAt'].includes(k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]))fail(`Wall editor cannot change ${k}.`);
 const ids=new Set(after.walls.map(w=>w.id));if(after.openings.some(o=>!ids.has(o.wallId)&&before.walls.some(w=>w.id===o.wallId)))fail('Opening has a deleted host wall.');
}
export function applyWallEdit(scene,edit){
 if(!Array.isArray(scene?.walls)||!Array.isArray(scene.openings))fail('Wall editor needs a structured floor model.');
 const next=structuredClone(scene);
 if(edit.kind==='restore'){
  if(!Array.isArray(edit.walls)||!Array.isArray(edit.openings))fail('No wall edit to undo.');
  next.walls=structuredClone(edit.walls);next.openings=structuredClone(edit.openings);
 }else if(edit.kind==='remove'){
  if(!next.walls.some(w=>w.id===edit.wallId))fail('Click a wall to remove. / روی یک دیوار کلیک کن. / اضغط على جدار لحذفه.');
  const groups=new Set(next.openings.filter(o=>o.wallId===edit.wallId).map(o=>o.openingGroupId).filter(Boolean));
  next.walls=next.walls.filter(w=>w.id!==edit.wallId);
  next.openings=next.openings.filter(o=>o.wallId!==edit.wallId&&!groups.has(o.openingGroupId));
 }else if(edit.kind==='add'){
  const {start,end}=wallDrawingPoints(scene,edit);
  if(![start?.x,start?.y,end?.x,end?.y].every(Number.isFinite)||Math.hypot(end.x-start.x,end.y-start.y)<.1)fail('Choose two different floor points at least 10 cm apart. / دو نقطه با حداقل ۱۰ سانتی‌متر فاصله انتخاب کن.');
  const thickness=Number(edit.thickness??.12),height=3.2;
  if(!Number.isFinite(thickness)||thickness<.05||thickness>.5)fail('Wall thickness must be 5–50 cm.');
  const polygon=scene.footprint?.length?scene.footprint:[{x:0,y:0},{x:scene.width,y:0},{x:scene.width,y:scene.depth},{x:0,y:scene.depth}];
  // Sample both sides of the full wall, including endpoints; keep partitions
  // within this floor, including concave boundaries and shafts.
  const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
  for(let i=0;i<=Math.ceil(len/.025);i++){
   const t=i/Math.ceil(len/.025),p={x:start.x+dx*t,y:start.y+dy*t};
   for(const side of [-1,0,1]){
    const q={x:p.x+nx*thickness/2*side,y:p.y+ny*thickness/2*side};
    if((side===0&&!inside(p,polygon))||(scene.holes||[]).some(h=>inside(q,h.polygon||[])))fail('Wall must stay inside this floor and outside voids. / دیوار باید داخل همین طبقه و بیرون چاه باشد.');
   }
  }
  if(next.walls.length>=1000)fail('Too many walls.');
  if(next.walls.some(w=>distance(start,w.start,w.end)<.005&&distance(end,w.start,w.end)<.005))fail('A wall already covers this segment. / این قسمت دیوار دارد.');
  const id=`manual-wall-${globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)}`;
  next.walls.push({id,start:{...start},end:{...end},type:'internal',thickness,height,provenance:'proposed',placementSource:'manual_wall_editor',excludeFromTakeoff:true});
 }else fail('Unsupported wall operation.');
 next.updatedAt=new Date().toISOString();next.manualWallEditor={version:103,lastOperation:edit.kind,excludeFromTakeoff:true,roomBoundariesUnchanged:true};
 assertWallOnlyEdit(scene,next);return next;
}
export function previewWallEdit(scene,edit){
 const {start,end}=wallDrawingPoints(scene,edit);const candidate=start&&end?{id:'wall-preview',xMeters:(start.x+end.x)/2,yMeters:(start.y+end.y)/2,width:Math.hypot(end.x-start.x,end.y-start.y),depth:Number(edit.thickness)||.12,height:3.2,rotation:Math.atan2(end.y-start.y,end.x-start.x)*180/Math.PI}:null;
 try{applyWallEdit(scene,edit);return {candidate,valid:true};}catch(e){return {candidate,valid:false,error:e.message};}
}
