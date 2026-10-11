import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/api/project-3d-state/route.js',import.meta.url),'utf8');
function setup(owner='owner'){
 const uploads=[];
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{user_id:owner}})})})}),storage:{from:bucket=>({upload:async(path,value)=>{uploads.push({bucket,path,value});return{};},download:async()=>({error:{statusCode:404,message:'Object not found'}})})}};
 const context=vm.createContext({Response,URL,account:async()=>({id:'owner'}),billingError:(message,status)=>Object.assign(new Error(message),{status}),commercialAdmin:()=>db,commercialError:error=>Response.json({error:error.message},{status:error.status||503}),validProjectId:()=>true});
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
