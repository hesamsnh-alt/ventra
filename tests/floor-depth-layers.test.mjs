import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configureFloorDepth} from '../src/lib/floorDepthLayers.mjs';
import {pickSurfaceHit} from '../src/lib/surfaceMaterials.mjs';

const floor=(material={})=>({position:{x:1,y:2,z:0},geometry:{vertices:[{x:0,y:0,z:0},{x:5,y:0,z:0},{x:0,y:4,z:0}]},material,userData:{surfaceTarget:{kind:'floor',id:'a'}}});
test('previously coincident base and finish cannot remain at the same render height',()=>{
  const base=floor(),finish=floor(),vertices=JSON.stringify(base.geometry);
  configureFloorDepth(base,'base');configureFloorDepth(finish,'finish');
  assert.ok(finish.position.z-base.position.z>=.025);
  assert.equal(base.material.polygonOffset,true);assert.ok(base.material.polygonOffsetFactor>finish.material.polygonOffsetFactor);
  assert.equal(JSON.stringify(base.geometry),vertices);assert.equal(finish.position.z,0);
});
test('changing a floor material does not lose depth separation; applying the policy twice does not sink the floor',()=>{
  const base=floor({map:{id:'old'}});configureFloorDepth(base,'base');
  const position=base.position.z;base.material={map:{id:'custom-wood'}};configureFloorDepth(base,'base');
  assert.equal(base.position.z,position);assert.equal(base.material.polygonOffset,true);assert.equal(base.material.polygonOffsetFactor,4);
  assert.equal(base.material.map.id,'custom-wood');assert.equal(base.position.x,1);assert.equal(base.position.y,2);
});
test('room layer retains selected color, opacity, texture and depth occlusion',()=>{
  const material={map:{id:'stone'},color:'#eee',opacity:1,depthTest:true,depthWrite:true},mesh=floor(material);
  const original=structuredClone(material);configureFloorDepth(mesh,'finish');
  for(const key of Object.keys(original))assert.deepEqual(material[key],original[key]);
  assert.equal(mesh.position.z,0);assert.equal(material.polygonOffsetFactor,-1);
});
test('surface picking still selects the nearest room finish rather than underlying plate',()=>{
  const finish=floor(),base=floor();base.userData.surfaceTarget={kind:'floor-base',id:'footprint'};
  configureFloorDepth(base,'base');configureFloorDepth(finish,'finish');
  assert.deepEqual(pickSurfaceHit([{distance:5,object:finish},{distance:5.025,object:base}]),{kind:'floor',id:'a'});
});
test('actual renderer configures depth after user materials, and PBR bridge copies the same bias',()=>{
  const viewer=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
  assert.match(viewer,/decorateSurfaceMesh\(THREE,footprintResult.mesh[^\n]+\n\s*configureFloorDepth\(footprintResult.mesh,'base'\)/);
  assert.match(viewer,/decorateSurfaceMesh\(THREE,result.mesh[^\n]+\n\s*configureFloorDepth\(result.mesh,'finish'\)/);
  const bridge=fs.readFileSync(new URL('../src/lib/physicalPreview.mjs',import.meta.url),'utf8');
  for(const property of ['polygonOffset','polygonOffsetFactor','polygonOffsetUnits'])assert.ok(bridge.includes(`${property}:old.${property}`));
});
