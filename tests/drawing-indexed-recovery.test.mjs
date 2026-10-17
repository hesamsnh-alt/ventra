import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrawingIndexedRecords} from '../src/lib/drawingIndexedRecords.mjs';
import {persistTakeoff,readPersistedTakeoff} from '../src/lib/takeoffStorage.mjs';
import {raycastVisibleMeshes} from '../src/lib/raycastMeshes.mjs';
import {pickSurfaceHit} from '../src/lib/surfaceMaterials.mjs';

// Event-driven IDB contract simulator; failure injection covers connection
// lifetime and commit boundaries without an external package or browser reset.
function harness(options={}){
  const data=new Map(),connections=[],requests=[];let starts=0;
  const error=name=>new DOMException(name,name);
  const factory={open(name,version){
    assert.equal(name,'ventra-drawing-data');assert.equal(version,1);
    const db={closed:false,objectStoreNames:{contains:name=>name==='takeoffs'},close(){this.closed=true;},
      createObjectStore(){throw Error('Existing store must not be recreated');},
      transaction(storeName,mode){
        starts++;assert.equal(storeName,'takeoffs');
        if(this.closed)throw error('InvalidStateError');
        if(options.failStarts>0){options.failStarts--;throw error(options.startError||'InvalidStateError');}
        let aborted=false;const snapshot=new Map(data),tx={error:null,abort(){aborted=true;}};
        tx.objectStore=()=>({put(value,key){snapshot.set(key,structuredClone(value));},delete:key=>snapshot.delete(key),
          get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(snapshot.get(key));request.onsuccess?.();});return request;}});
        setImmediate(()=>{
          if(options.abortNext===mode){options.abortNext=null;aborted=true;tx.error=error('QuotaExceededError');}
          if(aborted){tx.onabort?.();return;}
          if(mode==='readwrite'){data.clear();for(const [k,v] of snapshot)data.set(k,v);}
          tx.oncomplete?.();
        });
        return tx;
      }};
    connections.push(db);const request={result:db};requests.push(request);
    setImmediate(()=>{if(options.blockNext){options.blockNext=false;request.onblocked?.();setImmediate(()=>request.onsuccess?.());}else request.onsuccess?.();});
    return request;
  }};
  return {records:createDrawingIndexedRecords(()=>factory),connections,requests,data,options,get starts(){return starts;}};
}

