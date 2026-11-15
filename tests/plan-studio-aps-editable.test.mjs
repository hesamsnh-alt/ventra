import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {apsEditablePlan,editableApsUnits,editableApsViewports,editablePlanUrl} from '../src/lib/planStudio/apsEditablePlan.mjs';
import {savePlan,loadPlan} from '../src/lib/planStudio/storage.mjs';
import {clickPoint,editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';

const p=(x,y)=>({x,y});
const line=(dbId,viewportId,start,end)=>({dbId,viewportId,start,end});
const geometry={
 sourceMeterFactor:.001,meterFactor:1,
 lineSegments:[line(1,4,p(0,0),p(8000,0)),line(2,4,p(0,200),p(8000,200)),line(3,10,p(0,0),p(40,40))],
 circularArcs:[{dbId:3,viewportId:4,center:p(1000,1000),editRadius:500,editStart:Math.PI/2,editSweep:-Math.PI/2}],
 properties:[{dbId:1,layer:'A-WALL'},{dbId:2,layerName:'A-WALL'}],
};

test('APS copy selects one viewport, scales in drawing units, and imports checked model-space arc orientation',()=>{
 assert.deepEqual(editableApsViewports(geometry),['4','10']);
 assert.equal(editableApsUnits(geometry),'mm');
 assert.equal(editableApsUnits({...geometry,unitConfirmation:{meterFactor:.01}}),'cm');
 assert.throws(()=>apsEditablePlan(geometry,{name:'Example',unit:'mm'}),/viewport/);
 assert.throws(()=>apsEditablePlan(geometry,{name:'Example',unit:'',viewport:'4'}),/unit/);
 const doc=apsEditablePlan(geometry,{name:'Example.dwg',unit:'mm',viewport:'4'});
 assert.deepEqual(doc.entities.slice(0,2).map(e=>e.b),[p(8,0),p(8,.2)]);
 assert.equal(doc.entities[2].sweep,-Math.PI/2);
 assert.equal(doc.entities[2].radius,.5);
 assert.equal(doc.layers.find(l=>l.id===doc.entities[0].layer).name,'A-WALL');
});

test('APS copy can use selected objects, counts skipped arcs and rejects selections without editable vectors',()=>{
 const data={...geometry,circularArcs:[...geometry.circularArcs,{dbId:1,viewportId:4,center:p(0,0),radius:2,startAngle:0,angle:1}]};
 const doc=apsEditablePlan(data,{unit:'mm',viewport:'4',selection:[1]});
 assert.equal(doc.entities.length,1);
 assert.equal(doc.importedCad.skipped,1);
 assert.throws(()=>apsEditablePlan(data,{unit:'mm',viewport:'4',selection:[999]}),/No editable/);
});

test('editable copy can reopen from storage, accept CAD edits and export DXF while source remains unchanged',async()=>{
 globalThis.indexedDB=new IDBFactory();
 const source=structuredClone(geometry);
 const imported=apsEditablePlan(geometry,{name:'House',unit:'mm',viewport:'4'});
 await savePlan(imported);
 const url=editablePlanUrl(imported.id,'project-a');
 const linked=new URL(url,'https://example.invalid');
 assert.equal(linked.searchParams.get('project'),'project-a');
 const loaded=await loadPlan(linked.searchParams.get('drawing'));
 const state=startCommand(editorState(loaded),'AD');
 const changed=clickPoint(state,p(3,.1),{raw:true});
 assert.equal(changed.doc.entities.at(-1).kind,'door');
 assert.match(exportDXF(changed.doc),/LTYPE/);
 await savePlan(changed.doc);
 assert.equal((await loadPlan(imported.id)).entities.at(-1).kind,'door');
 assert.deepEqual(geometry,source);
});

test('large drawing requires a smaller selection rather than silently truncating',()=>{
 const source={lineSegments:Array.from({length:2001},(_,i)=>line(i,1,p(0,i),p(2,i)))};
 assert.throws(()=>apsEditablePlan(source,{name:'Large CAD',unit:'m'}),/2,000/);
 assert.equal(apsEditablePlan(source,{name:'Large CAD',unit:'m',selection:[1,2]}).entities.length,2);
});
