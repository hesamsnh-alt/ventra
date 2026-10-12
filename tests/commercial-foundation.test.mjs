import {operatorAllowance,isOperator} from '../src/lib/operatorAllowance.mjs';
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
function server({authenticated=true,owner=true,status='active',price='p',duplicate=false,quotaError=false,handlerStatus=200,throws=false}={}){
 let consumed=0,handled=0;const releases=[];
 const db={from:()=>({select:()=>({eq(){return this;},maybeSingle:async()=>({data:{user_id:owner?'owner':'different'}})})}),rpc:async(name,args)=>{if(name==='ventra_release_analysis'){releases.push(args);return {data:true};}consumed++;return quotaError?{error:Error('missing migration')}:{data:{accepted:!duplicate,duplicate}};}};
 const source=readFileSync('src/lib/serverCommercial.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const methods=new Function('createHash','createClient','account','provider','customerFor','subscriptionFor','subscriptionAccess','validProjectId','operatorAllowance','isOperator',source+'\nreturn {commercialRun};')(createHash,()=>db,async()=>{if(!authenticated)throw Object.assign(Error('Sign in'),{status:401});return {id:'owner'};},()=>({}),async()=>({id:'cus'}),async()=>({status,items:{data:[{price:{id:price}}]}}),subscriptionAccess,id=>id===project,operatorAllowance,isOperator);
 const request=()=>new Request('https://ventra.test/api/ai/design-3d-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:project,requestId:'same-request'})});
 const handler=async req=>{handled++;const b=await req.json();assert.match(b.requestId,/^owner:preview:/);if(throws)throw new Error('provider failed');return Response.json({ok:handlerStatus===200},{status:handlerStatus});};
 return {run:()=>methods.commercialRun(request(),'preview',handler),releases,counts:()=>({consumed,handled})};
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

test('Owner free access skips quota RPC while retaining login and project checks',async()=>{
 const prior=process.env.VENTRA_FREE_USER_ID;process.env.VENTRA_FREE_USER_ID='owner';
 try{const s=server({status:'past_due',quotaError:true});assert.equal((await s.run()).status,200);assert.deepEqual(s.counts(),{consumed:0,handled:1});
 assert.equal((await server({authenticated:false}).run()).status,401);assert.equal((await server({owner:false}).run()).status,403);
 }finally{if(prior===undefined)delete process.env.VENTRA_FREE_USER_ID;else process.env.VENTRA_FREE_USER_ID=prior;}
});

test('Unsuccessful provider and layout-review attempts release the exact reserved allowance',async()=>{
 for(const handlerStatus of [400,422,429,502]){const s=server({handlerStatus});assert.equal((await s.run()).status,handlerStatus);assert.equal(s.releases.length,1);assert.equal(s.releases[0].p_project,project);assert.equal(s.releases[0].p_request,'same-request');assert.equal(s.releases[0].p_actor,'owner');assert.match(s.releases[0].p_hash,/^[a-f0-9]{64}$/);}
 const throwing=server({throws:true});assert.equal((await throwing.run()).status,503);assert.equal(throwing.releases.length,1);
 const success=server();await success.run();assert.equal(success.releases.length,0);
});