test('closing connection from uploaded log reopens once and preserves full drawings and material assignments',async()=>{
  const h=harness(),drawing={geometry:{wallLineSegments:[{start:{x:1,y:2},end:{x:3,y:4}}]},surfaceFinishes:{version:1,assignments:{wall:'brick-red'}}};
  await h.records.putMany([['drawing',drawing],['pointer',{recordKey:'drawing'}]]);
  h.connections[0].close();
  assert.deepEqual(await h.records.get('drawing'),drawing);assert.equal(h.connections.length,2);
  assert.deepEqual(await h.records.get('pointer'),{recordKey:'drawing'});assert.equal(h.data.size,2);
});
test('put, putMany and delete recover before submitting work on a closed database',async()=>{
  for(const method of ['put','putMany','delete']){
    const h=harness();await h.records.put('x',1);h.connections[0].close();
    if(method==='put')await h.records.put('y',2);
    if(method==='putMany')await h.records.putMany([['y',2],['z',3]]);
    if(method==='delete')await h.records.delete('x');
    assert.equal(h.connections.length,2);assert.equal(h.data.get(method==='delete'?'x':'y'),method==='delete'?undefined:2);
  }
});
test('unexpected close and versionchange discard old handle; late old close cannot evict the new connection',async()=>{
  for(const event of ['onclose','onversionchange']){
    const h=harness();await h.records.put('x',1);const old=h.connections[0];old[event]();
    assert.equal(old.closed,true);assert.equal(await h.records.get('x'),1);assert.equal(h.connections.length,2);
    old.onclose();assert.equal(await h.records.get('x'),1);assert.equal(h.connections.length,2);
  }
});
test('simultaneous stale readers share a single new open request',async()=>{
  const h=harness();await h.records.put('x',{unchanged:true});h.connections[0].close();
  const values=await Promise.all(Array.from({length:8},()=>h.records.get('x')));
  assert.ok(values.every(v=>v.unchanged));assert.equal(h.connections.length,2);
});
test('repeated InvalidStateError is bounded to two starts; future operation can open a fresh connection',async()=>{
  const h=harness({failStarts:2});await assert.rejects(h.records.put('x',1),{name:'InvalidStateError'});
  assert.equal(h.connections.length,2);assert.equal(h.starts,2);assert.equal(h.data.size,0);
  await h.records.put('x',1);assert.equal(h.connections.length,3);assert.equal(h.data.get('x'),1);
});
test('security and missing-store errors are never treated as stale-connection failures',async()=>{
  for(const name of ['SecurityError','NotFoundError']){
    const h=harness({failStarts:1,startError:name});await assert.rejects(h.records.get('x'),{name});assert.equal(h.connections.length,1);assert.equal(h.starts,1);
  }
});
test('quota or transaction abort is reported without replay and preserves previously committed rows',async()=>{
  const h=harness();await h.records.put('x','old');h.options.abortNext='readwrite';
  await assert.rejects(h.records.putMany([['x','new'],['pointer','new']]),{name:'QuotaExceededError'});
  assert.equal(h.data.get('x'),'old');assert.equal(h.data.has('pointer'),false);assert.equal(h.starts,2);
});
test('a non-cloneable later row aborts the entire batch and leaves prior pointer intact',async()=>{
  const h=harness();await h.records.put('pointer','old');
  await assert.rejects(h.records.putMany([['pointer','new'],['geometry',{bad:()=>{}}]]),{name:'DataCloneError'});
  await new Promise(setImmediate);assert.equal(h.data.get('pointer'),'old');assert.equal(h.data.has('geometry'),false);
});
test('request success followed by read-transaction abort cannot return false success',async()=>{
  const h=harness();await h.records.put('x',1);h.options.abortNext='readonly';
  await assert.rejects(h.records.get('x'),{name:'QuotaExceededError'});assert.equal(h.connections.length,1);
});
test('blocked request rejects clearly and closes a late successful connection',async()=>{
  const h=harness({blockNext:true});await assert.rejects(h.records.get('x'),/Close older Ventra tabs/);
  await new Promise(setImmediate);assert.equal(h.connections[0].closed,true);
  await h.records.put('x',2);assert.equal(h.connections.length,2);assert.equal(h.data.get('x'),2);
});
test('actual takeoff persistence restores latest and engineering records through connection replacement',async()=>{
  const h=harness(),values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const drawing={aps_urn:'urn',source:'autodesk-aps',geometry:{meterFactor:1,wallLineSegments:[{dbId:12,start:{x:0,y:0},end:{x:3,y:0}}]}};
  await persistTakeoff('recovery-project',drawing,{records:h.records,storage});h.connections[0].close();
  assert.deepEqual(await readPersistedTakeoff('recovery-project','latest',{records:h.records,storage}),drawing);
  assert.deepEqual(await readPersistedTakeoff('recovery-project','engineering',{records:h.records,storage}),drawing);
  assert.ok(JSON.parse(values.get('ventra:project-takeoff:recovery-project')).__ventraTakeoffRecord);
});

test('ray picking never invokes legacy line or sprite raycasts, but retains visible nested meshes',()=>{
  let warningReads=0;const floor={type:'Mesh',visible:true,userData:{surfaceTarget:{kind:'floor',id:'r'}}};
  const line={type:'Line',raycast(){warningReads++;throw Error('linePrecision getter');}},sprite={type:'Sprite'};
  const hidden={type:'Mesh',parent:{visible:false}},root={traverse:fn=>[line,sprite,floor,hidden].forEach(fn)};
  const raycaster={intersectObjects(objects,recursive){assert.equal(recursive,false);assert.deepEqual(objects,[floor]);for(const o of objects)o.raycast?.();return [{distance:1,object:floor}];}};
  assert.deepEqual(pickSurfaceHit(raycastVisibleMeshes(raycaster,root,{})),{kind:'floor',id:'r'});assert.equal(warningReads,0);
});
test('legacy Mesh instances and modern mesh flags are both selectable without recursive line traversal',()=>{
  class Mesh{}
  const legacy=new Mesh(),modern={isMesh:true},root={traverse:fn=>[legacy,modern].forEach(fn)};
  raycastVisibleMeshes({intersectObjects:(objects,recursive)=>{assert.deepEqual(objects,[legacy,modern]);assert.equal(recursive,false);}},root,{Mesh});
});
