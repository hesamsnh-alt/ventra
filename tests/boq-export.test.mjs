import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoqExport } from '../src/lib/boqExport.mjs';

test('export reconciles every row without adding provisional or pending costs to tender', () => {
  const items = [
    {itemNumber:'1', quantity:2, rate:100, status:'measured'},
    {itemNumber:'2', quantity:3, rate:50, status:'provisional_estimate', includeInCommercialTotal:true},
    {itemNumber:'3', quantity:1, rate:20, status:'quantity_pending', verification:'verified'},
  ];
  const result = buildBoqExport(items, {vatPercentage:5, vat:10, total:210});
  assert.deepEqual(result.sums, {verified:200, provisional:150, pending:20});
  assert.deepEqual(result.rows.map(row => row[8]), ['Yes','No','No']);
  assert.equal(result.summary[3][1], '370.00');
  assert.equal(result.summary[0][1], '200.00');
  assert.equal(result.summary.at(-1)[1], '210.00');
  assert.ok(result.rows.every(row => row.length === result.headers.length));
});

test('export retains quantity and pricing provenance and formats money at two decimals', () => {
  const item = {quantity:10.03, rate:39, status:'provisional_estimate', source:'derived', quantityBasis:'Area allowance', rateSource:'Catalog', notes:'Needs review'};
  const result = buildBoqExport([item]);
  assert.equal(result.rows[0][6], '391.17');
  assert.deepEqual(result.rows[0].slice(9), ['derived','Area allowance','Catalog','Needs review']);
  assert.equal(result.summary[1][1], '391.17');
});

test('empty and legacy excluded rows do not appear included in tender', () => {
  assert.equal(buildBoqExport([]).summary[3][1], '0.00');
  const result = buildBoqExport([{quantity:1, rate:100, verification:'verified', includeInCommercialTotal:false}]);
  assert.equal(result.sums.pending, 100);
  assert.equal(result.rows[0][8], 'No');
});
