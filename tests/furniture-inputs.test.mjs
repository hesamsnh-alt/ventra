import test from 'node:test';import assert from 'node:assert/strict';import {bindFurnitureInputs} from '../src/lib/furnitureInputs.mjs';
class Canvas extends EventTarget{setPointerCapture(){}releasePointerCapture(){}}
const send=(c,type,p={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,clientX:2,clientY:3,button:0,...p});c.dispatchEvent(e);return e;};
function setup(c=new Canvas()){const commits=[],previews=[];let active=true;const tool={start:id=>({id}),preview:p=>({candidate:p,valid:true}),commit:(...args)=>commits.push(args)};const dispose=bindFurnitureInputs(c,{getTool:()=>active?tool:null,pickPoint:e=>({x:e.clientX,y:e.clientY}),pickAsset:()=> 'asset',preview:(...args)=>previews.push(args),clearPreview(){}});return {c,commits,previews,dispose,camera:()=>{active=false;}};}
test('tap and drag commit once; cancelled gesture never saves',()=>{
 const s=setup();send(s.c,'pointerdown');send(s.c,'pointerup');assert.equal(s.commits.length,1);assert.equal(s.commits[0][2],false);
 send(s.c,'pointerdown');send(s.c,'pointermove',{clientX:20});send(s.c,'pointerup',{clientX:20});assert.equal(s.commits.length,2);assert.equal(s.commits[1][2],true);
 send(s.c,'pointerdown');send(s.c,'pointercancel');send(s.c,'pointerup');assert.equal(s.commits.length,2);
});
test('HTML drop places furniture and camera mode does not consume pointer events',()=>{
 const s=setup();assert.equal(send(s.c,'dragover').defaultPrevented,true);send(s.c,'drop');assert.equal(s.commits.length,1);s.camera();assert.equal(send(s.c,'pointerdown').defaultPrevented,false);
});
test('replacement binding and disposal do not duplicate callbacks',()=>{
 const c=new Canvas(),old=setup(c),s=setup(c);old.dispose();send(c,'pointerdown');send(c,'pointerup');assert.equal(old.commits.length,0);assert.equal(s.commits.length,1);s.dispose();send(c,'drop');assert.equal(s.commits.length,1);
});
test('switching away from an editing tool cancels a pending gesture',()=>{
 const s=setup();send(s.c,'pointerdown');s.dispose.cancel();send(s.c,'pointerup');assert.equal(s.commits.length,0);
});
test('mouse coordinates and Shift reach rotation tools; cancel never commits the preview',()=>{
 const canvas=new Canvas(),calls=[];
 const tool={start:(id,p,e)=>({startX:e.clientX}),preview:(p,data,e)=>{calls.push(['preview',data.startX,e.clientX,e.shiftKey]);return {};},commit:(p,data,moved,e)=>calls.push(['commit',data.startX,e.clientX,moved])};
 bindFurnitureInputs(canvas,{getTool:()=>tool,pickPoint:e=>({x:e.clientX,y:e.clientY}),pickAsset:()=> 'asset',preview(){},clearPreview(){}});
 send(canvas,'pointerdown',{clientX:100});send(canvas,'pointermove',{clientX:200,shiftKey:true});send(canvas,'pointerup',{clientX:200});
 assert.deepEqual(calls,[['preview',100,200,true],['commit',100,200,true]]);
 send(canvas,'pointerdown',{clientX:100});send(canvas,'pointercancel');assert.equal(calls.length,2);
});
