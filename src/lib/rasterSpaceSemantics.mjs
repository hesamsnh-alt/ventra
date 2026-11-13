// User's drawing convention. Pattern alone is never an architectural label.
export const RASTER_SPACE_POLICY_VERSION='hatch-context-v1';

// Explicit project convention: B.R / BR means bathroom for this user's plans.
// Printed use wins over fixture guesses; generic ROOM is deliberately unknown.
export function inferRasterRoomUse({sourceText='',fixtures=[]}={}){
  const normalized=String(sourceText).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/\u200c/g,' ').trim().toLowerCase();
  const rules=[
    ['bathroom',/(?:^|\b)(?:b\s*\.?\s*r\s*\.?|bath\s*room|bathroom|bath|toilet|w\.?c\.?)(?:\b|$)|حمام|دستشویی|سرویس(?:\s+بهداشتی)?|دورة\s*المیاه/iu],
    ['bedroom',/bed\s*room|bedroom|master(?:\s+room|\s+bedroom)?|اتاق\s*خواب|مستر|غرفة\s*نوم/iu],
    ['kitchen',/kitchen|آشپزخانه|آشپز\s*خانه|مطبخ/iu],
    ['living',/living(?:\s*room)?|lounge|پذیرایی|نشیمن|هال|غرفة\s*معیشة/iu],
    ['laundry',/laundry|landry|رختشویخانه|رختشوی\s*خانه|غرفة\s*غسیل/iu],
    ['wardrobe',/wardrobe|closet|dressing|کمد|رختکن|خزانة/iu],
    ['balcony',/balcony|terrace|بالکن|تراس|شرفة/iu],
    ['stair',/stair|پله|درج/iu],
    ['corridor',/corridor|hallway|راهرو|ممر/iu],
  ];
  const matches=rules.filter(([,pattern])=>pattern.test(normalized)).map(([type])=>type);
  if(matches.length===1)return{type:matches[0],basis:'source_text',text:sourceText,needsReview:false};
  if(matches.length>1)return{type:'other',basis:'conflicting_source_text',text:sourceText,needsReview:true};
  if(/^(?:room|اتاق|غرفة)$/iu.test(normalized))return{type:fixtures.includes('bed')?'bedroom':'room',basis:fixtures.includes('bed')?'source_text_and_fixtures':'source_text',text:sourceText,needsReview:fixtures.includes('bed')};
  const found=new Set(fixtures),types=[];
  if(found.has('toilet')||found.has('shower')||found.has('bathtub'))types.push('bathroom');
  if(found.has('bed'))types.push('bedroom');
  if(found.has('kitchen_cabinets')||found.has('hob')||found.has('oven'))types.push('kitchen');
  if(found.has('sofa')&&!found.has('bed'))types.push('living');
  if(found.has('washing_machine')&&!types.includes('bathroom')&&!types.includes('kitchen'))types.push('laundry');
  if(types.length===1)return{type:types[0],basis:'source_fixtures',text:sourceText,needsReview:true};
  return{type:'other',basis:types.length?'conflicting_fixtures':'insufficient_evidence',text:sourceText,needsReview:true};
}
export function interpretRasterSpace(space){
  const marked=['hatch','cross','solid_fill'].includes(space?.pattern);
  const explicit=String(space?.explicitUse||'unknown');
  const enclosed=space?.enclosed===true;
  if(['shaft','void','courtyard','lift_void'].includes(explicit))return{role:'void',removeFloor:true,reason:'explicit_void_use'};
  if(explicit==='wardrobe')return{role:'wardrobe',removeFloor:false,reason:'explicit_wardrobe_use'};
  if(explicit==='room')return{role:'room',removeFloor:false,reason:'recognised_use'};
  if(marked&&space?.context==='bedroom'&&space?.details==='none')return{role:'wardrobe',removeFloor:false,reason:'bedroom_storage_pattern'};
  if(enclosed&&marked&&space?.details==='none'&&['entrance','stair_core','circulation','unassigned'].includes(space?.context))return{role:'void',removeFloor:true,reason:'enclosed_marked_core_without_details'};
  if(['room','stair','shower','furniture'].includes(explicit))return{role:explicit,removeFloor:false,reason:'recognised_use'};
  return{role:'unresolved',removeFloor:false,reason:'pattern_requires_context'};
}

export function applyRasterSpacePolicy(spaces){
  if(!Array.isArray(spaces))throw Error('Space interpretations must be an array.');
  return spaces.map(space=>({...space,interpretation:interpretRasterSpace(space)}));
}
