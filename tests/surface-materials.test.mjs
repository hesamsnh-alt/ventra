import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {saveSchematic,readSchematic} from '../src/lib/schematicStorage.mjs';
import {SURFACE_GROUPS,SURFACE_MATERIALS,SURFACE_MIME,applySurfaceMaterial,assertSurfaceOnlyEdit,
  surfaceKey,pickSurfaceHit,applySurfaceUVs,decorateSurfaceMesh} from '../src/lib/surfaceMaterials.mjs';
import {bindSurfaceMaterialInputs,bindSurfaceMaterialUndo} from '../src/lib/surfaceMaterialInputs.mjs';

const scene=()=>({documentId:'drawing-a',width:10,depth:8,height:3,source:'image-interactive-preview-v3',
  rooms:[{id:'a',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4}]},{id:'b',polygon:[{x:4,y:0},{x:8,y:0},{x:8,y:4}]}],
  footprint:[{x:0,y:0},{x:10,y:0},{x:10,y:8}],walls:[{id:'w1',type:'internal'},{id:'w2',type:'external'},{id:'rail',type:'railing'}],
  assets:[{id:'sofa',type:'sofa'}],openings:[{id:'door',wallId:'w1'}],pdf_analysis:{keep:true},scheduled_quantities:{floor_area:80},palette:{floor:'#fff'}});
const floor={kind:'floor',id:'a'},wall={kind:'wall',id:'w1'};

test('seven material groups retain original swatches and add separate paint and wallpaper variants',()=>{
  assert.equal(SURFACE_GROUPS.length,7);assert.equal(SURFACE_MATERIALS.length,36);
  assert.equal(new Set(SURFACE_MATERIALS.map(m=>m.id)).size,36);
  for(const g of SURFACE_GROUPS){const expected=['paint','wallpaper'].includes(g.id)?8:4;
    const entries=SURFACE_MATERIALS.filter(m=>m.kind===g.id);assert.equal(entries.length,expected);assert.equal(new Set(entries.map(m=>m.color)).size,expected);
    for(const m of entries)for(const lang of ['en','fa','ar'])assert.ok(m[lang]);}
});

test('paint and wallpaper apply to walls, reject floor assignments and preserve all old finish IDs',()=>{
  for(const material of SURFACE_MATERIALS.filter(m=>['paint','wallpaper'].includes(m.kind))){
    const before=scene(),next=applySurfaceMaterial(before,wall,material.id);assertSurfaceOnlyEdit(before,next);
    assert.equal(JSON.parse(JSON.stringify(next)).surfaceFinishes.assignments[surfaceKey(wall)],material.id);
    assert.throws(()=>applySurfaceMaterial(before,floor,material.id),/walls only/);
    assert.throws(()=>applySurfaceMaterial(before,{kind:'floor-base',id:'footprint'},material.id),/walls only/);
    assert.throws(()=>assertSurfaceOnlyEdit(before,{...before,surfaceFinishes:{version:1,assignments:{[surfaceKey(floor)]:material.id}}}));
  }
  assert.deepEqual([...new Set(SURFACE_MATERIALS.filter(m=>m.kind==='wallpaper').map(m=>m.pattern))].sort(),['botanical','damask','geometric','stripe']);
  const oldIds=['stone-ivory','stone-beige','stone-slate','stone-charcoal','brick-red','brick-terracotta','brick-white','brick-dark',
    'sand-golden','sand-pale','sand-grey','sand-brown','cement-grey','cement-white','cement-warm','cement-dark','wood-oak','wood-walnut','wood-ash','wood-ebony'];
  for(const id of oldIds)assert.doesNotThrow(()=>applySurfaceMaterial(scene(),floor,id));
});

test('wallpaper coordinates stay aligned across separate wall fragments and headers',()=>{
  class Vector2{constructor(x,y){Object.assign(this,{x,y});}}
  const mesh=(cx,z,vertex)=>({position:{x:cx,y:0,z},rotation:{z:0},geometry:{vertices:[vertex,vertex,vertex],faces:[{a:0,b:1,c:2,normal:{x:0,y:1,z:0}}],faceVertexUvs:[[]]}});
  const left=mesh(1,1.5,{x:1,y:0,z:.5}),right=mesh(3,2.5,{x:-1,y:0,z:-.5});
  applySurfaceUVs({Vector2},left,'wall');applySurfaceUVs({Vector2},right,'wall');
  assert.deepEqual(left.geometry.faceVertexUvs[0][0][0],right.geometry.faceVertexUvs[0][0][0]);
});

