import {commercialRun} from '@/lib/serverCommercial';
import {getOpenAIClient} from '@/services/openaiClient';
import {planScenePrompt} from '@/lib/scenePromptPlanner.mjs';

export const runtime='nodejs';
export const maxDuration=90;

async function edit(request){
 try{
  const body=await request.json();
  const prompt=String(body.prompt||'').trim();
  if(!prompt||prompt.length>4000)return Response.json({error:'Write a prompt of up to 4000 characters.'},{status:400});
  if(JSON.stringify(body.scene||{}).length>2*1024*1024)return Response.json({error:'This scene is too large to edit.'},{status:413});
  const result=await planScenePrompt({scene:body.scene,prompt,language:body.language,model:process.env.OPENAI_SCENE_EDIT_MODEL||process.env.OPENAI_DESIGN_MODEL||'gpt-5.1',requestAI:(payload,options)=>getOpenAIClient().responses.create(payload,options),signal:request.signal});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const known=String(error.code||'').startsWith('SCENE_EDIT_');
  const timeout=error.name==='APIConnectionTimeoutError'||error.name==='AbortError';
  return Response.json({error:known?error.message:timeout?'3D prompt timed out; no changes were saved. / زمان ویرایش تمام شد؛ مدل تغییر نکرد.':'AI editing failed; no changes were saved. Check the API configuration or try again. / ویرایش هوش مصنوعی ناموفق بود؛ مدل تغییر نکرد.',code:known?error.code:timeout?'SCENE_EDIT_TIMEOUT':'SCENE_EDIT_PROVIDER_FAILED'},{status:known?error.status||422:timeout?504:error.status===429?429:502});
 }
}
export async function POST(request){return commercialRun(request,'design',edit);}
