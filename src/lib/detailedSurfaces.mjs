import * as T from 'three';
export function createDetailedSurfaces(refresh,loader=new T.TextureLoader()){
 let pack=null,pending=null,disposed=false,failed=false;
 function start(){
  if(pending||failed||disposed)return;
  const loaded=[];
  pending=Promise.all(['color','normal','roughness'].map(async name=>{
   const texture=await loader.loadAsync('/realistic-assets/wood_floor/'+name+'.jpg');
   if(disposed||failed){texture.dispose();return texture;}loaded.push(texture);
   texture.colorSpace=name==='color'?T.SRGBColorSpace:T.NoColorSpace;
   texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(1/1.7,1/1.7);texture.anisotropy=4;return texture;
  })).then(([color,normal,roughness])=>{if(disposed){loaded.forEach(t=>t.dispose());return;}pack={color,normal,roughness};refresh();}).catch(()=>{failed=true;loaded.forEach(t=>t.dispose());});
 }
 return {apply:(old,next)=>{
  if(old.userData?.ventraFloorFinish!=='warm_oak')return;
  start();if(!pack||disposed)return;
  if(next.normalMap!==pack.normal){next.map=pack.color;next.normalMap=pack.normal;next.normalScale.set(.45,.45);next.roughnessMap=pack.roughness;next.roughness=.8;next.bumpMap=null;next.needsUpdate=true;}
 },ready:async()=>{let timer;try{await Promise.race([pending||Promise.resolve(),new Promise(r=>{timer=setTimeout(r,15000);})]);}finally{clearTimeout(timer);}},dispose:()=>{disposed=true;if(pack)Object.values(pack).forEach(t=>t.dispose());pack=null;}};
}
