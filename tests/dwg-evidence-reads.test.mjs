import test from 'node:test';import assert from 'node:assert/strict';import {readDwgEvidencePair} from '../src/lib/dwgEvidenceReads.mjs';
test('independent double reads run concurrently, retaining results in their correct order',async()=>{
 let calls=0;const resolves=[];const work=readDwgEvidencePair(signal=>{calls++;assert.equal(signal.aborted,false);return new Promise(r=>resolves.push(r));},{timeoutMs:1000});
 assert.equal(calls,2);resolves[1]({read:2});resolves[0]({read:1});assert.deepEqual(await work,[{read:1},{read:2}]);
});
test('deadline aborts both slow reads instead of holding analysis open for minutes',async()=>{
 const signals=[];await assert.rejects(readDwgEvidencePair(signal=>{signals.push(signal);return new Promise(()=>{});},{timeoutMs:10}),e=>e.name==='AbortError');assert.equal(signals.length,2);assert.ok(signals.every(s=>s.aborted));
});
test('provider failure aborts the companion read and is not a successful schedule',async()=>{
 const signals=[];await assert.rejects(readDwgEvidencePair(signal=>{signals.push(signal);return signals.length===1?Promise.reject(new Error('quota')):new Promise(()=>{});},{timeoutMs:1000}),/quota/);assert.ok(signals.every(s=>s.aborted));
});
