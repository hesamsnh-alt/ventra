const endpoint = '/api/ai/analyze-drawing';

function connectionError(message, code, cause, requestId) {
  return Object.assign(new Error(message, {cause}), {code, requestId});
}

// GET is an existing, read-only health check. Never replay an analysis POST:
// a missing response does not tell us whether the server already ran the model.
export async function submitDrawingAnalysis(options, fetchRequest, {onProgress=null,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,maxWaitMs=18*60*1000}={}) {
  const requestId = new Headers(options.headers).get('X-Ventra-Request-Id') || '';
  let input;try{input=JSON.parse(options.body||'{}');}catch{input={};}
  const lookup=new URLSearchParams();
  if(input.documentId){for(const key of ['projectId','documentId','resumeSourceMeasurementsOnly','localPdfRecoveryOnly'])if(input[key]!==undefined)lookup.set(key,String(input[key]));}
  const statusUrl=lookup.size?`${endpoint}?${lookup}`:endpoint;
  async function poll(response,payload){
    const started=now();let delay=2500;
    while(response.status===202){
      if(typeof onProgress==='function')try{onProgress(payload);}catch{}
      if(now()-started>maxWaitMs)throw connectionError(`The drawing job is still saved on the server. Reopen analysis to recover its status; do not upload the drawing again. Job: ${payload.jobId}`,'DRAWING_JOB_WAIT_INTERRUPTED',null,requestId);
      await wait(delay);delay=Math.min(8000,delay+1000);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const next=await fetchRequest(statusUrl,{method:'GET',cache:'no-store',headers:options.headers,signal:controller.signal});
        if(next.status>=500)continue; // GET only: safe to retry; never replay the POST.
        const data=await next.json();
        if(next.ok&&!data.jobId)throw connectionError('Saved drawing job could not be located; automatic resubmission is blocked.','DRAWING_JOB_LOOKUP_LOST',null,requestId);
        response=next;payload=data;
      }catch(error){if(error.code==='DRAWING_JOB_LOOKUP_LOST')throw error;}
      finally{clearTimeout(timer);}
    }
    return {response,payload};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let recovered=null;
  try {
    const health = await fetchRequest(statusUrl, {
      method: 'GET', cache: 'no-store', headers: lookup.size?options.headers:{Accept: 'application/json'}, signal: controller.signal,
    });
    const payload = await health.json();
    if(payload.jobId)recovered={response:health,payload};
    else if (!health.ok || payload?.success !== true) throw new Error('Analysis endpoint unavailable.');
  } catch (cause) {
    throw connectionError('Cannot reach the drawing analysis service. No analysis POST was sent. Keep the dev server running and check the service connection before trying again.',
      'DRAWING_CONNECTION_CHECK_FAILED', cause, requestId);
  } finally {
    clearTimeout(timer);
  }
  if(recovered)return poll(recovered.response,recovered.payload);

  let response;
  try {
    response = await fetchRequest(endpoint, options);
  } catch (cause) {
    throw connectionError(`Connection lost while submitting analysis. The server outcome is unknown; the request was not retried automatically. Check the server log and saved PDF report before submitting again. Request: ${requestId}`,
      'DRAWING_ANALYSIS_OUTCOME_UNKNOWN', cause, requestId);
  }
  try {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if(response.status===202){if(!payload.jobId||!lookup.size)throw Error('Missing drawing job identity');return await poll(response,payload);}
    return {response, payload};
  } catch (cause) {
    if(cause.code?.startsWith('DRAWING_JOB_'))throw cause;
    throw connectionError(`Could not read the analysis response (HTTP ${response.status}). The result is unknown; the request was not retried automatically. Check the server log and saved PDF report before submitting again. Request: ${requestId}`,
      'DRAWING_ANALYSIS_RESPONSE_UNREADABLE', cause, requestId);
  }
}
