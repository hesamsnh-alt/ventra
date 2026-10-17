import {auditPdfAreaGeometry} from './pdfAreaGeometry.mjs';
import {nativeOpeningEvidence} from './pdfNativeSchedules.mjs';

export const PDF_SOURCE_MEASUREMENT_KEYS=['internal_wall_length','external_wall_length','wall_length','wall_area','internal_block_area','external_block_area','plaster_area','paint_area','wet_wall_tile_area','wet_wall_waterproofing_area','ceiling_paint_area','gypsum_ceiling_area'];
const floorScope=s=>String(s||'').trim().toLowerCase().replace(/[ _-]+/g,' ');
const canon=s=>['ground floor','ground','gf','floor 0'].includes(floorScope(s))?'floor:0':['first floor','first','ff','floor 1'].includes(floorScope(s))?'floor:1':floorScope(s);
const name=s=>String(s||'').trim().toLowerCase();
const roomTag=s=>String(s||'').match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toLowerCase();
const unique=(rows,key)=>{const ids=rows.map(r=>name(r[key]));if(ids.some(s=>!s)||new Set(ids).size!==ids.length)throw Error(`Missing or duplicated ${key}`);};

// No dimensional defaults or benchmark quantities. Source facts are provisional;
// this module controls arithmetic, opening ownership and scope coverage.
export function calculatePdfSourceMeasurements(basis,pages,metricUnits,availablePages) {
  const calculations=[],blocked=new Set(),issues=[];
  const source=(s,unit)=>{
    if(!s||!Number.isFinite(s.value)||s.value<0||s.value>1e6||!s.evidence?.trim()||!s.pages?.length||s.pages.some(p=>!availablePages.has(p)))throw Error('Missing or unsourced source dimension');
    return {value:s.value,unit,operation:'multiply',pages:s.pages,evidence:s.evidence,clip:null};
  };
  const rule=r=>{if(typeof r?.value!=='boolean'||!r.evidence?.trim()||!r.pages?.length||r.pages.some(p=>!availablePages.has(p)))throw Error('Missing source finish rule');return r;};
  const term=(id,operation,factors)=>({id,operation,factors});
  const add=(key,terms,evidence)=>calculations.push({key,scope_id:'project',terms,evidence});
  const tryGroup=(keys,work)=>{try{work();}catch(e){keys.forEach(k=>blocked.add(k));issues.push(`${keys.join(', ')}: ${e.message}`);}};
  const selected=pages.filter(p=>p.page_evidence?.kind==='floor_plan');
  const native=nativeOpeningEvidence(pages,canon);
  const floors=basis?.floors||[];
  let matched=[];
  tryGroup(PDF_SOURCE_MEASUREMENT_KEYS,()=>{
    if(!floors.length||floors.length>30||floors.length!==selected.length)throw Error('Source basis does not cover every selected floor');
    unique(floors,'scope_id');
    if(new Set(floors.map(f=>canon(f.scope_id))).size!==floors.length)throw Error('Repeated floor aliases');
    matched=floors.map(f=>{const found=selected.filter(p=>canon(p.page_evidence.scope_id)===canon(f.scope_id));if(found.length!==1)throw Error('Unresolved source floor identity');return {f,page:found[0]};});
  });
  if(!matched.length)return {calculations,blocked:[...blocked],issues};
  const wallTerms={internal:[],external:[]},wallLengths={internal:[],external:[]},openingIndex=new Map();
  let plasterTerms=[],tileTerms=[];
  tryGroup(['internal_wall_length','external_wall_length','wall_length','wall_area','internal_block_area','external_block_area','paint_area'],()=>{
    for(const {f} of matched){
      if(!f.walls_complete||!f.wall_inventory_evidence?.trim()||!f.source_pages?.length||f.source_pages.some(p=>!availablePages.has(p))||!f.walls?.length||f.walls.length>500||!Array.isArray(f.openings)||f.openings.length>1000)throw Error('Incomplete wall/opening inventory');
      unique(f.walls,'id');unique(f.openings,'id');
      const prefix=canon(f.scope_id),walls=new Map(f.walls.map(w=>[name(w.id),w]));
      for(const w of f.walls){
        if(!['internal','external'].includes(w.classification)||!['printed_dimensions','calibrated_geometry'].includes(w.length_basis))throw Error('Unresolved wall class or dimensional basis');
        const length=source(w.length,'m'),height=source(w.height,'m');if(length.value<=0||height.value<=0)throw Error('Zero wall dimensions');
        const id=`${prefix}:${w.id}`;wallLengths[w.classification].push(term(`${id}:length`,'add',[length]));
        wallTerms[w.classification].push(term(`${id}:gross`,'add',[length,height]));
        let openingArea=0;
        for(const o of f.openings.filter(o=>name(o.wall_id)===name(w.id))){
          const width=source(o.width,'m'),oh=source(o.height,'m'),sill=source(o.sill,'m');
          if(!['door','window'].includes(o.kind)||width.value<=0||oh.value<=0||width.value>length.value||oh.value+sill.value>height.value+1e-6)throw Error('Opening dimensions exceed its host wall');
          openingArea+=width.value*oh.value;
          wallTerms[w.classification].push(term(`${prefix}:${o.id}:opening`,'subtract',[width,oh]));
          openingIndex.set(`${prefix}:${name(o.id)}`,o);
        }
        if(openingArea>length.value*height.value+1e-6)throw Error('Opening areas exceed host face area');
      }
      if(f.openings.some(o=>!walls.has(name(o.wall_id))))throw Error('Opening host wall is missing');
      const nativeRows=native.claims.length?native.schedules.find(s=>s.scope_id===prefix)?.rows:null;
      if(nativeRows){
        if(nativeRows.length!==f.openings.length)throw Error('Opening inventory does not cover native source tags');
        for(const row of nativeRows){
          const o=f.openings.find(o=>name(o.id)===name(row.id));
          if(!o||o.kind!==(row.kind==='window'?'window':'door')||Math.abs(o.width.value-row.width)>1e-6||Math.abs(o.height.value-row.height)>1e-6||row.sill!==null&&Math.abs(o.sill.value-row.sill)>1e-6||row.wall_id&&name(o.wall_id)!==name(row.wall_id))throw Error('Opening facts conflict with native schedule dimensions or host');
        }
      }
      for(const kind of ['door','window']){
        const key=`${kind}_count`,candidates=(native.claims.length?native.claims:pages.flatMap(p=>(p.page_evidence?.quantities||[]).filter(q=>p.page_evidence.kind==='opening_schedule'||q.document_calculated))).filter(q=>q.key===key&&canon(q.scope_id)===prefix&&q.unit==='nr');
        if(candidates.some(q=>q.value!==f.openings.filter(o=>o.kind===kind).length))throw Error('Opening ledger does not reconcile to source schedule count');
      }
    }
    for(const cls of ['internal','external']){
      if(!wallTerms[cls].length)throw Error('Both wall classes require complete source coverage');
      add(`${cls}_wall_length`,wallLengths[cls],'Complete source wall centreline inventory, shared walls counted once');
      add(`${cls}_block_area`,wallTerms[cls],'Net wall face area: source lengths × heights minus each hosted opening once');
    }
    add('wall_length',[...wallLengths.internal,...wallLengths.external],'Complete internal and external wall inventory');
    add('wall_area',[...wallTerms.internal,...wallTerms.external],'Net single wall faces, by source classification');
  });
  tryGroup(['plaster_area','paint_area'],()=>{
    if(blocked.has('internal_block_area')||blocked.has('external_block_area'))throw Error('Plaster needs complete net wall faces');
    const faces={internal:source(basis.rules.plaster_internal_faces,'count'),external:source(basis.rules.plaster_external_faces,'count')};
    if(Object.values(faces).some(s=>!Number.isInteger(s.value)||s.value>2))throw Error('Invalid plaster face rule');
    plasterTerms=['internal','external'].flatMap(cls=>wallTerms[cls].map(t=>({...t,id:`plaster:${t.id}`,factors:[...t.factors,faces[cls]]})));
    add('plaster_area',plasterTerms,'Source plaster face convention applied to net walls');
  });
  tryGroup(['wet_wall_tile_area','wet_wall_waterproofing_area'],()=>{
    const tileHeight=source(basis.rules.wet_tile_height,'m'),membraneHeight=source(basis.rules.wet_waterproof_height,'m');
    const wetTerms=height=>matched.flatMap(({f})=>{
      if(!f.wet_rooms_complete||!Array.isArray(f.wet_rooms)||f.wet_rooms.length>500)throw Error('Incomplete wet-room boundary inventory');
      unique(f.wet_rooms,'id');
      return f.wet_rooms.flatMap(r=>{
        const prefix=canon(f.scope_id);
        if(!r.boundary_complete||!Array.isArray(r.boundary_lengths)||r.boundary_lengths.length<3||r.boundary_lengths.length>100)throw Error('Missing complete wet-room boundary');
        const terms=r.boundary_lengths.map((side,i)=>{const length=source(side,'m');if(length.value<=0)throw Error('Zero wet-room boundary side');return term(`${prefix}:${r.id}:wet-side-${i}`,'add',[length,height]);});
        if(!Array.isArray(r.opening_ids)||new Set(r.opening_ids.map(name)).size!==r.opening_ids.length)throw Error('Repeated wet-room opening');
        for(const id of r.opening_ids){
          const o=openingIndex.get(`${prefix}:${name(id)}`);if(!o)throw Error('Wet-room opening is not in the source host ledger');
          const width=source(o.width,'m'),h=source(o.height,'m'),sill=source(o.sill,'m');
          terms.push(term(`${prefix}:${r.id}:${id}:wet-opening`,'subtract',[width,{value:null,unit:'m',operation:'multiply',
            pages:[...new Set([...h.pages,...sill.pages,...height.pages])],evidence:`${h.evidence}; ${sill.evidence}; ${height.evidence}`,
            clip:{opening_height_m:h.value,sill_m:sill.value,finish_height_m:height.value}}]));
        }
        return terms;
      });
    });
    tileTerms=wetTerms(tileHeight);const membrane=wetTerms(membraneHeight);
    if(!tileTerms.length)throw Error('Wet-room scope is not confirmed');
    add('wet_wall_tile_area',tileTerms,'Wet-room perimeters × source tile height, openings clipped to that height');
    add('wet_wall_waterproofing_area',membrane,'Wet-room perimeters × source membrane height, openings clipped to that height');
  });
  tryGroup(['paint_area'],()=>{
    if(!plasterTerms.length||blocked.has('plaster_area'))throw Error('Wall paint needs the complete net plaster basis');
    if(!rule(basis.rules.paint_uses_plastered_faces).value)throw Error('Source paint face convention is not confirmed');
    const paintTerms=[...plasterTerms];
    if(rule(basis.rules.paint_excludes_wet_tiles).value){if(blocked.has('wet_wall_tile_area')||!tileTerms.length)throw Error('Wall paint exclusion needs a complete wet tile basis');paintTerms.push(...tileTerms.map(t=>({...t,id:`paint-exclude:${t.id}`,operation:t.operation==='add'?'subtract':'add'})));}
    if(rule(basis.rules.paint_excludes_backsplash).value)paintTerms.push(term('paint-exclude:backsplash','subtract',[source(basis.rules.backsplash_length,'m'),source(basis.rules.backsplash_height,'m')]));
    add('paint_area',paintTerms,'Explicit source paint face and exclusion convention');
  });
  tryGroup(['ceiling_paint_area'],()=>{
    const paint=rule(basis.rules.paint_enclosed_ceilings);if(!paint.value)throw Error('Enclosed ceiling paint rule is not confirmed');
    const terms=matched.map(({page})=>{const checked=auditPdfAreaGeometry(page);
      if(!checked.page.__areaGeometryValidated||checked.audit?.withheld_metrics?.includes('ceiling_area')||!(checked.page.ceiling_area>0))throw Error('Audited enclosed ceiling area unavailable');
      return term(`${canon(page.page_evidence.scope_id)}:enclosed-ceiling-paint`,'add',[source({value:checked.page.ceiling_area,pages:[...new Set([page.pageNumber,...(page.document_area_source_pages||[]),...paint.pages])],evidence:`Audited enclosed ceiling area; ${paint.evidence}`},'m2')]);
    });add('ceiling_paint_area',terms,'Explicit paint-all-enclosed rule applied independently of gypsum exclusions');
  });
  tryGroup(['gypsum_ceiling_area'],()=>{
    const gypsumRule=rule(basis.rules.gypsum_exclusions_confirmed);
    if(!gypsumRule.value)throw Error('Source gypsum finish rule is not confirmed');
    const gypsumTerms=[];
    for(const {f,page} of matched){
      const checked=auditPdfAreaGeometry(page);
      if(checked.audit?.withheld_metrics?.includes('ceiling_area')||!f.ceilings_complete||!Array.isArray(f.ceiling_spaces))throw Error('Ceiling areas or finish coverage remain unresolved');
      const indoor=(checked.page.detected_items||[]).filter(i=>['m2','m²'].includes(String(i.unit).toLowerCase())&&i.quantity>0&&!/\bvoid\b|\bterrace\b|\bbalcony\b/i.test(i.name)&&!/^VOID\b|^OUTDOOR\b/i.test(i.description));
      unique(f.ceiling_spaces,'room_name');
      if(!indoor.length||Math.abs(indoor.reduce((s,i)=>s+i.quantity,0)-checked.page.ceiling_area)>.01||f.ceiling_spaces.length!==indoor.length)throw Error('Ceiling inventory does not reconcile to audited enclosed area');
      const used=new Set();let measuredCeilingArea=0;
      for(const r of f.ceiling_spaces){
        const matching=indoor.filter(i=>name(i.name)===name(r.room_name)||roomTag(i.name)&&roomTag(i.name)===roomTag(r.room_name));
        if(matching.length!==1||used.has(matching[0].name))throw Error('Unknown or repeated ceiling room identity');used.add(matching[0].name);
        if(typeof r.include_gypsum!=='boolean'||!r.evidence?.trim()||!r.pages?.length||r.pages.some(p=>!availablePages.has(p)))throw Error('Missing source gypsum room classification');
        const item=matching[0],nativeArea=r.native_area?source(r.native_area,'m2'):null;measuredCeilingArea+=nativeArea?.value??item.quantity;
        const id=`${canon(f.scope_id)}:${item.name}:ceiling`,factor={value:nativeArea?.value??item.quantity,unit:'m2',operation:'multiply',clip:null,
          pages:[...new Set([page.pageNumber,...gypsumRule.pages,...r.pages,...(nativeArea?.pages||[])])],evidence:`${nativeArea?.evidence||`Audited source room area: ${item.name}; ${item.description}`}; ${gypsumRule.evidence}; ${r.evidence}`};
        if(r.include_gypsum)gypsumTerms.push(term(id,'add',[factor]));
      }
      if(Math.abs(measuredCeilingArea-checked.page.ceiling_area)>.01)throw Error('Native room areas do not close the audited enclosed ceiling scope');
    }
    if(!gypsumTerms.length)throw Error('No confirmed gypsum scope');
    add('gypsum_ceiling_area',gypsumTerms,'Audited room areas with source gypsum exclusions');
  });
  return {calculations:calculations.filter(c=>!blocked.has(c.key)),blocked:[...blocked],issues};
}
