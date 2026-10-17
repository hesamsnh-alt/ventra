import {createWalkWorld,walkSpawn,moveWalk,WALK_EYE_HEIGHT} from './walkthrough.mjs';
// Explicit session lifecycle; keyboard ownership stays on the canvas/controls.
export function createWalkthrough({canvas,scene,camera,target,render,onExit=()=>{},raf=cb=>requestAnimationFrame(cb),caf=id=>cancelAnimationFrame(id)}){
 let active=false,world,point,yaw=0,pitch=0,saved,frame=0,last=0,pointer=null,axis={forward:0,right:0},keys=new Set();const listeners=[];
 const doc=canvas.ownerDocument,win=doc.defaultView;
 const listen=(t,n,f,o)=>{t.addEventListener(n,f,o);listeners.push(()=>t.removeEventListener(n,f,o));};
 const pose=()=>{camera.position.set(point.x-world.origin.x,point.y-world.origin.y,WALK_EYE_HEIGHT);camera.up.set(0,0,1);target.set(camera.position.x+Math.sin(yaw)*Math.cos(pitch),camera.position.y+Math.cos(yaw)*Math.cos(pitch),camera.position.z+Math.sin(pitch));camera.lookAt(target);render();};
 const clear=()=>{keys.clear();axis={forward:0,right:0};if(pointer!==null){try{canvas.releasePointerCapture(pointer);}catch{}pointer=null;}};
 function stop(){if(!active)return;active=false;caf(frame);clear();listeners.splice(0).forEach(fn=>fn());camera.position.fromArray(saved.position);camera.up.fromArray(saved.up);target.fromArray(saved.target);camera.fov=saved.fov;camera.near=saved.near;camera.updateProjectionMatrix();canvas.style.cursor=saved.cursor;render();onExit();}
 function tick(now){if(!active)return;const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
  let forward=axis.forward+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),right=axis.right+(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);const length=Math.max(1,Math.hypot(forward,right));
  if(keys.has('ArrowLeft'))yaw-=dt*1.5;if(keys.has('ArrowRight'))yaw+=dt*1.5;
  if(forward||right){point=moveWalk(world,point,(Math.sin(yaw)*forward+Math.cos(yaw)*right)/length*dt*1.2,(Math.cos(yaw)*forward-Math.sin(yaw)*right)/length*dt*1.2);}
  if(forward||right||keys.has('ArrowLeft')||keys.has('ArrowRight'))pose();frame=raf(tick);
 }
 function start(){if(active)return;world=createWalkWorld(scene);point=walkSpawn(world);saved={position:camera.position.toArray(),up:camera.up.toArray(),target:target.toArray(),fov:camera.fov,near:camera.near,cursor:canvas.style.cursor};active=true;yaw=0;pitch=0;last=0;
  camera.fov=65;camera.near=.03;camera.updateProjectionMatrix();canvas.tabIndex=0;canvas.style.cursor='crosshair';canvas.focus({preventScroll:true});
  const claimed=e=>{e.preventDefault();e.stopImmediatePropagation();};
  listen(doc,'keydown',e=>{
   if(!active||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||doc.hidden)return;
   const element=e.target,editable=element?.isContentEditable||element?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]');if(editable)return;
   const full=doc.fullscreenElement||doc.webkitFullscreenElement||canvas.closest?.('[data-ventra-walk-fullscreen]'),viewport=canvas.closest?.('[data-ventra-walk-fullscreen]')||canvas.parentElement;
   const controls=element?.closest?.('[data-ventra-walk-controls]');
   const own=element===canvas||viewport?.contains?.(element)||(controls&&controls.dataset.ventraWalkControls===String(scene.projectId))||(full?.contains(canvas)&&(full.contains(element)||element===doc.body||element===doc.documentElement));
   if(!own)return;const code=e.code||e.key;
   if(code==='Escape'){claimed(e);stop();return;}
   if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','Equal','Minus'].includes(code)){claimed(e);keys.add(code);}
  },{capture:true});
  listen(win,'keyup',e=>keys.delete(e.code));listen(canvas,'blur',clear);listen(win,'blur',clear);listen(doc,'visibilitychange',()=>{if(doc.hidden)clear();});
  let x=0,y=0;
  listen(canvas,'pointerdown',e=>{claimed(e);canvas.focus({preventScroll:true});if(pointer!==null||e.button>0)return;pointer=e.pointerId;x=e.clientX;y=e.clientY;try{canvas.setPointerCapture(pointer);}catch{}},{capture:true,passive:false});
  listen(canvas,'pointermove',e=>{if(pointer!==e.pointerId)return;claimed(e);yaw+=(e.clientX-x)*.004;pitch=Math.max(-1.15,Math.min(1.15,pitch-(e.clientY-y)*.004));x=e.clientX;y=e.clientY;pose();},{capture:true,passive:false});
  const up=e=>{if(pointer===e.pointerId){try{canvas.releasePointerCapture(pointer);}catch{}pointer=null;}};
  listen(win,'pointerup',up);listen(canvas,'pointercancel',up);listen(canvas,'lostpointercapture',up);listen(canvas,'wheel',e=>claimed(e),{capture:true,passive:false});
  pose();frame=raf(tick);
 }
 return{start,stop,dispose:stop,isActive:()=>active,setAxis:(forward=0,right=0)=>{if(active)axis={forward:Math.max(-1,Math.min(1,Number(forward)||0)),right:Math.max(-1,Math.min(1,Number(right)||0))};},turn:(yawDelta,pitchDelta=0)=>{if(active){yaw+=yawDelta;pitch=Math.max(-1.15,Math.min(1.15,pitch+pitchDelta));pose();}}};
}
