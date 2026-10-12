import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomBytes} from 'node:crypto';
import {boqAnalysisKey} from '../src/lib/previewJobClient.mjs';
const source=fs.readFileSync(new URL('../src/lib/serverPreviewJobs.js',import.meta.url),'utf8');
test('BOQ queue skips image processing and stores the server-selected action',async()=>{
 let stored,dispatched;
 const db={from:()=>({insert:async value=>{stored=value;return{};}})};
 const context=vm.createContext({table:'jobs',nonceHash:v=>createHash('sha256').update(v).digest('hex'),randomBytes,process:{env:{URL:'https://site.netlify.app'}},Response,URL,Date,AbortSignal,account:async()=>({id:'actor'}),commercialContext:async()=>({db}),previewImageFingerprint:()=>{throw Error('BOQ has no image')},commercialError:e=>{throw e},billingError:(m,status)=>Object.assign(Error(m),{status}),fetch:async(url,options)=>{dispatched=JSON.parse(options.body);return new Response(null,{status:202});}});
 vm.runInContext(source.slice(source.indexOf('export async function startPreviewJob'),source.indexOf('export async function readPreviewJob')).replace('export async function','async function')+'\nthis.start=startPreviewJob;',context);
 const r=await context.start({headers:new Headers({authorization:'Bearer token'}),text:async()=>JSON.stringify({projectId:'project',takeoff:{floor_area:100}})},'boq');
 assert.equal(r.status,202);assert.equal(stored.request_body.__backgroundAction,'boq');assert.equal(stored.request_body.takeoff.floor_area,100);assert.equal(dispatched.id,stored.id);assert.equal(dispatched.nonce.length,64);
});
test('background worker dispatches BOQ to the original commercial BOQ handler',async()=>{
 const entry=fs.readFileSync(new URL('../netlify/worker/preview-background.mjs',import.meta.url),'utf8');let calls=0;
 const context=vm.createContext({executePreviewJob:async(input,run)=>run(input,'boq'),runBoqRequest:async request=>{calls++;assert.equal(request.projectId,'project');},runPreviewRequest:()=>{throw Error('wrong processor')}});
 vm.runInContext(entry.replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler').replace('export const config','const config')+'\nthis.handler=handler;',context);
 await context.handler({json:async()=>({projectId:'project'})});assert.equal(calls,1);
 const handler=fs.readFileSync(new URL('../src/lib/serverBoqAnalysis.js',import.meta.url),'utf8');assert.match(handler,/commercialRun\(request,'boq',handleCommercialRequest\)/);
});
test('BOQ pending keys isolate quantities, VAT, price level and project',async()=>{
 const base={projectId:'p',takeoff:{wall_area:50},priceLevel:'standard',vatPercentage:5};const key=await boqAnalysisKey(base);
 assert.equal(key,await boqAnalysisKey(structuredClone(base)));
 for(const update of [{projectId:'other'},{takeoff:{wall_area:100}},{priceLevel:'premium'},{vatPercentage:0}])assert.notEqual(key,await boqAnalysisKey({...base,...update}));
});
test('actual BOQ client polls queued work and preserves returned financial amounts',async()=>{
 const {runPreviewAnalysis,acknowledgePreviewJob}=await import('../src/lib/previewJobClient.mjs');
 const client=fs.readFileSync(new URL('../src/services/boqService.js',import.meta.url),'utf8');
 const jobId='12345678-1234-1234-1234-123456789012',map=new Map(),calls=[];
 const boq={items:[{id:'a',quantity:3,rate:40,amount:120}],subtotal:120,total:126};
 const context=vm.createContext({crypto,boqAnalysisKey,acknowledgePreviewJob,runPreviewAnalysis:(start,options)=>runPreviewAnalysis(start,{...options,delay:async()=>{}}),window:{sessionStorage:{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}},console:{log(){},error(){}},commercialFetch:async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({jobId},{status:202}):Response.json({success:true,boq});}});
 vm.runInContext(client.replace(/^import .*;\n/gm,'').replace('export async function generateBoq','async function generateBoq')+'\nthis.generate=generateBoq;',context);
 const result=await context.generate({projectId:'p',takeoff:{wall_area:10}});
 assert.equal(JSON.stringify(result),JSON.stringify(boq));assert.equal(calls.length,2);assert.equal(calls[0].url,'/api/ai/generate-boq');assert.match(calls[1].url,/design-3d-preview\?jobId=/);assert.equal(map.size,0);
});
