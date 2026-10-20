import 'server-only';
import {randomBytes} from 'node:crypto';
import {account,billingError} from './serverBilling';
import {commercialAdmin,commercialContext,commercialError} from './serverCommercial';
import {validProjectId} from './commercialAccess.mjs';
import {drawingJobId,drawingJobHash,completeDrawingResult} from './drawingJobIdentity.mjs';
import {withDrawingJob} from '@/services/drawingJobRuntime.mjs';
import {drawingCheckpointProgress,drawingProgressView} from './drawingProgress.mjs';
import {createLocalDrawingRegistry} from './localDrawingRegistry.mjs';
const localJobs=createLocalDrawingRegistry();
const table='ventra_preview_jobs',kind='drawing-v151';
const fields='id,actor_id,project_id,status,result,http_status,created_at,updated_at,request_body';
export const drawingUsesBackground=()=>process.env.NETLIFY==='true'||!!(process.env.SITE_ID&&process.env.URL);
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
function checked(result){if(result.error)throw billingError('Drawing job storage is unavailable.',503);return result.data;}
async function source(db,user,input){
 if(!validProjectId(input.projectId)||!validProjectId(input.documentId))throw billingError('A project and drawing document ID are required.',400);
 const project=checked(await db.from('projects').select('user_id').eq('id',input.projectId).maybeSingle());
 if(!project)throw billingError('Project unavailable.',403);
 if(project.user_id!==user.id){const member=checked(await db.from('ventra_project_members').select('role').eq('project_id',input.projectId).eq('user_id',user.id).maybeSingle());if(!['manager','supervisor'].includes(member?.role))throw billingError('Drawing access denied.',403);}
 const doc=checked(await db.from('project_documents').select('id,project_id,file_path,file_name,file_type,file_size,created_at').eq('id',input.documentId).eq('project_id',input.projectId).maybeSingle());
 if(!doc?.file_path)throw billingError('Drawing was deleted or is unavailable.',404);return doc;
}
function storedInput(doc,input){return {__kind:kind,projectId:doc.project_id,documentId:doc.id,filePath:doc.file_path,fileName:doc.file_name,fileType:doc.file_type||'application/octet-stream',resumeSourceMeasurementsOnly:input.resumeSourceMeasurementsOnly===true,localPdfRecoveryOnly:input.localPdfRecoveryOnly===true};}
function view(row){
 if(['completed','failed'].includes(row.status))return reply({...row.result,jobId:row.id,documentId:row.request_body.documentId,fileName:row.request_body.fileName},row.http_status||500);
 if(row.status==='queued'&&row.request_body.__dispatchUncertain)return reply({success:false,error:'Could not confirm background worker acceptance. The saved job was not resubmitted. Check drawing-background logs, then reopen analysis to recover its state.',code:'DRAWING_DISPATCH_UNKNOWN',jobId:row.id},409);
 if(Date.now()-Date.parse(row.created_at)>16*60*1000)return reply({success:false,error:'Drawing worker did not finish within its execution window. Saved checkpoints remain available; automatic restart is blocked to avoid duplicate API costs.',code:'DRAWING_JOB_OUTCOME_UNKNOWN',jobId:row.id},409);
 const record=row.request_body?.__checkpoint?.record;
 const progress=drawingProgressView({}, {...drawingCheckpointProgress(record),...(row.request_body.__progress||{}),stage:row.request_body.__stage||'queued',status:row.status,startedAt:Date.parse(row.created_at),updatedAt:Date.parse(row.updated_at||row.created_at)});
 return reply({success:true,jobId:row.id,status:row.status,fileName:row.request_body.fileName,progress},202);
}
function localView(job){
 if(job.status!=='running')return reply({...job.payload,jobId:job.id,documentId:job.documentId,fileName:job.fileName},job.httpStatus);
 if(Date.now()-job.startedAt>18*60*1000)return reply({success:false,jobId:job.id,code:'DRAWING_JOB_OUTCOME_UNKNOWN',error:'Local analysis is taking longer than expected. Automatic restart is blocked; check saved results before submitting again.'},409);
 return reply({success:true,jobId:job.id,status:'running',fileName:job.fileName,progress:drawingProgressView({}, {...job.progress,status:'running',startedAt:job.startedAt,updatedAt:job.updatedAt})},202);
}
export async function readLocalDrawingJob(request){try{
 const user=await account(request),db=commercialAdmin(),url=new URL(request.url),input={projectId:url.searchParams.get('projectId'),documentId:url.searchParams.get('documentId'),resumeSourceMeasurementsOnly:url.searchParams.get('resumeSourceMeasurementsOnly')==='true',localPdfRecoveryOnly:url.searchParams.get('localPdfRecoveryOnly')==='true'};
 const doc=await source(db,user,input),id=drawingJobId(user.id,doc,input,process.env.OPENAI_DRAWING_MODEL||'gpt-5'),sourceKey=drawingJobId(user.id,doc,{},process.env.OPENAI_DRAWING_MODEL||'gpt-5');
 const requested=url.searchParams.get('jobId'),specific=requested?localJobs.get(requested):null;
 if(requested&&(!specific||specific.sourceKey!==sourceKey))throw billingError('Drawing job unavailable.',403);
 const job=specific||localJobs.active(sourceKey)||localJobs.get(id);
 if(job?.status==='failed'&&job.payload?.code!=='DRAWING_ANALYSIS_OUTCOME_UNKNOWN'&&!requested&&url.searchParams.get('recover')!=='true')return reply({success:true,status:'not_started'});
 return job?localView(job):reply({success:true,status:'not_started'});
}catch(error){return commercialError(error);}}
export async function runLocalDrawingJob(request,run){try{
 const user=await account(request),input=await request.clone().json(),db=commercialAdmin(),doc=await source(db,user,input);
 // Full and source-only requests cannot run concurrently for the same source.
 const sourceKey=drawingJobId(user.id,doc,{},process.env.OPENAI_DRAWING_MODEL||'gpt-5'),id=drawingJobId(user.id,doc,input,process.env.OPENAI_DRAWING_MODEL||'gpt-5'),claim=localJobs.claim(id,doc.id,doc.file_name,sourceKey);
 if(!claim.claimed)return localView(claim.job);
 const job=claim.job;
 try{
  const response=await withDrawingJob({progress:p=>localJobs.update(job,drawingProgressView(job.progress,p))},()=>run(request));
  const payload=await response.clone().json();localJobs.finish(job,payload,response.status);return response;
 }catch(error){localJobs.finish(job,{success:false,error:'Local analysis response unavailable. Check saved work before starting another analysis.',code:'DRAWING_ANALYSIS_OUTCOME_UNKNOWN'},503);throw error;}
}catch(error){return commercialError(error);}}
async function find(db,id,user){const row=checked(await db.from(table).select(fields).eq('id',id).eq('actor_id',user.id).maybeSingle());if(row&&row.request_body?.__kind!==kind)throw billingError('Drawing job unavailable.',404);return row;}
export async function readDrawingJob(request){try{
 const user=await account(request),db=commercialAdmin(),url=new URL(request.url),input={projectId:url.searchParams.get('projectId'),documentId:url.searchParams.get('documentId'),resumeSourceMeasurementsOnly:url.searchParams.get('resumeSourceMeasurementsOnly')==='true',localPdfRecoveryOnly:url.searchParams.get('localPdfRecoveryOnly')==='true'};
 const doc=await source(db,user,input),id=drawingJobId(user.id,doc,input,process.env.OPENAI_DRAWING_MODEL||'gpt-5');
 const row=await find(db,id,user);return row?view(row):reply({success:true,status:'not_started'});
 }catch(error){return commercialError(error);}}
