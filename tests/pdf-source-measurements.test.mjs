import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {PDF_SOURCE_MEASUREMENT_KEYS} from '../src/lib/pdfSourceMeasurements.mjs';
import {PDF_METRIC_UNITS,mergePdfEvidence,normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';
import {nativeOpeningEvidence} from '../src/lib/pdfNativeSchedules.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {pdfAnalysisCacheKey,readPdfAnalysisCache,writePdfAnalysisCache,coalescePdfAnalysis} from '../src/services/pdfAnalysisCache.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-23.json','utf8'));
const facts=JSON.parse(readFileSync('tests/fixtures/pdf-source-measurements.json','utf8'));
function merged(basis=structuredClone(facts)){
 const pages=structuredClone(observed.page_results);pages[0].source_measurement_status={status:'completed',source_pages:[1,2,4,5,6]};pages[0].document_measurement_review.measurement_basis=basis;
 return mergePdfEvidence(pages);
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
test('complete source facts compute the missing operations, retaining the observed page/review data and commercial safety',()=>{
 const r=merged();for(const [key,value] of Object.entries({internal_wall_length:114,external_wall_length:112,wall_length:226,internal_block_area:336.45,external_block_area:305.72,plaster_area:978.62,paint_area:858.38,wet_wall_tile_area:117.24,wet_wall_waterproofing_area:97.92,ceiling_paint_area:360,gypsum_ceiling_area:312}))close(r[key],value);
 assert.equal(r.floor_area,372);assert.equal(r.slab_formwork_area,360);assert.equal(r.rebar_kg,12168.138271604941);
 assert.equal(r.pdf_analysis.document_measurement_review.source_measurements.status,'calculated');
 for(const key of ['internal_block_area','wet_wall_tile_area','paint_area','gypsum_ceiling_area'])assert.ok(!r.pdf_analysis.document_measurement_review.exclusions.includes(key));
 assert.ok(r.pdf_analysis.quantity_evidence.internal_block_area[0].pages.includes(4));assert.ok(r.pdf_analysis.quantity_evidence.ceiling_paint_area[0].pages.includes(6));
 const replay=mergePdfEvidence(r.page_results);close(replay.paint_area,r.paint_area);assert.equal(replay.slab_formwork_area,360);
});
test('changed source heights and finish heights change the computed values rather than retaining benchmark answers',()=>{
 const b=structuredClone(facts);b.floors.forEach(f=>f.walls.forEach(w=>w.height.value=3.5));b.rules.wet_tile_height.value=2.2;b.rules.wet_waterproof_height.value=1.5;
 const r=merged(b);close(r.internal_block_area,370.65);close(r.external_block_area,339.32);close(r.plaster_area,1080.62);close(r.wet_wall_tile_area,107.4);close(r.wet_wall_waterproofing_area,75.12);close(r.paint_area,970.22);
});
test('unknown wall hosts, repeated openings, missing floors and unsupported source dimensions cannot generate complete wall quantities',()=>{
 const changes=[b=>b.floors.pop(),b=>b.floors[0].openings[0].wall_id='unknown',b=>b.floors[0].openings.push(structuredClone(b.floors[0].openings[0])),
  b=>b.floors[0].walls[0].length.pages=[3],b=>b.floors[0].walls[0].length_basis='unavailable',b=>b.floors[0].openings.pop(),b=>b.floors[0].walls_complete=false];
 for(const change of changes){const b=structuredClone(facts);change(b);const r=merged(b);assert.equal(r.internal_block_area,0);assert.equal(r.paint_area,0);assert.ok(r.pdf_analysis.withheld_measurement_metrics.includes('internal_block_area'));}
});
test('partial wet boundaries and unknown gypsum exclusions withhold only dependent groups; source paint exclusions are explicit',()=>{
 const b=structuredClone(facts);b.floors[0].wet_rooms[0].boundary_complete=false;
 const r=merged(b);close(r.internal_block_area,336.45);close(r.plaster_area,978.62);assert.equal(r.wet_wall_tile_area,0);assert.equal(r.paint_area,0);assert.equal(r.gypsum_ceiling_area,312);
 const g=structuredClone(facts);g.floors[1].ceiling_spaces[0].include_gypsum=null;assert.equal(merged(g).gypsum_ceiling_area,0);
 const p=structuredClone(facts);p.rules.paint_excludes_wet_tiles.value=false;p.rules.paint_excludes_backsplash.value=false;close(merged(p).paint_area,978.62);
});
const plain=path=>readFileSync(path,'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
function sourceService(client){
 const context={PDF_SOURCE_MEASUREMENT_KEYS,pdfAnalysisCacheKey,normalizePdfScope,nativeOpeningEvidence,isPdfCreditBalanceError,getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text),structuredClone,Uint8Array,File,process:{env:{}},console:{log(){},warn(){}}};
 const part={...context};vm.createContext(part);vm.runInContext(plain('src/services/pdfPartitionedSourceService.js')+'\nthis.run=reviewPartitionedPdfSource;',part);context.reviewPartitionedPdfSource=part.run;
 vm.createContext(context);vm.runInContext(plain('src/services/pdfSourceMeasurementService.js')+'\nthis.run=reviewPdfSourceMeasurements;this.needs=needsPdfSourceMeasurements;this.schema=pdfSourceMeasurementSchema;',context);return context;
}
test('source extraction uses one bounded request and a focused original-page packet; completed facts are reused without upload or response calls',async()=>{
 let uploads=0,calls=0,deleted=0,indexes;
 const client={files:{create:async()=>{uploads++;return {id:'source'};},delete:async()=>{deleted++;}},responses:{create:async(p,o)=>{calls++;assert.equal(p.model,'gpt-5');assert.equal(p.max_output_tokens,16000);assert.equal(o.maxRetries,0);assert.equal(p.text.format.strict,true);return {status:'completed',output_text:JSON.stringify(facts)};}}};
 const s=sourceService(client),r=mergePdfEvidence(observed.page_results),args={pdf:{},pages:r.page_results,report:r.pdf_analysis,extractPagePacket:async(_,i)=>{indexes=Array.from(i);return new Uint8Array([1]);}};
 assert.equal(s.needs(r.pdf_analysis),true);const first=await s.run(args);assert.equal(first.status,'completed');assert.deepEqual(indexes,[0,1,3,4,5]);
 const second=await s.run({...args,cached:first});assert.equal(second,first);assert.equal(calls,1);assert.equal(uploads,1);assert.equal(deleted,1);
 const changed=structuredClone(args.pages);changed[1].detected_items[0].description+=' | updated local geometry audit';
 const legacy={...first};delete legacy.basis_contract_version;
 await s.run({...args,pages:changed,cached:legacy});assert.equal(calls,1);assert.equal(uploads,1);
 await s.run({...args,cached:{...first,basis_contract_version:999}});assert.equal(calls,2);
});
test('incomplete responses and exhausted credits never import partial JSON or retry a source request',async()=>{
 for(const mode of ['incomplete','credit']){
  let calls=0,deletes=0;const c={files:{create:async()=>({id:'source'}),delete:async()=>deletes++},responses:{create:async()=>{calls++;if(mode==='credit')throw Object.assign(Error('no credits remaining'),{code:'credit_balance_exhausted'});return {status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:JSON.stringify(facts)};}}};
  const s=sourceService(c),r=mergePdfEvidence(observed.page_results),result=await s.run({pdf:{},pages:r.page_results,report:r.pdf_analysis,extractPagePacket:async()=>new Uint8Array([1])});
  assert.equal(result.status,'failed');assert.equal(result.basis,undefined);assert.equal(calls,1);assert.equal(deletes,1);
 }
});
test('a saved output-limit failure prevents another upload, packet extraction or model request, including legacy records',async()=>{
 let packets=0,uploads=0,calls=0,deletes=0;
 const client={files:{create:async()=>{uploads++;return {id:'source'};},delete:async()=>deletes++},responses:{create:async()=>{calls++;return {status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:200,output_tokens:16000,total_tokens:16200}};}}};
 const r=mergePdfEvidence(observed.page_results),args={pdf:{},pages:r.page_results,report:r.pdf_analysis,extractPagePacket:async()=>{packets++;return new Uint8Array([1]);}};
 const first=await sourceService(client).run(args);assert.equal(first.incomplete_reason,'max_output_tokens');assert.equal(first.usage.output_tokens,16000);
 const next=await sourceService(client).run({...args,cached:first});assert.equal(next.status,'failed');assert.equal(next.retry_suppressed,true);assert.equal(next.usage.output_tokens,16000);
 const legacy={status:'failed',source_pages:first.source_pages,reason:first.reason};
 const changed=structuredClone(args.report);changed.measurement_completion.unmeasured_metrics.push('gypsum_ceiling_area');
 const old=await sourceService(client).run({...args,report:changed,cached:legacy});assert.equal(old.retry_suppressed,true);
 assert.equal(packets,1);assert.equal(uploads,1);assert.equal(calls,1);assert.equal(deletes,1);
 // Different packet membership must not inherit a failure from other pages.
 await sourceService(client).run({...args,pages:args.pages.filter(p=>p.pageNumber!==6),cached:first});assert.equal(calls,2);
});
test('client continuation forwards source-only mode with a single network attempt',async()=>{
 const code=readFileSync('src/services/takeoffService.js','utf8'),start=code.indexOf('export async function analyzeProjectDrawing('),end=code.indexOf('export async function getLatestProjectTakeoff(',start);
 const fn=code.slice(start,end).replace('export ','').replace('const { downloadProjectDocument } = await import("@/services/documentService");','');
 let request;const c={downloadProjectDocument:async()=>({url:'https://source.invalid/file.pdf'}),Date,JSON,Error,console:{error(){}},
  submitDrawingAnalysis:async(p)=>{request=JSON.parse(p.body);return {response:{ok:true},payload:{success:true,result:{floor_area:372}}};},commercialFetch:()=>{},saveTakeoffLocally:async()=>{}};
 vm.createContext(c);vm.runInContext(fn+'\nthis.run=analyzeProjectDrawing;',c);
 const r=await c.run({projectId:'p',document:{id:'d',file_path:'f',file_name:'source.pdf',file_type:'application/pdf'},resumeSourceMeasurementsOnly:true});
 assert.equal(r.error,null);assert.equal(request.resumeSourceMeasurementsOnly,true);assert.equal(request.localPdfRecoveryOnly,undefined);
});
test('real PDF orchestration uses bounded source parts and retains every completed part across server instances',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ventra-source-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));let pageCalls=0,baseCalls=0,sourceCalls=0;
 const basePages=structuredClone(observed.page_results),review={status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:basePages[0].document_measurement_review};
 basePages.forEach(p=>{delete p.document_measurement_review;delete p.document_review_status;delete p.source_measurement_status;});
 function engine(){const source=sourceService({files:{create:async()=>({id:'source'}),delete:async()=>{}},responses:{create:async request=>{sourceCalls++;
  let result;if(request.text.format.name==='source_finish_rules')result={rules:{...facts.rules,wall_height:{value:3.2,pages:[6],evidence:'Source wall height'}},ceilings:facts.floors.map(f=>({scope_id:f.scope_id,complete:f.ceilings_complete,spaces:f.ceiling_spaces})),exclusions:[],notes:''};
  else{const f=facts.floors.find(f=>request.input[0].content[0].text.includes('Extract ONLY floor '+normalizePdfScope(f.scope_id)+'.'));
   result={...f,scope_id:normalizePdfScope(f.scope_id),walls:f.walls.map(w=>({id:w.id,classification:w.classification,length_m:w.length.value,height_m:w.height.value,pages:w.length.pages,length_basis:w.length_basis,evidence:w.length.evidence})),openings:f.openings.map(o=>({id:o.id,wall_id:o.wall_id,kind:o.kind,width_m:o.width.value,height_m:o.height.value,sill_m:o.sill.value,pages:o.width.pages,evidence:o.width.evidence})),wet_rooms:f.wet_rooms.map(w=>({id:w.id,boundary_complete:w.boundary_complete,lengths_m:w.boundary_lengths.map(s=>s.value),opening_ids:w.opening_ids,pages:w.boundary_lengths[0].pages,evidence:w.boundary_lengths[0].evidence})),exclusions:[],notes:''};}
  return {status:'completed',output_text:JSON.stringify(result)};}}});
  const c={mergePdfEvidence,pdfAnalysisCacheKey,coalescePdfAnalysis,URL,Uint8Array,process:{env:{}},console:{log(){},warn(){}},buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},
   readPdfAnalysisCache:key=>readPdfAnalysisCache(key,dir),writePdfAnalysisCache:(key,record)=>writePdfAnalysisCache(key,record,dir),fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([1]).buffer}),
   loadPdf:async()=>({pdf:{},totalPages:8}),extractPdfPage:async()=>new Uint8Array([1]),extractPdfPagePacket:async()=>new Uint8Array([1]),
   runPageQueue:async({pages,onProgress})=>{pageCalls+=pages.length;return Promise.all(pages.map(async p=>{const entry={success:true,pageNumber:p.pageNumber,result:basePages[p.pageNumber-1]};await onProgress({result:entry});return entry;}));},
   reviewPdfDocumentMeasurements:async()=>{baseCalls++;return review;},needsPdfSourceMeasurements:source.needs,reviewPdfSourceMeasurements:source.run};
  vm.createContext(c);vm.runInContext(plain('src/services/largePdfAnalysisService.js')+'\nthis.run=analyzeLargePdf;',c);return c;
 }
 const a=engine(),args={fileUrl:'https://source.invalid/project/source.pdf',fileName:'source.pdf'};
 const first=await a.run(args);close(first.paint_area,858.38);assert.equal(pageCalls,8);assert.equal(baseCalls,1);assert.equal(sourceCalls,3);
 const b=engine();const second=await b.run(args);close(second.internal_block_area,336.45);assert.equal(pageCalls,8);assert.equal(baseCalls,1);assert.equal(sourceCalls,3);
 assert.equal(second.pdf_analysis.source_measurement_status.status,'completed');
});
