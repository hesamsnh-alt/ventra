import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {apsObjectKey} from '../src/lib/apsObjectKey.mjs';
test('Identical source filenames cannot overwrite another project, account or upload',()=>{const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';assert.notEqual(apsObjectKey(a,a,a,'plan.dwg'),apsObjectKey(b,a,a,'plan.dwg'));assert.notEqual(apsObjectKey(a,a,a,'plan.dwg'),apsObjectKey(a,b,a,'plan.dwg'));assert.notEqual(apsObjectKey(a,a,a,'plan.dwg'),apsObjectKey(a,a,c,'plan.dwg'));assert.throws(()=>apsObjectKey('bad',a,c,'x.dwg'));});
test('Token endpoints reject unauthenticated calls before issuing Autodesk credentials',async()=>{
 for(const file of ['src/app/api/aps/token/route.js','src/app/api/aps/viewer-token/route.js','src/app/api/aps-auth/route.js']){
  const source=readFileSync(file,'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'');let calls=0;
  const context=vm.createContext({account:async()=>{throw Object.assign(new Error('Sign in required'),{status:401});},getApsViewerToken:async()=>{calls++;},commercialError:error=>({status:error.status}),console:{error(){},log(){}}});vm.runInContext(source,context);assert.equal((await context.GET({})).status,401);assert.equal(calls,0);
 }
});
test('Translation status forwards session only to internal token endpoint and Autodesk token only to Autodesk',async()=>{
 const source=readFileSync('src/app/api/aps/status/[urn]/route.js','utf8').replace(/^import .*\n/gm,'').replace(/export /g,'');const calls=[];
 const context=vm.createContext({URL,account:async()=>({}),commercialError:error=>({status:error.status}),NextResponse:{json:(body,options)=>({body,status:options?.status||200})},console:{error(){},log(){}},fetch:async(url,options)=>{calls.push({url:String(url),options});return{ok:true,text:async()=>JSON.stringify(calls.length===1?{access_token:'autodesk-token'}:{status:'success',progress:'complete'})};}});
 vm.runInContext(source,context);const result=await context.GET({url:'https://ventra.example/api/aps/status/test',headers:new Headers({authorization:'Bearer session-token'})},{params:Promise.resolve({urn:'test'})});
 assert.equal(result.status,200);assert.equal(result.body.manifest.status,'success');assert.equal(calls[0].url,'https://ventra.example/api/aps/token');assert.equal(calls[0].options.headers.Authorization,'Bearer session-token');assert.equal(calls[1].options.headers.Authorization,'Bearer autodesk-token');
});
