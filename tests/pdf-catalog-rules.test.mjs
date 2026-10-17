import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mergePdfEvidence,pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
import {planPdfCatalogBindings,planPdfCatalogRules,resolvePdfCatalogRate,retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
import {requireBoqReview} from '../src/lib/boqEvidence.mjs';
import {classifyEstimateItem} from '../src/lib/estimateClassification.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {annotatePdfBoqCompletion} from '../src/lib/pdfBoqCompletion.mjs';

// The fixture is the user's actual successful local v121 report, reduced to
// quantities and complete pricing-boundary claims. All catalog rates below
// are test data; no production rate, database or model is accessed.
const observed=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-catalog-recovery.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../src/lib/serverBoqAnalysis.js',import.meta.url),'utf8');
const price=(code,description,unit='m2',rate=10,section='07')=>({item_code:code,description,unit,standard_rate:rate,section_code:section,is_active:true});
const rule=(item)=>({item_code:item.item_code,section_code:item.section_code,rule_name:'DB Auto: wall operation',formula_type:'manual',geometry_type:'wall',geometry_property:'area'});
async function run(prices,rules=[],takeoff=observed){
 const tables={price_items:structuredClone(prices),boq_rules:structuredClone(rules),boq_sections:[]},reads=[];
 let modelCalls=0,writes=0;
 const db={from(table){
  assert.ok(table in tables,`unexpected database access ${table}`);reads.push(table);
  const q={select(){return q;},eq(){return q;},order(){return q;},range(from,to){return Promise.resolve({data:tables[table].slice(from,to+1),error:null});},
   then(resolve,reject){return Promise.resolve({data:tables[table],error:null}).then(resolve,reject);},
   insert(){writes++;throw Error('database write forbidden');},delete(){writes++;throw Error('database write forbidden');}};return q;
 }};
 const forbidden=()=>{modelCalls++;throw Error('model calls forbidden');};
 const context=vm.createContext({planPdfCatalogRules,resolvePdfCatalogRate,retainUnboundPdfQuantities,annotatePdfBoqCompletion,mergePdfEvidence,requireBoqReview,classifyEstimateItem,
  process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://offline.invalid',SUPABASE_SECRET_KEY:'offline-only',VENTRA_DISABLE_BOQ_AI:'true'}},
  createClient:()=>db,NextResponse:{json:Response.json},console:{log(){},warn(){},error(){}},
  getSemanticRooms:()=>[],hydrateSemanticRoomQuantities:()=>({rooms:[],source:'offline empty room inventory'}),
  getDrawingEvidence:()=>null,applyDwgScheduleToBoq:items=>({items,warnings:[]}),
  buildLocalBoq:()=>{throw Error('PDF geometry allowance fallback forbidden');},
  inferConstructionScopes:forbidden,shortlistPriceCatalog:forbidden,matchScopesToCatalog:forbidden,resolveAiQuantity:forbidden});
 vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export /g,'')+'\nthis.handle=handleCommercialRequest;',context);
 const response=await context.handle({json:async()=>({takeoff:structuredClone(takeoff),priceLevel:'standard',vatPercentage:5})});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.success,true);
 assert.equal(modelCalls,0);assert.equal(writes,0);assert.deepEqual(prices,tables.price_items);assert.deepEqual(rules,tables.boq_rules);
 return {boq:result.boq,reads};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('observed interior plaster does not compete with exterior render, plaster ceilings or unknown plaster scope',()=>{
 close(pdfScheduledRule(observed,'Internal cement sand plaster to walls','m²').quantity,978.62);
 for(const description of ['External cement plaster to walls','Exterior plaster','Gypsum plaster to ceilings','Cement sand plaster','Internal and external plaster','External plastering to walls']){
  assert.equal(pdfScheduledRule(observed,description,'m2'),null,description);
 }
 const candidates=[price('INT','Internal cement sand plaster to walls'),price('EXT','External cement plaster to walls')];
 const plan=planPdfCatalogBindings(observed,candidates);assert.equal(plan.bindings.size,1);assert.equal(plan.bindings.get('INT').metricKey,'plaster_area');assert.equal(plan.warnings.length,0);
});
test('operation-specific descriptions and unit aliases retain distinct paint, tiles, waterproofing and cabinetry scopes',()=>{
 for(const [description,unit,key,value] of [
  ['Paint to internal ceilings','sq.m','ceiling_paint_area',360],
  ['Wet area wall tiles','sqm','wet_wall_tile_area',117.24],
  ['Wet area wall waterproofing','m2','wet_wall_waterproofing_area',97.92],
  ['Wet area floor waterproofing','m²','wet_floor_waterproofing_area',46],
  ['Kitchen backsplash','m2','backsplash_area',3],
  ['Kitchen base cabinets','lm','kitchen_cabinet_length',5],
 ]){const got=pdfScheduledRule(observed,description,unit);assert.equal(got?.metricKey,key);close(got.quantity,value);}
 for(const [description,unit] of [
  ['Wet area wall waterproofing','m'],['Kitchen base cabinets','m2'],
  ['Wet area wall and floor waterproofing','m2'],['Internal wall and ceiling paint','m2'],
  ['Cementitious waterproofing to toilets and wet areas','m2'],['Torch applied membrane to horizontal surfaces','m2'],
  ['PPR water pipe 20mm','m'],['Split AC unit 1.5 ton','nos'],['Single leaf timber door','nos'],
 ])assert.equal(pdfScheduledRule(observed,description,unit),null,description);
});
test('existing catalog items without geometry formulas can receive explicit PDF operations without mutating either inventory',()=>{
 const prices=[price('PL','Internal cement sand plaster to walls'),price('CEIL','Ceiling paint')],rules=[rule(prices[0])],snapshot=structuredClone({prices,rules});
 const p=planPdfCatalogRules(observed,rules,prices);
 assert.equal(p.bindings.size,2);assert.equal(p.rules.length,2);assert.equal(p.rules[1].item_code,'CEIL');assert.equal(p.rules[1].formula_type,'manual');
 assert.deepEqual({prices,rules},snapshot);
 const duplicate=planPdfCatalogRules(observed,p.rules,prices);assert.equal(duplicate.rules.length,2);
});
test('the full active catalog participates in ambiguity checks, even when only one variant has a geometry rule',async()=>{
 const prices=[price('PL-A','Internal cement sand plaster to walls'),price('PL-B','Interior wall plaster', 'm2',99)];
 const {boq}=await run(prices,[rule(prices[0])]);
 assert.equal(boq.items.find(i=>i.itemCode==='PL-A').quantity,0);
 const retained=boq.items.filter(i=>i.pdfEvidence?.metricKey==='plaster_area');assert.equal(retained.length,1);assert.equal(retained[0].rate,0);close(retained[0].quantity,978.62);
 assert.ok(boq.warnings.some(w=>w.includes('PL-A, PL-B')));
 const inactive=planPdfCatalogRules(observed,[],[prices[0],{...prices[1],is_active:false}]);assert.equal(inactive.bindings.size,1);
});
test('one inconsistent catalog code cannot bind a quantity to a different description or unit',()=>{
 for(const other of [price('SAME','Ceiling paint'),price('SAME','Unknown scope','m3')]){
  const plan=planPdfCatalogBindings(observed,[price('SAME','Internal wall plaster'),other]);assert.equal(plan.bindings.size,0);assert.ok(plan.warnings.length);
 }
});
test('actual server keeps internal and external PDF operations separate despite legacy whole-wall-family suppression',async()=>{
 const prices=[price('EXT','200mm thick concrete block wall','m2',66,'04'),price('INT','120mm thick concrete block wall','m2',51,'04'),price('PL','Internal cement sand plaster to walls','m2',17),price('RENDER','External cement plaster to walls','m2',19)];
 const {boq}=await run(prices,prices.map(rule));
 close(boq.items.find(i=>i.itemCode==='EXT').quantity,305.72);close(boq.items.find(i=>i.itemCode==='INT').quantity,336.45);close(boq.items.find(i=>i.itemCode==='PL').quantity,978.62);
 assert.equal(boq.items.find(i=>i.itemCode==='RENDER').quantity,0);
 for(const key of ['internal_block_area','external_block_area','plaster_area'])assert.equal(boq.items.filter(i=>i.quantity>0&&i.pdfEvidence?.metricKey===key).length,1);
 assert.equal(boq.summary.verifiedSubtotal,0);assert.equal(boq.summary.grandTotal,0);
 for(const i of boq.items.filter(i=>i.quantity>0&&i.rate>0))assert.equal(i.includeInCommercialTotal,false);
 const exported=buildBoqExport(boq.items,{});close(exported.sums.provisional,305.72*66+336.45*51+978.62*17);
});
test('actual server supports a populated existing catalog with zero formula rules, with no model or database write',async()=>{
 const prices=[price('PL','Internal cement sand plaster to walls','m²',17),price('CEIL','Ceiling paint','sqm',9)];
 const {boq}=await run(prices);
 close(boq.items.find(i=>i.itemCode==='PL').quantity,978.62);close(boq.items.find(i=>i.itemCode==='CEIL').quantity,360);
 assert.equal(boq.items.filter(i=>i.pdfEvidence?.metricKey==='ceiling_paint_area').length,1);
 const pending=boq.items.find(i=>i.pdfEvidence?.metricKey==='water_pipe_length');close(pending.quantity,80);assert.equal(pending.rate,0);
});
test('missing or incompatible catalog specifications remain unpriced rather than borrowing another operation rate',async()=>{
 const prices=[price('BLOCK','100mm thick concrete block wall','m2',31,'04'),price('PIPE','PPR water supply pipe 20mm','m',23,'08'),price('AC','Wall mounted split air conditioning unit 1.5 ton','nos',1200,'10')];
 const {boq}=await run(prices,prices.map(rule));
 for(const [key,quantity] of [['internal_block_area',336.45],['water_pipe_length',80],['ac_count',9]]){
  const row=boq.items.find(i=>i.pdfEvidence?.metricKey===key);close(row.quantity,quantity);assert.equal(row.rate,0);assert.equal(row.status,'measured_rate_pending');
 }
 assert.equal(boq.summary.provisionalSubtotal,0);
});
test('the non-PDF legacy wall-family suppression still applies to generic CAD quantities',async()=>{
 const prices=[price('EXT','200mm thick concrete block wall','m2',66,'04'),price('INT','120mm thick concrete block wall','m2',51,'04')];
 const {boq}=await run(prices,prices.map(rule),{wall_length:226,wall_area:642.17,wall_height:3.2,floor_area:372});
 assert.ok(boq.items.some(i=>i.itemCode==='EXT'));assert.ok(!boq.items.some(i=>i.itemCode==='INT'));
 assert.ok(boq.items.every(i=>!i.pdfEvidence));
});

