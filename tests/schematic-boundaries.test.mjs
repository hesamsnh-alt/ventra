import test from 'node:test';
import assert from 'node:assert/strict';
import {outdoorBoundaries,observedDoorOrientation} from '../src/lib/schematicBoundaries.mjs';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {compileSourceFurniture,sourcePresentationAssets} from '../src/lib/sourceFurniture.mjs';
const rect=(id,name,x,y,w,h)=>({id,name,polygon:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
test('partial outdoor edges split without changing indoor walls or opening coordinates',()=>{
 const walls=[{id:'top',type:'external',start:{x:12,y:8},end:{x:0,y:8}},{id:'shared',type:'internal',start:{x:8,y:4.5},end:{x:12,y:4.5}}];
 const openings=[{id:'window',wallId:'top',offset:.5,width:1}];
 const result=outdoorBoundaries(walls,[rect('b','بالکن',8,4.5,4,3.5),rect('room','bedroom',0,4.5,8,3.5)],openings);
 assert.equal(result.walls.filter(w=>w.type==='railing').length,1);
 assert.deepEqual(result.walls.find(w=>w.id==='shared'),walls[1]);
 const w=result.walls.find(w=>w.id===result.openings[0].wallId),t=result.openings[0].offset;
 assert.equal(w.start.x+(w.end.x-w.start.x)*t,6);
 assert.equal(w.start.y,8);
 assert.deepEqual(walls[0].end,{x:0,y:8});
});
test('Arabic outdoor label and shared indoor edge are handled independently of room order',()=>{
 const wall={id:'w',type:'external',start:{x:0,y:0},end:{x:0,y:8}};
 assert.equal(outdoorBoundaries([wall],[rect('b','شرفة',0,0,3,8)],[]).walls[0].type,'railing');
 assert.equal(outdoorBoundaries([wall],[rect('b','شرفة',0,0,3,8),rect('r','room',0,0,3,8)],[]).walls[0].type,'external');
});
test('door hinge follows image-side evidence even when wall direction reverses; Y reflection reverses swing',()=>{
 const o={hingeSide:'left',swingDirection:'clockwise'};
 assert.equal(observedDoorOrientation(o,{start:{x:8,y:0},end:{x:0,y:0}}).hinge,'end');
 assert.equal(observedDoorOrientation(o,{start:{x:0,y:0},end:{x:8,y:0}}).hinge,'start');
 assert.equal(observedDoorOrientation(o,{start:{x:0,y:0},end:{x:8,y:0}}).swing,'counterclockwise');
 assert.equal(observedDoorOrientation({}, {start:{x:0,y:0},end:{x:8,y:0}}).openAngleDegrees,0);
});
test('laundry semantics and source washing machine work in all three languages',()=>{
 for(const name of ['Laundry','رخت‌شوی‌خانه','غرفة غسيل'])assert.equal(canonicalRoomType({name}),'laundry');
 const room=rect('a','Laundry',0,0,3,3),o={id:'washer',roomId:'a',type:'washing_machine',backLeft:{x:1,y:1},backRight:{x:1.6,y:1},frontCenter:{x:1.3,y:1.6},confidence:.9};
 const r=compileSourceFurniture([o],room.polygon,[room]);assert.equal(r.assets[0].type,'washing_machine');
 const assets=[...r.assets,{id:'repair',type:'toilet'}];assert.equal(sourcePresentationAssets({assets,furnishingReview:{observations:[]}}),assets);
});
