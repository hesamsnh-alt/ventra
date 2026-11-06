import * as furnitureFinishes from '../src/lib/furnitureFinishes.mjs';
import {configureFloorDepth} from '../src/lib/floorDepthLayers.mjs';
import {raycastVisibleMeshes} from '../src/lib/raycastMeshes.mjs';
import {createWalkthrough} from '../src/lib/walkthroughControls.mjs';
import * as surfaceMaterials from '../src/lib/surfaceMaterials.mjs';
import * as renderQuality from '../src/lib/interiorRenderQuality.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {configureSchematicLighting} from '../src/lib/schematicLighting.mjs';
import {bindFurnitureInputs} from '../src/lib/furnitureInputs.mjs';
import {bindProjectCameraInputs} from '../src/lib/projectCameraInputs.mjs';
import {cameraFitDistance,namedCameraOffset,orbitOffset} from '../src/lib/orbitCamera.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import parser from '@babel/parser';

const require = createRequire(import.meta.url);
const THREE = require(process.env.VENTRA_THREE_TEST_MODULE || 'three-test');
const source = readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx', import.meta.url), 'utf8');
const ast = parser.parse(source, {sourceType:'module', plugins:['jsx']});
const declarations = ast.program.body.filter(node => node.type === 'FunctionDeclaration' ||
  (node.type === 'VariableDeclaration' && node.declarations.some(item => ['VENTRA_SCHEMATIC_ASSET_DEFAULTS','VENTRA_SCHEMATIC_TEXTURE_CACHE'].includes(item.id.name))));
const context = {THREE, console, ...furnitureFinishes, ...surfaceMaterials, ...renderQuality, configureFloorDepth, raycastVisibleMeshes, createWalkthrough};
vm.createContext(context);
vm.runInContext(declarations.map(node => source.slice(node.start, node.end)).join('\n'), context);

const assetMeshes = (type, extra = {}) => context.buildSchematicAssetMeshes({
  THREE, asset: {type, width: 2, depth: 1, height: 0.9, xMeters: 4, yMeters: 4, ...extra},
  palette: {}, roomWidth: 8, roomDepth: 8,
});

test('round catalog table is cylindrical, catalog meshes are pickable by stable ID',()=>{
 const round=assetMeshes('dining_table',{variant:'round',id:'round-1',width:1.2,depth:1.2,height:.76});
 assert.equal(round.length,3);assert.ok(round.every(m=>m.geometry instanceof THREE.CylinderGeometry));assert.ok(round.every(m=>m.userData.assetId==='round-1'));
 assert.notEqual(assetMeshes('sofa',{variant:'luxury'}).length,assetMeshes('sofa',{variant:'minimal'}).length);
});
test('saved furniture scaling changes the complete mesh proportionally around its floor anchor',()=>{
 for(const type of ['sofa','dining_table','plant','range_hood']){
  const base={width:2,depth:1,height:.9},opts={...base,xMeters:4,yMeters:4,...(type==='range_hood'?{zMeters:1.95}:{})};
  const before=assetMeshes(type,opts),after=assetMeshes(type,{...opts,width:3,depth:1.5,height:1.35,renderingBaseDimensions:base});
  assert.equal(after.length,before.length);
  for(let i=0;i<after.length;i++){
   assert.ok(Math.abs(after[i].position.x-before[i].position.x*1.5)<1e-7);assert.ok(Math.abs(after[i].position.y-before[i].position.y*1.5)<1e-7);
   const z=opts.zMeters||0;assert.ok(Math.abs(after[i].position.z-(z+(before[i].position.z-z)*1.5))<1e-7);assert.equal(after[i].scale.x,1.5);assert.equal(after[i].scale.y,1.5);assert.equal(after[i].scale.z,1.5);
  }
 }
});