export async function startDrawingJob(request){try{
 const user=await account(request),raw=await request.text();if(raw.length>64*1024)throw billingError('Drawing job request is too large.',413);
 let input;try{input=JSON.parse(raw);}catch{throw billingError('Invalid JSON.',400);}
 const db=commercialAdmin(),doc=await source(db,user,input),id=drawingJobId(user.id,doc,input,process.env.OPENAI_DRAWING_MODEL||'gpt-5');
 const existing=await find(db,id,user);if(existing)return view(existing);
 await commercialContext(request,doc.project_id,user);
 let origin;try{origin=new URL(process.env.DEPLOY_URL||process.env.URL||'');}catch{throw billingError('Background worker origin is not configured.',503);}
 if(origin.protocol!=='https:')throw billingError('Background worker requires HTTPS.',503);
 const body=storedInput(doc,input);
 if(body.resumeSourceMeasurementsOnly||body.localPdfRecoveryOnly){
  const base=await find(db,drawingJobId(user.id,doc,{},process.env.OPENAI_DRAWING_MODEL||'gpt-5'),user);
  const resumed=body.localPdfRecoveryOnly?await find(db,drawingJobId(user.id,doc,{resumeSourceMeasurementsOnly:true},process.env.OPENAI_DRAWING_MODEL||'gpt-5'),user):null;
  const checkpoint=[base,resumed].map(r=>r?.request_body?.__checkpoint).filter(Boolean).sort((a,b)=>
   Number(b.record?.review?.status==='completed')-Number(a.record?.review?.status==='completed')||
   (b.record?.pages?.length||0)-(a.record?.pages?.length||0)||
   Number(b.record?.source_basis?.status==='completed')-Number(a.record?.source_basis?.status==='completed'))[0];
  if(checkpoint)body.__checkpoint=checkpoint;
 }
 const nonce=randomBytes(32).toString('hex');
 const insert=await db.from(table).insert({id,actor_id:user.id,project_id:doc.project_id,status:'queued',nonce_hash:drawingJobHash(nonce),request_body:body});
 if(insert.error?.code==='23505'){const prior=await find(db,id,user);if(!prior)throw billingError('Drawing job unavailable.',503);return view(prior);}
 checked(insert);
 // Dispatch can time out after acceptance. Never recreate/replay the job on an ambiguous response.
 let uncertain=false;
 try{const response=await fetch(new URL('/.netlify/functions/drawing-background',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,nonce,authorization:request.headers.get('authorization')}),signal:AbortSignal.timeout(8000)});if(response.status!==202){uncertain=true;console.warn('[Drawing job] Dispatch response uncertain',{id,status:response.status});}}
 catch{uncertain=true;console.warn('[Drawing job] Dispatch outcome unknown; job retained without automatic replay',{id});}
 if(uncertain){checked(await db.from(table).update({request_body:{...body,__dispatchUncertain:true}}).eq('id',id).eq('status','queued'));return view(await find(db,id,user));}
 return reply({success:true,jobId:id,status:'queued',fileName:doc.file_name},202);
 }catch(error){return commercialError(error);}}
