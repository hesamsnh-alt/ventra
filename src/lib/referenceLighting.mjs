import * as T from 'three';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';

// Presentation lights only. The rig does not add fixtures, walls or project data.
export const REFERENCE_LIGHTING=Object.freeze({
 overview:{exposure:.82,environment:.38,bounce:.20,key:1.55,fill:.22,panel:.7},
 interior:{exposure:.88,environment:.42,bounce:.27,key:1.25,fill:.16,panel:1.45},
});
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
 let interior=false;
 function setInterior(value){interior=Boolean(value);const p=interior?REFERENCE_LIGHTING.interior:REFERENCE_LIGHTING.overview;if(renderer.shadowMap)renderer.shadowMap.type=interior&&!mobile?T.VSMShadowMap:T.PCFSoftShadowMap;renderer.toneMappingExposure=p.exposure;scene.environmentIntensity=p.environment;bounce.intensity=p.bounce;key.intensity=p.key;fill.intensity=p.fill;panel.intensity=p.panel*(mobile?.8:1);}
 setInterior(false);
 return {key,panel,setInterior,isInterior:()=>interior,dispose(){scene.remove(bounce,key,key.target,fill,panel);key.shadow.dispose();}};
}
