import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRasterBoq} from '../src/lib/rasterBoqEvidence.mjs';
import {applyBoqCatalogSelection,editPdfBoqItem} from '../src/lib/boqPriceSelection.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {calculateProjectEstimate} from '../src/lib/projectEstimate.mjs';
import {quotationTotals} from '../src/lib/commercialDocument.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/raster-ground-floor-20261106.json',import.meta.url)));
const observed=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-price-catalog.json',import.meta.url))).catalog;
const catalog=observed.sections.flatMap(s=>s.items.map(i=>({item_code:i.itemCode,description:i.description,unit:i.unit,
  section_code:s.sectionCode,source_name:i.sourceName,standard_rate:i.standardRate})));
const policy=fixture.prices.find(i=>i.item_code==='VNT-DEF-DOOR-PACKAGE');
const run=(takeoff=structuredClone(fixture.takeoff),prices=[...catalog,policy],priceLevel='standard')=>
  buildRasterBoq({takeoff,prices,projectId:'qa-ground-floor',priceLevel});
const door=b=>b.items.find(i=>i.imageEvidence?.metricKey==='door_count');
test('live ground-floor PNG replays without AI: source identity and measured quantities retained, budget rate disclosed',()=>{
  const t=structuredClone(fixture.takeoff),before=structuredClone(t),b=run(t),d=door(b);
  assert.equal(b.boqSource.documentId,t.document_id);assert.equal(b.boqSource.name,t.document_name);
  assert.equal(b.items.length,3);assert.equal(d.quantity,3);assert.equal(d.rate,1260);assert.equal(d.amount,3780);
  assert.equal(d.defaultSpecification.catalogItemCode,'VNT-DEF-DOOR-PACKAGE');
  assert.equal(d.specificationVerification,'assumed');assert.equal(d.reviewRequired,true);
  assert.equal(d.includeInCommercialTotal,false);assert.match(d.description,/assumed specification/);
  assert.match(d.notes,/NOT A DRAWING SPECIFICATION/);assert.match(d.defaultSpecification.rateBasis,/DOR-001/);
  assert.equal(b.items.find(i=>i.imageEvidence.metricKey==='paint_area').quantity,126.81);
  assert.equal(b.items.find(i=>i.imageEvidence.metricKey==='window_area').quantity,5.04);
  assert.equal(b.summary.subtotal,10096.2);assert.equal(b.summary.grandTotal,10601.01);
  assert.ok(!b.warnings.some(w=>w.startsWith('Image quantity door_count retained as an unpriced row')));
  assert.deepEqual(t,before,'No change to the saved extraction or 3D input');
  assert.equal(buildBoqExport(b.items).sums.verified,0);
  assert.equal(calculateProjectEstimate({items:b.items,basis:'boq',includeProvisional:true,vatPct:5}).finalTender,b.summary.grandTotal);
  assert.equal(quotationTotals(b.items,5).total,b.summary.grandTotal);
});
for(const detail of ['Steel doors','Metal door set','Fire-rated doors','Aluminium doors','Glazed door','uPVC door',
  'Fiberglass door','FRP door','FD60 door','External doors','Garage door','Roller shutter door','Double-leaf doors','Sliding door','Acoustic doors','Security door'])
test(`source requirement ${detail} cannot inherit a timber budget assumption`,()=>{
  const t=structuredClone(fixture.takeoff);t.notes+=` ${detail}.`;
  assert.equal(door(run(t)).rate,0);
});
for(const [label,change] of [
  ['inactive',p=>({...p,is_active:false})],['unpriced',p=>({...p,standard_rate:0,economy_rate:0,premium_rate:0})],
  ['malformed',p=>({...p,source_reference:'not json'})],['wrong unit',p=>({...p,unit:'m2'})],
  ['wrong currency',p=>({...p,currency:'USD'})],
  ['disabled',p=>({...p,source_reference:JSON.stringify({...JSON.parse(p.source_reference),enabled:false})})],
])test(`${label} catalog policy leaves the measured doors unpriced`,()=>assert.equal(door(run(undefined,[...catalog,change(policy)])).rate,0));
test('competing default policies do not select the cheaper rate',()=>{
  assert.equal(door(run(undefined,[...catalog,policy,{...policy,item_code:'OTHER',standard_rate:500}])).rate,0);
});
test('plain catalog doors without an explicit default policy cannot silently specify timber',()=>{
  assert.equal(door(run(undefined,catalog)).rate,0);
});
test('oversized doors do not use the standard-door budget',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.find(q=>q.key==='door_area').value=12;
  assert.equal(door(run(t)).rate,0);
});
test('premium rate comes from the same configured policy, never a peer or an invented market rate',()=>{
  assert.equal(door(run(undefined,[...catalog,{...policy,premium_rate:1500}],'premium')).rate,1500);
});
test('description edits clear an assumed rate; explicit compatible catalog selection remains editable',()=>{
  const d=door(run());assert.equal(editPdfBoqItem(d,'description','Fire-rated steel door').rate,0);
  const selected=applyBoqCatalogSelection(d,{itemCode:'PROJECT-STEEL',description:'Steel door set',unit:'nos',rate:1800,rateSource:'supplier',section:'Doors'});
  assert.equal(selected.quantity,3);assert.equal(selected.amount,5400);assert.equal(selected.defaultSpecification.status,'superseded_by_catalog_selection');
});
test('policy rates with fractional cents reconcile with exported line amounts',()=>{
  const b=run(undefined,[...catalog,{...policy,standard_rate:10.075}]);
  assert.equal(door(b).amount,30.23);assert.equal(quotationTotals(b.items,5).total,b.summary.grandTotal);
});
