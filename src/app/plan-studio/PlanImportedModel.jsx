'use client';

import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {disposePlanScene} from '@/lib/planStudio/scene.mjs';
import {inspectPlanGlb} from '@/lib/planStudio/modelFile.mjs';
import {download} from '@/lib/planStudio/export.mjs';

export default function PlanImportedModel({file,t}){
 const host=useRef(null),fit=useRef(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const container=host.current;
  let active=true, renderer, controls, observer, model;
  setLoading(true);
  setError('');
  const scene=new T.Scene();
  scene.background=new T.Color('#151e2b');
  async function openModel(){
   renderer=new T.WebGLRenderer({antialias:true});
   renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
   renderer.outputColorSpace=T.SRGBColorSpace;
   renderer.toneMapping=T.AgXToneMapping;
   container.appendChild(renderer.domElement);
   const camera=new T.PerspectiveCamera(45,1,.01,1000);
   controls=new OrbitControls(camera,renderer.domElement);
   const render=()=>renderer.render(scene,camera);
   controls.addEventListener('change',render);
   const resize=()=>{
    const width=Math.max(1,container.clientWidth),height=Math.max(280,container.clientHeight);
    renderer.setSize(width,height);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    render();
   };
   observer=new ResizeObserver(resize);
   observer.observe(container);
   const light=new T.DirectionalLight(0xffe9ce,3);
   light.position.set(4,6,3);
   scene.add(light,new T.HemisphereLight(0xeaf3ff,0x514e49,2.2));
   const data=await file.blob.arrayBuffer();
   if(!active)return;
   inspectPlanGlb(data);
   const gltf=await new GLTFLoader().parseAsync(data,'');
   if(!active){disposePlanScene(gltf.scene);return;}
   model=gltf.scene;
   const box=new T.Box3().setFromObject(model);
   if(box.isEmpty())throw Error('No visible model geometry. / هندسه‌ای برای نمایش پیدا نشد.');
   const sphere=box.getBoundingSphere(new T.Sphere()), radius=Math.max(.0001,sphere.radius);
   if(!Number.isFinite(radius))throw Error('Invalid model size. / ابعاد مدل معتبر نیست.');
   scene.add(model);
   resize();
   fit.current=()=>{
    const angle=T.MathUtils.degToRad(camera.fov/2);
    const limitingAngle=Math.min(angle,Math.atan(Math.tan(angle)*camera.aspect));
    const distance=radius/Math.sin(limitingAngle)*1.12;
    camera.near=Math.max(.000001,distance/1000);
    camera.far=distance*100;
    camera.updateProjectionMatrix();
    camera.position.copy(sphere.center).addScaledVector(new T.Vector3(1,.66,1).normalize(),distance);
    controls.target.copy(sphere.center);
    controls.update();
    render();
   };
   fit.current();
  }
  openModel().catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoading(false);});
  return ()=>{
   active=false;
   fit.current=null;
   observer?.disconnect();
   controls?.dispose();
   if(model)disposePlanScene(model);
   renderer?.dispose();
   renderer?.domElement.remove();
  };
 },[file]);
 return <section className="ps-preview">
  <div className="ps-preview-tools">
   <span>{file.name}</span>
   <button type="button" onClick={()=>fit.current?.()} disabled={loading||Boolean(error)}>{t('Fit model','نمایش کامل مدل')}</button>
   <button type="button" onClick={()=>download(file.blob,file.name)}>{t('Save original GLB','ذخیرهٔ فایل اصلی GLB')}</button>
  </div>
  <div className="ps-three-host" ref={host}/>
  {loading&&<p role="status">{t('Opening 3D model…','در حال باز کردن مدل سه‌بعدی…')}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
