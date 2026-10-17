import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {WALL_SURFACE_SIDES,surfaceKey,applySurfaceMaterial,assertSurfaceOnlyEdit,pickSurfaceHit,
  decorateSurfaceMesh,surfaceMaterialList} from '../src/lib/surfaceMaterials.mjs';
import {saveSchematic,readSchematic} from '../src/lib/schematicStorage.mjs';
const wall={kind:'wall',id:'w'},front={...wall,side:'y+'},back={...wall,side:'y-'};
const scene=()=>({documentId:'face-drawing',width:8,depth:6,height:3,source:'image-interactive-preview-v3',
  walls:[{id:'w',type:'internal',start:{x:0,y:0},end:{x:4,y:2}}],rooms:[],assets:[],openings:[],scheduled_quantities:{wall_area:24},designDefaults:{version:'room-design-defaults-v64'}});
const normals=WALL_SURFACE_SIDES.map(side=>({x:0,y:0,z:0,[side[0]]:side[1]==='+'?1:-1}));
class Vector2{constructor(x,y){Object.assign(this,{x,y});}}
class MeshFaceMaterial{constructor(materials){this.materials=materials;}}
const THREE={Vector2,MeshFaceMaterial};
function mesh(angle=0){return {userData:{surfaceTarget:wall,ventraType:'schematic_plan_wall'},position:{x:2,y:1,z:1.5},rotation:{z:angle},castShadow:true,
  material:{name:'original',opacity:1,transparent:false,depthWrite:true},
  geometry:{vertices:[{x:-2,y:-.1,z:-1.5},{x:2,y:-.1,z:-1.5},{x:2,y:-.1,z:1.5}],
    faces:normals.flatMap(normal=>Array.from({length:2},()=>({a:0,b:1,c:2,normal,materialIndex:9}))),faceVertexUvs:[[]]}};}
const cache=()=>new Map(['paint-white','brick-red','wood-oak'].map(id=>['wall:'+id,{name:id,opacity:1,transparent:false,depthWrite:true}]));

test('click resolves the local face of rotated walls; missing normal never paints an entire wall',()=>{
  for(const angle of [0,Math.PI/2,-1.2])for(const [index,side] of WALL_SURFACE_SIDES.entries()){
    assert.deepEqual(pickSurfaceHit([{distance:1,object:mesh(angle),face:{normal:normals[index]}}]),{...wall,side});
  }
  assert.equal(pickSurfaceHit([{distance:1,object:mesh()}]),null);
  assert.equal(pickSurfaceHit([{distance:1,object:mesh(),face:{normal:{x:0,y:0,z:0}}}]),null);
});

test('front, back, and top retain independent finishes; geometry and BOQ are unchanged',()=>{
  const original=scene();let next=applySurfaceMaterial(original,front,'paint-white');
  next=applySurfaceMaterial(next,back,'brick-red');
  assertSurfaceOnlyEdit(original,next);
  const m=mesh(),base=m.material,vertices=JSON.stringify(m.geometry.vertices);
  decorateSurfaceMesh(THREE,m,wall,next,cache());
  const materials=surfaceMaterialList(m.material);
  for(const face of m.geometry.faces){
    const index=normals.indexOf(face.normal),side=WALL_SURFACE_SIDES[index];
    assert.equal(materials[face.materialIndex].name,side==='y+'?'paint-white':side==='y-'?'brick-red':'original');
  }
  assert.equal(materials[4],base);assert.equal(JSON.stringify(m.geometry.vertices),vertices);
  for(const key of Object.keys(original))assert.deepEqual(next[key],original[key]);
});

test('same wall face continues across window sills and headers; opposite faces stay original',()=>{
  const data=applySurfaceMaterial(scene(),front,'wood-oak'),shared=cache();
  const pieces=[mesh(),mesh(),mesh()];pieces[1].position.z=.5;pieces[2].position.z=2.7;
  for(const m of pieces){const original=m.material;decorateSurfaceMesh(THREE,m,wall,data,shared);
    assert.equal(surfaceMaterialList(m.material)[2],shared.get('wall:wood-oak'));
    assert.equal(surfaceMaterialList(m.material)[3],original);}
});

test('editing an older whole-wall assignment preserves other sides; reset affects clicked side only',()=>{
  const old=applySurfaceMaterial(scene(),wall,'brick-red'),snapshot=JSON.stringify(old);
  const next=applySurfaceMaterial(old,front,'paint-white');assertSurfaceOnlyEdit(old,next);
  assert.equal(next.surfaceFinishes.assignments[surfaceKey(wall)],undefined);
  for(const side of WALL_SURFACE_SIDES)assert.equal(next.surfaceFinishes.assignments[surfaceKey({...wall,side})],side==='y+'?'paint-white':'brick-red');
  const reset=applySurfaceMaterial(next,front,null),m=mesh(),base=m.material;
  decorateSurfaceMesh(THREE,m,wall,reset,cache());
  assert.equal(surfaceMaterialList(m.material)[2],base);
  assert.equal(surfaceMaterialList(m.material)[3].name,'brick-red');
  assert.equal(JSON.stringify(old),snapshot);
  const undo={...next,surfaceFinishes:old.surfaceFinishes};assertSurfaceOnlyEdit(next,undo);
  const restored=mesh();decorateSurfaceMesh(THREE,restored,wall,undo,cache());assert.equal(restored.material.name,'brick-red');
});