test('only the selected room or wall changes, with source geometry and BOQ byte-for-byte preserved',()=>{
  const before=scene(),snapshot=JSON.stringify(before);
  let next=applySurfaceMaterial(before,floor,'wood-walnut');
  next=applySurfaceMaterial(next,wall,'brick-red');
  assertSurfaceOnlyEdit(before,next);assert.equal(JSON.stringify(before),snapshot);
  assert.equal(next.surfaceFinishes.assignments[surfaceKey(floor)],'wood-walnut');
  assert.equal(next.surfaceFinishes.assignments[surfaceKey(wall)],'brick-red');
  assert.equal(Object.keys(next.surfaceFinishes.assignments).length,2);
  for(const key of Object.keys(before))assert.deepEqual(next[key],before[key]);
  const reloaded=JSON.parse(JSON.stringify(next));assertSurfaceOnlyEdit(before,reloaded);
  assert.deepEqual(reloaded.surfaceFinishes,next.surfaceFinishes);
});

test('reset and undo restore assignments alone, preserving later furniture changes',()=>{
  const original=scene(),first=applySurfaceMaterial(original,floor,'stone-ivory'),second=applySurfaceMaterial(first,wall,'cement-grey');
  const changed={...second,assets:[...second.assets,{id:'bed'}]};
  const reset=applySurfaceMaterial(changed,floor,null);assertSurfaceOnlyEdit(changed,reset);
  assert.equal(reset.surfaceFinishes.assignments[surfaceKey(floor)],undefined);
  assert.equal(reset.surfaceFinishes.assignments[surfaceKey(wall)],'cement-grey');
  const undo={...changed,surfaceFinishes:first.surfaceFinishes};assertSurfaceOnlyEdit(changed,undo);
  assert.equal(undo.assets.length,2);
});

test('unknown targets, railing and foreign-scene IDs cannot receive material',()=>{
  for(const target of [{kind:'wall',id:'gone'},{kind:'wall',id:'rail'},{kind:'floor',id:'foreign'}, {kind:'asset',id:'sofa'}, {kind:'floor',id:1}]){
    assert.throws(()=>applySurfaceMaterial(scene(),target,'wood-oak'));
  }
  assert.throws(()=>applySurfaceMaterial(scene(),wall,'not-a-material'));
  assert.doesNotThrow(()=>applySurfaceMaterial(scene(),{kind:'floor-base',id:'footprint'},'sand-pale'));
});

test('commit rejects attempts to modify architecture, quantities or arbitrary scene fields',()=>{
  const before=scene(),next=applySurfaceMaterial(before,floor,'wood-oak');
  for(const key of ['walls','rooms','openings','assets','width','scheduled_quantities','palette','documentId']){
    assert.throws(()=>assertSurfaceOnlyEdit(before,{...next,[key]:'changed'}),/cannot change/);
  }
  assert.throws(()=>assertSurfaceOnlyEdit(before,{...next,surfaceFinishes:{version:1,assignments:{[surfaceKey(wall)]:'invalid'}}}));
});

const mesh=(target,extra={})=>({visible:true,userData:target?{surfaceTarget:target}:{},...extra});
test('nearest surface wins; furniture and glass block painting through them',()=>{
  assert.deepEqual(pickSurfaceHit([{distance:2,object:mesh(wall),face:{normal:{x:0,y:1,z:0}}},{distance:3,object:mesh(floor)}]),{...wall,side:'y+'});
  assert.equal(pickSurfaceHit([{distance:1,object:mesh(null,{userData:{assetId:'sofa'}})},{distance:2,object:mesh(floor)}]),null);
  assert.equal(pickSurfaceHit([{distance:1,object:mesh(null,{userData:{ventraType:'glass'}})},{distance:2,object:mesh(wall)}]),null);
});

test('hidden ancestor and labels are skipped; coplanar room beats plate and transparent walls allow floor painting',()=>{
  assert.deepEqual(pickSurfaceHit([
    {distance:.5,object:mesh(wall,{parent:{visible:false}})},
    {distance:1,object:mesh(null,{userData:{nonSelectable:true}})},
    {distance:2,object:mesh({kind:'floor-base',id:'footprint'})},
    {distance:2,object:mesh(floor)},
  ]),floor);
  assert.deepEqual(pickSurfaceHit([{distance:1,object:mesh(wall,{material:{transparent:true,opacity:.045}})},{distance:2,object:mesh(floor)}]),floor);
});

