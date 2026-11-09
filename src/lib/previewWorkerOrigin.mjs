// Keep image-preview background execution on the deployment that accepted it.
// Never send a preview's job authorization to the production origin.
export function previewWorkerOrigin(requestUrl,env={}){
 const parse=value=>{try{
  const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url:null;
 }catch{return null;}};
 const requested=parse(requestUrl);
 const declared=[env.DEPLOY_URL,env.DEPLOY_PRIME_URL,env.URL].map(parse).filter(Boolean);
 const siteHosts=declared.map(url=>url.hostname).filter(host=>host.endsWith('.netlify.app')).map(host=>host.split('--').at(-1));
 const exact=declared.some(url=>url.origin===requested?.origin);
 const sameNetlifySite=requested&&siteHosts.some(site=>requested.hostname===site||requested.hostname.endsWith(`--${site}`));
 if(requested&&(exact||sameNetlifySite))return new URL(requested.origin);
 throw Object.assign(Error('Image preview deployment origin does not match the configured site. No background AI request was made.'),{status:503,code:'PREVIEW_ORIGIN_MISMATCH'});
}
