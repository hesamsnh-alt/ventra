import {createLocalDrawingRegistry} from '../src/lib/localDrawingRegistry.mjs';
import {drawingCheckpointProgress,drawingProgressView} from '../src/lib/drawingProgress.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {drawingJobId,drawingJobHash,completeDrawingResult} from '../src/lib/drawingJobIdentity.mjs';
import {withDrawingJob,currentDrawingJob,drawingOpenAIOptions} from '../src/services/drawingJobRuntime.mjs';
import {readPdfAnalysisCache,writePdfAnalysisCache} from '../src/services/pdfAnalysisCache.mjs';
import {submitDrawingAnalysis} from '../src/lib/drawingAnalysisTransport.mjs';
const actor='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',docid='33333333-3333-4333-8333-333333333333';
const doc={id:docid,project_id:project,file_path:actor+'/'+project+'/immutable.pdf',file_name:'Plan.pdf',file_type:'application/pdf',file_size:500,created_at:'2026-10-18T12:00:00Z'};
function fixture(){
 const jobs=new Map(),documents=new Map([[docid,structuredClone(doc)]]);let identity=actor,role='manager',dispatches=0;
 const db={storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://storage.invalid/private.pdf?token=secret'}})})},from(table){
  const filters=[];let action='select',value;
  const match=row=>filters.every(([key,val])=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]===val:row[key]===val);
  const execute=()=>{
   const map=table==='ventra_preview_jobs'?jobs:table==='project_documents'?documents:table==='projects'?new Map([[project,{id:project,user_id:actor}]]):new Map([['member',{project_id:project,user_id:identity,role}]]);
   if(action==='insert'){if(map.has(value.id))return {error:{code:'23505'},data:null};map.set(value.id,{created_at:new Date().toISOString(),...structuredClone(value)});return {data:null,error:null};}
   const row=[...map.values()].find(match);if(row&&action==='update')Object.assign(row,structuredClone(value));return {data:row?structuredClone(row):null,error:null};
  };
  return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},insert(v){action='insert';value=v;return this;},update(v){action='update';value=v;return this;},maybeSingle:async()=>execute(),then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};
 }};
 const failure=(m,status)=>Object.assign(Error(m),{status});
 const ctx={createLocalDrawingRegistry,drawingCheckpointProgress,drawingProgressView,structuredClone,Buffer,Date,URL,Request,Response,AbortSignal,JSON,Error,console:{warn(){}},process:{env:{URL:'https://deploy.invalid',NETLIFY:'true'}},randomBytes:()=>Buffer.from('a'.repeat(64),'hex'),drawingJobId,drawingJobHash,completeDrawingResult,withDrawingJob,
  billingError:failure,commercialAdmin:()=>db,account:async req=>{if(!req.headers.get('authorization'))throw failure('Sign in',401);return {id:identity};},commercialContext:async()=>({db}),commercialError:e=>Response.json({success:false,error:e.message},{status:e.status||503}),validProjectId:v=>/^[a-f0-9-]{36}$/.test(v||''),fetch:async()=>{dispatches++;return new Response(null,{status:202});}};
 vm.createContext(ctx);vm.runInContext(readFileSync('src/lib/serverDrawingJobs.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.api={startDrawingJob,readDrawingJob,executeDrawingJob,readLocalDrawingJob,runLocalDrawingJob};',ctx);
 const request=(body={},method='POST')=>new Request('https://app.invalid/api/ai/analyze-drawing'+(method==='GET'?'?'+new URLSearchParams({projectId:project,documentId:docid,...body}):''),{method,headers:{authorization:'Bearer user-session','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({projectId:project,documentId:docid,...body})}:{})});
 return {api:ctx.api,jobs,documents,request,db,get dispatches(){return dispatches;},set identity(x){identity=x;},set role(x){role=x;},set dispatch(fn){ctx.fetch=fn;}};
}
const worker=id=>({id,nonce:'a'.repeat(64),authorization:'Bearer user-session'});
test('stable job identity ignores rotating signed URLs / browser request IDs and separates actors, documents and modes',()=>{
 const id=drawingJobId(actor,doc);assert.equal(id,drawingJobId(actor,doc,{fileUrl:'other',requestId:'random'}));assert.notEqual(id,drawingJobId(project,doc));assert.notEqual(id,drawingJobId(actor,{...doc,file_path:'new.pdf'}));assert.notEqual(id,drawingJobId(actor,doc,{localPdfRecoveryOnly:true}));
});
test('offline recovery versions do not change paid job identities or replay old paid work',()=>{
 const legacy=mode=>{const h=drawingJobHash(JSON.stringify([151,actor,doc.project_id,doc.id,doc.file_path,doc.file_size,doc.created_at,'gpt-5',mode.resumeSourceMeasurementsOnly===true,mode.localPdfRecoveryOnly===true]));return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;};
 assert.equal(drawingJobId(actor,doc),legacy({}));assert.equal(drawingJobId(actor,doc,{resumeSourceMeasurementsOnly:true}),legacy({resumeSourceMeasurementsOnly:true}));
 assert.notEqual(drawingJobId(actor,doc,{localPdfRecoveryOnly:true}),legacy({localPdfRecoveryOnly:true}));
});
test('a new offline job inherits the completed source continuation checkpoint without restarting the paid job',async()=>{
 const f=fixture(),base=await(await f.api.startDrawingJob(f.request())).json();
 f.jobs.get(base.jobId).status='failed';f.jobs.get(base.jobId).request_body.__checkpoint={key:'a'.repeat(64),record:{totalPages:13,pages:[{}],review:null}};
 const resumed=await(await f.api.startDrawingJob(f.request({resumeSourceMeasurementsOnly:true}))).json();
 f.jobs.get(resumed.jobId).status='completed';f.jobs.get(resumed.jobId).request_body.__checkpoint={key:'a'.repeat(64),record:{totalPages:13,pages:Array.from({length:13},(_,i)=>({pageNumber:i+1})),review:{status:'completed'},source_basis:{status:'completed'}}};
 const offline=await(await f.api.startDrawingJob(f.request({resumeSourceMeasurementsOnly:true,localPdfRecoveryOnly:true}))).json();
 assert.equal(f.jobs.get(offline.jobId).request_body.__checkpoint.record.pages.length,13);
 assert.equal(f.jobs.get(offline.jobId).request_body.localPdfRecoveryOnly,true);assert.equal(f.jobs.get(base.jobId).status,'failed');
});
test('queue returns 202 without analysis; duplicate submission and two worker deliveries run exactly once',async()=>{
 const f=fixture(),a=await f.api.startDrawingJob(f.request()),body=await a.json();assert.equal(a.status,202);assert.equal(f.dispatches,1);assert.equal(f.jobs.size,1);
 await f.api.startDrawingJob(f.request({fileUrl:'https://attacker.invalid',requestId:'different'}));assert.equal(f.dispatches,1);
 let runs=0;
 await Promise.all([1,2].map(()=>f.api.executeDrawingJob(worker(body.jobId),async request=>{runs++;const b=await request.json();assert.ok(b.fileUrl.startsWith('https://storage.invalid/'));assert.equal(b.noAutomaticRetries,true);assert.equal(b.requestId,body.jobId);return Response.json({success:true,result:{floor_area:42}});})));assert.equal(runs,1);
 const read=await f.api.readDrawingJob(f.request({},'GET')),saved=await read.json();assert.equal(read.status,200);assert.equal(saved.result.floor_area,42);assert.equal(saved.result.analysis_source.document_id,docid);
 assert.ok(!JSON.stringify([...f.jobs.values()]).includes('secret'));assert.ok(!JSON.stringify([...f.jobs.values()]).includes('user-session'));
 await f.api.startDrawingJob(f.request());assert.equal(f.dispatches,1);
});
test('lookup and status recover a completed job without another POST and never expose private checkpoint',async()=>{
 const f=fixture(),body=await (await f.api.startDrawingJob(f.request())).json();
 await f.api.executeDrawingJob(worker(body.jobId),async()=>{await writePdfAnalysisCache('b'.repeat(64),{pages:[{pageNumber:1}],totalPages:1});return Response.json({success:true,result:{floor_area:50}});});
 const stored=[...f.jobs.values()][0];assert.equal(stored.request_body.__checkpoint.record.pages.length,1);
 const text=await (await f.api.readDrawingJob(f.request({},'GET'))).text();assert.ok(!text.includes('__checkpoint'));assert.ok(text.includes('Plan.pdf'));
});
test('invalid nonce, stranger, viewer and deleted source cannot run or recover drawing work',async()=>{
 const f=fixture(),body=await (await f.api.startDrawingJob(f.request())).json();let runs=0;
 await f.api.executeDrawingJob({...worker(body.jobId),nonce:'b'.repeat(64)},async()=>{runs++;});assert.equal(runs,0);
 f.identity=project;f.role='viewer';assert.equal((await f.api.readDrawingJob(f.request({},'GET'))).status,403);assert.equal((await f.api.startDrawingJob(f.request())).status,403);
 f.identity=actor;f.documents.clear();assert.equal((await f.api.readDrawingJob(f.request({},'GET'))).status,404);
});
test('unknown dispatch and failed analysis remain protected from paid replay',async()=>{
 const f=fixture();f.dispatch=async()=>{throw Error('lost dispatch response');};const body=await (await f.api.startDrawingJob(f.request())).json();assert.equal(f.jobs.size,1);
 let runs=0;await f.api.executeDrawingJob(worker(body.jobId),async()=>{runs++;return Response.json({success:false,error:'Upstream timeout'},{status:502});});
 assert.equal((await f.api.startDrawingJob(f.request())).status,502);await f.api.executeDrawingJob(worker(body.jobId),async()=>{runs++;});assert.equal(runs,1);
});
test('partial PDF cannot become a successful published analysis; completed page evidence is retained',async()=>{
 const f=fixture(),body=await (await f.api.startDrawingJob(f.request())).json();await f.api.executeDrawingJob(worker(body.jobId),async()=>Response.json({success:true,result:{total_pages:13,page_results:[{pageNumber:1}],pdf_analysis:{total_pages:13,document_review_status:{status:'pending'}}}}));
 const response=await f.api.readDrawingJob(f.request({},'GET'));assert.equal(response.status,409);assert.equal((await response.json()).code,'DRAWING_JOB_INCOMPLETE');
});
test('durable page cache is scoped to the active job and storage failures halt analysis',async()=>{
 const key='d'.repeat(64);let record;
 await withDrawingJob({read:async()=>record||null,write:async(_,r)=>{record=r;return true;}},async()=>{await writePdfAnalysisCache(key,{totalPages:2,pages:[{pageNumber:1}]});assert.equal((await readPdfAnalysisCache(key)).pages.length,1);});
 await withDrawingJob({write:async()=>{throw Error('storage failed');}},async()=>assert.rejects(writePdfAnalysisCache(key,{pages:[]}),/storage failed/));
 assert.equal(currentDrawingJob(),undefined);assert.equal(drawingOpenAIOptions(),null);
 await withDrawingJob({deadline:Date.now()-1},async()=>{const opts=drawingOpenAIOptions();assert.equal(opts.maxRetries,0);await assert.rejects(opts.fetch('https://must-not-be-called.invalid'),e=>e.code==='DRAWING_WORKER_BUDGET');});
});
test('client polls with authentication, recovers after reload, and retries only safe GETs',async()=>{
 const options={method:'POST',headers:{authorization:'Bearer user','X-Ventra-Request-Id':'attempt'},body:JSON.stringify({projectId:project,documentId:docid})};
 for(const recovered of [false,true]){
  const methods=[];let reads=0;
  const result=await submitDrawingAnalysis(options,async(url,req)=>{methods.push(req.method);assert.ok(req.headers.authorization);if(req.method==='POST')return Response.json({success:true,jobId:'job',status:'queued'},{status:202});reads++;if(reads===1)return Response.json(recovered?{success:true,jobId:'job',status:'running'}:{success:true,status:'not_started'},{status:recovered?202:200});if(reads===2)return new Response('gateway failure',{status:502});if(reads===3)throw TypeError('network unavailable');return Response.json({success:true,jobId:'job',result:{floor_area:77}});},{wait:async()=>{}});
  assert.equal(result.payload.result.floor_area,77);assert.equal(methods.filter(m=>m==='POST').length,recovered?0:1);
 }
});
test('client wait interruption preserves job identity and does not restart a POST',async()=>{
 let posts=0,clock=0;await assert.rejects(submitDrawingAnalysis({headers:{},body:JSON.stringify({projectId:project,documentId:docid})},async()=>Response.json({success:true,jobId:'persisted',status:'running'},{status:202}),{now:()=>clock,wait:async()=>{clock+=10;},maxWaitMs:5}),e=>e.code==='DRAWING_JOB_WAIT_INTERRUPTED'&&e.message.includes('persisted'));assert.equal(posts,0);
});
test('concurrent browser submissions create and dispatch only one job',async()=>{
 const f=fixture();const responses=await Promise.all([f.api.startDrawingJob(f.request()),f.api.startDrawingJob(f.request({requestId:'other-tab'}))]);
 const bodies=await Promise.all(responses.map(r=>r.json()));assert.equal(bodies[0].jobId,bodies[1].jobId);assert.equal(f.jobs.size,1);assert.equal(f.dispatches,1);
});
test('a stale running job reports unknown outcome and cannot start a second worker',async()=>{
 const f=fixture(),body=await (await f.api.startDrawingJob(f.request())).json();const row=f.jobs.get(body.jobId);row.status='running';row.created_at='2026-01-01T00:00:00Z';
 const response=await f.api.readDrawingJob(f.request({},'GET'));assert.equal(response.status,409);assert.equal((await response.json()).code,'DRAWING_JOB_OUTCOME_UNKNOWN');
 assert.equal((await f.api.startDrawingJob(f.request())).status,409);assert.equal(f.dispatches,1);
});
test('background page extraction never retries a failed paid page request',async()=>{
 let calls=0;const c={isPdfCreditBalanceError:()=>false,analyzeDrawingPage:async()=>{calls++;throw Object.assign(Error('Upstream gateway'),{status:502});},setTimeout};
 vm.createContext(c);vm.runInContext(readFileSync('src/services/pageWorker.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=processPage;',c);
 const result=await c.run({pageNumber:1,bytes:[]},{noAutomaticRetries:true});assert.equal(result.success,false);assert.equal(calls,1);
});

test('local authenticated progress is visible during a long request and concurrent submissions cannot run twice',async()=>{
 const f=fixture();let calls=0,release;const gate=new Promise(r=>release=r);
 const run=async()=>{calls++;await currentDrawingJob().progress({stage:'pages',pagesCompleted:2,totalPages:6});await gate;return Response.json({success:true,result:{floor_area:24}});};
 const first=f.api.runLocalDrawingJob(f.request(),run);
 for(let i=0;i<20&&!calls;i++)await new Promise(r=>setImmediate(r));
 const status=await f.api.readLocalDrawingJob(f.request({},'GET'));assert.equal(status.status,202);
 const payload=await status.json();assert.equal(payload.progress.pagesCompleted,2);assert.equal(payload.progress.percent,20);
 const duplicate=await f.api.runLocalDrawingJob(f.request({resumeSourceMeasurementsOnly:true}),run);assert.equal(duplicate.status,202);assert.equal(calls,1);
 f.identity='44444444-4444-4444-8444-444444444444';f.role='viewer';
 assert.equal((await f.api.readLocalDrawingJob(f.request({},'GET'))).status,403);
 f.identity=actor;release();assert.equal((await first).status,200);
 const completed=await f.api.readLocalDrawingJob(f.request({},'GET'));assert.equal(completed.status,200);assert.equal((await completed.json()).result.floor_area,24);
});
