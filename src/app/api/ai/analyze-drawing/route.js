import {runDrawingRequest} from '@/lib/serverDrawingAnalysis';
import {drawingUsesBackground,startDrawingJob,readDrawingJob} from '@/lib/serverDrawingJobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){
 if(drawingUsesBackground()&&new URL(request.url).searchParams.has('documentId'))return readDrawingJob(request);
 return Response.json({success:true,message:'Ventra drawing analysis API is running.'},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request){return drawingUsesBackground()?startDrawingJob(request):runDrawingRequest(request);}
