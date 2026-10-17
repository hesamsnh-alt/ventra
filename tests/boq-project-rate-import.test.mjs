import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {applyProjectRateCsv} from '../src/lib/boqProjectRates.mjs';
import {planPdfCatalogRules,retainUnboundPdfQuantities,resolvePdfCatalogRate} from '../src/lib/pdfBoqCoverage.mjs';
import {requireBoqReview} from '../src/lib/boqEvidence.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState} from '../src/lib/drawingWorkflowGate.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const takeoff={...JSON.parse(read('./fixtures/pdf-observed-catalog-recovery.json')),document_id:'source-pdf',analyzed_at:'2026-10-15T10:28:37.784Z'};
const catalog=JSON.parse(read('./fixtures/pdf-observed-price-catalog.json')).catalog;
const rates=read('./fixtures/pdf-villa02-test-rates.csv');
const source=read('../src/app/projects/[id]/ProjectBOQ.jsx');
const prices=catalog.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,
  source_name:i.sourceName,standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate})));
function baseline(){
  const plan=planPdfCatalogRules(takeoff,[],prices);
  const priced=[...plan.bindings].map(([code,q])=>{
    const p=prices.find(p=>p.item_code===code),rate=resolvePdfCatalogRate(p).rate;
    return requireBoqReview({id:code,itemCode:code,description:p.description,section:'Existing section',unit:p.unit,quantity:q.quantity,rate,rateMissing:false,
      status:'measured',verification:'verified',includeInCommercialTotal:false,quantityLocked:true,quantityBasis:'pdf_schedule_evidence',notes:q.evidence,pdfEvidence:{metricKey:q.metricKey,pages:q.pages,basis:q.evidence}});
  });
  const rows=retainUnboundPdfQuantities(priced,takeoff).items.map((r,i)=>({...r,id:r.id||`source-${i}`,itemNumber:String(i+1),quantityLocked:true}));
  return [...rows,...Array.from({length:33},(_,i)=>({id:`option-${i}`,itemCode:`OPTION-${i}`,description:'Existing catalog option',quantity:0,rate:0,unit:'m2',status:'quantity_pending'}))];
}
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
let serial=0;
function context(){
  const state={projectId:`rate-import-${++serial}`,projectName:'Same project',takeoff:structuredClone(takeoff),items:baseline(),projectRateImport:null,
    loadedBoqProject:null,loadingTakeoff:false,generating:false,applyingProjectRates:false,vatPercentage:5,overheadPercentage:0,profitPercentage:0,discountPercentage:0,
    warnings:[],assumptions:[],projectRateRequestRef:{current:0},projectRateContextRef:{current:null},error:'',message:'',writes:0,fetches:0,
    projectRateImportCalls:0,beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,applyProjectRateCsv,requireBoqReview,saveReadyBoq,
    commercialFetch(){state.fetches++;throw Error('Network calls forbidden.');},generateBoq:async()=>({items:baseline(),warnings:[],assumptions:[]}),
    console:{log(){},error(){},warn(){}},Date,Map,Set};
  state.loadedBoqProject=state.projectId;
  const store=new Map();state.window={localStorage:{setItem(k,v){state.writes++;store.set(k,v);},getItem(k){return store.get(k)||null;}}};state.store=store;
  state.refresh=()=>state.projectRateContextRef.current={...Object.fromEntries(['projectId','takeoff','items','loadedBoqProject','loadingTakeoff','generating','vatPercentage','overheadPercentage','profitPercentage','discountPercentage','warnings','assumptions'].map(k=>[k,state[k]]))};
  for(const [setter,key] of [['setItems','items'],['setProjectRateImport','projectRateImport'],['setApplyingProjectRates','applyingProjectRates'],['setErrorMessage','error'],['setMessage','message'],['setWarnings','warnings'],['setAssumptions','assumptions'],['setGenerating','generating'],['setTakeoff','takeoff']])state[setter]=v=>{state[key]=v;state.refresh();};
  state.setPriceLibraryItemId=()=>{};state.refresh();vm.createContext(state);
  vm.runInContext(slice('function normalizeSection(', '\nfunction escapeCsv(')+slice('  function saveProjectRateDraft(', '\n  function updateItem(')+
    slice('  async function generateFromTakeoff(', '\n  const generateBoqFromEffect=')+
    '\nthis.importCsv=importProjectRateCsv;this.restore=restoreBeforeProjectRates;this.normalize=normalizeItems;this.generate=generateFromTakeoff;',state);
  state.event=(text=rates)=>({target:{files:[{name:'test-rates.csv',size:text.length,text:async()=>text}],value:'chosen'}});
  return state;
}
const summary=items=>buildBoqExport(items,{vatPercentage:5});

