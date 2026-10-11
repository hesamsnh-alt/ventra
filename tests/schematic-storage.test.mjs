import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
globalThis.indexedDB = indexedDB;
const storageModule = await import('../src/lib/schematicStorage.mjs');
const {saveSchematic,readSchematic,saveActiveSource,readActiveSource} = storageModule;
const quotaStorage = {getItem:()=>null,removeItem(){},setItem(){throw new DOMException('Full','QuotaExceededError');}};
const store = () => {const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('switching image documents hides prior geometry and rejects stale scene identity',async()=>{
 const storage=store(),id='drawing-isolation',scene={documentId:'english',width:12,depth:8};
 await saveSchematic(id,scene,{storage,preserveBase:false});
 storageModule.selectSchematicDrawing(id,'arabic',storage);
 assert.equal(storageModule.readSchematicSync(id,'schematic3d',storage),null);
 assert.equal(await readSchematic(id,'schematic3d',{storage}),null);
 assert.equal(storageModule.drawingSceneMatches(id,scene,storage),false);
 const fresh=await import('../src/lib/schematicStorage.mjs?selection-reload');
 assert.equal(await fresh.readSchematic(id,'schematic3d',{storage}),null);
 storageModule.selectSchematicDrawing(id,'english',storage);
 assert.deepEqual(await readSchematic(id,'schematic3d',{storage}),scene);
});
test('Large scenes and original geometry survive a reload when localStorage is full',async()=>{
 const scene={width:12,depth:8,walls:[{id:'w1'}],assets:[{data:'x'.repeat(6*1024*1024)}]};
 await saveSchematic('quota-scene',scene,{preserveBase:false,storage:quotaStorage});
 const fresh=await import('../src/lib/schematicStorage.mjs?reload');
 assert.deepEqual(await fresh.readSchematic('quota-scene','schematic3d',{storage:quotaStorage}),scene);
 assert.deepEqual(await fresh.readSchematic('quota-scene','schematic3d-base',{storage:quotaStorage}),scene);
 assert.equal(await fresh.readActiveSource('quota-scene',{storage:quotaStorage}),'schematic');
});
test('Changing the style preserves original geometry and ordered source changes preserve DWG selection',async()=>{
 const storage=store(),id='scene-ordered',base={width:5,depth:7,variant:'classic',walls:[{id:'source'}]};
 await saveSchematic(id,base,{storage,preserveBase:false});
 await Promise.all([saveSchematic(id,{...base,variant:'luxury'},{storage}),saveActiveSource(id,'aps',{storage})]);
 assert.deepEqual(await readSchematic(id,'schematic3d-base',{storage}),base);
 assert.equal((await readSchematic(id,'schematic3d',{storage})).variant,'luxury');
 assert.equal(await readActiveSource(id,{storage}),'aps');
 assert.ok(storage.getItem(`ventra:project-schematic3d:${id}`).length<200);
});
test('A failed scene transaction preserves the previous scene, original and active selection',async()=>{
 const storage=store(),id='scene-abort',base={width:4,depth:3};
 await saveSchematic(id,base,{storage,preserveBase:false});await saveActiveSource(id,'aps',{storage});
 await assert.rejects(saveSchematic(id,{...base,callback:()=>{}},{storage,preserveBase:false}));
 assert.deepEqual(await readSchematic(id,'schematic3d',{storage}),base);
 assert.deepEqual(await readSchematic(id,'schematic3d-base',{storage}),base);
 assert.equal(await readActiveSource(id,{storage}),'aps');
});
test('Legacy scene data migrates without losing the original source geometry',async()=>{
 const storage=store(),id='scene-migration',scene={width:9,depth:8,walls:[{id:'legacy'}]};
 storage.setItem(`ventra:project-schematic3d:${id}`,JSON.stringify(scene));
 assert.deepEqual(await readSchematic(id,'schematic3d',{storage}),scene);
 assert.ok(JSON.parse(storage.getItem(`ventra:project-schematic3d:${id}`)).__schematicRecord);
});
