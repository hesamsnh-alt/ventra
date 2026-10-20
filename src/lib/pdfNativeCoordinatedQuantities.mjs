import {measureNativeClearPlan} from './pdfNativeClearPlan.mjs';
import {readNativeSurfaceConventions,measureNativeSurfaceOperations} from './pdfNativeSurfaceOperations.mjs';
const E=.0002,near=(a,b)=>Math.abs(a-b)<E;
const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
const textOf=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans.map(s=>s.text).join(' '):'';
const unique=(a,label)=>{if(a.length!==1)throw Error('Ambiguous or missing '+label);return a[0];};
const on=(p,w)=>Math.abs((w.b.x-w.a.x)*(p.y-w.a.y)-(w.b.y-w.a.y)*(p.x-w.a.x))<E&&p.x>=Math.min(w.a.x,w.b.x)-E&&p.x<=Math.max(w.a.x,w.b.x)+E&&p.y>=Math.min(w.a.y,w.b.y)-E&&p.y<=Math.max(w.a.y,w.b.y)+E;
const boundary=(p,r)=>((near(p.x,r.bounds.x0)||near(p.x,r.bounds.x1))&&p.y>=r.bounds.y0-E&&p.y<=r.bounds.y1+E)||((near(p.y,r.bounds.y0)||near(p.y,r.bounds.y1))&&p.x>=r.bounds.x0-E&&p.x<=r.bounds.x1+E);
const band=(spans,y)=>spans.filter(s=>Math.abs(s.y-y)<1.5).sort((a,b)=>a.x-b.x);
const factor=(value,unit,pages,evidence)=>({value,unit,operation:'multiply',pages:[...new Set(pages)],evidence,clip:null});
const term=(id,operation,factors)=>({id,operation,factors});
const calc=(key,scope_id,terms,evidence)=>({key,scope_id,terms,evidence});
function cellsAt(spans,y,cols){const cells=cols.map(()=>[]);for(const s of band(spans,y)){let i=0;for(let j=1;j<cols.length;j++)if(Math.abs(s.x-cols[j].x)<Math.abs(s.x-cols[i].x))i=j;cells[i].push(s.text);}return cells.map(c=>clean(c.join(' ')));}

export function readNativeInstanceTables(pages){
 const result=[];
 for(const page of pages){
  const text=textOf(page),kind=/DOOR SCHEDULE\s*\/\s*UNIQUE INSTANCES/i.test(text)?'door':/WINDOW SCHEDULE\s*\/\s*UNIQUE INSTANCES/i.test(text)?'window':null;if(!kind)continue;
  const spans=page.native_text_evidence.spans;
  const header=unique(spans.filter(s=>s.text==='Instance'),'instance-table header'),cols=band(spans,header.y);
  const expected=kind==='door'?['Instance','Type','W m','H m','Spaces','CL endpoints (x,y) m']:['Instance','Type','W m','H m','Sill m','Room','CL endpoints (x,y) m'];
  if(cols.map(s=>s.text).join('|')!==expected.join('|'))throw Error('Unsupported instance table columns or units');
  const anchors=spans.filter(s=>s.y<header.y-3&&Math.abs(s.x-header.x)<10&&/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(s.text));
  if(!anchors.length||anchors.length>500)throw Error('Empty or excessive unique instance schedule');
  for(const anchor of anchors){
   const cells=cellsAt(spans,anchor.y,cols),last=cells.at(-1),coordinates=last.match(/^\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\) to \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/);
   const width=Number(cells[2]),height=Number(cells[3]),sill=kind==='window'?Number(cells[4]):0;
   if(!coordinates||!/^\d+(?:\.\d+)?$/.test(cells[2])||!/^\d+(?:\.\d+)?$/.test(cells[3])||!(width>0&&height>0&&width<=50&&height<=50)||!Number.isFinite(sill)||sill<0||sill>50)throw Error('Invalid sourced opening dimensions');
   const [x1,y1,x2,y2]=coordinates.slice(1).map(Number),a={x:x1,y:y1},b={x:x2,y:y2};
   if(!near(x1,x2)&&!near(y1,y2)||!near(Math.hypot(x2-x1,y2-y1),width))throw Error('Opening width and source endpoints disagree');
   const spaces=cells[kind==='window'?5:4].split(/\s*\/\s*/);
   if(spaces.length!==(kind==='window'?1:2)||spaces.some(s=>!/^(?:[A-Z]+\d+|EXT)$/.test(s)))throw Error('Opening room identities unsupported');
   if(result.some(o=>o.id===cells[0]))throw Error('Duplicate physical opening instance');
   result.push({id:cells[0],type:cells[1],kind,width,height,sill,a,b,spaces,page:page.pageNumber,evidence:cells.join(' | ')});
  }
 }
 if(!result.some(o=>o.kind==='door')||!result.some(o=>o.kind==='window'))throw Error('Both coordinated door and window instance schedules required');
 return result;
}

