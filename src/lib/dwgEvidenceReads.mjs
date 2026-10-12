export async function readDwgEvidencePair(read,{timeoutMs=60000}={}){
 const controller=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error('DWG schedule review timed out. Geometry is available separately; schedule quantities remain unverified.');e.name='AbortError';controller.abort();reject(e);},timeoutMs);});
 try{return await Promise.race([Promise.all([read(controller.signal),read(controller.signal)]),deadline]);}
 finally{clearTimeout(timer);controller.abort();}
}
