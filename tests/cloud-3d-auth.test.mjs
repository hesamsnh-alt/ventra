import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/lib/commercialFetch.js',import.meta.url),'utf8');
function setup(token='test-session-token'){
 const calls=[];
 const context=vm.createContext({Headers,supabase:{auth:{getSession:async()=>({data:{session:token?{access_token:token}:null}})}},fetch:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});},Response});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replaceAll('export ','')+'\nthis.request=commercialFetch;',context);
 return {context,calls};
}
test('cloud 3D GET and PUT carry the signed-in session without losing options',async()=>{
 const {context,calls}=setup();
 await context.request('/api/project-3d-state?projectId=project',{cache:'no-store'});
 await context.request('/api/project-3d-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"kind":"schematic"}'});
 for(const call of calls)assert.equal(call.options.headers.get('Authorization'),'Bearer test-session-token');
 assert.equal(calls[0].options.cache,'no-store');
 assert.equal(calls[1].options.method,'PUT');
 assert.equal(calls[1].options.headers.get('Content-Type'),'application/json');
 assert.equal(calls[1].options.body,'{"kind":"schematic"}');
});
test('cloud 3D requests fail before network access when signed out',async()=>{
 const {context,calls}=setup(null);
 await assert.rejects(context.request('/api/project-3d-state?projectId=project'),/Please sign in/);
 await assert.rejects(context.request('/api/project-3d-state',{method:'PUT'}),/Please sign in/);
 assert.equal(calls.length,0);
});
test('session tokens never go to external or similarly named endpoints',async()=>{
 const {context,calls}=setup();
 for(const url of ['https://example.com/api/project-3d-state','/api/project-3d-state-other','/api/public'])await context.request(url);
 for(const call of calls)assert.equal(call.options.headers,undefined);
});
test('existing APS and AI requests retain authentication',async()=>{
 const {context,calls}=setup();
 for(const url of ['/api/aps/token','/api/ai/design-3d-preview','/api/aps-auth?x=1'])await context.request(url);
 for(const call of calls)assert.equal(call.options.headers.get('Authorization'),'Bearer test-session-token');
});
