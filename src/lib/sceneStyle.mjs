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
export function chooseEngineeringTakeoff(current,saved){return engineeringUrn(current)?current:engineeringUrn(saved)?saved:current;}