test('unconfigured zero-rate dictionary entries cannot shadow published catalog items or create their own priced rules',()=>{
 const base=price('MAIN','Formwork to suspended slabs including props','m2',84,'03');
 const dictionary={...price('DICT','Formwork for Slabs','m2',0),section_code:null,source_name:''};
 const snapshot=structuredClone([base,dictionary]);
 const plan=planPdfCatalogRules(observed,[],[base,dictionary]);assert.equal(plan.bindings.size,1);assert.ok(plan.bindings.has('MAIN'));
 assert.equal(plan.rules.length,1);assert.equal(plan.rules[0].item_code,'MAIN');assert.equal(plan.catalogAudit.unconfiguredEntries,1);
 assert.deepEqual([base,dictionary],snapshot);
 const contradictory={...dictionary,item_code:'MAIN',description:'Unknown different scope',unit:'m3'};
 assert.equal(planPdfCatalogRules(observed,[],[base,contradictory]).bindings.size,0);
});
test('configured or directly priced variants remain competing specifications even when other metadata or rates are missing',()=>{
 const main=price('MAIN','Internal cement sand plaster to walls','m2',27,'08');
 const blank={...price('OTHER','Internal cement plaster 15mm','m2',0),section_code:null,source_name:''};
 for(const [variant,rules] of [[{...blank,section_code:'08'},[]],[{...blank,source_name:'Published supplier catalog'},[]],[{...blank,standard_rate:15},[]],[blank,[rule(blank)]]]){
  const plan=planPdfCatalogRules(observed,rules,[main,variant]);assert.equal(plan.bindings.size,0);assert.equal(plan.catalogAudit.unconfiguredEntries,0);
 }
});
test('PDF rates use only the selected item and retain an explicitly matched zero-rate operation without a painting median',async()=>{
 const prices=[price('EPOXY','Epoxy Floor Paint','m2',0,'09'),price('PAINT-A','Decorative paint','m2',20,'09'),price('PAINT-B','Exterior paint','m2',26,'09')];
 const {boq}=await run(prices,prices.map(rule));
 const row=boq.items.find(i=>i.itemCode==='EPOXY');close(row.quantity,28);assert.equal(row.rate,0);assert.equal(row.referenceRate,0);assert.equal(row.rateMissing,true);assert.equal(row.rateSource,'rate_missing_on_catalog_item');assert.equal(row.status,'measured_rate_pending');assert.equal(row.includeInCommercialTotal,false);
 assert.ok(!boq.items.some(i=>/median/.test(i.rateSource||'')));
 const exported=buildBoqExport([row]);assert.equal(exported.rows[0][7],'Quantity recorded / rate and specification pending');assert.equal(exported.sums.provisional,0);
 const own=resolvePdfCatalogRate({...prices[0],economy_rate:12,premium_rate:25},'premium');assert.equal(own.rate,25);assert.equal(own.source,'direct_premium_rate');
 assert.equal(resolvePdfCatalogRate({...prices[0],material_rate:8,labor_rate:3}).rate,11);
 assert.equal(resolvePdfCatalogRate({...prices[0],material_rate:-8,labor_rate:11}).missingRate,true);
});
test('non-PDF catalog peer fallback remains unchanged for the same unpriced legacy operation',async()=>{
 const prices=[price('EPOXY','Epoxy floor paint','m2',0,'09'),price('PAINT-A','Internal wall paint','m2',20,'09'),price('PAINT-B','Exterior paint','m2',26,'09')];
 const formula={...rule(prices[0]),formula_type:'direct',geometry_type:'floor',geometry_property:'area',multiplier:1};
 const {boq}=await run(prices,[formula],{floor_area:28,wall_area:0});
 const row=boq.items.find(i=>i.itemCode==='EPOXY');assert.ok(row);assert.equal(row.rate,23);assert.match(row.rateSource,/median/);
});

