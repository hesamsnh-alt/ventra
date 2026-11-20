import {validateDocument,visibleEntities} from './document.mjs';
import {exportDXF} from './export.mjs';
export function planProjectURL(projectId){
 if(typeof projectId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(projectId))throw Error('Choose a valid project. / یک پروژهٔ معتبر انتخاب کن.');
 return `/projects/${encodeURIComponent(projectId)}?tab=drawings`;
}
// Uses the existing authenticated document upload; never launches analysis or APS.
export async function transferPlanToProject({doc,projectId,format='jpg'}, {exportImage,upload,selectDocument,selectSource,now=Date.now}){
 const url=planProjectURL(projectId),snapshot=validateDocument(doc);
 if(!visibleEntities(snapshot).length)throw Error('Draw a plan before sending it. / ابتدا پلان را ترسیم کن.');
 if(!['jpg','dxf'].includes(format))throw Error('Unsupported drawing format.');
 const blob=format==='jpg'?await exportImage(snapshot,{forAnalysis:true}):new Blob([exportDXF(snapshot)],{type:'application/dxf'});
 if(!blob?.size||blob.size>100*1024*1024)throw Error('Drawing must be non-empty and smaller than 100 MB.');
 const stem=(snapshot.name||'Ventra-plan').replace(/[^\p{L}\p{N}_-]/gu,'-').slice(0,70)||'Ventra-plan';
 const file=new File([blob],`${stem}-PlanStudio-${now()}.${format}`,{type:format==='jpg'?'image/jpeg':'application/dxf'});
 return saveProjectDrawing({projectId,file,source:format==='jpg'?'schematic':'aps',url},{upload,selectDocument,selectSource});
}
export const APS_PLAN_FILE_TYPES=['dwg','ifc','rvt'];
export async function openProjectCadFile({projectId,file}, services){
 const type=file?.name?.split('.').at(-1)?.toLowerCase();
 if(!APS_PLAN_FILE_TYPES.includes(type)||!file.size||file.size>100*1024*1024)
  throw Error('Choose a non-empty DWG, IFC or RVT up to 100 MB. / فایل DWG، IFC یا RVT تا ۱۰۰ مگابایت انتخاب کن.');
 return saveProjectDrawing({projectId,file,source:'aps',url:planProjectURL(projectId)},services);
}
async function saveProjectDrawing({projectId,file,source,url},{upload,selectDocument,selectSource}){
 const result=await upload({projectId,file,category:'drawing'});
 if(result?.error||!result?.document?.id)throw result?.error||Error('Upload could not be completed. / ارسال نقشه ناموفق بود.');
 if(result.document.project_id&&result.document.project_id!==projectId)throw Error('Uploaded drawing does not match the selected project.');
 let warning='';
 // A selection failure must not turn a successful upload into a duplicate retry.
 try{selectDocument(projectId,result.document.id);await selectSource(projectId,source);}catch(e){warning=e.message||'Select the new drawing in Drawings.';}
 return{document:result.document,url,warning};
}
