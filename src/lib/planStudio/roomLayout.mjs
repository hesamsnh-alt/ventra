import {FURNITURE_CATALOG} from '../furnitureEditor.mjs';
import {placePdfFurniture,pdfFurnitureClear} from '../pdfFurnitureLayout.mjs';
import {placementProblem} from '../scenePromptActions.mjs';
import {furnitureOverlaps} from '../interiorPresentation.mjs';
import {id,visibleEntities} from './document.mjs';
import {shaftOuter} from './structures.mjs';
import {multilinePreview} from './multilineWalls.mjs';
import {openingPlanGeometry} from './openings.mjs';
import {at,dist,inside,segments,curveIntersections} from './geometry.mjs';

export const ROOM_LAYOUTS=[
 ['living','Living room','نشیمن',['sofa-modern','tv-console-oak','coffee-low']],
 ['dining','Dining room','غذاخوری',['dining-oak']],
 ['bedroom','Bedroom','اتاق خواب',['bed-modern','wardrobe','nightstand']],
 ['office','Study','اتاق کار',['desk','chair']],
 ['kitchen','Kitchen','آشپزخانه',['counter','cooker','basin','fridge']],
 ['bathroom','Bathroom','حمام و سرویس',['bath','toilet','basin']],
];
const models=new Map(FURNITURE_CATALOG.map(model=>[model.id,model]));
const overlapping=(a,b)=>a.some(p=>inside(p,b))||b.some(p=>inside(p,a))||
 segments({type:'polyline',points:a,closed:true}).some(x=>
  segments({type:'polyline',points:b,closed:true}).some(y=>curveIntersections(x,y).length));

function wallRecord(wall,start,end){return {id:wall.id,start,end,thickness:wall.thickness};}
function floorWalls(entities,z){
 return entities.filter(e=>e.role==='wall'&&(e.z||0)<=z+.01&&(e.z||0)+e.height>z).flatMap(wall=>{
  if(wall.type==='line')return [wallRecord(wall,wall.a,wall.b)];
  const count=Math.min(160,Math.max(12,Math.ceil(Math.abs(wall.sweep)*wall.radius/.15)));
  return Array.from({length:count},(_,i)=>wallRecord(wall,at(wall,i/count),at(wall,(i+1)/count)));
 });
}
const toSceneAsset=e=>({id:e.id,type:models.get(e.catalogId)?.type,xMeters:e.center.x,yMeters:e.center.y,
 width:e.width,depth:e.depth,height:e.height,rotation:e.rotation||0,zMeters:e.z||0});

