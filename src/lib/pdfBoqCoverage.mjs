import {PDF_METRIC_UNITS, pdfScheduledRule} from './pdfTakeoffEvidence.mjs';
import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';
import {readPdfSourceSpecifications} from './pdfSourceSpecifications.mjs';
import {isPdfDefaultOnlyPrice} from './pdfDefaultSpecifications.mjs';
export {resolvePdfCatalogRate} from './boqCatalogRate.mjs';

// A quantity must not be repeated across competing catalog variants. There is
// no basis for selecting a grade, diameter, capacity or finish from price alone.
export function planPdfCatalogBindings(takeoff, candidates) {
  const byMetric = new Map(),byCode=new Map();
  const specificationFacts=readPdfSourceSpecifications(takeoff);
  const signatures = new Map(), conflictingCodes = new Set();
  for (const item of candidates || []) {
    if (!item || item.is_active === false || isPdfDefaultOnlyPrice(item)) continue;
    const code = String(item.item_code || item.itemCode || '').trim().toUpperCase();
    if (!code) continue;
    const signature=JSON.stringify([String(item.description||'').trim().toLowerCase(),String(item.unit||'').trim().toLowerCase()]);
    if(signatures.has(code)&&signatures.get(code)!==signature)conflictingCodes.add(code);
    signatures.set(code,signature);
    const evidence = pdfScheduledRule(takeoff, item.description, item.unit,specificationFacts);
    if (!evidence || evidence.quantity <= 0) continue;
    byCode.set(code,evidence);
    for(const key of evidence.metricKeys||[evidence.metricKey]){
      const group=byMetric.get(key)||new Map();group.set(code,evidence);byMetric.set(key,group);
    }
  }
  const bindings = new Map(), warnings = [];
  for (const [metric, group] of byMetric) {
    if (group.size !== 1 || conflictingCodes.has([...group.keys()][0])) {
      warnings.push(`PDF quantity ${metric} has ${group.size===1?'inconsistent definitions for catalog code':'competing catalog items'} (${[...group.keys()].join(', ')}). Specification selection required; quantity was not repeated across them.`);
    }
  }
  for(const [code,evidence] of byCode)if(!conflictingCodes.has(code)&&(evidence.metricKeys||[evidence.metricKey]).every(k=>byMetric.get(k)?.size===1))bindings.set(code,evidence);
  return {bindings, warnings};
}

// Active price items and formula rules are separate inventories. A PDF already
// supplies the measured operation; it does not need a generic geometry formula
// to use one unique matching existing catalog item. These rows exist only for
// this calculation: nothing is inserted into boq_rules or price_items.
export function planPdfCatalogRules(takeoff, rules, candidates) {
  const next=[...(rules||[])],codes=new Set(next.map(r=>String(r.item_code||'').trim().toUpperCase()));
  // A large scope dictionary can coexist with the published commercial
  // catalog. Active-but-unconfigured records (no section, source, own rate or
  // formula rule) are not commercial variants. Do not let those placeholders
  // shadow genuine items, and do not manufacture rates for them. Configured
  // zero-rate variants DO still participate, so price alone never resolves
  // competing specifications.
  const allActive=(candidates||[]).filter(i=>i&&i.is_active!==false);
  const active=allActive.filter(i=>!isPdfDefaultOnlyPrice(i));
  const configuredCodes=new Set(active.filter(i=>{
    const code=String(i.item_code||i.itemCode||'').trim().toUpperCase();
    const section=String(i.section_code||'').trim();
    return codes.has(code)||Boolean(section&&!/^unassigned$/i.test(section))||Boolean(String(i.source_name||'').trim())||!resolvePdfCatalogRate(i).missingRate;
  }).map(i=>String(i.item_code||i.itemCode||'').trim().toUpperCase()));
  // Keep every definition of a configured code in the conflict check, even
  // if a duplicate definition itself has incomplete metadata.
  const eligible=active.filter(i=>configuredCodes.has(String(i.item_code||i.itemCode||'').trim().toUpperCase()));
  const plan=planPdfCatalogBindings(takeoff,eligible);
  const ignored=active.length-eligible.length;
  if(ignored)plan.warnings.push(`PDF catalog: ${ignored} unconfigured scope entries have no section, source, own catalog rate or active formula rule; they were not treated as competing commercial items. No catalog records were changed.`);
  for(const item of eligible){
    const code=String(item?.item_code||'').trim().toUpperCase();
    if(!plan.bindings.has(code)||codes.has(code))continue;
    next.push({item_code:item.item_code,section_code:item.section_code,formula_type:'manual',
      rule_name:'PDF evidence: existing catalog item',notes:'Explicit PDF operation matched to a unique existing catalog item; review required.'});
    codes.add(code);
  }
  return {...plan,rules:next,catalogAudit:{activeEntries:allActive.length,defaultOnlyEntries:allActive.length-active.length,commercialCandidates:eligible.length,unconfiguredEntries:ignored}};
}

