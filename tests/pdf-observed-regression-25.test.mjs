import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {auditPdfAreaGeometry} from '../src/lib/pdfAreaGeometry.mjs';
import {planPdfCatalogBindings,retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-25.json','utf8'));
const input=()=>structuredClone(observed.page_results);
test('actual report 25 restores label-only partial areas and accepts valid ceiling source rules without a new model response',()=>{
 const r=mergePdfEvidence(input());
 for(const [key,value] of Object.entries({floor_area:372,ceiling_area:360,wood_floor_area:178,ceramic_floor_area:154,epoxy_floor_area:28,terrace_floor_area:12,slab_formwork_area:360,ceiling_paint_area:360,gypsum_ceiling_area:312}))assert.equal(r[key],value,key);
 assert.equal(r.pdf_analysis.area_validation[1].status,'partial_geometry_with_printed_labels');
 assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete');
 assert.equal(r.pdf_analysis.document_measurement_review.rejected.length,0);
 const second=mergePdfEvidence(r.page_results);assert.equal(second.floor_area,372);assert.equal(second.gypsum_ceiling_area,312);
});
test('an explicitly incomplete source wall ledger suppresses earlier calculated aggregates and catalog pricing',()=>{
 const r=mergePdfEvidence(input());assert.equal(r.external_block_area,0);assert.equal(r.internal_block_area,0);assert.equal(r.external_wall_length,0);
 assert.equal(r.pdf_analysis.quantity_evidence.external_block_area,undefined);
 const candidates=[{item_code:'MAS-003',description:'200mm thick concrete block wall including mortar',unit:'m2'}];
 assert.equal(planPdfCatalogBindings(r,candidates).bindings.size,0);
 assert.ok(!retainUnboundPdfQuantities([],r).items.some(i=>i.pdfEvidence?.metricKey==='external_block_area'));
});
test('empty polygon support requires a consistent explicit label; malformed nonempty geometry still fails',()=>{
 for(const change of [p=>p.area_geometry.spaces[4].reported_area=999,p=>p.area_geometry.spaces[4].evidence='Assumed area',p=>p.detected_items[4].description='TILE; inferred remainder',p=>p.area_geometry.spaces[4].polygon=[{x:0,y:0},{x:1,y:1}],p=>p.area_geometry.coverage='complete']){
  const p=input()[1];change(p);assert.equal(auditPdfAreaGeometry(p).audit.status,'withheld');
 }
});
test('alternate sourced soffit identities use their own dimensions and never a fixed recovered quantity',()=>{
 const p=input();const c=p[0].document_measurement_review.calculations.find(c=>c.key==='slab_formwork_area');
 for(const t of c.terms)if(t.id.endsWith('_gross')){t.factors[0].value=20;t.factors[1].value=15;}
 assert.equal(mergePdfEvidence(p).slab_formwork_area,576);
});
