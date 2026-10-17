import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mergePdfEvidence,pdfExcludedMetricKeys} from '../src/lib/pdfTakeoffEvidence.mjs';
import {PDF_SOURCE_MEASUREMENT_KEYS} from '../src/lib/pdfSourceMeasurements.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-26.json','utf8'));
test('free-text omissions recognize complete identifiers with explanations and punctuation',()=>{
 assert.deepEqual(pdfExcludedMetricKeys(['internal_block_area (wall ledger unavailable)','wet_wall_area variants: wet_wall_tile_area, wet_wall_waterproofing_area','internal_block_area']),['internal_block_area','wet_wall_area','wet_wall_tile_area','wet_wall_waterproofing_area']);
 assert.deepEqual(pdfExcludedMetricKeys(['not_internal_block_area','internal_block_area_extra','Roof upstand membranes are omitted']),[]);
});
test('observed report 26 exposes omitted operations and activates the existing source-fact continuation',()=>{
 const before=JSON.stringify(observed.page_results),r=mergePdfEvidence(observed.page_results);
 for(const key of ['internal_block_area','plaster_area','paint_area','gypsum_ceiling_area','ceiling_paint_area','wet_wall_tile_area','wet_wall_waterproofing_area','internal_wall_length'])assert.ok(r.pdf_analysis.measurement_completion.unmeasured_metrics.includes(key),key);
 const code=readFileSync('src/services/pdfSourceMeasurementService.js','utf8');
 const fn=code.slice(code.indexOf('export function needsPdfSourceMeasurements('),code.indexOf('export function buildPdfSourceMeasurementPrompt(')).replace('export ','');
 const context={PDF_SOURCE_MEASUREMENT_KEYS};vm.createContext(context);vm.runInContext(fn+'this.needs=needsPdfSourceMeasurements;',context);
 assert.equal(context.needs(r.pdf_analysis),true);
 assert.equal(JSON.stringify(observed.page_results),before);
 assert.equal(r.floor_area,372);assert.equal(r.ceramic_floor_area,154);
 assert.ok(Math.abs(r.external_block_area-305.72)<1e-9);
 assert.equal(r.wall_length,0);assert.equal(r.pdf_analysis.quantity_evidence.wall_length,undefined);
 assert.ok(r.pdf_analysis.withheld_measurement_metrics.includes('wall_length'));
 assert.deepEqual(mergePdfEvidence(r.page_results).pdf_analysis.measurement_completion,r.pdf_analysis.measurement_completion);
});
test('a valid source calculation resolves an explanatory omission without suppressing its own evidence',()=>{
 const p=structuredClone(observed.page_results);
 p[0].document_measurement_review.calculations.push({key:'internal_wall_length',scope_id:'project',evidence:'Source wall schedule total',terms:[{id:'source-complete-partitions',operation:'add',factors:[{value:73,unit:'m',operation:'multiply',pages:[6],evidence:'Explicit complete wall schedule',clip:null}]}]});
 const r=mergePdfEvidence(p);assert.equal(r.internal_wall_length,73);
 assert.ok(!r.pdf_analysis.measurement_completion.unmeasured_metrics.includes('internal_wall_length'));
});
