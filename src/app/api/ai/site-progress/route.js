import sharp from 'sharp';
import {commercialRun} from '@/lib/serverCommercial';
import {getOpenAIClient} from '@/services/openaiClient';
import {renderFailure} from '@/lib/renderFailure.mjs';
import {validateSiteProgressInput,normalizeSiteAssessment,SITE_PROGRESS_SCHEMA,SITE_PROGRESS_INSTRUCTIONS} from '@/lib/siteProgress.mjs';
export const runtime='nodejs';
export const maxDuration=120;
async function analyze(request){
 try{
  const input=validateSiteProgressInput(await request.json());
  const images=[];
  for(const image of input.images){
   const bytes=await sharp(Buffer.from(image.split(',')[1],'base64'),{limitInputPixels:16000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
   images.push(`data:image/jpeg;base64,${bytes.toString('base64')}`);
  }
  const response=await getOpenAIClient().responses.create({model:process.env.OPENAI_SITE_PROGRESS_MODEL||process.env.OPENAI_3D_PREVIEW_MODEL||'gpt-5.6-sol',max_output_tokens:2500,input:[{role:'system',content:SITE_PROGRESS_INSTRUCTIONS},{role:'user',content:[{type:'input_text',text:JSON.stringify({...input,images:undefined})},...images.map(image_url=>({type:'input_image',image_url,detail:'high'}))]}],text:{format:{type:'json_schema',name:'ventra_site_progress',strict:true,schema:SITE_PROGRESS_SCHEMA}}},{signal:request.signal,timeout:100000,maxRetries:0});
  if(response.status==='incomplete'||!response.output_text)throw Object.assign(new Error('Site photo review did not complete.'),{status:502});
  const assessment=normalizeSiteAssessment(JSON.parse(response.output_text),input);
  return Response.json({success:true,assessment:{...assessment,assessedAt:new Date().toISOString()}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error.code==='SITE_PROGRESS_INPUT')return Response.json({error:error.message,code:error.code},{status:400});
  const failure=renderFailure(error);
  return Response.json({...failure.body,error:failure.body.code==='RENDER_PROVIDER_FAILED'?'Site photo analysis failed. No progress was recorded.':failure.body.error},{status:failure.status});
 }
}
export async function POST(request){return commercialRun(request,'drawing',analyze);}
