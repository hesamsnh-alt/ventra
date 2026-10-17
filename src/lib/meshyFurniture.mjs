export const MESHY_FURNITURE_MODEL='meshy-6-lite';
const fail=(message,status=502,code='MODEL_PROVIDER_ERROR')=>Object.assign(new Error(message),{status,code});
export function modelGenerationConfig(env=process.env){
 const bounded=(value,fallback,max)=>Number.isInteger(Number(value))&&Number(value)>0?Math.min(Number(value),max):fallback;
 return {configured:!!env.MESHY_API_KEY&&env.MESHY_GENERATION_ENABLED==='true',dailyLimit:bounded(env.MESHY_DAILY_LIMIT,2,10),globalDailyLimit:bounded(env.MESHY_GLOBAL_DAILY_LIMIT,10,100),model:MESHY_FURNITURE_MODEL};
}
export function meshyFurnitureProvider({key,fetcher=fetch}={}){
 async function request(path,options){
  if(!key)throw fail('Image-to-3D is not configured. / تولید مدل از عکس هنوز تنظیم نشده است.',503,'MODEL_NOT_CONFIGURED');
  let r;try{r=await fetcher('https://api.meshy.ai/openapi/v1/image-to-3d'+path,{...options,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),redirect:'error'});}catch{throw fail('Provider response is uncertain. This request will not be submitted again automatically. / پاسخ سرویس نامشخص است؛ درخواست دوباره ارسال نمی‌شود.',502,'MODEL_SUBMISSION_UNKNOWN');}
  if(!r.ok)throw fail(r.status===402?'Meshy API credit is required. / اعتبار API سرویس Meshy کافی نیست.':r.status===401?'Meshy API key is invalid. / کلید Meshy معتبر نیست.':r.status===429?'Meshy is busy. Check this request later. / سرویس موقتاً محدود است.':'The model service rejected this request. / سرویس تولید مدل درخواست را نپذیرفت.',r.status===429?429:502,'MODEL_PROVIDER_REJECTED');
  try{return await r.json();}catch{throw fail('Provider response could not be read. / پاسخ سرویس خوانده نشد.',502,'MODEL_SUBMISSION_UNKNOWN');}
 }
 return {create:async imageUrl=>{
  const result=await request('',{method:'POST',body:JSON.stringify({image_url:imageUrl,ai_model:MESHY_FURNITURE_MODEL,model_type:'standard',should_texture:true,enable_pbr:true,texture_resolution:'2k',should_remesh:true,topology:'triangle',target_polycount:15000})});
  if(typeof result.result!=='string'||!result.result||result.result.length>200)throw fail('Provider task ID was not returned. / شناسه تولید دریافت نشد.',502,'MODEL_SUBMISSION_UNKNOWN');
  return result.result;
 },get:id=>request('/'+encodeURIComponent(id),{method:'GET'})};
}
export async function downloadMeshyGlb(url,fetcher=fetch,maxBytes=25*1024*1024){
 let parsed;try{parsed=new URL(url);}catch{throw fail('No GLB was returned.');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||!(parsed.hostname==='meshy.ai'||parsed.hostname.endsWith('.meshy.ai')))throw fail('Unexpected model download host.');
 const response=await fetcher(parsed,{signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!response.ok||Number(response.headers.get('content-length'))>maxBytes)throw fail('Model download failed or exceeds 25 MB.');
 const reader=response.body?.getReader();if(!reader)throw fail('Empty model download.');
 const chunks=[];let size=0;try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw fail('Generated model exceeds 25 MB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;
}
