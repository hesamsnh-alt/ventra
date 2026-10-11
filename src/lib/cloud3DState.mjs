// Cloud files are scoped to an authenticated project owner by the server.
export async function writeCloud3DState(projectId,kind,value){
 if(typeof window==='undefined')return;
 const {commercialFetch}=await import('./commercialFetch.js');
 try{
  const response=await commercialFetch('/api/project-3d-state',{method:'PUT',signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(15000):undefined,headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,kind,value})});
  if(!response.ok){const data=await response.json();throw new Error(data.error||'3D cloud save failed.');}
 }catch(error){window.dispatchEvent(new CustomEvent('ventra:3d-cloud-error',{detail:{projectId,message:error.message}}));}
}
export async function restoreCloud3DState(projectId){
 const {commercialFetch}=await import('./commercialFetch.js');
 const response=await commercialFetch(`/api/project-3d-state?projectId=${encodeURIComponent(projectId)}`,{cache:'no-store',signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(15000):undefined});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load cloud 3D state.');
 return data;
}
