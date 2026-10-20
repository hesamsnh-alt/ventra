// Read declared quantities by columns and physical instance IDs. Source codes
// have no built-in meaning; classification comes from the source description.
const textOf=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans.map(s=>s.text).join(' '):'';
const band=(spans,y)=>spans.filter(s=>Math.abs(s.y-y)<1.5).sort((a,b)=>a.x-b.x);
const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
const unit=s=>({nos:'nr',no:'nr',each:'nr',point:'nr',set:'nr','m²':'m2','m³':'m3'}[s]||s);
export function declaredOperationKind(description){
 const d=clean(description).toLowerCase().replace(/[-–]/g,' ');
 if(/pipe insulation/.test(d))return {family:'pipe-insulation',replacesMetrics:[]};
 if(/\bpipe\b/.test(d)){
  const metrics=/\b(?:fcu|chilled|chw)\b|supply\s*\+\s*return/.test(d)?['ac_pipe_length']:/waste|soil|drain/.test(d)?['waste_pipe_length']:/cold water|hot water|water supply/.test(d)?['water_pipe_length']:[];
  return {family:'pipe',replacesMetrics:metrics};
 }
 if(/\bduct\b/.test(d))return {family:'duct-sheet',replacesMetrics:[]};
 if(/power cable|cable tray|conduit/.test(d))return {family:'electrical-route',replacesMetrics:[]};
 const kinds=[[/fan\s*coil|\bfcu\b/,'equipment',['ac_count']],[/led lights?|light fittings?/,'electrical',['light_count']],[/socket/,'electrical',['socket_count']],[/distribution board/,'electrical',['distribution_board_count']],[/smoke detector/,'electrical',['smoke_detector_count']],[/toilet pan|water closet/,'fixture',['toilet_count']],[/wash basin/,'fixture',['basin_count']],[/shower/,'fixture',['shower_count']],[/\bsink/,'fixture',['kitchen_sink_count','laundry_sink_count']]];
 for(const [re,family,replacesMetrics]of kinds)if(re.test(d))return {family,replacesMetrics};
 return null;
}
export function nativeDeclaredScheduleOperations(pages,details){
 const operations=[],issues=[],openingKinds=new Set();
 const add=o=>{if(operations.some(x=>x.metricKey===o.metricKey))throw Error('Duplicate declared source operation '+o.sourceCode);operations.push(o);};
 // Host membership and endpoint dimensions were already checked against both
 // original plans by nativeCoordinatedPdfCalculations.
 for(const kind of ['door','window']){
  const start=operations.length;
  try{
   const instances=details.flatMap(d=>d.source_openings||[]).filter(o=>o.kind===kind);
   if(!instances.length)continue;
   if(new Set(instances.map(o=>o.id)).size!==instances.length)throw Error('Repeated physical instance');
   const groups=new Map();
   for(const o of instances){const g=groups.get(o.type)||[];g.push(o);groups.set(o.type,g);}
   for(const [code,rows]of groups){
    let descriptions=[];
    for(const p of pages)for(const s of p.native_text_evidence?.spans||[]){
     const escaped=code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
     const re=new RegExp('(?:^|[.;]\\s+)'+escaped+'(?::\\s*|\\s+)(.*?)(?=[.;]\\s+[A-Z]+\\d+[: ]|$)','g');
     for(const m of s.text.matchAll(re))if(m[1].trim())descriptions.push(clean(m[1]).replace(/[.;]$/,''));
    }
    if(kind==='window'){
     const specs=pages.flatMap(p=>(p.native_text_evidence?.spans||[]).filter(s=>/^Powder-coated aluminium double-glazed windows, measured by net scheduled opening area\.$/.test(s.text)).map(s=>s.text));
     if(specs.length)descriptions=['Powder-coated aluminium double-glazed window'];
    }
    descriptions=[...new Set(descriptions)];
    if(descriptions.length>1)throw Error('Conflicting type descriptions '+code);
    const variants=[...new Map(rows.map(o=>[o.width+'x'+o.height,{width:o.width,height:o.height}])).values()];
    const description=(descriptions[0]||`${kind==='window'?'Window':'Door'} type ${code}; material not declared`)+(variants.length===1?` ${variants[0].width.toFixed(3)} x ${variants[0].height.toFixed(3)} m`:'; varying scheduled dimensions');
    const family=kind+'-set',quantity=kind==='door'?rows.length:rows.reduce((s,o)=>s+o.width*o.height,0);
    add({metricKey:`native-${family}:${code}`,family,sourceCode:code,sourceDescription:description,quantity,unit:kind==='door'?'nr':'m2',pages:[...new Set([...rows.map(o=>o.source_page),...details.filter(d=>d.source_openings?.some(o=>rows.some(r=>r.id===o.id))).map(d=>d.page)])],
     instances:rows.map(o=>({id:o.id,width:o.width,height:o.height})),basis:`Unique hosted ${kind} instances only: ${rows.map(o=>`${o.id} ${o.width} x ${o.height} m`).join('; ')}. ${kind==='door'?'Count once per set':'Sum each physical width x height once'}.`,
     replacesMetrics:kind==='door'?['door_count','internal_door_count','service_door_count','entrance_door_count','garage_door_count']:['window_area','window_count']});
   }
   openingKinds.add(kind);
  }catch(e){operations.splice(start);issues.push(`Declared ${kind} schedule withheld: ${e.message}`);}
 }
 // Schedules explicitly headed with a project quantity are totals, not one
 // copy per floor. No route or floor multiplier is guessed.
 for(const page of pages){
  const spans=page.native_text_evidence?.status==='readable'?page.native_text_evidence.spans:[];
  for(const head of spans.filter(s=>s.text==='Code')){
   const cols=band(spans,head.y),names=cols.map(s=>s.text);
   const lengthTable=names.join('|')==='Code|Source operation|Quantity|Unit';
   const countTable=names.join('|')==='Code|Description|Ground|First|Project qty';
   if(!lengthTable&&!countTable)continue;
   const start=operations.length;
   try{
    if(!/project (?:counts|totals)|declared MEP|total lengths/i.test(textOf(page)))throw Error('Project scope of schedule is not declared');
    const anchors=spans.filter(s=>s.y<head.y-3&&Math.abs(s.x-head.x)<10&&/^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/.test(s.text));
    if(!anchors.length||anchors.length>500)throw Error('Empty or excessive declared schedule');
    for(const anchor of anchors){
     const cells=band(spans,anchor.y);
     const at=i=>{const matches=cells.filter(s=>Math.abs(s.x-cols[i].x)<10);if(matches.length!==1)throw Error('Missing/ambiguous schedule cell');return matches[0].text;};
     const description=at(1),classification=declaredOperationKind(description);
     if(!classification)throw Error('Unknown source operation: '+description);
     const raw=countTable?at(4):at(2),u=countTable?'nr':unit(at(3));
     if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error('Non-numeric declared quantity');
     const quantity=Number(raw);
     if(!(quantity>=0&&quantity<1e9)||!['m','m2','m3','nr'].includes(u)||u==='nr'&&!Number.isInteger(quantity))throw Error('Unsupported quantity/unit');
     if(countTable&&(!/^\d+$/.test(at(2))||!/^\d+$/.test(at(3))||Number(at(2))+Number(at(3))!==quantity))throw Error('Floor counts do not reconcile to project count');
     if(!quantity)continue;
     const expected=classification.family==='pipe'||classification.family==='pipe-insulation'||classification.family==='electrical-route'?'m':classification.family==='duct-sheet'?'m2':'nr';
     if(u!==expected)throw Error('Unit conflicts with source operation');
     add({metricKey:`native-${classification.family}:${anchor.text}`,sourceCode:anchor.text,sourceDescription:description,...classification,quantity,unit:u,pages:[page.pageNumber],basis:`Original declared project schedule: ${anchor.text} | ${description} | ${quantity} ${u}; ${countTable?'Ground '+at(2)+' + First '+at(3)+' = project total.':'Total already includes stated horizontal runs and risers; no extra multiplier.'}`});
    }
   }catch(e){operations.splice(start);issues.push(`Declared schedule page ${page.pageNumber} withheld: ${e.message}`);}
  }
 }
 // A skirting convention need not be on a screed sheet. It is an independent
 // length operation and must survive when no screed is in the declared scope.
 const skirt=pages.filter(p=>/skirting uses clear perimeter minus door widths and full-height glass clear faces/i.test(textOf(p)));
 if(skirt.length===1){
  const groups=new Map();
  for(const room of details.flatMap(d=>d.rooms).filter(r=>r.skirting_length>0)){
   const g=groups.get(room.floor_code)||{quantity:0,description:room.skirting_description,rooms:[]};
   if(!g.description||g.description!==room.skirting_description)throw Error('Skirting legend unresolved');
   g.quantity+=room.skirting_length;g.rooms.push(room.tag);groups.set(room.floor_code,g);
  }
  for(const [code,g]of groups)add({metricKey:`native-skirting:${code}`,family:'skirting',sourceCode:code,sourceDescription:g.description,quantity:g.quantity,unit:'m',pages:[skirt[0].pageNumber,...details.map(d=>d.page)],basis:`Source clear room perimeter less solid door widths and full shared glass faces; excludes wet rooms and void. Rooms: ${g.rooms.join(', ')}.`});
 }
 return {operations,issues,openingKinds};
}