test('standalone editor ray-picks the floor and furniture with actual r71 and preserves the camera on rebuild (no GPU)',()=>{
 class Canvas{
  ownerDocument={defaultView:context.window,addEventListener(){},removeEventListener(){}};
  style={};clientWidth=800;clientHeight=600;listeners=[];
  addEventListener(type,fn,options){this.listeners.push({type,fn,options});}
  removeEventListener(type,fn){this.listeners=this.listeners.filter(a=>a.type!==type||a.fn!==fn);}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  focus(){}setPointerCapture(){}releasePointerCapture(){}
  send(type,p={}){let stopped=false;const e={type,pointerId:1,clientX:400,clientY:300,button:0,preventDefault(){},stopImmediatePropagation(){stopped=true;},...p};for(const a of this.listeners.filter(a=>a.type===type).sort((a,b)=>Number(!!b.options?.capture)-Number(!!a.options?.capture))){if(stopped)break;a.fn(e);}}
 }
 class Renderer{constructor({canvas}){this.domElement=canvas;}setPixelRatio(){}setSize(){}setClearColor(){}render(){}dispose(){}}
 const oldRenderer=THREE.WebGLRenderer,oldRenderScene=context.renderSchematicScene;
 THREE.WebGLRenderer=Renderer;
 Object.assign(context,{window:{THREE,devicePixelRatio:1,requestAnimationFrame:fn=>fn(),addEventListener(){},removeEventListener(){}},bindFurnitureInputs,bindProjectCameraInputs,cameraFitDistance,namedCameraOffset,orbitOffset,configureSchematicLighting:()=>{}});
 let previewMesh;
 context.renderSchematicScene=adapter=>{
  const root=new THREE.Object3D();root.position.set(-2,-2,0);adapter.impl.scene.add(root);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial());mesh.position.set(0,0,.25);mesh.userData.assetId='plant-1';root.add(mesh);
  previewMesh=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial());previewMesh.position.set(.4,0,.3);previewMesh.userData.assetId='plant-1';root.add(previewMesh);
  return {bounds:{min:{x:-7,y:-6,z:0},max:{x:3,y:2,z:3.2}}};
 };
 try{
  const canvas=new Canvas(),container={clientWidth:800,clientHeight:600,isConnected:true},scene={width:10,depth:8,assets:[{id:'plant-1',xMeters:5,yMeters:4,rotation:0,width:.8,depth:.8,height:1}],designDefaults:{viewOriginMeters:{x:7,y:6}}};
  let selected,point;
  const viewer=context.mountStandaloneSchematicRenderer(container,scene,canvas);viewer.setNamedView('top');
  viewer.setFurnitureTool({start:id=>{selected=id;return {};},commit:p=>{point=p;}});
  canvas.send('pointerdown');canvas.send('pointerup');assert.equal(selected,'plant-1');assert.ok(Math.abs(point.x-5)<1e-7&&Math.abs(point.y-4)<1e-7);
  viewer.setFurnitureTool({start:()=>({}),preview:()=>({valid:true,candidate:{...scene.assets[0],rotation:90,width:.8,depth:.8,previewOperation:'rotate'}})});
  canvas.send('pointerdown');canvas.send('pointermove',{clientX:480});
  assert.ok(Math.abs(previewMesh.position.x)<1e-7&&Math.abs(previewMesh.position.y-.4)<1e-7);
  canvas.send('pointercancel');assert.ok(Math.abs(previewMesh.position.x-.4)<1e-7&&Math.abs(previewMesh.position.y)<1e-7);assert.equal(previewMesh.quaternion.z,0);
  viewer.setFurnitureTool({start:()=>({}),preview:()=>({valid:true,candidate:{...scene.assets[0],width:1.6,depth:1.6,height:2,previewOperation:'resize'}})});
  canvas.send('pointerdown');canvas.send('pointermove',{clientX:480});assert.equal(previewMesh.position.x,.8);assert.equal(previewMesh.position.z,.6);assert.equal(previewMesh.scale.x,2);
  canvas.send('pointercancel');assert.equal(previewMesh.position.x,.4);assert.equal(previewMesh.position.z,.3);assert.equal(previewMesh.scale.x,1);
  const before=viewer.getCameraState();viewer.dispose();assert.equal(canvas.listeners.length,0);
  const rebuilt=context.mountStandaloneSchematicRenderer(container,scene,canvas,before);assert.deepEqual(rebuilt.getCameraState(),before);rebuilt.dispose();assert.equal(canvas.listeners.length,0);
 }finally{THREE.WebGLRenderer=oldRenderer;context.renderSchematicScene=oldRenderScene;delete context.window;}
});

