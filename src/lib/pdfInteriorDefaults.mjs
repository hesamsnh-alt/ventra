import {canonicalRoomType} from './roomSemantics.mjs';
export const PDF_INTERIOR_VERSION='pdf-interior-defaults-v167';
const palette={wall:'#f2eee7',externalWall:'#d5cfc4',floor:'#ded6c8',bathroomTile:'#e5e8e5',door:'#8b6848',furniture:'#a27d55',upholstery:'#c8b9a5',glass:'#9fbfcf',metal:'#545d62',accent:'#9c8061'};
const signature=a=>JSON.stringify(['id','roomId','type','xMeters','yMeters','rotation','width','depth','height','zMeters','color','variant','embeddedInCounter','mountedAboveId'].map(k=>a[k]??null));
// Proposed design only. This module never imports catalog, prices or BOQ services.
// Architecture, source dimensions and per-floor identity remain authoritative.
export function applyPdfInteriorDefaults(input,applySingle,{force=false}={}){
 if(!input?.rooms?.length||!Array.isArray(input.assets)||!Array.isArray(input.walls))return input;
 const {pdfStoreys,...current}=input;
 const raw=pdfStoreys?.length?pdfStoreys.map(f=>f.sourcePage===current.sourcePage?current:f):[current];
 if(!force&&raw.every(f=>f.pdfInteriorDefaults?.version===PDF_INTERIOR_VERSION))return input;
 const floors=raw.map(f=>{
  if(!force&&f.pdfInteriorDefaults?.version===PDF_INTERIOR_VERSION)return f;
  const prepared={...f,palette:{...palette,...f.palette},rooms:f.rooms.map(room=>{
   let semanticType=canonicalRoomType(room);
   if(semanticType==='room'&&/\ben[ -]?suite\b/i.test(room.name||''))semanticType='bathroom';
   if(semanticType==='room'&&/\bfoyer\b|\bstairs?\b|\blanding\b/i.test(room.name||''))semanticType='circulation';
   return {...room,...(!room.semanticType&&room.roomUseSource!=='user_confirmed'?{semanticType,roomUseSource:'source_label'}:{} )};
  })};
  // Preserve source heights even on a scene missing the generic height-source marker.
  prepared.heightSource=f.heightSource||'source_dimension';
  const suppressedDefaultKeys=[];
  if(f.pdfInteriorDefaults?.version==='pdf-interior-defaults-v166'){
   // Replay the released v166 policy. Relayout only untouched generated items;
   // manual edits/source assets remain obstacles and deleted types stay deleted.
   const legacy=applySingle({...prepared,assets:prepared.assets.filter(a=>a.placementSource!=='design_default_not_measured')},{force:true,pdfInterior:true,pdfLayoutLegacy:true});
   const expected=new Map(legacy.assets.filter(a=>a.placementSource==='design_default_not_measured').map(a=>[a.id,a]));
   const currentIds=new Set(prepared.assets.map(a=>a.id));
   for(const a of expected.values())if(!currentIds.has(a.id)&&!prepared.assets.some(b=>b.roomId===a.roomId&&b.type===a.type))suppressedDefaultKeys.push(`${a.roomId}:${a.type}`);
   prepared.assets=prepared.assets.filter(a=>!expected.has(a.id)||signature(a)!==signature(expected.get(a.id)));
  }
  const designed=applySingle(prepared,{force:true,pdfInterior:true,suppressedDefaultKeys});
  const assignments={...designed.surfaceFinishes?.assignments};
  for(const room of designed.rooms){
   const key=JSON.stringify(['floor',String(room.id)]);
   if(Object.hasOwn(assignments,key))continue;
   const type=canonicalRoomType(room);
   if(type==='balcony')assignments[key]='stone-beige';
   else if(/\bgarage\b|پارکینگ|کراج/i.test(room.name||''))assignments[key]='cement-grey';
  }
  // Whole-wall paint is a starting finish. Existing per-face edits retain priority.
  for(const wall of designed.walls){
   const key=JSON.stringify(['wall',String(wall.id)]);
   if(wall.type!=='glass'&&!Object.hasOwn(assignments,key))assignments[key]='paint-white';
  }
  designed.surfaceFinishes={...designed.surfaceFinishes,assignments};
  designed.pdfInteriorDefaults={version:PDF_INTERIOR_VERSION,provenance:'proposed',excludeFromTakeoff:true,requiresReview:true,
   generatedAssetSignatures:designed.assets.filter(a=>a.placementSource==='design_default_not_measured').map(a=>({id:a.id,signature:signature(a)})),
   note:'Editable visual defaults. Furniture, finishes and room-use suggestions are not measured quantities or source specifications.'};
  return designed;
 });
 const active=floors.find(f=>f.sourcePage===current.sourcePage)||floors[0];
 return pdfStoreys?.length?{...active,pdfStoreys:floors}:active;
}
