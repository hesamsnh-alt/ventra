import test from 'node:test';
import assert from 'node:assert/strict';
import {demoReport, downloadDemoReport} from '../src/lib/demoReport.mjs';
test('sample report reconciles its displayed BOQ and does not certify sample quantities', () => {
  assert.equal(demoReport.sample,true);
  assert.equal(demoReport.scopeComplete,false);
  assert.equal(demoReport.boqSubtotalAED,613740);
  assert.equal(demoReport.boq.reduce((sum,row)=>sum+row.amountAED,0),demoReport.boqSubtotalAED);
  assert.ok(demoReport.boq.every(row=>row.verification==='sample_unreviewed'));
  assert.equal(demoReport.scheduleMode,'sequential');
});
test('report download creates readable JSON and triggers a downloadable file', async () => {
  const oldDocument=globalThis.document, oldWindow=globalThis.window;
  const create=URL.createObjectURL, revoke=URL.revokeObjectURL;
  let blob,clicked=false,removed=false,revoked=false;
  const link={click(){clicked=true;},remove(){removed=true;}};
  globalThis.document={createElement(){return link;},body:{appendChild(){}}};
  globalThis.window={setTimeout(fn){fn();}};
  URL.createObjectURL=value=>{blob=value;return 'blob:sample';};
  URL.revokeObjectURL=()=>{revoked=true;};
  try {
    downloadDemoReport();
    assert.deepEqual(JSON.parse(await blob.text()),demoReport);
    assert.equal(link.download,'ventra-sample-report.json');
    assert.ok(clicked&&removed&&revoked);
  } finally {globalThis.document=oldDocument;globalThis.window=oldWindow;URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});
