import test from 'node:test';import assert from 'node:assert/strict';
import {applyFacade,exteriorFaces,editExteriorBox,assertExteriorOnlyEdit,buildExteriorDesignMeshes} from '../src/lib/exteriorDesign.mjs';
import {surfaceKey,applySurfaceMaterial,decorateSurfaceMesh,surfaceMaterialList} from '../src/lib/surfaceMaterials.mjs';
import {FURNITURE_CATALOG} from '../src/lib/furnitureEditor.mjs';
import {FURNITURE_CATEGORIES,filterFurniture} from '../src/lib/furnitureCategories.mjs';
import * as THREE from 'three';
const scene=()=>({width:8,depth:6,height:3,footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],rooms:[{id:'r',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],walls:[{id:'south',start:{x:0,y:0},end:{x:8,y:0},thickness:.15},{id:'east',start:{x:8,y:0},end:{x:8,y:6},thickness:.15},{id:'north',start:{x:8,y:6},end:{x:0,y:6},thickness:.15},{id:'west',start:{x:0,y:6},end:{x:0,y:0},thickness:.15},{id:'partition',start:{x:4,y:0},end:{x:4,y:6},thickness:.15}],assets:[],openings:[],boq:{total:1234}});
const fakeCanvas=()=>({width:0,height:0,getContext:()=>new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]||(()=>{})})});
function withCanvas(fn){const old=globalThis.document;globalThis.document={createElement:fakeCanvas};try{return fn();}finally{globalThis.document=old;}}
for(const preset of ['stone','roman','brick','wood'])test(`${preset} facade changes only outward faces and survives JSON reload`,()=>{
 let s=applySurfaceMaterial(scene(),{kind:'wall',id:'south'},'paint-blue');s=applySurfaceMaterial(s,{kind:'floor',id:'r'},'wood-oak');
 const snapshot=JSON.stringify(s),n=applyFacade(s,{preset,color:'#bca789'});assertExteriorOnlyEdit(s,n);assert.equal(JSON.stringify(s),snapshot);assert.equal(exteriorFaces(s).length,4);
 for(const k of ['rooms','walls','openings','assets','boq'])assert.deepEqual(n[k],s[k]);
 assert.equal(n.surfaceFinishes.assignments[surfaceKey({kind:'wall',id:'south',side:'y+'})],'paint-blue');
 assert.equal(n.surfaceFinishes.assignments[surfaceKey({kind:'floor',id:'r'})],'wood-oak');assert.equal(JSON.parse(JSON.stringify(n)).exteriorDesign.preset,preset);
});
test('reversed wall direction and concave footprints identify outside consistently',()=>{
 const s=scene();s.walls[0]={...s.walls[0],start:{x:8,y:0},end:{x:0,y:0}};
 assert.equal(exteriorFaces(s).find(f=>f.id==='south').side,'y+');
 s.footprint=[{x:0,y:0},{x:8,y:0},{x:8,y:3},{x:4,y:3},{x:4,y:6},{x:0,y:6}];s.walls.push({id:'notch',start:{x:4,y:3},end:{x:8,y:3}});
 const f=exteriorFaces(s).find(f=>f.id==='notch');assert.equal(f.side,'y+');assert.equal(f.ny,1);
 assert.throws(()=>applyFacade({...s,footprint:[]},{preset:'stone',color:'#ffffff'}),/exterior/);
});
test('manual boxes support independent positions, sizes, rotation, material and deletion without changing takeoff',()=>{
 const s=scene(),draft={kind:'add',x:-.5,y:3,z:.5,width:2,depth:.3,height:1.4,rotation:90,color:'#d0c0a0',material:'brick-red'};
 const a=editExteriorBox(s,draft),id=a.exteriorDesign.boxes[0].id;assertExteriorOnlyEdit(s,a);assert.equal(a.exteriorDesign.boxes[0].excludeFromTakeoff,true);
 const b=editExteriorBox(a,{...draft,kind:'update',id,x:-1,material:'wood-oak'});assert.equal(b.exteriorDesign.boxes[0].x,-1);assert.deepEqual(b.boq,s.boq);
 const c=editExteriorBox(b,{kind:'remove',id});assert.equal(c.exteriorDesign.boxes.length,0);assert.equal(s.exteriorDesign,undefined);
 for(const bad of [{height:-1},{x:Infinity},{color:'red'},{material:'bogus'}])assert.throws(()=>editExteriorBox(s,{...draft,...bad}));
});
test('actual facade mesh has metric dimensions, transform and material and Roman trims leave window space clear',()=>withCanvas(()=>{
 const s=scene();s.openings=[{wallId:'south',wallPosition:{x:.18,y:0},width:1,height:2.3,sillHeight:0}];
 const n=editExteriorBox(applyFacade(s,{preset:'roman',color:'#ffffff'}),{kind:'add',x:4,y:-.5,z:1,width:2,depth:.3,height:.8,rotation:90,color:'#aabbcc',material:'wood-oak'});
 const meshes=buildExteriorDesignMeshes(THREE,n),b=meshes.find(m=>m.userData.exteriorBoxId);assert.ok(meshes.length>8);assert.equal(b.geometry.parameters.width,2);assert.equal(b.position.x,0);assert.equal(b.position.y,-3.5);assert.equal(b.position.z,1.4);assert.equal(b.rotation.z,Math.PI/2);assert.equal(b.material.userData.ventraSurfaceMaterial,'wood-oak');
 const southPilasters=meshes.filter(m=>!m.userData.exteriorBoxId&&m.position.y<-3&&m.geometry.parameters.depth>1);assert.equal(southPilasters.length,1);
}));
test('facade tint affects exterior material only, preserving the interior shared material',()=>withCanvas(()=>{
 const s=applyFacade(scene(),{preset:'brick',color:'#334455'}),base=new THREE.MeshPhongMaterial({color:'#ff0000'}),mesh=new THREE.Mesh(new THREE.BoxGeometry(8,.15,3),base);
 decorateSurfaceMesh(THREE,mesh,{kind:'wall',id:'south'},s,new Map());const mats=surfaceMaterialList(mesh.material);assert.equal(mats[3].color.getHexString(),'334455');assert.equal(mats[2].color.getHexString(),'ff0000');assert.equal(base.color.getHexString(),'ff0000');
}));
test('category dropdown covers every catalog model exactly once outside All and supports Persian search',()=>{
 for(const m of FURNITURE_CATALOG)assert.equal(FURNITURE_CATEGORIES.filter(c=>c.id!=='all'&&filterFurniture([m],c.id).length).length,1,m.id);
 assert.equal(new Set(FURNITURE_CATALOG.map(m=>m.id)).size,FURNITURE_CATALOG.length);
 assert.equal(filterFurniture(FURNITURE_CATALOG,'curtains').length,10);assert.ok(filterFurniture(FURNITURE_CATALOG,'rugs','ایرانی').some(m=>m.id==='rug-persian'));
});

test('facade and manual boxes persist through actual schematic storage reload',async()=>{
 const {indexedDB}=await import('fake-indexeddb');globalThis.indexedDB=indexedDB;
 const {saveSchematic}=await import('../src/lib/schematicStorage.mjs');
 const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const s={...scene(),designDefaults:{version:'room-design-defaults-v64'}},n=editExteriorBox(applyFacade(s,{preset:'wood',color:'#ffffff'}),{kind:'add',x:2,y:-.4,z:1,width:1,depth:.2,height:1,rotation:30,color:'#ffffff',material:'wood-oak'});
 await saveSchematic('exterior-design-persistence',n,{storage,syncCloud:false});
 const fresh=await import('../src/lib/schematicStorage.mjs?exterior-reload'),restored=await fresh.readSchematic('exterior-design-persistence','schematic3d',{storage});
 assert.deepEqual(restored.exteriorDesign,n.exteriorDesign);assert.deepEqual(restored.surfaceFinishes,n.surfaceFinishes);assert.deepEqual(restored.boq,s.boq);
});
