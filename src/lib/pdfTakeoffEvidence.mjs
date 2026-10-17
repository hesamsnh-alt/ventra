import {recoverPdfRoomInventory} from './pdfRoomInventory.mjs';
import {auditPdfAreaGeometry} from './pdfAreaGeometry.mjs';
import {applyPdfDocumentReview,PDF_AREA_KEYS} from './pdfMeasurementCalculations.mjs';
import {PDF_SOURCE_MEASUREMENT_KEYS} from './pdfSourceMeasurements.mjs';
import {nativeOpeningEvidence} from './pdfNativeSchedules.mjs';
import {pdfCatalogScope,pdfCatalogThicknessMatches,pdfCatalogHeightMatches} from './pdfCatalogScope.mjs';
import {readPdfSourceSpecifications,sourceSpecificationMetric,hasSourceSpecificationScope,pdfSpecificationConflicts} from './pdfSourceSpecifications.mjs';
import {extractNativePdfPages} from './pdfNativePageExtraction.mjs';
// PDF quantities require explicit page roles/scopes. No project-specific totals.
export const PDF_METRIC_UNITS=Object.freeze({rooms:'nr',door_count:'nr',window_count:'nr',door_area:'m2',window_area:'m2',wall_length:'m',wall_area:'m2',floor_area:'m2',ceiling_area:'m2',roof_area:'m2',pcc_volume:'m3',foundation_volume:'m3',pedestal_volume:'m3',column_volume:'m3',beam_volume:'m3',ground_slab_volume:'m3',first_slab_volume:'m3',roof_slab_volume:'m3',rebar_kg:'kg',foundation_formwork_area:'m2',column_formwork_area:'m2',beam_formwork_area:'m2',slab_formwork_area:'m2',external_block_area:'m2',internal_block_area:'m2',wood_floor_area:'m2',ceramic_floor_area:'m2',epoxy_floor_area:'m2',terrace_floor_area:'m2',wet_floor_area:'m2',wet_wall_area:'m2',plaster_area:'m2',paint_area:'m2',gypsum_ceiling_area:'m2',excavation_volume:'m3',toilet_count:'nr',basin_count:'nr',shower_count:'nr',socket_count:'nr',light_count:'nr',distribution_board_count:'nr',ac_count:'nr',smoke_detector_count:'nr',water_pipe_length:'m',waste_pipe_length:'m',ac_pipe_length:'m',kitchen_cabinet_length:'m',terrace_railing_length:'m',roof_waterproofing_area:'m2',terrace_waterproofing_area:'m2',wet_floor_waterproofing_area:'m2',wet_wall_waterproofing_area:'m2',wet_wall_tile_area:'m2',ceiling_paint_area:'m2',backsplash_area:'m2',driveway_area:'m2',landscape_area:'m2',kitchen_sink_count:'nr',laundry_sink_count:'nr',internal_wall_length:'m',external_wall_length:'m',internal_door_count:'nr',service_door_count:'nr',entrance_door_count:'nr',garage_door_count:'nr',kitchen_hob_hood_count:'nr'});
export function normalizePdfScope(s){const v=String(s||'').toLowerCase().trim().replace(/[ _-]+/g,' ');if(['gf','ground','ground floor','floor 0','همکف','الطابق الأرضي'].includes(v))return 'floor:0';if(['ff','first','first floor','floor 1','طبقه اول','الطابق الأول'].includes(v))return 'floor:1';if(['project','whole project','all floors','total'].includes(v))return 'project';return v;}
const valid=n=>Number.isFinite(n)&&n>=0;
// Exclusions are free-text schema fields. Recognize declared metric identifiers
// with explanations, without treating a substring of another metric as a key.
export function pdfExcludedMetricKeys(exclusions){
 const declared=new Set();
 for(const text of exclusions||[])for(const token of String(text).match(/[A-Za-z_][A-Za-z_0-9]*/g)||[])
  if(Object.hasOwn(PDF_METRIC_UNITS,token))declared.add(token);
 return [...declared];
}
export function mergePdfEvidence(pages,failed=[],total=pages.length){
 const warnings=[],selected=new Map(),excluded=[],conflictedFloors=new Set();
 const documentReview=applyPdfDocumentReview(pages,PDF_METRIC_UNITS,normalizePdfScope);pages=documentReview.pages;warnings.push(...documentReview.warnings);
 const reviewStatus=pages.find(p=>p.document_review_status)?.document_review_status;
 if(reviewStatus&&['failed','pending'].includes(reviewStatus.status))warnings.push('PDF cross-page measurement review '+reviewStatus.status+': '+reviewStatus.reason);
 const areaValidation=[];
 pages=pages.map(p=>{const checked=auditPdfAreaGeometry(p);if(checked.audit)areaValidation.push(checked.audit);warnings.push(...checked.warnings);
  if(checked.page.__areaGeometryValidated)return checked.page;
  const recovered=recoverPdfRoomInventory(checked.page);warnings.push(...recovered.warnings);return recovered.page;});
 for(const p of pages){const e=p.page_evidence;
  if(e?.kind!=='floor_plan'){excluded.push({page:p.pageNumber,reason:'not_an_architectural_floor_plan'});continue;}
  const scope=normalizePdfScope(e.scope_id);if(!scope||scope==='project'){excluded.push({page:p.pageNumber,reason:'unresolved_floor_scope'});warnings.push('Floor scope missing on page '+p.pageNumber);continue;}
  const existing=selected.get(scope);if(!existing){selected.set(scope,p);continue;}
  // Keep a single architectural representation. A different revision is not
  // silently assumed newer; expose it for review.
  if(existing.page_evidence.revision!==e.revision){warnings.push('Conflicting floor revisions: '+scope);conflictedFloors.add(scope);}
  if((p.confidence||0)>(existing.confidence||0)){excluded.push({page:existing.pageNumber,reason:'duplicate_floor_scope'});selected.set(scope,p);}else excluded.push({page:p.pageNumber,reason:'duplicate_floor_scope'});
 }
 const floors=[...selected.entries()].filter(([scope])=>!conflictedFloors.has(scope)).map(([,p])=>p),fields={rooms:0,doors:0,windows:0,wall_length:0,wall_area:0,floor_area:0,ceiling_area:0,door_area:0,window_area:0};
 const native=nativeOpeningEvidence(pages.filter(p=>p.page_evidence?.kind!=='floor_plan'||floors.includes(p)),normalizePdfScope);
 const nativeTables=extractNativePdfPages(pages.map(p=>({pageNumber:p.pageNumber,native_text_evidence:p.native_text_evidence})),normalizePdfScope);
 const tableClaims=nativeTables.pages.flatMap(p=>p.page_evidence.quantities);
 const nativeOpeningKeys=new Set(native.claims.map(q=>q.key));
 const nativeWholeTableKeys=new Set(tableClaims.filter(q=>normalizePdfScope(q.scope_id)==='project').map(q=>q.key));
 const nativeFloorTableKeys=new Set(tableClaims.filter(q=>normalizePdfScope(q.scope_id)!=='project').map(q=>q.key));
 const nativeTableIdentities=new Set(tableClaims.map(q=>q.key+'|'+normalizePdfScope(q.scope_id)));
 warnings.push(...native.warnings);const nativeKeys=new Set([...native.claims,...tableClaims].map(q=>q.key));
 for(const p of floors)for(const k of Object.keys(fields)){if(valid(p[k]))fields[k]+=p[k];}
 // Schedules/specs are reconciled by semantic key + physical scope, not added
 // to plan totals. Exact repetitions collapse; conflicting claims are withheld.
 const claims=new Map(),rejected=[];
 const observations=pages.filter(p=>p.page_evidence?.kind!=='floor_plan'||floors.includes(p)).map(p=>{
  const direct=p.page_evidence?.kind==='floor_plan'?Object.entries({rooms:'rooms',doors:'door_count',windows:'window_count',floor_area:'floor_area',ceiling_area:'ceiling_area',wall_length:'wall_length',wall_area:'wall_area',window_area:'window_area',door_area:'door_area'}).filter(([k])=>valid(p[k])&&p[k]>0).map(([k,key])=>({key,value:p[k],unit:PDF_METRIC_UNITS[key],scope_id:p.page_evidence.scope_id,evidence:`Architectural plan page ${p.pageNumber}: ${k} summary; AI extraction requires review.`})):[];
  return {...p,claims:[...direct,...(p.page_evidence?.quantities||[])]};
 });
 if(native.claims.length)observations.push({pageNumber:native.schedules[0].page,page_evidence:{kind:'opening_schedule'},claims:native.claims});
 for(const p of nativeTables.pages)if(p.page_evidence.quantities.length)observations.push({pageNumber:p.pageNumber,page_evidence:p.page_evidence,claims:p.page_evidence.quantities});
 for(const p of observations)for(const q of p.claims){
  const scope=normalizePdfScope(q.scope_id),unit=PDF_METRIC_UNITS[q.key];
  if(!q.native_calculated&&(nativeOpeningKeys.has(q.key)||nativeWholeTableKeys.has(q.key)||nativeTableIdentities.has(q.key+'|'+scope)||nativeFloorTableKeys.has(q.key)&&scope==='project'))continue;
  if(!unit||q.unit!==unit||!scope||!valid(q.value)||(unit==='nr'&&!Number.isInteger(q.value))||!String(q.evidence||'').trim()){rejected.push({page:p.pageNumber,key:q.key,reason:'invalid_or_unsupported_evidence'});continue;}
  const id=q.key+'|'+scope,priority=q.document_calculated?3:p.page_evidence.kind==='floor_plan'?1:2;
  const sourcePages=q.document_calculated?q.pages:PDF_AREA_KEYS.includes(q.key)&&p.document_area_source_pages?p.document_area_source_pages:[p.pageNumber];
  const row={...q,scope_id:scope,pages:[...new Set(sourcePages)],priority};const old=claims.get(id);
  if(!old||priority>old.priority)claims.set(id,row);
  else if(priority===old.priority){old.pages=[...new Set([...old.pages,...row.pages])];if(Math.abs(old.value-row.value)>.001)old.conflict=true;}
 }
 const resolved={},evidence={},overlappingScopeClaims=[],nativeIncompleteKeys=new Set();
 const floorScopes=new Set(floors.map(p=>normalizePdfScope(p.page_evidence.scope_id)));
 for(const key of Object.keys(PDF_METRIC_UNITS)){
  const values=[...claims.values()].filter(q=>q.key===key),whole=values.find(q=>q.scope_id==='project');
  const isFloorScope=q=>floorScopes.has(q.scope_id)||/^floor:-?\d+$/.test(q.scope_id);
  const floorTotals=values.filter(isFloorScope);
  if(nativeFloorTableKeys.has(key)&&[...floorScopes].some(scope=>!floorTotals.some(q=>q.scope_id===scope))){
   warnings.push('Native table does not cover every selected floor for '+key+'; project total withheld');resolved[key]=0;nativeIncompleteKeys.add(key);continue;
  }
  // A named subset (wet rooms, kitchen, etc.) is not a disjoint extra floor.
  // Structural roof-level work remains distinct from floor-level work.
  const structural=/^(?:beam|column|foundation|pedestal|.*slab)_volume$|_formwork_area$/.test(key);
  const use=whole?[whole]:floorTotals.length?values.filter(q=>isFloorScope(q)||(structural&&q.scope_id==='roof')):values;
  for(const q of values)if(!use.includes(q))overlappingScopeClaims.push({key,scope:q.scope_id,pages:q.pages,value:q.value,reason:whole?'project_total_precedes_subsets':'qualified_subset_not_added_to_floor_totals'});
  if(!use.length)continue;
  if(use.some(q=>q.conflict)){warnings.push('Conflicting scheduled quantity: '+key);resolved[key]=0;continue;}
  resolved[key]=use.reduce((n,q)=>n+q.value,0);evidence[key]=use.map(({priority,...q})=>q);
 }
 const names={door_count:'doors',window_count:'windows'};
 for(const [key,n] of Object.entries(resolved))fields[names[key]||key]=n;
 // A withheld floor cannot be silently omitted while another floor's partial
 // quantity is priced as a complete project total.
 const blocked=new Set([...areaValidation.flatMap(a=>a.withheld_metrics||[]),...documentReview.blocked,...nativeIncompleteKeys]);
 for(const key of nativeKeys)if(!nativeIncompleteKeys.has(key))blocked.delete(key);
 const omitted=pdfExcludedMetricKeys(documentReview.audit?.exclusions);
 // An explicit unresolved wall/finish operation cannot use an older plan
 // summary as a complete quantity. A valid reviewed calculation can resolve it.
 for(const key of omitted)if(PDF_SOURCE_MEASUREMENT_KEYS.includes(key)&&!evidence[key]?.some(q=>q.document_calculated)){
  blocked.add(key);warnings.push('PDF explicitly unresolved source measurement: '+key);
 }
 for(const key of blocked){fields[names[key]||key]=0;resolved[key]=0;delete evidence[key];}
 // Never guess area from counts or wall geometry from an area/room coefficient.
 fields.window_area=resolved.window_area??fields.window_area;
 fields.door_area=resolved.door_area??fields.door_area;
 const report={version:108,measurement_review_version:1,document_review_status:reviewStatus||null,document_measurement_review:documentReview.audit,total_pages:total,selected_floor_pages:floors.map(p=>({page:p.pageNumber,scope:normalizePdfScope(p.page_evidence.scope_id)})),excluded_pages:excluded,failed_pages:failed,conflicts:warnings,rejected_claims:rejected,quantity_evidence:evidence,area_validation:areaValidation,withheld_area_metrics:[...new Set(areaValidation.flatMap(a=>a.withheld_metrics||[]))],withheld_measurement_metrics:[...blocked].filter(k=>!PDF_AREA_KEYS.includes(k)),overlapping_scope_claims:overlappingScopeClaims,unresolved_floor_scopes:[...conflictedFloors]};
 report.source_measurement_status=pages.find(p=>p.source_measurement_status)?.source_measurement_status||null;
 report.native_opening_schedules=native.schedules.map(s=>({page:s.page,status:s.status,scope_id:s.scope_id,rows:s.rows.length,reason:s.reason||null}));
 report.local_pdf_recovery=pages.find(p=>p.local_pdf_recovery)?.local_pdf_recovery||null;
 report.native_first_read=pages.find(p=>p.native_first_read)?.native_first_read||null;
 report.specification_facts=readPdfSourceSpecifications({page_results:pages});
 report.specification_conflicts=pdfSpecificationConflicts(report.specification_facts);
 for(const issue of report.specification_conflicts)warnings.push(`PDF specifications ${issue.metric}/${issue.property}: ${issue.values.join(', ')} on pages ${issue.pages.join(', ')}; source breakdown required before selecting a catalog variant.`);
 // Transport completion says nothing about complete measured scope. Record
 // explicit omitted metric names without deleting unrelated saved evidence.
 const unmeasured=omitted.filter(k=>!evidence[k]?.length);
 report.measurement_completion={status:failed.length||conflictedFloors.size||blocked.size||unmeasured.length||['failed','pending'].includes(reviewStatus?.status)||['failed','pending','partial'].includes(report.source_measurement_status?.status)?'incomplete':'provisional',
  unmeasured_metrics:[...new Set(unmeasured)],withheld_metrics:[...blocked],
  reason:'AI-extracted evidence requires source review; completed requests do not establish a complete or approved BOQ.'};
 const nativeHeight=pages.find(p=>p.native_measurement_basis)?.native_measurement_basis?.rules?.wall_height;
 const sourcedHeight=Number.isFinite(nativeHeight?.value)&&nativeHeight.value>0&&nativeHeight.evidence?.trim()&&nativeHeight.pages?.length&&nativeHeight.pages.every(n=>pages.some(p=>p.pageNumber===n));
 return {...fields,confidence:floors.length?Math.round(floors.reduce((s,p)=>s+(p.confidence||0),0)/floors.length*10)/10:0,wall_height:sourcedHeight?nativeHeight.value:3.2,wall_length_estimated:false,wall_area_estimated:false,wall_length_source:'pdf_scoped_floor_plan',wall_area_source:'pdf_scoped_floor_plan',wall_height_source:sourcedHeight?'pdf_native_source_rule':'project_default',total_pages:total,analyzed_pages:pages.length,failed_pages:failed,page_results:pages,detected_items:floors.flatMap(p=>(p.detected_items||[]).map(i=>({...i,pages:[p.pageNumber]}))),scheduled_quantities:resolved,pdf_analysis:report,notes:`PDF reconciled by page role and floor scope. ${floors.length} distinct floor plans selected. Schedules override matching scope instead of adding duplicates. AI extraction requires review. ${warnings.join('; ')}`};
}
export function pdfRuleMetric(description,unit,takeoff=null,specificationFacts=undefined){
 const d=String(description||'').toLowerCase().replace(/[-‐‑–—]/g,' ').replace(/\s+/g,' ').trim(),rawUnit=String(unit||'').toLowerCase().trim().replace('²','2').replace('³','3');
 const u=({'sqm':'m2','sq.m':'m2','sq m':'m2','cum':'m3','cu.m':'m3','cu m':'m3','lm':'m','lin.m':'m','linear metre':'m','linear meter':'m','no.':'nr','nos.':'nr','each':'nr','ea':'nr','set':'nr'})[rawUnit]||rawUnit;
 // Similar words do not establish the same operation or fixture specification.
 if(/disposal|cart\s*away|haul|backfill|downlight|luminaire|light fixture|\bled\b/.test(d))return null;
 if(hasSourceSpecificationScope(d))return sourceSpecificationMetric(d,u,takeoff,specificationFacts);
 // Beam sides and beam undersides are different operations. The latter is
 // already part of slab/beam soffit scope, never an extra beam-side quantity.
 if(/\bformwork\b/.test(d)&&/\bbeams?\b/.test(d)&&/\b(?:soffits?|undersides?|bottoms?)\b/.test(d)&&!/\bslabs?\b/.test(d))return null;
 if(/\bformwork\b/.test(d)){
  const groups=[/\b(?:foundations?|footings?|pedestals?)\b/,/\bcolumns?\b/,/\bbeams?\b/,/\bslabs?\b/].filter(re=>re.test(d));
  const slabBeamSoffit=groups.length===2&&/\bslabs?\b/.test(d)&&/\bbeams?\b/.test(d)&&/\bsoffit\b/.test(d);
  if(groups.length>1&&!slabBeamSoffit)return null;
 }
 // plaster_area is the interior plaster operation. An exterior render or a
 // plaster ceiling must not receive it or compete with an interior wall item.
 // An unspecified plaster location is not enough to select the operation.
 if(/\bplaster(?:ing)?\b/.test(d)&&(!/\b(?:internal|interior)\b/.test(d)||/\b(?:external|exterior|facade|ceiling|render)\b/.test(d)))return null;
 const specific=[
  [/\b(?:ceiling\s+(?:emulsion\s+)?paint|paint(?:ing)?\s+(?:to\s+)?(?:internal\s+)?ceilings?)\b/,'ceiling_paint_area','m2'],
  [/\b(?:wet\s+(?:area|room)s?\s+wall\s+(?:tiles?|tiling)|wall\s+(?:tiles?|tiling)\s+(?:to|in)\s+wet\s+(?:area|room)s?)\b/,'wet_wall_tile_area','m2'],
  [/\bwet\s+(?:area|room)s?\s+wall\s+waterproofing\b/,'wet_wall_waterproofing_area','m2'],
  [/\bwet\s+(?:area|room)s?\s+floor\s+waterproofing\b/,'wet_floor_waterproofing_area','m2'],
  [/\bkitchen\s+backsplash\b/,'backsplash_area','m2'],
  [/\b(?:kitchen\s+base\s+cabinets?|base\s+kitchen\s+cabinets?)\b/,'kitchen_cabinet_length','m'],
 ];
 // Combined wall/floor or floor/ceiling packages need their own measurement
 // rule; they cannot consume only one part of the package by keyword order.
 if(/\b(?:wall|walls)\b/.test(d)&&/\b(?:floor|floors|ceiling|ceilings)\b/.test(d))return null;
 for(const [pattern,key,expected] of specific)if(pattern.test(d))return u===expected?{key,factor:1}:null;
 const operation=pdfCatalogScope(d);
 if(operation){
  const {unit:expected,...metric}=operation;
  if(expected==='kg'&&['ton','tonne','t'].includes(u))return {...metric,factor:.001};
  if(u===expected||expected==='nr'&&['nos','no','number','nr'].includes(u))return {...metric,factor:1};
  return null;
 }
 const rules=[[/blinding/,'pcc_volume','m3'],[/\bexcavation\b/,'excavation_volume','m3'],[/formwork.*found/,'foundation_formwork_area','m2'],[/formwork.*column/,'column_formwork_area','m2'],[/formwork.*beam/,'beam_formwork_area','m2'],[/formwork.*slab/,'slab_formwork_area','m2'],[/reinforcement|reinforcing steel/,'rebar_kg','kg'],[/wood.*floor|parquet/,'wood_floor_area','m2'],[/ceramic.*floor/,'ceramic_floor_area','m2'],[/epoxy.*floor|garage.*epoxy/,'epoxy_floor_area','m2'],[/plaster/,'plaster_area','m2'],[/internal wall.*paint|wall emulsion/,'paint_area','m2'],[/gypsum.*ceiling/,'gypsum_ceiling_area','m2'],[/glazed window|aluminium.*window/,'window_area','m2'],[/water closet|toilet pan/,'toilet_count','nr'],[/wash\s*basin/,'basin_count','nr'],[/shower/,'shower_count','nr'],[/socket/,'socket_count','nr'],[/lighting?\s+point|light\s+point/,'light_count','nr'],[/distribution board/,'distribution_board_count','nr'],[/smoke detector/,'smoke_detector_count','nr']];
 for(const [pattern,key,expected] of rules)if(pattern.test(d)){
  if(expected==='kg'&&['ton','tonne','t'].includes(u))return {key,factor:.001};
  if(u===expected||expected==='nr'&&['nos','no','number','point','nr'].includes(u))return {key,factor:1};
  return null;
 }
 return null;
}
export function pdfScheduledRule(takeoff,description,unit,specificationFacts=undefined){
 const metric=pdfRuleMetric(description,unit,takeoff,specificationFacts);if(!metric)return null;
 const keys=metric.keys||[metric.key],rows=[];let value=0;
 for(const key of keys){
  const claims=takeoff.pdf_analysis?.quantity_evidence?.[key],quantity=takeoff.scheduled_quantities?.[key];
  if(!claims?.length||!valid(quantity)||claims.some(r=>r.key!==key||r.unit!==PDF_METRIC_UNITS[key]||!valid(r.value)||(r.unit==='nr'&&!Number.isInteger(r.value))||!String(r.evidence||'').trim()||!Array.isArray(r.pages)||!r.pages.length))return null;
  if(Math.abs(claims.reduce((n,r)=>n+r.value,0)-quantity)>.001)return null;
  rows.push(...claims);value+=quantity;
 }
 if(!pdfCatalogThicknessMatches(metric,rows)||!pdfCatalogHeightMatches(metric,rows,description))return null;
 const specifications=metric.specificationFacts||[];
 return {quantity:value*metric.factor,metricKey:metric.key,...(metric.keys?{metricKeys:keys}:{}),source:'pdf_schedule_evidence',measured:true,pages:[...new Set([...rows.flatMap(r=>r.pages),...specifications.map(f=>f.page)])],evidence:[...rows.map(r=>r.evidence),...specifications.map(f=>`Source specification p.${f.page}: ${f.quote}`)].join(' | ')};
}
