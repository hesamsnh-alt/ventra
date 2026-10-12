// Canonical OSS identifiers only: never let request text become an OAuth scope.
export function decodeApsUrn(encoded) {
 const value=String(encoded||'').replace(/^urn:/,'');
 if(!/^[A-Za-z0-9_-]{20,4096}$/.test(value))throw Object.assign(new Error('Invalid APS model identifier.'),{status:400});
 const decoded=Buffer.from(value,'base64url').toString('utf8');
 if(Buffer.from(decoded).toString('base64url')!==value||!/^urn:adsk\.objects:os\.object:[a-z0-9_]+\/.+/.test(decoded)||/[\s\u0000-\u001f]/.test(decoded))throw Object.assign(new Error('Invalid APS model identifier.'),{status:400});
 const oss=decoded.match(/^urn:adsk\.objects:os\.object:([a-z0-9_]+)\/(.+)$/);
 // APS returns object keys with encoded path separators (%2F). Decode only
 // the key once for ownership parsing; preserve the exact resource for OAuth.
 let objectKey;
 try{objectKey=decodeURIComponent(oss[2]);}catch{throw Object.assign(new Error('Invalid APS object key encoding.'),{status:400});}
 if(/[\u0000-\u001f\u007f]/.test(objectKey))throw Object.assign(new Error('Invalid APS object key.'),{status:400});
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const match=objectKey.match(new RegExp(`^(${uuid})/(${uuid})/(${uuid})-.+`,'i'));
 return {urn:value,resource:decoded,bucket:oss[1],ownerId:match?.[1]||null,projectId:match?.[2]||null};
}
