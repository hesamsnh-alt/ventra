import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {
 PLAN_DATABASE, PLAN_HISTORY_LIMIT, savePlan, loadPlan, loadPlanModel,
 listPlanRevisions, restorePlanRevision,
} from '../src/lib/planStudio/storage.mjs';

test('upgraded drawings keep the plan and original GLB while restoring an older snapshot',async()=>{
 globalThis.indexedDB=new IDBFactory();
 const original=newDocument('Ground floor');
 const model={name:'original.glb',blob:new Blob(['glb bytes'])};
 await new Promise((resolve,reject)=>{
  const open=indexedDB.open(PLAN_DATABASE,2);
  open.onupgradeneeded=()=>{
   open.result.createObjectStore('drawings',{keyPath:'id'}).put(original);
   open.result.createObjectStore('models').put(model,original.id);
  };
  open.onsuccess=()=>{open.result.close();resolve();};
  open.onerror=()=>reject(open.error);
 });
 assert.deepEqual(await listPlanRevisions(original.id),[]);
 const changed=await savePlan({...original,name:'First edit',units:'in',
  entities:[{id:'wall-line',layer:'architecture',type:'line',a:{x:0,y:0},b:{x:3,y:0}}]});
 const [firstRevision]=await listPlanRevisions(original.id);
 const saved=await savePlan(changed);
 assert.equal(saved.updatedAt,changed.updatedAt);
 assert.deepEqual(await listPlanRevisions(original.id),[firstRevision]);

 const restored=await restorePlanRevision(original.id,firstRevision,{...changed,name:'Unsaved edit in the editor'});
 assert.equal(restored.id,original.id);
 assert.equal(restored.name,original.name);
 assert.equal(restored.units,'cm');
 assert.deepEqual(restored.entities,[]);
 assert.equal((await loadPlan(original.id)).name,original.name);
 assert.equal(await (await loadPlanModel(original.id)).blob.text(),'glb bytes');
 const [mostRecent]=await listPlanRevisions(original.id);
 const recovered=await restorePlanRevision(original.id,mostRecent);
 assert.equal(recovered.name,'Unsaved edit in the editor');
 assert.deepEqual(recovered.entities,changed.entities);
});

test('history retains only the latest revisions for each plan across overlapping saves',async()=>{
 globalThis.indexedDB=new IDBFactory();
 const a=newDocument('Plan A'),b=newDocument('Plan B');
 await Promise.all([savePlan(a),savePlan(b)]);
 const first=await savePlan({...a,name:'First A'});
 const [expired]=await listPlanRevisions(a.id);
 await Promise.all(Array.from({length:PLAN_HISTORY_LIMIT+1},(_,i)=>savePlan({...first,name:`Edit ${i}`})));
 const history=await listPlanRevisions(a.id);
 assert.equal(history.length,PLAN_HISTORY_LIMIT);
 assert.ok(history.every((time,i)=>i===0||time<history[i-1]));
 assert.ok(!history.includes(expired));
 assert.deepEqual(await listPlanRevisions(b.id),[]);
 await assert.rejects(restorePlanRevision(b.id,history[0]),/unavailable/);
 assert.equal((await loadPlan(b.id)).name,b.name);
});
