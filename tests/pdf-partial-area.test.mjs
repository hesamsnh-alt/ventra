import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPdfAreaGeometry} from '../src/lib/pdfAreaGeometry.mjs';
import {mergePdfEvidence,pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-partial-area-report.json','utf8'));
const dimensioned=JSON.parse(readFileSync('tests/fixtures/pdf-dimensioned-floors.json','utf8'));
function partial(){
 const p=structuredClone(observed),g=structuredClone(dimensioned[1]);
 g.coverage='partial';g.spaces=g.spaces.filter(r=>r.tag==='F04');p.area_geometry=g;return p;
}
test('missing bath partition dimensions do not discard an independently dimensioned hall',()=>{
 const p=partial(),before=JSON.stringify(p),r=auditPdfAreaGeometry(p);
 assert.equal(r.audit.status,'partial_geometry_with_printed_labels');
 assert.equal(r.page.ceramic_floor_area,46);assert.equal(r.page.floor_area,180);assert.equal(r.page.ceiling_area,168);
 assert.deepEqual(r.audit.dimensioned_tags,['F04']);assert.equal(r.audit.label_only_tags.length,10);
 assert.equal(r.audit.covered_area,24);assert.ok(r.warnings[0].includes('not verified'));
 assert.equal(JSON.stringify(p),before);
});
test('hall geometry corrects a self-consistent but wrong label sum instead of copying it',()=>{
 const p=partial();p.detected_items.find(r=>r.name.startsWith('F04 ')).quantity=20;
 const r=auditPdfAreaGeometry(p);assert.equal(r.page.ceramic_floor_area,46);
 assert.deepEqual(r.audit.corrections.map(({tag,reported,computed})=>({tag,reported,computed})),[{tag:'F04',reported:20,computed:24}]);
 const again=auditPdfAreaGeometry(r.page);assert.equal(again.page.ceramic_floor_area,46);
});
test('mixed evidence retains project floor quantities, scope and provisional measurement basis',()=>{
 const ground={...structuredClone(observed),pageNumber:1,area_geometry:dimensioned[0],page_evidence:{kind:'floor_plan',scope_id:'ground floor',quantities:[]}};
 const r=mergePdfEvidence([ground,partial()]);assert.equal(r.ceramic_floor_area,154);assert.equal(r.floor_area,372);assert.equal(r.ceiling_area,360);
 assert.equal(pdfScheduledRule(r,'Ceramic floor tiles','m2').quantity,154);
 assert.match(r.pdf_analysis.quantity_evidence.ceramic_floor_area.find(q=>q.scope_id==='floor:1').evidence,/Partial dimensioned geometry plus printed room labels/);
 const replay=mergePdfEvidence(r.page_results);assert.equal(replay.ceramic_floor_area,154);
});
test('partial mode cannot authorize an unmeasured inferred hall, duplicates, absent rooms or bad boundaries',()=>{
 for(const mutate of [p=>{p.area_geometry.spaces[0].tag='F05';},p=>{p.detected_items.push(p.detected_items[0]);},p=>{p.detected_items=p.detected_items.filter(r=>!r.name.startsWith('F05 '));},p=>{p.area_geometry.spaces[0].polygon[0].x=-1;},p=>{p.area_geometry.basis='clear_internal';},p=>{p.area_geometry.spaces[0].finish='wood';}]){
  const p=partial();mutate(p);const r=auditPdfAreaGeometry(p);assert.equal(r.audit.status,'withheld');assert.equal(r.page.ceramic_floor_area,0);
 }
});
test('area-only labels without a printed basis and unknown finish remain pending',()=>{
 for(const desc of ['TILE | some room area','UNKNOWN | reported 4 m2']){
  const p=partial();p.detected_items.find(r=>r.name.startsWith('F05 ')).description=desc;
  assert.equal(auditPdfAreaGeometry(p).audit.status,'withheld');
 }
});
test('different dimensions use their own polygons and labels, without fixed benchmark quantities',()=>{
 const p=partial();for(const poly of [p.area_geometry.envelope,...p.area_geometry.spaces.map(r=>r.polygon)])for(const v of poly){v.x*=2;v.y*=1.5;}
 for(const r of p.detected_items)if(r.unit==='m2')r.quantity*=3;
 const a=auditPdfAreaGeometry(p);assert.equal(a.page.ceramic_floor_area,138);assert.equal(a.page.floor_area,540);
});
test('saved null geometry stays unresolved until independent dimensions are actually supplied',()=>{
 const r=mergePdfEvidence([structuredClone(observed)]);assert.equal(r.ceramic_floor_area,0);
 assert.ok(r.pdf_analysis.withheld_area_metrics.includes('ceramic_floor_area'));
});
