import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {generatePlanRender,validateRenderInput,planRenderPrompt} from '../src/lib/planRender.mjs';
const body={imageUrl:'data:image/jpeg;base64,YQ==',style:'modern',notes:'تراس را باز نگه دار؛ برای سرویس دوش پیشنهاد بده'};
test('Persian and Arabic outdoor labels outrank an incorrect indoor inference',()=>{
 for(const name of ['تراس','بالکن','ایوان','شُرْفَة','بلكونة']){const room={name,type:'bedroom'};assert.equal(canonicalRoomType(room),'balcony',name);assert.equal(room.name,name);}
 for(const name of ['سرویس','حمام','دستشویی','دورة المياه','WC'])assert.equal(canonicalRoomType({name}),'bathroom',name);
 assert.equal(canonicalRoomType({name:'آشپزخانه و غذاخوری'}),'kitchen_dining');
});
test('Render rejects arbitrary remote sources and unsupported or prototype style keys',()=>{
 for(const imageUrl of ['https://example.com/plan.jpg','data:text/html;base64,YQ=='])assert.throws(()=>validateRenderInput({...body,imageUrl}));
 for(const style of ['__proto__','constructor','unknown'])assert.throws(()=>validateRenderInput({...body,style}));
 assert.throws(()=>validateRenderInput({...body,notes:'x'.repeat(1201)}));
});
test('Source plan and Persian notes reach one high-quality image edit with no automatic retries',async()=>{
 const image={bytes:'source-plan'},controller=new AbortController();let calls=0;
 const result=await generatePlanRender(body,{image,signal:controller.signal,edit:async(payload,options)=>{
  calls++;assert.equal(payload.image,image);assert.equal(payload.n,1);assert.equal(payload.quality,'high');assert.ok(payload.prompt.includes(body.notes));assert.ok(payload.prompt.includes('never move walls'));assert.ok(payload.prompt.includes('compact shower'));assert.ok(payload.prompt.includes('3.20 metres'));assert.equal(options.maxRetries,0);assert.equal(options.signal,controller.signal);return {data:[{b64_json:'YQ=='}]};
 }});
 assert.equal(calls,1);assert.equal(result.kind,'concept_render');assert.equal(result.imageUrl,'data:image/jpeg;base64,YQ==');assert.equal(body.style,'modern');assert.ok(!('rooms' in result));
});
test('Style varies the image prompt while retaining source layout constraints',()=>{
 for(const style of ['modern','minimal','luxury'])assert.ok(planRenderPrompt({...body,style}).includes('Preserve the footprint'));
 assert.notEqual(planRenderPrompt(body),planRenderPrompt({...body,style:'luxury'}));
});
test('Provider failures and absent output cannot become a fabricated successful render',async()=>{
 let calls=0;await assert.rejects(generatePlanRender(body,{image:{},edit:async()=>{calls++;throw new Error('provider failed');}}),/provider failed/);assert.equal(calls,1);
 await assert.rejects(generatePlanRender(body,{image:{},edit:async()=>({data:[]})}),/no render/);
});

test('Actual render panel displays Persian, Arabic and English controls without running generation on render',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {loadComponent}=await import('./render-runtime.mjs');
 const language=await loadComponent('src/app/components/i18n/LanguageProvider.jsx');
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const code=await transform(readFileSync('src/app/projects/[id]/PlanRenderPanel.jsx','utf8'),{filename:'PlanRenderPanel.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 let calls=0;const sandbox={exports:{},require:id=>{
  if(id==='@/app/components/i18n/LanguageProvider')return language;
  if(id==='@/lib/commercialFetch')return{commercialFetch:()=>{calls++;throw new Error('Unexpected paid call');}};
  if(id==='@/lib/schematicStorage.mjs')return{readSchematic:async()=>null,saveSchematic:async()=>{}};
  if(id==='@/lib/brandWatermark.mjs')return{downloadBrandedImage:()=>{throw new Error('Unexpected export during render');}};
  if(id.endsWith('.module.css'))return{};return require(id);
 }};vm.createContext(sandbox);vm.runInContext(code.code,sandbox);
 for(const [locale,label] of [['en','Generate realistic render'],['fa','تولید رندر واقعی'],['ar','إنشاء التصيير الواقعي']]){
  const html=renderToStaticMarkup(React.createElement(language.default,{initialLanguage:locale},React.createElement(sandbox.exports.default,{projectId:'project'})));
  assert.ok(html.includes(label));assert.ok(html.includes('disabled=""'));assert.ok(html.includes('image/jpeg,image/png,image/webp'));
 }
 assert.equal(calls,0);
});
