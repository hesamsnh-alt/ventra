import {auditDwgOpenings} from './dwgOpeningAudit.mjs';
export const OPENING_CATALOG=Object.freeze([
 {id:'manual-door',type:'door',variant:'single',width:.9,height:2.1,sillHeight:0,en:'Room door',fa:'در اتاق',ar:'باب غرفة'},
 {id:'manual-double-door',type:'door',variant:'double',width:1.6,height:2.1,sillHeight:0,en:'Double door',fa:'در دولنگه',ar:'باب مزدوج'},
 {id:'manual-passage',type:'door',variant:'passage',width:1.2,height:2.2,sillHeight:0,en:'Open passage',fa:'بازشوی بدون در',ar:'فتحة مرور'},
 {id:'manual-window',type:'window',variant:'fixed',width:1.2,height:1.2,sillHeight:.9,en:'Window',fa:'پنجره',ar:'نافذة'},
]);
const fail=m=>{throw new Error(m);};
const projection=(p,w)=>{const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy);if(!len)return null;const t=((p.x-w.start.x)*dx+(p.y-w.start.y)*dy)/(len*len),x=w.start.x+t*dx,y=w.start.y+t*dy;return {len,t,x,y,distance:Math.hypot(p.x-x,p.y-y),dx:dx/len,dy:dy/len};};
export function openingDraft(scene,edit){
 const model=OPENING_CATALOG.find(m=>m.id===edit.catalogId);if(!model)fail('Choose a door or window. / در یا پنجره را انتخاب کن.');
 const width=Number(edit.width??model.width),height=Number(edit.height??model.height),sillHeight=model.type==='door'?0:Number(edit.sillHeight??model.sillHeight);
 if(![width,height,sillHeight].every(Number.isFinite)||width<.3||width>4||height<.3||sillHeight<0||height+sillHeight>scene.height-.05)fail('Opening dimensions must fit below the wall top. / ابعاد بازشو باید در ارتفاع دیوار جا بگیرد.');
 let candidates=(scene.walls||[]).filter(w=>w.type!=='railing'&&(!edit.wallId||w.id===edit.wallId));
 if(!candidates.length)fail('No target wall. / دیوار هدف وجود ندارد.');
 let wall,position;
 if(edit.point){
  if(![edit.point.x,edit.point.y].every(Number.isFinite))fail('Invalid floor point.');
  const options=candidates.map(w=>({w,p:projection(edit.point,w)})).filter(o=>o.p&&o.p.t>=0&&o.p.t<=1).sort((a,b)=>a.p.distance-b.p.distance);
  if(!options.length||options[0].p.distance>.45)fail('Click close to the target wall, or choose its wall number. / نزدیک دیوار هدف کلیک کن یا شماره دیوار را انتخاب کن.');
  ({w:wall,p:position}=options[0]);
 }else{
  if(!edit.wallId)fail('Choose a wall or click near it. / دیوار را انتخاب کن یا نزدیک آن کلیک کن.');
  wall=candidates[0];const offset=Number(edit.offset??.5);
  position=projection({x:wall.start.x+(wall.end.x-wall.start.x)*offset,y:wall.start.y+(wall.end.y-wall.start.y)*offset},wall);
 }
 if(position.t*position.len-width/2<.02||(1-position.t)*position.len-width/2<.02)fail('Opening is too wide or too close to the end of this wall. / بازشو بیش از حد پهن یا نزدیک انتهای دیوار است.');
 let id=edit.id||`manual-opening-${Date.now()}-${scene.openings?.length||0}`;
 if(scene.openings.some(o=>o.id===id)){if(edit.id)fail('Opening identifier already exists.');let i=1,base=id;while(scene.openings.some(o=>o.id===id))id=`${base}-${i++}`;}
 return {...model,id,wallId:wall.id,offset:position.t,width,height,sillHeight,openAngleDegrees:45,placementSource:'manual_opening_editor',provenance:'proposed',excludeFromTakeoff:true,openingGroupId:id,
  xMeters:position.x,yMeters:position.y,depth:Number(wall.thickness)||.15,rotation:Math.atan2(position.dy,position.dx)*180/Math.PI};
}
function companionCuts(scene,primary){
 const host=scene.walls.find(w=>w.id===primary.wallId),center={x:primary.xMeters,y:primary.yMeters},p=projection(center,host),cuts=[];
 // CAD outlines often have two nearby parallel faces. Cut the companion face,
 // without placing a second door/window or cutting perpendicular partitions.
 for(const w of scene.walls){
  if(w.id===host.id)continue;const q=projection(center,w);if(!q||q.distance>.22||Math.abs(q.dx*p.dx+q.dy*p.dy)<.995)continue;
  const lo=Math.max(0,q.t*q.len-primary.width/2),hi=Math.min(q.len,q.t*q.len+primary.width/2);
  if(hi-lo<.05)continue;
  cuts.push({...primary,id:`${primary.id}-cut-${w.id}`,wallId:w.id,offset:(lo+hi)/2/q.len,width:hi-lo,cutOnly:true});
 }
 return cuts;
}
export function applyOpeningEdit(scene,edit){
 if(!scene||!Array.isArray(scene.walls)||!Array.isArray(scene.openings))fail('Opening editor needs a structured floor model.');
 let openings=scene.openings;
 if(edit.kind==='remove'){
  const target=openings.find(o=>o.id===edit.openingId&&!o.cutOnly);if(!target)fail('Choose an opening to remove.');
  openings=openings.filter(o=>o.id!==target.id&&(!target.openingGroupId||o.openingGroupId!==target.openingGroupId));
 }else if(edit.kind==='restore'){openings=structuredClone(edit.openings);}
 else if(edit.kind==='add'){
  const draft=openingDraft(scene,edit),addition=[draft,...companionCuts(scene,draft)];
  const audited=auditDwgOpenings([...openings,...addition],scene.walls);
  const addedIds=new Set(addition.map(o=>o.id));
  const conflicts=audited.rejected.filter(r=>addedIds.has(r.id));
  if(conflicts.length){
   if(!edit.replaceOverlapping||conflicts.some(r=>r.reason!=='overlapping_opening_binding'))fail('This opening overlaps an existing opening. Enable replacement to correct it. / بازشو با بازشوی موجود تداخل دارد؛ برای تصحیح، جایگزینی را فعال کن.');
   const oldIds=new Set(openings.filter(old=>auditDwgOpenings([old,...addition],scene.walls).rejected.some(r=>addedIds.has(r.id)&&r.reason==='overlapping_opening_binding')).map(o=>o.id));
   const groups=new Set(openings.filter(o=>oldIds.has(o.id)).map(o=>o.openingGroupId).filter(Boolean));
   openings=openings.filter(o=>!oldIds.has(o.id)&&!groups.has(o.openingGroupId));
  }
  openings=[...openings,...addition];
 }else fail('Unsupported opening operation.');
 const audit=auditDwgOpenings(openings,scene.walls);
 // Existing extraction conflicts can be reviewed separately. New manual spans
 // must be valid; never silently remove an opening just inserted by the user.
 if(audit.rejected.some(r=>openings.find(o=>o.id===r.id)?.placementSource==='manual_opening_editor'))fail('Opening edit has a conflicting or invalid wall span.');
 if(openings.length>500)fail('Too many openings.');
 return {...scene,openings,updatedAt:new Date().toISOString(),manualOpeningEditor:{version:80,lastOperation:edit.kind,excludeFromTakeoff:true}};
}
export function previewOpeningEdit(scene,edit){
 let candidate;
 try{candidate=openingDraft(scene,edit);applyOpeningEdit(scene,{...edit,kind:'add',id:candidate.id});return {candidate,valid:true};}
 catch(error){return {candidate,valid:false,error:error.message};}
}
export function assertOpeningOnlyEdit(before,after){
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(['openings','updatedAt','manualOpeningEditor'].includes(key))continue;
  if(JSON.stringify(before[key])!==JSON.stringify(after[key]))fail(`Opening editor cannot change ${key}.`);
 }
}
