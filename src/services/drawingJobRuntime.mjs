import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage();
export const currentDrawingJob=()=>scope.getStore();
export const withDrawingJob=(context,work)=>scope.run(context,work);
export function drawingOpenAIOptions(){
 const ctx=currentDrawingJob();if(!ctx)return null;
 return {maxRetries:0,timeout:240000,fetch:async(url,init={})=>{
  const remaining=ctx.deadline-Date.now();
  if(remaining<2000)throw Object.assign(Error('Drawing worker time budget reached; saved evidence retained. No automatic restart.'),{code:'DRAWING_WORKER_BUDGET',status:503});
  const limit=AbortSignal.timeout(Math.min(240000,remaining));
  return fetch(url,{...init,signal:init.signal?AbortSignal.any([init.signal,limit]):limit});
 }};
}
