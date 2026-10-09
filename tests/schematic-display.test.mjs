import {applySceneStyle} from '../src/lib/sceneStyle.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import parser from '@babel/parser';
const require=createRequire(import.meta.url);
const THREE=require(process.env.VENTRA_THREE_TEST_MODULE || 'three-test');
const src=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
const ast=parser.parse(src,{sourceType:'module',plugins:['jsx']});
const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||(n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='VENTRA_SCHEMATIC_ASSET_DEFAULTS')));
const ctx={THREE,console,applySceneStyle};vm.createContext(ctx);vm.runInContext(declarations.map(n=>src.slice(n.start,n.end)).join('\n'),ctx);
test('furniture preserves zero placement and measured small dimensions',()=>{
 const p=ctx.ventraResolveSchematicAssetPlacement({type:'cabinet',x:0,y:0,xMeters:null,yMeters:null,width:.2,depth:.22,height:.3},12,10);
 assert.equal(p.cx,-6);assert.equal(p.cy,-5);assert.equal(p.w,.2);assert.equal(p.d,.22);assert.equal(p.h,.3);
});
test('legacy ambient color attenuation works where intensity argument does not',()=>{
 const a=new THREE.AmbientLight(0xffffff,.38);assert.equal(a.color.r,1);
 a.color.multiplyScalar(.38);assert.equal(a.color.r,.38);
 assert.match(src,/ambient\.color\.multiplyScalar\(0\.52\)/);
});
test('vertical fixture cylinders align with scene Z axis',()=>{
 const meshes=ctx.buildSchematicAssetMeshes({THREE,asset:{type:'shower',width:.8,depth:.8,height:2,xMeters:1,yMeters:1},palette:{},roomWidth:5,roomDepth:5});
 const cylinders=meshes.filter(m=>m.geometry instanceof THREE.CylinderGeometry);
 assert.ok(cylinders.length);assert.ok(cylinders.some(m=>Math.abs(m.rotation.x-Math.PI/2)<1e-8));
});

test('appearance presets preserve metric furniture geometry across all styles',()=>{
 const base={sceneType:'floorplan_interactive_preview', assets:[{type:'wardrobe',xMeters:1,yMeters:3,width:1.3,depth:.46,height:2,rotation:180}]};
 for(const style of ['classic','modern','minimal','luxury','facade']){
  const next=ctx.ventraRestyleSchematicScene(base,style);
  for(const key of ['xMeters','yMeters','width','depth','height','rotation']) assert.equal(next.assets[0][key],base.assets[0][key],style+':'+key);
 }
});
