import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {personalFurnitureModel,personalMaterial,validatePersonalGlb,personalDimensions} from '../src/lib/personalAssets.mjs';
import {glbFurnitureDimensions} from '../src/lib/glbModelBounds.mjs';
import {meshyFurnitureProvider,downloadMeshyGlb,modelGenerationConfig} from '../src/lib/meshyFurniture.mjs';
import {applyFurnitureEdit} from '../src/lib/furnitureEditor.mjs';
import {applyFurnitureBatch,copyFurnitureSnapshot} from '../src/lib/furnitureBatch.mjs';
import {detailedFurnitureKey,createDetailedFurniture} from '../src/lib/detailedFurniture.mjs';
import {applySurfaceMaterial,applySurfaceTextureSize,assertSurfaceOnlyEdit,surfaceTextureSize,surfaceKey,createSurfaceMeshMaterial,decorateSurfaceMesh,surfaceMaterialList} from '../src/lib/surfaceMaterials.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/@napi-rs/canvas');
const id='10000000-0000-4000-8000-000000000001';
import {modelGlb} from './fixtures/personal-model-glb.mjs';

const scene=()=>({width:10,depth:10,height:3,rooms:[{id:'r',polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]}],walls:[],openings:[],assets:[],footprint:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],scheduled_quantities:{wall_area:120}});
const row={id,kind:'model',name:'My chair',furniture_type:'chair',width:.5,depth:.5,height:1};
test('static embedded GLB is accepted, parsed by the actual Three loader and scaled without guessing metres',async()=>{
 const bytes=modelGlb(),doc=validatePersonalGlb(bytes);assert.deepEqual(glbFurnitureDimensions(doc),{width:1.5,depth:.75,height:1.5});
 const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');assert.ok(model.scene.getObjectByProperty('type','Mesh'));
});
test('unsafe, incomplete, compressed and animated GLBs are rejected before loading',()=>{
 for(const change of [d=>d.buffers[0].uri='https://127.0.0.1/private',d=>d.images=[{uri:'https://example.com/a.png'}],d=>d.extensionsRequired=['KHR_draco_mesh_compression'],d=>d.skins=[{}],d=>d.animations=[{}],d=>d.accessors[0].count=1e9,d=>d.bufferViews[0].byteLength=1e8])assert.throws(()=>validatePersonalGlb(modelGlb(change)));
 const truncated=modelGlb().subarray(0,50);assert.throws(()=>validatePersonalGlb(truncated));
 const bad=modelGlb();bad.writeUInt32LE(123,0);assert.throws(()=>validatePersonalGlb(bad));
});
test('GLB dimensions account for transforms and reject graph cycles and empty geometry',()=>{
 assert.deepEqual(glbFurnitureDimensions(validatePersonalGlb(modelGlb(d=>d.nodes[0].scale=[1,2,1]))),{width:.75,depth:.375,height:1.5});
 assert.throws(()=>glbFurnitureDimensions(validatePersonalGlb(modelGlb(d=>d.nodes[0].children=[0]))));
 assert.throws(()=>glbFurnitureDimensions(validatePersonalGlb(modelGlb(d=>d.accessors[0].max=d.accessors[0].min))));
});
test('library references contain stable IDs, never provider URLs or signed credentials',()=>{
 const m=personalFurnitureModel(row);assert.equal(m.customModelId,id);assert.equal(m.id,'personal:'+id);assert.equal(m.preserveModelColors,true);assert.equal(detailedFurnitureKey({customModelId:id,type:'chair'}),'personal:'+id);
 assert.throws(()=>personalFurnitureModel({...row,id:'../../foreign'}));assert.throws(()=>personalDimensions({width:Infinity}));assert.throws(()=>personalDimensions({height:4}));
 assert.equal(personalMaterial({...row,kind:'material'}).assetId,id);
});
test('personal model placement uses the existing room/collision checks and preserves architecture and BOQ',()=>{
 const before=scene(),next=applyFurnitureEdit(before,{kind:'add',catalogId:'personal:'+id,personalModel:row,point:{x:2,y:2}});
 assert.equal(next.assets[0].customModelId,id);assert.equal(next.assets[0].excludeFromTakeoff,true);assert.equal(next.assets[0].width,.5);assert.equal(next.assets[0].preserveModelColors,true);
 for(const key of ['walls','openings','rooms','footprint','scheduled_quantities'])assert.deepEqual(next[key],before[key]);assert.equal(before.assets.length,0);
 assert.throws(()=>applyFurnitureEdit(before,{kind:'add',catalogId:'personal:'+id,personalModel:row,point:{x:15,y:2}}));
 const copied=applyFurnitureBatch(next,{kind:'copy-many',snapshot:copyFurnitureSnapshot(next,[next.assets[0].id]),point:{x:5,y:5}});assert.equal(copied.assets[1].customModelId,id);
 const changed=applyFurnitureEdit(next,{kind:'replace',assetId:next.assets[0].id,catalogId:'chair'});assert.equal(changed.assets[0].customModelId,undefined);
});
test('personal detailed models load once per renderer and use authenticated URL resolution with project scope',async()=>{
 const source=new T.Group(),proxy=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());proxy.userData.assetId='placed';source.add(proxy);source.updateMatrixWorld(true);
 let calls=0,urlCalls=0;const visual=new T.Scene(),mirrors=new Map([[proxy,{visible:true}]]),data={...scene(),projectId:'project-a',assets:[{...personalFurnitureModel(row),id:'placed',xMeters:2,yMeters:3,rotation:0}]};
 const furniture=createDetailedFurniture(visual,data,()=>{}, {loadAsync:async url=>{calls++;assert.equal(url,'https://signed.example/model');return {scene:new T.Mesh(new T.BoxGeometry(1,2,1),new T.MeshStandardMaterial({color:0xff0000}))};}},async(assetId,project)=>{urlCalls++;assert.equal(assetId,id);assert.equal(project,'project-a');return 'https://signed.example/model';});
 furniture.sync(source,mirrors);furniture.sync(source,mirrors);await furniture.ready();await new Promise(r=>setTimeout(r,0));furniture.sync(source,mirrors);
 assert.equal(calls,1);assert.equal(urlCalls,1);assert.equal(mirrors.get(proxy).visible,false);assert.ok(visual.children.length);furniture.dispose();assert.equal(visual.children.length,0);
});
test('generation is opt-in and provider POST is never automatically retried after an uncertain response',async()=>{
 assert.equal(modelGenerationConfig({MESHY_API_KEY:'x'}).configured,false);assert.equal(modelGenerationConfig({MESHY_API_KEY:'x',MESHY_GENERATION_ENABLED:'true'}).configured,true);
 let calls=0;const p=meshyFurnitureProvider({key:'not-a-real-key',fetcher:async()=>{calls++;throw Error('disconnect');}});
 await assert.rejects(p.create('data:image/png;base64,AAAA'),{code:'MODEL_SUBMISSION_UNKNOWN'});assert.equal(calls,1);
});
test('provider request is pinned, textured and bounded; status polling is a separate GET',async()=>{
 const seen=[];const provider=meshyFurnitureProvider({key:'test-only',fetcher:async(url,o)=>{seen.push({url,...o});return Response.json(o.method==='POST'?{result:'job-123'}:{status:'PENDING',progress:1});}});
 assert.equal(await provider.create('data:image/jpeg;base64,AAAA'),'job-123');await provider.get('job-123');
 const request=JSON.parse(seen[0].body);assert.equal(request.target_polycount,15000);assert.equal(request.texture_resolution,'2k');assert.equal(request.should_texture,true);assert.equal(seen[1].method,'GET');
});
test('provider files are limited to HTTPS Meshy hosts and a bounded stream, with no redirect following',async()=>{
 for(const url of ['http://assets.meshy.ai/model.glb','https://127.0.0.1/private','https://assets.meshy.ai.evil.test/a'])await assert.rejects(downloadMeshyGlb(url,()=>{throw Error('must not fetch');}));
 let calls=0;const bytes=await downloadMeshyGlb('https://assets.meshy.ai/a',async(u,o)=>{calls++;assert.equal(o.redirect,'error');return new Response(modelGlb());});assert.ok(bytes.length);assert.equal(calls,1);
 await assert.rejects(downloadMeshyGlb('https://assets.meshy.ai/a',async()=>new Response(new Uint8Array(20)),10));
});
const front={kind:'wall',id:'w',side:'y+'},back={kind:'wall',id:'w',side:'y-'};
const wallScene=()=>({...scene(),walls:[{id:'w',type:'internal'}]});
test('texture size persists per clicked face and never changes the back wall or quantities',()=>{
 const before=applySurfaceMaterial(applySurfaceMaterial(wallScene(),front,'brick-red'),back,'wood-oak');
 const next=applySurfaceTextureSize(before,front,.25);assertSurfaceOnlyEdit(before,next);assert.equal(surfaceTextureSize(next,front),.25);assert.equal(surfaceTextureSize(next,back),2);
 assert.deepEqual(next.scheduled_quantities,before.scheduled_quantities);assert.equal(JSON.parse(JSON.stringify(next)).surfaceFinishes.scales[surfaceKey(front)],.25);
 for(const value of [0,-1,Infinity,NaN,21])assert.throws(()=>applySurfaceTextureSize(before,front,value));
 assertSurfaceOnlyEdit(next,{...next,surfaceFinishes:before.surfaceFinishes});
});
test('legacy whole-wall texture size migrates without changing the other five faces; reset is local',()=>{
 const wall={kind:'wall',id:'w'},before=applySurfaceTextureSize(applySurfaceMaterial(wallScene(),wall,'wood-oak'),wall,4);
 const next=applySurfaceTextureSize(before,front,.5);assert.equal(surfaceTextureSize(next,back),4);assert.equal(surfaceTextureSize(next,front),.5);
 const reset=applySurfaceMaterial(next,front,null);assert.equal(reset.surfaceFinishes.scales[surfaceKey(front)],undefined);assert.equal(surfaceTextureSize(reset,back),4);
});
test('smaller physical texture size increases actual UV repeat density',()=>{
 const large=createSurfaceMeshMaterial(T,'brick-red',()=>createCanvas(256,256),{tileSize:2}),fine=createSurfaceMeshMaterial(T,'brick-red',()=>createCanvas(256,256),{tileSize:.25});
 assert.equal(large.map.repeat.x,.5);assert.equal(fine.map.repeat.x,4);assert.equal(fine.map.repeat.y,4);large.map.dispose();fine.map.dispose();large.dispose();fine.dispose();
});
test('face material cache includes scale, so changing one side never mutates a shared swatch',()=>{
 const a={name:'large'},b={name:'fine'},cache=new Map([['wall:brick-red',a],['wall:brick-red:0.25',b]]);
 let data=applySurfaceMaterial(applySurfaceMaterial(wallScene(),front,'brick-red'),back,'brick-red');data=applySurfaceTextureSize(data,front,.25);
 const mesh={material:{name:'original'},geometry:{faces:[{normal:{x:0,y:1,z:0}},{normal:{x:0,y:-1,z:0}}]}};
 decorateSurfaceMesh({},mesh,{kind:'wall',id:'w'},data,cache);assert.equal(surfaceMaterialList(mesh.material)[2],b);assert.equal(surfaceMaterialList(mesh.material)[3],a);
});
test('personal textures save stable references, use the normal surface guard and reject injected URLs',()=>{
 const m=personalMaterial({id,kind:'material',name:'My stone'}),before=wallScene(),base={...before,surfaceFinishes:{version:1,assignments:{},customMaterials:{[m.id]:m}}};
 const next=applySurfaceMaterial(base,front,m.id);assertSurfaceOnlyEdit(before,next);assert.equal(next.surfaceFinishes.assignments[surfaceKey(front)],m.id);
 assert.throws(()=>assertSurfaceOnlyEdit(before,{...next,surfaceFinishes:{...next.surfaceFinishes,customMaterials:{[m.id]:{...m,url:'https://evil.test'}}}}));
});
