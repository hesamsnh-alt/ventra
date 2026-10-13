import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {fitDetailedFurniture,detailedFurnitureKey,createDetailedFurniture} from '../src/lib/detailedFurniture.mjs';
test('detailed Y-up furniture fits exact floor footprint and upright height without changing source',()=>{
 const model=new T.Mesh(new T.BoxGeometry(2,1,3),new T.MeshStandardMaterial());model.position.set(4,2,7);
 const before=model.position.toArray();const fitted=fitDetailedFurniture(model,.8,.6,1.4);fitted.updateMatrixWorld(true);
 const b=new T.Box3().setFromObject(fitted),size=b.getSize(new T.Vector3());
 for(const [n,v] of [[size.x,.8],[size.y,.6],[size.z,1.4],[b.min.z,0]])assert.ok(Math.abs(n-v)<1e-6);
 assert.deepEqual(model.position.toArray(),before);
 const up=new T.Vector3(0,1,0).transformDirection(model.matrixWorld);assert.ok(up.z>.99);
});
test('detailed catalog leaves unsupported types and modern/minimal sofa variants intact',()=>{
 assert.equal(detailedFurnitureKey({type:'plant'}),'potted_plant_02');assert.equal(detailedFurnitureKey({type:'chair'}),'dining_chair_02');assert.equal(detailedFurnitureKey({type:'sofa'}),'sofa_02');assert.equal(detailedFurnitureKey({type:'sofa',variant:'minimal'}),null);assert.equal(detailedFurnitureKey({type:'door'}),null);
});
test('async asset replacement retains proxies, follows preview transforms, and loads each model once',async()=>{
 const render=new T.Scene(),source=new T.Scene(),part=new T.Mesh(new T.BoxGeometry(.5,.5,.5),new T.MeshBasicMaterial());part.userData.assetId='p';source.add(part);source.updateMatrixWorld(true);
 const proxy=new T.Mesh(part.geometry,part.material),mirrors=new Map([[part,proxy]]);render.add(proxy);
 let loads=0;const model=new T.Mesh(new T.BoxGeometry(.5,1,.5),new T.MeshStandardMaterial());
 const controller=createDetailedFurniture(render,{width:8,depth:6,assets:[{id:'p',type:'plant',width:.5,depth:.5,height:1,xMeters:4,yMeters:3}]},()=>{}, {loadAsync:async()=>{loads++;return {scene:model};}});
 controller.sync(source,mirrors);await controller.ready();await Promise.resolve();controller.sync(source,mirrors);
 assert.equal(proxy.visible,false);assert.equal(source.children[0],part);assert.equal(part.visible,true);assert.equal(loads,1);
 const detailed=render.children.find(o=>o!==proxy);assert.ok(detailed);
 part.position.x=2;source.updateMatrixWorld(true);controller.sync(source,mirrors);detailed.updateMatrixWorld(true);assert.ok(Math.abs(detailed.matrix.elements[12]-2)<1e-6);
 source.remove(part);controller.sync(source,mirrors);assert.ok(!render.children.includes(detailed));controller.dispose();
});
test('failed asset loading preserves original render and does not retry on every frame',async()=>{
 const source=new T.Scene(),render=new T.Scene(),part=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());part.userData.assetId='p';source.add(part);source.updateMatrixWorld(true);const proxy=part.clone();render.add(proxy);let loads=0;
 const c=createDetailedFurniture(render,{assets:[{id:'p',type:'plant'}]},()=>{}, {loadAsync:async()=>{loads++;throw Error('offline');}});
 c.sync(source,new Map([[part,proxy]]));await c.ready();await Promise.resolve();c.sync(source,new Map([[part,proxy]]));assert.equal(proxy.visible,true);assert.equal(loads,1);c.dispose();
});