test('default hood renders above the cooker and default room floors use ceramic and parquet',()=>{
 const hood=assetMeshes('range_hood',{width:.6,depth:.48,height:.45,zMeters:1.95});
 const bounds=new THREE.Box3();hood.forEach(m=>{m.updateMatrix();bounds.union(new THREE.Box3().setFromObject(m));});
 assert.ok(hood.length>=3);assert.ok(bounds.min.z>1.9&&bounds.max.z<2.5);
 for(const [type,finish,expected] of [['bathroom','wet_tile','white_ceramic'],['bedroom','light_oak','warm_oak'],['living','light_oak','warm_oak']]){
  const material=context.ventraCreateRoomFloorMaterial({THREE,room:{type,floorFinish:finish},palette:{designPreset:'luxury'},polygon:[]});
  assert.equal(material.userData.ventraFloorFinish,expected);
 }
});

test('prompt furniture types have specific renderers rather than generic placeholder boxes',()=>{
 for(const type of ['freezer','washing_machine','floor_lamp','dressing_table','plant','flower_pot']) {
  const meshes=assetMeshes(type,{width:.7,depth:.7,height:1.6});
  assert.ok(meshes.length>=2,type);
  assert.ok(meshes.every(m=>m.userData.ventraType===`schematic_${type}`));
 }
 const lamp=assetMeshes('floor_lamp',{width:.4,depth:.4,height:1.6});
 assert.ok(lamp.some(m=>m.geometry instanceof THREE.SphereGeometry));
 assert.ok(assetMeshes('washing_machine').some(m=>m.geometry instanceof THREE.CylinderGeometry));
});

test('upholstered sofa has rounded solid cushions inside its declared footprint', () => {
  const meshes = assetMeshes('sofa');
  const cushions = meshes.filter(mesh => mesh.geometry.userData?.upholstery);
  assert.ok(cushions.length >= 5);
  for (const {geometry} of cushions) {
    assert.ok(geometry.vertices.length > 100, 'rounded cushions keep their curved surface detail');
    assert.ok(geometry.vertices.every(v => [v.x,v.y,v.z].every(Number.isFinite)));
    const z = Math.max(...geometry.vertices.map(v => v.z));
    assert.ok(geometry.vertices.some(v => v.z > 0 && v.z < z - 1e-6), 'upper edges curve into the seating surface');
  }
  const bounds = new THREE.Box3();
  meshes.forEach(mesh => {mesh.updateMatrix(); bounds.union(new THREE.Box3().setFromObject(mesh));});
  assert.ok(bounds.min.x >= -1.001 && bounds.max.x <= 1.001, `${bounds.min.x}, ${bounds.max.x}`);
  assert.ok(bounds.min.y >= -0.501 && bounds.max.y <= 0.501, `${bounds.min.y}, ${bounds.max.y}`);
});

test('embedded sink and stove render surface fixtures without overlapping full-height cabinetry', () => {
  for (const type of ['sink', 'stove']) {
    const meshes = assetMeshes(type, {embeddedInCounter:true});
    assert.ok(meshes.length >= 2);
    const bounds = new THREE.Box3();
    meshes.forEach(mesh => {mesh.updateMatrix(); bounds.union(new THREE.Box3().setFromObject(mesh));});
    assert.ok(bounds.min.z > 0.7, `${type} starts at ${bounds.min.z}`);
  }
});