// Aggregate room/floor/wall summaries are diagnostic, not extra billable work.
// Only operation quantities become rows. An unmatched operation keeps its
// observed quantity but has no invented rate or material specification.
const operations = {
  excavation_volume:['02','Site Works','Excavation'],
  pcc_volume:['03','Concrete Works','Concrete blinding — grade requires confirmation'],
  foundation_volume:['03','Concrete Works','Foundation concrete — grade requires confirmation'],
  pedestal_volume:['03','Concrete Works','Pedestal concrete — grade requires confirmation'],
  column_volume:['03','Concrete Works','Column concrete — grade requires confirmation'],
  beam_volume:['03','Concrete Works','Beam concrete — grade requires confirmation'],
  ground_slab_volume:['03','Concrete Works','Ground slab concrete — grade requires confirmation'],
  first_slab_volume:['03','Concrete Works','First floor slab concrete — grade requires confirmation'],
  roof_slab_volume:['03','Concrete Works','Roof slab concrete — grade requires confirmation'],
  rebar_kg:['03','Concrete Works','Reinforcement — scheduled mass'],
  foundation_formwork_area:['03','Concrete Works','Foundation formwork'],
  column_formwork_area:['03','Concrete Works','Column formwork'],
  beam_formwork_area:['03','Concrete Works','Beam formwork'],
  slab_formwork_area:['03','Concrete Works','Slab formwork'],
  external_block_area:['04','Masonry Works','External blockwork — specification requires confirmation'],
  internal_block_area:['04','Masonry Works','Internal blockwork — specification requires confirmation'],
  wood_floor_area:['07','Finishes','Wood floor finish'],
  ceramic_floor_area:['07','Finishes','Ceramic floor finish'],
  epoxy_floor_area:['07','Finishes','Epoxy floor finish'],
  terrace_floor_area:['07','Finishes','Terrace floor finish — specification requires confirmation'],
  plaster_area:['07','Finishes','Plaster'],
  paint_area:['07','Finishes','Wall paint'],
  gypsum_ceiling_area:['07','Finishes','Gypsum ceiling'],
  window_area:['06','Doors and Windows','Windows — measured opening area; specification requires confirmation'],
  door_count:['06','Doors and Windows','Door sets — material and type require confirmation'],
  internal_door_count:['06','Doors and Windows','Internal door sets — material requires confirmation'],
  service_door_count:['06','Doors and Windows','External service door sets — specification requires confirmation'],
  entrance_door_count:['06','Doors and Windows','Entrance door sets — specification requires confirmation'],
  garage_door_count:['06','Doors and Windows','Garage door sets — specification requires confirmation'],
  kitchen_hob_hood_count:['07','Finishes','Kitchen hob and hood package — specification requires confirmation'],
  toilet_count:['08','Plumbing','Toilet pans'],
  basin_count:['08','Plumbing','Wash basins'],
  shower_count:['08','Plumbing','Showers'],
  water_pipe_length:['08','Plumbing','Water pipe — diameter and material require confirmation'],
  waste_pipe_length:['08','Plumbing','Waste pipe — diameter and material require confirmation'],
  light_count:['09','Electrical','Lighting points — fixture types require confirmation'],
  socket_count:['09','Electrical','Socket points'],
  distribution_board_count:['09','Electrical','Distribution boards'],
  ac_count:['10','HVAC','Air conditioning units — capacities require confirmation'],
  ac_pipe_length:['10','HVAC','Air conditioning pipe — specification requires confirmation'],
  smoke_detector_count:['11','Fire Fighting','Smoke detectors'],
  kitchen_cabinet_length:['07','Finishes','Kitchen cabinetry — specification requires confirmation'],
  terrace_railing_length:['12','External Works','Terrace railing — specification requires confirmation'],
  roof_waterproofing_area:['05','Waterproofing','Roof waterproofing'],
  terrace_waterproofing_area:['05','Waterproofing','Terrace waterproofing'],
  wet_floor_waterproofing_area:['05','Waterproofing','Wet area floor waterproofing'],
  wet_wall_waterproofing_area:['05','Waterproofing','Wet area wall waterproofing'],
  wet_wall_tile_area:['07','Finishes','Wet area wall tiles'],
  ceiling_paint_area:['07','Finishes','Ceiling paint'],
  backsplash_area:['07','Finishes','Kitchen backsplash'],
  driveway_area:['12','External Works','Driveway — paving specification requires confirmation'],
  landscape_area:['13','Landscaping','Landscaping — planting specification requires confirmation'],
  kitchen_sink_count:['08','Plumbing','Kitchen sinks'],
  laundry_sink_count:['08','Plumbing','Laundry sinks'],
};

