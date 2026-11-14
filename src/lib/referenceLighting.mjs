import * as T from 'three';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';

// Presentation lights only. The rig does not add fixtures, walls or project data.
export const REFERENCE_LIGHTING=Object.freeze({
 overview:{exposure:.86,environment:.42,bounce:.18,key:1.58,fill:.20,panel:.82},
 interior:{exposure:.98,environment:.52,bounce:.31,key:1.32,fill:.24,panel:1.28},
});
export function capturePresentationEnvironment(renderer){
 const studio=new T.Scene();
 studio.background=new T.Color(0x37342f);
 const daylight=new T.MeshBasicMaterial({color:new T.Color(5.5,6.1,7.1),toneMapped:false});
 const bounce=new T.MeshBasicMaterial({color:new T.Color(1.75,1.6,1.42),toneMapped:false});
 const add=(w,h,d,x,y,z,material)=>{
  const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);
  studio.add(mesh);
 };
 for(const z of [-.92,0,.92])for(const y of [.35,1.32])add(.024,.9,.84,-3.35,y,z,daylight);
 add(1.8,1.25,.02,1.4,1.35,3.5,bounce);
 add(2.8,.02,1.35,-.55,2.75,-1.9,bounce);
 const generator=new T.PMREMGenerator(renderer);
 try{
  return generator.fromScene(studio,.018,.1,18,{size:256});
 }finally{
  studio.traverse(object=>object.geometry?.dispose());
  daylight.dispose();
  bounce.dispose();
  generator.dispose();
 }
}

export function setPresentationReflections(material, scene) {
 const glossy=material.isMeshPhysicalMaterial&&(material.clearcoat>=.1||material.metalness>=.8);
 const texture=glossy?scene.environment:null;
 if(material.envMap!==texture){
  material.envMap=texture;
  material.needsUpdate=true;
 }
 if(!texture)return;
 material.envMapRotation.copy(scene.environmentRotation);
 // Use the same reflection image as the scene, with a material-specific response.
 const response=material.metalness>=.8?2.45:material.clearcoat>=.65?2.10:1.52;
 material.envMapIntensity=scene.environmentIntensity*response;
}

export function referenceRoomFrame(data={}){
 const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
 const width=Math.max(2,finite(data.width,12)),depth=Math.max(2,finite(data.depth,8));
 const z=Math.max(2.2,Math.min(5,finite(data.wallHeightMeters??data.wallHeight,2.8)));
 const origin=data.designDefaults?.viewOriginMeters;
 return {width,depth,z,x:origin?width/2-finite(origin.x,width/2):0,y:origin?depth/2-finite(origin.y,depth/2):0};
}
export function interiorShadowCaster(source,walkthrough){
 if(source.castShadow)return true;
 if(!walkthrough)return false;
 const mats=Array.isArray(source.material)?source.material:source.material?.materials||[source.material];
 if(mats.some(m=>!m||m.transparent||Number(m.opacity)<.95))return false;
 return ['schematic_plan_wall','schematic_wall','schematic_cutaway_wall','interior_wall','exterior_wall','design_ceiling'].includes(source.userData?.ventraType);
}
export function createWindowLights(sceneData, frame) {
 const walls=new Map((sceneData.walls||[]).map(wall=>[String(wall.id),wall]));
 const origin=sceneData.designDefaults?.viewOriginMeters||{x:frame.width/2,y:frame.depth/2};
 const windows=[];
 for(const opening of sceneData.openings||[]){
  if(opening.type!=='window')continue;
  const wall=walls.get(String(opening.wallId));
  if(wall?.type!=='external')continue;
  const {start,end}=wall;
  const width=Number(opening.width),height=Number(opening.height),offset=Number(opening.offset);
  if(![start?.x,start?.y,end?.x,end?.y,width,height,offset].every(Number.isFinite)||
    width<=0||height<=0||offset<0||offset>1)continue;
  const normal=new T.Vector3(-(end.y-start.y),end.x-start.x,0).normalize();
  if(!normal.lengthSq())continue;
  const x=start.x+(end.x-start.x)*offset-origin.x;
  const y=start.y+(end.y-start.y)*offset-origin.y;
  const z=(Number(opening.sillHeight)||.9)+height/2;
  if(normal.x*(frame.x-x)+normal.y*(frame.y-y)<0)normal.negate();
  windows.push({width,height,normal,position:new T.Vector3(x,y,z)});
 }
 const spread=[];
 // Distribute a bounded number of lights across the floor instead of concentrating on one room.
 while(windows.length&&spread.length<4){
  const largest=windows.reduce((best,current)=>current.width*current.height>best.width*best.height?current:best);
  spread.push(largest);
  for(let index=windows.length-1;index>=0;index--){
   if(windows[index].position.distanceTo(largest.position)<2.1)windows.splice(index,1);
  }
 }
 return spread.map(({width,height,normal,position})=>{
  const light=new T.RectAreaLight(0xeaf2ff,0,Math.min(width,3.6),Math.min(height,2.4));
  light.position.copy(position).addScaledVector(normal,.18);
  light.lookAt(light.position.clone().add(normal));
  return light;
 });
}