test('lamp shade and wardrobe handles stand on scene Z in actual THREE r71', () => {
  const shade = assetMeshes('nightstand').find(mesh => mesh.geometry instanceof THREE.CylinderGeometry && mesh.geometry.parameters.radiusTop === .1);
  assert.ok(shade);
  assert.ok(Math.abs(shade.rotation.x - Math.PI / 2) < 1e-8);
  const handles = assetMeshes('wardrobe').filter(mesh => mesh.geometry instanceof THREE.CylinderGeometry);
  assert.equal(handles.length, 2);
  assert.ok(handles.every(mesh => Math.abs(mesh.rotation.x - Math.PI / 2) < 1e-8));
});

test('legacy shadow camera properties used by r71 are configured', () => {
  const {key:light} = configureSchematicLighting(THREE,{},new THREE.Scene(),12,8);
  assert.equal(light.shadow, undefined);
  assert.equal(typeof light.shadowCameraLeft, 'number');
  for (const property of ['shadowCameraLeft', 'shadowCameraRight', 'shadowCameraTop', 'shadowCameraBottom', 'shadowCameraNear', 'shadowCameraFar', 'shadowMapWidth', 'shadowMapHeight']) {
    assert.ok(Number.isFinite(light[property]));
  }
});

test('bed fabric has a folded surface without exceeding the observed furniture footprint',()=>{
 const blanket=assetMeshes('bed',{width:1.5,depth:2,height:.9}).find(m=>m.userData.ventraComponent==='bed_fabric');
 assert.ok(blanket);const zs=blanket.geometry.vertices.map(v=>v.z);assert.ok(Math.max(...zs)-Math.min(...zs)>.04);
 assert.ok(blanket.geometry.vertices.every(v=>Math.abs(v.x)<=.75&&Math.abs(v.y)<=1));
 assert.equal(blanket.geometry.faceVertexUvs[0].length,blanket.geometry.faces.length);
});
test('floor textures upload cached clones and use metric UVs on actual legacy triangles',()=>{
 const noop=()=>{},paint=[];
 const ctx={fillRect:(...args)=>paint.push(args),strokeRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,bezierCurveTo:noop,stroke:noop};
 context.document={createElement:()=>({getContext:()=>ctx})};
 try{
  const material=context.ventraCreateRoomFloorMaterial({THREE,room:{type:'bedroom',floorFinish:'light_oak'},palette:{}});
  assert.ok(material instanceof THREE.MeshPhongMaterial);assert.ok(material.map);assert.equal(material.map.image.width,512);assert.equal(material.map.needsUpdate,true);assert.ok(material.bumpMap);
  const count=paint.length;const again=context.ventraCreateRoomFloorMaterial({THREE,room:{type:'bedroom',floorFinish:'light_oak'},palette:{}});
  assert.equal(paint.length,count);assert.notStrictEqual(again.map,material.map);assert.equal(again.map.needsUpdate,true);
  const g=new THREE.Geometry();g.vertices.push(new THREE.Vector3(0,0,0),new THREE.Vector3(2,0,0),new THREE.Vector3(0,3,0));g.faces.push(new THREE.Face3(0,1,2));
  context.ventraApplyFloorMaterialUVs(THREE,g);assert.equal(g.faceVertexUvs[0][0][1].x,2);assert.equal(g.faceVertexUvs[0][0][2].y,3);
 }finally{delete context.document;}
});

