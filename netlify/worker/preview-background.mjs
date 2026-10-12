import {executePreviewJob} from '../../src/lib/serverPreviewJobs.js';
import {runPreviewRequest} from '../../src/lib/serverPreviewAnalysis.js';
export default async function handler(request){
 const input=await request.json();
 await executePreviewJob(input,runPreviewRequest);
}
export const config={background:true};
