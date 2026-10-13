import {sourcePresentationAssets} from '../src/lib/sourceFurniture.mjs';
import THREE from 'three-test';
import {arrangeLivingFurniture,furnitureOverlaps} from '../src/lib/interiorPresentation.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import parser from '@babel/parser';
const source=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||(n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='VENTRA_SCHEMATIC_ASSET_DEFAULTS')));const c=vm.createContext({arrangeLivingFurniture});vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),c);
const scene=JSON.parse(readFileSync(new URL('fixtures/source-20260926-193231.json',import.meta.url)));
test('source scene immutable; beds retain position and dimensions',()=>{const original=JSON.stringify(scene);const assets=c.ventraPresentationAssets(scene);assert.equal(JSON.stringify(scene),original);for(const a of scene.assets.filter(a=>a.type==='bed')){const b=assets.find(b=>b.type===a.type&&b.roomId===a.roomId);for(const k of ['xMeters','yMeters','width','depth','height'])assert.equal(a[k],b[k]);assert.equal(b.rotation,a.rotation+180);}});
test('presentation is idempotent and rug not duplicated',()=>{const once=c.ventraPresentationAssets(scene);const twice=c.ventraPresentationAssets({...scene,assets:once});assert.equal(JSON.stringify(once),JSON.stringify(twice));});
test('each uploaded bedroom receives one compact dressing table with mirror',()=>{const out=c.ventraPresentationAssets(scene);const v=out.filter(a=>a.type==='dressing_table');assert.equal(v.length,2);assert.equal(new Set(v.map(a=>a.roomId)).size,2);});
test('display adds no unsolicited armchair and leaves original seating untouched',()=>{const out=c.ventraPresentationAssets(scene);assert.equal(out.filter(a=>a.type==='armchair').length,scene.assets.filter(a=>a.type==='armchair').length);});
test('viewer has no geometry repair call on load, refresh or render',()=>{assert.doesNotMatch(source,/repairOpenPlanScene/);});

const current=JSON.parse(readFileSync(new URL('fixtures/source-20260927-110042.json',import.meta.url)));
test('current scene moves TV and armchair out of kitchen without changing a single source byte',()=>{const before=JSON.stringify(current);const out=c.ventraPresentationAssets(current);assert.equal(JSON.stringify(current),before);for(const kind of ['tv_unit','armchair','coffee_table']){const a=out.find(a=>a.type===kind);assert.ok(a,kind+' retained');assert.ok(a.yMeters>5,kind+' outside kitchen');assert.equal(out.filter(b=>b!==a&&b.type!=='rug'&&furnitureOverlaps(a,b,current)).length,0,kind+' has no global furniture overlaps');}const tv=out.find(a=>a.type==='tv_unit');assert.ok(current.walls.some(w=>w.id===tv.againstWallId));assert.equal(tv.rotation,90);const rug=out.find(a=>a.type==='rug'),coffee=out.find(a=>a.type==='coffee_table');assert.equal(rug.xMeters,coffee.xMeters);assert.equal(rug.yMeters,coffee.yMeters);assert.equal(JSON.stringify(out),JSON.stringify(c.ventraPresentationAssets({...current,assets:out})));});
test('current wardrobe and refrigerator leave service fixtures clear',()=>{const out=c.ventraPresentationAssets(current);for(const a of out.filter(a=>['wardrobe','refrigerator'].includes(a.type))){assert.equal(out.filter(b=>b!==a&&b.type!=='rug'&&furnitureOverlaps(a,b,current)).length,0,a.type+' globally clear');}assert.ok(out.find(a=>a.type==='wardrobe'&&a.roomId==='bedroom1').yMeters>4.7);assert.ok(out.find(a=>a.type==='refrigerator').xMeters<8);});
test('door leaf stays anchored to its jamb for either hinge and does not invent swing when evidence is absent',()=>{
 for(const hinge of ['start','end'])for(const angle of [0,90]){
 const opening={start:{x:2,y:3},end:{x:3,y:3},hinge,swing:'counterclockwise',height:2.1,openAngleDegrees:angle};
 const g=c.ventraCreateDoorLeafVisual({THREE,opening,material:new THREE.MeshBasicMaterial()});
 const leaf=g.children.find(m=>m.userData.ventraType==='schematic_door_panel');
 const h=hinge==='start'?opening.start:opening.end;
 assert.ok(Math.abs(leaf.position.x-Math.cos(leaf.rotation.z)*.47-h.x)<1e-8);
 assert.ok(Math.abs(leaf.position.y-Math.sin(leaf.rotation.z)*.47-h.y)<1e-8);
 assert.equal(g.children.filter(m=>m.userData.ventraType==='schematic_door_jamb').length,2);
 }
});
test('actual Three r71 renderer emits low railing posts and retains accepted washer and toilet meshes',()=>{
 const context=c;context.getThree=()=>THREE;context.clearSchematicOverlay=()=>{};context.VENTRA_SCHEMATIC_ROOT_NAME='test';context.sourcePresentationAssets=sourcePresentationAssets;
 context.ventraCreateRoomFloorMaterial=()=>new THREE.MeshBasicMaterial();context.ventraAddVisibleFloorPattern=()=>{};
 const world=new THREE.Scene();
 const source={sceneType:'floorplan_interactive_preview',furnishingMode:'source_observed',width:8,depth:6,height:2.8,footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],rooms:[],openings:[],walls:[{id:'rail',type:'railing',height:1.1,start:{x:0,y:6},end:{x:8,y:6}}],assets:[{id:'washer',type:'washing_machine',xMeters:2,yMeters:2,width:.6,depth:.6,height:.88},{id:'toilet',type:'toilet',xMeters:4,yMeters:2,width:.5,depth:.7,height:.78}],palette:{}};
 const result=context.renderStructuredSchematicScene({impl:{sceneAfter:world,invalidate(){}}},source);
 const posts=[];world.traverse(m=>{if(m.userData?.railingPart==='post')posts.push(m);});
 assert.ok(posts.length>=8);assert.ok(posts.every(p=>p.position.z<=.55&&p.geometry.parameters.depth<=1.1));assert.ok(result.assetCount===2);
});

test('source door leaf retains a narrow width and tall height instead of overrunning its opening',()=>{
 const opening={start:{x:0,y:0},end:{x:.4,y:0},height:2.3,preserveSourceDimensions:true,hinge:'start',swing:'unknown',openAngleDegrees:0};
 const group=c.ventraCreateDoorLeafVisual({THREE,opening,material:new THREE.MeshBasicMaterial(),wallHeight:2.8});
 const leaf=group.children.find(m=>m.userData.ventraType==='schematic_door_panel');
 assert.ok(Math.abs(leaf.geometry.parameters.width-.376)<1e-9);
 assert.ok(Math.abs(leaf.geometry.parameters.depth-2.3)<1e-9);
});
