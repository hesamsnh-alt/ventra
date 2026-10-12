import {executePreviewJob} from '../../src/lib/serverPreviewJobs.js';
import {runBoqRequest} from '../../src/lib/serverBoqAnalysis.js';
import {runPreviewRequest} from '../../src/lib/serverPreviewAnalysis.js';
export default async function handler(request){
 const input=await request.json();
 await executePreviewJob(input,(request,action)=>action==='boq'?runBoqRequest(request):runPreviewRequest(request));
}
export const config={background:true};
