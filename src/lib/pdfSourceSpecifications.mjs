// Source facts only: no catalog prices, project IDs, benchmark dimensions or
// model calls. A missing/conflicting specification never becomes a default.
const concrete=[['pcc_volume',/\b(?:pcc|blinding)\b/],['foundation_volume',/\b(?:foundations?|footings?)\b/],['pedestal_volume',/\bpedestals?\b/],['column_volume',/\bcolumns?\b/],['beam_volume',/\bbeams?\b/],['ground_slab_volume',/\b(?:ground|gf)(?: floor)? slabs?\b/],['first_slab_volume',/\b(?:first|ff)(?: floor)? slabs?\b/],['roof_slab_volume',/\broof slabs?\b/]];
const normal=s=>String(s||'').toLowerCase().replace(/[‐‑–—-]/g,' ').replace(/\s+/g,' ').trim();
const unique=xs=>[...new Set(xs)];
function clauses(text){return String(text).split(/;|\n|\.(?=\s+[A-Z])/).map(s=>s.trim()).filter(Boolean);}
function factsIn(text,page,scope='project'){
 const facts=[];
 for(const quote of clauses(text)){
  if(quote.length>2000)continue;
  const d=normal(quote),local=d.match(/\b(gf|ff|ground floor|first floor|floor\s*-?\d+)\b/);
  const scopeId=local?['gf','ground floor'].includes(local[1])?'floor:0':['ff','first floor'].includes(local[1])?'floor:1':local[1].replace(/floor\s*/,'floor:'):scope;
  const add=(metric,property,values)=>{for(const value of unique(values))facts.push({metric,property,value,page,scope_id:scopeId,quote,source:'native_pdf_text'});};
  if(/\b(?:not|unless|option|optional|alternative|except|excluding)\b/.test(d))continue;
  for(const [word,key] of [['external','external_block_area'],['exterior','external_block_area'],['internal','internal_block_area'],['interior','internal_block_area']]){
   const material='(?:autoclaved aerated concrete|hollow concrete|solid concrete|aac|concrete|clay|brick)';
   const pattern=new RegExp(`\\b${word}\\s*(?:${material}\\s+)?(?:walls?|partitions?|blockwork|masonry)?\\s*[:=]?\\s*(?:${material}\\s+)?(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\b`,'g');
   add(key,'thickness_mm',[...d.matchAll(pattern)].map(m=>Number(m[1])*({mm:1,cm:10,m:1000}[m[2]])));
   const reversed=new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)\\s+(?:thick\\s+)?${word}\\s+(?:${material}\\s+)?(?:walls?|partitions?|blockwork|masonry)\\b`,'g');
   add(key,'thickness_mm',[...d.matchAll(reversed)].map(m=>Number(m[1])*({mm:1,cm:10,m:1000}[m[2]])));
  }
  const grades=[...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map(m=>`C${m[1]}${m[2]?'/'+m[2]:''}`);
  for(const [key,re] of concrete)if(re.test(d))add(key,'concrete_grade',grades);
  if(/\ball\s+(?:structural\s+)?concrete\b/.test(d)&&!/\bexcept\b/.test(d))for(const [key] of concrete.filter(([k])=>k!=='pcc_volume'))add(key,'concrete_grade',grades);
  for(const [key,re] of [['water_pipe_length',/\b(?:water supply|domestic water|water pipes?)\b/],['waste_pipe_length',/\b(?:waste|drainage|soil)\s*(?:water\s*)?pipes?\b/]])if(re.test(d)){
   const dn=[...d.matchAll(/(?:\b(?:dn|dia(?:meter)?|od)\s*[:=]?\s*|[ø⌀]\s*)(\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/g)].map(m=>Number(m[1])*({mm:1,cm:10,m:1000}[m[2]||'mm']));
   const series=[...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:\/|and|,)\s*(\d+(?:\.\d+)?)\s*mm\b/g)].flatMap(m=>[Number(m[1]),Number(m[2])]);
   add(key,'diameter_mm',series.length?series:dn.length?dn:[...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\b/g)].map(m=>Number(m[1])));
   add(key,'pipe_material',[...d.matchAll(/\b(ppr|cpvc|u?pvc|hdpe|copper|pex|steel|galvanized)\b/g)].map(m=>m[1].toUpperCase()));
  }
  if(/\b(?:ac|air conditioning|refrigerant)\b/.test(d)&&/\b(?:pipes?|pipework|piping|line sets?)\b/.test(d)){
   add('ac_pipe_length','pipe_material',[...d.matchAll(/\b(copper|steel|aluminium|aluminum|ppr|u?pvc|hdpe)\b/g)].map(m=>m[1].toUpperCase()));
   const inches=[...d.matchAll(/\b(\d+)\s*\/\s*(\d+)\s*(?:["″]|inch(?:es)?\b|in\b)/g)].map(m=>Math.round(Number(m[1])/Number(m[2])*25.4*1e6)/1e6).filter(v=>Number.isFinite(v)&&v>0);
   if(inches.length===2)add('ac_pipe_length','diameter_pair_mm',[inches.sort((a,b)=>a-b).join('+')]);
   if((inches.length&&inches.length!==2)||[...d.matchAll(/\b\d+\s*\/\s*\d+/g)].length!==inches.length)add('ac_pipe_length','unparsed_pipe_detail',['present']);
   const insulation=[...d.matchAll(/\b(\d+(?:\.\d+)?)\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm\b/g)].map(m=>Number(m[1]||m[2]));
   add('ac_pipe_length','insulation_mm',insulation);
   const detail=d.replace(/\b\d+(?:\.\d+)?\s*mm\s+(?:thick\s+)?insulation\b|\binsulation\s*[:=]?\s*\d+(?:\.\d+)?\s*mm\b/g,'');
   if(/\b(?:dn|diameter|dia|od)\b|\d\s*mm|[øØ]/.test(detail))add('ac_pipe_length','unparsed_pipe_detail',['present']);
  }
  if(/\b(?:ac|air conditioning|air conditioner|split)\b/.test(d))add('ac_count','capacity_tr',[...d.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/g)].map(m=>Number(m[1])));
  // Recognize explicit material/system choices independently of pricing
  // defaults. Generic words such as "wood" do not imply engineered timber.
  for(const [key,re] of [['internal_block_area',/\b(?:internal|interior|partition)\b/],['external_block_area',/\b(?:external|exterior)\b/]])if(re.test(d)&&/\b(?:blockwork|blocks?|masonry|walls?)\b/.test(d)){
   const material=/\b(?:aac|autoclaved)\b/.test(d)?'aac':/\b(?:clay|brick)\b/.test(d)?'clay':/\bconcrete\b/.test(d)?'concrete':null;
   if(material)add(key,'block_material',[material]);
  }
  if(/\b(?:wood(?:en)?|timber|parquet)\b/.test(d)&&/\bfloor/.test(d)){
   const system=/\bengineered\b/.test(d)?'engineered_wood':/\bsolid\b/.test(d)?'solid_wood':/\blaminate\b/.test(d)?'laminate':null;
   if(system)add('wood_floor_area','floor_system',[system]);
  }
  for(const [key,re] of [['terrace_floor_area',/\bterrace\b/],['wet_wall_tile_area',/\bwet\s+(?:area\s+)?wall\b/],['backsplash_area',/\bbacksplash\b/]])if(re.test(d)&&/\b(?:tile|tiling|ceramic|porcelain|marble|granite)\b/.test(d)){
   const material=['porcelain','marble','granite','ceramic'].find(s=>new RegExp('\\b'+s+'\\b').test(d));if(material)add(key,'tile_material',[material]);
  }
  for(const [key,re] of [['roof_waterproofing_area',/\broof\b/],['terrace_waterproofing_area',/\bterrace\b/],['wet_floor_waterproofing_area',/\bwet\s+(?:area\s+)?floor\b/],['wet_wall_waterproofing_area',/\bwet\s+(?:area\s+)?wall\b/]])if(re.test(d)&&/\b(?:waterproof|membrane)/.test(d)){
   const system=/\b(?:polyurethane|pu)\b/.test(d)?'polyurethane':/\bcementitious\b/.test(d)?'cementitious':/\b(?:torch|bitumen|bituminous)\b/.test(d)?'torch_bitumen':null;if(system)add(key,'waterproofing_system',[system]);
  }
  if(/\bkitchen\b/.test(d)&&/\bcabinet/.test(d)){
   const material=/\balumini?um\b/.test(d)?'aluminium':/\bmdf\b/.test(d)?'mdf':/\bplywood\b/.test(d)?'plywood':null;if(material)add('kitchen_cabinet_length','cabinet_material',[material]);
  }
  if(/\b(?:ac|air conditioning|air conditioner)\b/.test(d)){
   const system=/\bvrf\b/.test(d)?'vrf':/\bducted\s+split\b/.test(d)?'ducted_split':/\bsplit\b/.test(d)?'split':null;if(system)add('ac_count','unit_system',[system]);
  }
 }
 return facts.filter(f=>typeof f.value!=='number'||Number.isFinite(f.value)&&f.value>0&&f.value<1e6);
}
export function readPdfSourceSpecifications(takeoff){
 const pages=takeoff?.page_results||[],facts=[];let native=false;
 for(const p of pages){
  if(['boq','estimate','quotation','cost_schedule'].includes(p.page_evidence?.kind))continue;
  const text=p.native_text_evidence?.status==='readable'?p.native_text_evidence:p.native_plan_text?.status==='readable'?p.native_plan_text:null;
  if(!text)continue;native=true;
  if(!Number.isInteger(p.pageNumber)||p.pageNumber<1||!Array.isArray(text.spans)||text.spans.length>10000)continue;
  // Retain row boundaries. Text from different table rows cannot create a
  // fictitious "pipe + diameter" or "member + grade" association.
  const bands=[];
  const spans=text.spans.filter(s=>typeof s.text==='string'&&Number.isFinite(s.y)&&Number.isFinite(s.x)).sort((a,b)=>b.y-a.y||a.x-b.x);
  for(const s of spans){let band=bands.at(-1);if(!band||Math.abs(band.y-s.y)>=1.5){band={y:s.y,spans:[]};bands.push(band);}band.spans.push(s);}
  const value=bands.map(b=>b.spans.sort((a,b)=>a.x-b.x).map(s=>s.text).join(' ')).join('\n');
  let scope=normal(p.page_evidence?.scope_id||'project').replace(/floor\s*[: ]\s*/,'floor:');
  if(['gf','ground floor'].includes(scope))scope='floor:0';if(['ff','first floor'].includes(scope))scope='floor:1';
  if(value.length>100000)continue;
  facts.push(...factsIn(value,p.pageNumber,scope));
 }
 if(!native&&!pages.length){
  // Compact saved evidence may retain typed native facts. Re-parse every
  // quoted source clause; arbitrary typed values are not accepted on trust.
  for(const f of takeoff?.pdf_analysis?.specification_facts||[]){
   if(f?.source!=='native_pdf_text'||!Number.isInteger(f.page)||f.page<1||typeof f.scope_id!=='string'||typeof f.quote!=='string'||f.quote.length>2000)continue;
   if(factsIn(f.quote,f.page,f.scope_id).some(r=>r.metric===f.metric&&r.property===f.property&&r.value===f.value&&r.scope_id===f.scope_id))facts.push({...f});
  }
 }
 return [...new Map(facts.map(f=>[JSON.stringify([f.metric,f.property,f.value,f.page,f.scope_id,f.quote]),f])).values()];
}
function valueFor(facts,key,property,takeoff){
 const rows=facts.filter(f=>f.metric===key&&f.property===property),found=unique(rows.map(f=>f.value));if(found.length!==1)return null;
 if(rows.some(f=>f.scope_id==='project'))return found[0];
 const intrinsic={ground_slab_volume:'floor:0',first_slab_volume:'floor:1',roof_slab_volume:'roof'}[key];
 const scopes=intrinsic?[intrinsic]:unique((takeoff?.pdf_analysis?.selected_floor_pages||[]).map(p=>p.scope));
 return scopes.length&&scopes.every(s=>rows.some(f=>f.scope_id===s))?found[0]:null;
}
function compatible(facts,key,constraints,takeoff){return Object.entries(constraints).every(([p,v])=>valueFor(facts,key,p,takeoff)===v);}
export function resolvedPdfSpecifications(takeoff,key,facts=readPdfSourceSpecifications(takeoff)){
 return unique(facts.filter(f=>f.metric===key).map(f=>f.property)).flatMap(property=>{
  const value=valueFor(facts,key,property,takeoff);return value===null?[]:[{property,value,pages:unique(facts.filter(f=>f.metric===key&&f.property===property).map(f=>f.page))}];
 });
}
export function pdfSpecificationConflicts(facts){
 const groups=new Map();for(const f of facts){const key=f.metric+'|'+f.property;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}
 return [...groups.values()].filter(rows=>unique(rows.map(f=>f.value)).length>1).map(rows=>({metric:rows[0].metric,property:rows[0].property,values:unique(rows.map(f=>f.value)),pages:unique(rows.map(f=>f.page)),reason:'Mixed or conflicting specifications cannot price one aggregate quantity.'}));
}
export function sourceSpecificationMetric(description,unit,takeoff,facts=readPdfSourceSpecifications(takeoff)){
 const d=normal(description),finish=(keys,expected,constraints={})=>{
  if(!keys.length||!['m2','m3','m','nr','nos','no','each','ea'].includes(unit)||!(unit===expected||expected==='nr'&&['nos','no','each','ea'].includes(unit)))return null;
  return {key:keys.join('+'),...(keys.length>1?{keys}:{}),factor:1,specificationFacts:facts.filter(f=>keys.includes(f.metric)&&Object.keys(constraints).includes(f.property))};
 };
 if(/\b(?:blockwork|blocks?|masonry)\b/.test(d)&&unit==='m2'){
  const thickness=d.match(/\b(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/),constraints=thickness?{thickness_mm:Number(thickness[1])*({mm:1,cm:10,m:1000}[thickness[2]])}:{};
  const ext=/\b(?:external|exterior)\b/.test(d),int=/\b(?:internal|interior|partition)\b/.test(d);
  if(ext&&int||!thickness&&!ext&&!int||/\b(?:aac|autoclaved|gypsum|glass|clay|brick)\b/.test(d))return null;
  const keys=(ext?['external_block_area']:int?['internal_block_area']:['external_block_area','internal_block_area']).filter(k=>compatible(facts,k,constraints,takeoff));
  // Without an explicit location, equal thicknesses cannot distinguish two
  // measurement classes. Do not attach either complete class by preference.
  return keys.length===1?finish(keys,'m2',constraints):null;
 }
 const grades=[...d.matchAll(/\bc\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?\b/g)].map(m=>`C${m[1]}${m[2]?'/'+m[2]:''}`);
 if(grades.length&&/\b(?:concrete|rc|blinding)\b/.test(d)){
  if(unique(grades).length!==1||/\b(?:precast|prestressed|post tensioned|mesh)\b/.test(d))return null;
  if(/\b\d+(?:\.\d+)?\s*(?:mm|cm)\b|\d\s*[x×]\s*\d/.test(d))return null;
  const named=concrete.filter(([,re])=>re.test(d));
  const keys=(named.length?named.map(([k])=>k):concrete.filter(([k])=>k!=='pcc_volume').map(([k])=>k)).filter(k=>takeoff?.pdf_analysis?.quantity_evidence?.[k]?.length&&compatible(facts,k,{concrete_grade:grades[0]},takeoff));
  if(named.length&&keys.length!==named.length)return null;
  return finish(keys,'m3',{concrete_grade:grades[0]});
 }
 if(/\bpipes?\b/.test(d)&&/\b(?:water|waste|drainage|soil)\b/.test(d)){
  const waste=/\b(?:waste|drainage|soil)\b/.test(d),water=/\bwater\b/.test(d)&&!waste;
  const key=waste?'waste_pipe_length':water?'water_pipe_length':null,diameter=d.match(/\b(?:dn\s*)?(\d+(?:\.\d+)?)\s*(mm|cm)?\b/),material=d.match(/\b(ppr|u?pvc|hdpe|copper)\b/);
  if(!key||!diameter&&!material)return null;
  const constraints={...(diameter?{diameter_mm:Number(diameter[1])*(diameter[2]==='cm'?10:1)}:{}),...(material?{pipe_material:material[1].toUpperCase()}: {})};
  return compatible(facts,key,constraints,takeoff)?finish([key],'m',constraints):null;
 }
 if(/\b(?:ac|air conditioning|air conditioner)\b/.test(d)&&/\b(?:units?|split)\b/.test(d)){
  const capacity=d.match(/\b(\d+(?:\.\d+)?)\s*(?:tr|tons?|tonnes?)\b/);if(!capacity)return null;
  const constraints={capacity_tr:Number(capacity[1])};return compatible(facts,'ac_count',constraints,takeoff)?finish(['ac_count'],'nr',constraints):null;
 }
 return null;
}
export function hasSourceSpecificationScope(description){
 const d=normal(description);
 return /\b(?:blockwork|blocks?|masonry)\b/.test(d)||/\bc\s*\d/.test(d)&&/\b(?:concrete|rc|blinding)\b/.test(d)||/\bpipes?\b/.test(d)&&/\b(?:ppr|u?pvc|hdpe|copper|dn)\b|\d\s*mm\b/.test(d)||/\b(?:ac|air conditioning|air conditioner)\b/.test(d)&&/\d+(?:\.\d+)?\s*(?:tr|tons?|tonnes?)\b/.test(d);
}
