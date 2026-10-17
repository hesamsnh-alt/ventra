import {validatePersonalGlb,MAX_PERSONAL_GLB_BYTES} from '@/lib/personalAssets.mjs';
import {commercialHeaders} from '@/lib/commercialFetch';
async function api(path,options={}){
 const response=await fetch(path,{...options,headers:await commercialHeaders(options.headers)});
 let payload;try{payload=await response.json();}catch{throw new Error('Library response could not be read. / پاسخ کتابخانه خوانده نشد.');}
 if(!response.ok)throw Object.assign(new Error(payload.error||'Personal library is unavailable.'),{code:payload.code,status:response.status});return payload;
}
const send=(path,body,method='POST')=>api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const loadPersonalLibrary=()=>api('/api/personal-assets');
export const createFurnitureFromPhoto=body=>send('/api/ai/furniture-model',body);
export const pollPersonalModel=jobId=>api('/api/ai/furniture-model?jobId='+encodeURIComponent(jobId));
export const uploadPersonalMaterial=body=>send('/api/personal-assets',body);
export const savePersonalAssetDetails=body=>send('/api/personal-assets',body,'PATCH');
export const linkPersonalAsset=(projectId,assetId)=>send('/api/personal-assets',{action:'link',projectId,assetId});
export const getPersonalAssetUrl=async(assetId,projectId)=>{
 const result=await api('/api/personal-assets?assetId='+encodeURIComponent(assetId)+(projectId?'&projectId='+encodeURIComponent(projectId):''),{signal:AbortSignal.timeout(20000)});return result.url;
};
export async function preparePersonalPhoto(file){
 if(file&&/\.zip$/i.test(file.name))throw new Error('Extract the ZIP first, then select the JPG, PNG or WebP texture. / اول ZIP را اکسترکت کن و عکس JPG، PNG یا WebP داخلش را انتخاب کن.');
 if(!file||!(['image/png','image/jpeg','image/jpg','image/webp','image/avif'].includes(file.type)||(!file.type&&/\.(png|jpe?g|webp|avif)$/i.test(file.name)))||file.size>12*1024*1024)throw new Error('Choose PNG, JPG or WebP up to 12 MB. / عکس PNG یا JPG یا WebP تا ۱۲ مگابایت انتخاب کن.');
 const bitmap=await createImageBitmap(file);try{
 if(bitmap.width*bitmap.height>24000000||bitmap.width<32||bitmap.height<32)throw new Error('Use an image between 32 pixels and 24 megapixels.');
 const scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable.');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 let result=canvas.toDataURL('image/jpeg',.88);if(result.length>2700000)result=canvas.toDataURL('image/jpeg',.65);if(result.length>2700000)throw new Error('Image is too large. / تصویر بیش از حد بزرگ است.');return result;
 }finally{bitmap.close();}
}

export async function uploadPersonalGlb({file,projectId}){
 if(!file||!file.name.toLowerCase().endsWith('.glb')||file.size>MAX_PERSONAL_GLB_BYTES)throw Error('Choose a GLB up to 25 MB. / فایل GLB تا ۲۵ مگابایت انتخاب کن.');
 const bytes=await file.arrayBuffer();validatePersonalGlb(bytes);
 const started=await send('/api/personal-assets',{action:'begin-glb',projectId,size:file.size});
 const response=await fetch(started.uploadUrl,{method:'PUT',headers:{'Content-Type':'model/gltf-binary','cache-control':'max-age=3600'},body:bytes});
 if(!response.ok)throw Error('GLB upload failed. / آپلود مدل ناموفق بود.');
 return send('/api/personal-assets',{action:'finish-glb',projectId,assetId:started.assetId,name:file.name.replace(/\.glb$/i,'').slice(0,100),furniture_type:'cabinet'});
}
