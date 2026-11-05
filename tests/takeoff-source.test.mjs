import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertTakeoffSource,savedBoqMatchesTakeoff,assertTakeoffReady,takeoffBoqIssue} from '../src/lib/takeoffSource.mjs';
import {saveReadyBoq} from '../src/lib/boqDraftPersistence.mjs';
const image={project_id:'p',document_id:'png',document_name:'plan.png',analyzed_at:'2026-11-05T13:00:00Z'};
const translatedCad={project_id:'p',document_id:'dwg',document_name:'sample.dwg',source:'autodesk-aps',aps_status:'ready',
 extraction_status:'translation-complete',floor_area:null,wall_area:null,rooms:null,
 notes:'Autodesk translation completed. Geometry quantities have not been extracted yet.'};
test('successful Autodesk translation without extraction cannot generate quantities or match a saved BOQ',()=>{
 assert.throws(()=>assertTakeoffReady(translatedCad),e=>e.code==='CAD_EXTRACTION_INCOMPLETE');
 assert.throws(()=>assertTakeoffSource(translatedCad,'dwg','p'),/quantity extraction is incomplete/);
 assert.equal(savedBoqMatchesTakeoff({takeoff:translatedCad,items:[{quantity:1,rate:6600}]},translatedCad),false);
});
test('legacy normalized pending CAD drafts cannot evade the guard after metadata was lost',()=>{
 const legacy={notes:translatedCad.notes,floor_area:0,wall_area:0,rooms:0};
 assert.ok(takeoffBoqIssue(legacy));assert.equal(savedBoqMatchesTakeoff({takeoff:legacy},null),false);
});
test('partial numeric placeholders do not override an explicit unfinished CAD stage',()=>{
 assert.throws(()=>assertTakeoffReady({...translatedCad,notes:'',floor_area:20,rooms:1}),/incomplete/);
 assert.throws(()=>assertTakeoffReady({...translatedCad,notes:'',extraction_status:'geometry-ready-analysis-pending'}),/incomplete/);
});
test('completed CAD measurements requiring review remain available as provisional work',()=>{
 assert.doesNotThrow(()=>assertTakeoffReady({...translatedCad,notes:'Review measured wall deductions.',floor_area:20,
  extraction_status:'advanced-takeoff-needs-review',geometry_status:'needs_review'}));
 assert.equal(takeoffBoqIssue(image),'');assert.equal(takeoffBoqIssue({document_name:'schedule.pdf',pdf_analysis:{}}),'');
});
test('saving a pending CAD BOQ preserves the existing browser draft rather than writing allowances',()=>{
 const writes=[],storage={setItem:(...args)=>writes.push(args)};
 assert.throws(()=>saveReadyBoq(storage,'p',{takeoff:translatedCad,items:[{quantity:1,rate:6600}]},
  {loadedProject:'p',loading:false,generating:false}),/incomplete/);
 assert.equal(writes.length,0);
});
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
