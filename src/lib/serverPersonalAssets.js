import 'server-only';
import sharp from 'sharp';
import {glbFurnitureDimensions} from './glbModelBounds.mjs';
import {createHash} from 'node:crypto';
import {account} from './serverBilling';
import {commercialAdmin,commercialContext} from './serverCommercial';
import {validProjectId} from './commercialAccess.mjs';
import {PERSONAL_ASSET_BUCKET,validAssetId,personalDimensions,PERSONAL_FURNITURE_TYPES,validatePersonalGlb} from './personalAssets.mjs';
import {meshyFurnitureProvider,modelGenerationConfig,downloadMeshyGlb} from './meshyFurniture.mjs';
export const assetFailure=(message,status=503,code='PERSONAL_ASSET_ERROR')=>Object.assign(new Error(message),{status,code});
const check=result=>{if(result.error)throw assetFailure('Personal library storage is unavailable. / ذخیره‌سازی کتابخانه در دسترس نیست.');return result.data;};
export async function personalAssetAccount(request){return {user:await account(request),db:commercialAdmin()};}
export async function personalProjectAccess(db,user,projectId,write=false){
 if(!validProjectId(projectId))throw assetFailure('Invalid project.',400);
 const project=check(await db.from('projects').select('user_id').eq('id',projectId).maybeSingle());
 if(!project)throw assetFailure('Project access denied.',403);
 if(project.user_id!==user.id){const member=check(await db.from('ventra_project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).maybeSingle());if(!(write?['manager','supervisor']:['manager','supervisor','viewer']).includes(member?.role))throw assetFailure('Project access denied.',403);}
}
async function ensurePrivate(db){const bucket=check(await db.storage.getBucket(PERSONAL_ASSET_BUCKET));if(!bucket||bucket.public)throw assetFailure('Private model storage is not configured.',503,'ASSET_STORAGE_NOT_CONFIGURED');}
export async function readAssetBody(request){
 const raw=await request.text();if(raw.length>3*1024*1024)throw assetFailure('Upload exceeds 2 MB. / تصویر را کوچک‌تر کن.',413);
 try{return JSON.parse(raw);}catch{throw assetFailure('Invalid upload.',400);}
}
export async function normalizedAssetImage(imageUrl,{material=false}={}){
 const m=typeof imageUrl==='string'&&imageUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
 if(!m)throw assetFailure('Choose a PNG, JPG or WebP image. / تصویر PNG یا JPG یا WebP انتخاب کن.',400);
 const bytes=Buffer.from(m[2],'base64');if(bytes.length>2*1024*1024)throw assetFailure('Image exceeds 2 MB.',413);
 try{
  const input=sharp(bytes,{limitInputPixels:24000000}),meta=await input.metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1||meta.width<32||meta.height<32)throw Error();
  const buffer=await input.rotate().resize({width:material?1024:1536,height:material?1024:1536,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})[material?'png':'jpeg'](material?{compressionLevel:9}:{quality:88}).toBuffer();
  return {buffer,mime:material?'image/png':'image/jpeg',dataUrl:`data:image/jpeg;base64,${buffer.toString('base64')}`};
 }catch{throw assetFailure('Image could not be decoded. Use a still image up to 24 megapixels. / تصویر ثابت و قابل خواندن انتخاب کن.',400);}
}
export function assetDetails(body){
 const name=String(body.name||'Personal model').trim().slice(0,100);if(!name)throw assetFailure('A name is required.',400);
 const furniture_type=body.furniture_type||'sofa';if(!PERSONAL_FURNITURE_TYPES.includes(furniture_type))throw assetFailure('Invalid furniture type.',400);
 let dims;try{dims=personalDimensions(body);}catch(e){throw assetFailure(e.message,400);}return {name,furniture_type,...dims};
}
async function signed(db,asset,preview=false){
 const path=`${asset.user_id}/${asset.id}/${asset.kind==='material'?'texture.png':preview?'preview.jpg':'model.glb'}`;
 const {data,error}=await db.storage.from(PERSONAL_ASSET_BUCKET).createSignedUrl(path,3600);
 return error?null:data?.signedUrl;
}
export async function libraryList(request){
 const {db,user}=await personalAssetAccount(request);await ensurePrivate(db);
 const assets=check(await db.from('ventra_personal_assets').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100));
 const jobs=check(await db.from('ventra_model_jobs').select('id,status,progress,name,error,created_at,credits').eq('user_id',user.id).in('status',['submitting','pending','unknown','failed']).order('created_at',{ascending:false}).limit(10));
 return {assets:await Promise.all(assets.map(async row=>({...row,thumbnailUrl:await signed(db,row,true)}))),jobs,configuration:modelGenerationConfig()};
}
export async function libraryAsset(request,assetId,projectId){
 if(!validAssetId(assetId))throw assetFailure('Invalid asset ID.',400);
 const{db,user}=await personalAssetAccount(request);
 const row=check(await db.from('ventra_personal_assets').select('*').eq('id',assetId).maybeSingle());
 if(!row)throw assetFailure('Model not found.',404);
 if(row.user_id!==user.id){await personalProjectAccess(db,user,projectId);const link=check(await db.from('ventra_project_asset_links').select('asset_id').eq('project_id',projectId).eq('asset_id',assetId).maybeSingle());if(!link)throw assetFailure('Asset access denied.',403);}
 const url=await signed(db,row);if(!url)throw assetFailure('Model file is unavailable.');return {asset:row,url};
}
export async function linkLibraryAsset(request,body){
 const{db,user}=await personalAssetAccount(request);await personalProjectAccess(db,user,body.projectId,true);
 if(!validAssetId(body.assetId))throw assetFailure('Invalid asset.',400);
 const asset=check(await db.from('ventra_personal_assets').select('id,user_id').eq('id',body.assetId).maybeSingle());
 if(!asset||asset.user_id!==user.id)throw assetFailure('Use a model from your personal library.',403);
 check(await db.from('ventra_project_asset_links').upsert({project_id:body.projectId,asset_id:body.assetId},{onConflict:'project_id,asset_id'}));return {success:true};
}
export async function uploadLibraryMaterial(request,body){
 const{db,user}=await personalAssetAccount(request);await personalProjectAccess(db,user,body.projectId,true);await ensurePrivate(db);
 const {name}=assetDetails(body),image=await normalizedAssetImage(body.imageUrl,{material:true}),id=crypto.randomUUID();
 const path=`${user.id}/${id}/texture.png`;
 check(await db.storage.from(PERSONAL_ASSET_BUCKET).upload(path,image.buffer,{contentType:'image/png',upsert:false}));
 const row={id,user_id:user.id,kind:'material',name,mime:'image/png'};
 try{check(await db.from('ventra_personal_assets').insert(row));}catch(e){await db.storage.from(PERSONAL_ASSET_BUCKET).remove([path]);throw e;}
 return {asset:{...row,thumbnailUrl:await signed(db,row)}};
}
export async function editLibraryAsset(request,body){
 const{db,user}=await personalAssetAccount(request);if(!validAssetId(body.assetId))throw assetFailure('Invalid asset.',400);
 const details=assetDetails(body);const rows=check(await db.from('ventra_personal_assets').update(details).eq('id',body.assetId).eq('user_id',user.id).select('id'));
 if(!rows?.length)throw assetFailure('Asset not found.',404);return {success:true};
}
export async function startFurnitureModel(request,body){
 const user=await account(request),context=await commercialContext(request,body.projectId,user),{db}=context;
 const config=modelGenerationConfig();if(!config.configured)throw assetFailure('Image-to-3D needs the operator’s Meshy API key and activation. / تولید مدل از عکس به کلید و فعال‌سازی Meshy نیاز دارد.',503,'MODEL_NOT_CONFIGURED');
 await ensurePrivate(db);const image=await normalizedAssetImage(body.imageUrl),details=assetDetails(body);
 const hash=createHash('sha256').update(config.model).update(image.buffer).digest('hex');
 const result=await db.rpc('ventra_claim_model_job',{p_user:user.id,p_project:body.projectId,p_hash:hash,p_name:details.name,p_type:details.furniture_type,p_width:details.width,p_depth:details.depth,p_height:details.height,p_limit:config.dailyLimit,p_global_limit:config.globalDailyLimit});
 if(result.error)throw assetFailure(result.error.code==='P0001'?result.error.message:'Model queue is unavailable.',result.error.code==='P0001'?429:503,'MODEL_QUEUE_BLOCKED');
 const{job,created}=result.data;if(!created)return {job};
 try{
  check(await db.storage.from(PERSONAL_ASSET_BUCKET).upload(`${user.id}/${job.id}/preview.jpg`,image.buffer,{contentType:'image/jpeg',upsert:false}));
 }catch(e){await db.from('ventra_model_jobs').update({status:'failed',error:'Source image could not be saved.'}).eq('id',job.id);throw e;}
 let providerId;
 try{providerId=await meshyFurnitureProvider({key:process.env.MESHY_API_KEY}).create(image.dataUrl);}
 catch(e){const status=e.code==='MODEL_SUBMISSION_UNKNOWN'?'unknown':'failed';await db.from('ventra_model_jobs').update({status,error:e.message.slice(0,500)}).eq('id',job.id);throw e;}
 // Do not retry the paid POST if this durable write or its response fails.
 const saved=await db.from('ventra_model_jobs').update({provider_id:providerId,status:'pending'}).eq('id',job.id);
 if(saved.error){console.error('[VENTRA MODEL RECOVERY]',{jobId:job.id,providerId});throw assetFailure('Model submitted; its queue record needs operator recovery. Do not submit again.',503,'MODEL_SUBMISSION_UNKNOWN');}
 return {job:{...job,provider_id:undefined,status:'pending',progress:0}};
}
async function validateModelTextures(bytes,doc){
 if((doc.images?.length||0)>16)throw assetFailure('Model has too many textures.',422);
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),jsonLength=v.getUint32(12,true),binStart=20+jsonLength+8;
 let pixels=0;for(const img of doc.images||[]){const b=doc.bufferViews?.[img.bufferView];if(!b)throw assetFailure('Invalid embedded texture.',422);
 const data=bytes.subarray(binStart+(b.byteOffset||0),binStart+(b.byteOffset||0)+b.byteLength);
 const meta=await sharp(data,{limitInputPixels:16777216}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.width>4096||meta.height>4096||meta.pages>1)throw assetFailure('Unsupported texture.',422);pixels+=meta.width*meta.height;
 }if(pixels>64000000)throw assetFailure('Model textures exceed the memory budget.',422);
}
export async function pollFurnitureModel(request,jobId){
 const{db,user}=await personalAssetAccount(request);if(!validAssetId(jobId))throw assetFailure('Invalid job.',400);
 const job=check(await db.from('ventra_model_jobs').select('*').eq('id',jobId).eq('user_id',user.id).maybeSingle());if(!job)throw assetFailure('Job not found.',404);
 if(job.status==='submitting'&&Date.now()-Date.parse(job.created_at)>90000){await db.from('ventra_model_jobs').update({status:'unknown',error:'Submission needs operator reconciliation; no automatic re-submission.'}).eq('id',job.id).eq('status','submitting');return {job:{...job,status:'unknown'}};}
 if(job.status!=='pending'||!job.provider_id)return {job:{...job,provider_id:undefined}};
 const task=await meshyFurnitureProvider({key:process.env.MESHY_API_KEY}).get(job.provider_id);
 if(['FAILED','CANCELED'].includes(task.status)){check(await db.from('ventra_model_jobs').update({status:'failed',error:'Model service could not build this image.'}).eq('id',job.id));return {job:{id:job.id,name:job.name,status:'failed',error:'Model generation failed. / تولید مدل ناموفق بود.'}};}
 if(task.status!=='SUCCEEDED'){const progress=Math.max(0,Math.min(99,Number(task.progress)||0));check(await db.from('ventra_model_jobs').update({progress}).eq('id',job.id));return {job:{id:job.id,name:job.name,status:'pending',progress}};}
 try{
  const bytes=await downloadMeshyGlb(task.model_urls?.glb),doc=validatePersonalGlb(bytes);await validateModelTextures(bytes,doc);
  check(await db.storage.from(PERSONAL_ASSET_BUCKET).upload(`${user.id}/${job.id}/model.glb`,bytes,{contentType:'model/gltf-binary',upsert:true}));
  const row={id:job.id,user_id:user.id,kind:'model',name:job.name,furniture_type:job.furniture_type,...glbFurnitureDimensions(doc),mime:'model/gltf-binary'};
  check(await db.from('ventra_personal_assets').upsert(row,{onConflict:'id'}));
  check(await db.from('ventra_model_jobs').update({status:'ready',progress:100,credits:Number(task.consumed_credits)||null}).eq('id',job.id));
  return {job:{id:job.id,name:job.name,status:'ready',progress:100},asset:row};
 }catch(e){if(e.status===422||/GLB|embedded|complex|accessor|buffer|extensions|animation/.test(e.message)){await db.from('ventra_model_jobs').update({status:'failed',error:'Generated GLB could not be safely loaded; do not generate again without review.'}).eq('id',job.id);throw assetFailure('Generated model is unsupported. / مدل تولیدشده با نمایشگر سازگار نیست.',422);}throw e;}
}