test('project CSV applies all 48 rate matches to the observed BOQ, converts tonnes and merges source sinks without changing source data',()=>{
  const items=baseline(),before=structuredClone(items),original=structuredClone(takeoff),result=applyProjectRateCsv(items,takeoff,rates,{fileName:'test-rates.csv'});
  assert.equal(items.length,83);assert.equal(result.items.length,82);assert.equal(result.summary.appliedRows,48);assert.equal(result.summary.mergedRows,1);
  assert.deepEqual(result.summary.unboundCodes,['DOR-01','DOR-02','DOR-03','DOR-04']);assert.equal(result.summary.otherPricedRowsRetained,0);
  assert.equal(result.items.filter(i=>i.quantity>0&&i.rate>0).length,48);assert.equal(result.items.filter(i=>i.quantity>0&&!i.rate).length,1);
  const steel=result.items.find(i=>i.projectRateSelection?.itemCode==='REB-01');assert.equal(steel.unit,'kg');assert.ok(Math.abs(steel.quantity-takeoff.rebar_kg)<1e-7);assert.equal(steel.rate,4.5);
  assert.equal(steel.projectRateSelection.previousRows[0].unit,'ton');
  const sinks=result.items.filter(i=>i.pdfEvidence?.metricKeys?.includes('kitchen_sink_count'));assert.equal(sinks.length,1);assert.equal(sinks[0].quantity,2);
  assert.deepEqual(sinks[0].pdfEvidence.metricKeys,['kitchen_sink_count','laundry_sink_count']);
  assert.equal(summary(result.items).sums.provisional.toFixed(2),'492535.51');assert.equal(summary(result.items).sums.verified,0);
  assert.equal(summary(result.items).summary.find(r=>r[0].startsWith('BOQ budget total'))[1],'517162.29');
  assert.ok(result.items.filter(i=>i.projectRateSelection).every(i=>i.reviewRequired&&!i.includeInCommercialTotal&&i.rateSource.includes('Project CSV')&&i.notes.includes('test-rates.csv')));
  assert.deepEqual(items,before);assert.deepEqual(takeoff,original);
});
test('actual UI import saves the complete draft and restore point without a fetch, survives normalization, and restores pre-import rows',async()=>{
  const s=context(),before=structuredClone(s.items),event=s.event();await s.importCsv(event);
  assert.equal(s.error,'');assert.equal(s.fetches,0);assert.equal(event.target.value,'');assert.equal(s.applyingProjectRates,false);
  const stored=JSON.parse(s.store.get(`ventra:project-boq:${s.projectId}`));assert.equal(stored.items.length,82);assert.equal(stored.projectRateImport.appliedRows,48);
  assert.equal(stored.projectRateImport.csvText,rates);assert.equal(stored.projectRateImport.beforeItems.length,83);assert.equal(stored.vatPercentage,5);
  const reopened=s.normalize(stored.items),steel=reopened.find(i=>i.projectRateSelection?.itemCode==='REB-01');assert.equal(steel.rate,4.5);assert.equal(steel.unit,'kg');
  assert.equal(summary(reopened).sums.provisional.toFixed(2),'492535.51');
  s.projectRateImport=stored.projectRateImport;s.items=reopened;s.refresh();s.restore();
  assert.equal(s.projectRateImport,null);assert.equal(s.items.length,before.length);assert.equal(summary(s.items).sums.provisional.toFixed(2),'263274.75');
  assert.equal(JSON.parse(s.store.get(`ventra:project-boq:${s.projectId}`)).projectRateImport,null);assert.equal(drawingWorkflowState(s.projectId).active,null);
});
test('actual Generate BOQ handler reapplies the project CSV for the same PDF, with a fresh restore point',async()=>{
  const s=context();await s.importCsv(s.event());await s.generate(s.takeoff);
  assert.equal(s.error,'');assert.equal(summary(s.items).sums.provisional.toFixed(2),'492535.51');assert.equal(s.projectRateImport.beforeItems.length,83);
  assert.equal(s.projectRateImport.appliedRows,48);assert.ok(s.message.includes('reapplied'));assert.equal(s.fetches,0);
  const saved=JSON.parse(s.store.get(`ventra:project-boq:${s.projectId}`));assert.equal(saved.projectRateImport.documentId,takeoff.document_id);
});
test('project CSV cannot silently overwrite manual/changed quantities or duplicated scope rows',()=>{
  for(const change of [rows=>{const row=rows.find(i=>i.pdfEvidence?.metricKey==='foundation_volume');row.quantity=21;row.quantityBasis='manual_quantity_override';},
    rows=>{rows.find(i=>i.pdfEvidence?.metricKey==='foundation_volume').quantity=21;},
    rows=>{rows.push({...rows.find(i=>i.pdfEvidence?.metricKey==='foundation_volume'),id:'duplicate'});}]){
    const rows=baseline();change(rows);const before=structuredClone(rows),result=applyProjectRateCsv(rows,takeoff,rates);
    assert.equal(result.summary.appliedRows,47);assert.ok(result.summary.unboundCodes.includes('CON-02'));
    assert.ok(result.items.filter(i=>i.pdfEvidence?.metricKey==='foundation_volume').every(i=>!i.projectRateSelection));assert.deepEqual(rows,before);
  }
});
test('partial CSV keeps unrelated prices visible, zero means rate pending, and competing/answer files cannot fabricate priced scope',()=>{
  const rows=baseline(),csv='code,description_en,unit,rate_aed\nPL,Internal plaster,m2,0';
  const result=applyProjectRateCsv(rows,takeoff,csv);assert.equal(result.summary.appliedRows,1);assert.equal(result.summary.otherPricedRowsRetained,17);
  const plaster=result.items.find(i=>i.projectRateSelection);assert.equal(plaster.quantity,978.6199999999997);assert.equal(plaster.rate,0);assert.equal(plaster.status,'measured_rate_pending');
  assert.throws(()=>applyProjectRateCsv(rows,takeoff,'code,description_en,unit,rate_aed,quantity\nPL,Internal plaster,m2,30,999'));
  assert.throws(()=>applyProjectRateCsv(rows,takeoff,'code,description_en,unit,rate_aed\nA,Internal plaster,m2,30\nB,Internal plaster,m2,40'));
  assert.throws(()=>applyProjectRateCsv(rows,{},csv));
});
test('reapplying a CSV is financially idempotent and cannot duplicate the composite sink operation',()=>{
  const first=applyProjectRateCsv(baseline(),takeoff,rates),again=applyProjectRateCsv(first.items,takeoff,rates);
  assert.equal(again.summary.appliedRows,48);assert.equal(again.items.length,first.items.length);assert.equal(again.summary.mergedRows,0);
  assert.equal(summary(again.items).sums.provisional,summary(first.items).sums.provisional);
  assert.equal(again.items.filter(i=>i.projectRateSelection?.itemCode==='PLB-04').length,1);
});
test('actual import refuses invalid, oversized or answer-key files atomically, and never enters a model path',async()=>{
  for(const event of [()=>({target:{files:[{size:5*1024*1024,name:'large.csv',text:()=>{throw Error('must not read');}}]}}),
    s=>s.event('code,description_en,unit,rate_aed\nA,Unknown scope,m2,10'),s=>s.event('code,description_en,unit,rate_aed\nA,Internal plaster,m2,-30'),
    s=>s.event('code,description_en,unit,rate_aed,quantity\nA,Internal plaster,m2,30,999')]){
    const s=context(),before=structuredClone(s.items);await s.importCsv(event(s));assert.ok(s.error);assert.equal(s.writes,0);assert.deepEqual(s.items,before);assert.equal(s.fetches,0);assert.equal(drawingWorkflowState(s.projectId).active,null);
  }
});
test('storage quota failures do not publish unsaved rates or lose the original BOQ',async()=>{
  const s=context(),before=structuredClone(s.items);s.window.localStorage.setItem=()=>{throw Error('QuotaExceededError');};
  await s.importCsv(s.event());assert.ok(s.error.includes('Quota'));assert.deepEqual(s.items,before);assert.equal(s.projectRateImport,null);assert.equal(s.applyingProjectRates,false);assert.equal(drawingWorkflowState(s.projectId).active,null);
});
test('late file reads cannot cross project, document, edit or unmount boundaries',async()=>{
  for(const kind of ['project','document','edit','unmount']){
    const s=context(),before=structuredClone(s.items);let done;
    const event=s.event();event.target.files[0].text=()=>new Promise(resolve=>done=resolve);const pending=s.importCsv(event);
    if(kind==='project'){s.projectId='different-project';s.projectRateRequestRef.current++;}
    if(kind==='document')s.takeoff={...s.takeoff,document_id:'different-document'};
    if(kind==='edit')s.items=[...s.items,{id:'manual-edit',source:'manual',quantity:1,rate:10}];
    if(kind==='unmount')s.projectRateRequestRef.current++;
    s.refresh();done(rates);await pending;
    assert.equal(s.writes,0);assert.equal(s.projectRateImport,null);assert.equal(s.items.length,before.length+(kind==='edit'?1:0));
  }
});
test('active drawing work blocks import, and undo cannot restore quantities from an older PDF analysis',async()=>{
  const s=context(),token=beginDrawingWorkflow(s.projectId,'analysis');await s.importCsv(s.event());assert.equal(s.writes,0);finishDrawingWorkflow(s.projectId,token,true);
  await s.importCsv(s.event());const before=structuredClone(s.items);s.takeoff={...s.takeoff,analyzed_at:'new-analysis'};s.refresh();s.restore();
  assert.ok(s.error.includes('analysis has changed'));assert.equal(JSON.stringify(s.items),JSON.stringify(before));
});
test('legacy PDF point display units are corrected only from explicit schedule counts, while unrelated point units remain incompatible',()=>{
  const rows=baseline(),result=applyProjectRateCsv(rows,takeoff,rates);
  for(const code of ['ELE-01','ELE-02','FIR-01']){
    const row=result.items.find(i=>i.projectRateSelection?.itemCode===code);assert.equal(row.unit,'nr');assert.equal(row.projectRateSelection.sourceCountUnitRecovered,true);
  }
  const light=rows.find(i=>i.pdfEvidence?.metricKey==='light_count');light.quantityBasis='manual_point_quantity';
  const held=applyProjectRateCsv(rows,takeoff,rates);assert.ok(held.summary.unboundCodes.includes('ELE-01'));assert.equal(held.items.find(i=>i===light).unit,'point');
});
