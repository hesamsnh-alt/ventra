import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanTouchInput} from '../src/lib/planStudio/touch.mjs';
import {editorState,startCommand,clickPoint,submit} from '../src/lib/planStudio/controller.mjs';
function setup(command='L',pan=false){
 let s=startCommand(editorState(),command),view={x:0,y:0,width:10},calls=0;
 s.snap=false;
 const input=createPlanTouchInput({getState:()=>s,getView:()=>view,getRect:()=>({left:0,top:0,width:400,height:400}),isPan:()=>pan,onView:v=>view=v,onPoint:p=>{calls++;s=clickPoint(s,p,{raw:!s.ortho});},onPreview:()=>{}});
 const e=(x,y,id=1)=>({pointerId:id,clientX:x,clientY:y});
 const tap=(x,y)=>{input.down(e(x,y));input.up(e(x,y));};
 return {input,e,tap,get s(){return s},get view(){return view},get calls(){return calls},setState:v=>s=v};
}
test('phone line button flow draws by two taps without keyboard, deferring each point until release',()=>{const h=setup();h.input.down(h.e(40,360));assert.equal(h.calls,0);h.input.up(h.e(40,360));h.tap(200,360);assert.equal(h.s.doc.entities.length,1);assert.equal(h.s.doc.entities[0].a.x,1);assert.equal(h.s.doc.entities[0].b.x,5);assert.ok(Math.abs(h.s.doc.entities[0].a.y-1)<1e-10);assert.ok(Math.abs(h.s.doc.entities[0].b.y-1)<1e-10);});
test('single finger drag creates first line or wall only after release',()=>{for(const command of ['L','W']){const h=setup(command);h.input.down(h.e(40,360));h.input.move(h.e(200,360));assert.equal(h.calls,0);h.input.up(h.e(200,360));assert.equal(h.s.doc.entities.length,1);}});
test('small finger jitter remains one point, and pointer cancellation makes no geometry',()=>{const h=setup();h.input.down(h.e(40,360));h.input.move(h.e(43,360));h.input.up(h.e(43,360));assert.equal(h.calls,1);assert.equal(h.s.doc.entities.length,0);h.input.down(h.e(200,360));h.input.cancel();h.input.up(h.e(200,360));assert.equal(h.calls,1);assert.equal(h.input.active(),false);});
test('pinch zoom and staggered finger release never add stray drawing points',()=>{const h=setup();h.input.down(h.e(100,200));h.input.down(h.e(300,200,2));h.input.move(h.e(0,200));assert.ok(h.view.width<10);h.input.up(h.e(0,200));h.input.move(h.e(320,200,2));h.input.up(h.e(320,200,2));assert.equal(h.calls,0);assert.equal(h.input.active(),false);h.tap(40,360);assert.equal(h.calls,1);});
test('pinch keeps midpoint world anchor and clamps huge zoom to finite values',()=>{const h=setup();h.input.down(h.e(100,200));h.input.down(h.e(300,200,2));h.input.move(h.e(-100,200));assert.equal(h.view.width,5);assert.equal(h.view.x,3.75);assert.equal(h.view.y,2.5);h.input.move(h.e(300,200));assert.equal(h.view.width,2000);assert.ok(Object.values(h.view).every(Number.isFinite));});
test('hand mode and selection drag pan without edits; selection tap still reaches controller',()=>{for(const [command,pan] of [['L',true],['SELECT',false]]){const h=setup(command,pan);h.input.down(h.e(100,200));h.input.move(h.e(180,240));h.input.up(h.e(180,240));assert.equal(h.view.x,-2);assert.equal(h.view.y,1);assert.equal(h.calls,0);}const h=setup('SELECT');h.tap(100,200);assert.equal(h.calls,1);});
test('touch polyline close, finish and step undo use the existing CAD controller',()=>{const h=setup('PL');h.tap(40,360);h.tap(200,360);h.tap(200,200);let s=submit(h.s,'C');assert.equal(s.doc.entities[0].closed,true);assert.equal(s.command,'SELECT');const l=setup();l.tap(40,360);l.tap(200,360);s=submit(l.s,'U');assert.equal(s.doc.entities.length,0);s=submit(s,'');assert.equal(s.command,'SELECT');});
test('touch straight-line toggle constrains points without a Shift keyboard',()=>{const h=setup();h.setState({...h.s,ortho:true});h.tap(40,360);h.tap(200,320);assert.equal(h.s.doc.entities.length,1);assert.equal(h.s.doc.entities[0].b.y,h.s.doc.entities[0].a.y);});
