import * as T from 'three';
import {moveWalk} from './walkthrough.mjs';

export async function vrAvailability(xr=globalThis.navigator?.xr,secure=globalThis.isSecureContext){
 if(!secure)return 'https';if(!xr?.isSessionSupported)return 'unavailable';
 try{return await xr.isSessionSupported('immersive-vr')?'supported':'unavailable';}catch{return 'unavailable';}
}
import {resolveVRSettings,vrBoundaryNear} from './vrSettings.mjs';
const axis=value=>Number.isFinite(value)?Math.abs(value)<.18?0:Math.max(-1,Math.min(1,value)):0;
export function vrInput(sources=[]){
 let right=0,forward=0,turn=0;
 for(const s of sources){if(s.gamepad?.mapping!=='xr-standard')continue;const a=s.gamepad.axes||[],x=axis(a.length>=4?a[2]:a[0]),y=axis(a.length>=4?a[3]:a[1]);
  if(s.handedness==='left'){right=x;forward=-y||0;}else if(s.handedness==='right')turn=x;
 }
 const length=Math.max(1,Math.hypot(right,forward));return{right:right/length,forward:forward/length,turn};
}
// Separate XR camera: the desktop camera, model and saved quantities never change.
// The rig maps WebXR's Y-up metre space into Ventra's Z-up metre space.
export function createVRWalkthrough({renderer,scene,sceneData,draw,onState=()=>{},xr=globalThis.navigator?.xr,secure=globalThis.isSecureContext}){
 let session=null,pending=false,disposed=false,rig=null,camera=null,world=null,last=null,turnHeld=false,ending=false,border=null,options=null,generation=0,spawn=null,resetHeld=false;
 const up=new T.Vector3(0,0,1),base=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2);
 const available=()=>!!renderer.xr&&!!renderer.setAnimationLoop;
 function cleanup(){
  const wasActive=!!session||pending;session?.removeEventListener('end',cleanup);renderer.setAnimationLoop(null);if(rig)scene.remove(rig);if(border){scene.remove(border);border.geometry.dispose();border.material.dispose();border=null;}
  session=null;pending=false;rig=null;camera=null;last=null;turnHeld=false;resetHeld=false;ending=false;
  if(renderer.xr)renderer.xr.enabled=false;if(wasActive&&!disposed)queueMicrotask(()=>{if(!session&&!pending&&!disposed)onState('idle');});
 }
 function tick(time,frame){
  if(!session||disposed||!rig)return;
  const dt=last===null?0:Math.min(.05,Math.max(0,(time-last)/1000));last=time;
  const pose=frame?.getViewerPose(renderer.xr.getReferenceSpace());
  if(pose&&(!session.visibilityState||session.visibilityState==='visible')){
   const p=pose.transform.position,q=pose.transform.orientation;
   rig.updateMatrixWorld(true);
   const local=new T.Vector3(p.x,p.y,p.z),head=rig.localToWorld(local.clone());
   if(border){const near=vrBoundaryNear(world,{x:head.x+world.origin.x,y:head.y+world.origin.y});border.material.color.set(near?'#ff553e':'#4de0cd');}
   const reset=[...session.inputSources].some(s=>s.handedness==='right'&&s.gamepad?.mapping==='xr-standard'&&s.gamepad.buttons?.[4]?.pressed);
   if(reset&&!resetHeld){const offset=local.clone().applyQuaternion(rig.quaternion);rig.position.x=spawn.x-world.origin.x-offset.x;rig.position.y=spawn.y-world.origin.y-offset.y;}resetHeld=reset;
   const input=vrInput(session.inputSources);if(!options.movement){input.forward=0;input.right=0;}const direction=new T.Vector3(0,0,-1).applyQuaternion(new T.Quaternion(q.x,q.y,q.z,q.w)).transformDirection(rig.matrixWorld);
   const horizontal=Math.hypot(direction.x,direction.y);
   if(horizontal>.01&&(input.forward||input.right)){
    const f={x:direction.x/horizontal,y:direction.y/horizontal},point={x:head.x+world.origin.x,y:head.y+world.origin.y};
    const next=moveWalk(world,point,(f.x*input.forward+f.y*input.right)*dt*options.speed,(f.y*input.forward-f.x*input.right)*dt*options.speed);
    rig.position.x+=next.x-point.x;rig.position.y+=next.y-point.y;
   }
   if(Math.abs(input.turn)<.3)turnHeld=false;
   if(Math.abs(input.turn)>.7&&!turnHeld){
    // Snap about the headset, not the room origin, so turning never teleports.
    rig.updateMatrixWorld(true);const before=rig.localToWorld(local.clone());
    rig.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(up,-Math.sign(input.turn)*options.snapDegrees*Math.PI/180));rig.updateMatrixWorld(true);
    const after=rig.localToWorld(local.clone());rig.position.add(before.sub(after));turnHeld=true;
   }
  }else turnHeld=false;
  draw(scene,camera);
 }
 async function start(settings={}){
  if(disposed)throw Error('VR viewer is closed. / نمایشگر بسته شده است.');
  if(session||pending)return;
  if(!secure||!xr?.requestSession||!available())throw Error('VR needs HTTPS, a WebXR browser and a compatible headset. / VR به HTTPS، مرورگر WebXR و هدست سازگار نیاز دارد.');
  const resolved=resolveVRSettings(sceneData,settings);world=resolved.world;options=resolved.options;const point=resolved.spawn;spawn=point;const ticket=++generation;onState('starting');pending=true;
  try{
   // Must happen directly from the user's click, before any awaited capability check.
   const next=await xr.requestSession('immersive-vr',{requiredFeatures:['local-floor'],optionalFeatures:['bounded-floor']});
   if(disposed||!pending||ticket!==generation){await next.end();return;}
   session=next;session.addEventListener('end',cleanup);
   rig=new T.Group();rig.quaternion.copy(base);rig.position.set(point.x-world.origin.x,point.y-world.origin.y,0);
   camera=new T.PerspectiveCamera(65,1,.03,5000);rig.add(camera);scene.add(rig);
   if(options.showBoundary){const points=[],polygons=world.footprint?[world.footprint]:world.rooms.map(r=>r.polygon);for(const polygon of [...polygons,...world.holes])for(let i=0;i<polygon.length;i++){for(const p of [polygon[i],polygon[(i+1)%polygon.length]])points.push(p.x-world.origin.x,p.y-world.origin.y,.025);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));border=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#4de0cd',depthTest:false,transparent:true,opacity:.8}));border.renderOrder=100;scene.add(border);}

   renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor?.(options.profile==='quest2'?.8:1);renderer.xr.setFoveation?.(1);
   await renderer.xr.setSession(session);
   if(disposed||!session)return;
   pending=false;last=null;renderer.setAnimationLoop(tick);onState('active');
  }catch(error){const failed=session;cleanup();try{await failed?.end();}catch{}throw error;}
 }
 async function stop(){
  if(pending&&!session){generation++;pending=false;if(!disposed)onState('idle');return;}
  if(!session||ending)return;ending=true;
  try{await session.end();}catch(error){ending=false;throw error;}
 }
 return{start,stop,isActive:()=>!!session||pending,supported:available,dispose(){disposed=true;generation++;const old=session;cleanup();old?.end().catch(()=>{});}};
}
