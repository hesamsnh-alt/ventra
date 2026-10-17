import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {pdfAnalysisCacheKey,readPdfAnalysisCache,writePdfAnalysisCache,coalescePdfAnalysis} from '../src/services/pdfAnalysisCache.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-8.json','utf8'));
const source=readFileSync('src/services/largePdfAnalysisService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const silent={log(){},warn(){},error(){}};
function engine(directory){
 const stats={pages:0,reviews:0,failReview:true,failedPage:null,bytes:[1],prompt:'original',requests:[]};
 const context={needsPdfSourceMeasurements:()=>false,reviewPdfSourceMeasurements:async()=>({status:'not_required'}),mergePdfEvidence,pdfAnalysisCacheKey,coalescePdfAnalysis,URL,process:{env:{OPENAI_DRAWING_MODEL:'gpt-5'}},console:silent,
  buildTakeoffPrompt:()=>stats.prompt,takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},
  readPdfAnalysisCache:key=>readPdfAnalysisCache(key,directory),writePdfAnalysisCache:(key,record)=>writePdfAnalysisCache(key,record,directory),
  fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array(stats.bytes).buffer}),
  loadPdf:async()=>({pdf:{},totalPages:8}),extractPdfPage:async()=>new Uint8Array([1]),extractPdfPagePacket:async()=>new Uint8Array([1]),
  runPageQueue:async({pages,onProgress})=>{stats.pages+=pages.length;stats.requests.push(pages.map(p=>p.pageNumber));const results=[];
   for(const page of pages){const result=page.pageNumber===stats.failedPage?{success:false,pageNumber:page.pageNumber,error:'temporary failure'}:
    {success:true,pageNumber:page.pageNumber,result:structuredClone(observed.page_results.find(p=>p.pageNumber===page.pageNumber))};results.push(result);await onProgress({result});}return results;},
  reviewPdfDocumentMeasurements:async()=>{stats.reviews++;return stats.failReview?{status:'failed',reason:'no credits remaining'}:{status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:{floor_revisions:[],calculations:[],exclusions:[],notes:''}};},Uint8Array};
 vm.createContext(context);vm.runInContext(source+'\nthis.analyze=analyzeLargePdf;',context);
 return {stats,context,analyze:()=>context.analyze({fileUrl:'https://source.invalid/project/drawing.pdf?token=rotates',fileName:'source.pdf'})};
}
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'ventra-cache-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('failed review retry reuses all 8 successful pages; completed repetition calls no model',async t=>{
 const e=engine(await directory(t));const first=await e.analyze();assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,1);assert.equal(first.pdf_analysis.document_review_status.status,'failed');
 e.stats.failReview=false;const second=await e.analyze();assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,2);assert.equal(second.pdf_analysis.document_review_status.status,'completed');
 second.page_results[0].rooms=999;await e.analyze();assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,2);
});
test('reusable evidence survives a fresh server instance; signed URL renewal does not repeat extraction',async t=>{
 const dir=await directory(t),a=engine(dir);a.stats.failReview=false;await a.analyze();
 const b=engine(dir);await b.context.analyze({fileUrl:'https://source.invalid/project/drawing.pdf?token=new',fileName:'source.pdf'});
 assert.equal(b.stats.pages,0);assert.equal(b.stats.reviews,0);
});
test('source-only continuation refuses missing or changed cache before any page or review model work',async t=>{
 const e=engine(await directory(t)),args={fileUrl:'https://source.invalid/project/drawing.pdf?token=rotates',fileName:'source.pdf',resumeSourceMeasurementsOnly:true};
 await assert.rejects(e.context.analyze(args),error=>error.status===409&&error.code==='pdf_resume_cache_required');
 assert.equal(e.stats.pages,0);assert.equal(e.stats.reviews,0);
 e.stats.failReview=false;await e.analyze();await e.context.analyze(args);assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,1);
 e.stats.bytes=[2];await assert.rejects(e.context.analyze(args),error=>error.status===409);assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,1);
});
test('changed PDF bytes, model, prompt or physical source invalidate the saved evidence',async t=>{
 const e=engine(await directory(t));e.stats.failReview=false;await e.analyze();
 e.stats.bytes=[2];await e.analyze();assert.equal(e.stats.pages,16);
 e.context.process.env.OPENAI_DRAWING_MODEL='different-model';await e.analyze();assert.equal(e.stats.pages,24);
 e.stats.prompt='updated extraction';await e.analyze();assert.equal(e.stats.pages,32);
 await e.context.analyze({fileUrl:'https://source.invalid/other-project/drawing.pdf',fileName:'source.pdf'});assert.equal(e.stats.pages,40);
});
test('a failed page retries only that page and delays source review until all pages succeed',async t=>{
 const e=engine(await directory(t));e.stats.failedPage=8;e.stats.failReview=false;await e.analyze();assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,0);
 e.stats.failedPage=null;await e.analyze();assert.equal(e.stats.pages,9);assert.equal(e.stats.reviews,1);assert.deepEqual(Array.from(e.stats.requests[1]),[8]);
});
test('simultaneous requests share one extraction and review, and return independent result objects',async t=>{
 const e=engine(await directory(t));e.stats.failReview=false;const [a,b]=await Promise.all([e.analyze(),e.analyze()]);
 assert.equal(e.stats.pages,8);assert.equal(e.stats.reviews,1);a.page_results[0].rooms=999;assert.notEqual(b.page_results[0].rooms,999);
});
test('corrupt or excessive cache entries are ignored; records are bounded and contain no credential',async t=>{
 const dir=await directory(t),key=pdfAnalysisCacheKey(new Uint8Array([1]),{secret:'not-stored'});
 await writePdfAnalysisCache(key,{pages:[],totalPages:8},dir);assert.ok(!(await readFile(join(dir,key+'.json'),'utf8')).includes('not-stored'));
 await writeFile(join(dir,key+'.json'),'{broken');assert.equal(await readPdfAnalysisCache(key,dir),null);
 for(let i=0;i<14;i++)await writePdfAnalysisCache(pdfAnalysisCacheKey(new Uint8Array([i]),{}),{pages:[],totalPages:8},dir);
 assert.equal((await readdir(dir)).filter(n=>n.endsWith('.json')).length,12);
 assert.equal(await writePdfAnalysisCache(key,{pages:[],notes:'x'.repeat(9*1024*1024)},dir),false);
});
test('empty credit balance is never retried by the page worker; transient failures remain retryable',async()=>{
 const code=readFileSync('src/services/pageWorker.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');let calls=0;
 const s={isPdfCreditBalanceError,analyzeDrawingPage:async()=>{calls++;throw Object.assign(Error('You have no credits remaining'),{status:429,code:'credit_balance_exhausted'});},setTimeout:r=>r()};
 vm.createContext(s);vm.runInContext(code+'\nthis.run=processPage;',s);await s.run({bytes:[1],pageNumber:1});assert.equal(calls,1);
 calls=0;s.analyzeDrawingPage=async()=>{calls++;if(calls<3)throw Object.assign(Error('rate limit'),{status:429});return {pageNumber:1};};assert.equal((await s.run({bytes:[1],pageNumber:1})).success,true);assert.equal(calls,3);
});
test('actual PDF orchestration checkpoints completed review passes and passes them into the next retry',async t=>{
 const e=engine(await directory(t));let reviews=0;
 const firstGroups={structure:{contract:'structure-v1',status:'completed',review:{floor_revisions:[],calculations:[],exclusions:[],notes:''}},surfaces:{contract:'surfaces-v1',status:'failed',reason:'Request timed out.'}};
 e.context.reviewPdfDocumentMeasurements=async({cachedGroups,onGroupComplete})=>{
  reviews++;
  if(reviews===1){await onGroupComplete(firstGroups);return {status:'failed',reason:'surfaces: Request timed out.',source_pages:[1,2,3,4,5,6,7,8],groups:firstGroups,review:firstGroups.structure.review};}
  assert.equal(cachedGroups.structure.status,'completed');assert.equal(cachedGroups.surfaces.status,'failed');
  const groups={...cachedGroups,surfaces:{contract:'surfaces-v1',status:'completed',review:{floor_revisions:[],calculations:[],exclusions:[],notes:''}}};
  await onGroupComplete(groups);return {status:'completed',source_pages:[1,2,3,4,5,6,7,8],groups,review:groups.structure.review};
 };
 const first=await e.analyze();assert.equal(first.pdf_analysis.document_review_status.status,'failed');
 await e.analyze();assert.equal(e.stats.pages,8);assert.equal(reviews,2);
 await e.analyze();assert.equal(e.stats.pages,8);assert.equal(reviews,2);
});
