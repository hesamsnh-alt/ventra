import {canonicalRoomType} from "../src/lib/roomSemantics.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Exercise the actual route helpers without starting Next or an AI request.
const source = readFileSync(new URL('../src/app/api/ai/design-3d-preview/route.js', import.meta.url), 'utf8');
const sandbox = { canonicalRoomType, process: { env: {} } };
vm.createContext(sandbox);
vm.runInContext(source.replace(/^import .*;\n/gm, '').split('function parseJson')[0] + '\nthis.helpers = { chooseBestWallForOpening, furnishRoom, sceneSchema, synthesizeRoomBoundaryPartitions };', sandbox);
const { chooseBestWallForOpening, furnishRoom, sceneSchema, synthesizeRoomBoundaryPartitions } = sandbox.helpers;
const wall = (id,x1,y1,x2,y2) => ({id,type:'external',start:{x:x1,y:y1},end:{x:x2,y:y2}});
test('source wall axis keeps entry on its supporting wall at a corner', () => {
 const walls=[wall('return',0,0,0,3),wall('entry',0,0,4,0)];
 const chosen=chooseBestWallForOpening({x:0.6,y:0.05},'door',walls,[],[],null,'horizontal',0.9);
 assert.equal(chosen.wall.id,'entry');
 assert.equal(chooseBestWallForOpening({x:.3,y:.05},'door',walls,[],[],null,'horizontal',.9),null,'a doorway crossing a wall end must not be shifted to fit');
 assert.equal(chooseBestWallForOpening({x:0.6,y:0.05},'door',[walls[0]],[],[],null,'horizontal',0.9),null);
});
test('vertical kitchen appliances remain aligned with the real counter wall', () => {
 const room={id:'k',name:'Kitchen',type:'kitchen',polygon:[{x:0,y:0},{x:3,y:0},{x:3,y:5},{x:0,y:5}]};
 const assets=furnishRoom(room,{walls:[wall('back',0,0,0,5)],openings:[]});
 const counter=assets.find(a=>a.type==='kitchen_counter');
 assert.ok(counter); assert.equal(counter.wallSupported,true);
 for(const type of ['sink','stove']) {
  const appliance=assets.find(a=>a.type===type);
  assert.ok(appliance,`${type} should fit a five metre wall`);
  assert.ok(Math.abs(appliance.xMeters-counter.xMeters)<0.001);
 }
 assert.ok(counter.xMeters<0.5,'counter is against the actual wall');
 const fridge=assets.find(a=>a.type==='refrigerator');
 assert.ok(fridge,'refrigerator fits beside the run');
 assert.ok(Math.abs(fridge.yMeters-counter.yMeters) > counter.width/2 + fridge.width/2);

});
test('open-plan room boundaries do not become imaginary kitchen backing walls', () => {
 const room={id:'k',type:'kitchen',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]};
 assert.equal(furnishRoom(room,{walls:[],openings:[]}).some(a=>a.type==='kitchen_counter'),false);
});

test('legacy openings without an axis remain accepted and strict schema is complete', () => {
 assert.equal(chooseBestWallForOpening({x:2,y:0},'door',[wall('entry',0,0,4,0)],[],[]).wall.id,'entry');
 const check = (schema) => {
  if(schema.type==='object') {
   assert.equal(schema.additionalProperties,false);
   assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());
   Object.values(schema.properties).forEach(check);
  }
  if(schema.items) check(schema.items);
 };
 check(sceneSchema);
 assert.deepEqual([...sceneSchema.properties.openings.items.properties.wallAxis.enum],['horizontal','vertical','diagonal','unknown']);
});

test('floor finish boundaries in open zones do not fabricate walls across circulation', () => {
 const polygon=[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}];
 for (const type of ['living','kitchen_dining','dining','corridor']) {
   const result=synthesizeRoomBoundaryPartitions([], [{id:'zone',type,polygon}], []);
   assert.equal(result.added,0,type);
 }
 const observed={id:'physical',type:'internal',start:{x:0,y:0},end:{x:4,y:0}};
 assert.equal(synthesizeRoomBoundaryPartitions([observed],[{id:'zone',type:'living',polygon}],[]).partitions[0],observed);
 assert.ok(synthesizeRoomBoundaryPartitions([],[{id:'room',type:'bedroom',polygon}],[]).added>0);
});
