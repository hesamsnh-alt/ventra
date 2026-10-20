import {nativeDeclaredScheduleOperations} from './pdfDeclaredScheduleOperations.mjs';
const textOf=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans.map(s=>s.text).join(' '):'';
const unique=(a,label)=>{if(a.length!==1)throw Error('Ambiguous or missing '+label);return a[0];};
const band=(spans,y)=>spans.filter(s=>Math.abs(s.y-y)<1.5).sort((a,b)=>a.x-b.x);
function panels(page,details,headerY){
 const spans=page.native_text_evidence.spans,heads=spans.filter(s=>/^(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF)$/.test(s.text)).sort((a,b)=>a.x-b.x);
 if(heads.length!==details.length||new Set(heads.map(h=>h.text)).size!==heads.length||heads.some(h=>Math.abs(h.y-heads[0].y)>2))throw Error('Service drawing floor panels unresolved');
 return heads.map((h,i)=>{
  const x0=h.x-20,x1=heads[i+1]?.x-20||Infinity,inside=spans.filter(s=>s.x>=x0&&s.x<x1&&s.y<h.y&&s.y>headerY+5);
  const floor=unique(details.filter(d=>d.rooms.some(r=>inside.some(s=>s.text===r.tag))),'source service panel floor');
  if(floor.rooms.some(r=>!inside.some(s=>s.text===r.tag)))throw Error('Service panel does not cover all architectural rooms');
  return {heading:h.text,spans:inside,floor};
 });
}
export function nativePdfServiceOperations(pages,details){
 const declared=nativeDeclaredScheduleOperations(pages,details);
 const operations=[...declared.operations],issues=[...declared.issues];
 const roomCount=details.flatMap(d=>d.rooms).filter(r=>r.floor_code!=='VOID').length;
 const corridors=details.flatMap(d=>d.rooms).filter(r=>/\bcorridor\b/i.test(r.caption||'')&&r.floor_code!=='VOID').length;
 const cores=details.flatMap(d=>d.rooms).filter(r=>/\bstair lobby\b|\bcore\b/i.test(r.caption||'')&&r.floor_code!=='VOID').length;
 const wet=details.flatMap(d=>d.rooms).filter(r=>r.wet).length;
 const add=(page,code,family,description,quantity,unit,basis,replacesMetric=null)=>{
  if(!Number.isFinite(quantity)||quantity<=0||quantity>1e9||unit==='nr'&&!Number.isInteger(quantity))throw Error('Invalid native service operation');
  const metricKey=`native-${family}:${code}`;
  if(operations.some(o=>o.metricKey===metricKey))throw Error('Repeated native service operation');
  operations.push({metricKey,family,sourceCode:code,sourceDescription:description,quantity,unit,pages:[...new Set([page,...details.map(d=>d.page)])],basis,replacesMetric});
 };
 const surfaceGroups=new Map();
 const surfacesComplete=details.every(d=>d.surface_operations_valid!==false);
 if(!surfacesComplete)issues.push('Native surface scope withheld across all floors: at least one floor has invalid surface measurements; no partial aggregate published.');
 for(const floor of surfacesComplete?details:[])for(const op of floor.surface_operations||[]){
  const key=op.family+':'+op.sourceCode,g=surfaceGroups.get(key)||{...op,quantity:0,pages:[],basis:[]};
  if(g.sourceDescription!==op.sourceDescription)throw Error('Conflicting source surface description');
  g.quantity+=op.quantity;g.pages.push(...op.pages);g.basis.push(op.basis);surfaceGroups.set(key,g);
 }
 for(const g of surfaceGroups.values()){
  add(g.pages[0],g.sourceCode,g.family,g.sourceDescription,g.quantity,g.unit,g.basis.join(' | '));
  operations.at(-1).pages=[...new Set(g.pages)];
 }
 for(const page of pages){
  const text=textOf(page);if(!text)continue;
  const spans=page.native_text_evidence.spans;
  const start=operations.length;
  try{
   if(/SECTIONS \/ STAIR \/ FINISH DETAILS/.test(text)){
    const row=(pattern)=>{const anchor=unique(spans.filter(s=>pattern.test(s.text)),'explicit stair detail label');return {label:anchor.text,text:band(spans,anchor.y).filter(s=>s!==anchor).map(s=>s.text).join(' ')};};
    const stair=row(/^Stair [A-Z]+\d+$/),code=stair.label.split(' ')[1];
    for(const [name,pattern,formula]of [['treads',/^Stair finish treads$/,/^(\d+) treads x (\d+(?:\.\d+)?) m wide x (\d+(?:\.\d+)?) m going$/],['risers',/^Stair finish risers$/,/^(\d+) risers x (\d+(?:\.\d+)?) m wide x (\d+(?:\.\d+)?) m$/],['landings',/^Stair finish landings$/,/^(\d+) landings x (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) m$/]]){
     const value=row(pattern),m=unique([...value.text.matchAll(new RegExp(formula.source,'g'))],'dimensioned stair '+name);add(page.pageNumber,code+'-'+name,'stair-finish','Stair finish '+name,Number(m[1])*Number(m[2])*Number(m[3]),'m2',value.label+': '+value.text);
    }
    const hand=row(/^Stair handrail [A-Z]+\d+$/),hm=hand.text.match(/^(\d+) rails x (\d+(?:\.\d+)?) m; no extra allowance$/);if(!hm)throw Error('Handrail multipliers unresolved');add(page.pageNumber,hand.label.split(' ').at(-1),'railing','Stair handrail',Number(hm[1])*Number(hm[2]),'m',hand.label+': '+hand.text);
    const guard=row(/^First void guardrail [A-Z]+\d+$/),gm=guard.text.match(/^(\d+) segments: ([\d. +]+) m$/);if(!gm)throw Error('Guardrail segment list unresolved');const legs=gm[2].split('+').map(Number);if(legs.length!==Number(gm[1])||legs.some(n=>!(n>0)))throw Error('Guardrail segment count conflict');add(page.pageNumber,guard.label.split(' ').at(-1),'railing','Void guardrail',legs.reduce((s,n)=>s+n,0),'m',guard.label+': '+guard.text);
   }
   const screed=spans.filter(s=>/^[A-Z]+\d+ screed: \d+(?:\.\d+)? mm on every net floor finish area; exclude upper void/.test(s.text));
   if(screed.length){const rule=unique(screed,'net screed convention').text,m=rule.match(/^([A-Z]+\d+) screed: (\d+(?:\.\d+)?) mm/);add(page.pageNumber,m[1],'screed','Floor screed '+m[2]+' mm',details.flatMap(d=>d.rooms).reduce((s,r)=>s+r.floor_area,0)*Number(m[2])/1000,'m3',rule+'; sum of checked net floor areas × source thickness in metres.');
    if(!/Skirting: clear room perimeter minus each door width\. Do NOT deduct windows\./.test(text)||!/No skirting along full GL01 glass faces\./.test(text))throw Error('Skirting measurement convention incomplete');
    const groups=new Map();for(const room of details.flatMap(d=>d.rooms).filter(r=>r.skirting_length>0)){if(!room.skirting_description)throw Error('Skirting finish unspecified');const g=groups.get(room.floor_code)||{quantity:0,description:room.skirting_description,rooms:[]};if(g.description!==room.skirting_description)throw Error('Conflicting skirting specification');g.quantity+=room.skirting_length;g.rooms.push(room.tag);groups.set(room.floor_code,g);}
    for(const [code,g]of groups)add(page.pageNumber,code,'skirting',g.description,g.quantity,'m','Checked clear room perimeters, minus solid door widths and shared glass faces; wet rooms/upper void excluded; '+g.rooms.join(', '));
   }
   if(/DOOR SCHEDULE \/ UNIQUE INSTANCES/.test(text)&&!declared.openingKinds.has('door')){
    const groups=new Map();for(const door of details.flatMap(d=>d.source_openings).filter(o=>o.kind==='door')){const g=groups.get(door.type)||{quantity:0,width:door.width,height:door.height};if(Math.abs(g.width-door.width)>1e-7||Math.abs(g.height-door.height)>1e-7)throw Error('Door type dimensions conflict');g.quantity++;groups.set(door.type,g);}
    for(const [code,g]of groups){const statement=unique(spans.filter(s=>new RegExp(`(?:^| )${code}: `).test(s.text)),'door type source description').text;const match=statement.match(new RegExp(`\\b${code}: ([\\s\\S]*?)(?=\\. [A-Z]+\\d+:|$)`));if(!match)throw Error('Door type description unreadable');add(page.pageNumber,code,'door-set',match[1],g.quantity,'nr','Unique source instance IDs, matched to native hosts and room pairs; '+g.width+' × '+g.height+' m opening size.');operations.at(-1).replacesMetrics=['door_count','internal_door_count','service_door_count','entrance_door_count'];}
   }
   if(/WINDOW SCHEDULE \/ UNIQUE INSTANCES/.test(text)&&!declared.openingKinds.has('window')){
    const specification=unique(spans.filter(s=>/^Powder-coated aluminium double-glazed windows, measured by net scheduled opening area\.$/.test(s.text)),'window material and area convention').text;
    const groups=new Map(),seen=new Set();
    for(const w of details.flatMap(d=>d.source_openings).filter(o=>o.kind==='window')){
     if(seen.has(w.id))throw Error('Duplicate physical window');seen.add(w.id);
     const g=groups.get(w.type)||{quantity:0,count:0,width:w.width,height:w.height};
     if(Math.abs(g.width-w.width)>1e-7||Math.abs(g.height-w.height)>1e-7)throw Error('Window type dimensions conflict');
     g.quantity+=w.width*w.height;g.count++;groups.set(w.type,g);
    }
    for(const [code,g]of groups){
     add(page.pageNumber,code,'window-set',`Powder-coated aluminium double-glazed window ${g.width.toFixed(3)} x ${g.height.toFixed(3)} m`,g.quantity,'m2',`${specification} Unique ${code} instances: ${g.count} × ${g.width} × ${g.height} m; count retained for checking, not a second priced quantity.`);
     operations.at(-1).replacesMetrics=['window_area','window_count'];
    }
   }
   if(/PLUMBING \/ DIMENSIONED PIPE ROUTES/.test(text)){
    if(!/All unshown plumbing is excluded/.test(text)||!/Add specified vertical lengths only/.test(pages.map(textOf).join(' ')))throw Error('Pipe route scope incomplete');
    const header=unique(spans.filter(s=>s.text==='System'),'pipe system header'),cols=band(spans,header.y);
    if(cols.map(s=>s.text).join('|')!=='System|Material|Vertical / equipment rule')throw Error('Unsupported pipe table layout');
    const zones=panels(page,details,header.y),codes=spans.filter(s=>s.y<header.y&&Math.abs(s.x-header.x)<10&&/^[A-Z]+\d+$/.test(s.text));
    for(const code of codes){
     const cells=band(spans,code.y),material=unique(cells.filter(s=>Math.abs(s.x-cols[1].x)<10),'pipe material').text,rule=unique(cells.filter(s=>Math.abs(s.x-cols[2].x)<10),'pipe vertical rule').text;
     if(!/\bDN\d+\b/.test(material))throw Error('Pipe diameter unavailable');
     const vertical=unique([...rule.matchAll(new RegExp(`One (\\d+(?:\\.\\d+)?) m interstorey riser on ([A-Z]+)-${code.text} only`,'g'))],'explicit pipe riser');
     const first=unique(zones.filter(z=>z.floor.rooms.some(r=>r.tag.startsWith(vertical[2]))),'pipe riser floor');
     let total=Number(vertical[1]);const basis=[rule];
     for(const zone of zones){const labels=zone.spans.filter(s=>new RegExp(`^${code.text} / \\d+(?:\\.\\d+)?$`).test(s.text));if(!labels.length)throw Error('Pipe route labels missing on a source floor');
      total+=labels.reduce((s,l)=>s+Number(l.text.split(' / ')[1]),0);basis.push(`${zone.heading}: ${labels.map(s=>s.text).join(' + ')}${zone===first?' + explicit riser':''}`);}
     add(page.pageNumber,code.text,'pipe',material,total,'m',basis.join('; '));
    }
    if(!codes.length)throw Error('No dimensioned pipe systems');
    const fixtures=new Map();
    for(const row of spans.filter(s=>/^Each (?:of )?[^:]+:\s*\d/.test(s.text))){
     const match=row.text.match(/^Each (?:of )?([^:]+):\s*(.+?)\.?$/),rooms=match[1].split(/\s+and\s+|\s*,\s*/);
     if(new Set(rooms).size!==rooms.length||rooms.some(tag=>!details.some(d=>d.rooms.some(r=>r.tag===tag))))throw Error('Fixture room identities unresolved');
     for(const entry of match[2].split(/\s*\+\s*/)){const m=entry.match(/^(\d+)\s+(WC sets?|wash basins?|sinks?|floor drains?|electric water heaters?)$/i);if(!m)throw Error('Unknown fixture rule');
      const description=m[2].replace(/s$/i,'').toLowerCase(),old=fixtures.get(description)||{value:0,rooms:new Set(),basis:[]};
      for(const room of rooms){if(old.rooms.has(room))throw Error('Repeated fixture room');old.rooms.add(room);}old.value+=Number(m[1])*rooms.length;old.basis.push(row.text);fixtures.set(description,old);
     }
    }
    for(const [description,f]of fixtures)if(!['wc set','wash basin'].includes(description))add(page.pageNumber,description.replace(/\s+/g,'-'),'fixture',description,f.value,'nr',f.basis.join('; '));
   }
   if(/HVAC \/ DIMENSIONED DUCT ROUTES/.test(text)){
    const header=unique(spans.filter(s=>s.text==='Code'),'HVAC code header'),cols=band(spans,header.y);
    if(cols.map(s=>s.text).join('|')!=='Code|Item|Specification / quantity rule')throw Error('Unsupported HVAC schedule');
    const zones=panels(page,details,header.y),rows=spans.filter(s=>s.y<header.y&&Math.abs(s.x-header.x)<10&&/^[A-Z]+\d+$/.test(s.text)),areas=[];
    for(const row of rows){
     const cells=band(spans,row.y),item=unique(cells.filter(s=>Math.abs(s.x-cols[1].x)<10),'HVAC item').text,rule=unique(cells.filter(s=>Math.abs(s.x-cols[2].x)<10),'HVAC quantity rule').text;
     const size=rule.match(/^(\d+) x (\d+) mm GI; length CL\. Sheet-metal area = 2 x \((\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)\) x length\.$/);
     if(size){if(Math.abs(Number(size[1])/1000-Number(size[3]))>1e-9||Math.abs(Number(size[2])/1000-Number(size[4]))>1e-9)throw Error('Duct size and area formula conflict');
      const labels=zones.flatMap(z=>z.spans.filter(s=>new RegExp(`^${row.text} / \\d+(?:\\.\\d+)?$`).test(s.text)));
      if(!labels.length)throw Error('Measured duct route labels missing');
      const risers=[...text.matchAll(new RegExp(`([A-Z]+-[A-Z]+\\d+) has an additional (\\d+(?:\\.\\d+)?) m VERTICAL ${row.text} riser`,'g'))];
      for(const m of risers)if(spans.filter(s=>s.text===m[1]).length!==1)throw Error('Duct riser instance tag unresolved');
      const length=labels.reduce((s,l)=>s+Number(l.text.split(' / ')[1]),0)+risers.reduce((s,m)=>s+Number(m[2]),0);
      if(!/All other duct verticals = zero/.test(text))throw Error('Duct vertical coverage unresolved');
      const area=2*(Number(size[3])+Number(size[4]))*length;areas.push(area);
      add(page.pageNumber,row.text,'duct-sheet',`${item}; ${size[1]} x ${size[2]} mm GI`,area,'m2',`${labels.map(s=>s.text).join(' + ')}; ${risers.map(m=>m[0]).join('; ')}; ${rule} Net CL length ${length} m (check only, not an extra priced line).`);
     }else if(/insulation/i.test(item)){
      if(!/use SAME nominal sheet-metal areas/.test(rule)||!areas.length)throw Error('Duct insulation basis unresolved');
      add(page.pageNumber,row.text,'duct-insulation',item+'; '+rule,areas.reduce((s,a)=>s+a,0),'m2',rule);
     }else{
      let value=null,replaces=null;
      const diffusers=rule.match(/^(\d+) per occupied room except corridor: (\d+) each floor\. No diffuser in ([A-Z]+\d+)\.$/);
      const returns=rule.match(/^(\d+) per occupied room except ([A-Z0-9/]+); (\d+) per corridor\. No grille in ([A-Z]+\d+)\.$/);
      const extract=rule.match(/^(\d+) per wet room, both levels\. Ductwork for extract excluded\.$/);
      if(diffusers&&corridors===details.length){if(!details.some(d=>d.rooms.some(r=>r.tag===diffusers[3]&&r.floor_code==='VOID')))throw Error('Diffuser void exclusion unresolved');value=Number(diffusers[1])*(roomCount-corridors)+Number(diffusers[2])*details.length;}
      else if(returns&&corridors===details.length){const excluded=returns[2].split('/');if(new Set(excluded).size!==excluded.length||excluded.some(t=>!details.some(d=>d.rooms.some(r=>r.tag===t&&r.wet)))||!details.some(d=>d.rooms.some(r=>r.tag===returns[4]&&r.floor_code==='VOID')))throw Error('Return grille exclusions unresolved');value=Number(returns[1])*(roomCount-excluded.length-corridors)+Number(returns[3])*corridors;}
      else if(extract&&details.length===2)value=Number(extract[1])*wet;
      else if(/^\d+ per level; scope is unit count only\.$/.test(rule)&&/Fan-coil units/i.test(item)){value=Number(rule.match(/^\d+/)[0])*details.length;replaces='ac_count';}
      if(value===null)throw Error('Unsupported HVAC equipment rule');
      add(page.pageNumber,row.text,'equipment',item,value,'nr',rule,replaces);
     }
    }
   }
   if(/ELECTRICAL \/ EQUIPMENT COUNTS \/ MEASURED ROUTES/.test(text)){
    const header=unique([...new Set(spans.filter(s=>s.text==='Room').map(s=>s.y))],'electrical matrix header y'),cols=band(spans,header);
    if(cols.length!==8||cols[0].text!=='Room'||cols[4].text!=='Room')throw Error('Unsupported electrical matrix columns');
    const matrixSpans=spans.filter(s=>s.x>=cols[0].x-10),roomTags=new Set(details.flatMap(d=>d.rooms.map(r=>r.tag))),rows=matrixSpans.filter(s=>s.y<header&&roomTags.has(s.text)&&[cols[0],cols[4]].some(c=>Math.abs(s.x-c.x)<10)),seen=new Set(),totals=new Map();
    for(const y of new Set(rows.map(s=>s.y))){const cells=band(matrixSpans,y);for(const offset of [0,4]){
     const tag=unique(cells.filter(s=>Math.abs(s.x-cols[offset].x)<10),'electrical room').text;if(seen.has(tag)||!roomTags.has(tag))throw Error('Duplicate electrical room');seen.add(tag);
     for(let i=1;i<4;i++){const cell=unique(cells.filter(s=>Math.abs(s.x-cols[offset+i].x)<10),'electrical cell');if(!/^\d+$/.test(cell.text))throw Error('Invalid equipment matrix count');const code=cols[offset+i].text;totals.set(code,(totals.get(code)||0)+Number(cell.text));}
    }}
    if(seen.size!==roomTags.size)throw Error('Electrical matrix floor coverage incomplete');
    for(const [code,count]of totals){const label=unique([...text.matchAll(new RegExp(`\\b${code}:\\s*([^;.]+)[;.]`,'g'))],'electrical matrix legend')[1];
     if(/twin socket points/i.test(label))continue; // existing socket operation is the same point, not two outlets
     add(page.pageNumber,code,'electrical',label,count,'nr','Complete unique room equipment matrix; counts, not watts',/LED light fittings/i.test(label)?'light_count':null);
    }
    const switches=unique([...text.matchAll(/\b([A-Z]+\d+) light switches: (\d+) per occupied room except each corridor has (\d+)\. None at ([A-Z]+\d+)\./g)],'switch quantity rule');
    const emergency=unique([...text.matchAll(/\b([A-Z]+\d+) emergency lights: (\d+) per corridor \+ (\d+) per core\./g)],'emergency-light rule');
    const exits=unique([...text.matchAll(/\b([A-Z]+\d+) exit signs: (\d+) per level\./g)],'exit-sign rule');
    if(corridors!==details.length||cores!==details.length||!details.some(d=>d.rooms.some(r=>r.tag===switches[4]&&r.floor_code==='VOID')))throw Error('Electrical room-derived scope unresolved');
    for(const [m,description,qty]of [[switches,'light switches',Number(switches[2])*(roomCount-corridors)+Number(switches[3])*corridors],[emergency,'emergency lights',Number(emergency[2])*corridors+Number(emergency[3])*cores],[exits,'exit signs',Number(exits[2])*details.length]])add(page.pageNumber,m[1],'electrical',description,qty,'nr',m[0]);
    const riser=unique([...text.matchAll(/Every FIRST route adds one (\d+(?:\.\d+)?) m riser; ground adds none\./g)],'electrical route riser');
    const zones=panels(page,details,header),codes=[...new Set(zones.flatMap(z=>z.spans.flatMap(s=>s.text.match(/^([A-Z]+\d+) \/ \d+(?:\.\d+)?$/)?.[1]||[])))];
    for(const code of codes){const definition=unique(spans.filter(s=>s.text.startsWith(code+': ')),'electrical route definition').text,labels=zones.flatMap(z=>z.spans.filter(s=>s.text.startsWith(code+' / ')));
     if(zones.some(z=>!z.spans.some(s=>s.text.startsWith(code+' / '))))throw Error('Electrical route missing a floor');
     const value=labels.reduce((s,l)=>s+Number(l.text.split(' / ')[1]),0)+Number(riser[1]);
     add(page.pageNumber,code,'electrical-route',definition.slice(code.length+2),value,'m',labels.map(s=>s.text).join(' + ')+'; '+riser[0]);
    }
   }
  }catch(e){operations.splice(start);issues.push(`Source service page ${page.pageNumber} withheld: ${e.message}`);}
 }
 return {operations,issues};
}
