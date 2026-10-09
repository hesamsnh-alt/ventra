import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {subscriptionAccess,validateSnapshot,snapshotKeys} from '../src/lib/commercialAccess.mjs';
const project='3f30a007-1781-47cb-84c8-37b911ca393f';
test('Only configured active/trial subscriptions grant paid access',()=>{
 for(const status of ['none','canceled','past_due','unpaid','incomplete','incomplete_expired'])assert.throws(()=>subscriptionAccess({status,items:{data:[{price:{id:'p'}}]}},'p'),e=>e.status===402);
 assert.equal(subscriptionAccess({status:'active',items:{data:[{price:{id:'p'}}]}},'p').limit,30);
 assert.equal(subscriptionAccess({status:'trialing',items:{data:[{price:{id:'p'}}]}},'p').limit,5);
 assert.throws(()=>subscriptionAccess({status:'active',items:{data:[{price:{id:'wrong'}}]}},'p'));
 assert.throws(()=>subscriptionAccess({},''),e=>e.status===503);
});
test('Snapshots preserve project scope and reject unsupported or huge sections',()=>{
 assert.equal(Object.keys(snapshotKeys(project)).length,4);
 assert.doesNotThrow(()=>validateSnapshot({boq:{projectId:project},branding:{companyName:'a'}},project));
 assert.throws(()=>validateSnapshot({quotation:{projectId:'another'}},project));
 assert.throws(()=>validateSnapshot({geometry:{}},project));
 assert.throws(()=>validateSnapshot({branding:{logo:'x'.repeat(8*1024*1024)}},project));
});
function server({authenticated=true,owner=true,status='active',price='p',duplicate=false,quotaError=false}={}){
 let consumed=0,handled=0;
 const db={from:()=>({select:()=>({eq(){return this;},maybeSingle:async()=>({data:{user_id:owner?'owner':'different'}})})}),rpc:async()=>{consumed++;return quotaError?{error:Error('missing migration')}:{data:{accepted:!duplicate,duplicate}};}};
 const source=readFileSync('src/lib/serverCommercial.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const methods=new Function('createHash','createClient','account','provider','customerFor','subscriptionFor','subscriptionAccess','validProjectId',source+'\nreturn {commercialRun};')(createHash,()=>db,async()=>{if(!authenticated)throw Object.assign(Error('Sign in'),{status:401});return {id:'owner'};},()=>({}),async()=>({id:'cus'}),async()=>({status,items:{data:[{price:{id:price}}]}}),subscriptionAccess,id=>id===project);
 const request=()=>new Request('https://ventra.test/api/ai/design-3d-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project,requestId:'same-request'})});
 const handler=async req=>{handled++;const b=await req.json();assert.match(b.requestId,/^owner:preview:/);return Response.json({ok:true});};
 return {run:()=>methods.commercialRun(request(),'preview',handler),counts:()=>({consumed,handled})};
}
const previous={url:process.env.NEXT_PUBLIC_SUPABASE_URL,role:process.env.SUPABASE_SERVICE_ROLE_KEY,price:process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID};
process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID='p';process.env.OPENAI_API_KEY='test-only-no-paid-request';
test('Anonymous and non-paying requests never reach the cost-bearing handler',async()=>{
 for(const [options,status] of [[{authenticated:false},401],[{owner:false},403],[{status:'past_due'},402],[{price:'wrong'},402]]){const s=server(options);assert.equal((await s.run()).status,status);assert.deepEqual(s.counts(),{consumed:0,handled:0});}
});
test('Usage failures and duplicate submissions fail closed before AI',async()=>{
 for(const [options,status] of [[{duplicate:true},409],[{quotaError:true},503]]){const s=server(options);assert.equal((await s.run()).status,status);assert.deepEqual(s.counts(),{consumed:1,handled:0});}
});
test('Concurrent identical submissions invoke AI once and reuse the response',async()=>{
 const s=server();const replies=await Promise.all([s.run(),s.run()]);assert.ok(replies.every(r=>r.status===200));assert.deepEqual(s.counts(),{consumed:1,handled:1});assert.equal((await s.run()).status,200);assert.deepEqual(s.counts(),{consumed:1,handled:1});
});
