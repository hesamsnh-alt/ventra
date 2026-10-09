import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import { requestRasterVision, consumeRasterVisionStream } from '../src/lib/rasterVisionRequest.mjs';

const completion = { id: 'resp_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"footprint":[]}' }] }] };
test('real SDK SSE parsing delivers final structured output and safe timing metadata', async () => {
  let calls = 0;
  const events = [{ type: 'response.created', response: { id: 'resp_test' } }, { type: 'response.output_text.delta', delta: '{"footprint":[]}' }, { type: 'response.completed', response: completion }];
  const client = new OpenAI({ apiKey: 'test-not-a-key', fetch: async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const progress = {};
  const result = await requestRasterVision((payload, options) => consumeRasterVisionStream((p,o) => client.responses.create(p,o), payload, options, progress), { model: 'fixture', input: 'fixture' }, 1000);
  assert.equal(calls, 1);
  assert.equal(result.output_text, '{"footprint":[]}');
  assert.equal(progress.stage, 'response_completed');
  assert.equal(progress.responseId, 'resp_test');
  assert.equal(progress.eventCount, 3);
  assert.equal(typeof progress.firstTextMs, 'number');
  assert.equal(JSON.stringify(progress).includes('test-not-a-key'), false);
});

test('partial output without completion and incomplete events cannot become a scene', async () => {
  for (const events of [[{ type:'response.output_text.delta', delta:'{"partial":' }], [{ type:'response.incomplete', response: { status:'incomplete', incomplete_details:{reason:'max_output_tokens'} } }]]) {
    const progress = {};
    await assert.rejects(consumeRasterVisionStream(async () => (async function*(){ yield* events; })(), {}, {}, progress), e => ['RASTER_VISION_STREAM_ENDED','RASTER_VISION_INCOMPLETE','RASTER_VISION_OUTPUT_LIMIT'].includes(e.code));
  }
});

test('timeout after provider acknowledgement preserves the stage and aborts the stream', async () => {
  const progress = {};
  await assert.rejects(requestRasterVision((payload, options) => consumeRasterVisionStream(async () => (async function*(){
    yield { type:'response.created', response:{ id:'resp_waiting' } };
    await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
  })(), payload, options, progress), {}, 20), e => e.code === 'RASTER_VISION_TIMEOUT');
  assert.equal(progress.stage, 'response_created');
  assert.equal(progress.responseId, 'resp_waiting');
  assert.equal(progress.firstTextMs, undefined);
});

test('route timeout returns downloadable diagnostics even without any trace', async () => {
  const source = readFileSync(new URL('../src/app/api/ai/design-3d/route.js', import.meta.url),'utf8');
  const code = source.slice(source.indexOf('async function handleSchematicRequest('), source.indexOf('\nexport async function POST'));
  const sandbox = { console:{log(){},error(){}}, process:{env:{}}, VENTRA_JPG_FLOORPLAN_ROUTE_VERSION:'test', RASTER_GEOMETRY_VERSION:'test', RASTER_TRACE_BUILD:'test-build', RASTER_TRACE_MAX_ATTEMPTS:2, shouldRetryRasterGeometry:()=>false, OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS:10, rasterPixelTraceSchema:{}, prepareRasterImageEvidence:async()=>({guides:[]}), rasterEvidencePrompt:()=>"", getOpenAIClient:()=>({responses:{create(){}}}), consumeRasterVisionStream:()=>{}, prepareVisionImage: async()=>({width:957,height:709,imageUrl:'data:fixture'}), requestRasterVision:async()=>{throw Object.assign(new Error('Time limit'),{code:'RASTER_VISION_TIMEOUT'});}, RasterGeometryError:class extends Error{}, NextResponse:{json:(body,options)=>({body,options})} };
  vm.createContext(sandbox);vm.runInContext(code,sandbox);
  const result = await sandbox.handleSchematicRequest({imageUrl:'https://example.invalid/private',mode:'schematic_analyze'});
  assert.equal(result.options.status,504,JSON.stringify(result.body.diagnostics.failure));
  assert.equal(result.body.diagnostics.accepted,false);
  assert.equal(result.body.diagnostics.trace,null);
  assert.equal(result.body.diagnostics.failure.code,'RASTER_VISION_TIMEOUT');
  assert.equal(JSON.stringify(result.body).includes('example.invalid'),false);
});

test('review panel renders the download button for timeout reports with no geometry', async () => {
  const require = createRequire(import.meta.url);
  const {loadComponent}=await import('./render-runtime.mjs');
  const component=await loadComponent('src/app/projects/[id]/RasterTraceReview.jsx');
  const React = require('react');const {renderToStaticMarkup} = require('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(component.default,{report:{trace:null,accepted:false,failure:{code:'RASTER_VISION_TIMEOUT',message:'Time limit'}},fileName:'plan.png'}));
  assert.ok(html.includes('Download analysis report'));
  assert.ok(html.includes('RASTER_VISION_TIMEOUT'));
  assert.equal(html.includes('<svg'),false);
});
