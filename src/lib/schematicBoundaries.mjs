import {canonicalRoomType} from './roomSemantics.mjs';
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const project=(p,a,b)=>((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2);
function edgeIntervals(wall,room){
 const a=wall.start,b=wall.end,len=Math.hypot(b.x-a.x,b.y-a.y),ranges=[];
 if(len<.01)return ranges;
 const tolerance=.12;
 const distance=p=>Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/len;
 const poly=room.polygon||[];
 for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length];
  if(distance(p)>tolerance||distance(q)>tolerance)continue;
  const low=Math.max(0,Math.min(project(p,a,b),project(q,a,b)));
  const high=Math.min(1,Math.max(project(p,a,b),project(q,a,b)));
  if((high-low)*len>.05)ranges.push([low,high]);
 }
 return ranges;
}
// Outdoor exterior edges get a visual guardrail. Shared indoor boundaries
// remain full walls. No footprint, room area or opening location is changed.
export function outdoorBoundaries(walls,rooms,openings){
 const output=[],mapped=[];
 for(const wall of walls){
  if(wall.type!=='external'){output.push(wall);mapped.push(...openings.filter(o=>o.wallId===wall.id));continue;}
  const outdoor=rooms.filter(r=>canonicalRoomType(r)==='balcony').flatMap(r=>edgeIntervals(wall,r));
  const indoor=rooms.filter(r=>canonicalRoomType(r)!=='balcony').flatMap(r=>edgeIntervals(wall,r));
  if(!outdoor.length){output.push(wall);mapped.push(...openings.filter(o=>o.wallId===wall.id));continue;}
  const cuts=[...new Set([0,1,...outdoor.flat(),...indoor.flat()])].sort((a,b)=>a-b);
  const pieces=[];
  for(let i=0;i<cuts.length-1;i++){
   const lo=cuts[i],hi=cuts[i+1],mid=(lo+hi)/2;
   if(hi-lo<1e-6)continue;
   const railing=outdoor.some(([a,b])=>mid>=a&&mid<=b)&&!indoor.some(([a,b])=>mid>=a&&mid<=b);
   const prior=pieces.at(-1);
   if(prior&&prior.railing===railing)prior.hi=hi;else pieces.push({lo,hi,railing});
  }
  for(const [i,p] of pieces.entries())output.push({...wall,id:pieces.length===1?wall.id:`${wall.id}_outdoor_${i}`,start:lerp(wall.start,wall.end,p.lo),end:lerp(wall.start,wall.end,p.hi),...(p.railing?{type:'railing',height:1.1,heightSource:'visual_default_not_measured'}:{})});
  for(const opening of openings.filter(o=>o.wallId===wall.id)){
   const t=Number(opening.offset),i=pieces.findIndex(p=>t>=p.lo-1e-6&&t<=p.hi+1e-6);
   if(i<0)continue;
   const p=pieces[i];mapped.push({...opening,wallId:pieces.length===1?wall.id:`${wall.id}_outdoor_${i}`,offset:(t-p.lo)/(p.hi-p.lo)});
  }
 }
 return {walls:output,openings:mapped};
}
export function observedDoorOrientation(opening,wall){
 const side=String(opening.hingeSide||'unknown').toLowerCase();
 const a=wall.start,b=wall.end;
 const first=side==='left'?a.x<=b.x:side==='right'?a.x>=b.x:side==='top'?a.y>=b.y:side==='bottom'?a.y<=b.y:null;
 const direction=String(opening.swingDirection||'unknown').toLowerCase();
 // Image Y-down is reflected into world Y-up: reverse the observed rotation.
 const swing=direction==='clockwise'?'counterclockwise':direction==='counterclockwise'?'clockwise':'unknown';
 return {hinge:first===null?'unknown':first?'start':'end',swing,orientationSource:'source_image_y_down',openAngleDegrees:first===null||swing==='unknown'?0:90};
}