function inputHarness(){
  const handlers=new Map(),applied=[],hover=[];let state={disabled:false,paintMode:false,materialId:'wood-oak'};
  const host={addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type),contains:()=>false};
  const dispose=bindSurfaceMaterialInputs(host,{getState:()=>state,getRenderer:()=>({pickSurface:()=>floor}),onApply:(target,id)=>applied.push({target,id}),onHover:target=>hover.push(target)});
  const event=(id='wood-oak')=>({button:0,dataTransfer:{types:[SURFACE_MIME],getData:()=>id},preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;}});
  return {handlers,applied,hover,event,dispose,setState:next=>{state={...state,...next};}};
}
test('native drag/drop applies once; external file drops, invalid IDs and disabled state do not write',()=>{
  const h=inputHarness();const drag=h.event();h.handlers.get('dragover')(drag);assert.equal(drag.dataTransfer.dropEffect,'copy');
  h.handlers.get('drop')(h.event());assert.deepEqual(h.applied,[{target:floor,id:'wood-oak'}]);
  const external=h.event();external.dataTransfer.types=['Files'];h.handlers.get('drop')(external);assert.equal(external.prevented,undefined);
  h.handlers.get('drop')(h.event('invalid'));h.setState({disabled:true});h.handlers.get('drop')(h.event());assert.equal(h.applied.length,1);
  h.dispose();assert.equal(h.handlers.size,0);
});
test('click paint captures pointer only in material mode; camera events remain untouched otherwise',()=>{
  const h=inputHarness(),camera=h.event();h.handlers.get('pointerdown')(camera);assert.equal(camera.prevented,undefined);
  h.setState({paintMode:true});const paint=h.event();h.handlers.get('pointerdown')(paint);assert.equal(paint.stopped,true);assert.equal(h.applied.length,1);
  const right=h.event();right.button=2;h.handlers.get('pointerdown')(right);assert.equal(h.applied.length,1);h.dispose();
});

test('Ctrl+Z and Cmd+Z undo material edits in the tool scope, including a Persian keyboard layout',()=>{
  const target={},handlers=new Map();let count=0;
  const document={addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type)};
  const unbind=bindSurfaceMaterialUndo({contains:t=>t===target},{contains:()=>false},()=>({paintMode:true,canUndo:true,disabled:false}),()=>count++,document);
  for(const modifiers of [{ctrlKey:true,key:'z'},{metaKey:true,key:'z'},{ctrlKey:true,code:'KeyZ',key:'ظ'}]){
    const e={target,...modifiers,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};
    handlers.get('keydown')(e);assert.equal(e.prevented,true);
  }
  assert.equal(count,3);unbind();assert.equal(handlers.size,0);
});

test('material shortcut leaves text editing, other tools, redo and held keys untouched',()=>{
  const hostTarget={},outside={},handlers=new Map();let count=0,state={paintMode:true,canUndo:true,disabled:false};
  const document={addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type)};
  const unbind=bindSurfaceMaterialUndo({contains:t=>t===hostTarget},{contains:()=>false},()=>state,()=>count++,document);
  const invoke=extra=>{const e={target:hostTarget,ctrlKey:true,key:'z',preventDefault(){this.prevented=true;},stopImmediatePropagation(){},...extra};handlers.get('keydown')(e);assert.equal(e.prevented,undefined);};
  for(const extra of [{target:outside},{target:{isContentEditable:true}},{target:{closest:()=>true}},{shiftKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true}])invoke(extra);
  state={...state,disabled:true};invoke({});state={...state,disabled:false,canUndo:false};invoke({});state={...state,canUndo:true,paintMode:false};invoke({});
  assert.equal(count,0);unbind();
});

