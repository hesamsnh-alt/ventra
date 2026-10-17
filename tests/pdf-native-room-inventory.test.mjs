import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {auditPdfAreaGeometry} from '../src/lib/pdfAreaGeometry.mjs';
import {pdfCatalogThicknessMatches} from '../src/lib/pdfCatalogScope.mjs';
import {PDF_SOURCE_MEASUREMENT_KEYS} from '../src/lib/pdfSourceMeasurements.mjs';
import {runOfflinePdfCatalog,runOfflinePdfCatalogCheck} from '../tools/check-pdf-rate-catalog.mjs';

// Actual v129 user report: all pages returned, but the first-floor review
// omitted room items and kept only door/window items. No benchmark injected.
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-v129-missing-room-inventory.json','utf8'));
const restore=d=>({...d,...mergePdfEvidence(d.page_results,d.failed_pages,d.total_pages)});

test('actual report recovers source-labelled rooms and all dependent floor and ceiling metrics without changing wall or structural quantities',()=>{
 const before=JSON.stringify(observed),r=restore(observed);
 for(const [key,value]of Object.entries({floor_area:372,ceiling_area:360,wood_floor_area:178,ceramic_floor_area:154,epoxy_floor_area:28,terrace_floor_area:12,ceiling_paint_area:360,gypsum_ceiling_area:312}))assert.equal(r[key],value,key);
 for(const key of ['wall_area','wall_length','foundation_volume','column_volume','beam_volume','window_area'])assert.equal(r[key],observed[key]);
 assert.equal(JSON.stringify(observed),before);
 assert.equal(r.pdf_analysis.area_validation[1].status,'partial_geometry_with_printed_labels');
 assert.equal(r.page_results[1].detected_items.filter(i=>i.unit==='m2').length,11);
 assert.equal(r.pdf_analysis.document_measurement_review.native_source_measurements.issues.length,0);
 assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete'); // Unsupported scope is still unresolved.
 const replay=restore(r);assert.deepEqual(replay.scheduled_quantities,r.scheduled_quantities);
});

test('actual report uses existing catalog rates unchanged and reproduces the precise missing floor-cost difference',async()=>{
 const catalog=JSON.parse(readFileSync('tests/fixtures/pdf-observed-price-catalog.json','utf8')).catalog;
 const prices=catalog.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,
  section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,source_name:i.sourceName,standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate,is_active:true})));
 const before=JSON.stringify(prices),r=await runOfflinePdfCatalog(observed,prices);
 assert.equal(r.boq.summary.provisionalSubtotal,263274.75);assert.equal(r.boq.summary.provisionalSubtotal-226456.75,11858+24960);
 assert.equal(r.boq.items.find(i=>i.itemCode==='FIN-003').quantity,154);
 assert.equal(r.boq.items.find(i=>i.itemCode==='FIN-005').quantity,312);
 assert.equal(r.boq.items.filter(i=>i.quantity>0&&i.rate>0).length,18);
 assert.equal(r.modelCalls,0);assert.equal(r.databaseWrites,0);assert.equal(JSON.stringify(prices),before);
});

test('using a different supplied test rate catalog explains the earlier 517k budget without altering the production catalog',async()=>{
 const r=await runOfflinePdfCatalogCheck(observed,readFileSync('tests/fixtures/pdf-villa02-test-rates.csv','utf8'));
 assert.equal(r.boq.summary.provisionalSubtotal,492535.51);
 assert.equal(Math.round(r.boq.summary.provisionalSubtotal*1.05*100)/100,517162.29);
 assert.equal(r.modelCalls,0);assert.equal(r.databaseWrites,0);
 // The four door rate groups still lack an unambiguous source binding.
 assert.ok(!r.boq.items.some(i=>/^DOR-0[1-4]$/.test(i.itemCode)&&i.quantity>0&&i.rate>0));
});

function differentFloor(width=8,height=6,left=5){
 const rect=(x0,x1)=>[{x:x0,y:0},{x:x1,y:0},{x:x1,y:height},{x:x0,y:height}];
 const span=(text,x,y,angle=0)=>({text,x,y,height:10,angle});
 return {pageNumber:1,page_evidence:{kind:'floor_plan',scope_id:'Ground floor',quantities:[]},detected_items:[],
  area_geometry:{coverage:'partial',basis:'wall_centerline_zones',envelope:rect(0,width),envelope_evidence:`Printed envelope ${width} x ${height} m`,
   spaces:[{tag:'Q71',kind:'enclosed',finish:'tile',polygon:rect(0,left),reported_area:null,evidence:`Printed grid ${left} x ${height}`},
    {tag:'Q84',kind:'enclosed',finish:'wood',polygon:rect(left,width),reported_area:null,evidence:`Printed grid ${width-left} x ${height}`}]},
  native_plan_text:{status:'readable',spans:[span('Q71 Store',40,710),span(`${left*height} m² | TILE`,40,694),span(`Q84 Office | ${(width-left)*height} m2 WOOD`,260,700,Math.PI/2)]}};
}

