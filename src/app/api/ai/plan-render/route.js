import {renderFailure} from '@/lib/renderFailure.mjs';
import {commercialRun} from '@/lib/serverCommercial';
import {getOpenAIClient} from '@/services/openaiClient';
import {toFile} from 'openai';
import sharp from 'sharp';
import {validateRenderInput} from '@/lib/planRender.mjs';
import {generateReviewedRender} from '@/lib/planRenderReview.mjs';
export const runtime='nodejs';
export const maxDuration=300;
async function render(request) {
 try {
  const body=validateRenderInput(await request.json());
  const encoded=body.imageUrl.split(',')[1];
  let bytes;
  try {bytes=await sharp(Buffer.from(encoded,'base64'),{limitInputPixels:24000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();}
  catch {return Response.json({success:false,error:'The plan image could not be decoded.'},{status:400});}
  const client=getOpenAIClient();
  const controller=new AbortController();
  const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});
  if(request.signal.aborted)abort();
  const timer=setTimeout(abort,270000);
  try {
   const source={...body,imageUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`};
   const payload=await generateReviewedRender(source,{create:client.responses.create.bind(client.responses),edit:client.images.edit.bind(client.images),image:await toFile(bytes,'plan.jpg',{type:'image/jpeg'}),model:process.env.OPENAI_PLAN_RENDER_MODEL||'chatgpt-image-latest',reviewModel:process.env.OPENAI_PLAN_REVIEW_MODEL||process.env.OPENAI_3D_PREVIEW_MODEL||'gpt-5.6-sol',signal:controller.signal});
   return Response.json(payload);
  } finally {clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
 } catch(error) {
  const failure=renderFailure(error);
  console.warn('[VENTRA RENDER FAILED]',{code:failure.body.code,stage:failure.body.stage,status:failure.status});
  return Response.json(failure.body,{status:failure.status,headers:failure.body.retryAfterSeconds?{'Retry-After':String(failure.body.retryAfterSeconds)}:{}});
 }
}
// Existing authenticated project access and analysis quota; no new schema.
export function POST(request){return commercialRun(request,'design',render);}
