// Bounded native source arithmetic, independent of rates, filenames and expected
// benchmark answers. Only explicit complete scope declarations are accepted.
export function nativePdfSupplementaryScope(pages){
 const readable=pages.filter(p=>p.native_text_evidence?.status==='readable');
 const texts=readable.map(p=>({page:p.pageNumber,text:p.native_text_evidence.spans.map(s=>s.text).join(' ')}));
 const calculations=[],issues=[],one=(xs,label)=>{if(xs.length!==1)throw Error('Missing or ambiguous '+label);return xs[0];};
 const f=(value,unit,pages,evidence)=>({value,unit,operation:'multiply',pages:[...new Set(pages)],evidence,clip:null});
 const calc=(key,terms,evidence)=>({key,scope_id:'project',terms,evidence});
 const term=(id,operation,factors)=>({id,operation,factors});
 const collect=re=>texts.flatMap(p=>[...p.text.matchAll(re)].map(m=>({m,page:p.page})));
 // Explicit roof omission is a source rectangle, not a floor-area ratio or a
 // convention inferred from the existence of a roof slab.
 const waterproof=collect(/WATERPROOFING:\s*roof excludes open terrace; terrace is a separate line\./gi);
 if(waterproof.length){try{
  const rule=one(waterproof,'roof/terrace waterproofing scope rule');
  const floors=pages.filter(p=>p.page_evidence?.kind==='floor_plan');
  const envelopes=floors.map(p=>{
   const text=p.native_plan_text?.status==='readable'?p.native_plan_text.spans.map(s=>s.text).join(' '):'';
   const entries=[...text.matchAll(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)];
   const distinct=[...new Map(entries.map(m=>[m.slice(1).map(Number).sort((a,b)=>a-b).join('|'),m])).values()];
   const match=one(distinct,'printed floor envelope');return {dims:match.slice(1).map(Number).sort((a,b)=>a-b),page:p.pageNumber,evidence:match[0]};
  });
  if(!envelopes.length||new Set(envelopes.map(e=>e.dims.join('|'))).size!==1)throw Error('Roof footprint is not uniquely defined by consistent source envelopes');
  const roof=one(collect(/Roof slab:\s*(\d*\.\d+|\d+)\s*;\s*omit\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s+terrace\./gi),'explicit roof terrace omission');
  const dims=envelopes[0].dims,omission=roof.m.slice(2).map(Number).sort((a,b)=>a-b);
  if(!texts.some(p=>p.page===roof.page&&/All dimensions in metres/i.test(p.text))||dims.some((v,i)=>!(v>0)||!(omission[i]>0)||omission[i]>=v))throw Error('Roof omission dimensions or metre units unresolved');
  const sourcePages=[...envelopes.map(e=>e.page),roof.page,rule.page];
  const gross=dims.map(v=>f(v,'m',sourcePages,'Printed source envelope: '+envelopes[0].evidence));
  const omit=omission.map(v=>f(v,'m',sourcePages,'Roof excludes terrace: '+roof.m[0]));
  calculations.push(calc('roof_waterproofing_area',[term('native-roof-gross','add',gross),term('native-roof-terrace','subtract',omit)],rule.m[0]+' Source roof rectangle minus its explicitly omitted terrace.'));
  calculations.push(calc('terrace_waterproofing_area',[term('native-terrace','add',omit)],rule.m[0]+' Separate waterproofing of the explicitly dimensioned terrace.'));
 }catch(e){issues.push(e.message);}}
 const railing=collect(/Terrace railing\s+((?:south|east|north|west) edge\s*\d+(?:\.\d+)?\s*m(?:\s*\+\s*(?:south|east|north|west) edge\s*\d+(?:\.\d+)?\s*m)*),\s*height\s*(\d+(?:\.\d+)?)\s*m\./gi);
 if(railing.length){try{
  const r=one(railing,'complete terrace railing statement'),legs=[...r.m[1].matchAll(/(south|east|north|west) edge\s*(\d+(?:\.\d+)?)\s*m/gi)];
  if(!legs.length||new Set(legs.map(m=>m[1].toLowerCase())).size!==legs.length||legs.some(m=>!(Number(m[2])>0)))throw Error('Repeated or invalid terrace railing segment');
  calculations.push(calc('terrace_railing_length',legs.map((m,i)=>term('native-railing:'+i,'add',[f(Number(m[2]),'m',[r.page],r.m[0])])),r.m[0]+' Explicit measured edge lengths, not inferred perimeter.'));
 }catch(e){issues.push(e.message);}}
 // This complete declared fixture sentence separates basins from kitchen and
 // laundry sinks. Never subtract sinks from an arbitrary AI basin aggregate.
 const fixtures=collect(/Sanitary fixtures:\s*one toilet pan, one basin and one shower in each of\s+([A-Z]+\d+(?:\s*,\s*[A-Z]+\d+)*(?:\s*,?\s+and\s+[A-Z]+\d+)?)\.\s*Separate kitchen sink in\s+([A-Z]+\d+)\s+and laundry sink in\s+([A-Z]+\d+)\./g);
 if(fixtures.length){try{
  const r=one(fixtures,'declared sanitary fixture inventory'),tags=r.m[1].split(/\s*,\s*|\s+and\s+/).filter(Boolean);
  if(!tags.length||tags.length>100||new Set([...tags,r.m[2],r.m[3]]).size!==tags.length+2)throw Error('Repeated sanitary room identity');
  for(const [key,n] of [['toilet_count',tags.length],['basin_count',tags.length],['shower_count',tags.length],['kitchen_sink_count',1],['laundry_sink_count',1]])calculations.push(calc(key,[term('native-fixtures:'+key,'add',[f(n,'count',[r.page],r.m[0])])],r.m[0]+' Distinct fixture types; one scheduled item per named room.'));
 }catch(e){issues.push(e.message);}}
 return {calculations,issues};
}
