import test from 'node:test';
import assert from 'node:assert/strict';
import { requestRasterVision, shouldRetryRasterGeometry } from '../src/lib/rasterVisionRequest.mjs';

test('only completed geometry failures qualify for one bounded correction pass', () => {
  assert.equal(shouldRetryRasterGeometry({ code: 'CONFLICTING_SCALE' }), true);
  assert.equal(shouldRetryRasterGeometry({ code: 'UNSUPPORTED_ROOM_BOUNDARY' }), true);
  assert.equal(shouldRetryRasterGeometry({ code: 'RASTER_VISION_TIMEOUT' }), false);
  assert.equal(shouldRetryRasterGeometry({ code: 'OPENAI_BILLING_OR_RATE_LIMIT' }), false);
});

test('timeout aborts the outbound raster request without retrying it', async () => {
  let calls = 0, signal;
  await assert.rejects(requestRasterVision((_payload, options) => {
    calls++;
    signal = options.signal;
    assert.equal(options.maxRetries, 0);
    return new Promise(() => {});
  }, {}, 15), (e) => e.code === 'RASTER_VISION_TIMEOUT' && e.status === 504);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('successful response is preserved and its deadline timer is cleared', async () => {
  let signal;
  const response = { output_text: '{"ok":true}' };
  const result = await requestRasterVision((_payload, options) => {
    signal = options.signal;
    return response;
  }, {}, 15);
  assert.equal(result, response);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(signal.aborted, false);
});

test('SDK timeouts are classified as gateway timeouts; billing failures are preserved', async () => {
  await assert.rejects(requestRasterVision(() => { throw Object.assign(new Error('SDK timed out'), { name: 'APIConnectionTimeoutError' }); }, {}), e => e.code === 'RASTER_VISION_TIMEOUT' && e.status === 504);
  const billing = Object.assign(new Error('Rate limited'), { status: 429 });
  await assert.rejects(requestRasterVision(() => { throw billing; }, {}), e => e === billing);
});
