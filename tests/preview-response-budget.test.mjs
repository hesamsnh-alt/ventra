import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createPreviewWireCodec, readCompletedPreview} from '../src/lib/previewSceneWire.mjs';

const source = fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js', import.meta.url), 'utf8');
const schemaContext = vm.createContext({process:{env:{}}});
vm.runInContext(source.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.schema=sceneSchema;',schemaContext);
const schema=JSON.parse(JSON.stringify(schemaContext.schema));
const codec=createPreviewWireCodec(schema);
const point=(x,y)=>({x,y});
const raw={title:'پلان',confidence:.81,widthMeters:12,depthMeters:9,coordinateMode:'image_normalized',
  footprint:[point(.1,.1),point(.9,.1),point(.9,.9),point(.1,.9)],
  rooms:[{id:'r1',name:'خواب',type:'bedroom',labelVisible:true,printedWidthMeters:4,printedDepthMeters:5,
    polygon:[point(.1,.1),point(.6,.1),point(.6,.9),point(.1,.9)]}],
  relationships:[],partitions:[{id:'p1',start:point(.6,.1),end:point(.6,.9)}],
  openings:[{id:'d1',type:'door',center:point(.6,.7),widthMeters:.9,heightMeters:-1,sillHeightMeters:-1,
    wallIdHint:'p1',wallAxis:'vertical',hingeSide:'top',swingDirection:'clockwise'}],
  furniture:[{id:'f1',groupId:'',roomId:'r1',type:'bed',backLeft:point(.2,.2),backRight:point(.4,.2),
    frontCenter:point(.3,.5),confidence:.9,embeddedInCounter:false}]};
// Explicit wire fixture: tests do not use an encoder that could share decoder bugs.
const wire={t:'پلان',c:.81,w:12,d:9,cm:'image_normalized',fp:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],
  r:[{i:'r1',n:'خواب',t:'bedroom',lv:true,pw:4,pd:5,pg:[[.1,.1],[.6,.1],[.6,.9],[.1,.9]]}],rel:[],
  p:[{i:'p1',s:[.6,.1],e:[.6,.9]}],
  o:[{i:'d1',t:'door',p:[.6,.7],w:.9,h:-1,sh:-1,wh:'p1',ax:'vertical',hs:'top',sd:'clockwise'}],
  f:[{i:'f1',g:'',r:'r1',t:'bed',bl:[.2,.2],br:[.4,.2],fc:[.3,.5],c:.9,ec:false}]};
const completed=value=>({status:'completed',output_text:JSON.stringify(value),id:'mock-completed'});
const plain=value=>JSON.parse(JSON.stringify(value));

test('compact scene restores every field, orientation, source label and unknown dimension exactly',()=>{
  assert.deepEqual(readCompletedPreview(completed(wire),codec),raw);
  assert.ok(JSON.stringify(wire).length<JSON.stringify(raw).length*.7);
  function strict(node){
    if(node.type==='object'){
      assert.equal(node.additionalProperties,false);
      assert.deepEqual([...node.required].sort(),Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(strict);
    }
    if(node.items)strict(node.items);
  }
  strict(codec.schema);
  assert.equal(codec.schema.properties.f.maxItems,80);
  assert.equal(codec.schema.properties.r.maxItems,32);
  assert.equal(codec.schema.properties.p.maxItems,96);
  assert.equal(codec.schema.properties.o.maxItems,64);
});

test('observed 8000-token truncated response is classified before parsing, including valid but incomplete JSON',()=>{
  for(const text of ['{"f":[',JSON.stringify(wire),'']){
    assert.throws(()=>readCompletedPreview({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:text},codec),
      {code:'PREVIEW_OUTPUT_LIMIT'});
  }
  assert.throws(()=>readCompletedPreview({status:'failed',output_text:JSON.stringify(wire)},codec),{code:'PREVIEW_INCOMPLETE_OUTPUT'});
  assert.throws(()=>readCompletedPreview({status:'completed',output_text:'{"r":['},codec),{code:'PREVIEW_JSON_PARSE_FAILED'});
  assert.throws(()=>readCompletedPreview({status:'completed',output_text:''},codec),{code:'PREVIEW_EMPTY_OUTPUT'});
  assert.throws(()=>readCompletedPreview({status:'completed',output:[{content:[{type:'refusal'}]}]},codec),{code:'PREVIEW_REFUSED'});
});

test('malformed completed coordinates, missing fields and out-of-contract enums cannot enter the renderer',()=>{
  const edits=[v=>{v.fp[0]=[.1];},v=>{v.fp[0]=[.1,.1,5];},v=>{v.r[0].pg[0]=['.1',.1];},
    v=>{delete v.o[0].ax;},v=>{v.o[0].ax='imaginary';},v=>{v.f[0].c=null;},
    v=>{v.extra=true;},v=>{v.f[0].ec='false';},v=>{v.r=[];},v=>{v.r=Array(33).fill(v.r[0]);}];
  for(const edit of edits){const v=structuredClone(wire);edit(v);assert.throws(()=>codec.decode(v),{code:'PREVIEW_SCHEMA_INVALID'});}
});

function harness(responses,env={}){
  const calls=[],normalizations=[];
  const scene={width:12,depth:9,rooms:[{id:'r1'}],walls:[],openings:[],assets:[],footprint:raw.footprint,
    geometryValidation:{sourceProjection:{sourceBounds:{minX:0,minY:0,maxX:1,maxY:1}}}};
  const context=vm.createContext({process:{env},createPreviewWireCodec,readCompletedPreview,createHash,
    Buffer,AbortController,setTimeout,clearTimeout,Date,console:{log(){},warn(){}},
    NextResponse:{json:Response.json},
    prepareRasterImageEvidence:async()=>({guides:[]}),rasterEvidencePrompt:()=>'',
    getOpenAIClient:()=>({responses:{create:async(payload,options)=>{
      calls.push({payload,options});const result=responses.shift();
      if(result instanceof Error)throw result;
      if(!result)throw new Error('Unexpected paid request');
      return result;
    }}}),
    applySourceFurnitureReview:(prior,observations)=>({...prior,reviewedObservations:observations}),
    normalized:scene,onNormalize:value=>normalizations.push(plain(value))});
  vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+`
    prepareImage=async()=>({width:957,height:709,buffer:Buffer.from('offline-only'),imageUrl:'data:mock'});
    normalizeScene=raw=>{onNormalize(raw);return normalized;};
    this.run=runPreview;
  `,context);
  return {context,calls,normalizations};
}

