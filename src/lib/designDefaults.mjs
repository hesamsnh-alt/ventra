import {placePdfFurniture} from './pdfFurnitureLayout.mjs';
import {applyPdfInteriorDefaults} from './pdfInteriorDefaults.mjs';
import {canonicalRoomType} from './roomSemantics.mjs';
import {placementProblem} from './scenePromptActions.mjs';
import {restoreWallContactFurniture} from './sourceFurniture.mjs';

// Visual policy only. Never imported by takeoff, BOQ or cost calculations.
export const DESIGN_DEFAULTS=Object.freeze({version:'room-design-defaults-v64',wallHeightMeters:3.2,floorLevelMeters:0,origin:'plan_center',wetFloor:'wet_tile',dryFloor:'light_oak'});
const sizes={toilet:[.55,.75,.78],sink:[.65,.45,.85],shower:[.85,.85,2.1],bed:[1.4,2,.65],dressing_table:[.9,.42,1.6],sofa:[2,.85,.85],tv_unit:[1.4,.35,.65],plant:[.35,.35,.9],kitchen_counter:[1.8,.6,.92],stove:[.6,.6,.9],range_hood:[.6,.48,.45],washing_machine:[.6,.65,.88],refrigerator:[.7,.7,1.85],dining_table:[1.2,.75,.76],chair:[.42,.45,.88],wardrobe:[1.6,.6,2.1],nightstand:[.5,.45,.5],coffee_table:[1.1,.65,.42],rug:[2.2,1.6,.025],desk:[1.3,.65,.76],cabinet:[1.2,.55,.9],armchair:[.85,.85,.9]};
const uses=room=>{
 const canonical=canonicalRoomType(room),text=`${room.name||''} ${room.type||''} ${room.semanticType||''}`.toLowerCase();
 const kitchen=['kitchen','kitchen_dining'].includes(canonical),living=canonical==='living'||(/living|lounge|پذیرایی|پذیرائی|نشیمن|معيشة|معیشة|مجلس/.test(text)&&kitchen);
 return {canonical,kitchen,living};
};
const make=(room,type,index)=>({id:`default_${room.id}_${type}_${index}`,roomId:room.id,type,width:sizes[type][0],depth:sizes[type][1],height:sizes[type][2],rotation:0,placementSource:'design_default_not_measured',provenance:'proposed',excludeFromTakeoff:true});
const groundScene=s=>({...s,assets:s.assets.filter(a=>a.type!=='range_hood')});
const valid=(a,s,parent)=>!placementProblem(a,{...groundScene(s),assets:groundScene(s).assets.filter(b=>b.id!==parent)});
const diningChairs=(table,room)=>{
 const angle=(table.rotation||0)*Math.PI/180;
 return [[-table.width/2-.29,0,-90],[table.width/2+.29,0,90],[0,-table.depth/2-.3,0],[0,table.depth/2+.3,180]].map(([x,y,rotation],index)=>({...make(room,'chair',index),xMeters:table.xMeters+x*Math.cos(angle)-y*Math.sin(angle),yMeters:table.yMeters+x*Math.sin(angle)+y*Math.cos(angle),rotation:rotation+(table.rotation||0),groupId:table.id}));
};
function place(s,room,type,index,pdfLayout=false){
 const base=make(room,type,index),poly=room.polygon;
 if(!poly?.length)return null;
 const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
 const fits=c=>valid(c,s)&&(type!=='dining_table'||diningChairs(c,room).every(a=>valid(a,{...s,assets:[...s.assets,c]})));
 if(pdfLayout)return placePdfFurniture(s,room,base,fits);
 // Follow actual room edges before an interior grid. No architecture snapping.
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(len<base.width+.2)continue;
  for(const sign of [1,-1])for(let k=1;k<=7;k++){
   const nx=-dy/len*sign,ny=dx/len*sign,offset=base.depth/2+.12;
   const c={...base,xMeters:a.x+dx*k/8+nx*offset,yMeters:a.y+dy*k/8+ny*offset,rotation:Math.atan2(ny,nx)*180/Math.PI+90};
   if(fits(c))return c;
  }
 }
 for(const rotation of [0,90,180,270])for(let i=1;i<=12;i++)for(let j=1;j<=12;j++){
  const c={...base,rotation,xMeters:x0+(x1-x0)*i/13,yMeters:y0+(y1-y0)*j/13};
  if(fits(c))return c;
 }
 return null;
}
export function applyDesignDefaults(input,options={}){
 if(input?.nativePdfGeometryVersion==='native-pdf-plan-v162')return applyPdfInteriorDefaults(input,applySingleDesignDefaults,options);
 return applySingleDesignDefaults(input,options);
}
function applySingleDesignDefaults(input,{force=false,pdfInterior=false,pdfLayoutLegacy=false,suppressedDefaultKeys=[]}={}){
 if(!input||input.designDefaults?.version===DESIGN_DEFAULTS.version&&!force)return input;
 if(!Number.isFinite(input.width)||!Number.isFinite(input.depth)||!Array.isArray(input.rooms)||!input.rooms.length||!Array.isArray(input.assets)||!Array.isArray(input.walls)||input.rooms.length>200||input.assets.length>300)return input;
 const s=structuredClone(restoreWallContactFurniture(input).scene),added=[],warnings=[];
 const measured=['source_dimension','source_annotation','measured'].includes(s.heightSource);
 if(!measured){s.height=DESIGN_DEFAULTS.wallHeightMeters;s.cutawayHeight=s.height;s.heightSource='design_default_not_measured';}
 s.rooms=s.rooms.map(r=>{
  const u=uses(r),finish=u.canonical==='bathroom'||u.canonical==='laundry'?'wet_tile':u.canonical==='bedroom'||u.living?'light_oak':null;
  return finish&&!r.floorFinish?{...r,floorFinish:finish,floorFinishSource:'design_default_not_measured'}:r;
 });
 const has=(room,type)=>s.assets.some(a=>a.roomId===room.id&&a.type===type);
 const add=(room,type)=>{
  if(suppressedDefaultKeys.includes(`${room.id}:${type}`))return null;
  if(has(room,type))return s.assets.find(a=>a.roomId===room.id&&a.type===type);
  if(s.assets.length>=300){warnings.push({roomId:room.id,type,reason:'asset_limit'});return null;}
  let candidate;
  if(type==='sink'||type==='stove'){
   for(const counter of s.assets.filter(a=>a.roomId===room.id&&a.type==='kitchen_counter')){
    const t=(counter.rotation||0)*Math.PI/180;
    for(const offset of (pdfInterior&&!pdfLayoutLegacy?(type==='sink'?[-.45,-.5]:[.45,.5]):[0,-.25,.25])){
     const a={...make(room,type,s.assets.length),xMeters:counter.xMeters+Math.cos(t)*offset,yMeters:counter.yMeters+Math.sin(t)*offset,rotation:counter.rotation||0,width:Math.min(sizes[type][0],counter.width-.08),depth:Math.min(sizes[type][1],counter.depth-.08),embeddedInCounter:true};
     if(a.width>=.4&&a.depth>=.3&&Math.abs(offset)+a.width/2<=counter.width/2-.025&&valid(a,s,counter.id)){candidate=a;break;}
    }
    if(candidate)break;
   }
  }
  if(type==='range_hood'){
   const stove=s.assets.find(a=>a.roomId===room.id&&a.type==='stove');
   if(stove&&Number(s.height)>=2.5)candidate={...make(room,type,s.assets.length),xMeters:stove.xMeters,yMeters:stove.yMeters,rotation:stove.rotation||0,zMeters:1.95,mountedAboveId:stove.id};
  }else candidate ||= place(s,room,type,s.assets.length,pdfInterior&&!pdfLayoutLegacy);
  if(!candidate){warnings.push({roomId:room.id,type,reason:'no_safe_space'});return null;}
  s.assets.push(candidate);added.push(candidate.id);return candidate;
 };
 const addChairs=(table,room)=>{
  if(!table||has(room,'chair')||suppressedDefaultKeys.includes(`${room.id}:chair`))return;
  for(const chair of diningChairs(table,room)){
   if(s.assets.length<300&&valid(chair,s)){s.assets.push(chair);added.push(chair.id);}else warnings.push({roomId:room.id,type:'chair',reason:'no_safe_space'});
  }
 };
 for(const room of s.rooms){
  const u=uses(room);
  const required=u.canonical==='bathroom'?['toilet','shower','sink']:u.canonical==='bedroom'?['bed','dressing_table']:[];
  if(u.kitchen)required.push('kitchen_counter','sink','stove','range_hood','washing_machine','refrigerator','dining_table');
  if(u.living)required.push('sofa','tv_unit','plant');
  if(u.canonical==='dining')required.push('dining_table');
  if(pdfInterior){
   required.length=0;
   if(u.canonical==='bathroom')required.push('toilet','shower','sink');
   if(u.canonical==='bedroom')required.push('bed','wardrobe','nightstand','dressing_table');
   if(u.kitchen)required.push('kitchen_counter','sink','stove','range_hood','refrigerator','dining_table');
   if(u.living)required.push('sofa','tv_unit','coffee_table','armchair','plant');
   if(u.canonical==='dining')required.push('dining_table');
   if(u.canonical==='office')required.push('desk','chair','cabinet');
   if(u.canonical==='laundry')required.push('washing_machine','sink','cabinet');
   if(u.canonical==='storage')required.push('cabinet');
   if(u.canonical==='balcony')required.push('dining_table','plant');
  }
  for(const type of required){const asset=add(room,type);if(pdfInterior&&!pdfLayoutLegacy&&type==='dining_table')addChairs(asset,room);}
  // Add four proposed chairs only for a newly proposed table, not a traced set.
  const table=s.assets.find(a=>a.roomId===room.id&&a.type==='dining_table');
  addChairs(table,room);
 }
 const points=s.footprint||[],validPoints=points.length>=3&&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
 const origin=validPoints?{x:(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,y:(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2,z:0}:{x:s.width/2,y:s.depth/2,z:0};
 s.designDefaults={...DESIGN_DEFAULTS,viewOriginMeters:origin,addedAssetIds:added,warnings,engineeringQuantitiesUnchanged:true};
 return s;
}
