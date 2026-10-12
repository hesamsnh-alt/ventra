import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {decodeApsUrn} from '../src/lib/apsModelIdentity.mjs';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',nonce='33333333-3333-4333-8333-333333333333';
const resource=`urn:adsk.objects:os.object:ventra_test/${owner}/${project}/${nonce}-plan.dwg`,urn=Buffer.from(resource).toString('base64url');
function access({user=owner,role=null,actualOwner=owner,legacy={}}={}){
 const queries=[];
 const db={from:table=>{queries.push(table);return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='projects'?{user_id:actualOwner}:role?{role}:null})};}};
 const context=vm.createContext({process:{env:{APS_BUCKET_KEY:'ventra_test',VENTRA_LEGACY_APS_MODELS:JSON.stringify(legacy)}},Object,JSON,account:async()=>({id:user}),commercialAdmin:()=>db,decodeApsUrn,billingError:(message,status)=>Object.assign(new Error(message),{status})});
 vm.runInContext(fs.readFileSync('src/lib/serverApsAccess.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')+'\nthis.access=apsModelAccess;',context);
 return {run:(value=urn,expected=null)=>context.access({},value,expected),queries};
}
test('APS resource access binds model owner, project and explicit project membership',async()=>{
 assert.equal((await access().run()).resource,resource);
 await assert.rejects(access({user:'stranger'}).run(),e=>e.status===403);
 assert.equal((await access({user:'member',role:'viewer'}).run()).projectId,project);
 await assert.rejects(access({actualOwner:'another-owner'}).run(),e=>e.status===403);
 await assert.rejects(access().run(urn,nonce),e=>e.status===403);
 const other=Buffer.from(resource.replace('ventra_test','other_bucket')).toString('base64url');
 await assert.rejects(access().run(other),e=>e.status===403);
});
test('Unscoped legacy models require a server-maintained ownership mapping',async()=>{
 const old=Buffer.from('urn:adsk.objects:os.object:ventra_test/old.dwg').toString('base64url');
 await assert.rejects(access().run(old),e=>e.status===403);
 assert.equal((await access({legacy:{[old]:project}}).run(old)).projectId,project);
 await assert.rejects(access({user:'stranger',legacy:{[old]:project}}).run(old),e=>e.status===403);
});
test('Malformed identifiers and scope injection are rejected before token issuance',()=>{
 for(const value of ['','not-a-model',urn+'=',Buffer.from(resource+' data:write').toString('base64url'),Buffer.from('https://attacker.test').toString('base64url')])assert.throws(()=>decodeApsUrn(value));
 assert.equal(decodeApsUrn('urn:'+urn).resource,resource);
});

test('Viewer OAuth token uses only the verified model read scope and never mints an unscoped token',async()=>{
 const calls=[];
 const context=vm.createContext({Buffer,URLSearchParams,process:{env:{APS_CLIENT_ID:'test',APS_CLIENT_SECRET:'not-a-real-secret'}},fetch:async(url,options)=>{calls.push({url,options});return Response.json({access_token:'test-token',expires_in:3600});}});
 vm.runInContext(fs.readFileSync('src/services/apsService.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')+'\nthis.token=getApsViewerToken;',context);
 await assert.rejects(context.token(),/verified model/);assert.equal(calls.length,0);
 assert.equal((await context.token(resource)).accessToken,'test-token');
 assert.equal(calls.length,1);assert.equal(calls[0].options.body.get('scope'),`data:read:${resource}`);
});

test('APS percent-encoded object paths preserve the scoped resource and resolve the same ownership',async()=>{
 for(const separator of ['%2F','%2f']){
  const encodedResource=`urn:adsk.objects:os.object:ventra_test/${owner}${separator}${project}${separator}${nonce}-metric%20(1).dwg`;
  const encodedUrn=Buffer.from(encodedResource).toString('base64url');
  const result=await access().run(encodedUrn,project);
  assert.equal(result.ownerId,owner);assert.equal(result.projectId,project);assert.equal(result.resource,encodedResource);
  await assert.rejects(access({user:'stranger'}).run(encodedUrn),e=>e.status===403);
  await assert.rejects(access().run(encodedUrn,nonce),e=>e.status===403);
 }
});
test('Malformed escapes and encoded control characters are rejected; double encoding cannot claim a project',()=>{
 for(const name of ['bad%ZZ.dwg','bad%0Aname.dwg'])assert.throws(()=>decodeApsUrn(Buffer.from(`urn:adsk.objects:os.object:ventra_test/${owner}%2F${project}%2F${nonce}-${name}`).toString('base64url')));
 const double=Buffer.from(`urn:adsk.objects:os.object:ventra_test/${owner}%252F${project}%252F${nonce}-plan.dwg`).toString('base64url');
 assert.equal(decodeApsUrn(double).projectId,null);
});