test('actual handler rejects the uploaded-log failure: one request, no normalization, no furniture review or scene',async()=>{
  const {context,calls,normalizations}=harness([{status:'incomplete',id:'mock-log',
    incomplete_details:{reason:'max_output_tokens'},output_text:'{"f":[',
    usage:{input_tokens:4740,output_tokens:8000,output_tokens_details:{reasoning_tokens:4589}}}]);
  const result=await context.run({imageUrl:'mock'}),body=await result.json();
  assert.equal(result.status,422);assert.equal(body.code,'PREVIEW_OUTPUT_LIMIT');
  assert.equal(body.scene,undefined);assert.equal(normalizations.length,0);assert.equal(calls.length,1);
  assert.equal(body.diagnostics.accepted,false);assert.equal(body.diagnostics.failedStage,'validating_response');
  assert.equal(body.diagnostics.usage.output_tokens,8000);
  assert.equal(body.diagnostics.incompleteDetails.reason,'max_output_tokens');
  assert.equal(calls[0].payload.max_output_tokens,8000);
  assert.equal(calls[0].payload.reasoning.effort,'low');
  assert.equal(calls[0].options.maxRetries,0);
});

test('actual handler decodes before existing normalization, retains separate review and caches only successful scenes',async()=>{
  const {context,calls,normalizations}=harness([completed(wire),completed({f:wire.f})]);
  const response=await context.run({imageUrl:'mock'}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.diagnostics.accepted,true);
  assert.deepEqual(normalizations,[raw]);assert.equal(calls.length,2);
  assert.deepEqual(body.scene.reviewedObservations,raw.furniture);
  assert.deepEqual(plain(calls[0].payload.text.format.schema),codec.schema);
  assert.match(calls[0].payload.input[0].content[0].text,/WIRE FORMAT/);
  assert.equal(calls[1].options.maxRetries,0);
  const cached=await(await context.run({imageUrl:'same-pixels'})).json();
  assert.equal(cached.diagnostics.cacheHit,true);assert.equal(calls.length,2);
});

test('incomplete furniture review preserves the complete architecture and first furniture trace',async()=>{
  const {context,calls}=harness([completed(wire),{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},
    output_text:'{"f":[',id:'mock-review',usage:{output_tokens:8000}}]);
  const response=await context.run({imageUrl:'mock'}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.diagnostics.accepted,true);
  assert.deepEqual(body.scene.rooms,[{id:'r1'}]);assert.equal(calls.length,2);
  assert.equal(body.scene.furnishingReview.requiresReview,true);
  assert.equal(body.diagnostics.furnitureReview.code,'PREVIEW_OUTPUT_LIMIT');
  assert.equal(body.diagnostics.furnitureReview.usage.output_tokens,8000);
});

test('explicit reasoning override remains respected; invalid token configuration has a finite capped fallback',async()=>{
  const {context,calls}=harness([{status:'incomplete'}],{OPENAI_3D_PREVIEW_REASONING:'medium',VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS:'bad'});
  await context.run({imageUrl:'mock'});
  assert.equal(calls[0].payload.reasoning.effort,'medium');assert.equal(calls[0].payload.max_output_tokens,8000);
});

test('image analysis POST is never replayed automatically after an unknown transport outcome',()=>{
  const drawing=fs.readFileSync(new URL('../src/app/projects/[id]/ProjectDrawingCenter.jsx',import.meta.url),'utf8');
  assert.match(drawing,/attempts: 1, label: "interactive-3d-preview"/);
});