test('door lever, mouldings and hinges follow the observed opening on actual Three r71',()=>{
 for(const end of [{x:.8,y:0},{x:0,y:.8}])for(const hinge of ['start','end'])for(const swing of ['clockwise','counterclockwise']){
  const opening={start:{x:0,y:0},end,height:2.1,hinge,swing,openAngleDegrees:90,preserveRasterTrace:true};
  const door=context.ventraCreateDoorLeafVisual({THREE,opening,material:new THREE.MeshPhongMaterial(),wallHeight:2.8});
  const objects=[];door.traverse(o=>objects.push(o));
  const leaf=objects.find(o=>o.userData.ventraType==='schematic_door_panel');
  assert.equal(leaf.geometry.parameters.depth,2.1);
  const hardware=objects.filter(o=>o.userData.ventraType==='schematic_door_handle');assert.equal(hardware.length,2);
  assert.ok(hardware.every(o=>o.geometry.parameters.height===.12&&Math.abs(o.rotation.z-Math.PI/2)<1e-8));
  const hinges=objects.filter(o=>o.userData.ventraType==='schematic_door_hinge');assert.equal(hinges.length,3);
  assert.ok(objects.filter(o=>o.userData.ventraType==='schematic_door_moulding').length===16);
  assert.equal(door.children.find(o=>o instanceof THREE.Group).rotation.z,leaf.rotation.z);
 }
});
test('interior view reveals walls and shared headers reversibly without changing geometry or furniture',()=>{
 const scene=new THREE.Scene(),mat=new THREE.MeshPhongMaterial(),furnitureMat=new THREE.MeshPhongMaterial();
 const wall=new THREE.Mesh(new THREE.BoxGeometry(4,.12,2.8),mat);wall.userData.ventraType='schematic_plan_wall';wall.castShadow=true;
 const header=new THREE.Mesh(new THREE.BoxGeometry(1,.12,.7),mat);header.castShadow=true;
 const sofa=new THREE.Mesh(new THREE.BoxGeometry(2,1,.8),furnitureMat);sofa.castShadow=true;
 scene.add(wall);scene.add(header);scene.add(sofa);
 const vertices=JSON.stringify(wall.geometry.vertices),set=context.ventraCreateInteriorView(scene);
 set(true);assert.ok(mat.opacity>0&&mat.opacity<=.2);assert.equal(mat.depthWrite,false);assert.equal(header.castShadow,false);assert.equal(sofa.castShadow,true);assert.equal(furnitureMat.opacity,1);
 set(false);assert.equal(mat.opacity,1);assert.equal(mat.transparent,false);assert.equal(mat.depthWrite,true);assert.equal(wall.castShadow,true);assert.equal(header.castShadow,true);assert.equal(JSON.stringify(wall.geometry.vertices),vertices);
});

test('curtain variants are real pleated or roller meshes and new sofas and rugs have distinct geometry',()=>{
 const closed=assetMeshes('curtain',{id:'curtain',variant:'closed',width:2,depth:.16,height:2.5}),open=assetMeshes('curtain',{variant:'open',width:2,depth:.16,height:2.5}),roller=assetMeshes('curtain',{variant:'roller',width:1.2,depth:.1,height:1.6}),sheer=assetMeshes('curtain',{variant:'sheer'});
 assert.equal(closed.filter(m=>m.geometry.userData?.curtainPanel).length,2);assert.equal(open.filter(m=>m.geometry.userData?.curtainPanel).length,2);assert.equal(roller.length,3);assert.ok(sheer.some(m=>m.material.transparent&&m.material.opacity<1));assert.ok(closed.every(m=>m.userData.assetId==='curtain'));
 const left=assetMeshes('sofa',{variant:'sectional-left',width:2.8,depth:1.6,height:.85}),right=assetMeshes('sofa',{variant:'sectional-right',width:2.8,depth:1.6,height:.85});
 const chaise=parts=>parts.find(m=>m.geometry.userData?.upholstery&&m.position.y>0);assert.notEqual(chaise(left).position.x,chaise(right).position.x);assert.equal(chaise(left).position.x,-chaise(right).position.x);
 assert.notEqual(assetMeshes('sofa',{variant:'bench'}).length,assetMeshes('sofa',{variant:'modern'}).length);
 assert.ok(assetMeshes('rug',{variant:'persian',width:2.4,depth:1.7,height:.03}).some(m=>m.geometry.userData?.rugSurface));
 assert.ok(assetMeshes('rug',{variant:'round',width:1.8,depth:1.8,height:.03}).some(m=>m.geometry instanceof THREE.CylinderGeometry));
});

