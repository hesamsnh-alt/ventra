const endpoint='/api/ai/design-3d-preview';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Store only the job ID. Images and access tokens are never persisted here.
export async function runPreviewAnalysis(start,{key,fetcher,storage,delay=wait,maxPolls=480,onProgress=()=>{}}){
 const cacheKey=`ventra:preview-job:${key}`;
 let id;try{id=storage?.getItem(cacheKey);}catch{}
 let response;
 if(!id){
  response=await start();if(response.status!==202)return response;
  const payload=await response.json();id=payload.jobId;
  if(!/^[a-f0-9-]{36}$/i.test(id||''))throw new Error('Analysis server returned an invalid job ID.');
  try{storage?.setItem(cacheKey,id);}catch{}
 }
 for(let i=0;i<maxPolls;i++){
  onProgress({stage:'background_analysis',jobId:id});
  await delay(2000);
  response=await fetcher(`${endpoint}?jobId=${encodeURIComponent(id)}`,{cache:'no-store'});
  if(response.status===202)continue;
  // A transient service outage leaves the ID available for the next retry.
  if([502,503].includes(response.status))continue;
  try{storage?.removeItem(cacheKey);}catch{}
  return response;
 }
 throw new Error('Analysis is still pending. Retry to check the same job; do not upload again.');
}
