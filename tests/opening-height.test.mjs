import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app/api/ai/design-3d-preview/route.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function openingVerticalDimensions('),source.indexOf('\nfunction dist('))+'\nthis.resolve=openingVerticalDimensions;',context);
test('unknown or legacy zero heights use labelled visual defaults, not 0.5m doors',()=>{
 for(const missing of [undefined,null,'',0,-1,NaN]){
  const door=context.resolve({heightMeters:missing,sillHeightMeters:missing},'door');
  assert.equal(door.height,2.1);assert.equal(door.sillHeight,0);
  assert.equal(door.heightSource,'visual_default_not_measured');
  const window=context.resolve({heightMeters:missing,sillHeightMeters:missing},'window');
  assert.equal(window.height,1.25);assert.equal(window.sillHeight,.9);
 }
});
test('explicit low windows and flush sills are preserved; window tops stay below the wall',()=>{
 const low=context.resolve({heightMeters:.5,sillHeightMeters:.35},'window');
 assert.equal(low.height,.5);assert.equal(low.sillHeight,.35);assert.equal(low.heightSource,'source_dimension');
 const flush=context.resolve({heightMeters:2.4,sillHeightMeters:0},'window');
 assert.equal(flush.sillHeight,0);assert.equal(flush.sillHeightSource,'source_dimension');
 const tall=context.resolve({heightMeters:2.5,sillHeightMeters:1.2},'window');
 assert.equal(tall.height+tall.sillHeight,2.8);
});