// Direct, private GLB upload: the binary bypasses serverless request-body limits.
export async function beginLibraryGlbUpload(request,body){
 const{db,user}=await personalAssetAccount(request);await personalProjectAccess(db,user,body.projectId,true);await ensurePrivate(db);
 if(!Number.isSafeInteger(body.size)||body.size<20||body.size>25*1024*1024)throw assetFailure('Choose a GLB up to 25 MB. / فایل GLB تا ۲۵ مگابایت انتخاب کن.',413);
 const owned=check(await db.from('ventra_personal_assets').select('id').eq('user_id',user.id).limit(100));if(owned.length>=100)throw assetFailure('Personal library limit reached.',429);
 const assetId=crypto.randomUUID(),path=`${user.id}/${assetId}/model.glb`;
 const data=check(await db.storage.from(PERSONAL_ASSET_BUCKET).createSignedUploadUrl(path,{upsert:false}));
 if(!data?.signedUrl)throw assetFailure('Model upload could not start.');return{assetId,uploadUrl:data.signedUrl};
}
export async function finishLibraryGlbUpload(request,body){
 const{db,user}=await personalAssetAccount(request);await personalProjectAccess(db,user,body.projectId,true);await ensurePrivate(db);
 if(!validAssetId(body.assetId))throw assetFailure('Invalid upload.',400);
 const existing=check(await db.from('ventra_personal_assets').select('*').eq('id',body.assetId).maybeSingle());
 if(existing){if(existing.user_id!==user.id)throw assetFailure('Asset access denied.',403);return{asset:existing};}
 const details=assetDetails({...body,furniture_type:body.furniture_type||'cabinet'}),path=`${user.id}/${body.assetId}/model.glb`;
 const file=check(await db.storage.from(PERSONAL_ASSET_BUCKET).download(path));if(!file||file.size>25*1024*1024)throw assetFailure('Model file is missing or too large.',413);
 let dimensions;try{const bytes=new Uint8Array(await file.arrayBuffer()),doc=validatePersonalGlb(bytes);await validateModelTextures(bytes,doc);dimensions=glbFurnitureDimensions(doc);}catch{
  await db.storage.from(PERSONAL_ASSET_BUCKET).remove([path]);throw assetFailure('Unsupported GLB. Export a static mesh with embedded textures, without Draco compression, up to 25 MB. / فایل GLB ایستا، با بافت داخلی و بدون فشرده‌سازی Draco خروجی بگیر.',422);
 }
 const row={id:body.assetId,user_id:user.id,kind:'model',...details,...dimensions,mime:'model/gltf-binary'};
 // A failed database write leaves the private file intact so finalization can be retried.
 check(await db.from('ventra_personal_assets').upsert(row,{onConflict:'id'}));return{asset:row};
}
