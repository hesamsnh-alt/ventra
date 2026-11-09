import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/api/project-3d-state/route.js',import.meta.url),'utf8');
function setup(owner='owner',role=null){
 const uploads=[],objects=new Map();
 const db={from:table=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='projects'?{user_id:owner}:role?{role}:null})};return query;},storage:{from:bucket=>({upload:async(path,value)=>{uploads.push({bucket,path,value});objects.set(path,value);return{};},download:async path=>objects.has(path)?{data:new Blob([objects.get(path)])}:{error:{statusCode:404,message:'Object not found'}}})}};
 const context=vm.createContext({Response,URL,Blob,account:async()=>({id:'owner'}),billingError:(message,status)=>Object.assign(new Error(message),{status}),commercialAdmin:()=>db,commercialError:error=>Response.json({error:error.message},{status:error.status||503}),apsModelAccess:async()=>({}),validProjectId:()=>true});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replaceAll('export ', '')+'\nthis.put=PUT;this.get=GET;',context);return{context,uploads,objects};
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

test('cloud restores each JPG/PDF document instead of only the last project scene',async()=>{
 const {context}=setup(),a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 for(const [documentId,width]of [[a,8],[b,12]])assert.equal((await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'schematic',value:{documentId,width,depth:5,rooms:[]}})}))).status,200);
 const read=await context.get(new Request('https://example.com?projectId=test&documentId='+a));assert.equal((await read.json()).schematic.width,8);
 const unknown=await context.get(new Request('https://example.com?projectId=test&documentId=00000000-0000-4000-8000-000000000003'));assert.equal((await unknown.json()).schematic,undefined);
});
test('first document-scoped write preserves a legacy model of another drawing',async()=>{
 const {context,objects}=setup(),a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';objects.set('owner/test/ventra-3d-state/engineering.json',JSON.stringify({document_id:a,aps_urn:'urn-a'}));
 await context.put(new Request('https://example.com',{method:'PUT',body:JSON.stringify({projectId:'test',kind:'engineering',value:{document_id:b,aps_urn:'urn-b'}})}));
 const restored=await context.get(new Request('https://example.com?projectId=test&kind=engineering&documentId='+a));assert.equal((await restored.json()).engineering.aps_urn,'urn-a');
});
