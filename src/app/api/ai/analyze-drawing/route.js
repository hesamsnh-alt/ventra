import {runDrawingRequest} from '@/lib/serverDrawingAnalysis';
import {drawingUsesBackground,startDrawingJob,readDrawingJob,readLocalDrawingJob,runLocalDrawingJob} from '@/lib/serverDrawingJobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){
 if(drawingUsesBackground()&&new URL(request.url).searchParams.has('documentId'))return readDrawingJob(request);
 if(new URL(request.url).searchParams.has('documentId'))return readLocalDrawingJob(request);
 return Response.json({success:true,message:'Ventra drawing analysis API is running.'},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request){return drawingUsesBackground()?startDrawingJob(request):runLocalDrawingJob(request,runDrawingRequest);}
