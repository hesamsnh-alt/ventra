import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import '../scripts/offline-test-guard.mjs';
test('offline harness rejects external fetch before sending a request',()=>{
  assert.throws(()=>fetch('https://api.openai.com/v1/responses'),/OFFLINE_TEST_NETWORK_BLOCKED/);
});
test('offline harness also rejects raw external sockets',()=>{
  assert.throws(()=>net.connect({host:'api.openai.com',port:443}),/OFFLINE_TEST_NETWORK_BLOCKED/);
});
