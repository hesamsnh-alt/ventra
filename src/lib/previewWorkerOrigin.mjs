// A preview request must not dispatch its worker to the published site's URL.
// Only this site's declared origins and Netlify-owned aliases are eligible.
export function previewWorkerOrigin(requestUrl,env={}){
 const parse=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u:null;}catch{return null;}};
 const declared=[env.DEPLOY_URL,env.DEPLOY_PRIME_URL,env.URL].map(parse).filter(Boolean);
 const requested=parse(requestUrl),siteHosts=declared.map(u=>u.hostname).filter(h=>h.endsWith('.netlify.app')).map(h=>h.split('--').at(-1));
 if(requested&&(declared.some(u=>u.origin===requested.origin)||siteHosts.some(host=>requested.hostname===host||requested.hostname.endsWith(`--${host}`))))return new URL(requested.origin);
 if(declared.length)return new URL(declared[0].origin);
 throw Object.assign(Error('Background analysis endpoint is not configured.'),{status:503});
}