test('continuous curtain folds, cloth normals and metric bounds survive both legacy and modern geometry',async()=>{
 const Modern=await import('three');
 for(const engine of [THREE,Modern])for(const variant of ['closed','open','sheer','roller']){
  const params={type:'curtain',id:'cloth',width:2,depth:.16,height:2.5,xMeters:4,yMeters:4,color:'#a78f79',variant},copy=JSON.stringify(params);
  const parts=context.buildSchematicAssetMeshes({THREE:engine,asset:params,palette:{},roomWidth:8,roomDepth:8});
  assert.equal(JSON.stringify(params),copy);assert.ok(parts.length<25);const bounds=new engine.Box3();let triangles=0;
  for(const p of parts){p.updateMatrixWorld(true);bounds.union(new engine.Box3().setFromObject(p));triangles+=p.geometry.faces?.length??p.geometry.index.count/3;}
  assert.ok(triangles<13000);assert.ok(bounds.min.x>=-1.001&&bounds.max.x<=1.001);assert.ok(bounds.min.z>=0&&bounds.max.z<=2.501);
  const panel=parts.find(m=>m.material.userData?.ventraTextile==='curtain');assert.ok(panel.material.map.image.data.length>10000);assert.ok(panel.material.bumpMap!==panel.material.map);
  const g=panel.geometry;assert.ok((g.vertices?.length??g.attributes.position.count)>400);assert.ok(g.faceVertexUvs?.[0]?.length||g.attributes.uv.count);
 }
});
test('rug motifs are textured and fringes batched, without raised block ornaments',()=>{
 for(const variant of ['persian','round','runner','minimal']){
  const parts=assetMeshes('rug',{variant,color:'#89343b',width:2.4,depth:1.7,height:.03});assert.ok(parts.length<=3);
  const surface=parts.find(p=>p.geometry.userData?.rugSurface);assert.equal(surface.material.userData.ventraTextile,'rug');assert.equal(surface.material.map.image.width,512);
  assert.equal(surface.material.bumpMap.image.width,128);assert.notEqual(surface.material.map,surface.material.bumpMap);
  const pixels=surface.material.map.image.data;assert.ok(new Set(Array.from(pixels).filter((_,i)=>i%4!==3)).size>(variant==='persian'?30:5));
  const bounds=new THREE.Box3();for(const p of parts){p.updateMatrixWorld(true);bounds.union(new THREE.Box3().setFromObject(p));}assert.ok(bounds.min.z>=0&&bounds.max.z<=.031);
 }
});

test('modern, minimal, comfort and classic sofas retain distinct shapes and independent catalog colors',()=>{
 const variants=['modern','minimal','comfort','traditional'],colors=['#b4a28f','#d4c8b7','#a5b3a0','#bca07c'];
 const signatures=variants.map((variant,i)=>{
  const parts=assetMeshes('sofa',{variant,color:colors[i],width:2.4,depth:1,height:1.05});
  const cloth=parts.find(p=>p.material.userData?.ventraTextile==='fabric');assert.ok(cloth);assert.equal(cloth.material.color.getHexString(),colors[i].slice(1));
  return JSON.stringify(parts.map(p=>[p.position.toArray(),p.geometry.vertices.length,p.geometry.faces.length]));
 });assert.equal(new Set(signatures).size,4);
});

