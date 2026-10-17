import test from 'node:test';import assert from 'node:assert/strict';
import {applyWallEdit,previewWallEdit,nearestEditableWall,assertWallOnlyEdit,snapWallPoint} from '../src/lib/manualWalls.mjs';
const scene=()=>({width:8,depth:6,height:3.2,footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],walls:[{id:'w',start:{x:4,y:0},end:{x:4,y:6},thickness:.12}],openings:[{id:'door',wallId:'w',type:'door',offset:.5,width:.9}],assets:[{id:'a',type:'plant'}],rooms:[{id:'r',type:'living'}],holes:[]});
test('wall addition keeps source data immutable, uses 3.2 m and excludes design proposal from takeoff',()=>{
 const s=scene(),before=structuredClone(s),next=applyWallEdit(s,{kind:'add',start:{x:2,y:1},end:{x:2,y:5}});
 assert.deepEqual(s,before);assert.equal(next.walls.length,2);assert.equal(next.walls[1].height,3.2);assert.equal(next.walls[1].excludeFromTakeoff,true);assertWallOnlyEdit(s,next);assert.deepEqual(next.rooms,s.rooms);
 assert.equal(previewWallEdit(s,{kind:'add',start:{x:2,y:1},end:{x:2,y:5}}).valid,true);
});
test('wall removal deletes only hosted openings; undo restores exact wall and opening data',()=>{
 const s=scene();s.walls.push({id:'other',start:{x:6,y:0},end:{x:6,y:6}});s.openings.push({id:'otherDoor',wallId:'other'});
 const next=applyWallEdit(s,{kind:'remove',wallId:'w'});assert.equal(next.walls.length,1);assert.equal(next.openings.length,1);assert.equal(next.openings[0].id,'otherDoor');
 const restored=applyWallEdit(next,{kind:'restore',walls:s.walls,openings:s.openings});assert.deepEqual(restored.walls,s.walls);assert.deepEqual(restored.openings,s.openings);
 assert.equal(nearestEditableWall(s,{x:4.04,y:3}),'w');assert.equal(nearestEditableWall(s,{x:1,y:3}),null);
});
test('invalid walls across floor edges, shafts or duplicate segments reject atomically',()=>{
 const s=scene(),before=structuredClone(s);
 for(const edit of [{start:{x:-1,y:1},end:{x:2,y:1}},{start:{x:2,y:2},end:{x:2,y:2}},{start:{x:4,y:1},end:{x:4,y:5}}])assert.throws(()=>applyWallEdit(s,{kind:'add',...edit}));
 assert.deepEqual(s,before);s.holes=[{polygon:[{x:1,y:2},{x:3,y:2},{x:3,y:4},{x:1,y:4}]}];assert.throws(()=>applyWallEdit(s,{kind:'add',start:{x:2,y:1},end:{x:2,y:5}}),/voids/);
 assert.throws(()=>assertWallOnlyEdit(s,{...s,assets:[]}),/assets/);
});

test('deleting the last wall stays on the structured renderer instead of regenerating generic walls',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');const source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
 const declaration=source.slice(source.indexOf('function ventraStructuredSceneIsValid'),source.indexOf('function ventraScenePointToLocal'));
 const valid=vm.runInNewContext('('+declaration.trim()+')');const empty=applyWallEdit(scene(),{kind:'remove',wallId:'w'});
 assert.equal(empty.walls.length,0);assert.equal(valid(empty),true);
});

test('drawing snaps imprecise clicks to wall ends, wall spans and horizontal/vertical alignment',()=>{
 const s=scene();assert.deepEqual(snapWallPoint(s,{x:4.14,y:.16}),{x:4,y:0});
 assert.deepEqual(snapWallPoint(s,{x:4.12,y:3}),{x:4,y:3});
 assert.deepEqual(snapWallPoint(s,{x:2.08,y:5},{x:2,y:1}),{x:2,y:5});
 assert.deepEqual(snapWallPoint(s,{x:2.5,y:5.5}),{x:2.5,y:5.5});
});
test('a partition from one boundary wall endpoint to another is allowed without allowing outside lines',()=>{
 const s=scene();s.walls=[{id:'bottom',start:{x:0,y:0},end:{x:8,y:0}},{id:'top',start:{x:0,y:6},end:{x:8,y:6}}];s.openings=[];
 const next=applyWallEdit(s,{kind:'add',start:{x:.08,y:.12},end:{x:.1,y:5.86}});
 assert.deepEqual(next.walls.at(-1).start,{x:0,y:0});assert.deepEqual(next.walls.at(-1).end,{x:0,y:6});
 assert.equal(previewWallEdit(s,{kind:'add',start:{x:.08,y:.12},end:{x:.1,y:5.86}}).valid,true);
 assert.throws(()=>applyWallEdit(s,{kind:'add',start:{x:-1,y:1},end:{x:-1,y:5}}),/inside this floor/);
});
