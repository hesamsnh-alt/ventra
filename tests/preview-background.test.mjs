import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {runPreviewAnalysis} from '../src/lib/previewJobClient.mjs';
const id='12345678-1234-1234-1234-123456789012';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('synchronous localhost result remains unchanged',async()=>{
 const response=Response.json({scene:{rooms:[]}});
 assert.equal(await runPreviewAnalysis(async()=>response,{key:'x',fetcher:()=>{throw Error('no poll')}}),response);
});
test('queued job survives transient outage and returns the original scene',async()=>{
 const cache=storage(),responses=[new Response('',{status:503}),Response.json({status:'running'},{status:202}),Response.json({scene:{width:12}})];let starts=0;
 const r=await runPreviewAnalysis(async()=>{starts++;return Response.json({jobId:id},{status:202});},{key:'x',storage:cache,delay:async()=>{},fetcher:async()=>responses.shift()});
 assert.equal(starts,1);assert.equal((await r.json()).scene.width,12);assert.equal(cache.getItem('ventra:preview-job:x'),id);
});
test('retry resumes a pending job without submitting or charging again',async()=>{
 const cache=storage();cache.setItem('ventra:preview-job:x',id);
 const r=await runPreviewAnalysis(()=>{throw Error('must not start');},{key:'x',storage:cache,delay:async()=>{},fetcher:async()=>Response.json({error:'credit exhausted'},{status:429})});
 assert.equal(r.status,429);assert.equal(cache.getItem('ventra:preview-job:x'),undefined);
});
const source=fs.readFileSync(new URL('../src/lib/serverPreviewJobs.js',import.meta.url),'utf8');
function workerHarness({claimed=true,user='actor'}={}){
 const updates=[];let accountCalls=0,runs=0;
 const db={from(){let value;const query={update(v){value=v;updates.push(v);return query;},eq(){return query;},select(){return query;},maybeSingle:async()=>({data:claimed?{actor_id:'actor',request_body:{projectId:'p'}}:null}),then(resolve){resolve({});}};return query;}};
 const context=vm.createContext({commercialAdmin:()=>db,account:async()=>{accountCalls++;return{id:user};},billingError:(m,status)=>Object.assign(Error(m),{status}),Request,Date,nonceHash:()=>'',table:'jobs'});
 vm.runInContext(source.slice(source.indexOf('export async function executePreviewJob')).replace('export async function','async function')+'\nthis.run=executePreviewJob;',context);
 return {updates,context,get runs(){return runs;},get accountCalls(){return accountCalls;},invoke:()=>context.run({id,nonce:'a'.repeat(64),authorization:'Bearer token'},async()=>{runs++;return Response.json({scene:{width:3}});})};
}
test('worker persists result and clears request after one atomic claim',async()=>{
 const h=workerHarness();await h.invoke();assert.equal(h.runs,1);assert.equal(h.updates[1].status,'completed');assert.equal(h.updates[1].request_body,null);assert.equal(h.updates[1].result.scene.width,3);
});
test('worker retry cannot run an already claimed job',async()=>{const h=workerHarness({claimed:false});await h.invoke();assert.equal(h.runs,0);assert.equal(h.accountCalls,0);});
test('worker refuses actor mismatch before calling commercial analysis',async()=>{const h=workerHarness({user:'outsider'});await h.invoke();assert.equal(h.runs,0);assert.equal(h.updates[1].http_status,403);});
test('polling endpoint scopes jobs to authenticated actor and queue uses project access',()=>{
 assert.match(source,/eq\('actor_id',user.id\)/);assert.match(source,/commercialContext\(request,body.projectId,user\)/);
 const sql=fs.readFileSync(new URL('../supabase/migrations/20261012_preview_background_jobs.sql',import.meta.url),'utf8');assert.match(sql,/revoke all .* from anon, authenticated/);assert.match(sql,/enable row level security/);
});
test('background job SQL installs twice and prevents direct browser access',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create table public.projects(id uuid primary key);');
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261012_preview_background_jobs.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.ventra_preview_jobs'),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
test('completed source result is recovered before enqueueing a paid analysis',async()=>{
 const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},gte(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:{result:{scene:{width:12}}}})};
 const context=vm.createContext({table:'ventra_preview_jobs',process:{env:{URL:'https://example.netlify.app'}},Response,URL,Date,AbortSignal,account:async()=>({id:'actor'}),commercialContext:async()=>({db:{from:()=>q}}),previewImageFingerprint:async()=>({hash:'exact-source-hash',version:'current'}),commercialError:()=>{throw Error('unexpected failure')},billingError:()=>Error('unexpected failure')});
 const a=source.indexOf('export async function startPreviewJob'),b=source.indexOf('export async function readPreviewJob');
 vm.runInContext(source.slice(a,b).replace('export async function','async function')+'\nthis.start=startPreviewJob;',context);
 const response=await context.start({text:async()=>JSON.stringify({projectId:'project',mode:'schematic_analyze',imageUrl:'signed-source'})});
 assert.equal(response.status,200);assert.equal((await response.json()).recovered,true);
 assert.ok(filters.some(([k,v])=>k==='actor_id'&&v==='actor'));assert.ok(filters.some(([k,v])=>k==='project_id'&&v==='project'));assert.ok(filters.some(([k,v])=>k==='result->diagnostics->>imageHash'&&v==='exact-source-hash'));
});
