import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {validateSiteProgressInput,normalizeSiteAssessment,reviewedScopeProgress,SITE_PROGRESS_SCHEMA,SITE_PROGRESS_INSTRUCTIONS,SITE_WORKS,REPORT_PRESETS,labelFor} from '../src/lib/siteProgress.mjs';
import {DAILY_REPORT_COPY} from '../src/lib/dailyReportCopy.mjs';
const input={projectId:'project',workType:'tiling',zone:'Kitchen ground floor',scope:'Complete 20 m² floor tiling including grouting',fullCoverage:true,language:'fa',images:['data:image/jpeg;base64,YQ==']};
const output={workType:'tiling',stage:'Tiles installed; grouting remains',canEstimate:true,minimumPercent:60,maximumPercent:80,confidence:'medium',observations:['Visible tiles'],limitations:['Adhesive quality is hidden'],nextChecks:['Inspect grouting']};
test('site review requires explicit scope and limited local JPEG photos, never arbitrary remote URLs',()=>{
 assert.equal(validateSiteProgressInput(input).zone,input.zone);
 for(const changes of [{scope:''},{zone:''},{workType:'invented'},{images:[]},{images:Array(7).fill(input.images[0])},{images:['https://private.test/image']},{images:['data:image/jpeg;base64,'+'a'.repeat(900001)]}])assert.throws(()=>validateSiteProgressInput({...input,...changes}));
});
test('partial photos and missing scope certainty cannot become a recorded activity percentage',()=>{
 const partial=normalizeSiteAssessment(output,{...input,fullCoverage:false});assert.equal(partial.canEstimate,false);assert.equal(partial.minimumPercent,null);assert.equal(partial.maximumPercent,null);
 const hidden=normalizeSiteAssessment({...output,canEstimate:false},input);assert.equal(hidden.canEstimate,false);assert.equal(hidden.maximumPercent,null);
 for(const changes of [{minimumPercent:-1},{maximumPercent:101},{minimumPercent:90,maximumPercent:50}])assert.equal(normalizeSiteAssessment({...output,...changes},input).canEstimate,false);
 const full=normalizeSiteAssessment(output,input);assert.equal(full.minimumPercent,60);assert.equal(full.requiresSupervisorReview,true);assert.ok(!('overallProjectPercent' in full));assert.ok(!('progressToday' in full));
 assert.throws(()=>normalizeSiteAssessment({...output,workType:'paint'},input));
});
test('measured scope completion uses quantities, independently of visual guesses and daily gain',()=>{
 assert.deepEqual(reviewedScopeProgress({planned:'20',completed:'8',percent:'90'}),{percent:40,method:'supervisor_quantity',planned:20,completed:8});
 assert.equal(reviewedScopeProgress({planned:'',completed:'',percent:'75'}).percent,75);
 for(const values of [{planned:0,completed:0},{planned:20,completed:21},{planned:20,completed:-1},{planned:'',completed:'1'},{planned:'',completed:'',percent:''},{planned:'',completed:'',percent:'101'}])assert.throws(()=>reviewedScopeProgress(values));
});
test('all operation and report presets have independent English, Persian and Arabic copy',()=>{
 for(const item of [...SITE_WORKS,...Object.values(REPORT_PRESETS).flat()])for(const lang of ['en','fa','ar'])assert.ok(labelFor(item,lang));
 for(const key of Object.keys(DAILY_REPORT_COPY.en))for(const lang of ['en','fa','ar'])assert.ok(DAILY_REPORT_COPY[lang][key]);
});
function route({response={output_text:JSON.stringify(output)},error=null}={}){
 let paid=0,guarded=0,body;
 const context=vm.createContext({Buffer,Response,process:{env:{}},validateSiteProgressInput,normalizeSiteAssessment,SITE_PROGRESS_SCHEMA,SITE_PROGRESS_INSTRUCTIONS,sharp:()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},toBuffer:async()=>Buffer.from('image')}),getOpenAIClient:()=>({responses:{create:async(payload,options)=>{paid++;body=payload;assert.equal(options.maxRetries,0);if(error)throw error;return response;}}}),commercialRun:async(request,action,handler)=>{guarded++;assert.equal(action,'drawing');return handler(request);},renderFailure:()=>({status:429,body:{code:'RENDER_API_CREDIT_LIMIT',error:'Credit exhausted'}})});
 vm.runInContext(fs.readFileSync('src/app/api/ai/site-progress/route.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','')+'\nthis.run=POST;',context);
 return {run:async(data=input)=>context.run(new Request('https://example.com/api/ai/site-progress',{method:'POST',body:JSON.stringify(data)})),count:()=>({paid,guarded,body})};
}
test('actual route uses project billing guard and returns only a reviewed scope proposal',async()=>{
 const r=route(),response=await r.run();assert.equal(response.status,200);const result=await response.json();assert.equal(result.assessment.minimumPercent,60);assert.equal(result.assessment.requiresSupervisorReview,true);assert.equal(r.count().guarded,1);assert.equal(r.count().paid,1);assert.equal(r.count().body.input[1].content[1].type,'input_image');assert.ok(!('imageUrl' in result.assessment));
 const bad=route();assert.equal((await bad.run({...input,images:[]})).status,400);assert.equal(bad.count().paid,0);
});
test('provider failure does not return fabricated progress or successful evidence',async()=>{
 const r=route({error:new Error('No credits')});const result=await r.run();assert.equal(result.status,429);assert.ok(!(await result.json()).assessment);assert.equal(r.count().paid,1);
});

test('actual report form has camera capture, presets, scope review and translated controls without a paid request on render',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const code=await transform(fs.readFileSync('src/app/projects/[id]/ProjectDailyReports.jsx','utf8'),{filename:'ProjectDailyReports.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 let requests=0;
 for(const language of ['en','fa','ar']){
  let stateIndex=0;const context={exports:{},require:id=>{
   if(id==='react')return{...React,useState:initial=>{stateIndex++;return React.useState(stateIndex===7?()=>({...initial(),workType:'tiling'}):[2,4].includes(stateIndex)?true:initial);}};
   if(id==='@/app/components/i18n/LanguageProvider')return{useLanguage:()=>({language})};
   if(id==='next/image')return{default:props=>React.createElement('img',props)};
   if(id==='@/services/workspaceRecordsService')return{listWorkspaceRecords:async()=>({reports:[]}),createDailyReport:async()=>({})};
   if(id==='@/services/documentService')return{};
   if(id==='@/lib/commercialFetch')return{commercialFetch:()=>{requests++;throw new Error('Unexpected paid request');}};
   if(id==='@/lib/siteProgress.mjs')return{REPORT_PRESETS,SITE_WORKS,SITE_ZONES:[],labelFor,reviewedScopeProgress};
   if(id==='@/lib/dailyReportCopy.mjs')return{DAILY_REPORT_COPY};
   if(id.endsWith('.css'))return{};
   return require(id);
  }};
  vm.runInNewContext(code.code,context);const html=renderToStaticMarkup(React.createElement(context.exports.default,{projectId:'test'}));
  assert.ok(html.includes('capture="environment"'));assert.ok(html.includes(DAILY_REPORT_COPY[language].analyze));assert.ok(html.includes(DAILY_REPORT_COPY[language].confirm));assert.ok(html.includes(labelFor(SITE_WORKS[0],language)));assert.ok(html.includes('name="scope"'));assert.ok(html.includes('name="planned"'));assert.ok(html.includes('name="completed"'));
 }
 assert.equal(requests,0);
});
