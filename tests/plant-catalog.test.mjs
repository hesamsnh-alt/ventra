import test from 'node:test';import assert from 'node:assert/strict';import {FURNITURE_CATALOG,applyFurnitureEdit,LOCKED_ARCHITECTURE} from '../src/lib/furnitureEditor.mjs';import {detailedFurnitureKey} from '../src/lib/detailedFurniture.mjs';
const ids=['plant-heart-small','plant-heart-large','tree-potted','tree-potted-tall','plant-calathea','plant-calathea-large','plant-succulent'];
const base=()=>({width:10,depth:8,height:3.2,palette:{},rooms:[{id:'r',type:'living',polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}]}],assets:[],walls:[],openings:[],holes:[],footprint:[]});
test('seven plant presets have trilingual labels and four actual model families, with old plant preserved',()=>{
 assert.ok(FURNITURE_CATALOG.find(m=>m.id==='plant'));
 const models=ids.map(id=>{const m=FURNITURE_CATALOG.find(m=>m.id===id);assert.ok(m);for(const lang of ['en','fa','ar'])assert.ok(m[lang].length>3);return detailedFurnitureKey({type:m.type,catalogId:m.id});});assert.equal(new Set(models).size,4);
});
test('all new plants retain their catalog identity through rotate, resize and removal without changing architecture',()=>{
 for(const id of ids){const input=base();let s=applyFurnitureEdit(input,{kind:'add',catalogId:id,point:{x:5,y:4}});const a=s.assets[0];s=applyFurnitureEdit(s,{kind:'rotate',assetId:a.id,rotation:180});s=applyFurnitureEdit(s,{kind:'resize',assetId:a.id,size:{width:a.width*1.1,depth:a.depth*1.1,height:a.height*1.1}});assert.equal(s.assets[0].catalogId,id);for(const key of LOCKED_ARCHITECTURE)assert.deepEqual(s[key],input[key]);s=applyFurnitureEdit(s,{kind:'remove',assetId:a.id});assert.equal(s.assets.length,0);}
});
test('Calathea catalog resolves a single plant variant, rather than the whole multi-variant asset pack',async()=>{
 const T=await import('three'),{createDetailedFurniture}=await import('../src/lib/detailedFurniture.mjs');
 const source=new T.Scene(),part=new T.Mesh(new T.BoxGeometry(.5,.5,.5),new T.MeshBasicMaterial());part.userData.assetId='cal';source.add(part);source.updateMatrixWorld(true);
 const pack=new T.Group();for(const name of ['a','b','c','d','e']){const m=new T.Mesh(new T.BoxGeometry(.4,.4,.4),new T.MeshStandardMaterial({name:'leaves',color:0x22aa33}));m.name='calathea_orbifolia_01_'+name;pack.add(m);}
 const render=new T.Scene(),proxy=part.clone();render.add(proxy);const c=createDetailedFurniture(render,{width:8,depth:6,assets:[{id:'cal',catalogId:'plant-calathea',type:'plant',width:.65,depth:.65,height:.85,xMeters:4,yMeters:3,color:'#cc8866'}]},()=>{},{loadAsync:async()=>({scene:pack})});
 c.sync(source,new Map([[part,proxy]]));await c.ready();await Promise.resolve();c.sync(source,new Map([[part,proxy]]));const real=render.children.find(m=>m!==proxy);const leafMeshes=[];real.traverse(m=>{if(m.material?.name==='leaves')leafMeshes.push(m);});assert.equal(leafMeshes.length,1);assert.equal(leafMeshes[0].name,'calathea_orbifolia_01_b');assert.equal(leafMeshes[0].material.color.getHex(),0x22aa33);c.dispose();
});
