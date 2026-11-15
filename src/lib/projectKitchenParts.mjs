import * as T from 'three';
import {buildSink,buildCooktop,buildFridge,material} from './kitchenDemoParts.mjs';
import {registerSceneInteraction} from './kitchenModel.mjs';

export function buildProjectKitchenPart({THREE,type,w,d,h,cx,cy,rot,z,embedded,surfaceHeight}){
 const source=new T.Group();
 const steel=material(0xd6d6cc,.30,{metalness:.86,anisotropy:.65,clearcoat:.16});
 const dark=material(0x292721,.44);
 const glass=material(0x1c211c,.19,{metalness:.42});
 let anchor,scale,update=()=>false;
 const actions=new Map();
 if(type==='sink'){
  const model=buildSink(source,steel,dark);
  anchor=[-.30,1.037,-.0385];
  const fit=Math.min(w/.64,d/.48);
  scale=[fit,fit,fit];
  let running=false;
  actions.set('faucet',()=>model.setRunning(running=!running));
  update=time=>model.animate(time);
 }else if(type==='stove'){
  const zones=buildCooktop(source,glass);
  anchor=[.35,.934,-2.95];
  scale=[w/.81,1,d/.52];
  zones.forEach((zone,index)=>{
   let active=false;
   actions.set('burner'+index,()=>zone.set(active=!active));
  });
 }else if(type==='refrigerator'){
  const fridge=buildFridge(source,{dark,steel,blackGlass:glass},{includeHousing:false});
  anchor=[2.92,.108,-2.79];
  scale=[w/.88,h/2.06,d/.90];
  fridge.doors.forEach((door,index)=>actions.set(door.userData.pick,()=>{
   door.rotation.y=door.rotation.y?0:index===0?-1.61:1.78;
   fridge.interiorLight.intensity=fridge.doors.some(leaf=>leaf.rotation.y!==0)?3.2:0;
  }));
 }else return null;

 // Preserve the original demo hierarchy, then align local Y-up to the project's Z-up.
 const root=new THREE.Group();
 root.position.set(cx,cy,surfaceHeight??(z+(type==='sink'?(embedded?.957:Math.min(h,.82)+.057):
  type==='stove'?(embedded?.93:Math.min(h,.88)):0)));
 root.rotation.z=rot;
 const orient=new THREE.Group();
 orient.rotation.x=Math.PI/2;
 orient.scale.set(...scale);
 root.add(orient);
 const offset=new THREE.Group();
 offset.position.set(-anchor[0],-anchor[1],-anchor[2]);
 orient.add(offset);
 const mapped=[];
 const usedMaterials=new Set();
 const usedGeometries=new Set();
 function copy(node,parent,action){
  const nextAction=actions.get(node.userData.pick)||action;
  const group=new THREE.Group();
  parent.add(group);
  if(node.isPointLight)group.userData.demoLight=node;
  if(node.isMesh){
   const original=node.geometry;
   usedGeometries.add(original);
   const flat=original.index?original.toNonIndexed():original;
   const entries=Array.isArray(node.material)?flat.groups:[{start:0,count:flat.attributes.position.count,materialIndex:0}];
   const parts=[];
   for(const {start,count,materialIndex} of entries){
    const finish=Array.isArray(node.material)?node.material[materialIndex]:node.material;
    usedMaterials.add(finish);
    const geometry=new THREE.BufferGeometry();
    for(const name of ['position','normal','uv']){
     const attribute=flat.getAttribute(name);
     if(!attribute)continue;
     const values=attribute.array.slice(start*attribute.itemSize,(start+count)*attribute.itemSize);
     const output=new THREE.BufferAttribute(values,attribute.itemSize);
     if(geometry.setAttribute)geometry.setAttribute(name,output);
     else geometry.addAttribute(name,output);
    }
    geometry.computeBoundingSphere();
    const placeholder=new THREE.MeshPhongMaterial({color:finish.color.getHex(),side:finish.side,
     transparent:finish.transparent,opacity:finish.opacity});
    placeholder.userData={demoMaterial:finish};
    const part=new THREE.Mesh(geometry,placeholder);
    part.castShadow=node.castShadow;part.receiveShadow=node.receiveShadow;
    part.userData={demoPart:true};
    group.add(part);
    parts.push([part,start,count]);
    if(nextAction)registerSceneInteraction([part],nextAction);
   }
   if(flat!==original)flat.dispose();
   if(node.parent?.name==='faucet-water'&&original.type==='CylinderGeometry'){
    mapped.push(()=>{
     const sourcePosition=original.attributes.position.array;
     for(const [part,start,count] of parts){
      const target=part.geometry.attributes.position;
      for(let index=0;index<count;index++){
       const sourceIndex=(original.index?original.index.array[start+index]:start+index)*3;
       target.array.set(sourcePosition.subarray(sourceIndex,sourceIndex+3),index*3);
      }
      target.needsUpdate=true;
      part.geometry.userData ||= {};
      part.geometry.userData.ventraDynamic=true;
     }
    });
   }
  }
  mapped.push(()=>{
   group.position.copy(node.position);group.quaternion.copy(node.quaternion);
   group.scale.copy(node.scale);group.visible=node.visible;
  });
  for(const child of node.children)copy(child,group,nextAction);
 }
 for(const child of source.children)copy(child,offset);
 for(const unused of [steel,dark,glass])if(!usedMaterials.has(unused))unused.dispose();
 root.userData={
  updateDemoPart(time){const moving=update(time);for(const sync of mapped)sync();return moving;},
  disposeDemoPart(){for(const object of usedGeometries)object.dispose();for(const finish of usedMaterials)finish.dispose();},
 };
 root.userData.updateDemoPart(0);
 return root;
}

