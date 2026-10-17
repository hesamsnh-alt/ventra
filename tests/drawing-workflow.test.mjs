import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,subscribeDrawingWorkflow} from '../src/lib/drawingWorkflowGate.mjs';
const center=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8');
const boq=readFileSync('src/app/projects/[id]/ProjectBOQ.jsx','utf8');
const segment=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const gates={beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,subscribeDrawingWorkflow};
let sequence=0;
function setup(){
  let resolveAnalysis,resolveSave;
  const pending=new Promise(r=>resolveAnalysis=r),saving=new Promise(r=>resolveSave=r);
  const state={...gates,projectId:`workflow-test-${++sequence}`,analyzing:false,generatingBoq:false,
    documents:[{id:'pdf',file_name:'source.pdf'}],selectedDocumentId:'pdf',AI_SUPPORTED_EXTENSIONS:['pdf'],APS_SUPPORTED_EXTENSIONS:['dwg'],
    getFileExtension:()=> 'pdf',selectDrawingDocument(){},analysisRunIdRef:{current:null},setAnalysisRunId(){},crypto:{randomUUID:()=> 'new-run'},
    analysisInFlightRef:{current:false},takeoffResult:{document_id:'old',rooms:1,floor_area:17},takeoffResultRef:{current:{document_id:'old'}},
    console:{log(){},warn(){},error(){}},clearMessages(){},messages:[],errors:[],apiCalls:0,persistCalls:0,boqCalls:[],
    analyzeProjectDrawing:async()=>{state.apiCalls++;return pending;},persistTakeoff:async()=>{state.persistCalls++;return saving;},
    setAnalyzing:v=>state.analyzing=v,setGeneratingBoq:v=>state.generatingBoq=v,setTakeoffResult:v=>state.takeoffResult=v,
    setSelectedDocumentId:v=>state.selectedDocumentId=v,setMessage:v=>state.messages.push(v),setErrorMessage:v=>state.errors.push(v),
    commercialFetch:async(url,options)=>{state.boqCalls.push(JSON.parse(options.body));return {ok:true,text:async()=>JSON.stringify({success:true,boq:{items:[]}})};},
    importAiBoq(){},localStorage:{setItem(){}},onOpenBoq(){},
  };
  vm.createContext(state);
  vm.runInContext(segment(center,'  async function handleAnalyzeDrawing()','  async function handleDownload(')+'\n'+
    segment(center,' async function handleGenerateBoq()','  const aiTools =')+'\nthis.analyze=handleAnalyzeDrawing;this.generate=handleGenerateBoq;',state);
  return {state,resolveAnalysis,resolveSave};
}
test('pending PDF analysis removes the old visible result and blocks BOQ until persistence completes',async()=>{
  const {state:s,resolveAnalysis,resolveSave}=setup();
  const work=s.analyze();assert.equal(s.apiCalls,1);assert.equal(s.takeoffResult,null);assert.equal(s.takeoffResultRef.current,null);
  await s.generate();assert.equal(s.boqCalls.length,0);
  const newer={document_id:'new',floor_area:300,rooms:0,pdf_analysis:{measurement_review_version:1,document_review_status:{status:'completed'}},
    page_results:[{pageNumber:1,document_measurement_review:{calculations:[]}}],scheduled_quantities:{floor_area:300},raw_result:{large:'redundant'}};
  resolveAnalysis({takeoff:newer,error:null});await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(s.persistCalls,1);assert.equal(drawingWorkflowState(s.projectId).active,'analysis');
  await s.generate();assert.equal(s.boqCalls.length,0);
  resolveSave();await work;
  assert.equal(s.analyzing,false);assert.equal(drawingWorkflowState(s.projectId).active,null);
  await s.generate();assert.equal(s.boqCalls.length,1);
  assert.equal(s.boqCalls[0].takeoff.document_id,'new');assert.equal(s.boqCalls[0].takeoff.floor_area,300);
  assert.equal(s.boqCalls[0].takeoff.page_results.length,1);assert.equal(s.boqCalls[0].takeoff.pdf_analysis.document_review_status.status,'completed');
  assert.equal(s.boqCalls[0].takeoff.raw_result,undefined);
});
test('failed analysis retains no stale visible result, makes no BOQ request and does not overwrite saved data',async()=>{
  const {state:s,resolveAnalysis}=setup(),work=s.analyze();
  resolveAnalysis({takeoff:null,error:new Error('credit_balance_exhausted')});await work;
  assert.equal(s.takeoffResult,null);assert.equal(s.persistCalls,0);assert.equal(s.analyzing,false);
  assert.equal(s.analysisInFlightRef.current,false);assert.equal(drawingWorkflowState(s.projectId).analysisFailed,true);
  s.takeoffResult={document_id:'old',floor_area:17};await s.generate();assert.equal(s.boqCalls.length,0);
  assert.ok(s.errors.some(e=>e.includes('credit_balance_exhausted')));
});
test('a failed or pending PDF document review saves partial evidence without reporting full success',async()=>{
  for (const status of ['failed','pending']) {
    const {state:s,resolveAnalysis,resolveSave}=setup(),work=s.analyze();
    resolveAnalysis({takeoff:{floor_area:372,rooms:19,pdf_analysis:{document_review_status:{status,reason:'Source review unavailable'}}},error:null});
    resolveSave();await work;
    assert.equal(s.persistCalls,1);assert.equal(s.takeoffResult.floor_area,372);
    assert.ok(s.messages.some(m=>m.includes('review is incomplete')));
    assert.ok(s.errors.some(m=>m.includes(status)&&m.includes('BOQ is incomplete')));
    assert.ok(!s.messages.some(m=>m.includes('completed successfully')));
    assert.equal(drawingWorkflowState(s.projectId).active,null);
  }
});
test('same-tick duplicate Analyze and cross-tab generation cannot start another request',async()=>{
  const {state:s,resolveAnalysis}=setup(),work=s.analyze();
  await s.analyze();assert.equal(s.apiCalls,1);
  assert.equal(beginDrawingWorkflow(s.projectId,'boq'),null);
  assert.equal(beginDrawingWorkflow(s.projectId,'analysis'),null);
  resolveAnalysis({takeoff:null,error:new Error('failed')});await work;
});
test('completed PDF requests with missing measured operations do not display a full-success message',async()=>{
  const {state:s,resolveAnalysis,resolveSave}=setup(),work=s.analyze();
  resolveAnalysis({takeoff:{floor_area:372,pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete',unmeasured_metrics:['plaster_area']}}},error:null});
  resolveSave();await work;
  assert.ok(s.messages.some(m=>m.includes('Measured quantities are incomplete')));
  assert.ok(s.errors.some(m=>m.includes('source quantities are missing')));
  assert.ok(!s.messages.some(m=>m.includes('completed successfully')));
});
test('continuing the same completed but incomplete PDF opts into source-only mode before clearing the visible result',async()=>{
 const {state:s}=setup();let request;
 s.takeoffResultRef.current={document_id:'pdf',pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete'}}};
 s.analyzeProjectDrawing=async args=>{request=args;return {takeoff:null,error:Error('Stopped before paid calls')};};
 await s.analyze();assert.equal(request.resumeSourceMeasurementsOnly,true);
 const {state:other}=setup();other.takeoffResultRef.current={document_id:'different',pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete'}}};
 other.analyzeProjectDrawing=async args=>{request=args;return {takeoff:null,error:Error('stopped')};};await other.analyze();assert.equal(request.resumeSourceMeasurementsOnly,false);
});
test('uploading a same-named PDF again still uses the guarded continuation instead of silently starting full page analysis',async()=>{
 const {state:s}=setup();let request;
 s.takeoffResultRef.current={document_id:'older-upload',document_name:'source.pdf',pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete'}}};
 s.analyzeProjectDrawing=async args=>{request=args;return {takeoff:null,error:Error('Guarded cache check')};};
 await s.analyze();assert.equal(request.resumeSourceMeasurementsOnly,true);
});
test('a saved failed or partial source pass selects model-disabled native recovery before the visible result is cleared',async()=>{
 for(const status of ['failed','partial']){
  const {state:s}=setup();let request;
  s.takeoffResultRef.current={document_id:'pdf',pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete'},source_measurement_status:{status}}};
  s.analyzeProjectDrawing=async args=>{request=args;return {takeoff:null,error:Error('Stopped after inspecting request')};};
  await s.analyze();assert.equal(request.localPdfRecoveryOnly,true);assert.equal(request.resumeSourceMeasurementsOnly,true);
 }
});
test('a failed retry recovers saved PDF context instead of starting a full paid page pass',async()=>{
 const {state:s}=setup();const requests=[];
 const saved={document_id:'pdf',pdf_analysis:{document_review_status:{status:'completed'},measurement_completion:{status:'incomplete'},source_measurement_status:{status:'failed'}}};
 s.takeoffResultRef.current=saved;
 s.getLatestProjectTakeoff=async()=>({takeoff:saved,error:null});
 s.analyzeProjectDrawing=async args=>{requests.push(args);return {takeoff:null,error:Error('Connection lost')};};
 await s.analyze();assert.equal(s.takeoffResultRef.current,null);
 await s.analyze();assert.equal(requests.length,2);
 assert.ok(requests.every(r=>r.resumeSourceMeasurementsOnly===true && r.localPdfRecoveryOnly===true));
 assert.equal(s.takeoffResult,null);assert.equal(s.persistCalls,0);
 assert.equal(drawingWorkflowState(s.projectId).analysisFailed,true);
 await s.generate();assert.equal(s.boqCalls.length,0);
});
test('saved PDF evidence read failure stops before submitting another analysis',async()=>{
 const {state:s}=setup();s.takeoffResultRef.current=null;
 s.getLatestProjectTakeoff=async()=>({takeoff:null,error:Error('Storage unavailable')});
 await s.analyze();assert.equal(s.apiCalls,0);assert.equal(s.persistCalls,0);
 assert.ok(s.errors.includes('Storage unavailable'));
});
test('different projects do not block each other; stale completions cannot release a newer operation',()=>{
  const a=`project-a-${++sequence}`,b=`project-b-${++sequence}`;
  const first=beginDrawingWorkflow(a,'analysis'),other=beginDrawingWorkflow(b,'boq');
  assert.ok(first&&other);finishDrawingWorkflow(a,first,true);
  const next=beginDrawingWorkflow(a,'analysis');finishDrawingWorkflow(a,first,true);
  assert.equal(drawingWorkflowState(a).active,'analysis');
  finishDrawingWorkflow(a,next,true);finishDrawingWorkflow(b,other,true);
});
test('failed analysis blocks a cached BOQ until a successful analysis, and subscribers follow tab changes',()=>{
  const p=`subscriber-${++sequence}`,changes=[],unsubscribe=subscribeDrawingWorkflow(p,s=>changes.push({...s}));
  const first=beginDrawingWorkflow(p,'analysis');finishDrawingWorkflow(p,first,false);
  assert.equal(beginDrawingWorkflow(p,'boq'),null);
  const retry=beginDrawingWorkflow(p,'analysis');finishDrawingWorkflow(p,retry,true);
  const quote=beginDrawingWorkflow(p,'boq');assert.ok(quote);finishDrawingWorkflow(p,quote,true);
  assert.equal(changes.length,6);unsubscribe();
});
test('BOQ tab checks current shared state before loading cached takeoff or submitting the request',async()=>{
  const p=`boq-tab-${++sequence}`;let reads=0,calls=0;
  const context={...gates,projectId:p,generating:false,setErrorMessage(){},setMessage(){},
    getLatestProjectTakeoff:async()=>{reads++;return {takeoff:{floor_area:17}};},
    generateFromTakeoff:async()=>calls++};vm.createContext(context);
  vm.runInContext(segment(boq,'  async function handleGenerateBoq()','  return (')+'\nthis.generate=handleGenerateBoq;',context);
  const run=beginDrawingWorkflow(p,'analysis');await context.generate();assert.equal(reads,0);assert.equal(calls,0);
  finishDrawingWorkflow(p,run,true);await context.generate();assert.equal(reads,1);assert.equal(calls,1);
});
test('an analysis started while the BOQ tab reads storage still blocks generation at the API boundary',async()=>{
  const p=`read-race-${++sequence}`;let resolveRead,calls=0;
  const pending=new Promise(r=>resolveRead=r),context={...gates,projectId:p,generating:false,setErrorMessage(){},setMessage(){},
    getLatestProjectTakeoff:async()=>pending,generateBoq:async()=>{calls++;throw Error('must not run');}};
  vm.createContext(context);vm.runInContext(segment(boq,'  async function generateFromTakeoff(', '  const generateBoqFromEffect=')+'\n'+
    segment(boq,'  async function handleGenerateBoq()','  return (')+'\nthis.generate=handleGenerateBoq;',context);
  const work=context.generate(),run=beginDrawingWorkflow(p,'analysis');
  resolveRead({takeoff:{floor_area:17}});await work;assert.equal(calls,0);
  finishDrawingWorkflow(p,run,true);
});
test('UI disables Generate BOQ and report export while analysis is active',()=>{
  assert.match(center,/disabled: generatingBoq \|\| analyzing/);
  assert.match(center,/<button type="button" disabled=\{analyzing\} onClick=\{async\(\)=>\{if\(analysisInFlightRef.current\)return/);
  assert.match(boq,/disabled=\{generating \|\| loadingTakeoff \|\| !!drawingWorkflow.active \|\| drawingWorkflow.analysisFailed\}/);
});
