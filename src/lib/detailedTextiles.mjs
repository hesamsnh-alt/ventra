import * as T from 'three';
export const PERSIAN_RUG_PHOTOS=Object.freeze({persian:{file:'persian-vase-carpet.jpg',color:'#8d343b'},'persian-polonaise':{file:'persian-polonaise.jpg',color:'#a66c4d'},'persian-medallion':{file:'persian-medallion.jpg',color:'#b1996d'},'persian-czartoryski':{file:'persian-czartoryski.jpg',color:'#8f7950'}});
// One cached local photograph per rug variant. Failure keeps the woven procedural material.
// Loading never changes scene data, catalog IDs, dimensions or takeoff quantities.
export function createDetailedTextiles(refresh,loader=new T.TextureLoader()){
 const entries=new Map();let disposed=false;
 function entry(variant){if(!entries.has(variant))entries.set(variant,{texture:null,pending:null,failed:false});return entries.get(variant);}
 function start(state,preset){
  if(state.pending||state.failed||disposed)return;
  state.pending=loader.loadAsync('/realistic-assets/textiles/'+preset.file).then(t=>{
   if(disposed){t.dispose();return;}
   t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;t.anisotropy=4;t.needsUpdate=true;state.texture=t;refresh();
  }).catch(()=>{state.failed=true;});
 }
 return {apply(old,next){
  const preset=PERSIAN_RUG_PHOTOS[old.userData?.textileVariant];if(old.userData?.ventraTextile!=='rug'||!preset)return;
  const state=entry(old.userData.textileVariant);start(state,preset);const texture=state.texture;if(!texture||disposed)return;
  if(next.map!==texture){next.map=texture;next.needsUpdate=true;}
  next.userData.ventraPhotographicTextile=true;
  // Preserve the source photograph for the catalog color; other selected colors
  // tint it without replacing its small woven and floral details.
  const tint=new T.Color(old.userData.textileColor||preset.color),base=new T.Color(preset.color);
  const values=[tint.r/base.r,tint.g/base.g,tint.b/base.b],limit=Math.max(1,...values);
  next.color.setRGB(...values.map(n=>Math.min(1,n/limit)));next.roughness=.96;next.metalness=0;
 },ready:async()=>{let timer;try{await Promise.race([Promise.all([...entries.values()].map(e=>e.pending)),new Promise(resolve=>{timer=setTimeout(resolve,15000);})]);}finally{clearTimeout(timer);}},dispose(){disposed=true;for(const e of entries.values()){e.texture?.dispose();e.texture=null;}}};
}
