import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';import parser from '@babel/parser';
const require=createRequire(import.meta.url),THREE=require('three-test');
const source=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>['VENTRA_SCHEMATIC_ASSET_DEFAULTS','VENTRA_SCHEMATIC_TEXTURE_CACHE'].includes(d.id.name)));
const c=vm.createContext({THREE,console});vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),c);
test('soft furniture edges preserve exact box dimensions and central anchor',()=>{
 for(const size of [[2,1,.8],[.04,.04,.5],[1.2,.7,.04]]){
  const g=c.ventraSoftFurnitureBox(THREE,...size);g.computeBoundingBox();const bounds=g.boundingBox;
  for(const [axis,i] of [['x',0],['y',1],['z',2]]){assert.ok(Math.abs(bounds.max[axis]-size[i]/2)<1e-6);assert.ok(Math.abs(bounds.min[axis]+size[i]/2)<1e-6);}
  assert.ok(g.faces.length>12);
 }
});
test('contact shading is not selectable, stays below furniture and ignores wall-mounted objects',()=>{
 const stops=[];c.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop:(...v)=>stops.push(v)}),fillRect(){}})})};
 const asset={type:'sofa',width:2,depth:1,height:.8,xMeters:3,yMeters:2};const original=JSON.stringify(asset);
 const shade=c.ventraFurnitureContactShade({THREE,asset,roomWidth:8,roomDepth:6});assert.ok(shade);assert.equal(shade.userData.nonSelectable,true);assert.equal(shade.userData.assetId,undefined);assert.equal(shade.position.z,.004);assert.equal(shade.material.depthWrite,false);assert.equal(JSON.stringify(asset),original);assert.equal(stops.length,3);
 assert.equal(c.ventraFurnitureContactShade({THREE,asset:{...asset,zMeters:1},roomWidth:8,roomDepth:6}),null);delete c.document;
});
test('leaf plant rendering preserves source data, stable selection IDs and thin leaf geometry',()=>{
 const asset={id:'plant',type:'plant',width:.6,depth:.6,height:1.4,xMeters:3,yMeters:2},original=JSON.stringify(asset);
 const meshes=c.buildSchematicAssetMeshes({THREE,asset,palette:{},roomWidth:8,roomDepth:6});assert.equal(JSON.stringify(asset),original);assert.ok(meshes.every(m=>m.userData.assetId==='plant'));assert.equal(meshes.length,39);
 const leaf=meshes[3].geometry;leaf.computeBoundingBox();assert.ok(leaf.boundingBox.max.z-leaf.boundingBox.min.z<.025);
});
test('living light-oak default renders wood rather than ceramic without changing the room',()=>{
 const room={type:'living',floorFinish:'light_oak'},original=JSON.stringify(room);
 const m=c.ventraCreateRoomFloorMaterial({THREE,room,palette:{}});
 assert.equal(m.userData.ventraFloorFinish,'warm_oak');assert.equal(JSON.stringify(room),original);
});

test('upholstery has smooth curved corners within its exact dimensions',()=>{
 const g=c.ventraUpholsteryGeometry(THREE,1.2,.6,.2);g.computeBoundingBox();
 assert.ok(g.vertices.some(v=>Math.abs(v.x)>.5&&Math.abs(v.x)<.6&&Math.abs(v.z)>.03&&Math.abs(v.z)<.1));
 assert.ok(g.vertices.every(v=>Math.abs(v.x)<=.600001&&Math.abs(v.y)<=.300001&&Math.abs(v.z)<=.100001));
 assert.ok(g.faces.length>200);assert.equal(g.userData.upholstery,true);
});
test('washing machine has front loading drum ring and controls with stable editor identity',()=>{
 const asset={id:'washer',type:'washing_machine',width:.65,depth:.65,height:.88,xMeters:3,yMeters:2};
 const before=JSON.stringify(asset);const meshes=c.buildSchematicAssetMeshes({THREE,asset,palette:{},roomWidth:8,roomDepth:6});
 assert.ok(meshes.some(m=>m.geometry instanceof THREE.TorusGeometry));assert.ok(meshes.length>=6);assert.ok(meshes.every(m=>m.userData.assetId==='washer'));assert.equal(JSON.stringify(asset),before);
});
