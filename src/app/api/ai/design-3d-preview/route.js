import {runPreviewRequest} from '@/lib/serverPreviewAnalysis';
import {startPreviewJob,readPreviewJob} from '@/lib/serverPreviewJobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){
 return (process.env.NETLIFY==='true'||(process.env.SITE_ID&&process.env.URL)) ? startPreviewJob(request) : runPreviewRequest(request);
}
export async function GET(request){return readPreviewJob(request);}
