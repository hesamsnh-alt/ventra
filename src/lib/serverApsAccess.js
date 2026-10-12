import 'server-only';
import {account,billingError} from './serverBilling';
import {commercialAdmin} from './serverCommercial';
import {decodeApsUrn} from './apsModelIdentity.mjs';
export async function apsModelAccess(request,encoded,expectedProject=null) {
 const user=await account(request),model=decodeApsUrn(encoded),db=commercialAdmin();
 const expectedBucket=String(process.env.APS_BUCKET_KEY||`ventra_${process.env.APS_CLIENT_ID||''}`).toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'').slice(0,120);
 if(!expectedBucket||model.bucket!==expectedBucket)throw billingError('APS model access denied.',403);
 let projectId=model.projectId;
 if(!projectId){
  // Old unscoped uploads require an operator-reviewed server mapping. A client
  // cannot register an arbitrary URN by saving it into its own project state.
  let legacy;try{legacy=JSON.parse(process.env.VENTRA_LEGACY_APS_MODELS||'{}');}catch{throw billingError('Legacy APS configuration is invalid.',503);}
  projectId=Object.hasOwn(legacy,model.urn)?legacy[model.urn]:null;
  if(!projectId)throw billingError('This older CAD model needs an operator ownership mapping or a new upload.',403);
 }
 if(expectedProject&&projectId!==expectedProject)throw billingError('APS model belongs to another project.',403);
 const {data,error}=await db.from('projects').select('user_id').eq('id',projectId).maybeSingle();
 if(error)throw billingError('Could not verify APS model access.',503);
 if(!data||(model.ownerId&&data.user_id!==model.ownerId))throw billingError('APS model access denied.',403);
 if(user.id!==data.user_id){
  const membership=await db.from('ventra_project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).maybeSingle();
  if(membership.error||!['manager','supervisor','viewer'].includes(membership.data?.role))throw billingError('APS model access denied.',403);
 }
 return {...model,projectId,user,ownerId:data.user_id};
}