test('picture frames have raised borders, a real artwork plane and hanging height without changing scene data',()=>{
 for(const variant of ['oak','black','gold','white','triptych']){
  const a={id:'art',type:'picture_frame',variant,width:variant==='triptych'?1.6:.8,depth:.055,height:.65,xMeters:4,yMeters:4,zMeters:1.1,color:'#ad855b'},before=JSON.stringify(a);
  const parts=context.buildSchematicAssetMeshes({THREE,asset:a,palette:{},roomWidth:8,roomDepth:8});assert.equal(JSON.stringify(a),before);assert.ok(parts.every(m=>m.userData.assetId==='art'));
  const planes=parts.filter(m=>m.geometry instanceof THREE.PlaneGeometry);assert.equal(planes.length,variant==='triptych'?3:1);assert.ok(planes.every(m=>m.material.map.image.width===256&&m.material.side===THREE.DoubleSide));
  const box=new THREE.Box3();parts.forEach(m=>{m.updateMatrixWorld(true);box.union(new THREE.Box3().setFromObject(m));});assert.ok(box.min.z>=1.099&&box.max.z<=1.751);
 }
});
test('TV variants render a 16:9 image display and distinct stand, console and media wall geometry',()=>{
 const signatures=[];
 for(const variant of ['wall-mounted','console-oak','console-white','pedestal','media-wall']){
  const parts=assetMeshes('tv_unit',{variant,width:variant==='media-wall'?2.4:1.8,depth:variant==='wall-mounted'?.065:.45,height:variant==='media-wall'?2.4:1.45});
  const screen=parts.find(m=>m.userData.televisionScreen);assert.ok(screen);assert.equal(screen.material.map.image.width,256);assert.equal(screen.material.map.image.height,144);assert.equal(screen.material.side,THREE.DoubleSide);assert.ok(parts.length<35);
  const box=new THREE.Box3();parts.forEach(m=>{m.updateMatrixWorld(true);box.union(new THREE.Box3().setFromObject(m));});assert.ok(box.min.z>=-.001);assert.ok(box.max.z<=(variant==='media-wall'?2.401:1.451));signatures.push(parts.length);
 }
 assert.ok(new Set(signatures).size>=3);
 const wall=assetMeshes('wall_tv',{variant:'wall-mounted',width:1.24,depth:.06,height:.71,zMeters:1.1});assert.ok(wall.some(m=>m.userData.televisionScreen));
});
test('new curtain styles retain curved cloth with genuinely layered and Roman geometry',()=>{
 const variants=['eyelet','linen','blackout','double-layer','roman','tieback'];const counts=[];
 for(const variant of variants){const parts=assetMeshes('curtain',{variant,width:2,depth:.25,height:2.6});assert.ok(parts.some(m=>m.geometry.userData?.textileSurface));assert.ok(parts.length<=40);counts.push(parts.length);}
 assert.ok(new Set(counts).size>=3);
});
test('furniture finishes replace body and upholstery separately, protect TV screens and reset to original geometry',()=>{
 const plain=assetMeshes('sofa',{variant:'modern'}),finished=assetMeshes('sofa',{variant:'modern',furnitureFinishes:{body:{id:'wood-walnut'},upholstery:{id:'fabric-linen'}}});
 assert.equal(plain.length,finished.length);assert.ok(finished.some(m=>m.material.userData?.furnitureFinish==='wood-walnut'));assert.ok(finished.some(m=>m.material.userData?.furnitureFinish==='fabric-linen'));
 const tv=assetMeshes('tv_unit',{variant:'console-oak',furnitureFinishes:{body:{id:'metal-brushed'}}});assert.ok(tv.some(m=>m.material.userData?.furnitureFinish==='metal-brushed'));const screen=tv.find(m=>m.userData.televisionScreen);assert.ok(screen.material.map);assert.equal(screen.material.userData?.furnitureFinish,undefined);
 const reset=assetMeshes('sofa',{variant:'modern'});assert.ok(reset.every(m=>!m.material.userData?.furnitureFinish));assert.equal(reset.length,plain.length);
});
