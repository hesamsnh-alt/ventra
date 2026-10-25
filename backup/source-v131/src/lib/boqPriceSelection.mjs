import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';
import {invalidateBoqReview,requireBoqReview} from './boqEvidence.mjs';

const units={
  kg:['mass',1],ton:['mass',1000],tonne:['mass',1000],t:['mass',1000],
  m:['length',1],lm:['length',1],'lin.m':['length',1],mm:['length',.001],cm:['length',.01],
  m2:['area',1],sqm:['area',1],'sq.m':['area',1],
  m3:['volume',1],cum:['volume',1],'cu.m':['volume',1],
  nos:['count',1],no:['count',1],nr:['count',1],each:['count',1],ea:['count',1],set:['count',1],
  point:['point',1],month:['month',1],day:['day',1],lot:['lump_sum',1],lump_sum:['lump_sum',1],
};
const unitKey=s=>String(s||'').trim().toLowerCase().replace(/²/g,'2').replace(/³/g,'3').replace(/^(no|nos)\.$/,'$1');
export function boqUnitFactor(from,to){
  const a=unitKey(from),b=unitKey(to);if(!a||!b)return null;
  if(a===b)return 1;
  const x=units[a],y=units[b];return x&&y&&x[0]===y[0]?x[1]/y[1]:null;
}
export function clearBoqGapNote(notes){return String(notes||'').replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g,'').trim();}
export function catalogPriceEntries(catalog,priceLevel='standard'){
  if(!catalog||!Array.isArray(catalog.sections))throw Error('Invalid price catalog response.');
  const entries=[],seen=new Map();
  for(const section of catalog.sections){
    for(const item of section.items||[]){
      const code=String(item.itemCode||'').trim();if(!code)continue;
      const resolution=resolvePdfCatalogRate({standard_rate:item.standardRate,economy_rate:item.economyRate,premium_rate:item.premiumRate,
        material_rate:item.materialRate,labor_rate:item.laborRate,equipment_rate:item.equipmentRate,transport_rate:item.transportRate},priceLevel);
      const entry={id:code,itemCode:code,sectionCode:section.sectionCode,section:section.sectionName||item.category||'General',
        description:String(item.description||''),unit:String(item.unit||''),rate:resolution.rate,rateMissing:resolution.missingRate,
        rateSource:resolution.source,sourceName:item.sourceName||''};
      const signature=JSON.stringify([entry.description,entry.unit,entry.rate]);
      if(seen.has(code)&&seen.get(code)!==signature)throw Error(`Conflicting catalog definitions for ${code}.`);
      if(!seen.has(code))entries.push(entry);seen.set(code,signature);
    }
  }
  return entries;
}
function pendingState(item){
  const quantity=Number(item.quantity),rate=Number(item.rate);
  return requireBoqReview({...item,amount:quantity*rate,rateMissing:!(rate>0),
    status:quantity>0?(rate>0?'provisional_estimate':'measured_rate_pending'):'quantity_pending',
    verification:quantity>0&&rate>0?'provisional':'pending',includeInCommercialTotal:false,
    completion:quantity>0&&rate>0?{code:'line_review_required',required_information:['Review scope, quantity/unit and applicable rate.']}:item.completion});
}
export function applyBoqCatalogSelection(item,entry){
  const factor=boqUnitFactor(item.unit,entry.unit),rate=Number(entry.rate);
  if(factor===null)throw Error(`Cannot apply a ${entry.unit} rate to a ${item.unit} quantity. Select a compatible unit.`);
  if(!Number.isFinite(rate)||rate<=0||entry.rateMissing)throw Error('This catalog item has no recorded rate. A project-specific rate is required.');
  if(!Number.isFinite(Number(item.quantity))||Number(item.quantity)<0)throw Error('Invalid BOQ quantity.');
  const before={quantity:Number(item.quantity),unit:item.unit};
  const scope=String(item.itemCode||'').startsWith('PDF-')?String(item.description||'').split(' — ')[0].trim():'';
  const description=scope&&scope.toLowerCase()!==String(entry.description).toLowerCase()?`${scope} — ${entry.description}`:entry.description;
  return pendingState({...invalidateBoqReview(item),section:entry.section,description,
    ...(item.defaultSpecification?{defaultSpecification:{...item.defaultSpecification,status:'superseded_by_catalog_selection'},source:'PDF measured quantity + user catalog selection'}:{}),
    quantity:before.quantity*factor,unit:entry.unit,rate,referenceRate:rate,rateSource:`Catalog ${entry.itemCode||entry.id}: ${entry.rateSource}`,
    catalogSelection:{itemCode:entry.itemCode||entry.id,rateSource:entry.rateSource,sourceName:entry.sourceName||'',selectedUnit:entry.unit,selectedRate:rate,
      originalQuantity:before.quantity,originalUnit:before.unit,originalDescription:item.description,quantityFactor:factor},
    notes:[clearBoqGapNote(item.notes),`PROJECT CATALOG SELECTION: ${entry.itemCode||entry.id}; ${before.quantity} ${before.unit} × ${factor} = ${before.quantity*factor} ${entry.unit}; own catalog rate ${rate}. Scope/specification and rate require review.`].filter(Boolean).join(' ')});
}
export function editPdfBoqItem(item,field,value){
  const next={...invalidateBoqReview(item)};
  if(field==='unit'){
    const factor=boqUnitFactor(item.unit,value);if(factor===null)throw Error(`Cannot convert ${item.unit} to ${value}. Keep the measured unit or add a separate manual item.`);
    next.unit=value;next.quantity=Number(item.quantity)*factor;next.rate=Number(item.rate)/factor;
    if(Number.isFinite(Number(item.referenceRate)))next.referenceRate=Number(item.referenceRate)/factor;
    next.unitConversion={from:item.unit,to:value,quantityFactor:factor};
    next.notes=[clearBoqGapNote(item.notes),`UNIT CONVERSION: ${item.quantity} ${item.unit} × ${factor}; unit rate ÷ ${factor}; line amount preserved.`].filter(Boolean).join(' ');
  }else if(field==='quantity'||field==='rate'){
    const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('Quantity and rate must be finite and non-negative.');
    next[field]=n;next.notes=clearBoqGapNote(item.notes);
    if(field==='quantity'){
      next.originalMeasurement=item.originalMeasurement||{quantity:item.quantity,unit:item.unit,quantityBasis:item.quantityBasis};
      next.quantityBasis='manual_quantity_override';next.quantitySource='manual';next.quantityVerification='manual';
    }else{
      next.rateSource='Manual project rate — review required';
      if(item.catalogSelection)next.catalogSelection={...item.catalogSelection,rateOverridden:true};
      if(item.defaultSpecification)next.defaultSpecification={...item.defaultSpecification,rateOverridden:true};
    }
  }else {
    next[field]=value;
    if(field==='description'&&item.defaultSpecification?.status==='applied'&&value!==item.description){
      next.rate=0;next.referenceRate=0;next.rateSource='Specification edited — select a matching catalog rate or enter a project rate';
      next.defaultSpecification={...item.defaultSpecification,status:'specification_edited'};
      next.notes=[clearBoqGapNote(item.notes),'SPECIFICATION EDITED: the previous default rate was cleared; select a matching catalog item or enter a rate.'].filter(Boolean).join(' ');
    }
  }
  return pendingState(next);
}
