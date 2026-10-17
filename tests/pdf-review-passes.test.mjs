import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {PDF_METRIC_UNITS,mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-19.json','utf8'));
const silent={log(){},warn(){},error(){}};
function service(client){
 const schema=readFileSync('src/services/takeoffSchema.js','utf8').replace(/^import[^\n]*\n/,'').replace('export const takeoffSchema','const takeoffSchema');
 const source=readFileSync('src/services/pdfDocumentReviewService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
 const sandbox={PDF_METRIC_UNITS,pdfAnalysisCacheKey,isPdfCreditBalanceError,structuredClone,Uint8Array,getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text),File,console:silent,process:{env:{}}};
 vm.createContext(sandbox);vm.runInContext(schema+'\n'+source+'\nthis.run=reviewPdfDocumentMeasurements;this.passes=pdfMeasurementReviewPasses;this.passSchema=scopedPdfReviewSchema;',sandbox);return sandbox;
}
const factor=(value,unit,pages,evidence)=>({value,unit,pages,evidence,operation:'multiply',clip:null});
function beamCalculation(lengths=[120,117]){return {key:'beam_formwork_area',scope_id:'project',evidence:'Source declares beam sides only; slab soffit includes beam undersides',terms:lengths.map((length,i)=>({id:'beam-sides-'+i,operation:'add',factors:[factor(length,'m',[3],'Printed beam length'),factor(.25,'m',[3],'Printed downstand depth'),factor(2,'count',[6],'Only two downstand sides; do not duplicate slab soffit')]}))};}
function client(failures={},calculation=beamCalculation()){
 const stats={calls:[],uploads:0,deletes:0,maxActive:0,active:0};
 return {stats,files:{create:async()=>{stats.uploads++;return {id:'source-file'};},delete:async()=>{stats.deletes++;}},responses:{create:async(payload,options)=>{
  const id=payload.text.format.name.replace('construction_measurement_','');stats.calls.push(id);stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);
  await Promise.resolve();stats.active--;assert.equal(options.maxRetries,0);
  if(failures[id])throw failures[id];
  const result={exclusions:[],notes:'Source extraction remains provisional'};
  if(id==='geometry')result.floor_revisions=[];else result.calculations=id==='structure'?[calculation]:[];
  return {output_text:JSON.stringify(result)};
 }}};
}
function args(){return {pdf:{},pages:structuredClone(observed.page_results),audit:mergePdfEvidence(observed.page_results).pdf_analysis,extractPagePacket:async()=>new Uint8Array([1])};}
test('operation families partition metrics without any arithmetic bypass of floor geometry',()=>{
 const s=service({}),passes=s.passes({}),keys=passes.flatMap(p=>Array.from(p.keys));
 assert.equal(passes.length,3);assert.equal(new Set(keys).size,keys.length);assert.ok(!keys.includes('floor_area'));assert.ok(keys.includes('beam_formwork_area'));assert.ok(keys.includes('plaster_area'));
 for(const p of passes){const schema=s.passSchema(p);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.floor_revisions,undefined);assert.deepEqual(Array.from(schema.properties.calculations.items.properties.key.enum),Array.from(p.keys));}
 const blocked=s.passes({withheld_area_metrics:['floor_area']});assert.equal(blocked[0].id,'geometry');assert.equal(s.passSchema(blocked[0]).properties.calculations,undefined);
});
test('one timed-out pass retains successful corrections from the actual observed report; retry submits only that pass',async()=>{
 const failures={surfaces:Error('Request timed out.')},c=client(failures),s=service(c),snapshots=[];
 const first=await s.run({...args(),onGroupComplete:groups=>snapshots.push(groups)});assert.equal(first.status,'failed');assert.equal(first.passes.find(p=>p.id==='surfaces').status,'failed');assert.ok(first.review.calculations.length);
 const pages=structuredClone(observed.page_results);pages[0].document_measurement_review=first.review;pages[0].document_review_status={status:first.status,source_pages:first.source_pages};
 const merged=mergePdfEvidence(pages);assert.equal(merged.beam_formwork_area,118.5);assert.equal(merged.floor_area,372);assert.ok(c.stats.maxActive<=2);assert.equal(c.stats.uploads,1);assert.equal(c.stats.deletes,1);assert.ok(snapshots.some(g=>g.structure?.status==='completed'));
 delete failures.surfaces;const second=await s.run({...args(),cachedGroups:first.groups});assert.equal(second.status,'completed');assert.deepEqual(c.stats.calls.slice(3),['surfaces']);
 const third=await s.run({...args(),cachedGroups:second.groups});assert.equal(third.status,'completed');assert.equal(c.stats.calls.length,4);assert.equal(c.stats.uploads,2);
});
test('source lengths vary without project-specific answers in the review orchestration',async()=>{
 const c=client({},beamCalculation([80,95])),s=service(c),r=await s.run(args()),pages=structuredClone(observed.page_results);
 pages[0].document_measurement_review=r.review;pages[0].document_review_status={status:r.status,source_pages:r.source_pages};assert.equal(mergePdfEvidence(pages).beam_formwork_area,87.5);
});
test('exhausted credits stop unsent review passes while preserving independent successful passes',async()=>{
 const c=client({structure:Object.assign(Error('no credits remaining'),{code:'credit_balance_exhausted',status:429})}),s=service(c),r=await s.run(args());
 assert.equal(r.status,'failed');assert.ok(c.stats.calls.length<=2);assert.ok(!c.stats.calls.includes('inventory'));assert.equal(c.stats.deletes,1);
});
test('a calculation returned under the wrong operation family is rejected rather than silently merged',async()=>{
 const c=client({}, {...beamCalculation(),key:'plaster_area'}),s=service(c),r=await s.run(args());
 assert.equal(r.groups.structure.status,'failed');assert.match(r.groups.structure.reason,/outside requested operation family/);assert.ok(!r.review.calculations.some(c=>c.key==='plaster_area'));
});
test('changing the review contract does not reuse a completed pass with a mismatched fingerprint',async()=>{
 const c=client(),s=service(c),first=await s.run(args());first.groups.structure.contract='outdated';
 await s.run({...args(),cachedGroups:first.groups});assert.deepEqual(c.stats.calls.slice(3),['structure']);
});
