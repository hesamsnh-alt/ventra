import test from 'node:test';import assert from 'node:assert/strict';
import {schematicGeometryAudit} from '../src/lib/schematicGeometryAudit.mjs';
import {configureSchematicLighting} from '../src/lib/schematicLighting.mjs';
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const THREE=require('three-test');
test('audit reports exact opening spans and room areas without certifying the source',()=>{
 const scene={width:12,depth:8,footprint:[{x:0,y:0},{x:12,y:0},{x:12,y:8},{x:0,y:8}],rooms:[{id:'r',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:3.5},{x:0,y:3.5}]}],walls:[{id:'w',start:{x:12,y:0},end:{x:0,y:0}}],openings:[{id:'d',wallId:'w',type:'door',offset:.1,width:.4}]};const before=JSON.stringify(scene),r=schematicGeometryAudit(scene);
 assert.equal(r.footprintArea,96);assert.equal(r.rooms[0].area,14);assert.equal(r.doorCount,1);assert.equal(r.openings[0].width,.4);assert.ok(Math.abs(r.openings[0].start.x-11)<1e-9);assert.equal(r.sourceVerified,false);assert.equal(JSON.stringify(scene),before);
});
test('audit detects detached, overlapping and wall-end-crossing openings',()=>{
 const r=schematicGeometryAudit({walls:[{id:'w',start:{x:0,y:0},end:{x:2,y:0}}],openings:[{id:'a',type:'door',wallId:'w',width:1,offset:.1},{id:'b',type:'window',wallId:'w',width:1,offset:.2},{id:'c',wallId:'absent'}]});
 for(const code of ['opening_exceeds_wall','overlapping_openings','missing_parent_wall'])assert.ok(r.issues.some(i=>i.code===code));
});
test('legacy renderer avoids double gamma correction and correctly scaled shadow frustum',()=>{
 const scene=new THREE.Scene(),renderer={gammaInput:false,gammaOutput:false};const small=configureSchematicLighting(THREE,renderer,scene,12,8);
 assert.equal(renderer.gammaInput,false);assert.equal(renderer.gammaOutput,false);assert.equal(small.key.shadowMapWidth,2048);assert.ok(small.key.shadowCameraRight>8);assert.equal(scene.children.filter(x=>x instanceof THREE.DirectionalLight).length,2);
 const large=configureSchematicLighting(THREE,renderer,new THREE.Scene(),100,80);assert.ok(large.key.shadowCameraFar>500);assert.ok(large.key.position.z>small.key.position.z*5);
});

test('audit flags invented and discarded source doors and uses the actual orientation schema',()=>{
 const wall={id:'w',start:{x:0,y:0},end:{x:5,y:0}};
 const r=schematicGeometryAudit({walls:[wall],openings:[{id:'synthetic_door_a_b',wallId:'w',type:'door',width:.8,offset:.2,hinge:'start',swing:'clockwise'},{id:'real',wallId:'w',type:'door',width:.8,offset:.7,hinge:'end',swing:'counterclockwise',orientationSource:'source_image_y_down'}],geometryValidation:{openings:{rejectedObservationIds:['dropped']}}});
 assert.ok(r.issues.some(i=>i.code==='unverified_synthetic_opening'));assert.ok(r.issues.some(i=>i.id==='dropped'&&i.code==='source_opening_not_preserved'));
 assert.equal(r.openings[0].orientationConfirmed,false);assert.equal(r.openings[1].orientationConfirmed,true);
});

test('audit compares bound openings to retained source centers and widths',()=>{
 const r=schematicGeometryAudit({walls:[{id:'w',start:{x:0,y:0},end:{x:5,y:0}}],openings:[{id:'d',wallId:'w',type:'door',width:.8,offset:.5}],geometryValidation:{openings:{observations:[{id:'d',center:{x:2,y:0},widthMeters:1}]}}});
 assert.ok(r.issues.some(i=>i.code==='source_opening_position_adjusted'));assert.ok(r.issues.some(i=>i.code==='source_opening_width_adjusted'));
});
