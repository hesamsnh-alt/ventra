import {operatorAllowance,isOperator} from './operatorAllowance.mjs';
import 'server-only';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {account,provider,customerFor,subscriptionFor} from './serverBilling';
import {subscriptionAccess,validProjectId} from './commercialAccess.mjs';
const fail=(message,status=503,code='COMMERCIAL_UNAVAILABLE')=>Object.assign(new Error(message),{status,code});
export function commercialAdmin(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw fail('Commercial services are not configured. Contact support.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function commercialContext(request,projectId,verifiedUser=null){
 const user=verifiedUser||await account(request);
 if(!validProjectId(projectId))throw fail('A valid project ID is required.',400,'PROJECT_REQUIRED');
 const db=commercialAdmin();
 const {data:project,error}=await db.from('projects').select('user_id').eq('id',projectId).maybeSingle();
 if(error)throw fail('Could not verify project access.');
 if(!project)throw fail('Project unavailable.',403,'PROJECT_ACCESS_DENIED');
 if(project.user_id!==user.id){
  const member=await db.from('ventra_project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).maybeSingle();
  if(member.error||!['manager','supervisor'].includes(member.data?.role))throw fail('You cannot run analysis for this project.',403,'PROJECT_ACCESS_DENIED');
 }
 if(isOperator(project.user_id,process.env)) return {user,db,owner:project.user_id,status:'operator',limit:operatorAllowance(project.user_id,0,process.env)};
 const stripe=provider(),customer=await customerFor(stripe,{id:project.user_id,email:project.user_id===user.id?user.email:undefined});
 const subscription=await subscriptionFor(stripe,customer);
 const access=subscriptionAccess(subscription,process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID);
 return {user,db,owner:project.user_id,...access,limit:operatorAllowance(project.user_id,access.limit,process.env)};
}
export function commercialError(error){return Response.json({success:false,error:error.status?error.message:'Commercial service unavailable. Try later.',code:error.code||'COMMERCIAL_UNAVAILABLE'},{status:error.status||503});}
const running=new Map(),done=new Map();
export async function commercialRun(request,action,handler){
 try{
  // Authenticate before reading a request containing potentially large image data.
  const user=await account(request);
  const raw=await request.clone().text();if(raw.length>12*1024*1024)throw fail('Analysis request exceeds 12 MB.',413,'REQUEST_TOO_LARGE');
  let body;try{body=JSON.parse(raw);}catch{throw fail('Invalid JSON request.',400,'BAD_REQUEST');}
  const context=await commercialContext(request,body.projectId,user);
  const digest=createHash('sha256').update(raw).digest('hex');
  const suppliedId=String(request.headers.get('x-ventra-request-id')||body.requestId||digest).slice(0,180);
  const key=`${user.id}:${action}:${suppliedId}:${digest}`;
  for(const [id,row] of done)if(row.until<Date.now())done.delete(id);
  if(done.has(key))return done.get(key).response.clone();
  if(running.has(key))return (await running.get(key)).clone();
  const task=(async()=>{
   if(action!=='boq'){
    if(!process.env.OPENAI_API_KEY)throw fail('AI analysis is not configured. Contact support.');
    if(!isOperator(context.owner,process.env)){
    const {data,error}=await context.db.rpc('ventra_consume_analysis',{p_owner:context.owner,p_actor:user.id,p_project:body.projectId,p_action:action,p_request:suppliedId,p_hash:digest,p_limit:context.limit});
    if(error)throw fail('Usage tracking is unavailable. Contact support.');
    if(!data?.accepted)throw fail(data?.duplicate?'This analysis was already submitted. Check the project result before retrying.':'Monthly analysis allowance reached. Open Billing.',data?.duplicate?409:429,data?.duplicate?'ANALYSIS_ALREADY_SUBMITTED':'ANALYSIS_LIMIT_REACHED');
    }
   }
   // Include user scope in legacy route-local cache identifiers.
   body.requestId=key;
   const headers=new Headers(request.headers);headers.set('x-ventra-request-id',key);headers.delete('content-length');
   const scoped=new Request(request.url,{method:'POST',headers,body:JSON.stringify(body),signal:request.signal});
   const response=await handler(scoped);
   if(response.ok){if(done.size>=50)done.delete(done.keys().next().value);done.set(key,{response:response.clone(),until:Date.now()+300000});}
   return response;
  })();
  running.set(key,task);try{return await task;}finally{if(running.get(key)===task)running.delete(key);}
 }catch(error){return commercialError(error);}
}
