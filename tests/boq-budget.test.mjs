import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBoqBudget } from '../src/lib/boqBudget.mjs';
import { buildBoqExport } from '../src/lib/boqExport.mjs';
test('all provisional BOQ still shows the full budget and VAT', () => {
  const result = calculateBoqBudget({verified:0, provisional:325178.55, pending:0}, {vatPercentage:5});
  assert.equal(result.subtotal, 325178.55);
  assert.equal(result.total.toFixed(2), '341437.48');
});
test('budget uses the same markup order and excludes unresolved amounts', () => {
  const result = calculateBoqBudget({verified:60, provisional:40, pending:20},
    {overheadPercentage:10, profitPercentage:20, discountPercentage:10, vatPercentage:5});
  assert.equal(result.displayed,120);
  assert.equal(result.subtotal,100);
  assert.equal(result.overhead,10);
  assert.equal(result.profit,22);
  assert.equal(result.total.toFixed(2),'124.74');
});
test('exports show a budget total even when reviewed tender total is zero', () => {
  const result = buildBoqExport([{status:'provisional_estimate', quantity:2, rate:50}], {vatPercentage:5, total:0});
  assert.deepEqual(result.summary.find(([label]) => label.startsWith('BOQ budget total')), ['BOQ budget total - including provisional and selected markups', '105.00']);
  assert.equal(result.summary.find(([label]) => label.startsWith('Tender price'))[1], '0.00');
});
