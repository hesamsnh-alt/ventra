import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcilePdfSoffitCoverage} from '../src/lib/pdfMeasurementCalculations.mjs';
import {PDF_METRIC_UNITS,mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-23.json','utf8'));
function calculation(){return structuredClone(observed.page_results[0].document_measurement_review.calculations.find(c=>c.key==='slab_formwork_area'));}
const pages=new Set([1,2,3,4,5,6,7,8]);
test('saved report 23 recomputes soffit coverage from original operands, retains provenance, and remains an incomplete BOQ',()=>{
 const merged=mergePdfEvidence(structuredClone(observed.page_results));
 assert.equal(merged.slab_formwork_area,360);assert.equal(merged.beam_formwork_area,118.5);assert.equal(merged.foundation_formwork_area,75.6);
 assert.equal(merged.pdf_analysis.document_measurement_review.adjustments.length,1);
 assert.equal(merged.pdf_analysis.document_measurement_review.rejected.length,0);
 assert.equal(merged.pdf_analysis.measurement_completion.status,'incomplete');
 assert.ok(merged.pdf_analysis.measurement_completion.unmeasured_metrics.includes('external_block_area'));
 assert.ok(merged.pdf_analysis.measurement_completion.unmeasured_metrics.includes('wet_wall_tile_area'));
 assert.ok(!merged.pdf_analysis.measurement_completion.unmeasured_metrics.includes('rooms'));
 const evidence=merged.pdf_analysis.quantity_evidence.slab_formwork_area[0];assert.match(evidence.evidence,/Coverage reconciliation/);assert.deepEqual(evidence.pages,[3,6]);
 const rows=retainUnboundPdfQuantities([],merged).items;assert.equal(rows.find(r=>r.pdfEvidence.metricKey==='slab_formwork_area').quantity,360);
 assert.equal(rows.find(r=>r.pdfEvidence.metricKey==='slab_formwork_area').rate,0);
 const replay=mergePdfEvidence(merged.page_results);assert.equal(replay.slab_formwork_area,360);assert.equal(replay.pdf_analysis.document_measurement_review.adjustments.length,1);
});
test('canonical soffit formula varies with sourced dimensions and has no project total in production code',()=>{
 const c=calculation();for(const t of c.terms)if(t.id.endsWith('_gross')){t.factors[0].value=20;t.factors[1].value=15;}
 c.terms.find(t=>t.id==='ff_beam_soffits').factors[0].value=80;
 const input=structuredClone(observed.page_results);input[0].document_measurement_review.calculations=[c];
 const merged=mergePdfEvidence(input);assert.equal(merged.slab_formwork_area,576);
 assert.deepEqual(c.terms.map(t=>t.id),calculation().terms.map(t=>t.id));
});
test('unmatched scope, unknown deduction, excessive overlapping strips, duplicate identities and bad provenance cannot be repaired silently',()=>{
 const cases=[c=>c.terms[4].id='other_beam_soffits',c=>c.terms[1].id='ff_slab_arbitrary_deduction',c=>c.terms[4].factors[0].value=100000,
  c=>c.terms.push(structuredClone(c.terms[4])),c=>c.terms[5].factors[0].pages=[99],c=>c.terms[0].factors[0].evidence='Unclear dimension'];
 for(const change of cases){const c=calculation();change(c);assert.throws(()=>reconcilePdfSoffitCoverage(c,'',PDF_METRIC_UNITS,pages));}
});
test('reconciliation does not discard separately measured beam soffits when an included-within-slab convention is absent',()=>{
 const c=calculation();c.evidence='Independent soffit schedule with separate beam undersides';
 const r=reconcilePdfSoffitCoverage(c,'',PDF_METRIC_UNITS,pages);assert.equal(r.calculation,c);assert.equal(r.adjustment,null);
});
