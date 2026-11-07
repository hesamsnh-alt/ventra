import {completeDXFEnvelope} from './dxfEnvelope.mjs';
// Repair only the identifiable flat, metric Plan Studio export dialect. Keep
// arbitrary CAD drawings (blocks, XDATA, custom entities) byte-for-byte intact.
const kinds=new Set(['LINE','ARC','CIRCLE','TEXT','LWPOLYLINE','HATCH']);
const marker={LINE:'AcDbLine',ARC:'AcDbCircle',CIRCLE:'AcDbCircle',TEXT:'AcDbText',LWPOLYLINE:'AcDbPolyline',HATCH:'AcDbHatch'};
const get=(r,c)=>r.find(t=>t[0]===c)?.[1];
function records(tags){const result=[];let row=[];for(const t of tags){if(t[0]===0&&row.length){result.push(row);row=[];}row.push(t);}if(row.length)result.push(row);return result;}
function section(tags,name){const a=tags.findIndex((t,i)=>t[0]===0&&t[1]==='SECTION'&&tags[i+1]?.[1]===name);if(a<0)return null;const b=tags.findIndex((t,i)=>i>a&&t[0]===0&&t[1]==='ENDSEC');return b<0?null:{a,b,body:tags.slice(a+2,b)};}
export function repairLegacyPlanDXF(text){
 const unchanged=()=>({text,changed:false});if(typeof text!=='string'||text.length>10*1024*1024||text.includes('\0'))return unchanged();
 const lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/);if(lines.length%2)return unchanged();const tags=[];for(let i=0;i<lines.length;i+=2){if(!/^\s*\d+\s*$/.test(lines[i]))return unchanged();const code=Number(lines[i]);tags.push([code,[0,2,5,9,100,330].includes(code)?lines[i+1].trim():lines[i+1]]);}
 const header=section(tags,'HEADER'),tables=section(tags,'TABLES'),entities=section(tags,'ENTITIES');if(!header||!tables||!entities||section(tags,'BLOCKS')||section(tags,'OBJECTS'))return unchanged();
 const hv=name=>{const i=header.body.findIndex(t=>t[0]===9&&t[1]===name);return i<0?null:header.body[i+1]?.[1];};
 if(hv('$ACADVER')!=='AC1015'||hv('$INSUNITS')!=='6')return unchanged();
 const tr=records(tables.body),er=records(entities.body),layers=tr.filter(r=>r[0][1]==='LAYER').map(r=>get(r,2));
 if(!['architecture','mechanical','electrical','fluids','dimensions','furniture','notes'].every(n=>layers.includes(n))||!er.length||er.length>10000||er.some(r=>!kinds.has(r[0][1])||r.some(t=>t[0]>=1000)))return unchanged();
 const handles=[...tr.filter(r=>['LTYPE','LAYER'].includes(r[0][1])),...er].map(r=>get(r,5));
 if(handles.some(h=>!h||!/^[a-f0-9]+$/i.test(h)||parseInt(h,16)<256)||new Set(handles.map(h=>h.toLowerCase())).size!==handles.length)return unchanged();
 const tableRows=tr.flatMap(r=>{
  const kind=r[0][1];if(!['LTYPE','LAYER'].includes(kind))return r;
  return [[0,kind],[5,get(r,5)],[330,kind==='LAYER'?'1':'2'],[100,'AcDbSymbolTableRecord'],[100,kind==='LAYER'?'AcDbLayerTableRecord':'AcDbLinetypeTableRecord'],...r.filter(t=>![0,5,330,100].includes(t[0]))];
 });
 const entityRows=er.flatMap(r=>{const kind=r[0][1],commonCodes=new Set([8,6,62,420,370,67,60]),common=r.filter(t=>commonCodes.has(t[0])),body=r.filter(t=>![0,5,330,100].includes(t[0])&&!commonCodes.has(t[0]));
  if(kind==='ARC'){const i=body.findIndex(t=>t[0]===50);if(i>=0)body.splice(i,0,[100,'AcDbArc']);for(const t of body)if([50,51].includes(t[0]))t[1]=String((Number(t[1])%360+360)%360);}
  return [[0,kind],[5,get(r,5)],[330,'6'],[100,'AcDbEntity'],...common,[100,marker[kind]],...body,...(kind==='TEXT'?[[100,'AcDbText']]:[])];
 });
 const rebuilt=[[0,'SECTION'],[2,'HEADER'],...header.body,[0,'ENDSEC'],[0,'SECTION'],[2,'TABLES'],...tableRows,[0,'ENDSEC'],[0,'SECTION'],[2,'ENTITIES'],...entityRows,[0,'ENDSEC'],[0,'EOF']].flat().join('\n')+'\n';
 return{text:completeDXFEnvelope(rebuilt),changed:true,entityCount:er.length,units:'m',reason:'legacy-plan-studio-dxf-compatibility'};
}
export async function compatibleApsFile(file){
 if(!/\.dxf$/i.test(file?.name||'')||file.size>10*1024*1024)return{file,changed:false};
 const result=repairLegacyPlanDXF(await file.text());
 return result.changed?{...result,file:new File([result.text],file.name,{type:file.type||'application/dxf',lastModified:file.lastModified})}:{file,changed:false};
}
