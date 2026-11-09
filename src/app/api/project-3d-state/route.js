import {apsModelAccess} from '@/lib/serverApsAccess';
import {account,billingError} from '@/lib/serverBilling';
import {commercialAdmin,commercialError} from '@/lib/serverCommercial';
import {validProjectId} from '@/lib/commercialAccess.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function access(request,projectId,write=false){
 const user=await account(request);if(!validProjectId(projectId))throw billingError('Invalid project ID.',400);
 const db=commercialAdmin(),{data,error}=await db.from('projects').select('user_id').eq('id',projectId).maybeSingle();
 if(error)throw billingError('Project access is unavailable.',503);
 if(!data)throw billingError('Project access denied.',403);
 if(data.user_id!==user.id){
  const member=await db.from('ventra_project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).maybeSingle();
  const allowed=write?['manager','supervisor']:['manager','supervisor','viewer'];
  if(member.error||!allowed.includes(member.data?.role))throw billingError('Project access denied.',403);
 }
 return {db,path:`${data.user_id}/${projectId}/ventra-3d-state`};
}
export async function GET(request){
 try{const {db,path}=await access(request,new URL(request.url).searchParams.get('projectId'));
 const requestedKind=new URL(request.url).searchParams.get('kind');
 if(requestedKind&&!['schematic','engineering','selection','render'].includes(requestedKind))throw billingError('Invalid 3D state kind.',400);
 const result={};for(const kind of requestedKind?[requestedKind]:['schematic','engineering','selection']){
  const {data,error}=await db.storage.from('project-files').download(`${path}/${kind}.json`);
  if(error){if([400,404].includes(Number(error.statusCode||error.status))&&/not found|does not exist/i.test(error.message))continue;throw billingError('Cloud 3D storage is unavailable.',503);}
  result[kind]=JSON.parse(await data.text());
 }return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return commercialError(error);}
}
export async function PUT(request){
 try{await account(request);const raw=await request.text();if(raw.length>8*1024*1024)throw billingError('3D cloud state exceeds 8 MB.',413);
 const {projectId,kind,value}=JSON.parse(raw);if(!['schematic','engineering','selection','render'].includes(kind)||!value||typeof value!=='object')throw billingError('Invalid 3D state.',400);
 if(kind==='selection'&&!['aps','schematic','dwg-interior'].includes(value.source))throw billingError('Invalid source.',400);
 const {db,path}=await access(request,projectId,true);
 if(kind==='schematic'&&!(Number(value.width)>0&&Number(value.depth)>0&&Array.isArray(value.rooms)))throw billingError('Invalid schematic.',400);
 if(kind==='render'&&(value.kind!=='concept_render'||value.pipelineVersion!==47||value.layoutReview?.method!=='ai_visual_comparison'||!/^data:image\/jpeg;base64,/.test(value.imageUrl||'')))throw billingError('Invalid reviewed render.',400);
 if(kind==='engineering'){const urn=value.aps_urn||value.apsUrn||value.urn||value.advanced_takeoff?.aps_urn||value.raw_result?.aps_urn;if(urn)await apsModelAccess(request,urn,projectId);}
 const {error}=await db.storage.from('project-files').upload(`${path}/${kind}.json`,JSON.stringify(value),{contentType:'application/json',upsert:true});
 if(error)throw billingError('Could not save 3D cloud state.',503);return Response.json({success:true});
 }catch(error){return commercialError(error);}
}
