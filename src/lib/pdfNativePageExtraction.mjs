import {readNativeOpeningSchedule} from './pdfNativeSchedules.mjs';

const number = text => /^\d+(?:\.\d+)?$/.test(String(text).trim()) ? Number(text) : NaN;
const clean = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
const floor = text => /^(?:ground|first|second|third|basement|roof)(?: floor)?$|^floor \d+$/i.test(text.trim());
const zero = {rooms:0,doors:0,windows:0,wall_length:0,wall_area:0,floor_area:0,ceiling_area:0,door_area:0,window_area:0};
const claim = (key,value,unit,scope,page,evidence) => ({key,value,unit,scope_id:scope,pages:[page],evidence,native_calculated:true,document_calculated:true});

// Only complete, explicitly headed table layouts are accepted. An unknown row,
// unit, duplicated identity or ambiguous column sends this page to the existing
// extraction path; readable text by itself never establishes complete takeoff.
function table(spans, columns) {
  const matches=[];
  for(const anchor of spans) {
    if(!columns[0].test(clean(anchor.text)))continue;
    const band=spans.filter(s=>Math.abs(s.y-anchor.y)<1.5);
    const cells=columns.map(pattern=>band.filter(s=>pattern.test(clean(s.text))));
    if(cells.every(c=>c.length===1))matches.push({y:anchor.y,cols:cells.map(c=>c[0])});
  }
  if(matches.length!==1)throw Error('A single unambiguous table header is required');
  const head=matches[0];
  if(head.cols.some((c,i)=>i&&c.x-head.cols[i-1].x<25))throw Error('Table columns overlap');
  const rows=[];
  for(const s of [...spans].filter(s=>s.y<head.y-3).sort((a,b)=>b.y-a.y||a.x-b.x)) {
    let row=rows.find(r=>Math.abs(r.y-s.y)<1.5);
    if(!row){row={y:s.y,cells:head.cols.map(()=>[])};rows.push(row);}
    // Numeric/unit columns must align to their printed header. Long footer
    // prose is not silently truncated into a numeric table row.
    let index=0;
    for(let i=1;i<head.cols.length;i++)if(Math.abs(s.x-head.cols[i].x)<15)index=i;
    row.cells[index].push(s.text.trim());
  }
  return {head,rows:rows.filter(r=>r.cells.slice(1).some(c=>c.length)).map(r=>r.cells.map(c=>c.join(' ')))};
}

const services = new Map([
  ['light points',['light_count','nr']],['lighting points',['light_count','nr']],
  ['socket points',['socket_count','nr']],['distribution boards',['distribution_board_count','nr']],
  ['split ac units',['ac_count','nr']],['insulated ac pipes',['ac_pipe_length','m']],
  ['smoke detectors',['smoke_detector_count','nr']],['water supply pipes',['water_pipe_length','m']],
  ['waste pipes',['waste_pipe_length','m']],
  ['wc sets',['toilet_count','nr']],['wash basins',['basin_count','nr']],
]);

