import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {createWalkthrough} from '../src/lib/walkthroughControls.mjs';
function fixture(mobile=true){
 const win=new EventTarget(),doc=new EventTarget(),canvas=new EventTarget();win.matchMedia=()=>({matches:mobile});doc.defaultView=win;
 const captured=new Set();Object.assign(canvas,{ownerDocument:doc,style:{cursor:'grab',touchAction:'pan-y'},focus(){},setPointerCapture:id=>captured.add(id),releasePointerCapture:id=>captured.delete(id),getBoundingClientRect:()=>({left:0,width:400}),closest:()=>null});
 const camera=new PerspectiveCamera(),target=new Vector3();camera.position.set(12,10,8);let next,id=0,clock=1000;
 const walk=createWalkthrough({canvas,camera,target,scene:{width:20,depth:20,footprint:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],walls:[],rooms:[],assets:[]},render(){},raf:cb=>{next=cb;return ++id},caf:()=>{next=null}});
 const event=(name,pointerId=1,x=80,y=150,type='touch')=>{const e=new Event(name,{cancelable:true});Object.assign(e,{pointerId,clientX:x,clientY:y,pointerType:type,button:0});(name==='pointerup'?win:canvas).dispatchEvent(e);};
 const step=()=>{clock+=50;const cb=next;next=null;cb?.(clock)};walk.start();step();
 return{walk,win,canvas,camera,target,captured,event,step};
}
test('mobile drag maps all four walking directions and release stops motion',()=>{
 for(const [dx,dy,axis,sign]of [[0,-55,'y',1],[0,55,'y',-1],[-55,0,'x',-1],[55,0,'x',1]]){const f=fixture(),before=f.camera.position[axis];f.event('pointerdown');f.event('pointermove',1,80+dx,150+dy);f.step();assert.ok((f.camera.position[axis]-before)*sign>.04);f.event('pointerup');const p=f.camera.position.clone();f.step();assert.ok(p.equals(f.camera.position));f.walk.stop();}
});
test('mobile move and look fingers operate independently; look release keeps movement',()=>{const f=fixture();f.event('pointerdown');f.event('pointermove',1,80,90);f.event('pointerdown',2,300,150);const target=f.target.clone();f.event('pointermove',2,340,130);assert.ok(!target.equals(f.target));const before=f.camera.position.clone();f.event('pointerup',2);f.step();assert.ok(!before.equals(f.camera.position));f.event('pointercancel',1);const stopped=f.camera.position.clone();f.step();assert.ok(stopped.equals(f.camera.position));f.walk.stop();});
test('dead zone, capture loss, blur, resize and stop never leave mobile movement stuck',()=>{const f=fixture();const before=f.camera.position.clone();f.event('pointerdown');f.event('pointermove',1,83,152);f.step();assert.ok(before.equals(f.camera.position));f.event('pointerup');for(const kind of ['lostpointercapture','blur','resize']){f.event('pointerdown');f.event('pointermove',1,80,95);f.step();if(kind==='lostpointercapture')f.event(kind);else f.win.dispatchEvent(new Event(kind));const p=f.camera.position.clone();f.step();assert.ok(p.equals(f.camera.position),kind);assert.equal(f.captured.size,0);}
 f.walk.stop();assert.deepEqual(f.camera.position.toArray(),[12,10,8]);assert.equal(f.canvas.style.touchAction,'pan-y');f.event('pointerdown');assert.equal(f.captured.size,0);
});
test('mouse dragging on mobile and desktop still changes look without walking',()=>{for(const mobile of [true,false]){const f=fixture(mobile),p=f.camera.position.clone(),t=f.target.clone();f.event('pointerdown',1,80,150,'mouse');f.event('pointermove',1,130,175,'mouse');f.step();assert.ok(p.equals(f.camera.position));assert.ok(!t.equals(f.target));f.walk.stop();}});
