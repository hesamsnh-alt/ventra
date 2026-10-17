import * as walls from '../src/lib/manualWalls.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {FURNITURE_CATALOG,LOCKED_ARCHITECTURE,applyFurnitureEdit,previewFurnitureEdit,roomAtPoint,furnitureRotationFromDrag,furnitureSizeFromDrag} from '../src/lib/furnitureEditor.mjs';
const scene=()=>({width:10,depth:8,height:3.2,palette:{wall:'#eee'},rooms:[{id:'r',name:'Living',type:'living',polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}]}],walls:[],openings:[],footprint:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}],holes:[],assets:[],designDefaults:{version:'room-design-defaults-v64'}});
const add=(catalogId='plant',x=5,y=4)=>({kind:'add',catalogId,point:{x,y}});
test('mouse size preserves proportions, clamps supported limits and rejects invalid input',()=>{
 const d={width:2,depth:1,height:.8},bigger=furnitureSizeFromDrag(d,100,{clientX:220}),smaller=furnitureSizeFromDrag(d,100,{clientX:-20});
 assert.ok(bigger.width>2&&smaller.width<2);assert.ok(Math.abs(bigger.depth/bigger.width-.5)<1e-9);assert.ok(Math.abs(bigger.height/bigger.width-.4)<1e-9);
 const max=furnitureSizeFromDrag(d,0,{clientX:100000}),min=furnitureSizeFromDrag(d,0,{clientX:-100000});assert.ok(max.width<=6&&max.depth<=4&&max.height<=3);assert.ok(min.width>=.1&&min.depth>=.04&&min.height>=.01);
 assert.throws(()=>furnitureSizeFromDrag(d,0,{clientX:NaN}),/gesture/);
});
test('resizing preserves position, rotation, unrelated objects and architecture; replacement resets scaling',()=>{
 let s=applyFurnitureEdit(scene(),add('sofa-modern'));s=applyFurnitureEdit(s,add('plant',8,6));const original=s.assets[0],other=structuredClone(s.assets[1]);
 let next=applyFurnitureEdit(s,{kind:'resize',assetId:original.id,size:furnitureSizeFromDrag(original,0,{clientX:60})});
 assert.ok(next.assets[0].width>original.width);assert.equal(next.assets[0].xMeters,original.xMeters);assert.equal(next.assets[0].rotation,original.rotation);assert.deepEqual(next.assets[1],other);
 for(const k of LOCKED_ARCHITECTURE)assert.deepEqual(next[k],s[k]);
 const base=next.assets[0].renderingBaseDimensions;
 next=applyFurnitureEdit(next,{kind:'resize',assetId:original.id,size:furnitureSizeFromDrag(next.assets[0],0,{clientX:-20})});assert.deepEqual(next.assets[0].renderingBaseDimensions,base);
 next=applyFurnitureEdit(next,{kind:'replace',assetId:original.id,catalogId:'sofa-minimal'});assert.equal(next.assets[0].renderingBaseDimensions,undefined);
});
test('oversize collisions, distorted proportions and height above ceiling keep the old scene',()=>{
 const s=applyFurnitureEdit(scene(),add('sofa-modern',2,3)),before=structuredClone(s),a=s.assets[0];
 assert.throws(()=>applyFurnitureEdit(s,{kind:'resize',assetId:a.id,size:{width:a.width*2,depth:a.depth*2,height:a.height*2}}),/outside/);assert.deepEqual(s,before);
 assert.throws(()=>applyFurnitureEdit(s,{kind:'resize',assetId:a.id,size:{width:3,depth:a.depth,height:a.height}}),/proportions/);
 const hood=applyFurnitureEdit(scene(),add('hood')),h=hood.assets[0];
 assert.throws(()=>applyFurnitureEdit(hood,{kind:'resize',assetId:h.id,size:{width:h.width*3,depth:h.depth*3,height:h.height*3}}),/room height/);
});
test('resized dimensions and rendering metadata survive persistent reload',async()=>{
 const {indexedDB}=await import('fake-indexeddb');globalThis.indexedDB=indexedDB;
 const {saveSchematic}=await import('../src/lib/schematicStorage.mjs'),storage={getItem:()=>null,setItem(){},removeItem(){}};
 const s=applyFurnitureEdit(scene(),add('plant')),a=s.assets[0],next=applyFurnitureEdit(s,{kind:'resize',assetId:a.id,size:furnitureSizeFromDrag(a,0,{clientX:50})});
 await saveSchematic('v67-resize',next,{storage,preserveBase:false});const fresh=await import('../src/lib/schematicStorage.mjs?v67-reload');const restored=await fresh.readSchematic('v67-resize','schematic3d',{storage});assert.deepEqual(restored.assets,next.assets);
});
test('mouse rotation is continuous, reversible and optionally snaps to 15 degrees',()=>{
 assert.equal(furnitureRotationFromDrag(30,100,{clientX:140}),50);
 assert.equal(furnitureRotationFromDrag(30,100,{clientX:60}),10);
 assert.equal(furnitureRotationFromDrag(0,100,{clientX:80}),350);
 assert.equal(furnitureRotationFromDrag(30,100,{clientX:140,shiftKey:true}),45);
 assert.throws(()=>furnitureRotationFromDrag(0,100,{clientX:NaN}),/gesture/);
 const s=applyFurnitureEdit(scene(),add('sofa-modern'));const id=s.assets[0].id;
 const next=applyFurnitureEdit(s,{kind:'rotate',assetId:id,rotation:furnitureRotationFromDrag(0,100,{clientX:280})});
 assert.equal(next.assets[0].rotation,90);assert.equal(next.assets[0].xMeters,5);assert.equal(next.assets[0].yMeters,4);
});
test('all 20 catalog models place inside a clear room without mutating architecture or input',()=>{
 for(const m of FURNITURE_CATALOG){const input=scene(),before=structuredClone(input),next=applyFurnitureEdit(input,add(m.id));assert.deepEqual(input,before);for(const k of LOCKED_ARCHITECTURE)assert.deepEqual(next[k],input[k]);assert.equal(next.assets[0].catalogId,m.id);assert.equal(next.assets[0].excludeFromTakeoff,true);assert.equal(next.assets[0].variant,m.variant);}
});
test('dining set is an atomic five-object transaction; blocked chairs reject entire set',()=>{
 const s=scene(),next=applyFurnitureEdit(s,add('dining-set'));assert.equal(next.assets.length,5);
 s.assets=[{id:'block',roomId:'r',type:'plant',xMeters:6.1,yMeters:4,width:.4,depth:.4,height:1,rotation:0}];
 assert.throws(()=>applyFurnitureEdit(s,add('dining-set')),/overlaps/);assert.equal(s.assets.length,1);
 const preview=previewFurnitureEdit(s,add('dining-set'));assert.equal(preview.valid,false);assert.ok(preview.candidate);
});
test('move, rotate, color, replace and delete affect only the selected furniture',()=>{
 let s=applyFurnitureEdit(scene(),add('sofa-modern',3,3));s=applyFurnitureEdit(s,add('plant',8,6));const id=s.assets[0].id,other=structuredClone(s.assets[1]);
 for(const edit of [{kind:'move',point:{x:4,y:4}},{kind:'rotate',rotation:90},{kind:'color',color:'#123456'},{kind:'replace',catalogId:'sofa-luxury'}]){s=applyFurnitureEdit(s,{...edit,assetId:id});assert.deepEqual(s.assets[1],other);}
 assert.equal(s.assets[0].variant,'luxury');assert.equal(s.assets[0].rotation,90);
 assert.throws(()=>applyFurnitureEdit(s,{kind:'replace',assetId:id,catalogId:'plant'}),/same furniture/);
 s=applyFurnitureEdit(s,{kind:'remove',assetId:id});assert.deepEqual(s.assets,[other]);
});
test('invalid placement respects walls, room bounds, holes and door access',()=>{
 const s=scene();assert.equal(roomAtPoint(s,{x:-1,y:1}),null);
 assert.throws(()=>applyFurnitureEdit(s,add('plant',-.1,2)),/point inside/);
 s.walls=[{id:'w',start:{x:5,y:0},end:{x:5,y:8},thickness:.12}];assert.throws(()=>applyFurnitureEdit(s,add()),/wall/);
 s.walls=[];s.holes=[{polygon:[{x:4,y:3},{x:6,y:3},{x:6,y:5},{x:4,y:5}]}];assert.throws(()=>applyFurnitureEdit(s,add()),/shaft/);
 s.holes=[];s.walls=[{id:'w',start:{x:0,y:0},end:{x:10,y:0},thickness:.01}];s.openings=[{type:'door',wallId:'w',offset:.5,width:1}];assert.throws(()=>applyFurnitureEdit(s,add('plant',5,.25)),/door/);
 s.rooms.push({...s.rooms[0],id:'overlap'});assert.equal(roomAtPoint(s,{x:3,y:3}),null);
});
test('identifiers remain unique after removing an earlier asset and adding again',()=>{
 let s=applyFurnitureEdit(scene(),add('plant',2,2));s=applyFurnitureEdit(s,add('plant',5,4));s=applyFurnitureEdit(s,{kind:'remove',assetId:s.assets[0].id});s=applyFurnitureEdit(s,add('plant',2,2));assert.equal(new Set(s.assets.map(a=>a.id)).size,2);
});
test('user deletion survives save and read instead of defaults recreating furniture',async()=>{
 const {indexedDB}=await import('fake-indexeddb');globalThis.indexedDB=indexedDB;
 const {saveSchematic,readSchematic}=await import('../src/lib/schematicStorage.mjs');
 const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const s=applyFurnitureEdit(scene(),add()),next=applyFurnitureEdit(s,{kind:'remove',assetId:s.assets[0].id});
 await saveSchematic('v65-edit-persistence',next,{storage,preserveBase:false});
 assert.deepEqual((await readSchematic('v65-edit-persistence','schematic3d',{storage})).assets,[]);
});
test('actual furniture panel renders localized controls without executing saves',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs'),vm=await import('node:vm'),{loadComponent}=await import('./render-runtime.mjs');
 const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),language=await loadComponent('src/app/components/i18n/LanguageProvider.jsx');
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const compiled=await transform(readFileSync('src/app/projects/[id]/FurnitureEditorPanel.jsx','utf8'),{filename:'FurnitureEditorPanel.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const drawer=await loadComponent('src/app/projects/[id]/ToolDrawer.jsx');
 const batch=await import('../src/lib/furnitureBatch.mjs'),openings=await import('../src/lib/manualOpenings.mjs'),editor=await import('../src/lib/furnitureEditor.mjs'),sandbox={exports:{},require:id=>id==='@/app/components/i18n/LanguageProvider'?language:id==='@/lib/furnitureEditor.mjs'?editor:id==='@/lib/manualOpenings.mjs'?openings:id==='@/lib/manualWalls.mjs'?walls:id==='@/lib/furnitureBatch.mjs'?batch:id==='./ToolDrawer'?drawer:id==='./PersonalAssetLibrary'?{default:()=>null}:id==='@/lib/personalAssets.mjs'?{}:id==='@/services/personalAssetService'?{}:id.endsWith('.module.css')?{}:require(id)};
 vm.createContext(sandbox);vm.runInContext(compiled.code,sandbox);
 for(const [locale,title] of [['en','Furniture studio'],['fa','پنل مبلمان'],['ar','لوحة الأثاث']])assert.ok(renderToStaticMarkup(React.createElement(language.default,{initialLanguage:locale},React.createElement(sandbox.exports.default,{scene:scene(),getRenderer:()=>null,onCommit:()=>{throw new Error('Unexpected save');}}))).includes(title));
});

