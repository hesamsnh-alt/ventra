import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {parse} from '@babel/parser';
import {applyBoqScope} from '../src/lib/boqScope.mjs';
import {mergeScopeBase,captureDefaultEdits} from '../src/lib/boqScopeStore.mjs';
import {priceScopeDefaults,removeIncludedDefaultComponents} from '../src/lib/boqScopeRates.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
const source=fs.readFileSync(new URL('../src/app/projects/[id]/ProjectBOQ.jsx',import.meta.url),'utf8');
const ast=parse(source,{sourceType:'module',plugins:['jsx']});
const body=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration.body.body;
const extract=name=>{const n=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end)};
const item=(id,metric)=>({id,description:id,unit:'m²',quantity:20,rate:50,pdfEvidence:{metricKey:metric},verification:'verified',status:'measured'});
function context(){
 const data=new Map(),s={projectId:'scope-test',projectName:'Test',takeoff:{document_id:'doc',floor_area:20},items:[item('paint','paint_area'),item('foundation','foundation_volume')],boqSource:{documentId:'doc'},
  scopeState:null,scopeApplying:false,AbortController,setTimeout,clearTimeout,loadingTakeoff:false,generating:false,applyingProjectRates:false,loadedBoqProject:'scope-test',warnings:[],assumptions:[],projectRateImport:null,vatPercentage:5,overheadPercentage:0,profitPercentage:0,discountPercentage:0,
  language:'fa',applyBoqScope,mergeScopeBase,captureDefaultEdits,priceScopeDefaults,removeIncludedDefaultComponents,saveReadyBoq,drawingWorkflowState:()=>({active:null}),calls:[],
  fetch:async(url,opts)=>{s.calls.push({url,opts});return {ok:true,json:async()=>({success:true,catalog:{sections:[]}})}},window:{localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}}};
 s.refresh=()=>s.scopeContext.current={projectId:s.projectId,takeoff:s.takeoff,items:s.items};s.scopeContext={current:null};s.refresh();
 for(const [setter,key]of [['setItems','items'],['setScopeState','scopeState'],['setWarnings','warnings'],['setScopeApplying','scopeApplying'],['setMessage','message']])s[setter]=v=>{s[key]=v;s.refresh()};
 vm.createContext(s);vm.runInContext(extract('priceAssumedRows')+'\n'+extract('applySavedScope')+'\nthis.apply=applySavedScope;',s);s.data=data;return s;
}
test('actual Apply handler filters saved BOQ and persists archive without AI or DB mutation',async()=>{
 const s=context();await s.apply({enabled:true,preset:'fitout',defaultsEnabled:false});
 assert.deepEqual(s.items.map(i=>i.id),['paint']);assert.equal(s.calls.length,0);
 const saved=JSON.parse(s.data.get('ventra:project-boq:scope-test'));assert.equal(saved.boqScope.baseItems.length,2);assert.ok(saved.warnings.some(x=>x.startsWith('[BOQ SCOPE]')));
 await s.apply({enabled:false});assert.deepEqual(s.items.map(i=>i.id),['paint','foundation']);assert.ok(!s.items.some(i=>i.scopeDisclosure));
});
test('catalog reads are GET only; failed catalog never fabricates a default rate',async()=>{
 const s=context();s.fetch=async(url,opts)=>{s.calls.push({url,opts});throw Error('offline')};
 await s.apply({enabled:true,preset:'fitout'});
 assert.equal(s.calls.length,1);assert.equal(s.calls[0].url,'/api/boq/catalog');assert.ok(!s.calls[0].opts.method);assert.equal(s.scopeState.report.catalogUnavailable,true);
 assert.ok(s.items.filter(i=>i.scopeDefault).every(i=>i.rate===0));assert.equal(s.items.find(i=>i.id==='paint').rate,50);
});
test('storage quota failure leaves displayed BOQ and rates intact',async()=>{
 const s=context(),before=structuredClone(s.items);s.window.localStorage.setItem=()=>{throw Error('QuotaExceededError')};
 await assert.rejects(s.apply({enabled:true,preset:'fitout',defaultsEnabled:false}),/Quota/);assert.deepEqual(s.items,before);assert.equal(s.scopeState,null);
});
test('late catalog response cannot overwrite an intervening BOQ edit',async()=>{
 const s=context();let resolve;s.fetch=()=>new Promise(r=>resolve=r);
 const pending=s.apply({enabled:true,preset:'fitout'});s.items=[...s.items,item('manual','door_count')];s.refresh();
 resolve({ok:true,json:async()=>({success:true,catalog:{sections:[]}})});await assert.rejects(pending,/Project or drawing changed/);
 assert.equal(s.data.size,0);assert.equal(s.items.length,3);
});
test('BOQ from another document is rejected before any catalog request or save',async()=>{
 const s=context();s.boqSource={documentId:'old-document'};
 await assert.rejects(s.apply({enabled:true,preset:'fitout'}),/another drawing/);assert.equal(s.calls.length,0);assert.equal(s.data.size,0);
});
test('in-progress analysis prevents scope mutation',async()=>{
 const s=context();s.drawingWorkflowState=()=>({active:'analysis'});
 await assert.rejects(s.apply({enabled:true,preset:'fitout'}),/Wait/);assert.equal(s.data.size,0);
});
