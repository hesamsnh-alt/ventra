import test from 'node:test';import assert from 'node:assert/strict';import {indexedDB} from 'fake-indexeddb';
globalThis.indexedDB=indexedDB;
import {saveSchematic,readSchematic,selectDrawingDocument} from '../src/lib/schematicStorage.mjs';
import {persistTakeoff,readPersistedTakeoff,clearPersistedTakeoff} from '../src/lib/takeoffStorage.mjs';
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const scene=(documentId,width)=>({documentId,width,depth:5,walls:[{id:documentId}]});
test('JPG and PDF scenes survive switching files and reloading the module',async()=>{
 const s=storage(),p='two-source-scenes';
 for(const [id,name,w]of [['jpg','plan.jpg',8],['pdf','plan.pdf',12]]){selectDrawingDocument(p,id,s,name);await saveSchematic(p,scene(id,w),{storage:s,preserveBase:false,syncCloud:false});}
 selectDrawingDocument(p,'jpg',s,'plan.jpg');const fresh=await import('../src/lib/schematicStorage.mjs?two-files-reload');
 assert.equal((await fresh.readSchematic(p,'schematic3d',{storage:s})).documentId,'jpg');assert.equal((await fresh.readSchematic(p,'schematic3d-base',{storage:s})).width,8);
 selectDrawingDocument(p,'pdf',s,'plan.pdf');assert.equal((await readSchematic(p,'schematic3d',{storage:s})).width,12);
});
test('an unbuilt selected document never borrows another document scene',async()=>{
 const s=storage(),p='unbuilt-source';selectDrawingDocument(p,'built',s,'built.jpg');await saveSchematic(p,scene('built',8),{storage:s,syncCloud:false});selectDrawingDocument(p,'unbuilt',s,'unbuilt.pdf');assert.equal(await readSchematic(p,'schematic3d',{storage:s}),null);
});
test('each drawing retains its own original architecture after edits',async()=>{
 const s=storage(),p='two-source-bases';selectDrawingDocument(p,'a',s,'a.jpg');await saveSchematic(p,scene('a',8),{storage:s,preserveBase:false,syncCloud:false});await saveSchematic(p,{...scene('a',8),variant:'edited'},{storage:s,syncCloud:false});
 selectDrawingDocument(p,'b',s,'b.pdf');await saveSchematic(p,scene('b',12),{storage:s,preserveBase:false,syncCloud:false});selectDrawingDocument(p,'a',s,'a.jpg');assert.equal((await readSchematic(p,'schematic3d-base',{storage:s})).width,8);assert.equal((await readSchematic(p,'schematic3d',{storage:s})).variant,'edited');
});
test('DXF and DWG engineering snapshots restore independently; clear removes archives',async()=>{
 const s=storage(),map=new Map(),records={get:async k=>map.get(k)||null,put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k)},p='two-source-cad';
 for(const [id,urn]of [['dxf','urn-dxf'],['dwg','urn-dwg']])await persistTakeoff(p,{document_id:id,aps_urn:urn,source:'autodesk-aps',geometry:{meterFactor:1,wallLineSegments:[{id}]}},{storage:s,records});
 assert.equal((await readPersistedTakeoff(p,'engineering',{storage:s,records,documentId:'dxf'})).aps_urn,'urn-dxf');assert.equal((await readPersistedTakeoff(p,'engineering',{storage:s,records,documentId:'dwg'})).aps_urn,'urn-dwg');
 assert.equal(await readPersistedTakeoff(p,'engineering',{storage:s,records,documentId:'unbuilt'}),null);
 await clearPersistedTakeoff(p,{storage:s,records});assert.equal(map.size,0);
});

test('saving a new scene archives identified legacy current/base records first',async()=>{
 const s=storage(),map=new Map(),p='migrate-multi',old=scene('old',8),records={get:async k=>map.get(k)||null,put:async(k,v)=>map.set(k,v),putMany:async es=>{for(const[k,v]of es)map.set(k,v)}};
 map.set(`ventra:project-schematic3d:${p}`,old);map.set(`ventra:project-schematic3d-base:${p}`,old);selectDrawingDocument(p,'new',s,'new.pdf');await saveSchematic(p,scene('new',12),{storage:s,records,preserveBase:false,syncCloud:false});selectDrawingDocument(p,'old',s,'old.jpg');assert.equal((await readSchematic(p,'schematic3d',{storage:s,records})).width,8);assert.equal((await readSchematic(p,'schematic3d-base',{storage:s,records})).width,8);
});
