import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocalBoq} from '../src/services/localBoqBuilder.js';
import {requireBoqReview,confirmBoqReview} from '../src/lib/boqEvidence.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
import {calculateProjectEstimate} from '../src/lib/projectEstimate.mjs';
import {quotationTotals} from '../src/lib/commercialDocument.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {snapshotKeys,validateSnapshot} from '../src/lib/commercialAccess.mjs';

// An explicitly known analysis result. This tests the real downstream modules,
// not an OpenAI call or the accuracy of extracting an arbitrary uploaded plan.
const takeoff={floor_area:20,ceiling_area:20,wall_area:54,wall_length:18,
  doors:[{width:1,height:2}],windows:[{width:2,height:1.5}]};
const projectId='qa-project-a';
const reviewed=()=>buildLocalBoq({takeoff,projectName:'QA 4m x 5m room'}).items
  .map(requireBoqReview).map(row=>confirmBoqReview(row,'QA reference: 4m x 5m plan',
    {scope:true,quantity:true,rate:true},'2026-11-05T00:00:00Z'));

test('known room quantities survive BOQ, persisted reload, estimate, quotation and export',()=>{
  const items=reviewed(),floor=items.find(r=>r.description==='Floor finish allowance');
  assert.equal(floor.quantity,20);
  assert.equal(items.find(r=>r.description.includes('windows')).quantity,3);
  const values=new Map(),storage={setItem:(k,v)=>values.set(k,v)};
  const boq={projectId,takeoff,items,vatPercentage:5};
  assert.equal(saveReadyBoq(storage,projectId,boq,{loadedProject:projectId,loading:false,generating:false}),true);
  const reloaded=JSON.parse(values.get(snapshotKeys(projectId).boq));
  const estimate={projectId,...calculateProjectEstimate({items:reloaded.items,basis:'boq',includeProvisional:false,contingencyPct:0,profitPct:0,vatPct:5})};
  assert.equal(estimate.expectedDirectCost,8575);assert.equal(estimate.finalTender,9003.75);
  const quotation={projectId,...quotationTotals([{quantity:1,rate:estimate.tenderBeforeVat}],5)};
  assert.deepEqual({subtotal:quotation.subtotal,vat:quotation.vat,total:quotation.total},{subtotal:8575,vat:428.75,total:9003.75});
  const file=buildBoqExport(reloaded.items,{vatPercentage:5,vat:estimate.vat,total:estimate.finalTender});
  assert.equal(file.sums.verified,8575);
  assert.equal(file.rows.reduce((s,row)=>s+Number(row[6]),0),8575);
  assert.equal(file.summary.at(-1)[1],'9003.75');
  assert.doesNotThrow(()=>validateSnapshot({boq:reloaded,estimate,quotation},projectId));
});
test('unreviewed generated prices cannot enter the verified-only estimate',()=>{
  const items=buildLocalBoq({takeoff}).items.map(requireBoqReview);
  const estimate=calculateProjectEstimate({items,basis:'boq',includeProvisional:false,vatPct:5});
  assert.equal(estimate.ready,false);assert.equal(estimate.finalTender,0);
  assert.equal(estimate.groups.provisional.length,items.length);
  assert.ok(buildBoqExport(items).rows.every(row=>row[8]==='No'));
});
test('missing plan measurements cannot masquerade as a priced customer estimate',()=>{
  const boq=buildLocalBoq({takeoff:{}});
  assert.equal(boq.items.length,0);assert.ok(boq.warnings.length);
  assert.equal(calculateProjectEstimate({items:boq.items,basis:'boq'}).ready,false);
});
test('switching projects cannot restore another customer commercial documents',()=>{
  assert.throws(()=>validateSnapshot({boq:{projectId:'qa-project-b',items:reviewed()}},projectId),/another project/);
  const writes=[],storage={setItem:(...args)=>writes.push(args)};
  assert.equal(saveReadyBoq(storage,projectId,{items:reviewed()},{loadedProject:'qa-project-b',loading:false,generating:false}),false);
  assert.equal(writes.length,0);
});
test('markup and VAT are applied once when an estimate becomes a quotation',()=>{
  const estimate=calculateProjectEstimate({items:reviewed(),basis:'boq',contingencyPct:10,profitPct:20,vatPct:5});
  const quote=quotationTotals([{quantity:1,rate:estimate.tenderBeforeVat}],5);
  assert.equal(quote.subtotal,11319);assert.equal(quote.vat,565.95);assert.equal(quote.total,11884.95);
});
