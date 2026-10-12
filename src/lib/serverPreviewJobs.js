import 'server-only';
import {previewImageFingerprint} from './serverPreviewAnalysis';
import {createHash,randomBytes} from 'node:crypto';
import {commercialContext,commercialAdmin,commercialError} from './serverCommercial';
import {account,billingError} from './serverBilling';
const table='ventra_preview_jobs';
export const nonceHash=value=>createHash('sha256').update(value).digest('hex');
export async function startPreviewJob(request,action='preview'){
 let db,id;
 try{
  const user=await account(request),raw=await request.text();
  if(raw.length>12*1024*1024)throw billingError('Analysis request exceeds 12 MB.',413);
  if(!['preview','boq'].includes(action))throw billingError('Invalid analysis action.',400);
  const body=JSON.parse(raw),context=await commercialContext(request,body.projectId,user);db=context.db;
  // Recover the exact same image for the same actor/project before reserving AI
  // usage. The fingerprint is computed from source bytes, never supplied by UI.
  if(action==='preview'&&body.mode==='schematic_analyze'){
   const fingerprint=await previewImageFingerprint(body.imageUrl);
   const prior=await db.from(table).select('result').eq('actor_id',user.id).eq('project_id',body.projectId).eq('status','completed').eq('result->diagnostics->>imageHash',fingerprint.hash).eq('result->>routeVersion',fingerprint.version).gte('created_at',new Date(Date.now()-60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(prior.error)throw billingError('Background analysis storage is unavailable.',503);
   if(prior.data?.result?.scene)return Response.json({...prior.data.result,recovered:true},{headers:{'Cache-Control':'no-store'}});
  }
  const origin=new URL(process.env.DEPLOY_URL||process.env.URL||'');
  if(origin.protocol!=='https:')throw billingError('Background analysis endpoint is not configured.',503);
  const digest=nonceHash(`${user.id}:${raw}`);
  id=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;const nonce=randomBytes(32).toString('hex');
  const {error}=await db.from(table).insert({id,actor_id:user.id,project_id:body.projectId,status:'queued',nonce_hash:nonceHash(nonce),request_body:{...body,__backgroundAction:action}});
  if(error?.code==='23505')return Response.json({jobId:id,status:'queued'},{status:202,headers:{'Cache-Control':'no-store'}});
  if(error)throw billingError('Background analysis storage is unavailable. Install the v89 SQL migration.',503);
  const queued=await fetch(new URL('/.netlify/functions/preview-background',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,nonce,authorization:request.headers.get('authorization')}),signal:AbortSignal.timeout(15000)});
  if(queued.status!==202)throw billingError('Could not start background analysis. Check the Netlify function deployment.',503);
  return Response.json({jobId:id,status:'queued'},{status:202,headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(db&&id)await db.from(table).update({status:'failed',result:{error:error.message,code:'PREVIEW_QUEUE_FAILED'},http_status:503,request_body:null,nonce_hash:null}).eq('id',id).eq('status','queued');
  return commercialError(error);
 }
}
export async function readPreviewJob(request){
 try{
  const user=await account(request),id=new URL(request.url).searchParams.get('jobId');
  if(!/^[a-f0-9-]{36}$/i.test(id||''))throw billingError('Invalid analysis job ID.',400);
  const {data,error}=await commercialAdmin().from(table).select('id,status,result,http_status,created_at').eq('id',id).eq('actor_id',user.id).maybeSingle();
  if(error)throw billingError('Background analysis storage is unavailable.',503);
  if(!data)throw billingError('Analysis job unavailable.',404);
  if(['queued','running'].includes(data.status)&&Date.now()-Date.parse(data.created_at)>16*60*1000)return Response.json({error:'Background analysis timed out. Retry the analysis.',code:'PREVIEW_JOB_TIMEOUT'},{status:504});
  if(['completed','failed'].includes(data.status))return Response.json(data.result||{error:'Analysis failed.'},{status:data.http_status||500,headers:{'Cache-Control':'no-store'}});
  return Response.json({jobId:id,status:data.status},{status:202,headers:{'Cache-Control':'no-store'}});
 }catch(error){return commercialError(error);}
}
// Atomic queued -> running claim prevents Netlify retries from charging/running twice.
export async function executePreviewJob(input,run){
 if(!/^[a-f0-9-]{36}$/i.test(input?.id||'')||!/^\w{64}$/.test(input?.nonce||'')||!/^Bearer .+$/.test(input?.authorization||''))return;
 const db=commercialAdmin(),{data:job,error}=await db.from(table).update({status:'running'}).eq('id',input.id).eq('status','queued').eq('nonce_hash',nonceHash(input.nonce)).select('request_body,actor_id').maybeSingle();
 if(error)throw error;if(!job)return;
 let result,httpStatus=500;
 try{
  const {__backgroundAction='preview',...body}=job.request_body;
  if(!['preview','boq'].includes(__backgroundAction))throw billingError('Invalid analysis action.',400);
  const request=new Request(`https://ventra.internal/api/ai/${__backgroundAction==='boq'?'generate-boq':'design-3d-preview'}`,{method:'POST',headers:{authorization:input.authorization,'content-type':'application/json'},body:JSON.stringify(body)});
  const user=await account(request);if(user.id!==job.actor_id)throw billingError('Analysis job access denied.',403);
  const response=await run(request,__backgroundAction);httpStatus=response.status;result=await response.json();
 }catch(error){result={error:error.status?error.message:'Background analysis failed. Retry or contact support.',code:'PREVIEW_BACKGROUND_FAILED'};httpStatus=error.status||500;}
 const saved=await db.from(table).update({status:httpStatus<400?'completed':'failed',http_status:httpStatus,result,request_body:null,nonce_hash:null,updated_at:new Date().toISOString()}).eq('id',input.id).eq('status','running');
 if(saved.error)throw saved.error;
}
