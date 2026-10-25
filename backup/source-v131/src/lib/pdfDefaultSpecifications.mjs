import {readPdfSourceSpecifications,resolvedPdfSpecifications,pdfSpecificationConflicts} from './pdfSourceSpecifications.mjs';
import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';

// Defaults are pricing assumptions, never drawing evidence. They are configured
// on their own catalog rate item and apply only to unpriced measured pipe rows.
const allowed={water_pipe_length:['pipe_material','diameter_mm'],waste_pipe_length:['pipe_material','diameter_mm'],ac_pipe_length:['pipe_material','diameter_pair_mm','insulation_mm']};
function policy(item){
  if(item?.is_active===false)return null;
  let p;try{p=typeof item.source_reference==='string'?JSON.parse(item.source_reference):item.source_reference;}catch{return null;}
  if(p?.kind!=='pricing_default'||p.enabled!==true||!allowed[p.metric]||item.unit!=='m'||item.currency&&item.currency!=='AED'||typeof p.label!=='string'||!p.label.trim())return null;
  const spec=p.specification;
  if(!spec||allowed[p.metric].some(k=>spec[k]===undefined)||Object.keys(spec).some(k=>!allowed[p.metric].includes(k)))return null;
  if(typeof spec.pipe_material!=='string'||!spec.pipe_material.trim())return null;
  if(p.metric==='ac_pipe_length'){
    const pair=String(spec.diameter_pair_mm).split('+').map(Number);
    if(pair.length!==2||pair.some(v=>!Number.isFinite(v)||v<=0)||!(Number(spec.insulation_mm)>0))return null;
  }else if(!Number.isFinite(spec.diameter_mm)||spec.diameter_mm<=0)return null;
  if(typeof p.rate_basis!=='string'||!p.rate_basis.trim()||p.conditions!==undefined&&typeof p.conditions!=='string')return null;
  return p;
}
export function applyPdfDefaultSpecifications(items,takeoff,catalog=[],priceLevel='standard'){
  if(!takeoff?.pdf_analysis)return items;
  const facts=readPdfSourceSpecifications(takeoff),conflicts=pdfSpecificationConflicts(facts),byMetric=new Map();
  for(const rateItem of catalog){const p=policy(rateItem);if(!p)continue;const entries=byMetric.get(p.metric)||[];entries.push({p,rateItem});byMetric.set(p.metric,entries);}
  return items.map(item=>{
    const key=item.pdfEvidence?.metricKey,policies=byMetric.get(key)||[];
    if(policies.length!==1||item.review?.confirmed||item.source==='manual'||!(Number(item.quantity)>0)||item.unit!=='m'||Number(item.rate)>0)return item;
    // Do not assume a split for mixed source specifications, a partially scoped
    // detail, duplicate billed operations, or a source property we cannot price.
    if(items.filter(i=>i.quantity>0&&(i.pdfEvidence?.metricKeys||[i.pdfEvidence?.metricKey]).includes(key)).length!==1||conflicts.some(f=>f.metric===key))return item;
    const {p,rateItem}=policies[0],source=facts.filter(f=>f.metric===key),known=resolvedPdfSpecifications(takeoff,key,facts);
    if(source.some(f=>!known.some(k=>k.property===f.property))||known.some(k=>p.specification[k.property]!==k.value))return item;
    const rate=resolvePdfCatalogRate(rateItem,priceLevel);if(rate.missingRate)return item;
    const claims=takeoff.pdf_analysis.quantity_evidence?.[key],quantity=Number(item.quantity);
    if(!claims?.length||claims.some(c=>c.key!==key||c.unit!=='m'||!Number.isFinite(c.value)||c.value<0||!c.evidence?.trim()||!c.pages?.length)||Math.abs(claims.reduce((n,c)=>n+c.value,0)-quantity)>.001)return item;
    // Detailed extracted notes without reparsable source facts must not be
    // silently replaced by a default (for example, a scanned DN25 schedule).
    if(!source.length&&claims.some(c=>/\b(?:dn|dia(?:meter)?)\s*[:=]?\s*\d+|\b(?:ppr|u?pvc|cpvc|hdpe|copper|steel|pex)\b|\d\s*mm|[øØ⌀]|\d\s*\/\s*\d/i.test(c.evidence)))return item;
    const assumed=Object.fromEntries(Object.entries(p.specification).filter(([property])=>!known.some(k=>k.property===property)));
    const notes=String(item.notes||'').replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g,'').trim();
    const disclosure=`PRICING ASSUMPTION (EDITABLE; NOT A DRAWING SPECIFICATION): ${p.label}; rate item ${rateItem.item_code}; ${p.rate_basis}.${p.conditions?' '+p.conditions:''}`;
    return {...item,description:`${p.label} [assumed specification — editable]`,rate:rate.rate,referenceRate:rate.rate,
      amount:Math.round((quantity*rate.rate+Number.EPSILON)*100)/100,rateMissing:false,rateSource:`Assumed specification; catalog ${rateItem.item_code}; ${rate.source}`,
      source:'PDF measured quantity + editable catalog specification assumption',status:'provisional_estimate',verification:'provisional',specificationVerification:'assumed',reviewRequired:true,includeInCommercialTotal:false,
      defaultSpecification:{status:'applied',metric:key,assumed,sourceSpecifications:known,catalogItemCode:rateItem.item_code,catalogUnit:rateItem.unit,catalogRate:rate.rate,rateBasis:p.rate_basis,policy:p,originalDescription:item.description},
      completion:{code:'assumed_specification_review_required',required_information:['Confirm or edit the assumed specification and its budget rate.']},
      notes:[notes,disclosure].filter(Boolean).join(' ')};
  });
}
