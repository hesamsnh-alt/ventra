import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {submitDrawingAnalysis} from '../src/lib/drawingAnalysisTransport.mjs';

const options = {method:'POST', headers:{'X-Ventra-Request-Id':'takeoff-test-id'}, body:'{"projectId":"p"}'};
const health = () => Response.json({success:true});

test('failed connection check, HTML response or HTTP error never submits an analysis POST', async () => {
  for (const fail of [() => {throw new TypeError('Failed to fetch');}, () => new Response('<html>wrong service</html>'), () => Response.json({success:false},{status:503})]) {
    const calls=[];
    await assert.rejects(submitDrawingAnalysis(options,async (url,request) => {
      calls.push({url,request});return fail();
    }),error => error.code === 'DRAWING_CONNECTION_CHECK_FAILED' && error.message.includes('No analysis POST'));
    assert.equal(calls.length,1);assert.equal(calls[0].request.method,'GET');
    assert.equal(calls[0].request.cache,'no-store');
  }
});

test('lost POST response is reported as unknown and is never replayed', async () => {
  const calls=[];
  await assert.rejects(submitDrawingAnalysis(options,async (_,request) => {
    calls.push(request);if(request.method==='GET')return health();
    throw new TypeError('Failed to fetch');
  }),error => error.code==='DRAWING_ANALYSIS_OUTCOME_UNKNOWN' && error.requestId==='takeoff-test-id' && error.message.includes('outcome is unknown'));
  assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
  assert.equal(calls[1],options);
});

test('lost response body and invalid JSON do not trigger another paid request', async () => {
  for (const response of [{status:200,text:async()=>{throw new TypeError('connection reset');}},new Response('<html>proxy error</html>',{status:502})]) {
    let posts=0;
    await assert.rejects(submitDrawingAnalysis(options,async (_,request) => {
      if(request.method==='GET')return health();posts++;return response;
    }),error=>error.code==='DRAWING_ANALYSIS_RESPONSE_UNREADABLE' && error.requestId==='takeoff-test-id');
    assert.equal(posts,1);
  }
});

test('HTTP authentication, quota and conflict errors retain their response without retries', async () => {
  for(const status of [401,403,409,429,500]) {
    let posts=0;const payload={success:false,error:'Existing server error',code:'SERVER_CODE'};
    const result=await submitDrawingAnalysis(options,async (_,request)=>{
      if(request.method==='GET')return health();posts++;return Response.json(payload,{status});
    });
    assert.equal(posts,1);assert.equal(result.response.status,status);assert.deepEqual(result.payload,payload);
  }
});

test('actual client saves successful results once and preserves saved evidence on failed transport', async () => {
  const source=readFileSync('src/services/takeoffService.js','utf8');
  const start=source.indexOf('export async function analyzeProjectDrawing('),end=source.indexOf('export async function getLatestProjectTakeoff(',start);
  const fn=source.slice(start,end).replace('export ','').replace('const { downloadProjectDocument } = await import("@/services/documentService");','');
  for (const failed of [false,true]) {
    let writes=0,posts=0,saved={document_id:'old',floor_area:17};
    const context={Date,JSON,Error,submitDrawingAnalysis,console:{error(){}},
      downloadProjectDocument:async()=>({url:'https://private.invalid/signed.pdf?token=never-log'}),
      commercialFetch:async(_,request)=>{
        if(request.method==='GET')return health();posts++;
        assert.equal(JSON.parse(request.body).localPdfRecoveryOnly,undefined);
        if(failed)throw new TypeError('Failed to fetch');
        return Response.json({success:true,result:{floor_area:81}});
      },saveTakeoffLocally:async(_,takeoff)=>{writes++;saved=takeoff;}};
    vm.createContext(context);vm.runInContext(fn+'\nthis.run=analyzeProjectDrawing;',context);
    const result=await context.run({projectId:'p',document:{id:'d',file_path:'f',file_name:'source.pdf'}});
    assert.equal(posts,1);assert.equal(writes,failed?0:1);
    assert.equal(saved.floor_area,failed?17:81);
    if(failed){assert.equal(result.takeoff,null);assert.equal(result.error.code,'DRAWING_ANALYSIS_OUTCOME_UNKNOWN');assert.ok(!result.error.message.includes('never-log'));}
    else {assert.equal(result.error,null);assert.equal(result.takeoff.floor_area,81);}
  }
});
