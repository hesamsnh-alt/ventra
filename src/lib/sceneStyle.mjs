import {resolveDwgCalibration} from './dwgCalibration.mjs';
import {persistTakeoff} from './takeoffStorage.mjs';
export function applySceneStyle(scene,preset) {
 const next=structuredClone(scene);
 if(preset==='classic')return next;
 const palettes={
  modern:{externalWall:'#344452',wall:'#E0E8EE',floor:'#9BAEBB',furniture:'#294959',upholstery:'#B6CBD3',metal:'#353E48',textileAccent:'#C17A42',bedroomWood:'#7E929F',mainStone:'#B7C8D1'},
  minimal:{externalWall:'#C0B6A7',wall:'#F4ECDD',floor:'#DFCEAD',furniture:'#CBA66B',upholstery:'#EEE4CE',metal:'#928574',textileAccent:'#A9AF8F',bedroomWood:'#D7BD91',mainStone:'#E9DFC9'},
  luxury:{externalWall:'#332E38',wall:'#E9DDD0',floor:'#7E747A',furniture:'#43313C',upholstery:'#72556B',metal:'#BE9854',textileAccent:'#C2A36B',bedroomWood:'#70513E',mainStone:'#AB9C95'},
  facade:{externalWall:'#946A50',wall:'#E9D3B9',floor:'#ACA39A',furniture:'#695648',upholstery:'#CBC3B6',metal:'#242B31',textileAccent:'#A89272',bedroomWood:'#8D735C',mainStone:'#C7BAA9'}
 };
 next.palette={...next.palette,...(palettes[preset]||palettes.modern),designPreset:preset};
 next.variant=preset;
 next.assets=(next.assets||[]).map(a=>({...a,variant:preset,color:next.palette.furniture}));
 return next;
}
export function engineeringUrn(takeoff){if(/image|raster/i.test(takeoff?.source||'')||/^(jpg|jpeg|png|webp)$/i.test(takeoff?.document_type||''))return '';return takeoff?.aps_urn||takeoff?.apsUrn||takeoff?.urn||takeoff?.advanced_takeoff?.aps_urn||takeoff?.raw_result?.aps_urn||'';}
export function rememberEngineeringTakeoff(storage,projectId,takeoff){
 if(!takeoff||!engineeringUrn(takeoff))return;
 return persistTakeoff(projectId,takeoff,{kind:'engineering',storage});
}
export function chooseEngineeringTakeoff(current,saved,expectedUrn=''){
 const currentUrn=engineeringUrn(current),savedUrn=engineeringUrn(saved);
 if(expectedUrn){
  if(currentUrn!==expectedUrn)current=null;
  if(savedUrn!==expectedUrn)saved=null;
 }
 if(!engineeringUrn(current))return engineeringUrn(saved)?saved:current;
 if(!engineeringUrn(saved)||engineeringUrn(current)!==engineeringUrn(saved))return current;
 // A translation placeholder or localStorage summary must not mask full CAD evidence.
 const quality=t=>{
  const {geometry:g,meterFactor}=resolveDwgCalibration(t);
  const walls=Array.isArray(g.wallLineSegments)?g.wallLineSegments:[];
  const ids=new Set((t.object_details?.walls||t.advanced_takeoff?.object_details?.walls||[]).map(w=>String(w.dbId)));
  const usable=walls.length||(Array.isArray(g.lineSegments)?g.lineSegments:[]).filter(l=>ids.has(String(l.dbId))).length;
  return (usable?2:0)+(usable&&Number.isFinite(meterFactor)&&meterFactor>0?4:0)+(t.__geometryStoredInIndexedDB?0:1);
 };
 const cq=quality(current),sq=quality(saved);
 if(sq!==cq)return sq>cq?saved:current;
 const stamp=t=>Math.max(0,...[t.analyzed_at,t.updated_at,t.created_at].map(v=>{const n=Date.parse(v);return Number.isFinite(n)?n:0;}));
 return stamp(saved)>stamp(current)?saved:current;
}
