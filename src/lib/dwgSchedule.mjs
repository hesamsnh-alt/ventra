const qtyHeader = value => /qty|quantity|count|number|no\.?\s*(of|required)|تعداد/i.test(value || '') || /^(no\.?|nos\.?)$/i.test(String(value || '').trim());
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
const family = value => {
 const s=norm(value);
 if(/(?:wood|timber|stud).*fram|fram.*(?:wood|timber)|wood stud/.test(s))return 'timber_frame';
 if(/steel.*fram|metal stud|light.gauge/.test(s))return 'steel_frame';
 if(/hardwood|oak flooring|wood floor/.test(s))return 'hardwood';
 if(/tile|ceramic|porcelain/.test(s))return 'tile';
 if(/alumin/.test(s))return 'aluminium';
 if(/upvc|u-pvc|vinyl|pvc/.test(s))return 'pvc';
 if(/wood|timber|oak/.test(s))return 'timber';
 if(/steel/.test(s))return 'steel';
 if(/block|brick|masonry/.test(s))return 'masonry';
 if(/standing.seam|metal roof|metal roofing/.test(s))return 'metal_roof';
 if(/\bfram(?:ing|ed)\b/.test(s))return 'frame_unspecified';
 if(/gypsum|drywall/.test(s))return 'gypsum';
 return '';
};
export function reconcileDwgReads(a={},b={}) {
 const tables=[],issues=[];
 for(const table of a.tables||[]) {
  const matches=(b.tables||[]).filter(t=>t.kind===table.kind&&norm(t.scope)===norm(table.scope));
  const keys=(table.rows||[]).map(r=>norm(r.mark));
  const other=matches.length===1?matches[0]:null;
  const rows=(table.rows||[]).map(row=>{
   const counterparts=(other?.rows||[]).filter(r=>norm(r.mark)===norm(row.mark));
   const r=counterparts.length===1?counterparts[0]:null;
   const agrees=!!r&&Number.isInteger(row.quantity)&&row.quantity>=0&&row.quantity===r.quantity&&
    /^\d+$/.test(String(row.quantityText).trim())&&Number(row.quantityText)===row.quantity&&
    /^\d+$/.test(String(r.quantityText).trim())&&Number(r.quantityText)===r.quantity&&
    row.confidence>=0.9&&r.confidence>=0.9;
   const specAgrees=!!r&&norm(row.material)===norm(r.material)&&norm(row.dimensions)===norm(r.dimensions)&&norm(row.description)===norm(r.description);
   return {...row,quantityAccepted:agrees,specificationAccepted:specAgrees,source:'drawing_schedule_two_reads'};
  });
  const complete=!!other&&table.complete===true&&other.complete===true&&table.coversProject===true&&other.coversProject===true&&
   qtyHeader(table.quantityHeader)&&
   qtyHeader(other.quantityHeader)&&
   rows.length>0&&rows.length===other.rows?.length&&new Set(keys).size===keys.length&&rows.every(r=>r.quantityAccepted);
  tables.push({...table,rows,accepted:complete,total:complete?rows.reduce((n,r)=>n+r.quantity,0):null});
  if(!complete)issues.push(`${table.kind} schedule (${table.scope}): incomplete, ambiguous or inconsistent quantities; no count override applied.`);
 }
 // More than one purported whole-project schedule is a revision/duplication conflict.
 for(const kind of ['door','window'])if(tables.filter(t=>t.kind===kind&&t.accepted).length>1){
  tables.filter(t=>t.kind===kind).forEach(t=>{t.accepted=false;t.total=null;});issues.push(`Multiple whole-project ${kind} schedules need scope/revision review.`);
 }
 const specifications=(a.specifications||[]).map(s=>{
  const matches=(b.specifications||[]).filter(t=>t.scope===s.scope&&norm(t.material)===norm(s.material)&&norm(t.location)===norm(s.location));
  return {...s,accepted:matches.length===1&&s.confidence>=0.9&&matches[0].confidence>=0.9&&!!String(s.quote||'').trim()&&!!String(matches[0].quote||'').trim(),source:'drawing_notes_two_reads'};
 });
 return {version:2,tables,specifications,issues,scopeComplete:false,analyzedAt:new Date().toISOString()};
}
export function applyDwgScheduleToBoq(input=[],evidence={},catalog=[]) {
 let items=input.map(i=>({...i}));const warnings=[...(evidence.issues||[])];
 const countUnit=u=>/^(nos?\.?|ea|each|pcs?|item|number)$/.test(norm(u));
 function candidate(kind,material,unit) {
  const f=family(material);if(!f)return null;
  return catalog.find(c=>new RegExp(kind).test(norm(c.description))&&family(c.description)===f&&
   (unit==='nos'?countUnit(c.unit):norm(c.unit).replace('²','2')===unit)&&Number(c.resolvedRate)>0&&
   !/repair|painting|ironmongery|sealant|cleaning/.test(norm(c.description)))||null;
 }
 for(const kind of ['door','window']) {
  const schedules=(evidence.tables||[]).filter(t=>t.kind===kind&&t.accepted&&t.complete&&t.coversProject&&qtyHeader(t.quantityHeader)&&Array.isArray(t.rows)&&t.rows.length>0&&t.rows.every(r=>r.quantityAccepted&&Number.isInteger(r.quantity)&&r.quantity>=0));
  if(schedules.length!==1)continue;
  const t=schedules[0];
  const openingItem=i=>new RegExp(kind).test(norm(i.description))&&!/repair|painting|ironmongery|sealant|cleaning|lintel|sill/.test(norm(i.description))&&
   (countUnit(i.unit)||['m2','m²'].includes(norm(i.unit)));
  const old=items.filter(openingItem);
  if(old.length)warnings.push(`${kind}: geometry/catalog quantities ${old.map(i=>i.quantity).join(', ')} replaced by schedule total ${t.total}; rates remain subject to specification review.`);
  items=items.filter(i=>!openingItem(i));
  for(const [index,row] of t.rows.entries()) {
   if(!row.quantity)continue;
   const c=row.specificationAccepted?candidate(kind,row.material,'nos'):null;
   const rate=Number(c?.resolvedRate)||0;
   items.push({id:`dwg-${kind}-${index}-${row.mark}`,itemCode:c?.item_code||`DWG-${kind}-${index}`,section:'Doors & Windows',sectionCode:'08',
    description:`${kind==='door'?'Door':'Window'} ${row.mark}: ${row.description || kind} — ${row.material || 'material not specified'}${row.dimensions?' · '+row.dimensions:''}`,
    unit:'nos',quantity:row.quantity,rate,amount:Math.round(row.quantity*rate*100)/100,
    rateMissing:!rate,status:rate?'provisional_estimate':'measured_rate_pending',verification:rate?'provisional':'pending',includeInCommercialTotal:false,
    quantityVerification:'schedule_checked',quantityBasis:'drawing_schedule_two_reads',quantitySource:'drawing_schedule',rateSource:c?.resolvedSource||'matching_specification_rate_pending',
    specificationVerification:row.specificationAccepted?'drawing_transcribed':'unconfirmed',reviewRequired:true,
    source:'Drawing schedule',notes:`SCHEDULE: ${t.kind} / ${t.scope}; mark ${row.mark}; QTY column "${t.quantityHeader}" = ${row.quantityText}. ${row.quote || ''} ${rate?'Catalog budget rate for matching material/unit; dimensions and detailed specification require review.':'No compatible count-unit/material rate: obtain a matching quote; no area rate was applied to a count.'}`});
  }
 }
 const specs=(evidence.specifications||[]).filter(s=>s.accepted);
 const wallFrames=specs.filter(s=>s.scope==='wall'&&['timber_frame','steel_frame','frame_unspecified'].includes(family(s.material)));
 if(wallFrames.length&&specs.filter(s=>s.scope==='wall').every(s=>['timber_frame','steel_frame','frame_unspecified'].includes(family(s.material)))) {
  items=items.map(i=>/block wall|blockwork|brick wall|masonry wall/.test(norm(i.description))?{
   ...i,description:`Wall framing — ${wallFrames.map(s=>`${s.location}: ${s.material}`).join('; ')}`,
   section:wallFrames.every(s=>family(s.material)==='timber_frame')?'Carpentry':wallFrames.every(s=>family(s.material)==='steel_frame')?'Metal Works':'General',quantity:0,rate:0,amount:0,rateMissing:true,
   referenceRate:0,status:'quantity_pending',verification:'pending',includeInCommercialTotal:false,reviewRequired:true,
   quantityBasis:'framing_scope_measurement_pending',source:'Drawing general notes',
   notes:`Blockwork assumption replaced by explicit framing specification. Measure each specified wall system separately. ${wallFrames.map(s=>s.quote).join(' ')}`}:i);
 }
 const floors=specs.filter(s=>s.scope==='floor');
 const finishFamily=s=>family(s.material)||norm(s.material);
 const families=[...new Set(floors.map(finishFamily).filter(Boolean))];
 const oldFloors=items.filter(i=>/floor|flooring/.test(norm(i.description))&&['hardwood','tile'].includes(family(i.description)));
 if(families.length>1 || oldFloors.some(i=>!families.includes(family(i.description))) && families.length>0) {
  const old=oldFloors;
  if(old.length) {
   items=items.filter(i=>!old.includes(i));
   for(const f of families) {
    const relevant=floors.filter(s=>finishFamily(s)===f),c=candidate('floor',relevant[0]?.material,'m2');
    items.push({id:`dwg-floor-${f}`,itemCode:c?.item_code||`DWG-FLOOR-${f}`,section:'Finishes',sectionCode:'09',
     description:`${f==='hardwood'?'Hardwood flooring':f==='tile'?'Tile flooring':`Floor finish: ${relevant.map(s=>s.material).join('; ')}`} — ${relevant.map(s=>s.location).join('; ')}`,
     unit:'m2',quantity:0,rate:0,referenceRate:Number(c?.resolvedRate)||0,amount:0,status:'quantity_pending',verification:'pending',includeInCommercialTotal:false,reviewRequired:true,
     quantityBasis:'room_finish_area_pending',source:'Drawing room finish labels',notes:`Drawing finish scope: do not apply an unsupported finish to the entire floor area. Measure the listed rooms separately. ${relevant.map(s=>s.quote).join(' ')}`});
   }
  }
 }
 const roofNotes=specs.filter(s=>s.scope==='roof'&&family(s.material)==='metal_roof');
 if(roofNotes.length) {
  // Coverings are separate from structural slabs and waterproofing.
  const isCovering=i=>/roof(?:ing)?|roof covering/.test(norm(i.description))&&/tile|slate|shingle|sheet|covering|standing.seam/.test(norm(i.description))&&!/waterproof|concrete|structur|insulation|truss/.test(norm(i.description));
  items=items.filter(i=>!isCovering(i));
  items.push({id:'dwg-roof-covering',itemCode:'DWG-ROOF-COVERING',section:'Finishes',sectionCode:'09',description:`Roof covering — ${roofNotes.map(s=>`${s.location}: ${s.material}`).join('; ')}`,
   unit:'m2',quantity:0,rate:0,amount:0,rateMissing:true,status:'quantity_pending',verification:'pending',includeInCommercialTotal:false,reviewRequired:true,
   quantityBasis:'roof_covering_area_pending',source:'Drawing general notes',notes:`Measure the specified roof covering surface and obtain a matching rate; floor area is not roof surface area. ${roofNotes.map(s=>s.quote).join(' ')}`});
 }
 return {items,warnings};
}
