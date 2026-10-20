import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';
import{applyDesignDefaults}from'../src/lib/designDefaults.mjs';import{buildNativePdfScene}from'../src/services/pdfPlanSceneService.mjs';import{furnitureFront,pdfFurnitureClear}from'../src/lib/pdfFurnitureLayout.mjs';
const raw=await buildNativePdfScene({bytes:new Uint8Array(readFileSync(new URL('./fixtures/pdf-native-opening-input.pdf',import.meta.url))),projectId:'test',documentId:'source'}),scene=applyDesignDefaults(raw);
const dot=(a,b)=>a.x*b.x+a.y*b.y;
test('sofas face their television and coffee tables sit in front, rather than alongside the media unit',()=>{
 for(const f of scene.pdfStoreys)for(const sofa of f.assets.filter(a=>a.type==='sofa')){
  const own=f.assets.filter(a=>a.roomId===sofa.roomId),tv=own.find(a=>a.type==='tv_unit'),table=own.find(a=>a.type==='coffee_table');assert.ok(tv);assert.ok(table);
  const gaze=furnitureFront(sofa),toward={x:tv.xMeters-sofa.xMeters,y:tv.yMeters-sofa.yMeters},len=Math.hypot(toward.x,toward.y);
  assert.ok(dot(gaze,toward)/len>.9);assert.ok(dot(furnitureFront(tv),{x:-toward.x/len,y:-toward.y/len})>.9);
  const near={x:table.xMeters-sofa.xMeters,y:table.yMeters-sofa.yMeters};assert.ok(dot(gaze,near)>sofa.depth/2+.4);assert.ok(Math.abs(near.x*gaze.y-near.y*gaze.x)<.05);
  for(const a of own.filter(a=>['armchair','plant'].includes(a.type))){const lateral=Math.abs((a.xMeters-sofa.xMeters)*gaze.y-(a.yMeters-sofa.yMeters)*gaze.x);assert.ok(lateral>.8);}
 }
});
test('bed headboards and cabinet backs orient toward their supporting walls; bedside tables stay beside the bed',()=>{
 for(const f of scene.pdfStoreys)for(const bed of f.assets.filter(a=>a.type==='bed')){
  const table=f.assets.find(a=>a.roomId===bed.roomId&&a.type==='nightstand');assert.ok(table);const t=bed.rotation*Math.PI/180,dx=table.xMeters-bed.xMeters,dy=table.yMeters-bed.yMeters;
  assert.ok(Math.abs(dx*Math.cos(t)+dy*Math.sin(t))>bed.width/2);assert.ok(-dx*Math.sin(t)+dy*Math.cos(t)<0);
  assert.ok(pdfFurnitureClear(bed,f));
 }
});
test('sink and hob occupy separate positions in one counter and every proposed dining chair has room',()=>{
 for(const f of scene.pdfStoreys)for(const c of f.assets.filter(a=>a.type==='kitchen_counter')){
  const sink=f.assets.find(a=>a.roomId===c.roomId&&a.type==='sink'),hob=f.assets.find(a=>a.roomId===c.roomId&&a.type==='stove');assert.ok(sink.embeddedInCounter);assert.ok(hob.embeddedInCounter);assert.ok(Math.hypot(sink.xMeters-hob.xMeters,sink.yMeters-hob.yMeters)>.6);
 }
 for(const f of scene.pdfStoreys)for(const table of f.assets.filter(a=>a.type==='dining_table'))assert.equal(f.assets.filter(a=>a.groupId===table.id&&a.type==='chair').length,4);
});
test('released v166 defaults migrate while preserving actual architecture, manual changes and deletions',()=>{
 const old=JSON.parse(readFileSync(new URL('./fixtures/pdf-v166-interior-layout.json',import.meta.url))),original=structuredClone(old);
 const moved=old.assets.find(a=>a.type==='plant');moved.xMeters+=.1;const removed=old.assets.find(a=>a.type==='washing_machine');old.assets=old.assets.filter(a=>a.id!==removed.id);
 const result=applyDesignDefaults(old);assert.equal(result.pdfInteriorDefaults.version,'pdf-interior-defaults-v167');assert.deepEqual(result.assets.find(a=>a.id===moved.id),moved);assert.ok(!result.assets.some(a=>a.roomId===removed.roomId&&a.type===removed.type));
 for(let i=0;i<2;i++)for(const key of ['walls','openings','holes','footprint','floorPlates','height','width','depth'])assert.deepEqual(result.pdfStoreys[i][key],old.pdfStoreys[i][key]);
 assert.notDeepEqual(result.assets.find(a=>a.type==='sofa'),original.assets.find(a=>a.type==='sofa'));assert.equal(applyDesignDefaults(result),result);
});