export function arrangePlanRoom(doc,a,b,{kind,z,tiles}){
 const spec=ROOM_LAYOUTS.find(option=>option[0]===kind);
 const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),depth=Math.abs(a.y-b.y);
 if(!spec||width<1||depth<1)throw Error('Choose a room at least 1 m wide and deep. / دو گوشهٔ فضایی با عرض و طول حداقل یک متر را بزن.');
 const furnitureLayer=doc.layers.find(l=>l.id==='furniture');
 if(!furnitureLayer?.visible||furnitureLayer.locked)throw Error('Show and unlock the furniture layer. / لایهٔ مبلمان را روشن و باز کن.');
 const polygon=[{x,y},{x:x+width,y},{x:x+width,y:y+depth},{x,y:y+depth}],room={id:'arrange-room',polygon};
 const visible=visibleEntities(doc);
 const preview=multilinePreview(visible);
 const wallBands=preview.bands.filter(band=>band.z<=z+.01&&band.z+band.height>z);
 const walls=floorWalls(visible,z),wallIds=new Set(walls.map(w=>w.id));
 const openings=doc.entities.filter(e=>e.type==='opening'&&wallIds.has(e.wall));
 const holes=visible.filter(e=>e.role==='shaft'&&(e.z||0)<=z+.01&&(e.z||0)+e.height>=z).map(e=>({polygon:shaftOuter(e)}));
 const scene={width,depth,walls,holes,rooms:[room],assets:visible.filter(e=>e.type==='asset').map(toSceneAsset),
  openings:openings.map(e=>({...e,type:e.kind==='window'?'window':'door',wallId:e.wall,sillHeight:(e.z||0)+(doc.entities.find(w=>w.id===e.wall)?.z||0)}))};
 const swingLines=openings.filter(e=>e.kind!=='window').flatMap(e=>{
  const g=openingPlanGeometry(doc,e),arc=g?.curves.find(curve=>curve.type==='arc');
  return !arc?[]:Array.from({length:17},(_,i)=>{
   const end=at(arc,i/16),start=g.hinge;
   return {xMeters:(start.x+end.x)/2,yMeters:(start.y+end.y)/2,width:dist(start,end)+.06,depth:.12,
    rotation:Math.atan2(end.y-start.y,end.x-start.x)*180/Math.PI};
  });
 });
 const hitsBand=c=>{
  if(!wallBands.length)return false;
  const angle=c.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const footprint=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([u,v])=>({
   x:c.xMeters+u*c.width*cos-v*c.depth*sin,y:c.yMeters+u*c.width*sin+v*c.depth*cos,
  }));
  return wallBands.some(band=>overlapping(footprint,band.points)&&
   !band.holes.some(hole=>footprint.every(p=>inside(p,hole))&&
    !segments({type:'polyline',points:footprint,closed:true}).some(a=>
     segments({type:'polyline',points:hole,closed:true}).some(b=>curveIntersections(a,b).length))));
 };
 const fits=c=>!placementProblem(c,scene,{manualFurniturePlacement:true})&&pdfFurnitureClear(c,scene)&&
  !swingLines.some(leaf=>furnitureOverlaps(c,leaf,scene))&&!hitsBand(c);
 const group=id(),placed=[];
 const make=model=>({id:id(),type:model.type,catalogId:model.id,roomId:room.id,width:model.width,depth:model.depth,height:model.height,zMeters:z});
 for(const catalogId of spec[3]){
  const model=models.get(catalogId),candidate=make(model);
  let chairs;
  const best=placePdfFurniture(scene,room,candidate,c=>{
   if(!fits(c))return false;
   if(kind!=='dining')return true;
   const chair=models.get('chair'),dx=c.width/2+chair.depth/2+.06,dy=c.depth/2+chair.depth/2+.06;
   const t=c.rotation*Math.PI/180;
   chairs=[[-dx,0,-90],[dx,0,90],[0,-dy,0],[0,dy,180]].map(([u,v,rotation])=>({...make(chair),
    xMeters:c.xMeters+u*Math.cos(t)-v*Math.sin(t),yMeters:c.yMeters+u*Math.sin(t)+v*Math.cos(t),rotation:c.rotation+rotation}));
   return chairs.every(fits);
  });
  if(!best)throw Error('Not enough clear space for this layout. / فضای آزاد کافی برای این چیدمان وجود ندارد.');
  placed.push(best,...(chairs||[]));scene.assets.push(best,...(chairs||[]));
 }
 const output=placed.map(e=>({id:e.id,type:'asset',catalogId:e.catalogId,layer:'furniture',center:{x:e.xMeters,y:e.yMeters},
  width:e.width,depth:e.depth,height:e.height,rotation:e.rotation,z,color:'bylayer',modelColor:models.get(e.catalogId).color,setId:group}));
 if(tiles&&['kitchen','bathroom'].includes(kind)){
  const border=.015;
  const outline=[{x:x+border,y:y+border},{x:x+width-border,y:y+border},{x:x+width-border,y:y+depth-border},{x:x+border,y:y+depth-border}];
  const autoFloor=preview.floors.find(floor=>Math.abs(floor.z-z)<.01&&outline.every(p=>inside(p,floor.points)));
  if(!doc.entities.some(e=>e.role==='floor'&&Math.abs((e.z||0)-z)<.01&&overlapping(outline,e.points))){
   const architecture=doc.layers.find(l=>l.id==='architecture');
   if(!architecture?.visible||architecture.locked)throw Error('Show and unlock the architecture layer for floor tiles. / برای کاشی، لایهٔ معماری را روشن و باز کن.');
   output.push({id:id(),type:'polyline',role:'floor',layer:'architecture',points:outline,closed:true,height:autoFloor ? .003 : .12,z:z+(autoFloor ? .003 : 0),roomFinish:Boolean(autoFloor),hatch:'tile',hatchScale:.3,color:'bylayer',surfaceColor:'#dcd7cb'});
  }
 }
 return {doc:{...doc,entities:[...doc.entities,...output]},selection:output.map(e=>e.id)};
}
