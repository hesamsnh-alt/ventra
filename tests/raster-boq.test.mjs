import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRasterBoq,rasterOperationEvidence,isRasterTakeoff} from '../src/lib/rasterBoqEvidence.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {calculateBoqBudget,boqLineAmount} from '../src/lib/boqBudget.mjs';
import {currencySum} from '../src/lib/commercialDocument.mjs';
import {calculateProjectEstimate} from '../src/lib/projectEstimate.mjs';
import {quotationTotals} from '../src/lib/commercialDocument.mjs';
import {applyBoqCatalogSelection} from '../src/lib/boqPriceSelection.mjs';
import {applyBoqScope,scopeMetric} from '../src/lib/boqScope.mjs';
const live=JSON.parse(readFileSync(new URL('./fixtures/raster-live-extraction.json',import.meta.url)));
const moreLive=JSON.parse(readFileSync(new URL('./fixtures/raster-live-more-extraction.json',import.meta.url)));
const observed=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-price-catalog.json',import.meta.url))).catalog;
export const actualCatalog=observed.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,
  section_code:s.sectionCode==='UNASSIGNED'?null:s.sectionCode,source_name:i.sourceName,
  standard_rate:i.standardRate,economy_rate:i.economyRate,premium_rate:i.premiumRate})));
const metric=(b,k)=>b.items.filter(i=>i.imageEvidence?.metricKey===k);
const q=(key,value,unit='m2',scope_id='image',evidence='Printed source measurement')=>({key,value,unit,scope_id,evidence});
const take=(quantities,other={})=>({document_name:'independent.png',rooms:0,page_evidence:{kind:'quantity_schedule',quantities},...other});
const run=t=>buildRasterBoq({takeoff:t,prices:actualCatalog,projectName:'QA',vatPercentage:5});
for(const [index,expected] of [{floor:20,paint:50.67,windows:1.44,doors:1},{floor:24,paint:75.45,windows:2.88,doors:2},{floor:19,paint:56.67,windows:1.44,doors:1}].entries()){
 test(`saved LIVE QA-0${index+1}: exact operations, no duplicated variants, no invented HVAC/structure`,()=>{
  const input=structuredClone(live[index].takeoff),before=structuredClone(input),b=run(input);
  for(const [key,value] of [['ceramic_floor_area',expected.floor],['paint_area',expected.paint],['window_area',expected.windows],['door_count',expected.doors]]){
   assert.equal(metric(b,key).length,1,key);assert.equal(metric(b,key)[0].quantity,value,key);
  }
  assert.ok(!b.items.some(i=>/gypsum|concrete|air condition|interlock|grass/i.test(i.description)));
  assert.equal(new Set(b.items.map(i=>i.imageEvidence.metricKey)).size,b.items.length);
  assert.deepEqual(input,before,'Original extraction/3D data stays intact');
  assert.equal(buildBoqExport(b.items).sums.verified,0);
 });
}
test('larger measured window area stays m2, never number of windows',()=>{
 const b=run(take([q('window_count',3,'nr'),q('window_area',12.375)]));
 assert.equal(metric(b,'window_area')[0].quantity,12.375);assert.ok(['m2','m²'].includes(metric(b,'window_area')[0].unit));
});
test('window counts without dimensions remain count-only and unpriced',()=>{
 const b=run(take([q('window_count',7,'nr')]));assert.equal(metric(b,'window_area').length,0);
 const row=metric(b,'window_count')[0];assert.equal(row.quantity,7);assert.equal(row.unit,'nr');assert.equal(row.rate,0);
});
test('an explicit net paint operation is never deducted twice',()=>{
 const b=run(take([q('paint_area',102.25),q('door_area',8),q('window_area',12)],{wall_area:102.25,doors:4,windows:5}));
 assert.equal(metric(b,'paint_area')[0].quantity,102.25);
});
test('shared internal doors use the net operation instead of a scalar opening deduction',()=>{
 const b=run(take([q('paint_area',187.2)],{wall_area:240,door_area:20,window_area:12,rooms:6}));
 assert.equal(metric(b,'paint_area')[0].quantity,187.2);
});
test('repeated identical source claims do not duplicate material quantities',()=>{
 const a=q('ceramic_floor_area',32.4);const b=run(take([a,{...a}]));
 assert.equal(metric(b,'ceramic_floor_area').length,1);assert.equal(metric(b,'ceramic_floor_area')[0].quantity,32.4);
});
test('conflicting claims are withheld while unrelated measured work survives',()=>{
 const b=run(take([q('paint_area',20),q('paint_area',40),q('ceramic_floor_area',18)]));
 assert.equal(metric(b,'paint_area').length,0);assert.equal(metric(b,'ceramic_floor_area')[0].quantity,18);
 assert.ok(b.warnings.some(w=>/Conflicting/.test(w)));
});
test('wrong-unit evidence cannot be rescued by the summary count',()=>{
 const b=run(take([q('window_area',5,'nr'),q('paint_area',10)],{windows:5,window_area:5}));
 assert.equal(metric(b,'window_area').length,0);assert.ok(b.warnings.some(w=>/invalid units/.test(w)));
});
test('unknown scale and empty operation evidence reject BOQ rather than invent 125 allowances',()=>{
 assert.throws(()=>run(take([],{rooms:2,windows:3,doors:2,floor_area:0})),/No supported/);
 assert.throws(()=>run({document_name:'blank.png',floor_area:500}),/no saved operation evidence/);
});
test('project total overrides a room subset; uncertain scope is not summed',()=>{
 const b=run(take([q('paint_area',100,'m2','project'),q('paint_area',25,'m2','bedroom')]));
 assert.equal(metric(b,'paint_area')[0].quantity,100);
 const c=run(take([q('paint_area',40,'m2','A'),q('paint_area',50,'m2','B'),q('ceramic_floor_area',10)]));
 assert.equal(metric(c,'paint_area').length,0);
});
test('multiple finish operations preserve the measured split without pricing every alternative',()=>{
 const b=run(take([q('ceramic_floor_area',24),q('wood_floor_area',16),q('ceiling_paint_area',35)]));
 assert.equal(metric(b,'ceramic_floor_area')[0].quantity,24);assert.equal(metric(b,'wood_floor_area')[0].quantity,16);
 assert.equal(metric(b,'ceiling_paint_area')[0].quantity,35);assert.equal(b.items.length,3);
});
test('missing or competing catalog specifications keep one measured unpriced operation',()=>{
 const prices=[{item_code:'DOOR-A',unit:'nr',description:'Timber single leaf door',standard_rate:500,section_code:'06'},
 {item_code:'DOOR-B',unit:'nr',description:'Timber single leaf door',standard_rate:700,section_code:'06'}];
 const b=buildRasterBoq({takeoff:take([q('door_count',3,'nr')]),prices});
 assert.equal(b.items.length,1);assert.equal(b.items[0].quantity,3);assert.equal(b.items[0].rate,0);
});
test('partial room geometry cannot fabricate aggregate ceramic finish from floor area',()=>{
 const b=run(take([q('paint_area',30)],{floor_area:100,area_geometry:{basis:'clear_internal',coverage:'partial',spaces:[]}}));
 assert.equal(metric(b,'ceramic_floor_area').length,0);
});
test('overlapping/partial multi-room polygons cannot invent a whole-floor ceramic operation',()=>{
 const s={tag:'A',kind:'enclosed',evidence:'ceramic floor',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]};
 const b=run(take([q('paint_area',30)],{rooms:2,floor_area:32,page_evidence:{kind:'floor_plan',quantities:[q('paint_area',30)]},
  area_geometry:{basis:'clear_internal',spaces:[s,{...s,tag:'B'}]}}));
 assert.equal(metric(b,'ceramic_floor_area').length,0);
});
test('self-intersecting single-room geometry never supplies a measured finish quantity',()=>{
 const b=run(take([q('paint_area',30)],{rooms:1,floor_area:8,page_evidence:{kind:'floor_plan',quantities:[q('paint_area',30)]},
  area_geometry:{basis:'clear_internal',spaces:[{tag:'A',kind:'enclosed',evidence:'ceramic floor',polygon:[{x:0,y:0},{x:4,y:4},{x:0,y:4},{x:4,y:0}]}]}}));
 assert.equal(metric(b,'ceramic_floor_area').length,0);
});
test('missing opening dimensions never trigger standard-door or standard-window paint deductions',()=>{
 const b=run(take([q('door_count',1,'nr')],{rooms:1,doors:1,windows:1,wall_area:100,door_area:0,window_area:0,
  notes:'gross wall area; painted walls',page_evidence:{kind:'floor_plan',quantities:[q('door_count',1,'nr')]}}));
 assert.equal(metric(b,'paint_area').length,0);assert.equal(b.summary.subtotal,0);
});
test('image detection does not redirect PDF or CAD into the raster calculation',()=>{
 assert.equal(isRasterTakeoff({document_name:'plan.DWG'}),false);assert.equal(isRasterTakeoff({document_name:'plan.pdf'}),false);
 assert.equal(isRasterTakeoff({document_name:'plan.PNG'}),true);
});
test('all 375 observed financial rows reconcile after the fix, including half-up cents and VAT',()=>{
 const cases=[{quantity:16.875,rate:28.55},{quantity:9.61,rate:25.5},{quantity:9.61,rate:24.5},
  {quantity:1,rate:10.075}];
 assert.deepEqual(cases.map(boqLineAmount),[481.78,245.06,235.45,10.08]);
 const observedRows=JSON.parse(readFileSync(new URL('./fixtures/raster-live-financial.json',import.meta.url)));
 assert.equal(observedRows.length,375);
 for(const r of observedRows)assert.equal(boqLineAmount(r).toFixed(2),r.expected,`${r.case} row ${r.row}`);
 assert.equal(observedRows.filter(r=>r.original!==r.expected).length,12);
 const items=observedRows.map(r=>({...r,status:'provisional_estimate'}));
 const out=buildBoqExport(items,{vatPercentage:5});
 assert.equal(out.sums.provisional,currencySum(out.rows.map(r=>Number(r[6]))));
 const totals=calculateBoqBudget(out.sums,{vatPercentage:5});assert.equal(totals.total,currencySum([totals.subtotal,totals.vat]));
});
test('measured image quantities can receive a compatible reviewed project rate and match BOQ, Estimate and Quotation',()=>{
 const b=run(live[1].takeoff),floor=metric(b,'ceramic_floor_area')[0];
 const priced=applyBoqCatalogSelection(floor,{id:'own-quote',itemCode:'CERAMIC-QUOTE',description:'Specified ceramic tile',unit:'m2',rate:77,rateMissing:false});
 assert.equal(priced.quantity,24);assert.equal(priced.amount,1848);assert.equal(priced.reviewRequired,true);
 assert.throws(()=>applyBoqCatalogSelection(floor,{id:'bad',unit:'m3',rate:77}));
 const items=[priced,{status:'provisional_estimate',quantity:9.61,rate:25.5},{status:'provisional_estimate',quantity:1,rate:10.075}];
 const exported=buildBoqExport(items,{vatPercentage:5});
 const budget=calculateBoqBudget(exported.sums,{vatPercentage:5});
 const estimate=calculateProjectEstimate({items,basis:'boq',includeProvisional:true,vatPct:5});
 const quote=quotationTotals(items,5);
 assert.equal(budget.subtotal,2103.14);assert.equal(budget.vat,105.16);assert.equal(budget.total,2208.3);
 assert.equal(estimate.finalTender,budget.total);assert.equal(quote.total,budget.total);
 assert.equal(exported.sums.verified,0,'No silent human approval');
});
test('invalid legacy numerical data never crashes export or enters the verified subtotal',()=>{
 const rows=[{status:'measured',quantity:Infinity,rate:20},{status:'measured',quantity:3,rate:'bad'},
  {status:'measured',quantity:-2,rate:40}];
 const out=buildBoqExport(rows);assert.equal(out.sums.verified,0);assert.ok(out.rows.every(r=>r[8]==='No'));
});

