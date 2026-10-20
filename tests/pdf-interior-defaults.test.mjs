import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildNativePdfScene} from '../src/services/pdfPlanSceneService.mjs';
import {applyDesignDefaults} from '../src/lib/designDefaults.mjs';
import {PDF_INTERIOR_VERSION} from '../src/lib/pdfInteriorDefaults.mjs';
import {placementProblem} from '../src/lib/scenePromptActions.mjs';
import {selectPdfStorey} from '../src/lib/pdfPlanScene.mjs';
import {saveSchematic,readSchematic} from '../src/lib/schematicStorage.mjs';
const identity={projectId:'pdf-design',documentId:'source-doc',documentName:'any.pdf'};
const load=file=>buildNativePdfScene({bytes:new Uint8Array(readFileSync(new URL('./fixtures/'+file,import.meta.url))),...identity});
const raw=await load('pdf-native-opening-input.pdf'),styled=applyDesignDefaults(raw);
const architecture=f=>({documentId:f.documentId,sourcePage:f.sourcePage,width:f.width,depth:f.depth,height:f.height,heightSource:f.heightSource,walls:f.walls,openings:f.openings,footprint:f.footprint,holes:f.holes,floorPlates:f.floorPlates,rooms:f.rooms.map(r=>({id:r.id,polygon:r.polygon,holes:r.holes,sourceArea:r.sourceArea}))});
test('all source storeys receive automatic editable interior proposals without changing a coordinate or measured quantity',()=>{
 assert.equal(styled.pdfStoreys.length,2);
 for(let i=0;i<2;i++){
  const f=styled.pdfStoreys[i];assert.deepEqual(architecture(f),architecture(raw.pdfStoreys[i]));assert.ok(f.assets.length>10);assert.equal(f.pdfInteriorDefaults.version,PDF_INTERIOR_VERSION);assert.equal(f.pdfInteriorDefaults.excludeFromTakeoff,true);
  assert.ok(f.assets.every(a=>a.provenance==='proposed'&&a.excludeFromTakeoff===true));assert.equal(f.pdfPreview.modelCalls,0);
 }
 assert.equal(raw.assets.length,0);assert.equal(raw.pdfStoreys[1].assets.length,0);
});
test('semantic room use selects furniture and finishes instead of placing the same set in every room',()=>{
 const [g,f]=styled.pdfStoreys,types=(floor,id)=>floor.assets.filter(a=>a.roomId===id).map(a=>a.type);
 for(const t of ['sofa','tv_unit','coffee_table'])assert.ok(types(g,'G09').includes(t));
 for(const t of ['kitchen_counter','stove','range_hood','refrigerator','dining_table'])assert.ok(types(g,'G04').includes(t));
 for(const t of ['washing_machine','sink'])assert.ok(types(g,'G02').includes(t));assert.ok(types(g,'G08').includes('desk'));
 assert.ok(types(f,'F01').includes('bed'));assert.ok(types(f,'F01').includes('wardrobe'));assert.ok(types(f,'F11').includes('toilet'));
 assert.equal(g.rooms.find(r=>r.id==='G09').floorFinish,'light_oak');assert.equal(f.rooms.find(r=>r.id==='F11').floorFinish,'wet_tile');
 assert.equal(types(f,'F04+F05').length,0);assert.equal(g.assets.filter(a=>a.roomId==='G01').length,0);
 assert.equal(f.surfaceFinishes.assignments[JSON.stringify(['floor','F07'])],'stone-beige');
});
test('proposals stay in the target rooms, off voids, away from source walls and door clearance',()=>{
 for(const f of styled.pdfStoreys)for(const a of f.assets){
  // Counter inserts and elevated hoods intentionally share their supported parent footprint.
  const assets=f.assets.filter(b=>b.id!==a.id&&!(a.embeddedInCounter&&b.type==='kitchen_counter')&&!(a.type==='kitchen_counter'&&b.embeddedInCounter)&&!(a.type==='range_hood'&&b.id===a.mountedAboveId));
  assert.equal(placementProblem(a,{...f,assets}),null,`${f.floorName} ${a.type}: ${placementProblem(a,{...f,assets})}`);
 }
});
test('re-reading, floor switching and user deletions do not regenerate furniture or overwrite edited colors',()=>{
 assert.equal(applyDesignDefaults(styled),styled);
 const upper=selectPdfStorey(styled,2),removed=upper.assets[0].id;upper.assets=upper.assets.filter(a=>a.id!==removed);upper.palette.wall='#123456';upper.surfaceFinishes.assignments[JSON.stringify(['floor','F07'])]='wood-walnut';
 const lower=selectPdfStorey(upper,1),again=selectPdfStorey(applyDesignDefaults(lower),2);
 assert.ok(!again.assets.some(a=>a.id===removed));assert.equal(again.palette.wall,'#123456');assert.equal(again.surfaceFinishes.assignments[JSON.stringify(['floor','F07'])],'wood-walnut');
 assert.equal(new Set(again.assets.map(a=>a.id)).size,again.assets.length);
});
test('other supported PDF conventions use their source room captions and receive a distinct office interior',async()=>{
 const source=await load('pdf-complex-dimensioned-input.pdf'),designed=applyDesignDefaults(source);
 for(let i=0;i<2;i++){assert.deepEqual(architecture(designed.pdfStoreys[i]),architecture(source.pdfStoreys[i]));assert.ok(designed.pdfStoreys[i].assets.some(a=>a.type==='desk'));}
});
test('normal scene saving applies the global PDF design policy and persists both floors',async()=>{
 const memory=new Map(),records={get:async key=>memory.get(key),putMany:async entries=>{for(const [k,v] of entries)memory.set(k,structuredClone(v));}},storage={getItem:()=>null,setItem(){},removeItem(){}};
 const result=await saveSchematic('pdf-default-persist',raw,{storage,records,syncCloud:false,preserveBase:false});
 assert.ok(result.assets.length);assert.equal(result.pdfStoreys.length,2);assert.ok(result.pdfStoreys[1].assets.length);
 const restored=await readSchematic('pdf-default-persist','schematic3d',{storage,records});assert.deepEqual(restored.assets,result.assets);
});
test('furnished source floors render through the production Three renderer with their finishes and all openings',async()=>{
 const {createRequire}=await import('node:module'),{default:vm}=await import('node:vm');const require=createRequire(import.meta.url);let canvas;
 try{canvas=require('@napi-rs/canvas');}catch{ return; } // Optional rendering harness; not an application dependency.
 const THREE=require('three-test'),parser=require('@babel/parser'),document={createElement:tag=>{if(tag!=='canvas')throw Error('Unexpected DOM element');return canvas.createCanvas(256,256);}};
 const previous=globalThis.document;globalThis.document=document;
 try{
  const source=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
  const declarations=parser.parse(source,{sourceType:'module',plugins:['jsx']}).program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_')));
  const {decorateSurfaceMesh,surfaceMaterialList}=await import('../src/lib/surfaceMaterials.mjs');const {configureFloorDepth}=await import('../src/lib/floorDepthLayers.mjs');const {sourcePresentationAssets}=await import('../src/lib/sourceFurniture.mjs');
  const ctx=vm.createContext({THREE,document,console:{log(){},warn(){},error(){}},structuredClone,decorateSurfaceMesh,surfaceMaterialList,configureFloorDepth,sourcePresentationAssets});vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),ctx);ctx.getThree=()=>THREE;
  for(const f of styled.pdfStoreys){const target=new THREE.Scene(),viewer={impl:{scene:target,removeOverlayScene(){},invalidate(){}},navigation:{}};
   const result=ctx.renderStructuredSchematicScene(viewer,f);assert.equal(result.openingCount,17);assert.ok(result.assetMeshCount>=f.assets.length);assert.equal(result.height,3.2);
   const panels=[],assemblies=[];target.traverse(m=>{if(m.userData?.ventraType==='schematic_door_panel')panels.push(m);if(m.userData?.ventraType==='schematic_door_leaf')assemblies.push(m);});
   assert.equal(panels.length,f.openings.filter(o=>o.type==='door').length,'Every source door must have an actual visible leaf, not just a counted opening');
   assert.equal(assemblies.length,panels.length);
   for(const assembly of assemblies){assert.ok(f.openings.some(o=>o.id===assembly.userData.openingId));assert.equal(assembly.userData.doorVisualSource,'proposed_closed_leaf');}
   assert.equal(ctx.ventraCreateDoorLeafVisual({THREE,opening:{start:{x:0,y:0},end:{x:.9,y:0},height:2.1,preserveRasterTrace:true},material:new THREE.MeshPhongMaterial()}),null,'Raster path must still reject unknown traced swing');
   const floors=[];target.traverse(m=>{if(m.userData?.ventraType==='schematic_room_floor')floors.push(m);});assert.equal(floors.length,f.rooms.length);assert.ok(floors.some(m=>m.material.map));
  }
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
