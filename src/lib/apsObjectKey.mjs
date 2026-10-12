export function apsObjectKey(projectId,userId,nonce,fileName){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(projectId)||!uuid.test(userId)||!uuid.test(nonce))throw new Error('Invalid APS source identifier.');
 const name=String(fileName||'').replace(/[\\/\s\u0000-\u001f]/g,'_').slice(-200);if(!name)throw new Error('A source file name is required.');
 return `${userId}/${projectId}/${nonce}-${name}`;
}
