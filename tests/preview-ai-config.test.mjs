import test from 'node:test';import assert from 'node:assert/strict';
import {previewAIKeyStatus} from '../src/lib/previewAIConfig.mjs';
for(const v of [undefined,null,'','  '])test(`missing key state ${JSON.stringify(v)}`,()=>assert.equal(previewAIKeyStatus(v),'missing'));
for(const v of ['••••••','sk-••••','a\r\nb','token with space',' key','key ','*****','token\u0100'])test('invalid header configuration is rejected without returning any key bytes',()=>{
 const status=previewAIKeyStatus(v);assert.equal(status,'unusable_header');assert.ok(!JSON.stringify({status}).includes(v));
});
test('opaque ASCII credentials stay opaque; header readiness does not assert provider authentication',()=>assert.equal(previewAIKeyStatus('fixture-opaque-token_123'),'header_ready'));
