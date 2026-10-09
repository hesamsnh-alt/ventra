import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateProjectEstimate as estimate} from '../src/lib/projectEstimate.mjs';

const items = [
  {section:'Structure',status:'measured',quantity:1,rate:168147.92},
  {section:'MEP',status:'provisional_estimate',quantity:1,rate:157030.63},
  {section:'Structure',status:'quantity_pending',quantity:0,rate:100},
];
const close = (a,b) => assert.ok(Math.abs(a-b)<0.000001, `${a} != ${b}`);

test('floor-area estimate stays independent from BOQ, with a signed reconciliation',()=>{
  const result=estimate({items,floorArea:125.35,ratePerSqm:4200,contingencyPct:7.5,profitPct:12,vatPct:5});
  close(result.expectedDirectCost,526470);
  close(result.coveredBoqCost,325178.55);
  close(result.benchmarkDifference,201291.45);
  close(result.finalTender,665563.374);
  const lower=estimate({items,floorArea:1,ratePerSqm:100});
  assert.equal(lower.expectedDirectCost,100);
  assert.ok(lower.benchmarkDifference<0); // no hidden max(BOQ, benchmark)
});

test('BOQ mode equals listed costs without markups and cannot inherit a benchmark top-up',()=>{
  const result=estimate({items,basis:'boq',floorArea:125.35,ratePerSqm:4200});
  close(result.expectedDirectCost,325178.55);
  close(result.finalTender,325178.55);
  assert.equal(result.groups.pending.length,1);
});

test('excluding provisional costs matches the verified BOQ subtotal',()=>{
  const result=estimate({items,basis:'boq',includeProvisional:false});
  close(result.finalTender,168147.92);
  assert.equal(result.includedProvisionalCost,0);
  assert.equal(result.ready,true); // BOQ mode does not require a floor area
});

test('markups are applied once to the selected direct cost and existing BOQ markups cannot leak in',()=>{
  const result=estimate({items:[{status:'manual',quantity:2,rate:50}],basis:'boq',contingencyPct:10,profitPct:20,vatPct:5,
    overheadPercentage:99,profitPercentage:99,discountPercentage:99});
  close(result.expectedDirectCost,100);close(result.contingency,10);close(result.profit,22);
  close(result.tenderBeforeVat,132);close(result.vat,6.6);close(result.finalTender,138.6);
});

test('invalid rate/quantity is unresolved, and section summaries conserve every row and cost',()=>{
  const result=estimate({basis:'boq',items:[...items,{section:'MEP',status:'measured',quantity:2,rate:'invalid'}]});
  assert.equal(result.groups.pending.length,2);
  assert.equal(result.sections.reduce((s,r)=>s+r.count,0),4);
  close(result.sections.reduce((s,r)=>s+r.verified+r.provisional,0),result.coveredBoqCost);
  assert.equal(estimate({basis:'boq',items:[]}).ready,false);
  assert.equal(estimate({basis:'benchmark',items,floorArea:0,ratePerSqm:4200}).ready,false);
});

test('scenario range is an explicit editable assumption',()=>{
  const result=estimate({basis:'boq',items:[{status:'manual',quantity:1,rate:100}],scenarioPct:20});
  close(result.low,80);close(result.high,120);
  const none=estimate({basis:'boq',items:[{status:'manual',quantity:1,rate:100}],scenarioPct:0});
  close(none.low,100);close(none.high,100);
});