// Explicit room-by-room fixture schedules, without a room-count allowance.
// Only a source that excludes all unshown plumbing establishes completeness.
// No conversion from a photograph, symbol guess, or sanitary room area.
function fixtureClaims(native,page) {
  const text=native.spans.map(s=>s.text).join(' ');
  if(!/\ball unshown plumbing is excluded\b/i.test(text))throw Error('Fixture schedule completeness unresolved');
  const rows=native.spans.filter(s=>/^Each (?:of )?[A-Z][A-Z0-9_-]*(?:\s*(?:,|and)\s*[A-Z][A-Z0-9_-]*)*:\s*\d/i.test(s.text.trim()));
  if(!rows.length||rows.length>200)throw Error('Explicit fixture room rows unavailable');
  if(native.spans.some(s=>!rows.includes(s)&&/\d+\s+(?:WC sets?|wash basins?|sinks?|floor drains?|electric water heaters?)\b/i.test(s.text)))throw Error('Unparsed fixture quantity outside the explicit room schedule');
  const inventory=new Map(),seen=new Set();
  const fixtureKeys=new Map([['wc set','toilet_count'],['wc sets','toilet_count'],['wash basin','basin_count'],['wash basins','basin_count'],['sinks',null],['sink',null],['floor drain',null],['floor drains',null],['electric water heater',null],['electric water heaters',null]]);
  for(const row of rows){
    const m=row.text.trim().match(/^Each (?:of )?([^:]+):\s*(.+?)\.?$/i);
    const rooms=m[1].split(/\s*(?:,|\band\b)\s*/).map(s=>s.trim().toUpperCase());
    if(rooms.some(s=>!/[0-9]/.test(s)||!/^\w[\w-]*$/.test(s))||new Set(rooms).size!==rooms.length)throw Error('Invalid or repeated fixture room identity');
    const entries=m[2].split(/\s*\+\s*/);
    for(const entry of entries){
      const cells=entry.match(/^(\d+)\s+(.+)$/);if(!cells||!fixtureKeys.has(clean(cells[2])))throw Error('Unsupported fixture row');
      const key=fixtureKeys.get(clean(cells[2])),count=Number(cells[1]);if(!Number.isSafeInteger(count)||count>10000)throw Error('Fixture count outside supported range');
      const identity=key||clean(cells[2]).replace(/s$/,'');
      for(const room of rooms){const id=room+'|'+identity;if(seen.has(id))throw Error('Repeated physical fixture row');seen.add(id);}
      if(key){const items=inventory.get(key)||[];items.push({count,rooms,evidence:row.text});inventory.set(key,items);}
    }
  }
  return [...inventory].map(([key,items])=>claim(key,items.reduce((s,r)=>s+r.count*r.rooms.length,0),'nr','project',page,
    `Native explicit fixture schedule; each listed room counted once: ${items.map(r=>r.evidence).join('; ')}. Source excludes all unshown plumbing. Unmapped fixture types remain separate and unmeasured.`));
}

function serviceClaims(native,page,normalizePdfScope) {
  const t=table(native.spans,[/^item$/, /^(?:ground|ground floor|gf)$/, /^(?:first|first floor|ff)$/, /^unit$/]);
  const scopes=t.head.cols.slice(1,3).map(s=>normalizePdfScope(/^(ground|first)$/i.test(s.text)?s.text+' floor':s.text));
  if(new Set(scopes).size!==2||!t.rows.length||t.rows.length>500)throw Error('Invalid service scope/table');
  const seen=new Set(),claims=[];
  for(const row of t.rows){
    const mapping=services.get(clean(row[0]));
    if(!mapping||seen.has(mapping[0]))throw Error('Unknown or repeated service row');
    seen.add(mapping[0]);const [key,unit]=mapping;
    if(clean(row[3])!==unit)throw Error('Unsupported service unit');
    for(let i=0;i<2;i++){
      const value=number(row[i+1]);
      if(!Number.isFinite(value)||value<0||value>1e6||unit==='nr'&&!Number.isInteger(value))throw Error('Invalid service quantity');
      claims.push(claim(key,value,unit,scopes[i],page,`Native source table: ${row[0]}; ${t.head.cols[i+1].text}: ${row[i+1]} ${unit}. Material, diameter and capacity are separate source requirements.`));
    }
  }
  return claims;
}

function barClaims(native,page) {
  const text=native.spans.map(s=>s.text).join(' ');
  const formula=[...text.matchAll(/diameter\s*\(mm\)\s*\^\s*2\s*\/\s*(\d+(?:\.\d+)?)\s*kg\/m/gi)];
  if(formula.length!==1||!(Number(formula[0][1])>0)||!/sum all rows/i.test(text)||!/(?:only scheduled\s+reinforcement|complete project reinforcement|all project reinforcement)/i.test(text))throw Error('Complete reinforcement scope/formula required');
  const t=table(native.spans,[/^element$/, /^dia(?:meter)? mm$/, /^count$/, /^cut length m$/]);
  if(!t.rows.length||t.rows.length>500)throw Error('Empty/excessive reinforcement table');
  const seen=new Set(),terms=[];
  for(const row of t.rows){
    const id=clean(row[0]),[diameter,count,length]=row.slice(1).map(number);
    if(!id||seen.has(id)||![diameter,count,length].every(n=>Number.isFinite(n)&&n>0)||!Number.isInteger(count)||diameter>100||count>1e6||length>1e6)throw Error('Invalid or repeated reinforcement row');
    seen.add(id);terms.push({id,diameter,count,length,kg:count*length*diameter*diameter/Number(formula[0][1])});
  }
  const value=terms.reduce((sum,t)=>sum+t.kg,0);
  if(!Number.isFinite(value))throw Error('Invalid reinforcement total');
  return [claim('rebar_kg',value,'kg','project',page,`Native complete bar table; ${formula[0][0]}; no intermediate rounding: ${terms.map(t=>`${t.id}: ${t.count} × ${t.length} m × ${t.diameter} mm squared / ${formula[0][1]}`).join('; ')}. No unscheduled reinforcement or wastage added.`)];
}

