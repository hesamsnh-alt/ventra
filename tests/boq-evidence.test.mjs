import test from 'node:test';
import assert from 'node:assert/strict';
import { requireBoqReview, confirmBoqReview, invalidateBoqReview } from '../src/lib/boqEvidence.mjs';
import { classifyEstimateItem } from '../src/lib/estimateClassification.mjs';
import { buildBoqExport } from '../src/lib/boqExport.mjs';

const measured = { id: 'column', description: 'Concrete C25', quantity: 4.21, unit: 'm3', rate: 400,
  amount: 1684, quantityBasis: 'aps_measured_column_volume', status: 'measured', verification: 'verified', includeInCommercialTotal: true };
test('measured volume does not prove concrete grade; gate preserves measurement and money', () => {
  const row = requireBoqReview(measured);
  assert.equal(row.quantity, 4.21);
  assert.equal(row.unit, 'm3');
  assert.equal(row.rate, 400);
  assert.equal(row.amount, 1684);
  assert.equal(row.quantityVerification, 'measured');
  assert.equal(classifyEstimateItem(row), 'provisional');
  assert.deepEqual(requireBoqReview(row), row);
});
test('review requires full checks and reference; invalid quantities and rates cannot be approved', () => {
  const row = requireBoqReview(measured);
  const checks = {scope:true, quantity:true, rate:true};
  assert.throws(() => confirmBoqReview(row, '', checks));
  assert.throws(() => confirmBoqReview(row, 'S-03 / quote Q1', {...checks, scope:false}));
  assert.throws(() => confirmBoqReview({...row, rate:0}, 'S-03 / quote Q1', checks));
  assert.throws(() => confirmBoqReview({...row, quantity:0}, 'S-03 / quote Q1', checks));
  const reviewed = confirmBoqReview(row, 'S-03 / quote Q1', checks, '2026-10-08T00:00:00Z');
  assert.equal(classifyEstimateItem(reviewed), 'verified');
  assert.deepEqual(requireBoqReview(JSON.parse(JSON.stringify(reviewed))), reviewed);
  assert.equal(classifyEstimateItem(invalidateBoqReview(reviewed)), 'provisional');
});
test('pending quantities and rates remain excluded; arbitrary plan counts are never rewritten', () => {
  for (const quantity of [16,42,7,29]) {
    const row = requireBoqReview({...measured, quantity, unit:'nos', description:'Window'});
    assert.equal(row.quantity, quantity);
    assert.equal(row.unit, 'nos');
  }
  assert.equal(classifyEstimateItem(requireBoqReview({...measured, status:'quantity_pending', verification:'pending', includeInCommercialTotal:false})), 'pending');
  assert.equal(classifyEstimateItem(requireBoqReview({...measured, rateMissing:true})), 'pending');
});
test('exports retain review references and separate unreviewed costs from tender basis', () => {
  const candidate = requireBoqReview(measured);
  const reviewed = confirmBoqReview(candidate, 'Drawing S-03 / quotation Q1', {scope:true, quantity:true, rate:true}, '2026-10-08');
  const result = buildBoqExport([candidate, reviewed], {});
  assert.match(JSON.stringify(result), /Drawing S-03 \/ quotation Q1/);
  assert.equal(classifyEstimateItem(candidate), 'provisional');
  assert.equal(classifyEstimateItem(reviewed), 'verified');
});
