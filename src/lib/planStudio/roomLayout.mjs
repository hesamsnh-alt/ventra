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
// Smaller fixtures use explicit catalogue footprints. Every preset still
// passes the same geometry, door swing and overlap checks.
const compactLayouts={
 living:[{items:[['sofa-modern',1.35,.78],['tv-console-oak',.9,.32]]},
  {items:[['sofa-modern',1.25,.72]],essential:true}],
 dining:[{items:[['dining-small',.75,.65]],chairs:2}],
 bedroom:[{items:[['bed-modern',.9,1.95],['nightstand',.32,.32]]},
  {items:[['bed-modern',.9,1.9]],essential:true}],
 office:[{items:[['desk',.85,.48],['chair',.43,.45]]}],
 kitchen:[{items:[['counter',.85,.52],['cooker',.45,.52],['basin',.42,.42],['fridge',.5,.56]]},
  {items:[['counter',.8,.47],['basin',.42,.4]],essential:true}],
 bathroom:[{items:['shower','toilet',['basin',.43,.35]]},
  {items:['toilet','shower',['basin',.43,.35]]},
  {items:['toilet',['basin',.43,.35]],essential:true}],
};
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
 if(!spec||width<.8||depth<.8)throw Error('Choose a room at least 80 cm wide and deep. / دو گوشهٔ فضایی با عرض و طول حداقل ۸۰ سانتی‌متر را بزن.');
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
 const group=id();
 const make=(entry)=>{
  const [catalogId,w,d]=Array.isArray(entry)?entry:[entry];
  const model=models.get(catalogId);
  return {id:id(),type:model.type,catalogId,roomId:room.id,width:w??model.width,depth:d??model.depth,height:model.height,zMeters:z};
 };
 const compactCandidates=candidate=>[0,90,180,270].flatMap(rotation=>{
  const swapped=rotation%180!==0;
  const hx=(swapped?candidate.depth:candidate.width)/2+.026;
  const hy=(swapped?candidate.width:candidate.depth)/2+.026;
  if(hx*2>width||hy*2>depth)return [];
  const fractions=[0,1,.5,.25,.75];
  return fractions.flatMap(fx=>fractions.map(fy=>({...candidate,rotation,
   xMeters:x+hx+(width-2*hx)*fx,yMeters:y+hy+(depth-2*hy)*fy})));
 });
 function attemptLayout({items,chairs:chairCount,compact}){
  const before=scene.assets.length,placed=[];
  for(const entry of items){
   const candidate=make(entry);
   let chairs=[];
   const withChairs=c=>{
    if(!fits(c))return false;
    if(!chairCount)return true;
    const chair=compact?['chair',.42,.44]:'chair',prototype=make(chair);
    const gap=compact ? .04 : .06;
    const dx=c.width/2+prototype.depth/2+gap,dy=c.depth/2+prototype.depth/2+gap;
    const t=c.rotation*Math.PI/180;
    const targets=chairCount===2?[[0,-dy,0],[0,dy,180]]:[[-dx,0,-90],[dx,0,90],[0,-dy,0],[0,dy,180]];
    chairs=targets.map(([u,v,rotation])=>({...make(chair),
     xMeters:c.xMeters+u*Math.cos(t)-v*Math.sin(t),yMeters:c.yMeters+u*Math.sin(t)+v*Math.cos(t),rotation:c.rotation+rotation}));
    return chairs.every(fits);
   };
   const best=placePdfFurniture(scene,room,candidate,withChairs)||
    (compact&&compactCandidates(candidate).find(withChairs));
   if(!best){scene.assets.length=before;return null;}
   placed.push(best,...chairs);scene.assets.push(best,...chairs);
  }
  return placed;
 }
 let status='',placed=attemptLayout({items:spec[3],chairs:kind==='dining'?4:0});
 if(!placed){
  for(const preset of compactLayouts[kind]){
   placed=attemptLayout({...preset,compact:true});
   if(!placed)continue;
   status=preset.essential?
    'Only essential items fit here. / فقط وسایل ضروری در این فضا جا شدند.':
    'Compact room layout applied. / چیدمان جمع‌وجور درج شد.';
   break;
  }
 }
 if(!placed)throw Error('Not enough clear space even for the compact layout. / حتی چیدمان جمع‌وجور هم با فضای آزاد و بازشوی در جا نمی‌شود.');
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
 return {doc:{...doc,entities:[...doc.entities,...output]},selection:output.map(e=>e.id),status};
}