const realCatalog=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-price-catalog.json',import.meta.url),'utf8')).catalog;
const realPrices=realCatalog.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,
 section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,source_name:i.sourceName,category:i.category,sub_category:i.subCategory,
 standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate,is_active:true})));
test('actual 3762-entry user catalog reproduces and resolves dictionary interference without changing one rate or quantity',async()=>{
 const before=planPdfCatalogBindings(observed,realPrices);assert.ok(before.bindings.has('PNT-008'));assert.ok(before.bindings.has('PNT-010'));assert.ok(!before.bindings.has('CON-008'));
 const plan=planPdfCatalogRules(observed,[],realPrices);
 assert.equal(plan.catalogAudit.activeEntries,3762);assert.equal(plan.catalogAudit.commercialCandidates,52);assert.equal(plan.catalogAudit.unconfiguredEntries,3710);
 assert.equal(plan.bindings.size,18);assert.equal(plan.bindings.has('PNT-008'),false);
 // C15 is a catalog grade, not a grade declared by this source PDF.
 // The previous match silently used that specification for generic blinding.
 assert.equal(plan.bindings.has('CON-001'),false);
 const {boq}=await run(realPrices);assert.equal(boq.pdfCatalogAudit.unconfiguredEntries,3710);
 for(const [code,quantity,rate] of [['SITE-001',72.2,39],['CON-004',12.16813827160494,3550],['CON-005',75.6,78],['CON-006',138.06,90],['CON-007',118.5,94],['CON-008',360,84],['MAS-003',305.72,66],['FIN-001',978.62,27],['FIN-005',312,80]]){
  const row=boq.items.find(i=>i.itemCode===code);assert.ok(row,code);close(row.quantity,quantity);close(row.rate,rate);
 }
 assert.equal(boq.items.filter(i=>i.quantity>0&&i.rate>0).length,18);close(boq.summary.provisionalSubtotal,263274.75);assert.equal(boq.summary.verifiedSubtotal,0);
 const exported=buildBoqExport(boq.items,{vatPercentage:5});assert.equal(exported.summary.find(r=>r[0].startsWith('BOQ budget total'))[1],'276438.49');
 for(const [key,quantity] of [['epoxy_floor_area',28],['internal_block_area',336.45],['ceiling_paint_area',360],['wet_wall_tile_area',117.24],['wet_wall_waterproofing_area',97.92]]){
  const row=boq.items.find(i=>i.pdfEvidence?.metricKey===key);assert.ok(row,key);close(row.quantity,quantity);assert.equal(row.rate,0);
 }
 const physicalKeys=boq.items.filter(i=>i.quantity>0).map(i=>i.pdfEvidence?.metricKey);assert.equal(new Set(physicalKeys).size,physicalKeys.length);
 assert.ok(boq.items.every(i=>!i.includeInCommercialTotal));
 const reverse=planPdfCatalogRules(observed,[],[...realPrices].reverse());assert.deepEqual([...reverse.bindings.keys()].sort(),[...plan.bindings.keys()].sort());
 // Also exercise existing formulas for all configured items; formula contents
 // are test scaffolding because the catalog export does not include boq_rules.
 const configuredRules=realPrices.filter(i=>i.section_code).map(rule);
 const withRules=await run(realPrices,configuredRules);close(withRules.boq.summary.provisionalSubtotal,263274.75);
 assert.equal(withRules.boq.items.filter(i=>i.quantity>0&&i.rate>0).length,18);
 assert.equal(withRules.boq.pdfCompletion.unpricedMeasuredOperations,32);assert.equal(withRules.boq.pdfCompletion.catalogOptionsWithoutQuantity,34);
 assert.ok(withRules.boq.items.find(i=>i.pdfEvidence?.metricKey==='internal_block_area').notes.includes('[BOQ GAP]'));
});
