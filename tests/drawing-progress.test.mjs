import test from 'node:test';
import assert from 'node:assert/strict';
import {drawingCheckpointProgress,drawingProgressView,drawingProgressPercent} from '../src/lib/drawingProgress.mjs';
import {createLocalDrawingRegistry} from '../src/lib/localDrawingRegistry.mjs';
import {submitDrawingAnalysis} from '../src/lib/drawingAnalysisTransport.mjs';
import {readDrawingProgress,updateDrawingProgress,subscribeDrawingProgress} from '../src/lib/drawingProgressSession.mjs';
import {withDrawingJob,reportDrawingProgress} from '../src/services/drawingJobRuntime.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writePdfAnalysisCache,readPdfAnalysisCache} from '../src/services/pdfAnalysisCache.mjs';
const options={method:'POST',headers:{'X-Ventra-Request-Id':'progress-test'},body:JSON.stringify({projectId:'p',documentId:'d'})};
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
test('all pages completed is only 60%, review/source counts are real, and 100% requires explicit completion',()=>{
 let p=drawingProgressView({}, {stage:'pages',totalPages:13,pagesCompleted:13,status:'running'});
 assert.equal(p.percent,60);
 p=drawingProgressView(p,{stage:'cross_page_review',reviewCompleted:2,reviewTotal:4});assert.equal(p.percent,72);
 p=drawingProgressView(p,{stage:'source_measurements',sourceCompleted:1,sourceTotal:3});assert.equal(p.percent,88);
 p=drawingProgressView(p,{stage:'finalizing'});assert.equal(p.percent,95);
 assert.equal(drawingProgressView(p,{status:'completed'}).percent,100);
 assert.equal(drawingProgressPercent({stage:'analyzing'}),null);
 assert.equal(drawingProgressPercent({stage:'pages'}),null);
 assert.equal(drawingProgressView({percent:75},{stage:'pages',pagesCompleted:1,totalPages:10}).percent,75);
});
test('page checkpoints count unique source pages and retain completed review/measurement parts',()=>{
 const p=drawingCheckpointProgress({totalPages:4,pages:[{pageNumber:1},{pageNumber:1},{pageNumber:2}],review_total:5,review_groups:{a:{status:'completed'},b:{status:'failed'}},source_basis:{parts:[{status:'completed'},{status:'pending'}]}});
 assert.equal(p.pagesCompleted,2);assert.equal(p.reviewCompleted,1);assert.equal(p.reviewTotal,5);assert.equal(p.sourceCompleted,1);assert.equal(p.sourceTotal,2);
});
test('local progress contexts retain the real file cache rather than replacing it with a job checkpoint backend',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ventra-progress-')),events=[],key='b'.repeat(64);
 try{
  await withDrawingJob({progress:p=>events.push(p)},async()=>{await writePdfAnalysisCache(key,{totalPages:3,pages:[{pageNumber:1}]},directory);assert.equal((await readPdfAnalysisCache(key,directory)).totalPages,3);});
  assert.equal(events.length,1);assert.equal(events[0].pagesCompleted,1);
  assert.ok((await readFile(join(directory,key+'.json'),'utf8')).includes('111'));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('local registry coalesces concurrent modes, protects unknown outcomes, and permits explicit retry after a definite failure',()=>{
 let now=1000;const registry=createLocalDrawingRegistry({now:()=>now});
 const first=registry.claim('one','d','plan.pdf','source');assert.equal(first.claimed,true);
 assert.equal(registry.claim('other-mode','d','plan.pdf','source').claimed,false);
 registry.update(first.job,{stage:'pages',pagesCompleted:2,totalPages:5});assert.equal(registry.get('one').progress.pagesCompleted,2);
 registry.finish(first.job,{success:false,code:'DRAWING_JOB_INCOMPLETE'},409);
 assert.equal(registry.claim('one','d','plan.pdf','source').claimed,true);
 const current=registry.get('one');registry.finish(current,{success:false,code:'DRAWING_ANALYSIS_OUTCOME_UNKNOWN'},503);
 assert.equal(registry.claim('one','d','plan.pdf','source').claimed,false);
 now+=31*60*1000;assert.equal(registry.get('one'),null);
});
test('long synchronous POST is monitored by GETs; telemetry never creates another paid POST',async()=>{
 let posts=0,statusReads=0,release,observed=[];const gate=new Promise(r=>release=r);
 const fetcher=async(_,r)=>{
  if(r.method==='POST'){posts++;await gate;return Response.json({success:true,result:{ok:true}});}
  statusReads++;return statusReads===1?Response.json({success:true,status:'not_started'}):Response.json({success:true,jobId:'job',status:'running',progress:{stage:'pages',pagesCompleted:3,totalPages:9}},{status:202});
 };
 const pending=submitDrawingAnalysis(options,fetcher,{monitorDelayMs:2,onProgress:p=>{observed.push(p);release();}});
 const out=await pending;assert.equal(out.payload.success,true);assert.equal(posts,1);assert.ok(statusReads>=2);assert.equal(observed[0].progress.pagesCompleted,3);
});
test('reload with a pending marker recovers the same job and original mode via GET only',async()=>{
 const s=storage();s.setItem('ventra:drawing-pending:p:d',JSON.stringify({startedAt:100,documentId:'d',resumeSourceMeasurementsOnly:true}));
 const methods=[];
 const result=await submitDrawingAnalysis(options,async(url,r)=>{methods.push(r.method);assert.ok(url.includes('resumeSourceMeasurementsOnly=true'));return Response.json({success:true,jobId:'same-job',result:{done:true}});},{resumeOnly:true,storage:s});
 assert.deepEqual(methods,['GET']);assert.equal(result.payload.result.done,true);assert.equal(s.values.size,0);
});
test('missing reload job or lost POST retains the marker and never silently starts a full analysis',async()=>{
 for(const resume of [false,true]){
  const s=storage();if(resume)s.setItem('ventra:drawing-pending:p:d',JSON.stringify({startedAt:1}));
  let posts=0;
  await assert.rejects(submitDrawingAnalysis(options,async(_,r)=>{if(r.method==='GET')return Response.json({success:true,status:'not_started'});posts++;throw Error('offline');},{storage:s,resumeOnly:resume}),e=>/OUTCOME_UNKNOWN|LOOKUP_LOST/.test(e.code));
  assert.equal(posts,resume?0:1);assert.equal(s.values.size,1);
 }
});
test('changing workspace tabs preserves progress subscribers and a new run resets completed percentage',()=>{
 const events=[],off=subscribeDrawingProgress('progress-project',p=>events.push(p));
 updateDrawingProgress('progress-project',{status:'completed',stage:'completed'});assert.equal(readDrawingProgress('progress-project').percent,100);
 updateDrawingProgress('progress-project',{reset:true,status:'running',stage:'pages',totalPages:2,pagesCompleted:1});
 assert.equal(readDrawingProgress('progress-project').percent,30);assert.equal(events.length,2);off();
});
