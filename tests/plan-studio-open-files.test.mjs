import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {importDxf,readDxf} from '../src/lib/planStudio/importDxf.mjs';
import {inspectPlanGlb} from '../src/lib/planStudio/modelFile.mjs';
import {openProjectCadFile} from '../src/lib/planStudio/projectTransfer.mjs';
import {PLAN_DATABASE,savePlan,loadPlan,loadPlanModel,listPlans} from '../src/lib/planStudio/storage.mjs';

const p=(x,y)=>({x,y});
const entity=(id,geometry)=>({id,layer:'architecture',...geometry});
const makeDxf=({code,bodies})=>[
 ...(code===undefined?[]:[0,'SECTION',2,'HEADER',9,'$INSUNITS',70,code,0,'ENDSEC']),
 0,'SECTION',2,'ENTITIES',...bodies.flat(),0,'ENDSEC',0,'EOF',
].join('\n')+'\n';

test('editable DXF round-trips actual model-space measurements, lines, arcs and Persian text',()=>{
 const doc=newDocument();
 doc.entities=[entity('line',{type:'line',a:p(0,0),b:p(5,3)}),entity('arc',{type:'arc',center:p(3,5),radius:2,start:.2,sweep:1.8}),
  entity('note',{type:'text',position:p(1,2),text:'آشپزخانه',textHeight:.15})];
 const imported=importDxf(readDxf(exportDXF(doc)),'Plan').doc;
 assert.equal(imported.entities.length,3);
 assert.deepEqual(imported.entities[0].b,p(5,3));
 assert.ok(Math.abs(imported.entities[1].sweep-1.8)<1e-8);
 assert.equal(imported.entities[2].text,'آشپزخانه');
 assert.equal(imported.layers.at(-1).name,'architecture');
});

test('DXF ignores paper-space geometry and reports unsupported entities, requiring explicit unit when absent',()=>{
 const dxf=makeDxf({bodies:[[0,'LINE',10,0,20,0,11,2000,21,1200],[0,'LINE',67,1,10,0,20,0,11,2,21,2],[0,'INSERT',2,'block']]});
 const parsed=readDxf(dxf);
 assert.throws(()=>importDxf(parsed,'Plan'),/Choose the drawing units/);
 const {doc,skipped}=importDxf(parsed,'Plan','mm');
 assert.equal(doc.entities.length,1);
 assert.deepEqual(doc.entities[0].b,p(2,1.2));
 assert.deepEqual([...skipped],[['INSERT',1]]);
});

test('DXF supports bulged polylines and millimetre plan metadata',()=>{
 const dxf=makeDxf({code:4,bodies:[[0,'LWPOLYLINE',70,0,10,0,20,0,42,1,10,2000,20,0]]});
 const {doc}=importDxf(readDxf(dxf),'Curves');
 const vertices=doc.entities[0].points;
 assert.deepEqual(vertices[0],p(0,0));
 assert.deepEqual(vertices.at(-1),p(2,0));
 assert.ok(Math.abs(Math.min(...vertices.map(p=>p.y))+1)<1e-8);
});

test('DXF preserves survey coordinates when exporting after editable rebasing',()=>{
 const source=makeDxf({code:6,bodies:[[0,'LINE',10,400000,20,3000000,11,400005,21,3000003]]});
 const first=importDxf(readDxf(source),'Survey').doc;
 assert.deepEqual(first.cadOriginMeters,p(400000,3000000));
 assert.deepEqual(first.entities[0].b,p(5,3));
 const second=importDxf(readDxf(exportDXF(first)),'Survey').doc;
 assert.deepEqual(second.cadOriginMeters,first.cadOriginMeters);
 assert.deepEqual(second.entities[0].b,p(5,3));
});

test('DXF rejects malformed, binary and unsupported-only files',()=>{
 assert.throws(()=>readDxf('AutoCAD Binary DXF\r\n'),/ASCII/);
 assert.throws(()=>readDxf('this is not DXF'),/DXF/);
 const source=makeDxf({code:6,bodies:[[0,'INSERT',2,'block']]});
 assert.throws(()=>importDxf(readDxf(source),'Only block'),/No supported/);
});

function glb(override={}){
 const manifest={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
  meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],
  accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],...override};
 const json=JSON.stringify(manifest), length=Math.ceil(Buffer.byteLength(json)/4)*4;
 const data=new ArrayBuffer(28+length+36);
 const view=new DataView(data);
 [0x46546c67,2,data.byteLength,length,0x4e4f534a].forEach((value,i)=>view.setUint32(i*4,value,true));
 const bytes=new Uint8Array(data,20,length);bytes.fill(32);bytes.set(new TextEncoder().encode(json));
 view.setUint32(20+length,36,true);view.setUint32(24+length,0x004e4942,true);
 new Float32Array(data,28+length).set([0,0,0,1,0,0,0,1,0]);
 return data;
}

test('embedded GLB validation and the real model loader open mesh geometry',async()=>{
 const file=glb();
 assert.equal(inspectPlanGlb(file).asset.version,'2.0');
 const result=await new GLTFLoader().parseAsync(file,'');
 assert.ok(result.scene.children[0].isMesh);
 assert.throws(()=>inspectPlanGlb(glb({buffers:[{uri:'https://elsewhere.invalid/model.bin'}]})),/embedded/);
 assert.throws(()=>inspectPlanGlb(glb({extensionsRequired:['KHR_draco_mesh_compression']})),/uncompressed/);
 assert.throws(()=>inspectPlanGlb(new ArrayBuffer(36)),/valid GLB/);
});

test('local file storage upgrades a v1 plan and preserves original binary GLB across later saves',async()=>{
 globalThis.indexedDB=new IDBFactory();
 const legacy=newDocument('Old plan');
 await new Promise((resolve,reject)=>{
  const request=indexedDB.open(PLAN_DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drawings',{keyPath:'id'}).put(legacy);
  request.onsuccess=()=>{request.result.close();resolve();};
  request.onerror=reject;
 });
 assert.equal((await loadPlan(legacy.id)).name,legacy.name);
 assert.equal(await loadPlanModel(legacy.id),null);
 const doc=newDocument('Imported model'), bytes=glb();
 await savePlan(doc,{model:{name:'model.glb',blob:new Blob([bytes])}});
 await savePlan({...doc,name:'Saved model'});
 const model=await loadPlanModel(doc.id);
 assert.equal(model.name,'model.glb');
 assert.deepEqual(await model.blob.arrayBuffer(),bytes);
 assert.ok((await listPlans()).some(x=>x.name==='Saved model'));
});

test('native CAD source goes to existing project Drawings as the original file',async()=>{
 const calls=[];
 const file=new File(['AC1032 bytes'],'home.DWG');
 const services={
  upload:async value=>{calls.push(['upload',value]);return {document:{id:'native-1',project_id:'p-1'}};},
  selectDocument:(...values)=>calls.push(['select',...values]),
  selectSource:(...values)=>calls.push(['source',...values]),
 };
 const result=await openProjectCadFile({projectId:'p-1',file},services);
 assert.equal(result.url,'/projects/p-1?tab=drawings');
 assert.equal(calls[0][1].file,file);
 assert.deepEqual(calls.slice(1),[['select','p-1','native-1'],['source','p-1','aps']]);
 await assert.rejects(openProjectCadFile({projectId:'p-1',file:new File([],'blank.ifc')},services),/non-empty/);
 assert.equal(calls.length,3);
});
