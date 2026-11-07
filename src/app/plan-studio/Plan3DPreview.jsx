'use client';
import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createPlanScene,disposePlanScene} from '@/lib/planStudio/scene.mjs';
import {bounds} from '@/lib/planStudio/geometry.mjs';
export default function Plan3DPreview({doc}){
 const host=useRef(null),runtime=useRef(null),[error,setError]=useState('');
 useEffect(()=>{let renderer,controls,observer,root,currentDoc=doc;try{
  const parent=host.current,scene=new T.Scene();scene.background=new T.Color('#151e2b');renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;parent.appendChild(renderer.domElement);
  const camera=new T.PerspectiveCamera(45,1,.02,10000);camera.up.set(0,0,1);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.screenSpacePanning=true;
  const ambient=new T.HemisphereLight('#fff4e1','#72819a',2),sun=new T.DirectionalLight('#fff0cf',2.5);sun.position.set(-8,-6,15);scene.add(ambient,sun);
  const grid=new T.GridHelper(100,100,'#4b6279','#26364b');grid.rotation.x=Math.PI/2;grid.position.z=-.14;scene.add(grid);
  const render=()=>renderer.render(scene,camera),fit=()=>{const b=bounds(currentDoc.entities),span=Math.max(b.width,b.height,4);camera.up.set(0,0,1);camera.position.set(b.x+b.width/2+span*.8,b.y+b.height/2-span,span*.9);controls.target.set(b.x+b.width/2,b.y+b.height/2,.7);controls.update();render();};controls.addEventListener('change',render);
  runtime.current={setDocument(next){currentDoc=next;if(root){scene.remove(root);disposePlanScene(root);}root=createPlanScene(next);scene.add(root);ambient.intensity=(next.lighting?.intensity??1)*2;sun.color.set(next.lighting?.color||'#fff2d7');render();},fit,renderer,controls,camera,render};
  const resize=()=>{if(!parent.clientWidth)return;const w=parent.clientWidth,h=Math.max(300,parent.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);render();};observer=new ResizeObserver(resize);observer.observe(parent);runtime.current.setDocument(doc);fit();resize();
 }catch(e){setError('3D preview unavailable: '+e.message);}return()=>{observer?.disconnect();controls?.dispose();if(root)disposePlanScene(root);renderer?.dispose();renderer?.domElement?.remove();runtime.current=null;};},[]);
 useEffect(()=>{try{if(runtime.current){runtime.current.setDocument(doc);setError('');}}catch(e){setError(e.message);}},[doc]);
 return <section className="ps-preview"><div className="ps-preview-tools"><span>LIVE 3D</span><button type="button" onClick={()=>runtime.current?.fit()}>Fit / نمایش کامل</button><button type="button" onClick={()=>{const r=runtime.current;if(r){const t=r.controls.target;r.camera.position.set(t.x,t.y,Math.max(10,r.camera.position.distanceTo(t)));r.camera.up.set(0,1,0);r.controls.update();r.render();}}}>Top / بالا</button></div><div ref={host} className="ps-three-host"/>{error&&<p role="alert">{error}</p>}<small>Drag: orbit · Right drag: pan · Wheel: zoom</small></section>;
}
