// Plan-space metres, Z-up camera. Read-only: never changes project geometry.
export const WALK_RADIUS=.22, WALK_EYE_HEIGHT=1.6, WALK_BODY_HEIGHT=1.8;
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const polygon=p=>Array.isArray(p)&&p.length>=3&&p.every(finite);
const inside=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const edgeDistance=(p,poly)=>Math.min(...poly.map((a,i)=>distance(p,a,poly[(i+1)%poly.length])));
export function createWalkWorld(scene){
 if(!Number.isFinite(scene?.width)||!Number.isFinite(scene?.depth)||scene.width<=0||scene.depth<=0)throw Error('Walk needs valid floor geometry. / هندسه معتبر کف لازم است.');
 const rooms=(scene.rooms||[]).filter(r=>polygon(r.polygon)),footprint=polygon(scene.footprint)?scene.footprint:null;
 if(!footprint&&!rooms.length)throw Error('Walk needs a floor boundary. / مرز کف برای گشت مشخص نیست.');
 const holes=(scene.holes||[]).map(h=>h.polygon||h).filter(polygon),walls=[];
 for(const w of scene.walls||[]){
  if(!finite(w.start)||!finite(w.end))throw Error('Wall geometry is invalid. / هندسه دیوار معتبر نیست.');
  const length=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y);if(length<.001)continue;
  // Match the display renderer's thickness defaults; never use a thinner collider.
  const rendered=w.placementSource==='manual_wall_editor'&&w.thickness>0?Number(w.thickness):w.type==='external'?Math.max(.12,Number(scene.externalWallThickness)||.18):Math.max(.08,Number(scene.wallThickness)||.12);
  const thickness=Math.max(rendered,Number(w.thickness)||0),gaps=[];
  for(const o of scene.openings||[]){
   if(String(o.wallId)!==String(w.id)||o.type!=='door'||!Number.isFinite(o.offset)||o.offset<0||o.offset>1||!Number.isFinite(o.width)||o.width<=WALK_RADIUS*2)continue;
   const height=Number(o.height)||2.1,sill=Number(o.sillHeight)||0;
   if(height<WALK_BODY_HEIGHT||sill>.05)continue;
   gaps.push([Math.max(0,o.offset*length-o.width/2),Math.min(length,o.offset*length+o.width/2)]);
  }
  gaps.sort((a,b)=>a[0]-b[0]);let cursor=0;const solid=[];for(const [a,b] of gaps){if(a>cursor)solid.push([cursor,a]);cursor=Math.max(cursor,b);}if(cursor<length)solid.push([cursor,length]);
  for(const [a,b] of solid)walls.push({a:{x:w.start.x+(w.end.x-w.start.x)*a/length,y:w.start.y+(w.end.y-w.start.y)*a/length},b:{x:w.start.x+(w.end.x-w.start.x)*b/length,y:w.start.y+(w.end.y-w.start.y)*b/length},radius:thickness/2});
 }
 const obstacles=(scene.assets||[]).filter(a=>!['rug','mirror','painting','wall_art','ceiling_light','pendant_light','door','window'].includes(a.type)&&(Number(a.zMeters)||0)<WALK_BODY_HEIGHT&&(Number(a.zMeters)||0)+(Number(a.height)||0)>.12).map(a=>({x:Number(a.xMeters??Number(a.x)*scene.width),y:Number(a.yMeters??Number(a.y)*scene.depth),w:Number(a.width),d:Number(a.depth),angle:(Number(a.rotation)||0)*Math.PI/180})).filter(a=>[a.x,a.y,a.w,a.d].every(Number.isFinite)&&a.w>0&&a.d>0);
 const world={scene,rooms,footprint,holes,walls,obstacles,origin:scene.designDefaults?.viewOriginMeters||{x:scene.width/2,y:scene.depth/2}};
 if(!finite(world.origin))throw Error('Invalid view origin.');return world;
}
export function walkPositionAllowed(world,p,r=WALK_RADIUS){
 if(!finite(p))return false;
 if(world.footprint){if(!inside(p,world.footprint)||edgeDistance(p,world.footprint)<r)return false;}
 else{for(let i=0;i<17;i++){const q=i===16?p:{x:p.x+Math.cos(i*Math.PI/8)*r,y:p.y+Math.sin(i*Math.PI/8)*r};if(!world.rooms.some(room=>inside(q,room.polygon)))return false;}}
 if(world.holes.some(h=>inside(p,h)||edgeDistance(p,h)<r))return false;
 if(world.walls.some(w=>distance(p,w.a,w.b)<r+w.radius))return false;
 for(const a of world.obstacles){const dx=p.x-a.x,dy=p.y-a.y,x=dx*Math.cos(a.angle)+dy*Math.sin(a.angle),y=-dx*Math.sin(a.angle)+dy*Math.cos(a.angle);if(Math.hypot(Math.max(0,Math.abs(x)-a.w/2),Math.max(0,Math.abs(y)-a.d/2))<r)return false;}
 return true;
}
export function walkSpawn(world){
 for(const poly of [...world.rooms.map(r=>r.polygon),...(world.footprint?[world.footprint]:[])]){
  const center={x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length};if(walkPositionAllowed(world,center))return center;
  const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
  for(let y=1;y<30;y++)for(let x=1;x<30;x++){const p={x:minX+w*x/30,y:minY+h*y/30};if(inside(p,poly)&&walkPositionAllowed(world,p))return p;}
 }
 throw Error('No clear walking position found. / فضای خالی و امنی برای شروع گشت پیدا نشد.');
}
export function moveWalk(world,p,dx,dy){
 if(![dx,dy].every(Number.isFinite)||!walkPositionAllowed(world,p))return {...p};
 const distance=Math.hypot(dx,dy),scale=distance>2?2/distance:1;dx*=scale;dy*=scale;
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.045));let next={...p};
 for(let i=0;i<steps;i++){const both={x:next.x+dx/steps,y:next.y+dy/steps};if(walkPositionAllowed(world,both))next=both;else{
  const x={x:next.x+dx/steps,y:next.y};if(walkPositionAllowed(world,x))next=x;const y={x:next.x,y:next.y+dy/steps};if(walkPositionAllowed(world,y))next=y;
 }}return next;
}
