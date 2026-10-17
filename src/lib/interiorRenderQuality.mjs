import * as T from 'three';

// Render-only presentation settings. No inferred dimensions or project writes.
export const INTERIOR_LIGHTING=Object.freeze({exposure:.88,environment:.46,bounce:.42});
export function previewPixelRatio(width,height,deviceRatio=1,mobile=false){
 const pixels=Math.max(1,Number(width)||1)*Math.max(1,Number(height)||1);
 return Math.min(Math.max(.5,Number(deviceRatio)||1),mobile?1.5:1.75,Math.sqrt((mobile?1200000:2800000)/pixels));
}
const finishes=Object.freeze({
 stone:{roughness:.38,metalness:0,bumpScale:.0012},
 brick:{roughness:.9,metalness:0,bumpScale:.006},
 sand:{roughness:.97,metalness:0,bumpScale:.003},
 cement:{roughness:.88,metalness:0,bumpScale:.0008},
 wood:{roughness:.53,metalness:0,bumpScale:.001},
 paint:{roughness:.87,metalness:0,bumpScale:.00012},
 wallpaper:{roughness:.92,metalness:0,bumpScale:.00015},
});
export function physicalSurfaceKind(source){
 const id=source?.userData?.ventraSurfaceMaterial;
 if(typeof id!=='string'||id.startsWith('personal:'))return null;
 const kind=id.split('-')[0];return finishes[kind]?kind:null;
}
export function surfacePhysicalSettings(source){
 const kind=physicalSurfaceKind(source);
 if(kind){const {roughness,metalness}=finishes[kind];return {roughness,metalness};}
 if(source?.userData?.ventraFloorFinish==='marble')return {roughness:.26,metalness:0};
 if(source?.userData?.ventraFloorFinish==='warm_oak')return {roughness:.53,metalness:0};
 return null;
}
// Height is independent of pigment: white mortar must not become raised brick.
// Periodic functions make repeat boundaries seamless; no photo-to-PBR guesses.
export function surfaceHeight(kind,u,v){
 const wave=(x,y)=>Math.sin(2*Math.PI*x)*Math.sin(2*Math.PI*y);
 const noise=.5+.22*wave(u*37,v*29)+.12*wave(u*67,v*61);
 const edge=x=>Math.min(x-Math.floor(x),1-(x-Math.floor(x)));
 if(kind==='brick'||kind==='stone'){
  const rows=kind==='brick'?8:4,row=Math.floor(v*rows);
  const joint=Math.min(edge(u*4+(kind==='brick'&&row%2?.5:0))*64,edge(v*rows)*64,1);
  return .18+.64*Math.max(0,joint)+.035*noise;
 }
 if(kind==='wood')return .52+.06*Math.sin(2*Math.PI*(u*72+.08*Math.sin(v*2*Math.PI))) - .2*Math.max(0,1-edge(u*6)*160);
 return noise;
}
export function createSurfaceRelief(anisotropy=4){
 const cache=new Map();let active=new Set();
 function apply(old,next){
  const kind=physicalSurfaceKind(old);if(!kind||!old.map)return;
  active.add(old.map);let texture=cache.get(old.map);
  if(!texture){
   const size=256,data=new Uint8Array(size*size*4);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,value=Math.round(255*surfaceHeight(kind,x/size,y/size));
    data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
   }
   texture=new T.DataTexture(data,size,size,T.RGBAFormat);texture.wrapS=texture.wrapT=T.RepeatWrapping;
   texture.flipY=true;texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
   texture.anisotropy=anisotropy;texture.colorSpace=T.NoColorSpace;texture.needsUpdate=true;cache.set(old.map,texture);
  }
  texture.repeat.copy(old.map.repeat);texture.offset.copy(old.map.offset);
  if(next.bumpMap!==texture){next.bumpMap=texture;next.needsUpdate=true;}
  next.bumpScale=finishes[kind].bumpScale;
 }
 return {apply,begin:()=>{active=new Set();},end:()=>{for(const [key,t] of cache)if(!active.has(key)){t.dispose();cache.delete(key);}},dispose:()=>{for(const t of cache.values())t.dispose();cache.clear();}};
}