export async function executeDrawingJob(input,run){
 if(!validProjectId(input?.id)||!/^[a-f0-9]{64}$/.test(input?.nonce||'')||!/^Bearer .+$/.test(input?.authorization||''))return;
 const db=commercialAdmin(),job=checked(await db.from(table).update({status:'running',updated_at:new Date().toISOString()}).eq('id',input.id).eq('status','queued').eq('request_body->>__kind',kind).eq('nonce_hash',drawingJobHash(input.nonce)).select(fields).maybeSingle());
 if(!job)return;
 let body=structuredClone(job.request_body),result,httpStatus=500;
 async function saveBody(){const changed=checked(await db.from(table).update({request_body:body,updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','running').select('id').maybeSingle());if(!changed)throw billingError('Drawing job checkpoint could not be confirmed.',503);}
 try{
  const authRequest=new Request('https://ventra.internal',{headers:{authorization:input.authorization}}),user=await account(authRequest);
  if(user.id!==job.actor_id)throw billingError('Drawing job access denied.',403);
  const doc=await source(db,user,body);if(doc.file_path!==body.filePath)throw billingError('Drawing source changed.',409);
  const signed=checked(await db.storage.from('project-files').createSignedUrl(doc.file_path,3600));if(!signed?.signedUrl)throw billingError('Could not sign drawing URL.',503);
  const request=new Request('https://ventra.internal/api/ai/analyze-drawing',{method:'POST',headers:{authorization:input.authorization,'content-type':'application/json','X-Ventra-Request-Id':job.id},body:JSON.stringify({projectId:job.project_id,documentId:doc.id,fileUrl:signed.signedUrl,fileName:doc.file_name,fileType:doc.file_type||'application/octet-stream',requestId:job.id,resumeSourceMeasurementsOnly:body.resumeSourceMeasurementsOnly,localPdfRecoveryOnly:body.localPdfRecoveryOnly,noAutomaticRetries:true})});
  body.__stage='reading_source';await saveBody();
  const context={deadline:Date.now()+13*60*1000,
   progress:async p=>{body.__progress={...(body.__progress||{}),...p};body.__stage=p.stage||body.__stage;await saveBody();},
   read:async key=>body.__checkpoint?.key===key?structuredClone(body.__checkpoint.record):null,
   write:async(key,record)=>{if(Buffer.byteLength(JSON.stringify(record))>8*1024*1024)throw billingError('Drawing checkpoint exceeds safe storage size.',413);body.__checkpoint={key,record:structuredClone(record)};body.__progress=drawingCheckpointProgress(record);body.__stage=record.source_basis?'source_measurements':record.review?'source_measurements':record.pages?.length>=record.totalPages?'cross_page_review':'pages';await saveBody();return true;}};
  const response=await withDrawingJob(context,()=>run(request));httpStatus=response.status;result=await response.json();
  if(response.ok&&result.result)result.result={...result.result,analysis_source:{document_id:doc.id,file_name:doc.file_name,job_id:job.id,transport:'background-v151'}};
  if(response.ok&&!completeDrawingResult(result.result)){httpStatus=409;result={success:false,error:'Drawing analysis is incomplete. Saved page evidence was retained; no new BOQ was published. Automatic rerun is blocked. Check the server log before resuming.',code:'DRAWING_JOB_INCOMPLETE',partialResult:result.result};}
 }catch(error){httpStatus=error.status||503;result={success:false,error:error.status?error.message:'Drawing background worker failed. Saved evidence retained; automatic rerun is blocked.',code:error.code||'DRAWING_BACKGROUND_FAILED'};}
 if(Buffer.byteLength(JSON.stringify(result))>5*1024*1024){httpStatus=413;result={success:false,error:'Drawing report exceeds the response limit. Saved checkpoints retained; request server-side export before retrying.',code:'DRAWING_REPORT_TOO_LARGE'};}
 // Retain server-only checkpoints for source-only recovery. No signed URLs or access tokens are stored.
 body.__stage=httpStatus<400?'completed':'failed';
 const saved=await db.from(table).update({status:httpStatus<400?'completed':'failed',http_status:httpStatus,result,request_body:body,nonce_hash:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','running');
 if(saved.error)throw Error('Drawing result persistence failed; retry is claim-protected.');
}
