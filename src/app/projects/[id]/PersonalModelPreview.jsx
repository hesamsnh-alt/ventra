'use client';
import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {getPersonalAssetUrl} from '@/services/personalAssetService';
export default function PersonalModelPreview({assetId,projectId,label}){
 const host=useRef(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!assetId||!host.current)return;
  let live=true,frame,renderer,controls,model;const container=host.current;setError('');
  const release=root=>root?.traverse(o=>{o.geometry?.dispose?.();for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){for(const t of Object.values(m))if(t?.isTexture)t.dispose();m.dispose();}});
  try{
   renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setSize(320,240);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor(0x18202f);renderer.outputColorSpace=T.SRGBColorSpace;container.appendChild(renderer.domElement);
   renderer.domElement.style.width='100%';renderer.domElement.style.height='240px';renderer.domElement.style.objectFit='contain';
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,320/240,.01,100);camera.position.set(2.8,1.8,2.8);
   scene.add(new T.HemisphereLight(0xffffff,0x606070,3));const light=new T.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
   controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=true;
   const tick=()=>{if(!live)return;controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(tick);};tick();
   getPersonalAssetUrl(assetId,projectId).then(url=>new GLTFLoader().loadAsync(url)).then(g=>{
    if(!live){release(g.scene);return;}model=g.scene;const b=new T.Box3().setFromObject(model),size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());
    const longest=Math.max(size.x,size.y,size.z);if(!Number.isFinite(longest)||longest<=0)throw Error('Model has no visible size.');
    model.position.sub(center);const group=new T.Group();group.add(model);group.scale.setScalar(2/longest);scene.add(group);
   }).catch(()=>{if(live)setError('پیش‌نمایش مدل بارگذاری نشد / Model preview unavailable');});
  }catch{setError('نمایش سه‌بعدی در این مرورگر در دسترس نیست / WebGL unavailable');}
  return()=>{live=false;cancelAnimationFrame(frame);controls?.dispose();release(model);renderer?.dispose();renderer?.domElement.remove();};
 },[assetId,projectId]);
 return <div aria-label={label}><div ref={host}/>{error&&<p role="alert">{error}</p>}</div>;
}
