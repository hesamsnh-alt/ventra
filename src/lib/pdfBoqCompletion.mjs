import {bindPdfSourceRates} from './pdfSourceRateBook.mjs';
import {pdfRuleMetric} from './pdfTakeoffEvidence.mjs';
import {readPdfSourceSpecifications,resolvedPdfSpecifications,pdfSpecificationConflicts} from './pdfSourceSpecifications.mjs';
import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';
import {applyPdfDefaultSpecifications,isPdfDefaultOnlyPrice} from './pdfDefaultSpecifications.mjs';
import {bindPdfOperationRates} from './pdfOperationPricing.mjs';

const requirements={
  internal_block_area:['Block thickness/material matching the drawing','An own catalog or project rate for that specification'],
  door_count:['Door material/type breakdown including garage doors','Applicable rate for each selected door type'],
  internal_door_count:['Door material and set specification'],service_door_count:['Service door classification and specification'],entrance_door_count:['Entrance door classification and specification'],garage_door_count:['Garage door system and specification'],
  water_pipe_length:['Pipe material and diameter breakdown'],waste_pipe_length:['Drainage material and diameter breakdown'],
  ac_count:['Unit type and capacity breakdown'],ac_pipe_length:['AC pipe material/diameter and insulation specification'],
  wet_wall_tile_area:['Wall tile material and installation specification'],backsplash_area:['Backsplash material and installation specification'],
  roof_waterproofing_area:['Roof waterproofing system, layers and installation specification'],terrace_waterproofing_area:['Terrace waterproofing system and installation specification'],
  wet_floor_waterproofing_area:['Wet floor waterproofing system and installation specification'],wet_wall_waterproofing_area:['Wet wall waterproofing system and installation specification'],
  ceiling_paint_area:['Applicable ceiling paint system and its own rate'],epoxy_floor_area:['Epoxy floor system and its own rate'],
  wood_floor_area:['Wood flooring system/material and its own rate'],terrace_floor_area:['Outdoor flooring material and installation specification'],
  kitchen_cabinet_length:['Base cabinet material/finish and linear-metre rate'],kitchen_hob_hood_count:['Hob/hood package specification and package rate'],
  kitchen_sink_count:['Kitchen sink and fittings specification'],laundry_sink_count:['Laundry sink and fittings specification'],shower_count:['Shower/fittings package specification'],
  terrace_railing_length:['Railing material/system and linear-metre rate'],driveway_area:['Driveway paving material and construction specification'],landscape_area:['Landscape planting/groundcover specification'],
};
export function annotatePdfBoqCompletion(items,takeoff,catalog=[],priceLevel='standard'){
  if(!takeoff.pdf_analysis)return {items,summary:null,gaps:[]};
  items=bindPdfSourceRates(items,takeoff);
  items=applyPdfDefaultSpecifications(items,takeoff,catalog,priceLevel);
  items=bindPdfOperationRates(items,catalog,priceLevel);
  const candidates=new Map();
  const specificationFacts=readPdfSourceSpecifications(takeoff);
  const specificationConflicts=pdfSpecificationConflicts(specificationFacts);
  for(const p of catalog){
    if(p?.is_active===false||isPdfDefaultOnlyPrice(p))continue;
    const m=pdfRuleMetric(p?.description,p?.unit,takeoff,specificationFacts);if(!m)continue;
    const rows=candidates.get(m.key)||[];
    rows.push({code:p.item_code||p.itemCode,unit:p.unit,rateAvailable:!resolvePdfCatalogRate(p).missingRate});candidates.set(m.key,rows);
  }
  const summary={pricedMeasuredOperations:0,unpricedMeasuredOperations:0,catalogOptionsWithoutQuantity:0,assumedSpecificationOperations:0,unmeasuredCatalogRowsAreNotMissingProjectScope:true,completePricedBudget:false};
  const gaps=[];
  const next=items.map(item=>{
    const quantity=Number(item.quantity),rate=Number(item.rate);
    const existingNotes=String(item.notes||'').replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g,'').trim();
    if(!(quantity>0)){
      summary.catalogOptionsWithoutQuantity++;
      const completion={code:'catalog_option_without_quantity',required_information:['Select this catalog option only if it belongs to the project and has its own measured quantity.']};
      return {...item,completion,notes:[existingNotes,'[BOQ GAP] Catalog option without a project quantity. This row is not evidence of an additional missing project scope. [/BOQ GAP]'].filter(Boolean).join(' ')};
    }
    if(rate>0&&!item.rateMissing){summary.pricedMeasuredOperations++;if(item.defaultSpecification?.status==='applied'||Object.keys(item.operationPricing?.assumed_specification||{}).length)summary.assumedSpecificationOperations++;return item;}
    summary.unpricedMeasuredOperations++;
    const key=item.pdfEvidence?.metricKey||String(item.itemCode||'').replace(/^PDF-/,'').toLowerCase();
    const matching=candidates.get(key)||[];
    let required=/_volume$/.test(key)&&key!=='excavation_volume'?['Concrete grade/specification for this element','Applicable own catalog or project rate']:
      requirements[key]||['Applicable scope/material specification and matching own catalog or project rate'];
    let code=matching.length&&matching.every(p=>!p.rateAvailable)?'catalog_rate_missing':matching.length>1?'catalog_selection_required':'specification_or_catalog_match_required';
    if(item.operationPricing?.status==='catalog_rate_missing'){code='catalog_rate_missing';required=item.operationPricing.required_information?.length?item.operationPricing.required_information:['Applicable installed supplier/project rate for this source operation'];}
    if(item.operationPricing?.status==='ambiguous'){code='catalog_selection_required';required=['Resolve competing specification-matched operation catalog records: '+item.operationPricing.candidate_codes.join(', ')];}
    const known=resolvedPdfSpecifications(takeoff,key,specificationFacts),conflicts=specificationConflicts.filter(f=>f.metric===key);
    if(conflicts.length){code='source_specification_breakdown_required';required=['Provide disjoint measured quantities for the mixed/conflicting source specifications before selecting rates.'];}
    else if(known.length&&!matching.length){code='source_specification_without_catalog_match';required=['Select or provide an applicable rate matching the known source specification; the source quantity is retained.'];}
    const completion={code,metric:key,required_information:required,candidate_codes:matching.map(p=>p.code),...(known.length?{source_specifications:known}:{}),...(conflicts.length?{specification_conflicts:conflicts}: {})};
    gaps.push({itemCode:item.itemCode,description:item.description,quantity,unit:item.unit,...completion});
    const sourceNote=known.length?' Source: '+known.map(f=>`${f.property}=${f.value} (pages ${f.pages.join(', ')})`).join('; ')+'.':'';
    const note=`[BOQ GAP] ${code}: ${required.join('; ')}.${matching.length?' Catalog candidates: '+matching.map(p=>p.code).join(', ')+'.':''}${sourceNote} [/BOQ GAP]`;
    return {...item,completion,notes:[existingNotes,note].filter(Boolean).join(' ')};
  });
  summary.knownMeasuredOperationsHaveRates=summary.pricedMeasuredOperations>0&&summary.unpricedMeasuredOperations===0;
  return {items:next,summary,gaps};
}
