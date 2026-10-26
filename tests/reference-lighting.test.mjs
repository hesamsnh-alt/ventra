import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {REFERENCE_LIGHTING,referenceRoomFrame,interiorShadowCaster,createReferenceLighting} from '../src/lib/referenceLighting.mjs';
import {textilePhysicalSettings} from '../src/lib/physicalPreview.mjs';
test('lighting anchors use Z-up scene coordinates without modifying the saved scene',()=>{
 const source={width:10,depth:8,wallHeightMeters:3,designDefaults:{viewOriginMeters:{x:2,y:1}}},before=JSON.stringify(source);
 assert.deepEqual(referenceRoomFrame(source),{width:10,depth:8,z:3,x:3,y:3});assert.equal(JSON.stringify(source),before);
 for(const n of Object.values(referenceRoomFrame({width:Infinity,depth:NaN,wallHeightMeters:Infinity,designDefaults:{viewOriginMeters:{}}})))assert.ok(Number.isFinite(n));
});
test('walkthrough walls occlude direct daylight while cutaway overview and transparent editing stay readable',()=>{
 const wall={castShadow:false,material:{opacity:1,transparent:false},userData:{ventraType:'schematic_plan_wall'}},before=JSON.stringify(wall);
 assert.equal(interiorShadowCaster(wall,false),false);assert.equal(interiorShadowCaster(wall,true),true);
 assert.equal(interiorShadowCaster({...wall,material:{transparent:true,opacity:.045}},true),false);
 assert.equal(interiorShadowCaster({...wall,userData:{ventraType:'schematic_floor'}},true),false);
 assert.equal(JSON.stringify(wall),before);
});
test('reference rig switches interior lighting, respects GPU shadow budget and releases its lights',()=>{
 for(const mobile of [false,true]){const scene=new T.Scene(),renderer={toneMappingExposure:1,shadowMap:{}},data={width:9,depth:7},before=JSON.stringify(data),rig=createReferenceLighting(scene,renderer,{span:12,mobile,sceneData:data});
  assert.equal(scene.environmentRotation.x,Math.PI/2);assert.equal(rig.key.shadow.mapSize.width,mobile?1024:2048);assert.equal(renderer.toneMappingExposure,REFERENCE_LIGHTING.overview.exposure);
  rig.setInterior(true);assert.equal(rig.isInterior(),true);assert.equal(renderer.shadowMap.type,mobile?T.PCFSoftShadowMap:T.VSMShadowMap);assert.equal(renderer.toneMappingExposure,REFERENCE_LIGHTING.interior.exposure);assert.ok(rig.panel.intensity>0);assert.equal(rig.panel.isRectAreaLight,true);
  assert.ok(rig.panel.width<=data.width&&rig.panel.height<=data.depth);rig.setInterior(false);assert.equal(rig.isInterior(),false);assert.equal(renderer.shadowMap.type,T.PCFSoftShadowMap);
  rig.dispose();assert.equal(scene.children.length,0);assert.equal(JSON.stringify(data),before);
 }
});
test('subtle fabric sheen does not turn stone, paint or personal photos into cloth',()=>{
 const fabric={bumpMap:{},bumpScale:.0005,shininess:3};assert.equal(textilePhysicalSettings(fabric).metalness,0);assert.ok(textilePhysicalSettings(fabric).sheen<.5);
 assert.equal(textilePhysicalSettings({shininess:110}),null);assert.equal(textilePhysicalSettings({bumpMap:{}}),null);assert.equal(textilePhysicalSettings({bumpMap:{},bumpScale:.0012}),null);
 assert.equal(textilePhysicalSettings({...fabric,userData:{ventraSurfaceMaterial:'paint-white'}}),null);
});
