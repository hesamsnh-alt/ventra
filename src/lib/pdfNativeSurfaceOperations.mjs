// Optional source-declared surface scopes. A closed wall graph alone is not
// evidence that paint or glazing belongs in the project.
export function readNativeSurfaceConventions(pages){
 const found=[];
 for(const page of pages){
  const spans=page.native_text_evidence?.status==='readable'?page.native_text_evidence.spans:[];
  for(const head of spans.filter(s=>s.text==='Code')){
   const band=y=>spans.filter(s=>Math.abs(s.y-y)<1.5).sort((a,b)=>a.x-b.x);
   const cols=band(head.y);
   if(cols.length!==3||cols[1].text!=='Material'||cols[2].text!=='Measurement rule')continue;
   for(const key of spans.filter(s=>s.y<head.y-3&&Math.abs(s.x-head.x)<15&&/^[A-Z]+\d*$/.test(s.text))){
    const cells=band(key.y),description=cells.filter(s=>Math.abs(s.x-cols[1].x)<10).map(s=>s.text).join(' '),rule=cells.filter(s=>Math.abs(s.x-cols[2].x)<10).map(s=>s.text).join(' ');
    let family=null;
    if(/^Full-height fixed internal glass$/i.test(description)&&/^Net CL length x local height less .+ glass door openings; BOQ m2$/i.test(rule))family='fixed-glazing';
    if(/^Exterior weather paint$/i.test(description)&&/^Net [A-Z]+\d+ wall area; no parapets or reveals$/i.test(rule))family='external-paint';
    if(!family)continue;
    if(found.some(c=>c.family===family))throw Error('Duplicate or conflicting surface measurement declaration');
    found.push({sourceCode:key.text,family,sourceDescription:description,rule,page:page.pageNumber});
   }
  }
 }
 return found;
}
export function measureNativeSurfaceOperations(plan,openings,height,conventions){
 if(!(height>0))throw Error('Invalid local surface height');
 return conventions.flatMap(c=>{
  const classification=c.family==='fixed-glazing'?'glass':'external',walls=plan.walls.filter(w=>w.classification===classification);
  if(!walls.length)return [];
  const hostOpenings=openings.filter(o=>o.host?.classification===classification);
  if(c.family==='fixed-glazing'&&hostOpenings.some(o=>o.kind!=='door'))throw Error('Unsupported opening in internal fixed glazing');
  const unique=new Set();for(const o of hostOpenings){if(unique.has(o.id)||!(o.width>0&&o.height>0)||o.height+(o.sill||0)>height)throw Error('Invalid or duplicated surface opening');unique.add(o.id);}
  if(walls.some(w=>!(w.length>0)))throw Error('Invalid surface wall length');
  const gross=walls.reduce((s,w)=>s+w.length*height,0),deduct=hostOpenings.reduce((s,o)=>s+o.width*o.height,0),quantity=gross-deduct;
  if(quantity<0)throw Error('Surface opening deductions exceed host area');
  if(!quantity)return [];
  return [{...c,quantity,unit:'m2',pages:[c.page,plan.page.pageNumber,...hostOpenings.map(o=>o.page)],basis:`${c.rule}; unique ${classification} CL runs: ${walls.map(w=>w.length).join(' + ')} m × ${height} m = ${gross} m2; subtract unique hosted openings ${hostOpenings.map(o=>`${o.id} ${o.width}×${o.height}`).join(' + ')||'none'} = ${deduct} m2; net ${quantity} m2. No extra face multiplier.`}];
 });
}
