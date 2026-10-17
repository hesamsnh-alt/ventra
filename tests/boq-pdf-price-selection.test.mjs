import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {catalogPriceEntries,boqUnitFactor,applyBoqCatalogSelection,editPdfBoqItem} from '../src/lib/boqPriceSelection.mjs';
import {confirmBoqReview,invalidateBoqReview,requireBoqReview} from '../src/lib/boqEvidence.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {annotatePdfBoqCompletion} from '../src/lib/pdfBoqCompletion.mjs';
import {planPdfCatalogRules,retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
const catalog=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-price-catalog.json',import.meta.url),'utf8')).catalog;
const observed=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-catalog-recovery.json',import.meta.url),'utf8'));
const client=readFileSync(new URL('../src/app/projects/[id]/ProjectBOQ.jsx',import.meta.url),'utf8');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const measured={id:'mass',itemCode:'PDF-REBAR_KG',description:'Measured reinforcement',quantity:12168.138,unit:'kg',rate:0,rateMissing:true,status:'measured_rate_pending',verification:'pending',includeInCommercialTotal:false,quantityLocked:true,quantityBasis:'pdf_schedule_evidence',pdfEvidence:{metricKey:'rebar_kg',pages:[8],basis:'Source bar schedule'},notes:'Source bar schedule. [BOQ GAP] applicable own rate required [/BOQ GAP]'};
const entries=catalogPriceEntries(catalog),steel=entries.find(e=>e.itemCode==='CON-004');
test('PDF picker uses all actual catalog entries and their own rates, without the fixed ten-item library or peer averages',()=>{
 assert.equal(entries.length,3762);assert.equal(steel.rate,3550);assert.equal(steel.unit,'ton');
 assert.equal(entries.find(e=>e.itemCode==='WIN-001').rate,750);
 assert.equal(entries.find(e=>e.itemCode==='FIN-005').rate,80);
 assert.equal(entries.find(e=>e.itemCode==='PNT-008').rateMissing,true);
 const component=catalogPriceEntries({sections:[{sectionCode:'08',items:[{itemCode:'OWN',unit:'m2',materialRate:8,laborRate:3}]}]})[0];assert.equal(component.rate,11);
});
test('catalog selection converts a measured kg quantity to tonnes and preserves original evidence without tender approval',()=>{
 const before=structuredClone(measured),selected=applyBoqCatalogSelection(measured,steel);
 close(selected.quantity,12.168138);assert.equal(selected.unit,'ton');assert.equal(selected.rate,3550);close(selected.amount,12.168138*3550);
 assert.deepEqual(selected.pdfEvidence,measured.pdfEvidence);assert.equal(selected.quantityLocked,true);assert.equal(selected.catalogSelection.originalUnit,'kg');assert.equal(selected.catalogSelection.quantityFactor,.001);
 assert.equal(selected.status,'provisional_estimate');assert.equal(selected.includeInCommercialTotal,false);assert.equal(selected.reviewRequired,true);assert.equal(selected.rateMissing,false);assert.ok(!selected.notes.includes('[BOQ GAP]'));assert.deepEqual(measured,before);
 const out=buildBoqExport([selected]);assert.equal(out.sums.verified,0);close(out.sums.provisional,selected.amount);
});
test('incompatible dimensions and unknown/zero rates are rejected atomically',()=>{
 const before=structuredClone(measured);
 for(const entry of [{...steel,unit:'m2'},{...steel,rate:0,rateMissing:true},{...steel,rate:NaN},{...steel,unit:'point'}])assert.throws(()=>applyBoqCatalogSelection(measured,entry));
 assert.deepEqual(measured,before);assert.equal(boqUnitFactor('m2','m³'),null);assert.equal(boqUnitFactor('nr','point'),null);assert.equal(boqUnitFactor('nos','nr'),1);
});
test('changing the display unit converts quantity and its rate together and invalidates an old review',()=>{
 const selected=applyBoqCatalogSelection(measured,steel),reviewed=confirmBoqReview(selected,'S02 / supplier quote',{scope:true,quantity:true,rate:true});
 const kg=editPdfBoqItem(reviewed,'unit','kg');close(kg.quantity,measured.quantity);close(kg.rate,3.55);close(kg.amount,selected.amount);assert.equal(kg.review.confirmed,false);assert.equal(kg.includeInCommercialTotal,false);
 assert.throws(()=>editPdfBoqItem(reviewed,'unit','m2'));
 const tonnes=editPdfBoqItem(kg,'unit','ton');close(tonnes.quantity,selected.quantity);close(tonnes.rate,3550);close(tonnes.amount,selected.amount);
});
test('manual completion changes pending rows into provisional budget rows, retains quantity provenance and never invents a quantity',()=>{
 const pending={...measured,itemCode:'PDF-FOUNDATION_VOLUME',description:'Foundation concrete — grade requires confirmation',quantity:0,unit:'m3',quantityBasis:'unavailable',pdfEvidence:null};
 const concrete=entries.find(e=>e.itemCode==='CON-002');
 const selected=applyBoqCatalogSelection(pending,concrete);assert.equal(selected.quantity,0);assert.equal(selected.status,'quantity_pending');assert.equal(selected.rate,400);
 assert.ok(selected.description.startsWith('Foundation concrete — '));assert.ok(selected.description.includes('C25'));assert.equal(selected.catalogSelection.originalDescription,pending.description);
 const completed=editPdfBoqItem(selected,'quantity',20.25);assert.equal(completed.quantity,20.25);assert.equal(completed.status,'provisional_estimate');assert.equal(completed.quantitySource,'manual');assert.equal(completed.quantityBasis,'manual_quantity_override');assert.equal(completed.originalMeasurement.quantity,0);assert.equal(completed.includeInCommercialTotal,false);
 const rated=editPdfBoqItem(measured,'rate',3.55);assert.equal(rated.status,'provisional_estimate');assert.equal(rated.rateMissing,false);close(rated.amount,measured.quantity*3.55);
 const cleared=editPdfBoqItem(rated,'rate',0);assert.equal(cleared.status,'measured_rate_pending');assert.equal(cleared.rateMissing,true);
 const noQuantity=editPdfBoqItem(completed,'quantity',0);assert.equal(noQuantity.status,'quantity_pending');assert.equal(buildBoqExport([noQuantity]).sums.provisional,0);
});
function clientContext(items=[measured]){
 const state={items:structuredClone(items),takeoff:{pdf_analysis:{}},priceLibraryItemId:items[0].id,priceLibraryRequestRef:{current:0},priceLibraryEntries:[],error:'',message:'',fetches:[],UAE_PRICE_LIBRARY:[{id:'legacy',rate:999}],
  catalogPriceEntries,boqUnitFactor,applyBoqCatalogSelection,editPdfBoqItem,invalidateBoqReview,requireBoqReview,
  commercialFetch:async(url,options)=>{state.fetches.push({url,options});return Response.json({success:true,catalog});},
  setItems:v=>{state.items=typeof v==='function'?v(state.items):v;},setPriceLibraryItemId:v=>state.priceLibraryItemId=v,setPriceSearch(){},
  setPriceLibraryEntries:v=>state.priceLibraryEntries=v,setErrorMessage:v=>state.error=v,setMessage:v=>state.message=v};
 vm.createContext(state);
 const opening=client.slice(client.indexOf('  async function openPriceLibrary'),client.indexOf('\n  function applyLibraryRate'));
 const applying=client.slice(client.indexOf('  function applyLibraryRate'),client.indexOf('\n  function exportCsv'));
 const editing=client.slice(client.indexOf('  function updateItem'),client.indexOf('\n  function addItem'));
 vm.runInContext(opening+applying+editing+'\nthis.open=openPriceLibrary;this.apply=applyLibraryRate;this.edit=updateItem;',state);return state;
}
test('actual existing picker handler performs only the catalog GET and applies compatible selected rates',async()=>{
 const s=clientContext();await s.open(s.items[0]);assert.equal(s.fetches.length,1);assert.equal(s.fetches[0].url,'/api/boq/catalog');assert.equal(s.fetches[0].options.method,'GET');assert.equal(s.priceLibraryEntries.length,3762);
 s.apply(s.priceLibraryEntries.find(e=>e.itemCode==='CON-004'));close(s.items[0].quantity,12.168138);assert.equal(s.items[0].rate,3550);assert.equal(s.error,'');assert.equal(s.priceLibraryItemId,null);
});
test('actual picker refuses incompatible selections and late catalog results cannot cross a project reset',async()=>{
 const s=clientContext();s.apply(entries.find(e=>e.itemCode==='WIN-001'));assert.ok(s.error.includes('compatible'));assert.equal(s.items[0].quantity,measured.quantity);assert.equal(s.items[0].rate,0);
 let resolve;s.commercialFetch=()=>new Promise(r=>resolve=r);const loading=s.open(s.items[0]);s.priceLibraryRequestRef.current++;s.priceLibraryEntries=[];
 resolve(Response.json({success:true,catalog}));await loading;assert.equal(s.priceLibraryEntries.length,0);
 const bad=clientContext();bad.commercialFetch=async()=>Response.json({success:false,error:'Catalog unavailable'},{status:503});await bad.open(bad.items[0]);assert.equal(bad.error,'Catalog unavailable');assert.equal(bad.priceLibraryEntries.length,0);
});
test('actual PDF edit handler resolves pending state while retaining source history, and the non-PDF picker retains its original path',async()=>{
 const s=clientContext();s.edit('mass','rate',3.55);assert.equal(s.items[0].status,'provisional_estimate');assert.equal(s.items[0].rateMissing,false);
 s.edit('mass','unit','m2');assert.ok(s.error);assert.equal(s.items[0].unit,'kg');
 const cad=clientContext();cad.takeoff={};await cad.open(cad.items[0]);assert.equal(cad.fetches.length,0);assert.equal(cad.priceLibraryEntries[0].id,'legacy');
});
test('a completed catalog selection survives the existing draft save and actual BOQ normalization on reopening',()=>{
 const selected=applyBoqCatalogSelection(measured,steel),values=new Map();
 saveReadyBoq({setItem:(k,v)=>values.set(k,v)},'project',{items:[selected],takeoff:{pdf_analysis:{}}},{loadedProject:'project',loading:false,generating:false});
 const stored=JSON.parse(values.get('ventra:project-boq:project'));
 const s=vm.createContext({requireBoqReview});
 for(const [start,end] of [['function normalizeSection','\nfunction reindexItems'],['function reindexItems','\nfunction formatCurrency'],['function normalizeUnit','\nfunction normalizeItems'],['function normalizeItems','\nfunction escapeCsv']])vm.runInContext(client.slice(client.indexOf(start),client.indexOf(end)),s);
 vm.runInContext('this.normalize=normalizeItems;',s);
 const reopened=s.normalize(stored.items)[0];close(reopened.quantity,12.168138);assert.equal(reopened.rate,3550);assert.equal(reopened.catalogSelection.itemCode,'CON-004');assert.equal(reopened.catalogSelection.originalUnit,'kg');assert.equal(reopened.status,'provisional_estimate');assert.equal(reopened.includeInCommercialTotal,false);
});
test('actual catalog and observed quantities yield specific gaps without declaring 33 zero catalog rows to be missing project scope',()=>{
 const prices=catalog.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,source_name:i.sourceName,standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate})));
 const plan=planPdfCatalogRules(observed,[],prices),bound=[...plan.bindings].map(([code,q])=>requireBoqReview({itemCode:code,quantity:q.quantity,rate:entries.find(e=>e.itemCode===code).rate,status:'measured',verification:'verified',pdfEvidence:{metricKey:q.metricKey}}));
 const retained=retainUnboundPdfQuantities(bound,observed).items;
 const opts=Array.from({length:33},(_,i)=>({itemCode:`CAT-${i}`,quantity:0,rate:0,status:'quantity_pending'}));
 const audited=annotatePdfBoqCompletion([...retained,...opts],observed,prices);
 assert.equal(audited.summary.pricedMeasuredOperations,18);assert.equal(audited.summary.unpricedMeasuredOperations,32);assert.equal(audited.summary.catalogOptionsWithoutQuantity,33);assert.equal(audited.summary.completePricedBudget,false);
 assert.equal(audited.gaps.find(g=>g.metric==='epoxy_floor_area').code,'catalog_rate_missing');assert.equal(audited.gaps.find(g=>g.metric==='ceiling_paint_area').code,'catalog_rate_missing');
 assert.ok(audited.gaps.find(g=>g.metric==='foundation_volume').required_information.some(t=>t.includes('grade')));
 assert.ok(audited.items.find(i=>i.itemCode==='CAT-0').notes.includes('not evidence of an additional missing project scope'));
 assert.equal(buildBoqExport(audited.items,{vatPercentage:5}).sums.provisional.toFixed(2),'263274.75');
 const repeated=annotatePdfBoqCompletion(audited.items,observed,prices);assert.deepEqual(repeated.summary,audited.summary);assert.equal(repeated.items.find(i=>i.itemCode==='CAT-0').notes,audited.items.find(i=>i.itemCode==='CAT-0').notes);
});
test('catalog GET serialization exposes existing component rates without any write or model call',async()=>{
 const source=readFileSync(new URL('../src/services/boqCatalogService.js',import.meta.url),'utf8');let writes=0;
 const rows={price_items:[{item_code:'OWN',description:'Recorded component price',unit:'m2',material_rate:8,labor_rate:3,equipment_rate:1,transport_rate:2}],boq_sections:[]};
 const db={from(name){assert.ok(name in rows);const q={select(){return q;},eq(){return q;},order(){return q;},range(){return Promise.resolve({data:rows[name]});},then(resolve,reject){return Promise.resolve({data:rows[name]}).then(resolve,reject);},insert(){writes++;throw Error('write forbidden');},update(){writes++;throw Error('write forbidden');}};return q;}};
 const s=vm.createContext({process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',SUPABASE_SECRET_KEY:'offline-only'}},createClient:()=>db});
 vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export /g,'')+'\nthis.load=loadBoqDatabaseCatalog;',s);
 const result=await s.load(),entry=catalogPriceEntries(result)[0];assert.equal(entry.rate,14);assert.equal(entry.rateSource,'fallback_component_rate');assert.equal(writes,0);
});
