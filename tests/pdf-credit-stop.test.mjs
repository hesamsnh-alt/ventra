import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
const plain=path=>readFileSync(path,'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const silent={log(){},warn(){},error(){}};
function queue(analyzeDrawingPage){
 const sandbox={isPdfCreditBalanceError,analyzeDrawingPage,setTimeout:r=>r(),console:silent};vm.createContext(sandbox);
 vm.runInContext(plain('src/services/pageWorker.js')+'\n'+plain('src/services/queueService.js')+'\nthis.queue=runPageQueue;',sandbox);return sandbox.queue;
}
const pages=Array.from({length:8},(_,index)=>({pageNumber:index+1,bytes:[1]}));
const creditError=()=>Object.assign(Error('429 You have no credits remaining'),{status:429,code:'credit_balance_exhausted',type:'insufficient_quota'});
test('the actual worker and queue stop unsent pages after the first credit failure',async()=>{
 let calls=0;const progress=[],run=queue(async()=>{calls++;throw creditError();});
 const results=await run({pages,concurrency:2,onProgress:event=>progress.push(event)});
 assert.equal(calls,2);assert.equal(results.length,8);assert.equal(results.filter(r=>r.skipped).length,6);
 assert.equal(progress.length,8);assert.ok(results.every(r=>!r.success&&r.status===429&&r.creditUnavailable));
 assert.deepEqual(Array.from(results,r=>r.pageNumber),[1,2,3,4,5,6,7,8]);
});
test('one worker stops immediately; temporary rate limits do not stop the queue',async()=>{
 let calls=0;const results=await queue(async()=>{calls++;throw creditError();})({pages,concurrency:1});assert.equal(calls,1);assert.equal(results.filter(r=>r.skipped).length,7);
 let attempts=new Map();const success=await queue(async({pageNumber})=>{const count=(attempts.get(pageNumber)||0)+1;attempts.set(pageNumber,count);if(count===1)throw Object.assign(Error('rate limit'),{status:429,code:'rate_limit_exceeded'});return {pageNumber};})({pages,concurrency:2});
 assert.ok(success.every(r=>r.success));assert.ok([...attempts.values()].every(n=>n===2));
});
test('successful in-flight pages are retained even when another worker exhausts credits',async()=>{
 let resolveSuccess;const success=new Promise(r=>resolveSuccess=r),run=queue(async({pageNumber})=>{if(pageNumber===1)return success;throw creditError();});
 const pending=run({pages,concurrency:2});await Promise.resolve();await Promise.resolve();resolveSuccess({pageNumber:1,rooms:9});
 const results=await pending;assert.equal(results[0].success,true);assert.equal(results.filter(r=>r.skipped).length,6);
});
test('billing classification does not mistake a transient rate limit for absent credit',()=>{
 assert.equal(isPdfCreditBalanceError({code:'other',type:'insufficient_quota'}),true);
 assert.equal(isPdfCreditBalanceError({error:{code:'credit_balance_exhausted'}}),true);
 assert.equal(isPdfCreditBalanceError({message:'You have no credits remaining'}),true);
 assert.equal(isPdfCreditBalanceError({status:429,code:'rate_limit_exceeded',message:'Please retry after 10 seconds'}),false);
});
function analyzer(results){
 const sandbox={mergePdfEvidence,URL,Uint8Array,process:{env:{}},console:silent,
  buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},
  pdfAnalysisCacheKey:()=> 'test',readPdfAnalysisCache:async()=>null,writePdfAnalysisCache:async()=>true,coalescePdfAnalysis:async(_,work)=>work(),
  fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([1]).buffer}),
  loadPdf:async()=>({pdf:{},totalPages:8}),extractPdfPage:async()=>new Uint8Array([1]),extractPdfPagePacket:async()=>new Uint8Array([1]),
  runPageQueue:async()=>results,reviewPdfDocumentMeasurements:async()=>{throw Error('A missing-credit analysis must not call document review');}};
 vm.createContext(sandbox);vm.runInContext(plain('src/services/largePdfAnalysisService.js')+'\nthis.run=analyzeLargePdf;',sandbox);return sandbox.run;
}
test('no successful pages preserve the original credit error status instead of converting 429 to 500',async()=>{
 const results=pages.map(p=>({success:false,pageNumber:p.pageNumber,error:creditError().message,status:429,code:'credit_balance_exhausted',type:'insufficient_quota',creditUnavailable:true}));
 await assert.rejects(()=>analyzer(results)({fileUrl:'https://source.invalid/drawing.pdf',fileName:'source.pdf'}),e=>e.status===429&&e.code==='credit_balance_exhausted');
});
test('a partial extraction keeps successful evidence and exposes the credit failure without reviewing the document',async()=>{
 const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-8.json','utf8'));
 const results=pages.map(p=>p.pageNumber===1?{success:true,pageNumber:1,result:observed.page_results[0]}:{success:false,pageNumber:p.pageNumber,error:creditError().message,status:429,code:'credit_balance_exhausted',creditUnavailable:true,skipped:p.pageNumber>2});
 const result=await analyzer(results)({fileUrl:'https://source.invalid/drawing.pdf',fileName:'source.pdf'});
 assert.equal(result.analyzed_pages,1);assert.equal(result.failed_pages.length,7);assert.equal(result.pdf_analysis.document_review_status.status,'failed');assert.match(result.pdf_analysis.document_review_status.reason,/no credits/);
});
test('the actual page service disables SDK retry multiplication for PDF upload and response requests',async()=>{
 const options=[],client={files:{create:async(_,o)=>{options.push(o);return {id:'file-mock'};},delete:async()=>{}},responses:{create:async(_,o)=>{options.push(o);return {output_text:'{}'};}}};
 const sandbox={getOpenAIClient:()=>client,buildTakeoffPrompt:()=>'',takeoffSchema:{},parseTakeoffResponse:()=>({rooms:1}),process:{env:{}},File,console:silent};
 vm.createContext(sandbox);vm.runInContext(plain('src/services/pageAnalysisService.js')+'\nthis.run=analyzeDrawingPage;',sandbox);
 await sandbox.run({pageBytes:new Uint8Array([1]),pageNumber:1});assert.equal(options.length,2);assert.ok(options.every(o=>o.maxRetries===0));
});
