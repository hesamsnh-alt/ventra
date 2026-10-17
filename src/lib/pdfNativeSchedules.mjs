const clean=s=>String(s||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const headers={id:/^(?:id|tag|mark|reference)$/,host:/^(?:host wall|wall|host)$/,kind:/^(?:type|opening type|description)$/,width:/^width(?:\s*\((?:mm|m)\))?$/,height:/^height(?:\s*\((?:mm|m)\))?$/,sill:/^sill(?:\s*height)?(?:\s*\((?:mm|m)\))?$/,quantity:/^(?:quantity|qty|count)$/};
const kindOf=s=>/^(?:garage door|overhead door|roller shutter)$/.test(clean(s))?'garage_door':/^(?:door|internal door|external door|entrance door|service door|main door)$/.test(clean(s))?'door':/^(?:window|glazed window)$/.test(clean(s))?'window':null;
const dimension=s=>/^\d+(?:\.\d+)?$/.test(s)?Number(s):null;
function tableUnit(spans,head,inherited){
 const text=spans.filter(s=>s.y>head.y).map(s=>s.text).join(' ');
 const source=[...text.matchAll(/(?:all\s+)?dimensions\s+(?:are\s+|in\s+)(millimet(?:er|re)s?|met(?:er|re)s?|mm|m)\b/gi)].map(m=>/^mm|^milli/i.test(m[1])?.001:1);
 const fromHeaders=['width','height'].map(k=>head.cols.find(c=>c.key===k)?.text.match(/\((mm|m)\)/i)?.[1]).filter(Boolean).map(u=>u.toLowerCase()==='mm'?.001:1);
 const signature=head.cols.map(c=>`${c.key}:${Math.round(c.x-head.cols[0].x)}`).join('|');
 const factors=[...source,...fromHeaders];
 if(!factors.length&&inherited?.signature===signature&&inherited.allow_continuation)return {...inherited};
 if(!factors.length||new Set(factors).size!==1)throw Error('Missing or conflicting schedule dimension units');
 return {factor:factors[0],signature,allow_continuation:/all\s+dimensions\s+(?:are|in)\s+/i.test(text)};
}
export function readNativeOpeningSchedule(page,normalizeScope,inherited){
 const native=page.native_text_evidence;if(native?.version!==1||native.status!=='readable')return {status:'unavailable',rows:[]};
 const spans=native.spans,scope=normalizeScope(page.page_evidence?.scope_id);
 if(!scope||scope==='project')return {status:'pending',reason:'Schedule floor scope is unresolved',rows:[]};
 try{
  const heads=[];
  for(const s of spans.filter(s=>headers.id.test(clean(s.text)))){
   const band=spans.filter(x=>Math.abs(x.y-s.y)<Math.min(2,s.height*.2));const cols=[];
   for(const x of band){const key=Object.keys(headers).find(k=>headers[k].test(clean(x.text)));if(key)cols.push({...x,key});}
   if(['id','kind','width','height'].every(k=>cols.filter(c=>c.key===k).length===1))heads.push({y:s.y,cols:cols.sort((a,b)=>a.x-b.x)});
  }
  if(heads.length!==1)throw Error('A single complete opening table is required per schedule page');
  const head=heads[0],dimension_basis=tableUnit(spans,head,inherited),factor=dimension_basis.factor,rows=[],ids=new Set();
  // A source floor heading is required; do not silently use an unrelated AI
  // scope if the printed floor cannot be identified or disagrees.
  const printed=spans.filter(s=>s.y>head.y&&s.y-head.y<100&&/^(?:ground|first|second|third|basement|roof|floor\s+\d+)(?:\s+floor)?$/i.test(s.text.trim())).map(s=>normalizeScope(s.text));
  if(printed.length!==1||printed[0]!==scope)throw Error('Printed schedule floor does not match selected scope');
  const below=spans.filter(s=>s.y<head.y-3).sort((a,b)=>b.y-a.y||a.x-b.x),bands=[];
  for(const s of below){let b=bands.find(b=>Math.abs(b.y-s.y)<2);if(!b){b={y:s.y,spans:[]};bands.push(b);}b.spans.push(s);}
  for(const band of bands){
   const cells={};for(const s of band.spans){let nearest=head.cols.reduce((a,b)=>Math.abs(s.x-a.x)<=Math.abs(s.x-b.x)?a:b);if(Math.abs(s.x-nearest.x)>20)continue;(cells[nearest.key]??=[]).push(s.text.trim());}
   if(!cells.kind&&!cells.width&&!cells.height){
    if(cells.id?.some(s=>/^[A-Za-z][A-Za-z0-9._/-]{1,39}$/.test(s)))throw Error('Tagged row without dimensions; partial schedule withheld');
    continue;
   }
   const raw=Object.fromEntries(Object.entries(cells).map(([k,v])=>[k,v.join(' ')])),kind=kindOf(raw.kind);
   if(head.cols.some(c=>c.key==='quantity')&&raw.quantity!=='1')throw Error('Multi-instance or missing schedule row quantity requires explicit instance mapping');
   if(!kind||!raw.id||!/^[\p{L}\p{N}][\p{L}\p{N}._/-]{0,39}$/u.test(raw.id))throw Error('Unrecognized opening row; partial table withheld');
   const width=dimension(raw.width),height=dimension(raw.height),sill=raw.sill===undefined?null:dimension(raw.sill);
   if(!(width>0)||!(height>0)||width*factor>50||height*factor>50||sill!==null&&(!(sill>=0)||sill*factor>50)||head.cols.some(c=>c.key==='sill')&&sill===null)throw Error('Missing or invalid opening dimensions');
   const id=raw.id.toLowerCase();if(ids.has(id))throw Error('Repeated opening tag in schedule');ids.add(id);
   rows.push({id:raw.id,wall_id:raw.host||null,kind,width:width*factor,height:height*factor,sill:sill===null?null:sill*factor,page:page.pageNumber,source_row:Object.values(raw).join(' | ')});
  }
  if(!rows.length||rows.length>1000)throw Error('Empty or excessive opening schedule');
  dimension_basis.pages=[...new Set([...(inherited&&dimension_basis.pages||[]),page.pageNumber])];
  for(const row of rows)row.dimension_pages=dimension_basis.pages;
  return {status:'read',scope_id:scope,page:page.pageNumber,rows,dimension_basis};
 }catch(e){return {status:'pending',reason:e.message,page:page.pageNumber,rows:[]};}
}
export function nativeOpeningEvidence(pages,normalizeScope){
 const schedules=[];
 for(const p of pages.filter(p=>p.page_evidence?.kind==='opening_schedule').sort((a,b)=>a.pageNumber-b.pageNumber)){
  const previous=schedules.at(-1),inherited=previous?.status==='read'&&previous.page===p.pageNumber-1?previous.dimension_basis:null;
  schedules.push(readNativeOpeningSchedule(p,normalizeScope,inherited));
 }
 const floors=pages.filter(p=>p.page_evidence?.kind==='floor_plan').map(p=>normalizeScope(p.page_evidence.scope_id));
 const warnings=[],claims=[],blocked=[];
 if(!schedules.some(s=>s.status==='read'))return {claims,blocked,warnings,schedules};
 // A project count must cover every selected floor. Mixed readable/unreadable
 // schedules stay pending instead of combining an accurate floor with an AI
 // undercount elsewhere. Revisions are selected separately by the main merger.
 if(new Set(floors).size!==floors.length||schedules.some(s=>s.status!=='read')||schedules.length!==floors.length||floors.some(f=>schedules.filter(s=>s.scope_id===f).length!==1)){
  warnings.push('Native opening schedule coverage incomplete; partial native totals withheld');return {claims,blocked,warnings,schedules};
 }
 for(const s of schedules){
  for(const [kind,key] of [['door','door_count'],['window','window_count']]){
   const rows=s.rows.filter(r=>kind==='door'?r.kind==='door'||r.kind==='garage_door':r.kind==='window');
   for(const [metric,value,unit] of [[key,rows.length,'nr'],[`${kind}_area`,rows.reduce((v,r)=>v+r.width*r.height,0),'m2']])claims.push({key:metric,value,unit,scope_id:s.scope_id,pages:s.dimension_basis.pages,native_calculated:true,document_calculated:true,
    evidence:`Native PDF opening table, complete source rows including garage doors: ${rows.map(r=>r.source_row).join('; ')}. Dimensions read from printed table and source units; specification requires review.`});
  }
 }
 return {claims,blocked,warnings,schedules};
}