export function createReferenceLighting(scene,renderer,{span=15,mobile=false,sceneData={}}={}){
 RectAreaLightUniformsLib.init();
 const frame=referenceRoomFrame(sceneData),center=new T.Vector3(frame.x,frame.y,frame.z*.35);
 // Source models are Z-up. Keep diffuse sky bounce and reflection highlights in that frame.
 scene.environmentRotation.set(Math.PI/2,0,0);
 const bounce=new T.HemisphereLight(0xfff4e7,0x88715c,.2);bounce.position.set(0,0,1);scene.add(bounce);
 const key=new T.DirectionalLight(0xffefd9,1.55);key.position.set(frame.x+span*.5,frame.y-span*.6,span*.85);key.target.position.copy(center);key.castShadow=true;
 const extent=span*.7+2;Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:span*5});key.shadow.camera.updateProjectionMatrix();
 key.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);key.shadow.bias=-.00006;key.shadow.normalBias=.006;key.shadow.radius=4;key.shadow.blurSamples=8;scene.add(key,key.target);
 const fill=new T.DirectionalLight(0xdde8f5,.22);fill.position.set(frame.x-span,frame.y+span,span*.6);scene.add(fill);
 // Broad warm emitters give continuous highlights rather than a camera-following flash.
 const panel=new T.RectAreaLight(0xffdfb6,.7,Math.min(frame.width*.55,7),Math.min(frame.depth*.5,5));
 panel.position.set(frame.x-frame.width*.16,frame.y-frame.depth*.10,frame.z-.08);panel.lookAt(frame.x,frame.y,0);scene.add(panel);
 const windowFill=new T.RectAreaLight(0xe1edff,0,Math.min(frame.depth*.58,4.4),Math.min(frame.z*.7,2.1));
 windowFill.position.set(frame.x+frame.width*.44,frame.y+frame.depth*.19,frame.z*.65);
 windowFill.lookAt(frame.x,frame.y,frame.z*.39);
 scene.add(windowFill);
 const windowLights=createWindowLights(sceneData,frame);
 for(const light of windowLights)scene.add(light);
 let interior=false;
 function setInterior(value){interior=Boolean(value);const p=interior?REFERENCE_LIGHTING.interior:REFERENCE_LIGHTING.overview;if(renderer.shadowMap)renderer.shadowMap.type=interior&&!mobile?T.VSMShadowMap:T.PCFSoftShadowMap;renderer.toneMappingExposure=p.exposure;scene.environmentIntensity=p.environment;bounce.intensity=p.bounce;key.intensity=p.key;fill.intensity=p.fill;panel.intensity=p.panel*(mobile?.9:1);windowFill.intensity=windowLights.length?(interior?.34:.23):(interior?1.22:.54);
  for(const light of windowLights)light.intensity=interior?2.35:1.05;}
 setInterior(false);
 return {key,panel,setInterior,isInterior:()=>interior,dispose(){scene.remove(bounce,key,key.target,fill,panel,windowFill,...windowLights);key.shadow.dispose();}};
}