test('manual placement permits touching edges and nearby doorway space but blocks real collisions',async()=>{
 const {placementProblem}=await import('../src/lib/scenePromptActions.mjs');
 const s=scene();s.assets=[{id:'a',type:'chair',roomId:'r',xMeters:4,yMeters:4,width:1,depth:1,height:1,rotation:0}];
 const candidate={id:'b',type:'chair',roomId:'r',xMeters:5,yMeters:4,width:1,depth:1,height:1,rotation:0};
 assert.equal(placementProblem(candidate,s,{manualFurniturePlacement:true}),null);
 assert.equal(placementProblem(candidate,s),'overlaps furniture');
 assert.equal(placementProblem({...candidate,xMeters:4.9},s,{manualFurniturePlacement:true}),'overlaps furniture');
 s.assets=[];s.walls=[{id:'w',start:{x:0,y:0},end:{x:10,y:0},thickness:.12}];s.openings=[{type:'door',wallId:'w',offset:.5,width:1}];
 const near={...candidate,xMeters:5,yMeters:.8,width:.4,depth:.4};
 assert.equal(placementProblem(near,s,{manualFurniturePlacement:true}),null);
 assert.equal(placementProblem(near,s),'blocks door clearance');
 assert.equal(placementProblem({...near,yMeters:.28},s,{manualFurniturePlacement:true}),'blocks door clearance');
 const input=applyFurnitureEdit(scene(),add('plant',4,4));
 const rotated=applyFurnitureEdit(input,{kind:'rotate',assetId:input.assets[0].id,rotation:45});assert.equal(rotated.assets[0].rotation,45);
});
test('cabinets snap to either wall face and remain flush after rotating without changing architecture',()=>{
 const s=scene();s.walls=[{id:'right',start:{x:10,y:0},end:{x:10,y:8},thickness:.12}];
 const input=structuredClone(s);
 let next=applyFurnitureEdit(s,{...add('cabinet-storage',9.45,4)});
 const a=next.assets[0];assert.ok(Math.abs(a.xMeters+a.width/2-9.94)<1e-9);
 for(const k of LOCKED_ARCHITECTURE)assert.deepEqual(next[k],input[k]);assert.deepEqual(s,input);
 // A pointer near the centreline is corrected to the face on the room side.
 next=applyFurnitureEdit(next,{kind:'move',assetId:a.id,point:{x:9.8,y:4},rotation:90});
 assert.ok(Math.abs(next.assets[0].xMeters+next.assets[0].depth/2-9.94)<1e-9);
 const preview=previewFurnitureEdit(next,{kind:'move',assetId:a.id,point:{x:9.8,y:5},rotation:90});assert.equal(preview.valid,true);assert.ok(Math.abs(preview.candidate.xMeters+preview.candidate.depth/2-9.94)<1e-9);
 // Moving well into the wall is rejected, not teleported across it.
 assert.throws(()=>applyFurnitureEdit(next,{kind:'move',assetId:a.id,point:{x:10,y:4},rotation:0}),/outside|wall|point inside/);
});
test('manual objects may touch polygon edges while significant boundary escape remains blocked',async()=>{
 const {placementProblem}=await import('../src/lib/scenePromptActions.mjs');const s=scene();
 const a={id:'edge',roomId:'r',type:'chair',xMeters:9.5,yMeters:4,width:1,depth:1,height:1,rotation:0};
 assert.equal(placementProblem(a,s,{manualFurniturePlacement:true}),null);
 assert.equal(placementProblem({...a,xMeters:9.53},s,{manualFurniturePlacement:true}),'outside target room');
});