test('undo survives a replaced canvas and Camera mode, but relinquishes ownership to other tools',()=>{
  const canvas={},panelButton={},outside={},body={},handlers=new Map();let count=0;
  const doc={body,documentElement:{},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
  const state={paintMode:false,canUndo:true,disabled:false,undoScope:{owned:true}};
  const host={contains:t=>t===canvas},panel={contains:t=>t===panelButton};
  const bind=()=>bindSurfaceMaterialUndo(host,panel,()=>state,()=>count++,doc);
  const key=target=>{const e={target,ctrlKey:true,code:'KeyZ',key:'ظ',preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};handlers.get('keydown')(e);return e.prevented;};
  let dispose=bind();assert.equal(key(body),true);dispose();
  dispose=bind();assert.equal(key(body),true); // the React effect rebound after save
  handlers.get('pointerdown')({target:panelButton});assert.equal(key(canvas),true);
  handlers.get('pointerdown')({target:outside});assert.equal(key(body),undefined);assert.equal(key(canvas),undefined);
  handlers.get('focusin')({target:panelButton});assert.equal(key(panelButton),true);
  state.disabled=true;assert.equal(key(body),undefined);
  state.disabled=false;handlers.get('focusin')({target:outside});assert.equal(key(body),undefined);
  assert.equal(count,4);dispose();assert.equal(handlers.size,0);
});

test('metric UV projection uses both wall height and length, independently of floor plane',()=>{
  class Vector2{constructor(x,y){Object.assign(this,{x,y});}}
  const g=()=>({vertices:[{x:-2,y:-.1,z:-1.5},{x:2,y:-.1,z:-1.5},{x:2,y:-.1,z:1.5}],faces:[{a:0,b:1,c:2,normal:{x:0,y:1,z:0}}],faceVertexUvs:[[]]});
  const wallMesh={geometry:g(),position:{z:1.5}};applySurfaceUVs({Vector2},wallMesh,'wall');
  assert.deepEqual(wallMesh.geometry.faceVertexUvs[0][0].map(v=>[v.x,v.y]),[[-2,0],[2,0],[2,3]]);
  const floorMesh={geometry:g()};applySurfaceUVs({Vector2},floorMesh,'floor');assert.equal(floorMesh.geometry.faceVertexUvs[0][0][2].y,-.1);
});

test('wall fragments reuse a render-scoped material; floor material remains separate from transparent walls',()=>{
  const wallMaterial={id:'shared-wall'},floorMaterial={id:'separate-floor'},cache=new Map([['wall:wood-oak',wallMaterial],['floor:wood-oak',floorMaterial]]);
  const data=applySurfaceMaterial(applySurfaceMaterial(scene(),wall,'wood-oak'),floor,'wood-oak');
  const meshes=[{material:{},geometry:{}},{material:{},geometry:{}},{material:{dispose(){}},geometry:{}}];
  decorateSurfaceMesh({},meshes[0],wall,data,cache);decorateSurfaceMesh({},meshes[1],wall,data,cache);decorateSurfaceMesh({},meshes[2],floor,data,cache);
  assert.equal(meshes[0].material,wallMaterial);assert.equal(meshes[1].material,wallMaterial);assert.equal(meshes[2].material,floorMaterial);assert.equal(cache.size,2);
});

test('render hooks decorate room, base plate, wall segments, window sills and door/window headers',()=>{
  const viewer=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
  for(const name of ['footprintResult.mesh','result.mesh','mesh','sillWall','headerWall','doorHeaderWall'])assert.ok(viewer.includes(`decorateSurfaceMesh(THREE,${name},`),name);
  assert.match(viewer,/onCommit=\{commitSurfaceScene\}/);assert.match(viewer,/disabled=\{(?:walkActive\|\|)?materialToolActive\|\|designBusy/);
  assert.match(viewer,/pickSurface:e=>rayFor\(e\)\?pickSurfaceHit/);
});

test('existing scene persistence retains material IDs through save/reload without changing architecture',async()=>{
  const values=new Map(),local=new Map();
  const records={putMany:async entries=>{for(const [key,value] of entries)values.set(key,structuredClone(value));},get:async key=>structuredClone(values.get(key)||null)};
  const storage={getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
  const before={...scene(),designDefaults:{version:'room-design-defaults-v64'}};
  const next=applySurfaceMaterial(before,wall,'brick-red');
  await saveSchematic('material-test-project',next,{storage,records,syncCloud:false,preserveBase:true});
  const restored=await readSchematic('material-test-project','schematic3d',{storage,records});
  assert.deepEqual(restored,next);assertSurfaceOnlyEdit(before,restored);
});

test('actual viewer commit keeps the camera and saves before rebuild; stale drawing cannot be modified',async()=>{
  const viewer=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
  const code=viewer.slice(viewer.indexOf('async function commitSurfaceScene('),viewer.indexOf('async function commitOpeningScene('));
  const before=scene(),next=applySurfaceMaterial(before,floor,'wood-oak'),calls=[];
  const context=vm.createContext({currentPromptSceneRef:{current:{scene:before,source:'schematic'}},
    isInteriorSource:s=>['schematic','dwg-interior'].includes(s),currentSceneMatches:s=>s.documentId==='drawing-a',assertSurfaceOnlyEdit,
    furnitureCameraRef:{current:null},schematicRendererRef:{current:{getCameraState:()=>({position:[1,2,3]})}},
    dwgInteriorCameraKey:()=> 'camera-key',projectId:'project',setDesignBusy:value=>calls.push(['busy',value]),
    persistSchematicScene:async value=>calls.push(['persist',value]),rebuildStandaloneScene:value=>calls.push(['rebuild',value])});
  vm.runInContext(code+'\nthis.commit=commitSurfaceScene;',context);
  await context.commit(next,before);
  assert.deepEqual(calls.map(c=>c[0]),['busy','persist','rebuild','busy']);assert.deepEqual(calls[1][1],next);
  assert.equal(context.furnitureCameraRef.current.key,'camera-key');
  const count=calls.length;await assert.rejects(context.commit(next,{...before}),/drawing changed/);assert.equal(calls.length,count);
  await assert.rejects(context.commit({...next,walls:[]},before),/cannot change walls/);assert.equal(calls.length,count);
});
