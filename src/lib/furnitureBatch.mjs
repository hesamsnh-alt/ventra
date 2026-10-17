import {roomAtPoint,LOCKED_ARCHITECTURE} from './furnitureEditor.mjs';
import {placementProblem,PROMPT_ASSET_DEFAULTS} from './scenePromptActions.mjs';
const fail=m=>{throw new Error(m);};
export function toggleFurnitureSelection(ids,id,extend=false){if(!id)return extend?ids:[];return extend?(ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]):[id];}
export function keyboardFurnitureAction(event,inScope,hasSelection,hasClipboard){
 const target=event.target;if(!inScope||event.repeat||target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return null;
 if(event.key==='Escape')return 'cancel';
 if(event.key==='Delete'&&hasSelection)return 'remove';
 if((event.ctrlKey||event.metaKey)&&!event.altKey){const key=event.code==='KeyC'?'c':event.code==='KeyV'?'v':String(event.key).toLowerCase();if(key==='c'&&hasSelection)return 'copy';if(key==='v'&&hasClipboard)return 'paste';}
 return null;
}
export function copyFurnitureSnapshot(scene,ids){
 const unique=[...new Set(ids)];if(!unique.length)fail('Select furniture first. / ابتدا مبلمان را انتخاب کن.');
 return unique.map(id=>{const a=scene.assets.find(a=>a.id===id);if(!a||!PROMPT_ASSET_DEFAULTS[a.type])fail('Only furniture can be copied.');return structuredClone(a);});
}
export function applyFurnitureBatch(scene,edit){
 const next=structuredClone(scene),ids=new Set(edit.assetIds||[]);let added=[];
 if(edit.kind==='remove-many'){
  if(!ids.size||[...ids].some(id=>!scene.assets.some(a=>a.id===id&&PROMPT_ASSET_DEFAULTS[a.type])))fail('Select existing furniture first.');
  next.assets=next.assets.filter(a=>!ids.has(a.id));
 }else if(edit.kind==='copy-many'){
  const source=edit.snapshot;if(!Array.isArray(source)||!source.length||source.length>300||!Number.isFinite(edit.point?.x)||!Number.isFinite(edit.point?.y))fail('Invalid furniture copy.');
  const center=source.reduce((p,a)=>({x:p.x+a.xMeters/source.length,y:p.y+a.yMeters/source.length}),{x:0,y:0});
  added=source.map((a,i)=>{
   if(!PROMPT_ASSET_DEFAULTS[a.type])fail('Only furniture can be copied.');
   const p={x:edit.point.x+a.xMeters-center.x,y:edit.point.y+a.yMeters-center.y};
   const room=scene.source==='dwg-engineering-interior'?scene.rooms.find(r=>r.scopeOnly)||roomAtPoint(scene,p):roomAtPoint(scene,p);if(!room)fail('Copy must fit inside a room. / کپی باید داخل اتاق قرار بگیرد.');
   const b={...structuredClone(a),id:globalThis.crypto?.randomUUID?.()||`furniture-copy-${Date.now()}-${i}`,roomId:room.id,xMeters:p.x,yMeters:p.y,userPlaced:true,provenance:'proposed',excludeFromTakeoff:true,placementSource:'manual_furniture_editor',embeddedInCounter:false};
   for(const key of ['againstWallId','wallSupported','_presentationOmit'])delete b[key];
   if(!['width','depth','height','xMeters','yMeters'].every(k=>Number.isFinite(b[k]))||b.width<=0||b.depth<=0||b.height<=0||(Number(b.zMeters)||0)+b.height>(scene.height||3.2))fail('Invalid furniture copy size.');
   return b;
  });
  if(next.assets.length+added.length>300)fail('Too many furniture objects.');
  next.assets.push(...added);
  for(const a of added){const problem=placementProblem(a,next,{manualDwgPlacement:edit.freePlacement===true,manualFurniturePlacement:true});if(problem)fail('Copy cannot be placed here: '+problem+' / کپی با دیوار، مسیر در یا وسایل تداخل دارد.');}
 }else fail('Unsupported furniture batch operation.');
 for(const key of LOCKED_ARCHITECTURE)if(JSON.stringify(next[key])!==JSON.stringify(scene[key]))fail('Architecture is locked.');
 next.updatedAt=new Date().toISOString();next.furnitureEditor={version:'furniture-editor-v99',lastOperation:edit.kind,copiedIds:added.map(a=>a.id)};return next;
}
export function previewFurnitureBatch(scene,edit){
 try{const next=applyFurnitureBatch(scene,edit),copies=next.assets.filter(a=>next.furnitureEditor.copiedIds.includes(a.id));const xs=[],ys=[];
  for(const a of copies)for(const x of [-a.width/2,a.width/2])for(const y of [-a.depth/2,a.depth/2]){const r=(a.rotation||0)*Math.PI/180;xs.push(a.xMeters+x*Math.cos(r)-y*Math.sin(r));ys.push(a.yMeters+x*Math.sin(r)+y*Math.cos(r));}
  const x1=Math.min(...xs),x2=Math.max(...xs),y1=Math.min(...ys),y2=Math.max(...ys);
  return {valid:true,candidate:{type:'copy_preview',width:x2-x1,depth:y2-y1,xMeters:(x1+x2)/2,yMeters:(y1+y2)/2,rotation:0}};
 }catch(error){return {valid:false,error:error.message,candidate:null};}
}
