export const PLAN_MODEL_MAX_BYTES=40*1024*1024;

export function inspectPlanGlb(buffer){
 const error='Choose a valid GLB 2.0 with embedded resources. / یک فایل GLB 2.0 با منابع داخلی انتخاب کن.';
 if(buffer.byteLength<20||buffer.byteLength>PLAN_MODEL_MAX_BYTES)throw Error(error);
 const view=new DataView(buffer);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error(error);
 const length=view.getUint32(12,true);
 if(length===0||length>buffer.byteLength-20||length%4!==0)throw Error(error);
 let manifest;
 try{manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));}catch{throw Error(error);}
 if(!Array.isArray(manifest?.meshes)||!manifest.meshes.length||!Array.isArray(manifest.scenes)||!manifest.scenes.length)throw Error(error);
 for(const field of ['buffers','images']){
  const resources=manifest[field]??[];
  if(!Array.isArray(resources)||resources.some(r=>typeof r?.uri==='string'&&!/^data:/i.test(r.uri)))throw Error(error);
 }
 if((manifest.extensionsRequired??[]).some(ext=>['KHR_draco_mesh_compression','KHR_texture_basisu','EXT_meshopt_compression'].includes(ext))){
  throw Error('Export an uncompressed GLB with PNG/JPG textures. / فایل GLB بدون فشرده‌سازی هندسه و با بافت PNG یا JPG بگیر.');
 }
 return manifest;
}
