import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
const live=JSON.parse(fs.readFileSync(new URL('./fixtures/raster-live-extraction.json',import.meta.url)));
const catalog=JSON.parse(fs.readFileSync(new URL('./fixtures/pdf-observed-price-catalog.json',import.meta.url))).catalog;
const prices=catalog.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,
 section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,source_name:i.sourceName,
 standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate,is_active:true})));
const result=await build({entryPoints:['src/lib/serverBoqAnalysis.js'],bundle:true,write:false,platform:'node',format:'cjs',
 plugins:[{name:'offline-boundaries',setup(b){
  b.onResolve({filter:/^(next\/server|@supabase\/supabase-js|@\/lib\/serverCommercial|@\/services\/aiBoqScopeService)$/},a=>({path:a.path,namespace:'offline'}));
  b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='next/server'?'export const NextResponse={json:Response.json.bind(Response)};':
   a.path==='@supabase/supabase-js'?'export const createClient=()=>globalThis.qaDb;':
   a.path==='@/lib/serverCommercial'?'export const commercialRun=(request,action,run)=>run(request);':
   'export const getSemanticRooms=()=>[];export const hydrateSemanticRoomQuantities=()=>({rooms:[]});export const inferConstructionScopes=()=>{throw Error("MODEL CALL FORBIDDEN")};export const shortlistPriceCatalog=()=>{throw Error("MODEL CALL FORBIDDEN")};export const matchScopesToCatalog=()=>{throw Error("MODEL CALL FORBIDDEN")};export const resolveAiQuantity=()=>{throw Error("MODEL CALL FORBIDDEN")};',loader:'js'}));
 }}]});
function route(){
 const reads=[];
 const db={from(table){reads.push(table);const data=table==='price_items'?prices:[];let from=0,to=data.length;
  const chain={select(){return chain},eq(){return chain},order(){return chain},range(a,b){from=a;to=b+1;return chain},
   then(resolve,reject){return Promise.resolve({data:data.slice(from,to),error:null}).then(resolve,reject)}};return chain;}};
 const context=vm.createContext({qaDb:db,Response,Request,URL,console:{log(){},warn(){},error(){}},
  process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',SUPABASE_SECRET_KEY:'offline-test'}},module:{exports:{}},
  fetch(){throw Error('NETWORK CALL FORBIDDEN')}});
 vm.runInContext(result.outputFiles[0].text,context);return {run:context.module.exports.runBoqRequest,reads};
}
for(const [i,paint] of [50.67,75.45,56.67].entries())test(`actual production BOQ handler replays LIVE QA-0${i+1} with no model request`,async()=>{
 const r=route(),response=await r.run(new Request('https://offline.invalid/api/ai/generate-boq',{method:'POST',body:JSON.stringify({
  projectId:'offline-'+i,projectName:'Saved QA replay',takeoff:live[i].takeoff,vatPercentage:5})}));
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.success,true);
 assert.equal(body.boq.items.find(x=>x.imageEvidence?.metricKey==='paint_area').quantity,paint);
 assert.ok(body.boq.items.length<10);assert.equal(body.boq.calculationVersion,'image-operation-evidence-v1');
 assert.deepEqual([...new Set(r.reads)].sort(),['boq_rules','boq_sections','price_items']);
});
const moreLive=JSON.parse(fs.readFileSync(new URL('./fixtures/raster-live-more-extraction.json',import.meta.url)));
for(const [i,expected] of [{paint:0,count:6},{paint:79.89,count:8}].entries())test(`actual BOQ handler replays LIVE QA-0${i+4}: audit and supported operations only`,async()=>{
 const r=route(),response=await r.run(new Request('https://offline.invalid/api/ai/generate-boq',{method:'POST',body:JSON.stringify({
  projectId:'offline-more-'+i,projectName:'Saved mixed-use QA replay',takeoff:moreLive[i].takeoff,vatPercentage:5})}));
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.success,true);
 const b=body.boq;assert.equal(b.items.find(x=>x.imageEvidence?.metricKey==='paint_area').quantity,expected.paint);
 assert.equal(b.items.length,expected.count);assert.equal(b.measurementIssues.length,i===0?1:0);
 assert.deepEqual([...new Set(r.reads)].sort(),['boq_rules','boq_sections','price_items']);
});