function finishRegister(pages,plans){
 const tags=new Set(plans.flatMap(p=>p.rooms.map(r=>r.tag))),entries=new Map();
 for(const page of pages){
  const native=page.native_text_evidence;if(native?.status!=='readable')continue;
  const spans=native.spans,heads=spans.filter(s=>/^(?:GF|FF|[A-Z]+) room$/.test(s.text));if(!heads.length)continue;
  const y=unique([...new Set(heads.map(s=>s.y))],'room finish-register header'),cols=band(spans,y);
  if(cols.length%3||cols.some((c,i)=>i%3===0?!/^[A-Z]+ room$/.test(c.text):i%3===1?c.text!=='Floor':c.text!=='Ceiling'))throw Error('Unsupported room finish-register columns');
  const tableSpans=spans.filter(s=>s.x>=cols[0].x-10);
  const roomColumns=cols.filter((_,i)=>i%3===0);
  const ys=[...new Set(tableSpans.filter(s=>s.y<y-3&&tags.has(s.text)&&roomColumns.some(c=>Math.abs(c.x-s.x)<10)).map(s=>s.y))];
  for(const rowY of ys){const cells=cellsAt(tableSpans,rowY,cols);for(let i=0;i<cells.length;i+=3){const [tag,floor,ceiling]=cells.slice(i,i+3);if(!tags.has(tag)||entries.has(tag)||!/^([A-Z]+\d+|VOID)$/.test(floor)||!/^([A-Z]+\d+|VOID)$/.test(ceiling))throw Error('Missing, duplicate or unknown finish-register room');entries.set(tag,{floor,ceiling,page:page.pageNumber});}}
 }
 if(entries.size!==tags.size||[...tags].some(t=>!entries.has(t)))throw Error('Finish register does not cover every source room');
 const legends=new Map();
 for(const page of pages){
  const spans=page.native_text_evidence?.status==='readable'?page.native_text_evidence.spans:[];
  for(const head of spans.filter(s=>s.text==='Code')){
   const cols=band(spans,head.y);if(cols.length!==3||!['Floor finish','Description'].includes(cols[1].text))continue;
   const keys=new Set([...entries.values()].map(r=>cols[1].text==='Description'?r.ceiling:r.floor));
   for(const anchor of spans.filter(s=>s.y<head.y-3&&Math.abs(s.x-head.x)<15&&keys.has(s.text))){
    const cells=cellsAt(spans,anchor.y,cols),old=legends.get(cells[0]);if(old&&old.description!==cells[1])throw Error('Conflicting source finish legend');legends.set(cells[0],{description:cells[1],rule:cells[2],page:page.pageNumber});
   }
  }
 }
 return {entries,legends};
}

