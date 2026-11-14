import {createVRWalkthrough} from './vrWalkthrough.mjs';
import {capturePresentationEnvironment,createReferenceLighting,interiorShadowCaster,REFERENCE_LIGHTING,setPresentationReflections} from './referenceLighting.mjs';
import {surfacePhysicalSettings,createSurfaceRelief,presentationFinish,selectedPresentationFinish} from './interiorRenderQuality.mjs';
import {syncTextureSource,textureSourceStamp,textureSourceResized,bridgeTextureSource} from './textureBridge.mjs';
import * as T from 'three';
import {createDetailedSurfaces} from './detailedSurfaces.mjs';
import {createDetailedTextiles} from './detailedTextiles.mjs';
import {createDetailedFurniture} from './detailedFurniture.mjs';
import {createPresentationPost} from './presentationPost.mjs';

export const PHYSICAL_PREVIEW_LIGHTING=REFERENCE_LIGHTING.overview;

// A render-only bridge. APS geometry and editor raycasting remain authoritative.
export function physicalGeometry(source){
 const g=new T.BufferGeometry();
 if(source.attributes){
  for(const [name,a] of Object.entries(source.attributes))g.setAttribute(name,new T.BufferAttribute(new a.array.constructor(a.array),a.itemSize,a.normalized));
  if(source.index)g.setIndex(new T.BufferAttribute(new source.index.array.constructor(source.index.array),1));
  for(const group of source.groups||[])g.addGroup(group.start,group.count,group.materialIndex);
 }else{
  const p=[],n=[],uv=[];let groupStart=0,lastMaterial=null;
  if(!source.faces?.length)for(const v of source.vertices||[])p.push(v.x,v.y,v.z);
  for(const [i,f] of (source.faces||[]).entries()){
   if(lastMaterial!==null&&lastMaterial!==f.materialIndex){g.addGroup(groupStart,i*3-groupStart,lastMaterial);groupStart=i*3;}
   lastMaterial=f.materialIndex||0;
   for(const [j,index] of [f.a,f.b,f.c].entries()){
    const v=source.vertices[index],normal=f.vertexNormals?.[j]||f.normal,u=source.faceVertexUvs?.[0]?.[i]?.[j];
    p.push(v.x,v.y,v.z);n.push(normal?.x||0,normal?.y||0,normal?.z||0);uv.push(u?.x||0,u?.y||0);
   }
  }
  if(lastMaterial!==null)g.addGroup(groupStart,p.length/3-groupStart,lastMaterial);
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
 }
 if(!g.attributes.normal)g.computeVertexNormals();
 g.computeBoundingBox();g.computeBoundingSphere();return g;
}
export function physicalMaterialSettings(source){
 const selected=selectedPresentationFinish(source.userData?.furnitureFinish);
 if(selected)return selected;
 if(source.userData?.furniturePbr)return source.userData.furniturePbr;
 const finish=presentationFinish(source.userData?.presentationFinish);
 if(finish)return finish;
 const surface=surfacePhysicalSettings(source);if(surface)return surface;
 const shininess=Number(source.shininess)||0;
 return {roughness:Math.max(.22,Math.min(.94,Math.sqrt(2/(shininess+2)))),metalness:shininess>=100?.72:0};
}
// This exact bump scale identifies the procedural fabric already produced by the viewer.
// Keep paint, wood and user-supplied photo materials out of textile shading.
export function textilePhysicalSettings(source){
 if(source?.userData?.furnitureKind==='fabric')return {...source.userData.furniturePbr,sheen:.2,sheenRoughness:.85,sheenColor:0xffffff};
 const scale=Number(source?.bumpScale);
 if(!source?.bumpMap||!Number.isFinite(scale)||Math.abs(scale-.0005)>1e-9||surfacePhysicalSettings(source))return null;
 return {roughness:source.userData?.ventraTextile==='rug'?.96:.84,metalness:0,sheen:source.userData?.ventraTextile==='rug'?.16:.32,sheenRoughness:.85,sheenColor:0xffffff};
}
export function createPhysicalPreview(options){
 const renderer=new T.WebGLRenderer(options),nativeRender=renderer.render.bind(renderer);
 renderer.supportsPersonalModels=true;renderer.ventraLightingVersion='warm-interior-v2';
 renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.AgXToneMapping;renderer.toneMappingExposure=PHYSICAL_PREVIEW_LIGHTING.exposure;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),objects=new Map(),geometries=new Map(),materials=new Map(),textures=new Map();
 const environment=capturePresentationEnvironment(renderer);
 scene.environment=environment.texture;scene.environmentIntensity=PHYSICAL_PREVIEW_LIGHTING.environment;
 const anisotropy=Math.min(options.mobile?4:8,renderer.capabilities.getMaxAnisotropy());
 const relief=createSurfaceRelief(anisotropy);
 const lighting=createReferenceLighting(scene,renderer,options);
 renderer.setWalkthroughActive=active=>{
  lighting.setInterior(active);
  renderer.shadowMap.needsUpdate=true;
  for(const finish of materials.values()){
   if(finish.isMeshPhysicalMaterial)setPresentationReflections(finish,scene);
  }
 };
 const post=createPresentationPost(renderer,scene,camera,{mobile:options.mobile});
 const nativeSize=renderer.setSize.bind(renderer);
 renderer.setSize=(w,h,style)=>{nativeSize(w,h,style);if(w>0&&h>0&&!renderer.xr.enabled)post?.resize(w,h);};
 renderer.shadowMap.enabled=true;
 function texture(old,color){
  if(!old?.image)return null;
  const cacheKey=old.uuid+':'+color;if(textures.has(cacheKey)){const cached=textures.get(cacheKey);if(!textureSourceResized(cached,old)){syncTextureSource(cached,old);return cached;}cached.dispose();textures.delete(cacheKey);}
  const next=bridgeTextureSource(T,old);next.wrapS=old.wrapS;next.wrapT=old.wrapT;
  next.repeat.set(old.repeat?.x||1,old.repeat?.y||1);next.offset.set(old.offset?.x||0,old.offset?.y||0);
  next.userData.ventraSourceVersion=textureSourceStamp(old);next.userData.ventraSourceWidth=old.image.width;next.userData.ventraSourceHeight=old.image.height;next.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;next.anisotropy=anisotropy;next.needsUpdate=true;textures.set(cacheKey,next);return next;
 }
 const basicMaterial=old=>old?.type==='MeshBasicMaterial';
 let activeMaterials=new Set(),activeTextures=new Set();
 function material(old){
  if(Array.isArray(old))return old.map(material);
  if(old?.materials)return old.materials.map(material);
  if(!old)return new T.MeshStandardMaterial();
  activeMaterials.add(old);
  if(old.map)activeTextures.add(old.map.uuid+':true');
  if(old.bumpMap)activeTextures.add(old.bumpMap.uuid+':false');
  let next=materials.get(old);
  if(!next){
   const basic=old.type==='MeshBasicMaterial',textile=options.mobile?null:textilePhysicalSettings(old);
   const finish=physicalMaterialSettings(old);
   const coated=finish.clearcoat!==undefined||finish.anisotropy!==undefined;
   next=old.userData?.ventraMaterial==='railing_glass'?new T.MeshPhysicalMaterial({roughness:.07,metalness:0,transmission:options.mobile?0:.88,thickness:.012,ior:1.5}):basic?new T.MeshBasicMaterial():textile?new T.MeshPhysicalMaterial(textile):coated?new T.MeshPhysicalMaterial(finish):new T.MeshStandardMaterial(finish);
   next.map=texture(old.map,true);if(!basic){next.bumpMap=texture(old.bumpMap,false);next.bumpScale=old.bumpScale||0;}
   materials.set(old,next);
  }
  if(old.map&&!next.userData.ventraPhotographicTextile){const map=texture(old.map,true);if(next.map!==map){next.map=map;next.needsUpdate=true;}}if(!basicMaterial(old)&&old.bumpMap)next.bumpMap=texture(old.bumpMap,false);
  if(old.color)next.color.setRGB(old.color.r,old.color.g,old.color.b,T.SRGBColorSpace);
  Object.assign(next,{opacity:old.opacity,transparent:old.transparent,depthWrite:old.depthWrite,depthTest:old.depthTest,side:old.side,polygonOffset:old.polygonOffset,polygonOffsetFactor:old.polygonOffsetFactor,polygonOffsetUnits:old.polygonOffsetUnits});
  if(old.userData?.ventraMaterial==='railing_glass'){next.opacity=options.mobile?.24:1;next.transparent=true;}
  if(next.isMeshPhysicalMaterial)setPresentationReflections(next,scene);
  if(!basicMaterial(old))relief.apply(old,next);
  if(!options.sceneData?.palette?.designPreset)surfaces.apply(old,next);
  textiles.apply(old,next);
  return next;
 }
 let lastSource=null,lastCamera=null;
 const surfaces=createDetailedSurfaces(()=>{if(lastSource&&lastCamera)renderer.render(lastSource,lastCamera);});
 const textiles=createDetailedTextiles(()=>{if(lastSource&&lastCamera)renderer.render(lastSource,lastCamera);});
 const detailed=createDetailedFurniture(scene,options.sceneData,()=>{if(lastSource&&lastCamera)renderer.render(lastSource,lastCamera);});
 renderer.readyResources=()=>Promise.all([detailed.ready(),surfaces.ready(),textiles.ready()]);
 renderer.render=(oldScene,oldCamera)=>{
  if(oldCamera.isCamera)return nativeRender(oldScene,oldCamera);
  if(renderer.xr.isPresenting){renderer.shadowMap.needsUpdate=true;return;}
  lastSource=oldScene;lastCamera=oldCamera;
  oldScene.updateMatrixWorld(true);const active=new Set(),activeGeometry=new Set();activeMaterials=new Set();activeTextures=new Set();relief.begin();
  oldScene.traverse(old=>{
   if(!old.geometry||!old.material)return;
   active.add(old);activeGeometry.add(old.geometry);let mesh=objects.get(old);
   if(!mesh){let g=geometries.get(old.geometry);if(!g){g=physicalGeometry(old.geometry);geometries.set(old.geometry,g);}mesh=old.type==='Line'?new (old.mode===1?T.LineSegments:T.Line)(g,new T.LineBasicMaterial({color:old.material.color?.getHex?.()||0x444444})):new T.Mesh(g,material(old.material));mesh.matrixAutoUpdate=false;objects.set(old,mesh);scene.add(mesh);}
   if(old.type!=='Line')mesh.material=material(old.material);mesh.matrix.fromArray(old.matrixWorld.elements);mesh.matrixWorldNeedsUpdate=true;
   let visible=true;for(let parent=old;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}
   mesh.visible=visible;mesh.castShadow=interiorShadowCaster(old,lighting.isInterior());mesh.receiveShadow=old.receiveShadow;
  });
  for(const [old,mesh] of objects)if(!active.has(old)){scene.remove(mesh);if(old.type==='Line')mesh.material.dispose();objects.delete(old);}
  for(const [old,g] of geometries)if(!activeGeometry.has(old)){g.dispose();geometries.delete(old);}
  for(const [old,m] of materials)if(!activeMaterials.has(old)){m.dispose();materials.delete(old);}
  for(const [id,t] of textures)if(!activeTextures.has(id)){t.dispose();textures.delete(id);}
  relief.end();
  detailed.sync(oldScene,objects);
  if(oldScene.background)scene.background=new T.Color().setRGB(oldScene.background.r,oldScene.background.g,oldScene.background.b,T.SRGBColorSpace);
  camera.position.copy(oldCamera.position);camera.quaternion.copy(oldCamera.quaternion);camera.up.copy(oldCamera.up);
  camera.fov=oldCamera.fov;camera.aspect=oldCamera.aspect;camera.near=oldCamera.near;camera.far=oldCamera.far;camera.updateProjectionMatrix();if(post&&!renderer.xr.enabled)post.render();else nativeRender(scene,camera);
 };
 let shadowBeforeVR=null;
 const vr=createVRWalkthrough({renderer,scene,sceneData:options.sceneData,draw:nativeRender,onState:state=>{if(state==='starting'){shadowBeforeVR=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;}if(state==='idle'&&shadowBeforeVR!==null){renderer.shadowMap.autoUpdate=shadowBeforeVR;shadowBeforeVR=null;}renderer.onVRState?.(state);if(state==='idle'&&lastSource&&lastCamera)renderer.render(lastSource,lastCamera);}});
 renderer.startVR=settings=>vr.start(settings);renderer.stopVR=()=>vr.stop();renderer.isVRActive=()=>vr.isActive();
 renderer.supportsVR=true;
 const nativeDispose=renderer.dispose.bind(renderer);
 renderer.dispose=()=>{vr.dispose();lastSource=null;lastCamera=null;detailed.dispose();surfaces.dispose();textiles.dispose();relief.dispose();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();for(const t of textures.values())t.dispose();post?.dispose();environment.dispose();lighting.dispose();objects.clear();geometries.clear();materials.clear();textures.clear();nativeDispose();};
 return renderer;
}
