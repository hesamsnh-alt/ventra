// One checked image load per asset/project, shared across all painted faces.
// Never persist a signed URL or image bytes in the scene document.
export function createPersonalTextureResources({getUrl,fetcher=(...a)=>fetch(...a),decode=blob=>createImageBitmap(blob),now=()=>Date.now()}={}){
 const cache=new Map();
 return {load(assetId,projectId){
  const key=JSON.stringify([projectId||'',assetId]),old=cache.get(key);if(old&&old.until>now())return old.promise;
  const promise=(async()=>{
   const url=await getUrl(assetId,projectId);if(typeof url!=='string'||!url)throw Error('Texture URL is missing. / آدرس تصویر متریال دریافت نشد.');
   let response;try{response=await fetcher(url,{mode:'cors',signal:AbortSignal.timeout(20000)});}catch{throw Error('Texture image could not be downloaded. Check your network. / تصویر متریال دانلود نشد؛ اتصال شبکه را بررسی کن.');}
   if(!response.ok)throw Error(`Texture download failed (HTTP ${response.status}). / دریافت تصویر متریال ناموفق بود (${response.status}).`);
   const blob=await response.blob();if(!blob.size||blob.size>8*1024*1024)throw Error('Texture image is empty or too large.');
   let image;try{image=await decode(blob);}catch{throw Error('Texture could not be decoded. / تصویر متریال قابل خواندن نیست.');}
   if(!image.width||!image.height||image.width*image.height>16777216){image.close?.();throw Error('Texture dimensions exceed the display limit.');}
   return {image,width:image.width,height:image.height};
  })();
  const entry={promise,until:now()+120000};cache.set(key,entry);
  promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
  // Dropping the promise lets the browser collect older decoded images once
  // their pending draw callbacks have finished; active textures own canvases.
  while(cache.size>8)cache.delete(cache.keys().next().value);
  return promise;
 }};
}
const shared=createPersonalTextureResources({getUrl:async(...args)=>(await import('../services/personalAssetService.js')).getPersonalAssetUrl(...args)});
export const loadPersonalTexture=(assetId,projectId)=>shared.load(assetId,projectId);
