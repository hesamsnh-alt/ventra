import * as T from 'three';
// One local photograph per preview. Failure keeps the woven procedural material.
// Loading never changes scene data, catalog IDs, dimensions or takeoff quantities.
export function createDetailedTextiles(refresh,loader=new T.TextureLoader()){
 let texture=null,pending=null,failed=false,disposed=false;
 function start(){
  if(pending||failed||disposed)return;
  pending=loader.loadAsync('/realistic-assets/textiles/persian-vase-carpet.jpg').then(t=>{
   if(disposed){t.dispose();return;}
   t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;t.anisotropy=4;t.needsUpdate=true;texture=t;refresh();
  }).catch(()=>{failed=true;});
 }
 return {apply(old,next){
  if(old.userData?.ventraTextile!=='rug'||old.userData?.textileVariant!=='persian')return;
  start();if(!texture||disposed)return;
  if(next.map!==texture){next.map=texture;next.needsUpdate=true;}
  next.userData.ventraPhotographicTextile=true;
  // Preserve the source photograph for the catalog color; other selected colors
  // tint it without replacing its small woven and floral details.
  const tint=new T.Color(old.userData.textileColor||'#8d343b'),base=new T.Color('#8d343b');
  const values=[tint.r/base.r,tint.g/base.g,tint.b/base.b],limit=Math.max(1,...values);
  next.color.setRGB(...values.map(n=>Math.min(1,n/limit)));next.roughness=.96;next.metalness=0;
 },ready:async()=>{let timer;try{await Promise.race([pending||Promise.resolve(),new Promise(resolve=>{timer=setTimeout(resolve,15000);})]);}finally{clearTimeout(timer);}},dispose(){disposed=true;texture?.dispose();texture=null;}};
}
