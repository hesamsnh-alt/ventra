import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {repairObservedDoors} from '../src/lib/repairObservedDoors.mjs';
import {prepareObservedOpeningWalls} from '../src/lib/sourceOpeningWalls.mjs';
import {filterOpenPlanPartitions} from '../src/lib/openPlanPartitions.mjs';
import {schematicGeometryAudit} from '../src/lib/schematicGeometryAudit.mjs';
const fixture=JSON.parse(readFileSync(new URL('fixtures/handdrawn-rejected-door.json',import.meta.url)));
test('actual rejected bedroom door restored from evidence, without resizing any room or inventing the oversized window',()=>{
 const input=structuredClone(fixture),copy=structuredClone(input),result=repairObservedDoors(input);
 assert.deepEqual(result.restored,['door_bedroom_2']);assert.deepEqual(input,copy);
 for(const key of ['rooms','footprint','holes','assets','width','depth','height'])assert.deepEqual(result.scene[key],input[key]);
 const o=result.scene.openings.find(o=>o.id==='door_bedroom_2'),w=result.scene.walls.find(w=>w.id===o.wallId);
 assert.equal(o.width,.9);assert.equal(o.height,2.1);
 assert.ok(Math.abs(w.start.x+(w.end.x-w.start.x)*o.offset-2.2327044025157234)<.001);
 assert.ok(Math.abs(w.start.y+(w.end.y-w.start.y)*o.offset-14.153635116598082)<.001);
 assert.deepEqual(result.scene.geometryValidation.openings.rejectedObservationIds,['window_end']);
 assert.ok(result.removedPartitions.includes('room_edge_room_living_kitchen_1'));
 const trimmed=result.scene.walls.find(w=>w.id.startsWith('room_edge_room_living_kitchen_1__open_trim')&&Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)>.15);
 assert.ok(trimmed.start.x>=2.23);
 assert.deepEqual(result.scene.walls.find(w=>w.id==='partition_wc2_bottom'),input.walls.find(w=>w.id==='partition_wc2_bottom'));
 assert.ok(!schematicGeometryAudit(result.scene).issues.some(i=>i.id===o.id));
 assert.equal(repairObservedDoors(result.scene).restored.length,0);
});
test('no evidence, open connection, or a large room-face gap cannot create a door',()=>{
 const s=structuredClone(fixture);s.geometryValidation.openings.observations=[];assert.equal(repairObservedDoors(s).restored.length,0);
 const rooms=[{id:'a',polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:3},{x:0,y:3}]},{id:'b',polygon:[{x:2.3,y:0},{x:4,y:0},{x:4,y:3},{x:2.3,y:3}]}];
 const observations=[{id:'d',type:'door',center:{x:2,y:1.5},widthMeters:.9,wallAxis:'vertical'}];
 assert.equal(prepareObservedOpeningWalls([],rooms,observations).added.length,0);
 rooms[1].polygon[0].x=2.06;rooms[1].polygon[3].x=2.06;
 assert.equal(prepareObservedOpeningWalls([],rooms,observations).added.length,1);
 assert.equal(prepareObservedOpeningWalls([],rooms,observations,[{roomAId:'a',roomBId:'b',relation:'open',confidence:.99}]).added.length,0);
});

test('partial open connections retain sanitary boundaries under rotation and reversed edge direction',()=>{
 const point=(x,y)=>({x,y}),rect=(x0,y0,x1,y1)=>[point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1)];
 for(const angle of [0,.7,Math.PI/2,Math.PI])for(const reversed of [false,true]){
  const transform=p=>({x:20+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:-10+p.x*Math.sin(angle)+p.y*Math.cos(angle)});
  const rooms=[{id:'living',polygon:rect(0,0,2,4)},{id:'hall',polygon:rect(2,0,4,2)},{id:'wc',polygon:rect(2,2,4,4)}].map(r=>({...r,polygon:r.polygon.map(transform)}));
  const ends=[point(2,0),point(2,4)].map(transform);if(reversed)ends.reverse();
  const wall={id:'room_edge_shared',start:ends[0],end:ends[1],thickness:.15};
  const result=filterOpenPlanPartitions([wall],rooms,[{roomAId:'living',roomBId:'hall',relation:'open',confidence:.99}]);
  assert.equal(result.removed,1);assert.equal(result.partitions.length,1);
  const retained=result.partitions[0];assert.ok(Math.abs(Math.hypot(retained.end.x-retained.start.x,retained.end.y-retained.start.y)-2)<1e-7);
  const wcCenter=transform(point(2,3));assert.ok(Math.hypot((retained.start.x+retained.end.x)/2-wcCenter.x,(retained.start.y+retained.end.y)/2-wcCenter.y)<1e-7);
 }
});
