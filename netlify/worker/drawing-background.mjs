import {executeDrawingJob} from '../../src/lib/serverDrawingJobs.js';
import {runDrawingRequest} from '../../src/lib/serverDrawingAnalysis.js';
export default async function handler(request){await executeDrawingJob(await request.json(),runDrawingRequest);}
export const config={background:true};
