import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTotals, quotationLineAmount} from '../src/lib/commercialDocument.mjs';

for (const [rate, expected] of [[10.075,10.08],[1.005,1.01],[1.255,1.26],[0.005,.01],[0.004,0],[100.005,100.01]]) {
  test('rounds decimal midpoint '+rate+' in integer fils', () => {
    assert.equal(quotationLineAmount({quantity:1,rate}),expected);
    assert.equal(quotationTotals([{quantity:1,rate}],0).subtotal,expected);
  });
}
test('rounds quantities and rates as decimal products before adding rows', () => {
  assert.deepEqual(quotationTotals([{quantity:'0.3',rate:'33.25'}, {quantity:'1',rate:'10.075'}],5),
    {subtotal:20.06,vat:1,total:21.06});
});
test('keeps repeated fractional rows and fractional VAT deterministic', () => {
  assert.deepEqual(quotationTotals(Array.from({length:1000},()=>({quantity:1,rate:'10.075'})), '7.5'),
    {subtotal:10080,vat:756,total:10836});
});
for (const value of [null,undefined,false,true,' ','\t',{},[],NaN,Infinity,-1]) {
  test('rejects missing or nonnumeric commercial input '+JSON.stringify(value), () => {
    assert.throws(()=>quotationTotals([{quantity:1,rate:value}],5));
    assert.throws(()=>quotationTotals([{quantity:value,rate:1}],5));
    assert.throws(()=>quotationTotals([],value));
  });
}
test('supports zero, exponent notation and zero VAT without losing pennies', () => {
  assert.deepEqual(quotationTotals([{quantity:'1e2',rate:'0.10075'},{quantity:0,rate:100}],0),
    {subtotal:10.08,vat:0,total:10.08});
});
test('rounds VAT half-up and rejects amounts beyond safe integer fils', () => {
  assert.deepEqual(quotationTotals([{quantity:1,rate:10.1}],5),{subtotal:10.1,vat:.51,total:10.61});
  assert.throws(()=>quotationTotals([{quantity:1e300,rate:1e300}],5),/too large/);
  assert.throws(()=>quotationTotals([{quantity:1,rate:Number.MAX_SAFE_INTEGER/100}],100),/too large/);
});
test('quote totals conserve rows against an independent integer-fils oracle', () => {
  let seed=527;
  const next=()=>seed=(seed*1664525+1013904223)>>>0;
  for(let scenario=0;scenario<200;scenario++){
    const rows=Array.from({length:1+next()%20},()=>({quantity:next()%100,rate:(next()%100000)/1000}));
    const expectedCents=rows.reduce((sum,r)=>sum+Math.floor((r.quantity*Math.round(r.rate*1000)+5)/10),0);
    const vatPct=next()%101,vatCents=Math.floor((expectedCents*vatPct+50)/100);
    assert.deepEqual(quotationTotals(rows,vatPct),{subtotal:expectedCents/100,vat:vatCents/100,total:(expectedCents+vatCents)/100});
  }
});
