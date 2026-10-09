import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitOffset,cameraFitDistance,namedCameraOffset} from '../src/lib/orbitCamera.mjs';
const length=v=>Math.hypot(v.x,v.y,v.z);
test('full orbit returns camera to position while preserving radius',()=>{
 const initial={x:20,y:-30,z:12};let position=initial;
 for(let i=0;i<360;i++)position=orbitOffset(position,Math.PI/180);
 assert.ok(Math.hypot(position.x-initial.x,position.y-initial.y,position.z-initial.z)<1e-9);
 assert.ok(Math.abs(length(position)-length(initial))<1e-9);
});
test('pitch stops short of singular poles and fit adapts to portrait and model scale',()=>{
 const p=orbitOffset({x:10,y:20,z:5},0,-999);
 assert.ok(Math.hypot(p.x,p.y)>0);assert.ok(Number.isFinite(p.z));
 const size={x:20,y:30,z:10};const wide=cameraFitDistance(size,45,2),portrait=cameraFitDistance(size,45,.5);
 assert.ok(portrait>wide);
 assert.ok(Math.abs(cameraFitDistance({x:200,y:300,z:100},45,2)-10*wide)<1e-9);
});
test('named views expose every side with equal camera distance',()=>{
 for(const name of ['front','back','left','right','top','bottom','iso'])assert.ok(Math.abs(length(namedCameraOffset(name,50))-50)<1e-10);
 assert.equal(namedCameraOffset('front',50).y,-50);assert.equal(namedCameraOffset('back',50).y,50);
});
