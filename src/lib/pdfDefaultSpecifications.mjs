import {readPdfSourceSpecifications,resolvedPdfSpecifications,pdfSpecificationConflicts} from './pdfSourceSpecifications.mjs';
import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';
import {PDF_METRIC_UNITS,normalizePdfScope} from './pdfTakeoffEvidence.mjs';
import {nativeOpeningEvidence} from './pdfNativeSchedules.mjs';
import {clearBoqGapNote} from './boqPriceSelection.mjs';

// Catalog-configured assumptions never become drawing evidence or quantities.
const allowed={
 water_pipe_length:['pipe_material','diameter_mm'],waste_pipe_length:['pipe_material','diameter_mm'],ac_pipe_length:['pipe_material','diameter_pair_mm','insulation_mm'],
 internal_block_area:['thickness_mm','block_material'],external_block_area:['thickness_mm','block_material'],
 wood_floor_area:['floor_system'],epoxy_floor_area:['floor_system'],terrace_floor_area:['tile_material'],
 wet_wall_tile_area:['tile_material'],backsplash_area:['tile_material'],ceiling_paint_area:['paint_system'],
 roof_waterproofing_area:['waterproofing_system'],terrace_waterproofing_area:['waterproofing_system'],wet_floor_waterproofing_area:['waterproofing_system'],wet_wall_waterproofing_area:['waterproofing_system'],
 door_count:['door_system'],internal_door_count:['door_system'],service_door_count:['door_system'],entrance_door_count:['door_system'],garage_door_count:['door_system'],
 ac_count:['capacity_tr','unit_system'],kitchen_cabinet_length:['cabinet_material'],kitchen_hob_hood_count:['appliance_package'],
 kitchen_sink_count:['fixture_system'],laundry_sink_count:['fixture_system'],shower_count:['fixture_system'],
 terrace_railing_length:['railing_system'],driveway_area:['paving_system'],landscape_area:['landscape_system'],
};
for(const key of ['pcc_volume','foundation_volume','pedestal_volume','column_volume','beam_volume','ground_slab_volume','first_slab_volume','roof_slab_volume'])allowed[key]=['concrete_grade'];
const unit=s=>({nos:'nr',no:'nr',each:'nr',ea:'nr',set:'nr',sqm:'m2',cum:'m3',lm:'m'})[String(s||'').toLowerCase()]||String(s||'').toLowerCase().replace('²','2').replace('³','3');
function metadata(item){try{return typeof item?.source_reference==='string'?JSON.parse(item.source_reference):item?.source_reference;}catch{return null;}}
export function isPdfDefaultOnlyPrice(item){return metadata(item)?.fallback_only===true;}
function policy(item){
 if(item?.is_active===false)return null;
 const p=metadata(item),keys=Object.hasOwn(allowed,p?.metric)?allowed[p.metric]:null;
 if(p?.kind!=='pricing_default'||p.enabled!==true||!keys||unit(item.unit)!==PDF_METRIC_UNITS[p.metric]||item.currency&&item.currency!=='AED'||typeof p.label!=='string'||!p.label.trim())return null;
 const spec=p.specification;
 if(!spec||keys.some(k=>spec[k]===undefined)||Object.keys(spec).some(k=>!keys.includes(k)))return null;
 if(Object.values(spec).some(v=>typeof v==='string'?!v.trim():typeof v!=='number'||!Number.isFinite(v)||v<=0))return null;
 if(p.metric==='ac_pipe_length'){
  const pair=String(spec.diameter_pair_mm).split('+').map(Number);
  if(pair.length!==2||pair.some(v=>!Number.isFinite(v)||v<=0)||!(Number(spec.insulation_mm)>0))return null;
 }
 if(typeof p.rate_basis!=='string'||!p.rate_basis.trim()||p.conditions!==undefined&&typeof p.conditions!=='string')return null;
 if(p.source_required!==undefined&&(!Array.isArray(p.source_required)||p.source_required.some(k=>!keys.includes(k))))return null;
 return p;
}
function pricedRow(item,p,rateItem,resolution,known,extra={}){
 const quantity=Number(item.quantity),assumed=Object.fromEntries(Object.entries(p.specification).filter(([property])=>!known.some(k=>k.property===property)));
 const disclosure=`PRICING ASSUMPTION (EDITABLE; NOT A DRAWING SPECIFICATION): ${p.label}; rate item ${rateItem.item_code}; ${p.rate_basis}.${p.conditions?' '+p.conditions:''}`;
 return {...item,description:`${p.label} [assumed specification — editable]`,rate:resolution.rate,referenceRate:resolution.rate,
  amount:Math.round((quantity*resolution.rate+Number.EPSILON)*100)/100,rateMissing:false,rateSource:`Assumed specification; catalog ${rateItem.item_code}; ${resolution.source}`,
  source:'PDF measured quantity + editable catalog specification assumption',status:'provisional_estimate',verification:'provisional',specificationVerification:'assumed',reviewRequired:true,includeInCommercialTotal:false,
  defaultSpecification:{status:'applied',metric:item.pdfEvidence.metricKey,assumed,sourceSpecifications:known,catalogItemCode:rateItem.item_code,catalogUnit:rateItem.unit,catalogRate:resolution.rate,rateBasis:p.rate_basis,policy:p,originalDescription:item.description,...extra},
  completion:{code:'assumed_specification_review_required',required_information:['Confirm or edit the assumed specification and its budget rate.']},
  notes:[clearBoqGapNote(item.notes),disclosure].filter(Boolean).join(' ')};
}
function doorParts(item,takeoff,p,catalog,priceLevel){
 if(!p.opening_components)return null;
 const native=nativeOpeningEvidence(takeoff.page_results||[],normalizePdfScope);
 const rows=native.schedules.filter(s=>s.status==='read').flatMap(s=>s.rows.filter(r=>['door','garage_door'].includes(r.kind)));
 const count=native.claims.filter(c=>c.key==='door_count').reduce((n,c)=>n+c.value,0);
 if(!native.claims.length||native.schedules.some(s=>s.status!=='read')||count!==Number(item.quantity)||rows.length!==count)return null;
 const grouped=new Map();for(const row of rows){const list=grouped.get(row.kind)||[];list.push(row);grouped.set(row.kind,list);}
 const result=[];
 for(const [kind,group] of grouped){
  const config=p.opening_components[kind],matches=catalog.filter(c=>c.item_code===config?.item_code&&c.is_active!==false);
  if(!config||matches.length!==1||unit(matches[0].unit)!=='nr')return null;
  const rateItem=matches[0],rate=resolvePdfCatalogRate(rateItem,priceLevel);if(rate.missingRate)return null;
  const pages=[...new Set(group.flatMap(r=>r.dimension_pages||[r.page]))];
  const basis=`Source opening table ${kind}: ${group.map(r=>r.source_row).join('; ')}. Count allocated from complete source table, not a pricing assumption.`;
  const child={...item,id:`${item.id||item.itemCode}:${kind}`,itemCode:`${item.itemCode}-${kind.toUpperCase()}`,quantity:group.length,
   pdfEvidence:{...item.pdfEvidence,pages,basis,sourceAllocation:{kind,count:group.length,parentQuantity:count,tags:group.map(r=>r.id)}}};
  const partPolicy={...p,label:config.label,specification:{door_system:config.door_system},rate_basis:config.rate_basis||p.rate_basis,conditions:config.conditions||p.conditions};
  // A published package size is a cost driver; oversize scaling is explicitly
  // an estimate. It never changes the measured opening count.
  const scaled=group.map(r=>Math.max(1,config.reference_area_m2>0?r.width*r.height/config.reference_area_m2:1));
  if(new Set(scaled.map(v=>v.toFixed(6))).size>1){
   for(let i=0;i<group.length;i++){
    const single={...child,id:child.id+':'+group[i].id,itemCode:child.itemCode+'-'+group[i].id,quantity:1,pdfEvidence:{...child.pdfEvidence,sourceAllocation:{kind,count:1,parentQuantity:count,tags:[group[i].id]}}};
    result.push(pricedRow(single,partPolicy,rateItem,{...rate,rate:Math.round(rate.rate*scaled[i]*100)/100},[],{openingKind:kind,sizeFactor:scaled[i]}));
   }
  }else result.push(pricedRow(child,partPolicy,rateItem,{...rate,rate:Math.round(rate.rate*scaled[0]*100)/100},[],{openingKind:kind,sizeFactor:scaled[0]}));
 }
 return result;
}
export function applyPdfDefaultSpecifications(items,takeoff,catalog=[],priceLevel='standard'){
 if(!takeoff?.pdf_analysis)return items;
 const facts=readPdfSourceSpecifications(takeoff),conflicts=pdfSpecificationConflicts(facts),byMetric=new Map();
 for(const rateItem of catalog){const p=policy(rateItem);if(!p)continue;const entries=byMetric.get(p.metric)||[];entries.push({p,rateItem});byMetric.set(p.metric,entries);}
 return items.flatMap(item=>{
  const key=item.pdfEvidence?.metricKey;
  if(item.review?.confirmed||item.source==='manual'||item.defaultSpecification?.rateOverridden||item.defaultSpecification?.status&&item.defaultSpecification.status!=='applied'||!(Number(item.quantity)>0)||Number(item.rate)>0||unit(item.unit)!==PDF_METRIC_UNITS[key])return [item];
  if(items.filter(i=>i.quantity>0&&(i.pdfEvidence?.metricKeys||[i.pdfEvidence?.metricKey]).includes(key)).length!==1||conflicts.some(f=>f.metric===key))return [item];
  const source=facts.filter(f=>f.metric===key),known=resolvedPdfSpecifications(takeoff,key,facts);
  const policies=(byMetric.get(key)||[]).filter(({p})=>!source.some(f=>!known.some(k=>k.property===f.property))&&!known.some(k=>p.specification[k.property]!==k.value)&&!(p.source_required||[]).some(prop=>!known.some(k=>k.property===prop)));
  if(policies.length!==1)return [item];
  const {p,rateItem}=policies[0],rate=resolvePdfCatalogRate(rateItem,priceLevel);if(rate.missingRate)return [item];
  const claims=takeoff.pdf_analysis.quantity_evidence?.[key],quantity=Number(item.quantity),expected=PDF_METRIC_UNITS[key];
  if(!claims?.length||claims.some(c=>c.key!==key||c.unit!==expected||!Number.isFinite(c.value)||c.value<0||!c.evidence?.trim()||!c.pages?.length)||Math.abs(claims.reduce((n,c)=>n+c.value,0)-quantity)>.001)return [item];
  if(expected==='nr'&&!Number.isInteger(quantity))return [item];
  if(['water_pipe_length','waste_pipe_length','ac_pipe_length'].includes(key)&&!source.length&&claims.some(c=>/\b(?:dn|dia(?:meter)?)\s*[:=]?\s*\d+|\b(?:ppr|u?pvc|cpvc|hdpe|copper|steel|pex)\b|\d\s*mm|[øØ⌀]|\d\s*\/\s*\d/i.test(c.evidence)))return [item];
  if(key==='door_count'&&p.opening_components){
   const parts=doorParts(item,takeoff,p,catalog,priceLevel);if(parts)return parts;
   // Do not turn a known garage opening into an ordinary timber door merely
   // because a complete readable opening table is unavailable.
   if(claims.some(c=>/garage[_ ]door|roller shutter|overhead door/i.test(c.evidence)))return [item];
  }
  return [pricedRow(item,p,rateItem,rate,known)];
 });
}
