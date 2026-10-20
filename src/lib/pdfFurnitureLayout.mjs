// Deterministic proposed layout. Local +Y is the seat/bed front; cabinet/TV
// fronts use -Y in the production meshes. No architectural coordinate changes.
const positiveFront=new Set(['sofa','bed','armchair','chair','dressing_table','toilet']);
export const furnitureFront=a=>{const t=(Number(a.rotation)||0)*Math.PI/180,sign=positiveFront.has(a.type)?1:-1;return {x:-Math.sin(t)*sign,y:Math.cos(t)*sign};};
const vec=(a,x,y)=>{const t=(a.rotation||0)*Math.PI/180;return {xMeters:a.xMeters+x*Math.cos(t)-y*Math.sin(t),yMeters:a.yMeters+x*Math.sin(t)+y*Math.cos(t)};};
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const distance=(a,b)=>Math.hypot(a.xMeters-b.xMeters,a.yMeters-b.yMeters);
function windowBlocked(a,s){
 const visualHeight=a.type==='tv_unit'?Math.max(a.height,1.4):a.height;
 if(visualHeight<=.6)return false;
 return (s.openings||[]).some(o=>{
  if(o.type!=='window'||visualHeight+(a.zMeters||0)<=Number(o.sillHeight)-.08)return false;
  const w=s.walls.find(w=>w.id===o.wallId);if(!w)return false;
  const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  const along=(a.xMeters-w.start.x)*ux+(a.yMeters-w.start.y)*uy;
  const normal=Math.abs((a.xMeters-w.start.x)*uy-(a.yMeters-w.start.y)*ux);
  const t=(a.rotation||0)*Math.PI/180,ax={x:Math.cos(t),y:Math.sin(t)},ay={x:-Math.sin(t),y:Math.cos(t)};
  const alongHalf=Math.abs(ax.x*ux+ax.y*uy)*a.width/2+Math.abs(ay.x*ux+ay.y*uy)*a.depth/2;
  const normalHalf=Math.abs(ax.x*uy-ax.y*ux)*a.width/2+Math.abs(ay.x*uy-ay.y*ux)*a.depth/2;
  return normal<normalHalf+Number(w.thickness)/2+.25&&Math.abs(along-o.offset*len)<alongHalf+o.width/2+.05;
 });
}
export function pdfFurnitureClear(a,s){return !windowBlocked(a,s);}
export function placePdfFurniture(s,room,base,fits){
 const poly=room.polygon;if(!poly?.length)return null;
 const own=s.assets.filter(a=>a.roomId===room.id),sofa=own.find(a=>a.type==='sofa'),bed=own.find(a=>a.type==='bed'),desk=own.find(a=>a.type==='desk'),counter=own.find(a=>a.type==='kitchen_counter');
 const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),center={xMeters:(Math.min(...xs)+Math.max(...xs))/2,yMeters:(Math.min(...ys)+Math.max(...ys))/2};
 const usable=a=>{
  if(!fits(a)||!pdfFurnitureClear(a,s))return false;
  const tv=own.find(b=>b.type==='tv_unit');
  if(sofa&&tv&&!['sofa','tv_unit','coffee_table','rug'].includes(a.type)){
   const dx=tv.xMeters-sofa.xMeters,dy=tv.yMeters-sofa.yMeters,len=Math.hypot(dx,dy),along=((a.xMeters-sofa.xMeters)*dx+(a.yMeters-sofa.yMeters)*dy)/(len*len);
   const off=Math.abs((a.xMeters-sofa.xMeters)*dy-(a.yMeters-sofa.yMeters)*dx)/len;
   if(along>0&&along<1&&off<.55+Math.min(a.width,a.depth)/2)return false;
  }
  return true;
 };
 const relational=[];
 if(base.type==='coffee_table'&&sofa){for(const gap of [.4,.55,.7])relational.push({...base,...vec(sofa,0,sofa.depth/2+base.depth/2+gap),rotation:sofa.rotation,layoutAnchorId:sofa.id});}
 if(base.type==='nightstand'&&bed){for(const side of [-1,1])relational.push({...base,...vec(bed,side*(bed.width/2+base.width/2+.12),-bed.depth/2+base.depth/2),rotation:bed.rotation,layoutAnchorId:bed.id});}
 if(base.type==='chair'&&desk){const f=furnitureFront(desk);relational.push({...base,xMeters:desk.xMeters+f.x*(desk.depth/2+base.depth/2+.22),yMeters:desk.yMeters+f.y*(desk.depth/2+base.depth/2+.22),rotation:Math.atan2(-f.y,-f.x)*180/Math.PI-90,layoutAnchorId:desk.id});}
 if(relational.length)return relational.find(usable)||null;
 const candidates=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<base.width+.15)continue;
  for(const sign of [1,-1])for(const f of [.5,.375,.625,.25,.75,.125,.875]){
   const nx=-dy/len*sign,ny=dx/len*sign;
   // Offset accounts for the source wall face and proposed furniture rear clearance.
   const inset=base.depth/2+Math.max(.16,(s.externalWallThickness||.2)/2+.08);
   const rotation=Math.atan2(ny,nx)*180/Math.PI+(positiveFront.has(base.type)?-90:90);
   candidates.push({...base,xMeters:a.x+dx*f+nx*inset,yMeters:a.y+dy*f+ny*inset,rotation,layoutWallIndex:i,layoutWallLength:len});
  }
 }
 // Free-standing tables belong inside the room; edge-first packing was the old failure.
 if(['dining_table','armchair','plant'].includes(base.type))for(const rotation of [0,90,180,270])for(const fx of [.5,.35,.65,.25,.75])for(const fy of [.5,.35,.65,.25,.75])candidates.push({...base,rotation,xMeters:Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*fx,yMeters:Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*fy});
 function score(a){
  let value=distance(a,center)*.08-(a.layoutWallLength||0)*.03;
  if(base.type==='tv_unit'&&sofa){
   const gaze=furnitureFront(sofa),v={x:a.xMeters-sofa.xMeters,y:a.yMeters-sofa.yMeters},len=Math.hypot(v.x,v.y),f=furnitureFront(a),alignment=dot(gaze,v)/len;
   if(len<1.8||alignment<.9||dot(f,{x:-v.x/len,y:-v.y/len})<.9)return Infinity;
   value=(1-alignment)*20+Math.abs(len-3)*.2; a.layoutAnchorId=sofa.id;
  }
  if(base.type==='wardrobe'&&bed&&distance(a,bed)<(bed.width+a.width)/2+.8)return Infinity;
  if(base.type==='dining_table')value=distance(a,center)+(a.layoutWallIndex===undefined?0:3);
  if(base.type==='refrigerator'&&counter)value+=distance(a,counter)*.4;
  if(base.type==='armchair'&&sofa){const len=distance(a,sofa),gaze=furnitureFront(sofa),v={x:a.xMeters-sofa.xMeters,y:a.yMeters-sofa.yMeters};
   const lateral=Math.abs(v.x*gaze.y-v.y*gaze.x);if(len<1.2||len>3.5||lateral<.9)return Infinity;
   const target=own.find(b=>b.type==='coffee_table')||sofa,toward={x:target.xMeters-a.xMeters,y:target.yMeters-a.yMeters},dl=Math.hypot(toward.x,toward.y);
   value+=Math.abs(len-2)+(1-dot(furnitureFront(a),toward)/dl)*3;
  }
  return value;
 }
 // Rank before collision checks. Every accepted candidate still passes source
 // room, door, void, wall, existing-furniture and window checks.
 return candidates.map((a,i)=>({a,i,score:score(a)})).filter(c=>Number.isFinite(c.score)).sort((a,b)=>a.score-b.score||a.i-b.i).find(c=>usable(c.a))?.a||null;
}
