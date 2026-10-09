import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDrawingText, getDrawingEvidence} from '../src/lib/drawingEvidence.mjs';
test('APS viewer and nested metadata text retain object provenance without becoming quantities', () => {
  const result = collectDrawingText([
    {dbId:10, properties:[{displayName:'Text String',displayValue:'GENERAL NOTES\\PExterior wall framing 50x150 mm'}]},
    {objectid:22, properties:{Text:{Contents:'WINDOW SCHEDULE'}}},
    {dbId:30, properties:[{displayName:'Area',displayValue:125.35},{displayName:'Text Style',displayValue:'Standard'}]},
    {dbId:40, properties:[{displayName:'Text',displayValue:'42'}]},
  ]);
  assert.equal(result.records.length,2);
  assert.equal(result.records[0].dbId,10);
  assert.match(result.records[0].text,/NOTES\nExterior/);
  assert.equal(result.scheduleReconciled,false);
  assert.equal(result.records[0].verification,'unreviewed');
  assert.equal(result.window_count,undefined);
  assert.deepEqual(getDrawingEvidence({advanced_takeoff:{drawing_evidence:result}}),result);
});
test('text is deduplicated per object and bounded; unavailable evidence is explicit', () => {
  const item={dbId:1,properties:{Text:'Door schedule'},rawProperties:[{displayName:'Text',displayValue:'Door schedule'}]};
  assert.equal(collectDrawingText([item,item]).records.length,1);
  assert.equal(collectDrawingText([{dbId:1,properties:{Text:'A'.repeat(6001)}}]).truncated,true);
  assert.equal(collectDrawingText([]).status,'text_unavailable');
  const result=collectDrawingText(Array.from({length:501},(_,dbId)=>({dbId,properties:{Text:'Review notes'}})));
  assert.equal(result.records.length,500);
  assert.equal(result.truncated,true);
});
