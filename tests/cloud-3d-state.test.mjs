import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/api/project-3d-state/route.js',import.meta.url),'utf8');
function setup(owner='owner',role=null){
 const uploads=[];
 const db={from:table=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='projects'?{user_id:owner}:role?{role}:null})};return query;},storage:{from:bucket=>({upload:async(path,value)=>{uploads.push({bucket,path,value});return{};},download:async()=>({error:{statusCode:404,message:'Object not found'}})})}};
 const context=vm.createContext({Response,URL,account:async()=>({id:'owner'}),billingError:(message,status)=>Object.assign(new Error(message),{status}),commercialAdmin:()=>db,commercialError:error=>Response.json({error:error.message},{status:error.status||503}),apsModelAccess:async()=>({}),validProjectId:()=>true});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replaceAll('export ', '')+'\nthis.put=PUT;this.get=GET;',context);return{context,uploads};
}
test('cloud state denies another owner before reading or writing storage',async()=>{
 const {context,uploads}=setup('another');
 const read=await context.get(new Request('https://example.com?projectId=test'));assert.equal(read.status,403);
 const write=await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'engineering',value:{aps_urn:'urn'}})}));assert.equal(write.status,403);assert.equal(uploads.length,0);
});
test('cloud state derives the storage path on the server and permits an empty project',async()=>{
 const {context,uploads}=setup();
 const read=await context.get(new Request('https://example.com?projectId=test'));assert.equal(read.status,200);assert.deepEqual(await read.json(),{});
 const write=await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'engineering',value:{aps_urn:'urn'},path:'someone-else'})}));assert.equal(write.status,200);assert.equal(uploads[0].path,'owner/test/ventra-3d-state/engineering.json');
});

test('project viewers can restore but cannot replace shared model state',async()=>{
 const {context,uploads}=setup('another','viewer');
 assert.equal((await context.get(new Request('https://example.com?projectId=test'))).status,200);
 assert.equal((await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'selection',value:{source:'aps'}})}))).status,403);
 assert.equal(uploads.length,0);
});
test('project managers save into the project owner storage namespace',async()=>{
 const {context,uploads}=setup('another','manager');
 assert.equal((await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'selection',value:{source:'aps'}})}))).status,200);
 assert.equal(uploads[0].path,'another/test/ventra-3d-state/selection.json');
});
test('DWG interior source selection is authenticated and restored using the existing engineering state',async()=>{
 const {context,uploads}=setup();
 const response=await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'selection',value:{source:'dwg-interior'}})}));
 assert.equal(response.status,200);assert.equal(uploads[0].path,'owner/test/ventra-3d-state/selection.json');
 const denied=setup('another','viewer');
 assert.equal((await denied.context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'selection',value:{source:'dwg-interior'}})}))).status,403);
});
