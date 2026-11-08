import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {previewWorkerOrigin} from '../src/lib/previewWorkerOrigin.mjs';
const env={URL:'https://ventra.netlify.app',DEPLOY_URL:'https://old-id--ventra.netlify.app'};
for(const host of ['deploy-preview-3--ventra.netlify.app','new-id--ventra.netlify.app','fix-branch--ventra.netlify.app','ventra.netlify.app'])test(`worker dispatch remains on requesting site deployment ${host}`,()=>assert.equal(previewWorkerOrigin(`https://${host}/api/test`,env).origin,`https://${host}`));
for(const url of ['https://evil.netlify.app/api','https://deploy-preview-3--ventra.netlify.app.evil.test/api','https://evil.test/api','http://deploy-preview-3--ventra.netlify.app/api','https://user:secret@deploy-preview-3--ventra.netlify.app/api','https://deploy-preview-3--ventra.netlify.app:8443/api'])test(`untrusted dispatch origin cannot receive credentials: ${url.replace('user:secret@','redacted@')}`,()=>assert.equal(previewWorkerOrigin(url,env).origin,env.DEPLOY_URL));
test('configured custom domains work without accepting arbitrary siblings',()=>{const e={URL:'https://app.ventra.example'};assert.equal(previewWorkerOrigin('https://app.ventra.example/api',e).origin,e.URL);assert.equal(previewWorkerOrigin('https://other.ventra.example/api',e).origin,e.URL);});
test('missing HTTPS destination fails before a worker request',()=>assert.throws(()=>previewWorkerOrigin('https://evil.test',{}),{status:503}));
test('a mismatched worker build cannot reach paid analysis',async()=>{
 const source=fs.readFileSync('src/lib/serverPreviewJobs.js','utf8'),updates=[],q={update(v){updates.push(v);return q},eq(){return q},select(){return q},maybeSingle:async()=>({data:{actor_id:'actor',request_body:{__expectedRasterBuild:'old-build',projectId:'p'}}}),then(resolve){resolve({})}};
 const ctx=vm.createContext({commercialAdmin:()=>({from:()=>q}),table:'jobs',nonceHash:()=>'',account:async()=>({id:'actor'}),billingError:(m,status)=>Object.assign(Error(m),{status}),VERIFIED_PREVIEW_VERSION:'current-build',Request,Date});
 vm.runInContext(source.slice(source.indexOf('export async function executePreviewJob')).replace('export async function','async function')+'\nthis.run=executePreviewJob;',ctx);
 let calls=0;await ctx.run({id:'12345678-1234-1234-1234-123456789012',nonce:'a'.repeat(64),authorization:'Bearer test'},()=>{calls++;throw Error('must not run')});assert.equal(calls,0);assert.equal(updates[1].result.code,'PREVIEW_WORKER_BUILD_MISMATCH');
});

test('deployed background bundle must carry the same raster version as the app',async()=>{
 const {VERIFIED_PREVIEW_VERSION}=await import('../src/lib/verifiedPreview.mjs'),bundle=fs.readFileSync('netlify/functions/preview-background.mjs','utf8');assert.ok(bundle.includes(JSON.stringify(VERIFIED_PREVIEW_VERSION)));assert.match(bundle,/PREVIEW_WORKER_BUILD_MISMATCH/);
});
for(const {matches,keyStatus} of [{matches:true},{matches:false},{matches:true,keyStatus:"unusable_header"}])test(`real queue checks preview deployment before paid dispatch (${matches}, ${keyStatus||"legacy"})`,async()=>{
 const allowed=matches&&!keyStatus;
 const source=fs.readFileSync('src/lib/serverPreviewJobs.js','utf8'),calls=[],insertions=[];
 const q={select(){return q},eq(){return q},gte(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:null}),insert:async row=>{insertions.push(row);return{}}};
 const {createHash,randomBytes}=await import('node:crypto');
 const ctx=vm.createContext({previewWorkerOrigin,table:'jobs',process:{env},account:async()=>({id:'actor'}),commercialContext:async()=>({db:{from:()=>q}}),previewImageFingerprint:async()=>({hash:'source',version:'v140'}),nonceHash:v=>createHash('sha256').update(v).digest('hex'),randomBytes,URL,Response,Date,AbortSignal,billingError:(m,status)=>Object.assign(Error(m),{status}),commercialError:e=>Response.json({error:e.message},{status:e.status||500}),fetch:async(url,options)=>{calls.push({url:String(url),options});return String(url).endsWith('preview-build')?Response.json({routeVersion:matches?'v140':'old',...(keyStatus?{aiKeyStatus:keyStatus}:{})}):new Response(null,{status:202})}});
 vm.runInContext(source.slice(source.indexOf('export async function startPreviewJob'),source.indexOf('export async function readPreviewJob')).replace('export async function','async function')+'\nthis.start=startPreviewJob;',ctx);
 const r=await ctx.start({url:'https://deploy-preview-3--ventra.netlify.app/api/ai/design-3d-preview',headers:new Headers({authorization:'Bearer test'}),text:async()=>JSON.stringify({projectId:'p',mode:'schematic_analyze',imageUrl:'source'})});
 assert.equal(r.status,allowed?202:503);assert.equal(insertions.length,allowed?1:0);assert.equal(calls.length,allowed?2:1);assert.ok(calls.every(c=>c.url.startsWith('https://deploy-preview-3--ventra.netlify.app/')));
 if(allowed)assert.equal(insertions[0].request_body.__expectedRasterBuild,'v140');
});
