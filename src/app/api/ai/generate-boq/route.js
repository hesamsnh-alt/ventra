import {runBoqRequest} from '@/lib/serverBoqAnalysis';
import {startPreviewJob} from '@/lib/serverPreviewJobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){
 return (process.env.NETLIFY==='true'||(process.env.SITE_ID&&process.env.URL)) ? startPreviewJob(request,'boq') : runBoqRequest(request);
}
