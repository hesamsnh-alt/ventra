import test from 'node:test';import assert from 'node:assert/strict';
import {FURNITURE_CATALOG,applyFurnitureEdit,previewFurnitureEdit,LOCKED_ARCHITECTURE} from '../src/lib/furnitureEditor.mjs';
import {filterFurniture} from '../src/lib/furnitureCategories.mjs';
const scene=()=>({width:10,depth:8,height:3.2,assets:[],walls:[],openings:[],holes:[],footprint:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}],rooms:[{id:'living',polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}]}],boq:{keep:true},designDefaults:{version:'room-design-defaults-v64'}});
for(const style of ['modern','classic','comfort'])for(const seats of [6,7])test(`${style} ${seats}-seat set places all seating and coffee table in one transaction`,()=>{
 const s=scene(),copy=JSON.stringify(s),id=`sofa-set-${style}-${seats}`,edit={kind:'add',catalogId:id,point:{x:5,y:4}},preview=previewFurnitureEdit(s,edit),n=applyFurnitureEdit(s,edit);
 assert.equal(preview.valid,true);assert.equal(n.assets.length,4);assert.equal(n.assets.reduce((n,a)=>n+a.seatingCapacity,0),seats);assert.equal(n.assets.filter(a=>a.type==='coffee_table').length,1);
 assert.equal(new Set(n.assets.map(a=>a.furnitureSetId)).size,1);assert.ok(n.assets.every(a=>a.furnitureSetCatalogId===id&&a.excludeFromTakeoff&&a.provenance==='proposed'));
 assert.equal(n.assets[0].variant,style==='classic'?'traditional':style);for(const k of LOCKED_ARCHITECTURE)assert.deepEqual(n[k],s[k]);assert.deepEqual(n.boq,s.boq);assert.equal(JSON.stringify(s),copy);
});
test('collision of the final coffee table rejects the entire set without partial furniture or scene writes',()=>{
 const s=scene();s.assets=[{id:'blocker',type:'cabinet',roomId:'living',xMeters:5,yMeters:4.1,width:.4,depth:.4,height:.6,rotation:0}];const copy=JSON.stringify(s),edit={kind:'add',catalogId:'sofa-set-modern-7',point:{x:5,y:4}};
 assert.equal(previewFurnitureEdit(s,edit).valid,false);assert.throws(()=>applyFurnitureEdit(s,edit),/nothing was added/);assert.equal(JSON.stringify(s),copy);
 const edge={...edit,point:{x:.5,y:.5}};assert.throws(()=>applyFurnitureEdit(scene(),edge),/nothing was added/);
});
test('set orientation, independent color editing and saved metadata preserve the other components',()=>{
 const a=applyFurnitureEdit(scene(),{kind:'add',catalogId:'sofa-set-classic-6',point:{x:5,y:4},rotation:90});assert.equal(a.assets[0].rotation,90);assert.ok(Math.abs(a.assets[0].xMeters-6.5)<1e-6);
 const id=a.assets[0].id,n=applyFurnitureEdit(a,{kind:'color',assetId:id,color:'#3344ff'});assert.equal(n.assets[0].color,'#3344ff');assert.deepEqual(n.assets.slice(1),a.assets.slice(1));assert.deepEqual(JSON.parse(JSON.stringify(n)).assets,n.assets);
 assert.throws(()=>applyFurnitureEdit(a,{kind:'replace',catalogId:'sofa-set-modern-7',assetId:id}),/cannot replace/);
});
test('sets have a dedicated dropdown category and never recurse into another set',()=>{
 const sets=filterFurniture(FURNITURE_CATALOG,'sets');assert.equal(sets.length,6);assert.equal(filterFurniture(sets,'sofas').length,0);
 for(const set of sets)for(const p of set.layout){const child=FURNITURE_CATALOG.find(m=>m.id===p.catalogId);assert.ok(child);assert.equal(child.layout,undefined);}
});
