import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertTakeoffSource,savedBoqMatchesTakeoff} from '../src/lib/takeoffSource.mjs';
const image={project_id:'p',document_id:'png',document_name:'plan.png',analyzed_at:'2026-11-05T13:00:00Z'};
test('selected PNG cannot use an older DWG takeoff',()=>{
  assert.throws(()=>assertTakeoffSource({...image,document_id:'dwg'},'png','p'),/another drawing/);
  assert.throws(()=>assertTakeoffSource({...image,document_id:null},'png','p'),/quantity takeoff/);
  assert.doesNotThrow(()=>assertTakeoffSource(image,'png','p'));
});
test('takeoff from another project is rejected before generation',()=>{
  assert.throws(()=>assertTakeoffSource({...image,project_id:'other'},'png','p'),/another project/);
});
test('saved DWG rows must not be relabelled as a new PNG analysis',()=>{
  assert.equal(savedBoqMatchesTakeoff({boqSource:{documentId:'dwg'},takeoff:{document_id:'dwg'}},image),false);
  assert.equal(savedBoqMatchesTakeoff({items:[{quantity:125.35}]},image),false);
});
test('reanalyzing the same document invalidates the earlier BOQ snapshot',()=>{
  assert.equal(savedBoqMatchesTakeoff({takeoff:{...image,analyzed_at:'2026-11-01T00:00:00Z'}},image),false);
  assert.equal(savedBoqMatchesTakeoff({takeoff:image},image),true);
});
test('legacy matching source and manual BOQ without any takeoff retain compatibility',()=>{
  assert.equal(savedBoqMatchesTakeoff({boqSource:{documentId:'png'}},image),true);
  assert.equal(savedBoqMatchesTakeoff({items:[]},null),true);
  assert.doesNotThrow(()=>assertTakeoffSource(null,null,'p'));
});

const source=readFileSync(new URL('../src/services/takeoffService.js',import.meta.url),'utf8');
const readerSource=source.slice(source.indexOf('export async function getLatestProjectTakeoff('),source.indexOf('export function clearLatestProjectTakeoff(')).replace('export ','');
function reader(stored,selected){
  return new Function('readPersistedTakeoff','selectedDrawingSync','assertTakeoffSource','hydrateTakeoff','console',readerSource+';return getLatestProjectTakeoff;')(
    async()=>stored,()=>selected,assertTakeoffSource,t=>({...t,hydrated:true}),{error(){}});
}
test('actual latest-takeoff reader returns an error instead of cached DWG for selected PNG',async()=>{
  const dwg={...image,document_id:'dwg',floor_area:125.35};
  const result=await reader(dwg,'png')('p');
  assert.equal(result.takeoff,null);assert.match(result.error.message,/another drawing/);
  assert.equal(dwg.document_id,'dwg');assert.equal(dwg.floor_area,125.35);
});
test('actual latest-takeoff reader retains the matching PNG identity and quantities',async()=>{
  const result=await reader({...image,floor_area:46.5225},'png')('p');
  assert.equal(result.error,null);assert.equal(result.takeoff.document_id,'png');assert.equal(result.takeoff.floor_area,46.5225);
});