export function nativeCoordinatedPdfCalculations(pages){
 const calculations=[],issues=[],details=[];
 const floors=pages.filter(p=>p.page_evidence?.kind==='floor_plan');
 if(!floors.some(p=>p.native_clear_geometry))return {calculations,issues,details};
 try{
  const plans=floors.map(p=>({...measureNativeClearPlan(p,pages),page:p}));
  if(plans.some(p=>p.status!=='checked'))throw Error('Every selected floor requires checked native CL geometry');
  const openings=readNativeInstanceTables(pages),source=pages.map(p=>({page:p.pageNumber,text:textOf(p)})),all=source.map(p=>p.text).join(' ');
  if(!/Partition lengths use full grid CL lengths\. Do not deduct T-junction overlaps/i.test(all)||!/deduct every scheduled door\/window opening, regardless of size/i.test(all))throw Error('Complete CL wall/opening measurement conventions required');
  const finish=finishRegister(pages,plans);
  const wetRule=unique(source.flatMap(p=>[...p.text.matchAll(/([A-Z]+\d+(?:\/[A-Z]+\d+)+):\s*all four clear walls to\s*(\d+(?:\.\d+)?)\s*m;\s*less doors\/windows below\s*(\d+(?:\.\d+)?)/gi)].map(m=>({tags:m[1].split('/'),height:Number(m[2]),clip:Number(m[3]),page:p.page}))), 'wet-room finish rule');
  if(!near(wetRule.height,wetRule.clip))throw Error('Contradictory wet finish clip height');
  const upstand=unique(source.flatMap(p=>[...p.text.matchAll(/(\d+(?:\.\d+)?)\s*m high x wet-room clear perimeter minus door widths/gi)].map(m=>({height:Number(m[1]),page:p.page}))), 'wet upstand measurement rule');
  if(!/For each room, measure 2 x \(clear width \+ clear depth\) x local wall height/i.test(all)||!/Subtract the entire clear length of any full-height GL01 face/i.test(all)||!/All solid clear room wall faces, less openings; includes under wet wall tiles/i.test(all)||!/PL01 net faces minus WT01 tiled faces/i.test(all))throw Error('Explicit clear-wall finish conventions required');
  const surfaceConventions=readNativeSurfaceConventions(pages);
  const baseRulePages=source.filter(p=>/Partition lengths use full grid CL|For each room, measure 2 x/.test(p.text)).map(p=>p.page);
  const consumed=new Set();
  for(const plan of plans){
   const p=plan.page,scope=p.page_evidence.scope_id,planText=p.native_plan_text.spans.map(s=>s.text).join(' ');
   const floorName=unique([...planText.matchAll(/\b(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF) FLOOR\s*\/\s*ARCHITECTURAL PLAN/gi)],'source architectural floor name')[1];
   const height=unique(source.flatMap(s=>[...s.text.matchAll(new RegExp(`\\b${floorName} external and internal walls\\s+(\\d+(?:\\.\\d+)?) m above`,'gi'))].map(m=>({value:Number(m[1]),page:s.page}))), 'local floor wall height');
   const roomTags=new Set(plan.rooms.map(r=>r.tag)),local=openings.filter(o=>o.spaces.some(s=>roomTags.has(s)));
   const printedTags=p.native_plan_text.spans.filter(s=>/^[A-Z]+-[DW]\d+$/.test(s.text.trim())).map(s=>s.text.trim());
   if(printedTags.length!==local.length||new Set(printedTags).size!==printedTags.length||local.some(o=>!printedTags.includes(o.id)))throw Error('Opening instance ledger does not match every printed plan tag');
   for(const o of local){
    if(consumed.has(o.id))throw Error('Opening belongs to multiple floors');consumed.add(o.id);
    const host=unique(plan.walls.filter(w=>on(o.a,w)&&on(o.b,w)),'source opening vector host '+o.id),middle={x:(o.a.x+o.b.x)/2,y:(o.a.y+o.b.y)/2};
    const adjacent=plan.rooms.filter(r=>boundary(middle,r)).map(r=>r.tag).sort(),declared=o.spaces.filter(s=>s!=='EXT').sort();
    if(adjacent.join('|')!==declared.join('|')||host.classification==='external'&&declared.length!==1||host.classification!=='external'&&declared.length!==2||o.kind==='window'&&host.classification!=='external')throw Error('Opening room relationship conflicts with native topology: '+o.id);
    o.host=host;
   }
   const proof=[...new Set([p.pageNumber,...plan.audit.source_pages,...baseRulePages,height.page])];
   const f=(n,u,label,extra=[])=>factor(n,u,[...proof,...extra],label);
   const openingTerm=(o,id,faces=1,clip=null)=>term(id,'subtract',[f(o.width,'m',o.id+' source width',[o.page]),clip?{value:null,unit:'m',operation:'multiply',pages:[...proof,o.page,wetRule.page],evidence:o.id+' source sill/height clipped to finish band',clip:{opening_height_m:o.height,sill_m:o.sill,finish_height_m:clip}}:f(o.height,'m',o.id+' source opening height',[o.page]),...(faces===1?[]:[f(faces,'count','Measured solid finished faces')])]);
   // The same validated physical opening ledger owns both summary quantities
   // and BOQ operations. A stale AI project aggregate cannot override it.
   for(const [kind,countKey,areaKey]of [['door','door_count','door_area'],['window','window_count','window_area']]){
    const rows=local.filter(o=>o.kind===kind);
    if(rows.length){
     calculations.push(calc(countKey,scope,rows.map(o=>term(o.id+':count','add',[f(1,'count','Unique hosted source instance '+o.id,[o.page])])),'Count unique physically hosted source instances once'));
     calculations.push(calc(areaKey,scope,rows.map(o=>term(o.id+':area','add',[f(o.width,'m',o.id+' scheduled width',[o.page]),f(o.height,'m',o.id+' scheduled height',[o.page])])),'Sum each unique scheduled source opening width times height once'));
    }
   }
   for(const [classification,key]of [['external','external_block_area'],['internal','internal_block_area']]){
    const terms=plan.walls.filter(w=>w.classification===classification).map((w,i)=>term(`${scope}:${classification}:${i}`,'add',[f(w.length,'m','Calibrated full CL vector length'),f(height.value,'m','Printed local floor wall height')]));
    terms.push(...local.filter(o=>o.host.classification===classification).map(o=>openingTerm(o,o.id+':masonry')));
    calculations.push(calc(key,scope,terms,'Source CL wall lengths; no T-junction overlap deductions; all scheduled openings deducted once on their physical host'));
   }
   const plaster=[],tile=[],up=[],wetFloors=[],gypsum=[],ceilingPaint=[],roomDetails=[];
   for(const r of plan.rooms){
    const register=finish.entries.get(r.tag),ceiling=finish.legends.get(register.ceiling);
    if(r.void!==(register.floor==='VOID')||r.void!==(register.ceiling==='VOID'))throw Error('Void and finish register disagree');
    const areaTerms=label=>[term(r.tag+':'+label,'add',[f(r.width,'m',r.tag+' clear width'),f(r.depth,'m',r.tag+' clear depth')]),...r.deductions.map((d,i)=>term(`${r.tag}:${label}:deduction:${i}`,'subtract',[f(d.x1-d.x0,'m','Explicit stair exclusion width'),f(d.y1-d.y0,'m','Explicit stair exclusion depth')]))];
    if(!r.void){
     if(!ceiling)throw Error('Ceiling finish code has no source legend');
     if(/gypsum/i.test(ceiling.description))gypsum.push(...areaTerms('gypsum').map(t=>({...t,factors:t.factors.map(v=>({...v,pages:[...new Set([...v.pages,register.page,ceiling.page])]}))})));
     if(!/paint/i.test(ceiling.rule+' '+ceiling.description))throw Error('Ceiling painting scope not explicitly declared');
     ceilingPaint.push(...areaTerms('ceiling-paint'));
    }
    const perim=label=>[term(`${r.tag}:${label}:width-sides`,'add',[f(2,'count','Two opposite room faces'),f(r.width,'m',r.tag+' clear width'),f(height.value,'m','Printed local wall height')]),term(`${r.tag}:${label}:depth-sides`,'add',[f(2,'count','Two opposite room faces'),f(r.depth,'m',r.tag+' clear depth'),f(height.value,'m','Printed local wall height')])];
    const own=perim('plaster');let glassClearLength=0;
    for(const glass of plan.walls.filter(w=>w.classification==='glass'&&w.rooms.includes(r.tag))){
     const adjacent=plan.rooms.filter(room=>glass.rooms.includes(room.tag)),axis=glass.axis==='h'?'x':'y';
     const length=Math.min(...adjacent.map(q=>q.clear[axis+'1']))-Math.max(...adjacent.map(q=>q.clear[axis+'0']));
     if(!(length>0&&length<=glass.length))throw Error('Glass clear-face length invalid');
     glassClearLength+=length;
     own.push(term(`${r.tag}:glass:${glass.rooms.join('-')}`,'subtract',[f(length,'m','Shared clear glass face; intersection of both adjoining room clear extents'),f(height.value,'m','Full local wall height')]));
    }
    own.push(...local.filter(o=>o.spaces.includes(r.tag)&&o.host.classification!=='glass').map(o=>openingTerm(o,r.tag+':'+o.id+':finish')));plaster.push(...own);
    if(wetRule.tags.includes(r.tag)){
     if(plan.walls.some(w=>w.classification==='glass'&&w.rooms.includes(r.tag)))throw Error('Wet glass finish rule unresolved');
     wetFloors.push(...areaTerms('wet-floor'));
     for(const [key,h]of [['tile',wetRule.height],['upstand',upstand.height]]){
      const list=key==='tile'?tile:up;
      list.push(term(r.tag+':'+key+':width-sides','add',[f(2,'count','Two room faces'),f(r.width,'m','Clear room width'),f(h,'m','Explicit wet finish height',[key==='tile'?wetRule.page:upstand.page])]),term(r.tag+':'+key+':depth-sides','add',[f(2,'count','Two room faces'),f(r.depth,'m','Clear room depth'),f(h,'m','Explicit wet finish height',[key==='tile'?wetRule.page:upstand.page])]));
      for(const o of local.filter(o=>o.spaces.includes(r.tag)&&(key==='tile'||o.kind==='door'))){
       if(key==='tile')list.push(openingTerm(o,r.tag+':'+o.id+':tile',1,h));
       else list.push(term(r.tag+':'+o.id+':upstand','subtract',[f(o.width,'m','Door width excluded from upstand',[o.page]),f(h,'m','Explicit upstand height',[upstand.page])]));
      }
     }
    }
    const skirting=r.void||wetRule.tags.includes(r.tag)?0:2*(r.width+r.depth)-glassClearLength-local.filter(o=>o.kind==='door'&&o.spaces.includes(r.tag)&&o.host.classification!=='glass').reduce((s,o)=>s+o.width,0);
    if(skirting<0)throw Error('Skirting deductions exceed clear room perimeter');
    roomDetails.push({tag:r.tag,width:r.width,depth:r.depth,floor_area:r.void?0:r.area,floor_code:register.floor,ceiling_code:register.ceiling,skirting_length:skirting,skirting_description:finish.legends.get(register.floor)?.rule||null,
     floor_description:finish.legends.get(register.floor)?.description||null,ceiling_description:ceiling?.description||null,caption:r.caption,wet:wetRule.tags.includes(r.tag),
     finish_source_pages:[...new Set([p.pageNumber,register.page,...(ceiling?[ceiling.page]:[]),...(finish.legends.get(register.floor)?[finish.legends.get(register.floor).page]:[])])],plaster_terms:own});
   }
   for(const [key,terms]of [['plaster_area',plaster],['paint_area',[...plaster,...tile.map(t=>({...t,id:'paint-exclude:'+t.id,operation:t.operation==='add'?'subtract':'add'}))]],['wet_wall_tile_area',tile],['wet_wall_waterproofing_area',up],['wet_floor_area',wetFloors],['wet_floor_waterproofing_area',wetFloors],['gypsum_ceiling_area',gypsum],['ceiling_paint_area',ceilingPaint]])if(terms.length)calculations.push(calc(key,scope,terms,'Original PDF coordinated native room geometry, unique opening ledger and explicit finish/height conventions; no model-calculated totals used'));
   let surface_operations=[],surface_operations_valid=true;
   try{surface_operations=measureNativeSurfaceOperations(plan,local,height.value,surfaceConventions).map(o=>({...o,pages:[...new Set([...o.pages,...proof])]}));}
   catch(error){surface_operations_valid=false;issues.push(`Native surface operations on page ${p.pageNumber} withheld: ${error.message}`);}
   details.push({page:p.pageNumber,scope,rooms:roomDetails,surface_operations,surface_operations_valid,source_openings:local.map(o=>({id:o.id,type:o.type,kind:o.kind,width:o.width,height:o.height,source_page:o.page,host:o.host.classification,spaces:o.spaces}))});
  }
  if(consumed.size!==openings.length)throw Error('Unmatched source opening floor');
  if(wetRule.tags.some(tag=>!details.some(d=>d.rooms.some(r=>r.tag===tag))))throw Error('Unmatched wet-room finish scope');
 }catch(e){return {calculations:[],issues:['Native coordinated quantities withheld: '+e.message],details:[]};}
 return {calculations,issues,details};
}
