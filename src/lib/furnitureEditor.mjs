import {applyPromptActions,placementProblem} from './scenePromptActions.mjs';
export const FURNITURE_CATALOG=Object.freeze([
 ['sofa-modern','sofa','Sofa · Modern','مبل مدرن','أريكة حديثة',2.2,.9,.85,'modern','#b4a28f'],
 ['sofa-minimal','sofa','Sofa · Minimal','مبل مینیمال','أريكة بسيطة',1.8,.8,.85,'minimal','#d4c8b7'],
 ['sofa-luxury','sofa','Sofa · Luxury','مبل لوکس','أريكة فاخرة',2.6,.95,.85,'luxury','#8f7358'],
 ['dining-oak','dining_table','Dining · Oak','غذاخوری چوبی','طاولة خشبية',1.6,.85,.76,'modern','#b99266'],
 ['dining-round','dining_table','Dining · Round','غذاخوری گرد','طاولة مستديرة',1.2,1.2,.76,'round','#c8b49b'],
 ['dining-set','dining_table','Dining + 4 chairs','غذاخوری و ۴ صندلی','طاولة و٤ كراسي',1.4,.8,.76,'modern','#b99266',4],
 ['bed-modern','bed','Bed · Modern','تخت مدرن','سرير حديث',1.6,2,.85,'modern','#b5a596'],
 ['bed-luxury','bed','Bed · Luxury','تخت لوکس','سرير فاخر',1.8,2.1,1.05,'luxury','#b79777'],
 ['bed-single','bed','Single bed','تخت یک‌نفره','سرير مفرد',.95,2,.85,'minimal','#b5a596'],
 ['cabinet-storage','cabinet','Storage cabinet','کمد کوتاه','خزانة تخزين',1.2,.55,.9,'modern','#bca487'],
 ['cabinet-door','cabinet_door','Cabinet door','در کابینت','باب خزانة',.45,.05,.75,'modern','#bca487'],
 ['wardrobe','wardrobe','Wardrobe','کمد لباس','خزانة ملابس',1.6,.6,2.2,'modern','#bca487'],
 ['counter-L','kitchen_counter','L-shaped kitchen cabinet','کابینت آشپزخانه L','خزانة مطبخ L',2.2,1.8,.92,'l-shape','#bca487'],
 ['nightstand','nightstand','Bedside table','پاتختی','طاولة بجانب السرير',.5,.45,.5,'modern','#bca487'],
 ['desk','desk','Desk','میز کار','مكتب',1.3,.65,.76,'modern','#bca487'],
 ['lamp','floor_lamp','Floor lamp','چراغ ایستاده','مصباح أرضي',.4,.4,1.6,'modern','#bca487'],
 ['chair','chair','Chair','صندلی','كرسي',.45,.5,.9,'modern','#bca487'],
 ['plant','plant','Indoor plant','گیاه آپارتمانی','نبات داخلي',.4,.4,1.05,'modern','#70845c'],
 ['tv','tv_unit','TV console','تلویزیون و میز','تلفاز وطاولة',1.6,.35,.65,'modern','#947050'],
 ['washer','washing_machine','Washing machine','لباس‌شویی','غسالة',.6,.65,.88,'modern','#e9e9e5'],
 ['fridge','refrigerator','Refrigerator','یخچال','ثلاجة',.75,.7,1.85,'modern','#d8d8d4'],
 ['toilet','toilet','Toilet','توالت','مرحاض',.55,.75,.78,'modern','#f1f0e9'],
 ['basin','sink','Vanity basin','روشویی کابینت‌دار','حوض وخزانة',.65,.45,.85,'modern','#bca487'],
 ['shower','shower','Shower','دوش','دش',.85,.85,2.1,'modern','#c8d4d6'],
 ['dresser','dressing_table','Dressing table','میز آرایش','طاولة زينة',.9,.42,1.6,'modern','#bca487'],
 ['counter','kitchen_counter','Kitchen counter','کابینت آشپزخانه','خزانة مطبخ',1.8,.6,.92,'modern','#bca487'],
 ['cooker','stove','Cooker','اجاق','موقد',.6,.6,.9,'modern','#d0d0cb'],
 ['hood','range_hood','Extractor hood','هود','شفاط',.6,.48,.45,'modern','#c1c1bc'],
].map(([id,type,en,fa,ar,width,depth,height,variant,color,chairs])=>Object.freeze({id,type,en,fa,ar,width,depth,height,variant,color,chairs})));
export const LOCKED_ARCHITECTURE=['rooms','walls','openings','footprint','holes','width','depth','height','palette','wallThickness','externalWallThickness'];
const fail=m=>{throw new Error(m);};
export function furnitureRotationFromDrag(initialRotation,startX,event){
 if(!Number.isFinite(initialRotation)||!Number.isFinite(startX)||!Number.isFinite(event?.clientX))fail('Invalid rotation gesture.');
 let angle=initialRotation+(event.clientX-startX)*.5;
 if(event.shiftKey)angle=Math.round(angle/15)*15;
 return ((angle%360)+360)%360;
}
export function furnitureSizeFromDrag(dimensions,startX,event){
 const {width,depth,height}=dimensions;
 if(![width,depth,height,startX,event?.clientX].every(Number.isFinite)||Math.min(width,depth,height)<=0)fail('Invalid size gesture.');
 const min=Math.max(.1/width,.04/depth,.01/height),max=Math.min(6/width,4/depth,3/height);
 const factor=Math.max(min,Math.min(max,Math.exp(Math.max(-10,Math.min(10,(event.clientX-startX)/240)))));
 return {width:width*factor,depth:depth*factor,height:height*factor};
}
const inside=(p,poly=[])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
export function roomAtPoint(scene,point){
 if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
 const hits=scene.rooms.filter(r=>inside(point,r.polygon));
 // DWG floor scopes cover areas without room metadata. Prefer a real room
 // when present, without making its overlap with the fallback ambiguous.
 const classified=hits.filter(r=>!r.scopeOnly);
 const rooms=classified.length?classified:hits;
 return rooms.length===1?rooms[0]:scene.source==='dwg-engineering-interior'?hits.find(r=>r.scopeOnly)||null:null;
}
export function furnitureDraft(scene,edit){
 const catalog=FURNITURE_CATALOG.find(a=>a.id===edit.catalogId),original=scene.assets.find(a=>a.id===edit.assetId);
 if(edit.kind==='add'&&!catalog)fail('Unknown furniture model.');
 if(edit.kind!=='add'&&!original)fail('Select a furniture object.');
 if(edit.kind==='replace'&&!catalog)fail('Unknown furniture model.');
 const p=edit.point||{x:original?.xMeters,y:original?.yMeters};
 // DWG room faces may be incomplete/overlapping. Manual design uses the floor
 // envelope; actual walls, openings, voids and other furniture still constrain it.
 const room=scene.source==='dwg-engineering-interior'
  ?scene.rooms.find(r=>r.scopeOnly&&inside(p,r.polygon))||roomAtPoint(scene,p)
  :roomAtPoint(scene,p);if(!room)fail('Choose a point inside one unambiguous room. / نقطه‌ای داخل یک اتاق مشخص انتخاب کن.');
 const model=edit.kind==='add'||edit.kind==='replace'?catalog:null;
 const draft={...original,...(model?{type:model.type,width:model.width,depth:model.depth,height:model.height,variant:model.variant,color:model.color,catalogId:model.id}:{}),id:original?.id||'furniture-preview',roomId:room.id,xMeters:p.x,yMeters:p.y,rotation:edit.rotation??original?.rotation??0};
 if(draft.type==='range_hood')draft.zMeters=1.95;
 else if(model)delete draft.zMeters;
 if(edit.color)draft.color=edit.color;
 if(edit.kind==='resize')for(const key of ['width','depth','height']){
  if(!Number.isFinite(edit.size?.[key])||edit.size[key]<=0)fail('Invalid furniture size.');
  draft[key]=edit.size[key];
 }
 if(edit.kind==='resize'){
  const ratios=['width','depth','height'].map(key=>draft[key]/original[key]);
  if(!ratios.every(n=>Number.isFinite(n)&&Math.abs(n-ratios[0])<.000001))fail('Resize must preserve furniture proportions.');
  if(Number.isFinite(scene.height)&&(Number(draft.zMeters)||0)+draft.height>scene.height)fail('Furniture would exceed the room height. / ارتفاع وسیله از سقف بیشتر می‌شود.');
 }
 return draft;
}
export function previewFurnitureEdit(scene,edit){
 let candidate;
 try{
  candidate={...furnitureDraft(scene,edit),previewOperation:edit.kind};const problem=placementProblem(candidate,scene,{manualDwgPlacement:edit.freePlacement===true});
  // Sets need room for the chairs too; the full transaction is checked at commit.
  if(problem)return {candidate,valid:false,error:problem};
  applyFurnitureEdit(scene,edit);
  return {candidate,valid:true};
 }catch(error){return {candidate,valid:false,error:error.message};}
}
export function applyFurnitureEdit(scene,edit){
 if(!['add','move','rotate','resize','color','replace','remove'].includes(edit.kind))fail('Unsupported furniture operation.');
 const original=scene.assets.find(a=>a.id===edit.assetId);
 let plan,model,candidate;
 if(edit.kind==='remove')plan={action:'remove',assetId:edit.assetId};
 else if(edit.kind==='color')plan={action:'update',assetId:edit.assetId,color:edit.color};
 else{
  candidate=furnitureDraft(scene,edit);model=FURNITURE_CATALOG.find(a=>a.id===edit.catalogId);
  if(edit.kind==='replace'&&model.type!==original.type)fail('Choose a model of the same furniture type. / مدل هم‌نوع انتخاب کن.');
  plan={action:edit.kind==='add'?'add':'update',assetId:edit.kind==='add'?null:edit.assetId,type:candidate.type,roomId:candidate.roomId,xMeters:candidate.xMeters,yMeters:candidate.yMeters,width:candidate.width,depth:candidate.depth,height:candidate.height,rotation:candidate.rotation,color:candidate.color};
 }
 const actions=[plan];
 if(edit.kind==='add'&&model.chairs){
  const a=candidate,t=a.rotation*Math.PI/180;
  for(const [x,y,rotation] of [[-a.width/2-.3,0,-90],[a.width/2+.3,0,90],[0,-a.depth/2-.32,0],[0,a.depth/2+.32,180]])actions.push({action:'add',type:'chair',roomId:a.roomId,xMeters:a.xMeters+x*Math.cos(t)-y*Math.sin(t),yMeters:a.yMeters+x*Math.sin(t)+y*Math.cos(t),width:.45,depth:.5,height:.9,rotation:rotation+a.rotation,color:model.color});
 }
 const next=applyPromptActions(scene,{status:'apply',actions},{manualDwgPlacement:edit.freePlacement===true}).scene;
 if(model){
  const id=edit.kind==='add'?next.assets[scene.assets.length].id:original.id;
  next.assets=next.assets.map(a=>{if(a.id!==id)return a;const {renderingBaseDimensions,...reset}=a;return {...reset,variant:model.variant,catalogId:model.id,...(model.type==='range_hood'?{zMeters:1.95}:{zMeters:0})};});
 }
 if(edit.kind==='resize')next.assets=next.assets.map(a=>a.id===original.id?{...a,renderingBaseDimensions:original.renderingBaseDimensions||{width:original.width,depth:original.depth,height:original.height}}:a);
 const editedIds=new Set(edit.kind==='add'?next.assets.slice(scene.assets.length).map(a=>a.id):[edit.assetId]);
 next.assets=next.assets.map(a=>editedIds.has(a.id)?{...a,...(edit.freePlacement===true&&scene.source==='dwg-engineering-interior'?{placementReview:'unverified_dwg_wall_clearance'}:{}),placementSource:'manual_furniture_editor',provenance:'proposed',excludeFromTakeoff:true,...(['move','replace'].includes(edit.kind)?{embeddedInCounter:false}:{})}:a);
 for(const key of LOCKED_ARCHITECTURE)if(JSON.stringify(next[key])!==JSON.stringify(scene[key]))fail(`Architecture is locked: ${key}`);
 next.furnitureEditor={version:'furniture-editor-v67',lastOperation:edit.kind};
 return next;
}
