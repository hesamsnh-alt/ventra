import test from 'node:test';
import assert from 'node:assert/strict';
import { saveReadyBoq } from '../src/lib/boqDraftPersistence.mjs';

test('opening BOQ cannot overwrite a saved 48-row draft before hydration', () => {
  const key = 'ventra:project-boq:p';
  const saved = JSON.stringify({items:Array.from({length:48}, (_,id)=>({id}))});
  const values = new Map([[key,saved]]);
  const storage = {setItem:(k,v)=>values.set(k,v)};
  for (const lifecycle of [
    {loadedProject:null,loading:true,generating:false},
    {loadedProject:'p',loading:true,generating:false},
    {loadedProject:'p',loading:false,generating:true},
    {loadedProject:'other',loading:false,generating:false},
  ]) assert.equal(saveReadyBoq(storage,'p',{items:[]},lifecycle),false);
  assert.equal(values.get(key),saved);
});

test('a complete generated BOQ is committed synchronously with takeoff and settings', () => {
  const values = new Map();
  const storage = {setItem:(k,v)=>values.set(k,v)};
  const draft={items:Array.from({length:48},(_,id)=>({id})),takeoff:{floor_area:125.35},vatPercentage:5};
  assert.equal(saveReadyBoq(storage,'p',draft,{loadedProject:'p',loading:false,generating:false}),true);
  assert.deepEqual(JSON.parse(values.get('ventra:project-boq:p')),draft);
  assert.equal(values.has('ventra:project-boq:other'),false);
});
test('BOQ draft does not duplicate full CAD arrays in localStorage and retains estimate inputs',()=>{
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v)};
 const draft={items:[{id:'1',quantity:16,rate:600,review:{confirmed:true}}],takeoff:{aps_urn:'cad',floor_area:120,geometry:{meterFactor:.001,lineSegments:Array.from({length:10000},(_,i)=>({dbId:i,start:{x:i,y:0},end:{x:i+1,y:0}}))}},vatPercentage:5};
 saveReadyBoq(storage,'p',draft,{loadedProject:'p',loading:false,generating:false});
 const text=values.get('ventra:project-boq:p'),saved=JSON.parse(text);
 assert.ok(text.length<2000);assert.equal(saved.takeoff.floor_area,120);assert.equal(saved.takeoff.geometry.meterFactor,.001);assert.deepEqual(saved.items,draft.items);assert.equal(draft.takeoff.geometry.lineSegments.length,10000);
});
