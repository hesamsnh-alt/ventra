export const COMMERCIAL_LIMITS={active:30,trialing:5};
export function subscriptionAccess(subscription,priceId){
 if(!priceId)throw Object.assign(new Error('The operator must configure the subscription price.'),{status:503});
 const eligible=subscription&&Object.hasOwn(COMMERCIAL_LIMITS,subscription.status)&&subscription.items?.data?.some(item=>item.price?.id===priceId);
 if(!eligible)throw Object.assign(new Error('An active Ventra subscription or trial is required. Open Billing.'),{status:402,code:'SUBSCRIPTION_REQUIRED'});
 return {status:subscription.status,limit:COMMERCIAL_LIMITS[subscription.status]};
}
export function validProjectId(id){return typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);}
export function snapshotKeys(projectId){return {boq:`ventra:project-boq:${projectId}`,estimate:`ventra:project-estimate:${projectId}`,quotation:`ventra:project-quotation:${projectId}`,branding:`ventra:document-branding:${projectId}`};}
export function validateSnapshot(payload,projectId){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid commercial snapshot.');
 if(JSON.stringify(payload).length>8*1024*1024)throw new Error('Snapshot exceeds 8 MB. Reduce logo or letterhead size.');
 for(const [kind,value] of Object.entries(payload)){
  if(!Object.hasOwn(snapshotKeys(projectId),kind))throw new Error('Unknown snapshot section.');
  if(value!==null&&(typeof value!=='object'||Array.isArray(value)))throw new Error('Invalid snapshot section.');
  if(value?.projectId&&value.projectId!==projectId)throw new Error('Snapshot belongs to another project.');
 }
 return payload;
}
