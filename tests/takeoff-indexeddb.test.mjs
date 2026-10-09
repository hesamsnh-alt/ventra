import test from 'node:test';import assert from 'node:assert/strict';import {indexedDB} from 'fake-indexeddb';
globalThis.indexedDB=indexedDB;
const {persistTakeoff,readPersistedTakeoff,indexedTakeoffRecords}=await import('../src/lib/takeoffStorage.mjs');
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('Real IndexedDB transactions commit full geometry and the latest pointer together; reload restores CAD and raster independently',async()=>{
 const s=storage(),id='idb-project',cad={source:'autodesk-aps',aps_urn:'cad',geometry:{meterFactor:.001,lineSegments:[{start:{x:1,y:2},end:{x:3,y:4}}]}},raster={source:'image',document_type:'jpg',rooms:4};
 await persistTakeoff(id,cad,{storage:s});await persistTakeoff(id,raster,{storage:s});
 assert.deepEqual(await readPersistedTakeoff(id,'latest',{storage:s}),raster);assert.deepEqual(await readPersistedTakeoff(id,'engineering',{storage:s}),cad);
 const latest=await indexedTakeoffRecords.get(`${id}:latest-pointer`);assert.equal(latest.recordKey,`${id}:raster`);
 assert.equal(JSON.parse(s.getItem(`ventra:project-engineering-takeoff:${id}`)).geometry.lineSegments,undefined);
});
test('Uncloneable geometry fails without publishing a new latest pointer',async()=>{const s=storage(),id='idb-failure';await persistTakeoff(id,{source:'image',rooms:2},{storage:s});await assert.rejects(()=>persistTakeoff(id,{source:'image',callback:()=>{}},{storage:s}));assert.equal((await readPersistedTakeoff(id,'latest',{storage:s})).rooms,2);});
test('Concurrent extracts are written in invocation order',async()=>{const s=storage(),id='idb-concurrent';await Promise.all([persistTakeoff(id,{source:'image',rooms:1},{storage:s}),persistTakeoff(id,{source:'image',rooms:9},{storage:s})]);assert.equal((await readPersistedTakeoff(id,'latest',{storage:s})).rooms,9);});
