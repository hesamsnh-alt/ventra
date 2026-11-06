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

test('a reduced set fits a small room where original placement fails, scaling every piece and spacing equally',async()=>{
 const {furnitureSetBounds}=await import('../src/lib/furnitureEditor.mjs');const s=scene();s.width=3.8;s.depth=3.2;s.footprint=[{x:0,y:0},{x:3.8,y:0},{x:3.8,y:3.2},{x:0,y:3.2}];s.rooms=[{id:'living',polygon:s.footprint}];
 const id='sofa-set-comfort-7',point={x:1.9,y:1.8},edit={kind:'add',catalogId:id,point},original=JSON.stringify(s);
 assert.equal(previewFurnitureEdit(s,edit).valid,false);const preview=previewFurnitureEdit(s,{...edit,scale:.7});assert.equal(preview.valid,true);
 const n=applyFurnitureEdit(s,{...edit,scale:.7}),model=FURNITURE_CATALOG.find(m=>m.id===id),b=furnitureSetBounds(model,.7);
 assert.equal(n.assets.length,4);assert.equal(preview.candidate.width,b.width);assert.equal(preview.candidate.depth,b.depth);assert.ok(Math.abs(preview.candidate.yMeters-(point.y+b.centerY))<1e-9);
 for(const [i,a] of n.assets.entries()){
  const p=model.layout[i],base=FURNITURE_CATALOG.find(m=>m.id===p.catalogId);for(const k of ['width','depth','height'])assert.ok(Math.abs(a[k]-base[k]*.7)<1e-9);
  assert.deepEqual(a.renderingBaseDimensions,{width:base.width,depth:base.depth,height:base.height});assert.ok(Math.abs(a.xMeters-point.x-p.x*.7)<1e-9);assert.ok(Math.abs(a.yMeters-point.y-p.y*.7)<1e-9);assert.equal(a.furnitureSetScale,.7);
 }
 assert.equal(JSON.stringify(s),original);assert.deepEqual(JSON.parse(JSON.stringify(n)).assets,n.assets);
});
test('invalid placement scales and collisions remain atomic for all set styles',()=>{
 for(const scale of [NaN,Infinity,0,-1,.49,1.26,'0.7']){const s=scene(),snapshot=JSON.stringify(s);assert.throws(()=>applyFurnitureEdit(s,{kind:'add',catalogId:'sofa-set-modern-6',point:{x:5,y:4},scale}));assert.equal(JSON.stringify(s),snapshot);}
 for(const style of ['modern','comfort','classic']){
  const s=scene();s.assets=[{id:'obstacle',roomId:'living',type:'cabinet',xMeters:5,yMeters:4.07,width:.3,depth:.3,height:1,rotation:0}];const snapshot=JSON.stringify(s);
  assert.throws(()=>applyFurnitureEdit(s,{kind:'add',catalogId:`sofa-set-${style}-6`,point:{x:5,y:4},scale:.7}),/nothing was added/);assert.equal(JSON.stringify(s),snapshot);
 }
});