export function retainUnboundPdfQuantities(items, takeoff) {
  if (!takeoff.pdf_analysis) return {items, warnings: []};
  const next = [...items], warnings = [];
  const doorKeys=['internal_door_count','service_door_count','entrance_door_count','garage_door_count'];
  const doorBreakdown=doorKeys.filter(k=>Number.isFinite(takeoff.scheduled_quantities?.[k]));
  const completeDoors=doorBreakdown.length>0&&Math.abs(doorBreakdown.reduce((n,k)=>n+takeoff.scheduled_quantities[k],0)-(takeoff.scheduled_quantities?.door_count ?? -1))<.001;
  const bound = new Set(items.filter(i => i.quantity > 0).flatMap(i => i.pdfEvidence?.metricKeys||[i.pdfEvidence?.metricKey]).filter(Boolean));
  for (const [key, [sectionCode, section, description]] of Object.entries(operations)) {
    if(key==='door_count'&&completeDoors)continue;
    if(doorKeys.includes(key)&&!completeDoors)continue;
    const quantity = takeoff.scheduled_quantities?.[key];
    const claims = takeoff.pdf_analysis.quantity_evidence?.[key];
    if (bound.has(key) || !Number.isFinite(quantity) || quantity <= 0 || !claims?.length) continue;
    const unit = PDF_METRIC_UNITS[key];
    // Validate provenance again at the pricing boundary, including consistency
    // of the claimed total. Summary-only local storage cannot fabricate rows.
    if (claims.some(c => c.key !== key || c.unit !== unit || !Number.isFinite(c.value) || c.value < 0 || !c.evidence?.trim()) ||
        Math.abs(claims.reduce((n,c)=>n+c.value,0)-quantity) > .001) continue;
    const pages = [...new Set(claims.flatMap(c => c.pages || []))];
    const basis = claims.map(c => c.evidence).join(' | ');
    const itemCode = `PDF-${key.toUpperCase()}`;
    if (next.some(i => i.itemCode === itemCode)) continue;
    next.push({itemCode, sectionCode, section, category:section, subCategory:'', description, unit, quantity,
      materialRate:0, laborRate:0, equipmentRate:0, transportRate:0,
      rate:0, referenceRate:0, amount:0, rateMissing:true, rateSource:'unavailable_specification_or_catalog_match',
      status:'measured_rate_pending', verification:'pending', includeInCommercialTotal:false,
      quantityVerification:'pdf_evidence_requires_review', reviewRequired:true,
      quantityBasis:'pdf_schedule_evidence', quantitySource:'pdf_schedule_evidence',
      source:'PDF evidence - rate and specification pending',
      pdfEvidence:{metricKey:key,pages,basis},
      notes:`PDF EVIDENCE (AI; REVIEW REQUIRED): pages ${pages.join(', ')}; ${basis}. Quantity retained without assuming a catalog specification or rate. Not included in tender or priced budget.`});
    warnings.push(`PDF quantity ${key} retained as an unpriced row; confirm specification and rate.`);
  }
  return {items:next, warnings};
}