test('invalid side keys and floor face targets cannot be persisted',()=>{
  for(const target of [{...wall,side:'bad'},{...wall,side:null},{kind:'floor',id:'r',side:'y+'}]){
    assert.throws(()=>applySurfaceMaterial(scene(),target,'wood-oak'));
    assert.throws(()=>assertSurfaceOnlyEdit(scene(),{...scene(),surfaceFinishes:{version:1,assignments:{[surfaceKey(target)]:'wood-oak'}}}));
  }
});

test('modern indexed and non-indexed geometry get distinct face groups without moving vertices',()=>{
  for(const indexed of [false,true]){
    const m=mesh();const original=m.material;
    const normalValues=normals.flatMap(n=>Array.from({length:3},()=>[n.x,n.y,n.z]).flat());
    m.geometry={attributes:{position:{count:18},normal:{getX:i=>normalValues[i*3],getY:i=>normalValues[i*3+1],getZ:i=>normalValues[i*3+2]}},
      ...(indexed?{index:{count:18,getX:i=>i}}:{}),groups:[],clearGroups(){this.groups=[];},addGroup(start,count,materialIndex){this.groups.push({start,count,materialIndex});}};
    decorateSurfaceMesh({},m,wall,applySurfaceMaterial(scene(),front,'paint-white'),cache());
    assert.ok(Array.isArray(m.material));assert.equal(m.material[2].name,'paint-white');assert.equal(m.material[3],original);
    assert.deepEqual(m.geometry.groups,WALL_SURFACE_SIDES.map((_,i)=>({start:i*3,count:3,materialIndex:i})));
  }
});

test('physical renderer bridge keeps legacy per-face material groups',()=>{
  const source=fs.readFileSync(new URL('../src/lib/physicalPreview.mjs',import.meta.url),'utf8');
  class BufferGeometry{constructor(){this.attributes={};this.groups=[];}setAttribute(k,v){this.attributes[k]=v;}addGroup(start,count,materialIndex){this.groups.push({start,count,materialIndex});}computeBoundingBox(){}computeBoundingSphere(){}}
  class Float32BufferAttribute{constructor(array,itemSize){Object.assign(this,{array,itemSize});}}
  const context=vm.createContext({T:{BufferGeometry,Float32BufferAttribute}});
  vm.runInContext(source.slice(source.indexOf('export function physicalGeometry'),source.indexOf('export function physicalMaterialSettings')).replace('export ',''),context);
  const m=mesh();decorateSurfaceMesh(THREE,m,wall,applySurfaceMaterial(scene(),front,'paint-white'),cache());
  const converted=context.physicalGeometry(m.geometry);
  assert.deepEqual(Array.from(converted.groups,g=>({...g})),WALL_SURFACE_SIDES.map((_,i)=>({start:i*6,count:6,materialIndex:i})));
});

test('cutaway toggles every face and restores original opacity; hit tests use face material',()=>{
  const viewer=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
  const code=viewer.slice(viewer.indexOf('function ventraCreateInteriorView('),viewer.indexOf('function mountStandaloneSchematicRenderer('));
  const context=vm.createContext({surfaceMaterialList});vm.runInContext(code,context);
  const m=mesh();decorateSurfaceMesh(THREE,m,wall,applySurfaceMaterial(scene(),front,'paint-white'),cache());
  const toggle=context.ventraCreateInteriorView({traverse:fn=>fn(m)});
  toggle(true);for(const mat of surfaceMaterialList(m.material)){assert.equal(mat.opacity,.045);assert.equal(mat.depthWrite,false);}
  assert.equal(pickSurfaceHit([{distance:1,object:m,face:{normal:normals[2],materialIndex:2}}]),null);
  toggle(false);assert.equal(m.castShadow,true);
  for(const mat of surfaceMaterialList(m.material)){assert.equal(mat.opacity,1);assert.equal(mat.transparent,false);assert.equal(mat.depthWrite,true);}
  assert.deepEqual(pickSurfaceHit([{distance:1,object:m,face:{normal:normals[2],materialIndex:2}}]),front);
});

test('front/back finishes survive existing save/reload and undo without disturbing subsequent furniture edits',async()=>{
  let data=applySurfaceMaterial(scene(),front,'paint-white');const previous=data.surfaceFinishes;
  data=applySurfaceMaterial(data,back,'brick-red');const values=new Map(),local=new Map();
  const records={putMany:async entries=>{for(const [k,v]of entries)values.set(k,structuredClone(v));},get:async k=>structuredClone(values.get(k)||null)};
  const storage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
  await saveSchematic('face-test-project',data,{records,storage,syncCloud:false,preserveBase:true});
  const loaded=await readSchematic('face-test-project','schematic3d',{records,storage});assert.deepEqual(loaded,data);
  const furniture={...loaded,assets:[{id:'new-chair'}]},undo={...furniture,surfaceFinishes:previous};
  assertSurfaceOnlyEdit(furniture,undo);assert.equal(undo.assets[0].id,'new-chair');
  assert.equal(undo.surfaceFinishes.assignments[surfaceKey(back)],undefined);assert.equal(undo.surfaceFinishes.assignments[surfaceKey(front)],'paint-white');
});
