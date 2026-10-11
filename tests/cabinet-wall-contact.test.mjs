import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileSourceFurniture,restoreWallContactFurniture} from '../src/lib/sourceFurniture.mjs';
const fixture=()=>JSON.parse(fs.readFileSync(new URL('fixtures/cabinet-wall-contact.json',import.meta.url)));
test('reported missing L counter is restored without changing other furniture or architecture',()=>{
 const s=fixture(),before=structuredClone(s),r=restoreWallContactFurniture(s);
 assert.deepEqual(r.restored,['kitchen_counter_1']);
 assert.deepEqual(s,before);
 assert.deepEqual(r.scene.assets.slice(0,-1),s.assets);
 for(const k of ['rooms','walls','footprint'])assert.deepEqual(r.scene[k],s[k]);
 const a=r.scene.assets.at(-1);
 assert.equal(a.groupId,'kitchen_1');assert.equal(a.rotation,270);
 assert.ok(Math.abs(a.xMeters-a.depth/2-3.908227848101266)<1e-9);
 assert.ok(Math.abs(a.xMeters+a.depth/2-(4.6202531645569636-.065))<1e-9);
 assert.equal(r.scene.assets.filter(a=>a.type==='kitchen_counter').length,2);
 assert.deepEqual(restoreWallContactFurniture(r.scene).restored,[]);
});
test('parallel rear contact is fitted, but crossing and side collisions remain rejected',()=>{
 const s=fixture(),o=s.furnishingReview.observations.find(o=>o.id==='kitchen_counter_1');
 assert.equal(compileSourceFurniture([o],s.footprint,s.rooms,s.walls).assets.length,1);
 const crossing={id:'crossing',start:{x:3.7,y:6},end:{x:4.7,y:6},thickness:.12};
 assert.equal(compileSourceFurniture([o],s.footprint,s.rooms,[...s.walls,crossing]).rejected[0].reason,'intersects_wall');
 const shifted={...o,backLeft:{...o.backLeft,x:o.backLeft.x-.2},backRight:{...o.backRight,x:o.backRight.x-.2}};
 const wall={start:{x:4.4202531645569636,y:4},end:{x:4.4202531645569636,y:9},thickness:.8};
 assert.equal(compileSourceFurniture([shifted],s.footprint,s.rooms,[wall]).assets.length,0);
});
test('recovery never overwrites edits or accepts occupied cabinet space',()=>{
 const s=fixture();s.assets.push({id:'user-object',type:'refrigerator',xMeters:4.2,yMeters:6.4,width:.6,depth:.6,rotation:0});
 assert.deepEqual(restoreWallContactFurniture(s).restored,[]);
 const unknown=fixture();unknown.furnishingReview.observationCoordinateMode='unknown';
 assert.deepEqual(restoreWallContactFurniture(unknown).restored,[]);
});
