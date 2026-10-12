import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOpeningEdit,openingDraft,previewOpeningEdit,assertOpeningOnlyEdit} from '../src/lib/manualOpenings.mjs';
import {applyFurnitureEdit,previewFurnitureEdit} from '../src/lib/furnitureEditor.mjs';
import {auditDwgOpenings} from '../src/lib/dwgOpeningAudit.mjs';
import {savedDwgInterior,updateDwgInterior} from '../src/lib/dwgInterior.mjs';
const scene=()=>({source:'dwg-engineering-interior',engineeringUrn:'urn',documentId:'drawing',dwgRegion:1,width:8,depth:6,height:3.2,footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],rooms:[{id:'scope',scopeOnly:true,type:'unknown',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],assets:[],openings:[],walls:[{id:'host',start:{x:0,y:0},end:{x:8,y:0},thickness:.15},{id:'face',start:{x:0,y:.15},end:{x:8,y:.15},thickness:.15},{id:'partition',start:{x:6,y:0},end:{x:6,y:6},thickness:.15}],designDefaults:{version:'room-design-defaults-v64'}});
const door=(s,extra={})=>applyOpeningEdit(s,{kind:'add',catalogId:'manual-door',wallId:'host',offset:.5,...extra});
test('manual door cuts both parallel DWG wall outlines but renders one physical opening',()=>{
 const before=scene(),next=door(before);assert.equal(next.openings.length,2);
 const [primary,cut]=next.openings;assert.equal(primary.wallId,'host');assert.equal(cut.wallId,'face');assert.equal(cut.cutOnly,true);
 assert.equal(primary.width,.9);assert.equal(primary.height,2.1);assert.equal(primary.sillHeight,0);assert.equal(cut.openingGroupId,primary.id);
 assert.equal(auditDwgOpenings(next.openings,next.walls).rejected.length,0);assertOpeningOnlyEdit(before,next);
 assert.equal(primary.excludeFromTakeoff,true);assert.equal(primary.provenance,'proposed');assert.deepEqual(before.openings,[]);
});
test('mouse insertion binds only near the selected wall and validates wall spans and vertical dimensions',()=>{
 const s=scene();const draft=openingDraft(s,{catalogId:'manual-window',point:{x:2,y:.08},width:1.4,height:1,sillHeight:1.1});
 assert.equal(draft.offset,.25);assert.equal(draft.width,1.4);assert.equal(draft.sillHeight,1.1);
 assert.equal(previewOpeningEdit(s,{catalogId:'manual-door',point:{x:3,y:3}}).valid,false);
 assert.throws(()=>door(s,{offset:.01}),/wide|close/);
 assert.throws(()=>door(s,{height:3.5}),/dimensions/);
 assert.throws(()=>openingDraft(s,{catalogId:'manual-door',wallId:'host',point:{x:6,y:2}}),/close/);
});
test('replacing a mistaken window needs explicit replacement and retains unrelated extraction conflicts',()=>{
 const s=scene();s.openings=[{id:'window',type:'window',wallId:'host',offset:.5,width:1.2,height:1.2,sillHeight:.9},{id:'bad-a',type:'door',wallId:'host',offset:.8,width:.9,height:2.1},{id:'bad-b',type:'window',wallId:'host',offset:.8,width:1.2,height:1.2,sillHeight:.9}];
 assert.throws(()=>door(s),/overlaps/);
 const next=door(s,{replaceOverlapping:true});assert.ok(!next.openings.some(o=>o.id==='window'));assert.ok(next.openings.some(o=>o.id==='bad-a'));assert.ok(next.openings.some(o=>o.id==='bad-b'));
});
test('manual opening remove, undo and cross-floor persistence retain architecture and quantities',()=>{
 const original=scene(),added=door(original),removed=applyOpeningEdit(added,{kind:'remove',openingId:added.openings[0].id}),restored=applyOpeningEdit(removed,{kind:'restore',openings:added.openings});
 assert.equal(removed.openings.length,0);assert.deepEqual(restored.openings,added.openings);
 const takeoff={aps_urn:'urn',document_id:'drawing',doors:5,floor_area:150,geometry:{dwgPresentation:{interiorScenes:{0:{...original,dwgRegion:0}}}}};
 const saved=updateDwgInterior(takeoff,restored);assert.equal(saved.doors,5);assert.equal(saved.floor_area,150);assert.deepEqual(saved.geometry.dwgPresentation.interiorScenes[0],takeoff.geometry.dwgPresentation.interiorScenes[0]);
 assert.equal(savedDwgInterior(saved).openings.length,2);
 assert.throws(()=>assertOpeningOnlyEdit(original,{...added,walls:[]}),/walls/);
 assert.throws(()=>assertOpeningOnlyEdit(original,{...added,assets:[{}]}),/assets/);
});
test('DWG review placement is explicit, bypasses uncertain walls only and preserves its review marker',()=>{
 const s=scene(),edit={kind:'add',catalogId:'plant',point:{x:6,y:3}};
 assert.equal(previewFurnitureEdit(s,edit).valid,false);
 const next=applyFurnitureEdit(s,{...edit,freePlacement:true});assert.equal(next.assets.length,1);assert.equal(next.assets[0].placementReview,'unverified_dwg_wall_clearance');assert.deepEqual(next.walls,s.walls);
 assert.throws(()=>applyFurnitureEdit({...s,source:'image-ai-schematic'},{...edit,freePlacement:true}),/wall/);
 assert.throws(()=>applyFurnitureEdit(s,{...edit,point:{x:9,y:3},freePlacement:true}),/inside/);
 const hole={polygon:[{x:5,y:2},{x:7,y:2},{x:7,y:4},{x:5,y:4}]};
 assert.throws(()=>applyFurnitureEdit({...s,holes:[hole]},{...edit,freePlacement:true}),/shaft|void/);
 assert.throws(()=>applyFurnitureEdit(next,{...edit,freePlacement:true}),/overlaps furniture/);
});
test('new cabinet door and L cabinet models are accepted as proposed furniture',()=>{
 const s=scene();s.walls=[];
 for(const catalogId of ['cabinet-door','counter-L','bed-single','wardrobe','nightstand','desk','lamp']){
  const next=applyFurnitureEdit(s,{kind:'add',catalogId,point:{x:3,y:3}});assert.equal(next.assets[0].catalogId,catalogId);assert.equal(next.assets[0].excludeFromTakeoff,true);
 }
});
test('actual Three renderer creates manual doors/windows and companion wall cuts, plus distinct cabinet assets',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm'),{createRequire}=await import('node:module');
 const require=createRequire(import.meta.url),parser=require('@babel/parser'),THREE=require('three-test');
 const source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_')));
 const {sourcePresentationAssets}=await import('../src/lib/sourceFurniture.mjs');const context=vm.createContext({THREE,console,structuredClone,sourcePresentationAssets});
 vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),context);context.getThree=()=>THREE;
 for(const model of ['manual-door','manual-double-door','manual-passage','manual-window']){
  const s=applyOpeningEdit(scene(),{kind:'add',catalogId:model,wallId:'host',offset:.5});
  const threeScene=new THREE.Scene(),viewer={impl:{scene:threeScene,removeOverlayScene(){},invalidate(){}},navigation:{}};
  const report=context.renderStructuredSchematicScene(viewer,{...s,sceneType:'structured',furnishingMode:'source_observed'});
  assert.equal(report.openingCount,1);assert.ok(report.wallPieceCount>3);
  const leafs=[];threeScene.traverse(m=>{if(m.userData?.ventraType==='schematic_door_leaf')leafs.push(m);});
  if(model==='manual-door')assert.equal(leafs.length,1);
  if(model==='manual-double-door')assert.equal(leafs.length,2);
  if(model==='manual-passage')assert.equal(leafs.length,0);
 }
 const s=scene();s.walls=[];
 for(const model of ['cabinet-door','counter-L']){
  const next=applyFurnitureEdit(s,{kind:'add',catalogId:model,point:{x:3,y:3}}),asset=next.assets[0];
  const meshes=context.buildSchematicAssetMeshes({THREE,asset,palette:{},roomWidth:8,roomDepth:6});
  assert.ok(meshes.length>=3);assert.ok(meshes.every(m=>m.userData.assetId===asset.id));
  if(model==='counter-L')assert.ok(meshes.some(m=>Math.abs(m.geometry.parameters.height-.6)<.01));
 }
});
