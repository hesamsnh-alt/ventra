import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {getOpenAIClient} from '@/services/openaiClient';
import {requestRasterVision,consumeRasterVisionStream} from './rasterVisionRequest.mjs';
import {runPixelGraphPipeline} from './rasterGraphPipeline.mjs';
import {VERIFIED_PREVIEW_VERSION} from './verifiedPreview.mjs';
import {previewAIKeyStatus} from './previewAIConfig.mjs';

export async function runPixelGraphPreview(body){
  const diagnostics={transportAttempts:[],transport:{stage:'preparing_image'}},started=Date.now(),model=process.env.OPENAI_FLOORPLAN_GEOMETRY_MODEL||process.env.OPENAI_DRAWING_MODEL||'gpt-5.1';diagnostics.model=model;
  try{
    if(!body?.imageUrl)return NextResponse.json({error:'imageUrl is required.'},{status:400});
    const response=await fetch(body.imageUrl,{cache:'no-store',signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error(`Could not download source image (${response.status}).`);
    const buffer=await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).sharpen({sigma:.6}).jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
    let calls=0;
    const payload=await runPixelGraphPipeline({buffer,diagnostics,classify:async task=>{
      if(previewAIKeyStatus(process.env.OPENAI_API_KEY)!=='header_ready')throw Object.assign(Error('OpenAI is not configured with a usable key for this deploy. Set OPENAI_API_KEY securely in Netlify. No AI request was made.'),{code:'OPENAI_CREDENTIAL_CONFIGURATION',status:503});
      if(++calls>2)throw Error('Pixel graph classification budget exceeded.');
      const remaining=240000-(Date.now()-started);if(remaining<=0)throw Object.assign(Error('Image analysis exceeded its total time limit.'),{code:'RASTER_VISION_TIMEOUT'});
      const transport={stage:task.stage,attempt:calls};diagnostics.transport=transport;diagnostics.transportAttempts.push(transport);
      const result=await requestRasterVision((payload,options)=>consumeRasterVisionStream((p,o)=>getOpenAIClient().responses.create(p,o),payload,options,transport),{
        model,reasoning:{effort:'low'},max_output_tokens:16000,
        input:[{role:'user',content:[{type:'input_text',text:`${task.prompt}\nSOURCE DATA: ${JSON.stringify(task.data)}`},{type:'input_image',image_url:task.original,detail:'high'},{type:'input_image',image_url:task.image,detail:'high'},...(task.images||[]).map(image_url=>({type:'input_image',image_url,detail:'high'}))]}],
        text:{format:{type:'json_schema',name:task.stage,strict:true,schema:task.schema}},
      },remaining);
      if(result.status!=='completed'||!result.output_text)throw Object.assign(Error('No complete semantic classification was returned.'),{code:'RASTER_VISION_INCOMPLETE'});
      return JSON.parse(result.output_text);
    }});
    diagnostics.elapsedMs=Date.now()-started;return NextResponse.json(payload);
  }catch(error){
    diagnostics.elapsedMs=Date.now()-started;diagnostics.accepted=false;diagnostics.failure={code:error.code||'PIXEL_GRAPH_FAILED',message:error.message,details:error.details};
    return NextResponse.json({error:error.message,code:error.code||'PIXEL_GRAPH_FAILED',diagnostics,routeVersion:VERIFIED_PREVIEW_VERSION,needsManualReview:true},{status:error.code==='OPENAI_CREDENTIAL_CONFIGURATION'?503:error.code==='RASTER_VISION_TIMEOUT'?504:String(error.code||'').startsWith('RASTER_VISION_')?502:error.status===429?429:422});
  }
}
