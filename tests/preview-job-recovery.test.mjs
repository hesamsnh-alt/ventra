import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync(new URL('../src/lib/serverPreviewJobs.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('export async function startPreviewJob'),source.indexOf('export async function readPreviewJob')).replace('export async function','async function')+'\nthis.start=startPreviewJob;';
function harness(){
  const jobs=new Map(),updates=[];let dispatches=0,version='v1',lookupDenied=false,dispatchStatus=202;
  const db={from(){
    let filters=[],change;
    const q={
      select(){return q},eq(key,value){filters.push([key,value]);return q},gte(){return q},order(){return q},limit(){return q},
      async insert(row){if(jobs.has(row.id))return{error:{code:'23505'}};jobs.set(row.id,structuredClone(row));return{}},
      update(value){change=value;return q},
      async maybeSingle(){
        if(lookupDenied)return{data:null};
        // Source-image cache miss; duplicate lookup uses an exact job ID.
        const id=filters.find(([key])=>key==='id')?.[1];
        const row=jobs.get(id);
        if(row&&filters.every(([key,value])=>row[key]===value))return{data:structuredClone(row)};
        return{data:null};
      },
      then(resolve){updates.push(change);for(const row of jobs.values())if(filters.every(([key,value])=>row[key]===value))Object.assign(row,change);resolve({})}
    };return q;
  }};
  const sandbox={console,db,table:'jobs',process:{env:{URL:'https://example.netlify.app'}},Response,URL,Date,AbortSignal,
    account:async()=>({id:'actor'}),commercialContext:async()=>({db}),
    previewImageFingerprint:async()=>({hash:'same-source',version}),
    nonceHash:value=>createHash('sha256').update(value).digest('hex'),randomBytes:()=>Buffer.alloc(32,1),
    fetch:async()=>{dispatches++;return new Response(null,{status:dispatchStatus})},
    billingError:(message,status)=>Object.assign(Error(message),{status}),commercialError:error=>Response.json({error:error.message},{status:error.status||500})};
  vm.createContext(sandbox);vm.runInContext(code,sandbox);
  const request=()=>new Request('https://example.netlify.app/api/ai/design-3d-preview',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({projectId:'project',mode:'schematic_analyze',imageUrl:'same-image'})});
  return{jobs,updates,run:()=>sandbox.start(request()),set version(v){version=v},set lookupDenied(v){lookupDenied=v},set dispatchStatus(v){dispatchStatus=v},get dispatches(){return dispatches}};
}

test('same-version queued duplicates resume one job and dispatch only once',async()=>{
  const h=harness(),first=await h.run(),second=await h.run();
  assert.equal(first.status,202);assert.equal(second.status,202);
  assert.equal((await first.json()).jobId,(await second.json()).jobId);assert.equal(h.dispatches,1);
});
test('running duplicate reports running instead of inventing a queued job',async()=>{
  const h=harness();const id=(await(await h.run()).json()).jobId;h.jobs.get(id).status='running';
  assert.equal((await(await h.run()).json()).status,'running');assert.equal(h.dispatches,1);
});
test('failed duplicate returns its real failure without another paid dispatch',async()=>{
  const h=harness();const id=(await(await h.run()).json()).jobId;
  Object.assign(h.jobs.get(id),{status:'failed',http_status:422,result:{code:'INVALID_COORDINATE',error:'Invalid pixel'}});
  const result=await h.run();assert.equal(result.status,422);assert.equal((await result.json()).code,'INVALID_COORDINATE');assert.equal(h.dispatches,1);
});
test('corrected engine receives a new job instead of reusing the previous engine failure',async()=>{
  const h=harness();const old=(await(await h.run()).json()).jobId;
  Object.assign(h.jobs.get(old),{status:'failed',http_status:422,result:{code:'INVALID_COORDINATE'}});
  h.version='v2';const result=await h.run(),fresh=(await result.json()).jobId;
  assert.equal(result.status,202);assert.notEqual(fresh,old);assert.equal(h.dispatches,2);assert.equal(h.jobs.get(old).status,'failed');
});
test('completed duplicate recovers its result, never starts another worker',async()=>{
  const h=harness();const id=(await(await h.run()).json()).jobId;
  Object.assign(h.jobs.get(id),{status:'completed',http_status:200,result:{scene:{width:21.1}}});
  const result=await h.run();assert.equal(result.status,200);assert.equal((await result.json()).scene.width,21.1);assert.equal(h.dispatches,1);
});
test('duplicate lookup failure cannot mark an existing queued worker failed',async()=>{
  const h=harness();const id=(await(await h.run()).json()).jobId;h.lookupDenied=true;
  const result=await h.run();assert.equal(result.status,503);assert.equal(h.jobs.get(id).status,'queued');assert.equal(h.updates.length,0);assert.equal(h.dispatches,1);
});
test('dispatch failure marks only the newly inserted queued job failed',async()=>{
  const h=harness();h.dispatchStatus=503;
  const result=await h.run();assert.equal(result.status,503);assert.equal([...h.jobs.values()][0].status,'failed');assert.equal(h.updates.length,1);
});
