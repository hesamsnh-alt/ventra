import { furnitureOverlaps } from './interiorPresentation.mjs';
// Observations are already in scene metres/Y-up. Geometry is never changed here.
const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const heights={sofa:.82,bed:.82,armchair:.85,chair:.88,dining_table:.76,coffee_table:.42,rug:.018,kitchen_counter:.88,sink:.86,stove:.9,refrigerator:1.82,wardrobe:2.05,tv_unit:.58,toilet:.78,shower:2.05,desk:.76,nightstand:.5,cabinet:1.4,plant:.9};
// Permit only the front of a chair to tuck slightly under a same-room table.
function tuckedChairPair(a,b){
 const chair=a.type==='chair'?a:b.type==='chair'?b:null;
 const table=a.type==='dining_table'?a:b.type==='dining_table'?b:null;
 if(!chair||!table||chair.roomId!==table.roomId)return false;
 const r=chair.rotation*Math.PI/180,fx=-Math.sin(r),fy=Math.cos(r);
 const tx=table.xMeters-chair.xMeters,ty=table.yMeters-chair.yMeters;
 if(tx*fx+ty*fy<=0)return false;
 const cut=Math.min(.18,chair.depth*.45);
 const rear={...chair,depth:chair.depth-cut,xMeters:chair.xMeters-fx*cut/2,yMeters:chair.yMeters-fy*cut/2};
 return !furnitureOverlaps(rear,table,{width:0,depth:0},0);
}
export function sourcePresentationAssets(scene){
 const review=scene.furnishingReview;
 if(review?.observationCoordinateMode!=='scene_meters_y_up'||!Array.isArray(review.observations))return scene.assets||[];
 return compileSourceFurniture(review.observations,scene.footprint,scene.rooms,scene.walls).assets;
}
export function compileSourceFurniture(observations,footprint,rooms,walls=[]){
 const assets=[],rejected=[];
 for(const [index,o] of (observations||[]).entries()){
  const reject=reason=>rejected.push({id:o.id||String(index),reason});
  if(!(o.type in heights)||!rooms.some(r=>r.id===o.roomId)){reject('unknown_type_or_room');continue;}
  let a=o.backLeft,b=o.backRight; const f=o.frontCenter;
  if(![a,b,f].every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y))||o.confidence<.65){reject('uncertain_observation');continue;}
  let dx=b.x-a.x,dy=b.y-a.y; const width=Math.hypot(dx,dy);if(width<.12||width>6){reject('invalid_width');continue;}
  let nx=-dy/width,ny=dx/width; const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
  let depth=(f.x-mx)*nx+(f.y-my)*ny;
  // Endpoint order is not semantic: the observed front point determines facing.
  if(depth<0){[a,b]=[b,a];dx=-dx;dy=-dy;nx=-nx;ny=-ny;depth=-depth;}
  if(depth<.1||depth>4||Math.abs((f.x-mx)*dx/width+(f.y-my)*dy/width)>.15){reject('invalid_front_axis');continue;}
  const corners=[a,b,{x:b.x+nx*depth,y:b.y+ny*depth},{x:a.x+nx*depth,y:a.y+ny*depth}];
  const center={x:mx+nx*depth/2,y:my+ny*depth/2};
  if(!corners.map(p=>({x:p.x*.98+center.x*.02,y:p.y*.98+center.y*.02})).every(p=>inside(p,footprint))){reject('outside_footprint');continue;}
  const forwardPositive=['sofa','bed','armchair','chair'].includes(o.type);
  const asset={id:o.id,groupId:o.groupId,roomId:o.roomId,type:o.type,xMeters:center.x,yMeters:center.y,width,depth,height:heights[o.type],rotation:Math.atan2(dy,dx)*180/Math.PI+(forwardPositive?0:180),placementSource:'source_image_observation_v1',sourceConfidence:o.confidence,embeddedInCounter:!!o.embeddedInCounter};
  const embeddedPair=(a,b)=>(a.embeddedInCounter&&b.type==='kitchen_counter')||(b.embeddedInCounter&&a.type==='kitchen_counter');
  if(o.type!=='rug' && assets.some(a=>a.type!=='rug'&&!embeddedPair(a,asset)&&!tuckedChairPair(a,asset)&&furnitureOverlaps(a,asset,{width:0,depth:0},-.03))){reject('overlapping_furniture');continue;}
  if(o.type!=='rug' && walls.some(w=>{const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y;const wall={xMeters:(w.start.x+w.end.x)/2,yMeters:(w.start.y+w.end.y)/2,width:Math.hypot(dx,dy),depth:Number(w.thickness)||.12,rotation:Math.atan2(dy,dx)*180/Math.PI};return furnitureOverlaps(asset,wall,{width:0,depth:0},-.04);})){reject('intersects_wall');continue;}
  assets.push(asset);
 }
 return {assets,rejected};
}
