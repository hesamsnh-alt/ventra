// Catalog language is independent of a drawing's quantities and item codes.
// Only explicit operation/location combinations are recognized here. A price
// description is never a source for a missing drawing measurement.
export function pdfCatalogScope(description) {
  const d=String(description||'').toLowerCase().replace(/[-‐‑–—]/g,' ').replace(/\s+/g,' ').trim();
  if(/\b(?:disposal|haul|backfill|pool|tank|raft|pile|stairs?|staircase)\b/.test(d))return null;
  const match=(key,unit,extra={})=>({key,unit,...extra});
  if(/\bformwork\b/.test(d)){
    if(/\bslabs?\b/.test(d)&&(!/\bbeams?\b/.test(d)||/\bsoffit\b/.test(d)))return match('slab_formwork_area','m2');
    if(/\bbeams?\b/.test(d)&&!/\b(?:slabs?|soffits?|undersides?|bottoms?)\b/.test(d))return match('beam_formwork_area','m2');
    if(/\bcolumns?\b/.test(d)&&!/\b(?:beam|slab|footing|pedestal)\b/.test(d))return match('column_formwork_area','m2');
    // The existing foundation metric covers footing AND pedestal sides.
    // A footing-only or pedestal-only item cannot consume that combined area.
    if(/\bfootings?\b/.test(d)&&/\bpedestals?\b/.test(d)&&!/\b(?:column|beam|slab)\b/.test(d))return match('foundation_formwork_area','m2');
    return null;
  }
  if(/\b(?:rc|reinforced concrete)\b/.test(d)&&!/\bc\s*\d|\bmpa\b|\bgrade\b|\b(?:precast|prestressed|post tensioned)\b/.test(d)){
    const members=[[/\bfootings?\b/,'foundation_volume'],[/\bpedestals?\b/,'pedestal_volume'],[/\bcolumns?\b/,'column_volume'],[/\bbeam downstands?\b/,'beam_volume'],[/\bground (?:floor )?slabs?\b/,'ground_slab_volume'],[/\bfirst (?:floor )?slabs?\b/,'first_slab_volume'],[/\broof slabs?\b/,'roof_slab_volume']].filter(([re])=>re.test(d));
    if(members.length===1){
      const thickness=d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
      return match(members[0][1],'m3',thickness?{sourceThicknessM:Number(thickness[1])/1000}:{});
    }
  }
  if(/^excavat(?:e|ion|ing)\b/.test(d)&&!/\b(?:rock|trench|strip)\b/.test(d))return match('excavation_volume','m3');
  if(/^rebar\b/.test(d)&&!/\b(?:footing|slab|beam|column|pedestal|mesh)\b/.test(d))return match('rebar_kg','kg');
  if(/\bterrace\b/.test(d)&&/\bceramic\b/.test(d)&&!/\b(?:wall|walls|balcony)\b/.test(d))return match('terrace_floor_area','m2');
  if(/^roof (?:waterproofing|membrane)$/.test(d))return match('roof_waterproofing_area','m2');
  if(/^terrace (?:floor )?(?:waterproofing|membrane)$/.test(d))return match('terrace_waterproofing_area','m2');
  if(/^wc pans?(?: complete)?$/.test(d))return match('toilet_count','nr');
  if(/^(?:water supply|water) pipes?(?: complete)?$/.test(d))return match('water_pipe_length','m');
  if(/^waste pipes?(?: complete)?$/.test(d))return match('waste_pipe_length','m');
  if(/^split (?:ac|air conditioning) units?(?: complete)?$/.test(d))return match('ac_count','nr');
  if(/^ac insulated pipe(?:work|s)?$/.test(d))return match('ac_pipe_length','m');
  if(/^kitchen and laundry sink sets?(?: complete)?$/.test(d))return match('kitchen_sink_count+laundry_sink_count','nr',{keys:['kitchen_sink_count','laundry_sink_count']});
  if(/^kitchen sink sets?(?: complete)?$/.test(d))return match('kitchen_sink_count','nr');
  if(/^laundry sink sets?(?: complete)?$/.test(d))return match('laundry_sink_count','nr');
  if(/^kitchen (?:hob and hood|hob hood) package$/.test(d))return match('kitchen_hob_hood_count','nr');
  if(/^(?:glass and metal )?terrace railing$/.test(d))return match('terrace_railing_length','m');
  if(/^driveway paving$/.test(d))return match('driveway_area','m2');
  if(/^soft landscaping$/.test(d))return match('landscape_area','m2');
  return null;
}

// A stated catalog thickness is a restriction, not a way to set the source
// thickness. Accept only explicit calculated thickness operands for that exact
// measured operation. Missing or conflicting source operands keep it unbound.
export function pdfCatalogThicknessMatches(metric,rows){
  if(metric.sourceThicknessM===undefined)return true;
  const labels={ground_slab_volume:'(?:gf|ground(?: floor)?)',first_slab_volume:'(?:ff|first(?: floor)?)',roof_slab_volume:'roof'};
  const slab=labels[metric.key]?new RegExp(`^${labels[metric.key]}\\s+slab:\\s*(\\d*\\.\\d+|\\d+)\\.?$`,'i'):null;
  const values=rows.flatMap(r=>[...String(r.evidence||'').matchAll(/\*\s*(\d+(?:\.\d+)?)\s+(m|mm)\s*\[([^\]]*)\]/gi)].flatMap(m=>{
    const raw=Number(m[1]),source=m[3].trim(),explicit=slab?.exec(source);
    // Accept an explicit "thick" operand or a single named slab-thickness
    // field, never an envelope length, area, or a multi-dimension expression.
    if(!/\bthick(?:ness)?\b/i.test(source)&&!(explicit&&Math.abs(Number(explicit[1])-raw)<1e-9))return [];
    return [raw*(m[2].toLowerCase()==='mm'?.001:1)];
  }));
  return values.length>0&&values.every(v=>Math.abs(v-metric.sourceThicknessM)<1e-9);
}

export function pdfCatalogHeightMatches(metric,rows,description){
  if(!['wet_wall_tile_area','wet_wall_waterproofing_area'].includes(metric.key))return true;
  const text=String(description||'').toLowerCase(),dimension=text.match(/\b(\d+(?:\.\d+)?)\s*(mm|m)\b/);
  if(!dimension)return true;
  const height=Number(dimension[1])*(dimension[2]==='mm'?.001:1),kind=metric.key==='wet_wall_tile_area'?'tile':'waterproofing';
  const operands=rows.flatMap(r=>[...String(r.evidence||'').matchAll(/\*\s*(\d+(?:\.\d+)?)\s+m\s*\[WET ROOMS:\s*([^\]]*height[^\]]*)\]/gi)].filter(m=>m[2].toLowerCase().includes(kind)).map(m=>Number(m[1])));
  return operands.length>0&&operands.every(v=>Math.abs(v-height)<1e-9);
}