test('different source tags, dimensions, square-metre symbols and rotated inline labels recover their own room inventory',()=>{
 for(const args of [[8,6,5],[13,4,7]]){
  const p=differentFloor(...args),before=JSON.stringify(p),r=auditPdfAreaGeometry(p);
  assert.equal(r.audit.status,'partial_geometry_with_printed_labels');assert.equal(r.page.floor_area,args[0]*args[1]);
  assert.equal(r.page.ceramic_floor_area,args[2]*args[1]);assert.equal(r.page.wood_floor_area,(args[0]-args[2])*args[1]);
  assert.equal(JSON.stringify(p),before);assert.equal(r.audit.native_inventory_recovery.length,2);
 }
});

test('missing or ambiguous source captions, unsupported text, wrong finishes and overlapping polygons are still withheld',()=>{
 for(const change of [
  p=>p.native_plan_text.status='unsupported',
  p=>p.native_plan_text.spans=p.native_plan_text.spans.filter(s=>!s.text.startsWith('Q71')),
  p=>p.native_plan_text.spans.push({...p.native_plan_text.spans[0]}),
  p=>p.native_plan_text.spans.find(s=>s.text.includes('TILE')).text='30 m2 | EPOXY',
  p=>p.native_plan_text.spans.find(s=>s.text.includes('TILE')).text='30 m2 | TILE | WOOD',
  p=>p.area_geometry.spaces[1].polygon[0].x=4,
 ]){
  const p=differentFloor();change(p);const r=auditPdfAreaGeometry(p);assert.equal(r.audit.status,'withheld');assert.equal(r.page.floor_area,0);
 }
});

test('native label recovery cannot manufacture an omitted polygon or infer an unlabeled area from the envelope remainder',()=>{
 const p=differentFloor();p.area_geometry.spaces.pop();p.native_plan_text.spans[2].text='Q84 Office / WOOD';
 assert.equal(auditPdfAreaGeometry(p).audit.status,'withheld');
 const q=differentFloor();q.native_plan_text.spans[2].text='Q84 Wood storage';
 assert.equal(auditPdfAreaGeometry(q).audit.status,'withheld'); // Room-name wording is not a finish specification.
});

test('source-factor thickness matching accepts thick/explicit slab fields, converts mm and rejects unrelated dimensions',()=>{
 const rows=evidence=>[{evidence}];
 for(const [key,label,value]of [['ground_slab_volume','GF',.15],['first_slab_volume','First',.2],['roof_slab_volume','Roof',.2]]){
  assert.equal(pdfCatalogThicknessMatches({key,sourceThicknessM:value},rows(`* ${value} m [${label} slab: ${value}.]`)),true);
  assert.equal(pdfCatalogThicknessMatches({key,sourceThicknessM:value},rows(`* ${value*1000} mm [Slab thickness]`)),true);
  assert.equal(pdfCatalogThicknessMatches({key,sourceThicknessM:value},rows(`* ${value} m [Envelope width]`)),false);
  assert.equal(pdfCatalogThicknessMatches({key,sourceThicknessM:value+.05},rows(`* ${value} m [Slab thick]`)),false);
 }
 assert.equal(pdfCatalogThicknessMatches({key:'ground_slab_volume',sourceThicknessM:.2},rows('* 0.2 m [First slab: .20.]')),false);
});

test('after local recovery the actual source-request predicate no longer asks for another floor ledger to repair missing ceiling quantities',()=>{
 const code=readFileSync('src/services/pdfSourceMeasurementService.js','utf8');
 const start=code.indexOf('export function needsPdfSourceMeasurements('),end=code.indexOf('export function buildPdfSourceMeasurementPrompt',start);
 const c=vm.createContext({PDF_SOURCE_MEASUREMENT_KEYS});vm.runInContext(code.slice(start,end).replace('export ','')+'\nthis.needs=needsPdfSourceMeasurements;',c);
 assert.equal(c.needs(observed.pdf_analysis),true);assert.equal(c.needs(restore(observed).pdf_analysis),false);
});
