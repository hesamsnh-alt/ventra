import {commercialRun} from '@/lib/serverCommercial';
import {getOpenAIClient} from '@/services/openaiClient';
import {reconcileDwgReads} from '@/lib/dwgSchedule.mjs';
import sharp from 'sharp';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const str={type:'string'},confidence={type:'number',minimum:0,maximum:1};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const row=object({mark:str,quantity:{type:['integer','null'],minimum:0},quantityText:str,description:str,material:str,dimensions:str,quote:str,confidence});
const table=object({kind:{type:'string',enum:['door','window']},scope:str,quantityHeader:str,complete:{type:'boolean'},coversProject:{type:'boolean'},rows:{type:'array',maxItems:500,items:row}});
const specification=object({scope:{type:'string',enum:['wall','floor','roof','ceiling','door','window','paint','other']},location:str,material:str,quote:str,confidence});
const schema=object({tables:{type:'array',maxItems:20,items:table},specifications:{type:'array',maxItems:100,items:specification}});
async function handle(request) {
 try {
  const body=await request.json();const images=body.images||[body.image];
  if(!Array.isArray(images)||!images.length||images.length>4)throw new Error('Provide 1–4 clear drawing sheet or schedule/notes images.');
  const content=[];let totalBytes=0;
  for(const image of images) {
   if(typeof image!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(image))throw new Error('A clear PNG/JPG/WebP drawing image is required.');
   const buffer=Buffer.from(image.split(',')[1],'base64');totalBytes+=buffer.length;if(totalBytes>8*1024*1024)throw new Error('Drawing images exceed 8 MB total.');const meta=await sharp(buffer,{limitInputPixels:50000000}).metadata();
   if(!meta.width||!meta.height||Math.max(meta.width,meta.height)<1000)throw new Error('Drawing image is too small. Upload a readable schedule or notes crop.');
   content.push({type:'input_image',image_url:image,detail:'high'});
  }
  const prompt=`Read the supplied architectural DWG sheet screenshots/crops. Extract ONLY explicit door/window schedule rows and printed material/general/room-finish notes. Do not count symbols or infer quantities from geometry. For every schedule: identify its actual QTY/QUANTITY/COUNT header and transcribe the quantityText literally; quantity is null if that cell is absent, unreadable or ambiguous. NEVER use dimensions, marks, type IDs, COST or TOTAL as quantity. Exclude total/footer rows. Mark complete false if any real row or qty is unreadable. coversProject is true only for a clearly whole-project schedule, not a floor-only/subset/revision/example table. Duplicate/repeated schedule images describe one table, not additional quantities. Keep floor-scoped tables separate. Include row marks, description, explicit material and dimensions with their printed units; leave unspecified fields empty. quote must transcribe source text, not a justification. Capture both framed-wall specifications and masonry if both exist; do not infer timber from the word framing alone. For floor finishes, record each room/location label and printed finish (hardwood/tile etc.), never estimate its area. Confidence reflects legibility, not general model confidence. Return empty arrays for absent evidence. All results remain subject to review. Explicit CAD text hints (corroboration only): ${JSON.stringify((body.records||[]).slice(0,100)).slice(0,40000)}`;
  const openai=getOpenAIClient();
  const read=async()=>{
   const response=await openai.responses.create({model:process.env.OPENAI_DRAWING_MODEL||'gpt-5',input:[{role:'user',content:[{type:'input_text',text:prompt},...content]}],text:{format:{type:'json_schema',name:'dwg_schedule_and_material_evidence',strict:true,schema}},max_output_tokens:16000});
   if(!response.output_text)throw new Error('No structured drawing evidence was returned.');
   return JSON.parse(response.output_text);
  };
  const first=await read(),second=await read();
  return Response.json({success:true,evidence:{...reconcileDwgReads(first,second),sourceUrn:body.urn||null}});
 }catch(error){return Response.json({success:false,error:error.message||'Drawing evidence extraction failed.'},{status:422});}
}
export async function POST(request){return commercialRun(request,'drawing',handle);}
