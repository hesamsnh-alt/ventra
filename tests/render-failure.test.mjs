import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFailure} from '../src/lib/renderFailure.mjs';
test('Credit limits, rate limits, invalid API keys and model access have distinct safe codes',()=>{
 assert.equal(renderFailure({status:429,code:'credit_balance_exhausted'}).body.code,'RENDER_API_CREDIT_LIMIT');
 assert.equal(renderFailure({status:429,code:'insufficient_quota'}).body.code,'RENDER_API_CREDIT_LIMIT');
 const rate=renderFailure({status:429,code:'rate_limit_exceeded',headers:new Headers({'retry-after':'120'})});
 assert.equal(rate.body.code,'RENDER_API_RATE_LIMIT');assert.equal(rate.body.retryAfterSeconds,120);
 assert.equal(renderFailure({status:401}).body.code,'RENDER_API_AUTH_FAILED');
 assert.equal(renderFailure({status:403}).body.code,'RENDER_API_ACCESS_DENIED');
 assert.equal(renderFailure({status:400}).body.code,'RENDER_API_CONFIGURATION');
 assert.equal(renderFailure({name:'AbortError'}).status,504);
 assert.ok(!JSON.stringify(renderFailure({status:429,message:'secret-key-and-customer-image'})).includes('secret-key'));
});
test('Rejected renders report their stage and bounded review reasons, never an image',()=>{
 const result=renderFailure({status:422,code:'RENDER_LAYOUT_MISMATCH',message:'Rejected',renderStage:'layout_review',reasons:['Door moved',...Array(20).fill('x'.repeat(500))],imageUrl:'data:private'});
 assert.equal(result.body.stage,'layout_review');assert.equal(result.body.reasons.length,8);assert.ok(result.body.reasons.every(s=>s.length<=240));assert.ok(!('imageUrl' in result.body));
});
