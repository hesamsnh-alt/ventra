import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from '@babel/parser';
import {createScopeManualItem,drawingUploadHref} from '../src/lib/boqScopeManual.mjs';
import {BOQ_TRADES,BOQ_PRESETS,boqItemTrade,applyBoqScope} from '../src/lib/boqScope.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
import {mergeScopeBase} from '../src/lib/boqScopeStore.mjs';
const input={trade:'plumbing',description:'PPR supply pipe',quantity:15,unit:'m',rate:30,basis:'Measured route on M01'};
test('manual row carries entered quantity, unit, rate and basis, remaining provisional',()=>{
 const i=createScopeManualItem(input,'new');assert.equal(i.amount,450);assert.equal(i.quantity,15);assert.equal(i.unit,'m');assert.equal(i.boqTrade,'plumbing');assert.equal(i.quantityBasis,input.basis);assert.equal(i.status,'provisional_estimate');assert.equal(i.includeInCommercialTotal,false);
});
test('unpriced entry retains known quantity and flags missing rate',()=>{const i=createScopeManualItem({...input,rate:0},'new');assert.equal(i.quantity,15);assert.equal(i.rateMissing,true);assert.equal(i.status,'measured_rate_pending');});
test('bad or empty manual fields are rejected',()=>{
 for(const patch of [{quantity:0},{quantity:-1},{quantity:NaN},{rate:-2},{description:''},{unit:'banana'},{trade:'unclassified'}])assert.throws(()=>createScopeManualItem({...input,...patch},'x'));
});
test('railings and landscape classify from general operation descriptions and semantic quantities',()=>{
 assert.ok(BOQ_TRADES.includes('metalwork'));assert.ok(BOQ_PRESETS.full.includes('external'));
 for(const [description,trade] of [['Stainless steel and glass infill terrace railing supplied and installed','metalwork'],['Natural grass soft landscaping including soil preparation and laying','external']])assert.equal(boqItemTrade({description}),trade);
 assert.equal(boqItemTrade({pdfEvidence:{metricKey:'terrace_railing_length'}}),'metalwork');
});
test('classifying external works changes scope only; source quantities and rates stay intact',()=>{
 const items=[{id:'rail',description:'Terrace railing',quantity:23,rate:500},{id:'grass',description:'Grass landscaping',quantity:90,rate:40}];
 const original=structuredClone(items);const r=applyBoqScope(items,{}, {enabled:true,preset:'full',defaultsEnabled:false});assert.equal(r.items.length,2);assert.deepEqual(items,original);assert.equal(r.items[0].rate,500);
 const excluded=applyBoqScope(items,{}, {enabled:true,preset:'fitout',defaultsEnabled:false});assert.equal(excluded.items.length,0);assert.equal(excluded.excluded.length,2);
});
test('supporting-drawing link targets the actual drawings tab and upload anchor',()=>assert.equal(drawingUploadHref('project-123'),'/projects/project-123?tab=drawings#drawing-upload'));
const source=readFileSync(new URL('../src/app/projects/[id]/ProjectBOQ.jsx',import.meta.url),'utf8');
const body=parse(source,{sourceType:'module',plugins:['jsx']}).program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration.body.body;
const n=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='addScopedManual');
function context(){
 const store=new Map(),s={projectId:'p',projectName:'test',items:[{id:'old',quantity:10,rate:100}],takeoff:{document_id:'doc'},boqSource:{documentId:'doc'},scopeState:{baseItems:[{id:'old',quantity:10,rate:100}],selectedIds:['old'],report:{activeTrades:['plumbing']}},loadingTakeoff:false,generating:false,scopeApplying:false,applyingProjectRates:false,loadedBoqProject:'p',warnings:[],assumptions:[],projectRateImport:null,vatPercentage:5,overheadPercentage:0,profitPercentage:0,discountPercentage:0,language:'en',createScopeManualItem,mergeScopeBase,saveReadyBoq,crypto:{randomUUID:()=> 'new'},drawingWorkflowState:()=>({active:null}),reindexItems:items=>items.map((i,index)=>({...i,itemNumber:String(index+1)})),window:{localStorage:{setItem:(k,v)=>store.set(k,v)}}};
 for(const [setter,key] of [['setItems','items'],['setScopeState','scopeState'],['setMessage','message']])s[setter]=v=>s[key]=v;
 vm.createContext(s);vm.runInContext(source.slice(n.start,n.end)+'\nthis.add=addScopedManual;',s);s.store=store;return s;
}
test('actual manual-save handler persists the new row and archive before publishing UI state',()=>{
 const s=context();s.add(input);assert.equal(s.items.length,2);assert.equal(s.items[0].rate,100);
 const saved=JSON.parse(s.store.get('ventra:project-boq:p'));assert.equal(saved.items[1].amount,450);assert.equal(saved.boqScope.baseItems.length,2);assert.ok(saved.boqScope.selectedIds.includes('new'));
});
test('manual-save quota failure publishes no new row',()=>{const s=context();s.window.localStorage.setItem=()=>{throw Error('QuotaExceededError')};assert.throws(()=>s.add(input),/Quota/);assert.equal(s.items.length,1);});
test('manual-save cannot bypass the selected discipline or active analysis lock',()=>{
 const s=context();assert.throws(()=>s.add({...input,trade:'structure'}),/Enable this trade/);s.generating=true;assert.throws(()=>s.add(input),/Wait/);assert.equal(s.store.size,0);
});
