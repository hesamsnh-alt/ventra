import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export function detailedFurnitureKey(asset){
 if(asset?.type==='plant'){
  const key=asset.catalogId||asset.variant;
  if(['tree-potted','tree-potted-tall','potted-tree'].includes(key))return 'potted_plant_01';
  if(['plant-calathea','plant-calathea-large','calathea'].includes(key))return 'calathea_orbifolia_01';
  if(['plant-succulent','succulent'].includes(key))return 'potted_plant_04';
  return 'potted_plant_02';
 }
 if(asset?.type==='chair')return 'dining_chair_02';
 if(asset?.type==='sofa'&&(!asset.variant||['classic','luxury'].includes(asset.variant)))return 'sofa_02';
 return null;
}
export function fitDetailedFurniture(model,width,depth,height){
 const oriented=new T.Group();oriented.add(model);oriented.rotation.set(Math.PI/2,Math.PI,0);oriented.updateMatrixWorld(true);
 const bounds=new T.Box3().setFromObject(oriented),size=bounds.getSize(new T.Vector3());
 if([size.x,size.y,size.z,width,depth,height].some(n=>!Number.isFinite(n)||n<=0))throw new Error('Invalid detailed furniture dimensions');
 const offset=new T.Group();offset.add(oriented);offset.position.set(-(bounds.min.x+bounds.max.x)/2,-(bounds.min.y+bounds.max.y)/2,-bounds.min.z);
 const result=new T.Group();result.add(offset);result.scale.set(width/size.x,depth/size.y,height/size.z);return result;
}
function releaseModel(root,includeTextures=true){
 const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{
  if(o.geometry)geometries.add(o.geometry);
  for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}
 });
 for(const g of geometries)g.dispose();for(const m of materials)m.dispose();if(includeTextures)for(const t of textures)t.dispose();
}
export function createDetailedFurniture(scene,sceneData,refresh,loader=new GLTFLoader()){
 const assets=new Map((sceneData?.assets||[]).filter(a=>a.id).map(a=>[a.id,a]));
 const cache=new Map(),instances=new Map(),failed=new Set();let disposed=false;
 function load(key){
  if(!cache.has(key))cache.set(key,loader.loadAsync('/realistic-assets/'+key+'/model.gltf').then(gltf=>{
   if(disposed){releaseModel(gltf.scene);return null;}refresh();return gltf.scene;
  }).catch(()=>{failed.add(key);return null;}));
  return cache.get(key);
 }
 function sync(source,mirrors){
  if(disposed)return;
  const groups=new Map();source.traverse(o=>{const id=o.userData?.assetId;if(id&&o.geometry&&assets.has(id)){if(!groups.has(id))groups.set(id,[]);groups.get(id).push(o);}});
  for(const [id,parts] of groups){
   const asset=assets.get(id),key=detailedFurnitureKey(asset);if(!key||failed.has(key))continue;
   let instance=instances.get(id);
   if(!instance){
    if(!cache.has(key))load(key);
    // One creation callback per asset; no repeated per-frame promises.
    if(!instances.has(id)){
     instances.set(id,{pending:true});
     load(key).then(model=>{
      if(disposed||!model){instances.delete(id);return;}
      const selectedModel=key==='calathea_orbifolia_01'?(model.getObjectByName(asset.catalogId==='plant-calathea-large'?'calathea_orbifolia_01_a':'calathea_orbifolia_01_b')||model):model;
      let clone=selectedModel.clone(true);const ownMaterials=[];
      if(key==='calathea_orbifolia_01'){
       const bounds=new T.Box3().setFromObject(clone),size=bounds.getSize(new T.Vector3()),height=size.y*.24,radius=Math.min(size.x,size.z)*.18;
       const container=new T.Group();clone.position.y+=height-bounds.min.y;container.add(clone);
       const pot=new T.Mesh(new T.CylinderGeometry(radius,radius*.78,height,24),new T.MeshStandardMaterial({name:'calathea_pot',color:0xa57650,roughness:.75}));
       pot.position.set((bounds.min.x+bounds.max.x)/2,height/2,(bounds.min.z+bounds.max.z)/2);container.add(pot);clone=container;
      }
      clone.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.assetId=id;
       const copy=m=>{const c=m.clone();if(asset.color&&(asset.type!=='plant'||/pot/i.test(c.name)))c.color.set(asset.color);ownMaterials.push(c);return c;};
       o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
      }});
      const root=fitDetailedFurniture(clone,Number(asset.width),Number(asset.depth),Number(asset.height));root.matrixAutoUpdate=false;
      const first=parts[0];first.updateMatrixWorld(true);
      const parent=new T.Matrix4().fromArray(first.parent.matrixWorld.elements);
      const x=Number(asset.xMeters)-Number(sceneData.width)/2,y=Number(asset.yMeters)-Number(sceneData.depth)/2,z=Number(asset.zMeters)||0;
      const base=parent.multiply(new T.Matrix4().makeTranslation(x,y,z)).multiply(new T.Matrix4().makeRotationZ((Number(asset.rotation)||0)*Math.PI/180)).multiply(new T.Matrix4().makeScale(root.scale.x,root.scale.y,root.scale.z));
      const inverse=new T.Matrix4().fromArray(first.matrixWorld.elements).invert();
      instances.set(id,{root,first,inverse,base,ownMaterials});scene.add(root);refresh();
     }).catch(()=>{failed.add(key);instances.delete(id);});
    }
    continue;
   }
   if(instance.pending)continue;
   instance.root.matrix.copy(new T.Matrix4().fromArray(instance.first.matrixWorld.elements).multiply(instance.inverse).multiply(instance.base));instance.root.matrixWorldNeedsUpdate=true;
   instance.root.visible=parts.some(o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;});
   for(const part of parts){const mirror=mirrors.get(part);if(mirror)mirror.visible=false;}
  }
  for(const [id,entry] of instances)if(!groups.has(id)&&!entry.pending){scene.remove(entry.root);for(const m of entry.ownMaterials)m.dispose();instances.delete(id);}
 }
 return {sync,ready:async()=>{
  let timer;try{await Promise.race([Promise.all([...cache.values()]),new Promise(resolve=>{timer=setTimeout(resolve,15000);})]);}finally{clearTimeout(timer);}
 },dispose:()=>{
  disposed=true;for(const entry of instances.values())if(entry.root){scene.remove(entry.root);for(const m of entry.ownMaterials)m.dispose();}instances.clear();
  for(const promise of cache.values())promise.then(model=>{if(model)releaseModel(model);});cache.clear();
 }};
}