test('LIVE QA-04 analysis undercounts partition faces: hold paint instead of pricing 82.87 m2',()=>{
 const input=structuredClone(moreLive[0].takeoff),before=structuredClone(input),b=run(input);
 const paint=metric(b,'paint_area');assert.equal(paint.length,1);
 assert.equal(paint[0].quantity,0);assert.equal(paint[0].rate,0);assert.equal(paint[0].status,'quantity_pending');
 assert.equal(paint[0].measurementIssue.claimedQuantity,82.87);
 assert.equal(paint[0].measurementIssue.minimum,99.24);assert.equal(paint[0].measurementIssue.maximum,117.6);
 assert.equal(metric(b,'ceramic_floor_area')[0].quantity,24);assert.equal(metric(b,'wood_floor_area')[0].quantity,12);
 assert.equal(metric(b,'window_area')[0].quantity,4.14);assert.equal(metric(b,'door_count')[0].quantity,3);
 assert.deepEqual(input,before,'The saved analysis is retained for diagnosis; no fabricated correction');
 assert.ok(b.warnings.some(w=>/Measurement conflict/.test(w)));
});
test('independently correct QA-04 room-face paint can pass the same audit',()=>{
 const t=structuredClone(moreLive[0].takeoff),paint=t.page_evidence.quantities.find(q=>q.key==='paint_area');
 paint.value=105.27;paint.evidence='All internal wall faces, net of openings: 42 x 2.8 - 1.89 - 2*(1.68+1.47) - 4.14 = 105.27 m2';
 const b=run(t);assert.equal(metric(b,'paint_area')[0].quantity,105.27);assert.equal(b.measurementIssues.length,0);
});
test('impossible paint above all gross room faces is also withheld',()=>{
 const t=structuredClone(moreLive[0].takeoff);t.page_evidence.quantities.find(q=>q.key==='paint_area').value=130;
 const b=run(t);assert.equal(metric(b,'paint_area')[0].status,'quantity_pending');
});
for(const [name,mutate] of [
 ['unknown height',t=>{t.notes='No measured height provided.';}],
 ['different room heights',t=>{t.notes+=' Room height = 3.20 m.';}],
 ['incomplete room inventory',t=>{t.area_geometry.spaces.pop();}],
 ['overlapping room geometry',t=>{t.area_geometry.spaces[1].polygon=t.area_geometry.spaces[0].polygon;}],
 ['unknown opening areas',t=>{t.page_evidence.quantities=t.page_evidence.quantities.filter(q=>q.key!=='door_area');t.door_area=0;}],
 ['a selected wall finish only',t=>{t.page_evidence.quantities.find(q=>q.key==='paint_area').evidence='Selected feature wall paint, net of openings.';}],
 ['another drawing scope',t=>{t.page_evidence.quantities.find(q=>q.key==='paint_area').scope_id='other-drawing';}],
])test(`wall-face audit does not invent a correction from ${name}`,()=>{
 const t=structuredClone(moreLive[0].takeoff);mutate(t);
 assert.equal(run(t).measurementIssues.length,0,'Insufficient/other-scope data cannot establish the whole-wall bound');
});
test('LIVE QA-05 separates terrace, enclosed ceiling, wet floor and 1.545 m2 upstand',()=>{
 const b=run(moreLive[1].takeoff);
 for(const [key,value] of Object.entries({ceramic_floor_area:28,terrace_floor_area:12,paint_area:79.89,
  ceiling_paint_area:28,wet_floor_waterproofing_area:8,wet_wall_waterproofing_area:1.545,window_area:2.76,door_count:3}))
  assert.equal(metric(b,key)[0].quantity,value,key);
 assert.equal(b.measurementIssues.length,0);assert.equal(b.items.length,8);
 assert.ok(!b.items.some(i=>/concrete|air condition|grass/i.test(i.description)));
});
test('QA-04 unresolved paint has no cost in BOQ, Estimate or Quotation',()=>{
 const b=run(moreLive[0].takeoff),items=b.items;
 const out=buildBoqExport(items,{vatPercentage:5}),budget=calculateBoqBudget(out.sums,{vatPercentage:5});
 const estimate=calculateProjectEstimate({items,basis:'boq',includeProvisional:true,vatPct:5});
 assert.equal(budget.subtotal,4953);assert.equal(budget.total,5200.65);
 assert.equal(estimate.finalTender,5200.65);assert.equal(quotationTotals(items,5).total,5200.65);
 assert.equal(out.sums.verified,0);assert.ok(items.some(i=>i.status==='quantity_pending'));
});
test('QA-05 measured operations retain correct rounded pricing through the complete commercial chain',()=>{
 const b=run(moreLive[1].takeoff);
 const budget=calculateBoqBudget(buildBoqExport(b.items,{vatPercentage:5}).sums,{vatPercentage:5});
 // Only three catalog-compatible operations are priced: 28*77 + 79.89*20 + 2.76*750.
 assert.equal(budget.subtotal,5823.8);assert.equal(budget.vat,291.19);assert.equal(budget.total,6114.99);
 assert.equal(calculateProjectEstimate({items:b.items,basis:'boq',includeProvisional:true,vatPct:5}).finalTender,6114.99);
 assert.equal(quotationTotals(b.items,5).total,6114.99);
 assert.equal(metric(b,'wet_wall_waterproofing_area')[0].quantity,1.545);
 assert.equal(metric(b,'wet_wall_waterproofing_area')[0].rate,0,'A compatible specification/rate is still needed');
});
test('enabling scope defaults cannot revive rejected wall paint or derive plaster from it',()=>{
 const t=moreLive[0].takeoff,b=run(t),scoped=applyBoqScope(b.items,t,{enabled:true,defaultsEnabled:true});
 const wall=scoped.items.filter(i=>['paint_area','plaster_area','wet_wall_tile_area'].includes(scopeMetric(i)));
 assert.equal(wall.length,1);assert.equal(wall[0].quantity,0);assert.equal(wall[0].status,'quantity_pending');
 assert.equal(wall[0].measurementIssue.claimedQuantity,82.87);
});
