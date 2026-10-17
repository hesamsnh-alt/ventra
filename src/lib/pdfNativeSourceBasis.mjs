import {nativeOpeningEvidence} from './pdfNativeSchedules.mjs';
import {measureNativeWallFloor} from './pdfNativeWallGeometry.mjs';
const source=(value,pages,evidence)=>({value,pages,evidence});
const empty=()=>source(null,[],'Source rule unavailable');
const roomTag=s=>String(s||'').match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)?.[0]?.toLowerCase();
const words=s=>String(s||'').toLowerCase().replace(/^[a-z]{1,4}[-_]?\d{1,4}\s*/,'').replace(/\bstairs?\s+landing\b/g,'landing').replace(/\bstairs\b/g,'stair').replace(/[^a-z0-9]+/g,' ').trim();
export function buildNativePdfSourceBasis(pages,normalizeScope){
 const floors=pages.filter(p=>p.page_evidence?.kind==='floor_plan'),native=nativeOpeningEvidence(pages,normalizeScope),sections=new Map();
 for(const p of pages.filter(p=>p.page_evidence?.kind==='specification'&&p.native_text_evidence?.status==='readable')){
  const text=[...p.native_text_evidence.spans].sort((a,b)=>b.y-a.y||a.x-b.x).map(s=>s.text).join(' '),headers=[...text.matchAll(/\b([A-Z][A-Z ]{2,30}):\s*/g)];
  for(let i=0;i<headers.length;i++){const key=headers[i][1].trim(),value=text.slice(headers[i].index+headers[i][0].length,headers[i+1]?.index??text.length).trim();if(!sections.has(key))sections.set(key,[]);sections.get(key).push({text:value,page:p.pageNumber});}
 }
 const get=key=>{const rows=sections.get(key)||[];return rows.length&&new Set(rows.map(r=>r.text)).size===1?{text:rows[0].text,pages:rows.map(r=>r.page)}:null;};
 const dimension=(section,regex)=>{const s=get(section),match=s?.text.match(regex);return match?source(Number(match[1])*({mm:.001,cm:.01,m:1}[match[2]]||1),s.pages,`${section}: ${match[0]}`):empty();};
 const flag=(section,regex)=>{const s=get(section);return s&&regex.test(s.text)?source(true,s.pages,`${section}: ${s.text}`):empty();};
 const wallHeight=dimension('WALLS',/clear height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),plaster=get('PLASTER'),ceilings=get('CEILINGS'),wet=get('WET ROOMS'),kitchen=get('KITCHEN');
 const rules={wall_height:wallHeight,plaster_internal_faces:plaster&&/both faces of internal walls/i.test(plaster.text)?source(2,plaster.pages,plaster.text):empty(),
  plaster_external_faces:plaster&&/inner face of external walls/i.test(plaster.text)?source(1,plaster.pages,plaster.text):empty(),
  wet_tile_height:dimension('WET ROOMS',/\btile height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),wet_waterproof_height:dimension('WET ROOMS',/wall waterproofing\s+height\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i),
  backsplash_length:dimension('KITCHEN',/Backsplash\s+is\s+\d+(?:\.\d+)?\s+high\s+along\s*(\d+(?:\.\d+)?)\s*m\b/i),
  backsplash_height:kitchen&&/Backsplash\s+is\s+(\d+(?:\.\d+)?)\s+high\s+along\s*\d+(?:\.\d+)?\s*m\b/i.test(kitchen.text)?source(Number(kitchen.text.match(/Backsplash\s+is\s+(\d+(?:\.\d+)?)/i)[1]),kitchen.pages,kitchen.text):empty(),
  paint_uses_plastered_faces:plaster&&/both faces of internal walls plus inner face of external walls/i.test(plaster.text)&&/Interior paint excludes/i.test(plaster.text)?source(true,plaster.pages,plaster.text):empty(),
  paint_excludes_wet_tiles:flag('PLASTER',/Interior paint excludes wet wall tiles/i),paint_excludes_backsplash:flag('PLASTER',/Interior paint excludes[^.]*kitchen backsplash/i),
  paint_enclosed_ceilings:flag('CEILINGS',/^paint all enclosed areas\./i),gypsum_exclusions_confirmed:empty()};
 // Interpret only explicit scope/name exclusions. Unknown room references do
 // not become an all-rooms default; the gypsum group remains unresolved.
 const ceilingExclusions=[];let ceilingRuleKnown=false;
 const exclusionText=ceilings?.text.match(/Gypsum ceiling excludes\s+([^.]+)\./i)?.[1];
 if(exclusionText){
  ceilingRuleKnown=true;
  for(const entry of exclusionText.split(/,|\s+and\s+/i)){
   const match=entry.trim().match(/^(GF|FF|ground(?: floor)?|first(?: floor)?|floor\s+\d+)\s+(.+)$/i);
   if(!match){ceilingRuleKnown=false;break;}
   const scope=normalizeScope(match[1]),matches=floors.filter(p=>normalizeScope(p.page_evidence.scope_id)===scope).flatMap(p=>(p.detected_items||[]).filter(i=>['m2','m²'].includes(i.unit)&&words(i.name)===words(match[2])).map(i=>({scope,tag:roomTag(i.name)})));
   if(matches.length!==1){ceilingRuleKnown=false;break;}ceilingExclusions.push(matches[0]);
  }
 }
 if(ceilingRuleKnown)rules.gypsum_exclusions_confirmed=source(true,ceilings.pages,ceilings.text);
 const wetNames=wet?.text.split(/\.\s+/)[0].match(/\b[A-Z]{1,4}[-_]?\d{1,4}\b/g)||[],geometry=[],basis={floors:[],rules,exclusions:[],notes:'Native calibrated graph and explicitly recognized source rules; provisional, source review required.'};
 for(const p of floors){
  const scope=normalizeScope(p.page_evidence.scope_id),schedule=native.claims.length?native.schedules.find(s=>s.scope_id===scope):null,measured=measureNativeWallFloor(p,schedule);
  geometry.push(measured.audit);
  const f={scope_id:scope,walls_complete:measured.status==='provisional',wall_inventory_evidence:`Native source centreline graph; calibration, opening gaps and connectivity checked. ${JSON.stringify(measured.audit)}`,
   source_pages:[p.pageNumber,...(schedule?.dimension_basis?.pages||[])],walls:[],openings:[],wet_rooms_complete:false,wet_rooms:[],ceilings_complete:ceilingRuleKnown,ceiling_spaces:[]};
  if(measured.status==='provisional'){
   f.walls=measured.walls.map(w=>({id:w.id,classification:w.classification,length_basis:'calibrated_geometry',length:source(w.length,[p.pageNumber],`Original vector wall ${w.id}: ${JSON.stringify(w.a)} to ${JSON.stringify(w.b)}; calibrated using printed envelope`),height:wallHeight}));
   f.openings=schedule.rows.map(o=>({id:o.id,wall_id:measured.walls.find(w=>w.openings.includes(o.id))?.id,kind:o.kind==='window'?'window':'door',width:source(o.width,o.dimension_pages,o.source_row),height:source(o.height,o.dimension_pages,o.source_row),sill:source(o.sill,o.dimension_pages,o.source_row)}));
   const planTags=new Set(p.native_plan_text.spans.flatMap(s=>{const m=s.text.match(/^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i);return m?[m[0].toLowerCase()]:[];})),wanted=wetNames.filter(tag=>planTags.has(tag.toLowerCase()));f.wet_rooms_complete=!!wet&&wetNames.length>0;
   for(const tag of wanted){const faces=measured.faces.filter(face=>face.tags.some(t=>t.toLowerCase()===tag.toLowerCase()));if(faces.length!==1||faces[0].tags.length!==1){f.wet_rooms_complete=false;continue;}const face=faces[0];
    f.wet_rooms.push({id:tag,boundary_complete:true,boundary_lengths:face.polygon.map((a,i)=>{const b=face.polygon[(i+1)%face.polygon.length];return source(Math.hypot(b.x-a.x,b.y-a.y),[p.pageNumber,...wet.pages],`Closed native wall face ${tag}, side ${i+1}; ${wet.text}`);}),opening_ids:face.opening_ids});
   }
  }
  const indoors=(p.detected_items||[]).filter(i=>['m2','m²'].includes(i.unit)&&i.quantity>0&&!/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name)&&!/^VOID\b|^OUTDOOR\b/i.test(i.description));
  f.ceiling_spaces=indoors.map(i=>{const matching=measured.faces.filter(face=>face.tags.length===1&&face.tags[0].toLowerCase()===roomTag(i.name));return {room_name:i.name,include_gypsum:ceilingRuleKnown?!ceilingExclusions.some(e=>e.scope===scope&&e.tag===roomTag(i.name)):null,pages:ceilings?.pages||[],evidence:ceilings?.text||'Source ceiling rule unavailable',
   ...(matching.length===1?{native_area:source(matching[0].area,[p.pageNumber],`Area of calibrated original closed wall face ${roomTag(i.name)}; polygon ${JSON.stringify(matching[0].polygon)}`)}:{})};});
  basis.floors.push(f);
 }
 // Every declared wet-room tag must resolve on exactly one plan and one face.
 const wetResolved=basis.floors.flatMap(f=>f.wet_rooms.map(r=>r.id.toLowerCase()));
 if(wetNames.some(tag=>wetResolved.filter(t=>t===tag.toLowerCase()).length!==1))basis.floors.forEach(f=>f.wet_rooms_complete=false);
 return {basis,source_pages:[...new Set([...floors.flatMap(p=>[p.pageNumber,...(p.document_area_source_pages||[])]),...native.schedules.flatMap(s=>s.dimension_basis?.pages||[]),...[...sections.values()].flatMap(a=>a.map(r=>r.page))])],geometry};
}