export function sinkOpening(width,depth){
 const scale=Math.min(width/.64,depth/.48);
 return {width:.598*scale,depth:.379*scale,drop:.206*scale};
}

export function countertopFixtures(assets,placement){
 const counters=[];
 const openings=new Map(),heights=new Map();
 for(const asset of assets){
  const pose=placement(asset);
  if(['kitchen_counter','kitchen_island'].includes(pose.assetType))counters.push({asset,pose});
 }
 for(const asset of assets){
  if(!asset.embeddedInCounter)continue;
  const pose=placement(asset);
  if(!['sink','stove'].includes(pose.assetType))continue;
  const basin=sinkOpening(pose.w,pose.d);
  for(const counter of counters){
   if(asset.roomId&&counter.asset.roomId&&asset.roomId!==counter.asset.roomId)continue;
   const {cx,cy,rot,w,d,h}=counter.pose;
   const dx=pose.cx-cx,dy=pose.cy-cy,c=Math.cos(rot),s=Math.sin(rot);
   const x=dx*c+dy*s,y=-dx*s+dy*c;
   const localAngle=pose.rot-rot,ac=Math.abs(Math.cos(localAngle)),as=Math.abs(Math.sin(localAngle));
   const width=ac*basin.width+as*basin.depth,depth=as*basin.width+ac*basin.depth;
   if(![x,y,width,depth,h].every(Number.isFinite)||Math.abs(x)+width/2>w/2||Math.abs(y)+depth/2>d/2)continue;
   if(counter.asset.variant==='l-shape'){
    const corner=Math.min(.6,d*.4,w*.4);
    if(y-depth/2<d/2-corner&&x+width/2>-w/2+corner)continue;
   }
   if(pose.assetType==='sink'){
    const holes=openings.get(counter.asset)||[];
    holes.push({x,y,width,depth});
    openings.set(counter.asset,holes);
   }
   heights.set(asset,h+(Number(counter.asset.zMeters)||0));
   break;
  }
 }
 return {openings,heights};
}
