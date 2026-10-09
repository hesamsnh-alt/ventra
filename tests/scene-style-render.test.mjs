import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import parser from '@babel/parser';import {applySceneStyle} from '../src/lib/sceneStyle.mjs';
const src=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8'),ast=parser.parse(src,{sourceType:'module',plugins:['jsx']});
const selected=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='VENTRA_SCHEMATIC_ASSET_DEFAULTS'));
const c=vm.createContext({applySceneStyle});vm.runInContext(selected.map(n=>src.slice(n.start,n.end)).join('\n'),c);
class Vector{set(x,y,z){this.x=x;this.y=y;this.z=z;}}
class Geometry{constructor(...args){this.args=args;this.kind=this.constructor.name;}}
class BoxGeometry extends Geometry{}class CylinderGeometry extends Geometry{}class SphereGeometry extends Geometry{}
class Material{constructor(p){Object.assign(this,p);}}
class Mesh{constructor(g,m){this.geometry=g;this.material=m;this.position=new Vector();this.rotation={};this.userData={};}}
class Shape{moveTo(){}lineTo(){}quadraticCurveTo(){}}class ExtrudeGeometry extends Geometry{}
const THREE={Shape,ExtrudeGeometry,Mesh,BoxGeometry,CylinderGeometry,SphereGeometry,MeshPhongMaterial:Material,DoubleSide:2};
function meshes(type,preset){const scene=applySceneStyle({assets:[{type,xMeters:3,yMeters:2,width:2,depth:1,height:.9}]},preset);return c.buildSchematicAssetMeshes({THREE,asset:scene.assets[0],palette:scene.palette||{},roomWidth:10,roomDepth:8});}
test('preset changes are consumed by mesh construction, not only inspector text',()=>{
 assert.ok(meshes('sofa','minimal').length<meshes('sofa','modern').length);
 assert.ok(meshes('sofa','luxury').length>meshes('sofa','modern').length);
 assert.ok(meshes('coffee_table','luxury').some(m=>m.geometry instanceof CylinderGeometry));
 assert.ok(!meshes('coffee_table','minimal').some(m=>m.geometry instanceof CylinderGeometry));
 assert.ok(meshes('bed','luxury').length>meshes('bed','modern').length);
});
test('visible room floor and exterior palette change with style',()=>{
 const room={type:'living'},out=['modern','minimal','luxury'].map(p=>{const s=applySceneStyle({},p);return c.ventraCreateRoomFloorMaterial({THREE,room,palette:s.palette});});
 assert.equal(new Set(out.map(m=>m.color)).size,3);assert.equal(out[2].shininess,65);assert.equal(out[2].userData.ventraFloorFinish,'marble');
});