export function extractNativePdfPages(readings,normalizePdfScope) {
  const pages=[],audits=[];let inherited=null;
  for(const reading of [...readings].sort((a,b)=>a.pageNumber-b.pageNumber)) {
    const {pageNumber,native_text_evidence:native}=reading;
    const audit={page:pageNumber,text_status:native?.status||'unavailable',extracted:false};
    audits.push(audit);
    if(native?.status!=='readable'||!Array.isArray(native.spans)||native.spans.length>3000){inherited=null;continue;}
    const spans=native.spans,text=spans.map(s=>s.text).join(' ');
    let kind=null,scope='project',quantities=[];
    try {
      const openingHeader=['id','type','width','height'].every(h=>spans.some(s=>clean(s.text)===h));
      if(openingHeader){
        const headings=spans.filter(s=>floor(s.text));
        if(headings.length!==1)throw Error('Opening floor heading unresolved');
        kind='opening_schedule';scope=normalizePdfScope(headings[0].text);
        const result=readNativeOpeningSchedule({pageNumber,page_evidence:{kind,scope_id:scope},native_text_evidence:native},normalizePdfScope,inherited?.page===pageNumber-1?inherited.basis:null);
        if(result.status!=='read')throw Error(result.reason||'Opening table unavailable');
        inherited={page:pageNumber,basis:result.dimension_basis};
      } else {
        inherited=null;
        if(/\bplumbing\b/i.test(text)&&/\ball unshown plumbing is excluded\b/i.test(text)){kind='quantity_schedule';quantities=fixtureClaims(native,pageNumber);}
        else if(/\bdeclared services schedule\b|\bservices quantity schedule\b/i.test(text)){kind='quantity_schedule';quantities=serviceClaims(native,pageNumber,normalizePdfScope);}
        else if(/\b(?:declared bar schedule|reinforcement schedule)\b/i.test(text)){kind='quantity_schedule';quantities=barClaims(native,pageNumber);}
        else if(/\b(?:measurement and finishes|construction specifications|finish specifications)\b/i.test(text)&&['WALLS:','FLOORS:','CEILINGS:'].filter(s=>text.includes(s)).length>=2){kind='specification';}
        else throw Error('No fully supported local page contract');
      }
      const revisions=[...new Set([...text.matchAll(/\bREV(?:ISION)?\s*[:.]?\s*(R?\d+|[A-Z])\b/gi)].map(m=>m[1].toUpperCase()))];
      if(revisions.length>1)throw Error('Conflicting native source revisions');
      pages.push({...zero,pageNumber,confidence:0,detected_items:[],area_geometry:null,
        page_evidence:{kind,scope_id:scope,drawing_id:null,revision:revisions[0]||null,quantities},native_text_evidence:native,
        native_extraction:{version:1,method:'explicit_source_table_or_specification',parsed_keys:[...new Set(quantities.map(q=>q.key))],requires_source_review:true},
        notes:'Locally extracted source evidence. Unparsed prose and cross-page relationships require source review; not a complete or approved takeoff.'});
      Object.assign(audit,{extracted:true,kind,scope,parsed_keys:[...new Set(quantities.map(q=>q.key))]});
    } catch(error){audit.reason=String(error.message).slice(0,180);inherited=null;}
  }
  return {pages,audits};
}
