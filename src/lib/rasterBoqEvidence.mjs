import {PDF_METRIC_UNITS} from './pdfTakeoffEvidence.mjs';
import {planPdfCatalogRules,retainUnboundPdfQuantities,resolvePdfCatalogRate} from './pdfBoqCoverage.mjs';
import {requireBoqReview} from './boqEvidence.mjs';
import {boqLineAmount,calculateBoqBudget} from './boqBudget.mjs';
import {currencySum} from './commercialDocument.mjs';
import {applyPdfDefaultSpecifications} from './pdfDefaultSpecifications.mjs';
import {bindBoqSource} from './takeoffSource.mjs';

// Raster extraction already supplies typed operation evidence. Do not feed it
// through CAD fallback rules, which turn counts into area and price every
// catalog allowance. Reuse the existing evidence/catalog reconciler internally;
// the original takeoff and its format remain unchanged.
export function isRasterTakeoff(takeoff={}) {
  return !takeoff.pdf_analysis && /\.(png|jpe?g|webp)$/i.test(takeoff.document_name||takeoff.analysis_source?.file_name||'');
}
const number = x => typeof x==='number'&&Number.isFinite(x)&&x>=0;
const round = x => Math.round((x+Number.EPSILON)*1e6)/1e6;
function polygonArea(points) {
  if(!Array.isArray(points)||points.length<3||points.length>500||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return 0;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
    if(i===0&&j===points.length-1)continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&
      Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&
      Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y)))return 0;
  }
  return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0))/2;
}

// A consistency check, not a replacement takeoff. Apply only to a complete
// inventory of dimensioned rectangular rooms and an explicit whole-wall claim.
// Even deducting every opening twice gives a conservative lower bound; an
// impossible claim must not acquire a catalog rate merely because it is typed.
function wallPaintIssue(takeoff, page, quantities, evidence) {
  const claim=evidence.paint_area?.[0],geometry=takeoff.area_geometry||takeoff.raw_result?.area_geometry;
  if(!claim||page.kind!=='floor_plan'||geometry?.basis!=='clear_internal')return null;
  const spaces=geometry.spaces||[],rooms=spaces.filter(s=>s.kind==='enclosed');
  if(rooms.length<2||rooms.length!==takeoff.rooms||spaces.some(s=>!['enclosed','outdoor'].includes(s.kind)))return null;
  if(page.drawing_id&&claim.scope_id!==page.drawing_id)return null;
  const basis=String(claim.evidence||''),notes=String(takeoff.notes||'');
  const allFaces=/\binternal faces:\s*external perimeter\b/i.test(basis)&&/\bboth faces\b/i.test(basis)||
    /\ball internal (?:wall )?faces\b/i.test(basis)||
    /\bwalls of\b/i.test(basis)&&rooms.every(s=>String(s.tag||'').trim()&&basis.toLowerCase().includes(s.tag.toLowerCase()));
  if(!allFaces||!(/\bnet\b/i.test(basis))||/\b(?:selected|partial|feature|half|cladding|panelling|tiled walls|wall tiles)\b/i.test(basis))return null;
  const heights=[...notes.matchAll(/\b(?:internal|enclosed|room|wall) heights?\s*(?:=|:|is|of)?\s*(\d+(?:\.\d+)?)\s*m\b/gi)].map(m=>Number(m[1]));
  if(!heights.length||heights.some(h=>h<=0||h!==heights[0])||/\b(?:varying|variable|sloping|stepped|double.height)\b/i.test(notes))return null;
  const tags=new Set(),bounds=[];let perimeter=0,enclosedArea=0,totalArea=0;
  for(const s of spaces){
    const tag=String(s.tag||'').trim(),p=s.polygon,area=polygonArea(p);
    if(!tag||tags.has(tag)||!area||!number(s.reported_area)||Math.abs(area-s.reported_area)>.02||p.length!==4)return null;
    tags.add(tag);
    if(p.some((a,i)=>{const b=p[(i+1)%4];return (a.x!==b.x&&a.y!==b.y)||(a.x===b.x&&a.y===b.y);}))return null;
    const box={left:Math.min(...p.map(a=>a.x)),right:Math.max(...p.map(a=>a.x)),bottom:Math.min(...p.map(a=>a.y)),top:Math.max(...p.map(a=>a.y))};
    if(bounds.some(b=>Math.min(b.right,box.right)-Math.max(b.left,box.left)>.001&&Math.min(b.top,box.top)-Math.max(b.bottom,box.bottom)>.001))return null;
    bounds.push(box);totalArea+=area;
    if(s.kind==='enclosed'){enclosedArea+=area;perimeter+=2*(box.right-box.left+box.top-box.bottom);}
  }
  if(!number(takeoff.floor_area)||!number(takeoff.ceiling_area)||Math.abs(totalArea-takeoff.floor_area)>.02||Math.abs(enclosedArea-takeoff.ceiling_area)>.02)return null;
  for(const [count,area] of [[takeoff.doors,quantities.door_area],[takeoff.windows,quantities.window_area]])
    if(!Number.isInteger(count)||count<0||!number(area)||(count>0&&area<=0)||(count===0&&area!==0))return null;
  const gross=round(perimeter*heights[0]);
  const minimum=round(Math.max(0,gross-2*(quantities.door_area+quantities.window_area)));
  const tolerance=Math.max(.02,gross*.001);
  if(claim.value>=minimum-tolerance&&claim.value<=gross+tolerance)return null;
  return {metricKey:'paint_area',claimedQuantity:claim.value,unit:'m2',minimum,maximum:gross,
    basis:`Measurement conflict: saved net wall paint ${claim.value} m2 is outside ${minimum}–${gross} m2 from dimensioned room perimeters (${perimeter} m), stated height (${heights[0]} m), and at most two faces per measured opening. Review the source; quantity withheld, not automatically corrected.`,
    originalEvidence:basis};
}

export function rasterOperationEvidence(takeoff) {
  const page=takeoff.page_evidence||takeoff.raw_result?.page_evidence;
  if(!page||!Array.isArray(page.quantities))throw Error('This image has no saved operation evidence. Complete quantity analysis before generating BOQ.');
  const warnings=[],groups=new Map(),blocked=new Set(),measurementIssues=[];
  for(const q of page.quantities){
    if(!PDF_METRIC_UNITS[q.key]||q.unit!==PDF_METRIC_UNITS[q.key]||!number(q.value)||
      (q.unit==='nr'&&!Number.isInteger(q.value))||!String(q.evidence||'').trim()){
      if(q.key)blocked.add(q.key);
      warnings.push(`Image evidence rejected: ${q.key||'unknown metric'} has invalid units, value or measurement basis.`);continue;
    }
    const scopes=groups.get(q.key)||new Map(),scope=String(q.scope_id||page.scope_id||'image');
    const old=scopes.get(scope);
    if(old&&Math.abs(old.value-q.value)>.001){blocked.add(q.key);warnings.push(`Conflicting image quantity: ${q.key}.`);}
    else scopes.set(scope,{...q,scope_id:scope,pages:[1]});
    groups.set(q.key,scopes);
  }
  const quantities={},evidence={};
  for(const [key,scopes] of groups){
    if(blocked.has(key))continue;
    // An explicitly declared image/project total wins over room subsets.
    // Unidentified multi-scope rows are not silently treated as disjoint totals.
    const total=scopes.get('project')||scopes.get(String(page.scope_id||''))||scopes.get(String(page.drawing_id||''));
    if(!total&&scopes.size!==1){blocked.add(key);warnings.push(`Image quantity ${key} needs scope reconciliation.`);continue;}
    const q=total||[...scopes.values()][0];quantities[key]=q.value;evidence[key]=[q];
  }
  const add=(key,value,basis)=>{
    if(blocked.has(key)||Object.hasOwn(quantities,key)||!number(value)||value<=0||PDF_METRIC_UNITS[key]==='nr'&&!Number.isInteger(value))return;
    quantities[key]=round(value);evidence[key]=[{key,value:quantities[key],unit:PDF_METRIC_UNITS[key],scope_id:'image',pages:[1],evidence:basis}];
  };
  if(page.kind==='floor_plan'){
    // A count is never a substitute for opening area. Preserve explicit zeros
    // as unknown where dimensions are missing; no assumed standard dimensions.
    for(const [key,field] of [['door_count','doors'],['window_count','windows'],['window_area','window_area'],['door_area','door_area']])
      add(key,takeoff[field],`Image extraction: ${field}; measured ${PDF_METRIC_UNITS[key]}, review against source.`);

    const geometry=takeoff.area_geometry||takeoff.raw_result?.area_geometry;
    const spaces=geometry?.basis==='clear_internal'?(geometry.spaces||[]).filter(s=>s.kind==='enclosed'):[];
    const inventory=takeoff.detected_items||[];
    // Only explicitly named ceramic finishes may use the corresponding room
    // polygons. Tile alone does not establish ceramic versus stone/porcelain.
    let ceramic=0;const tags=new Set();let valid=true;
    for(const s of spaces){
      const tag=String(s.tag||'').trim();if(!tag||tags.has(tag)){valid=false;break;}tags.add(tag);
      const matching=inventory.filter(i=>String(i.name||'').startsWith(tag));
      const text=[s.evidence,...matching.map(i=>i.description)].join(' ');
      if(!/\bceramic\b/i.test(text)||/\b(?:not|no|except|alternative)\b[^.;]*\bceramic\b/i.test(text))continue;
      const area=polygonArea(s.polygon);
      if(!area||(number(s.reported_area)&&Math.abs(s.reported_area-area)>.02)){valid=false;break;}
      ceramic+=area;
    }
    if(valid&&Number(takeoff.rooms)===1&&spaces.length===1&&Math.abs(ceramic-Number(takeoff.floor_area))<=.02)
      add('ceramic_floor_area',ceramic,'Explicit ceramic room finish; dimensioned clear internal room polygon agrees with the saved floor area.');
    // Legacy single-room images can omit paint_area while retaining an explicit
    // gross inside-face basis. Multi-room shared-opening deductions must come
    // from operation evidence, never from a single total opening area.
    const notes=String(takeoff.notes||'');
    if(Number(takeoff.rooms)===1&&/\bgross\b/i.test(notes)&&/\b(?:painted walls|wall paint)\b/i.test(
      [notes,...spaces.map(s=>s.evidence),...inventory.map(i=>i.description)].join(' '))&&
      number(takeoff.wall_area)&&number(takeoff.door_area)&&number(takeoff.window_area)&&
      (!(takeoff.doors>0)||takeoff.door_area>0)&&(!(takeoff.windows>0)||takeoff.window_area>0))
      add('paint_area',Math.max(0,takeoff.wall_area-takeoff.door_area-takeoff.window_area),
        `Gross internal wall faces ${takeoff.wall_area} minus measured door area ${takeoff.door_area} and window area ${takeoff.window_area}; single room.`);
    const issue=wallPaintIssue(takeoff,page,quantities,evidence);
    if(issue){measurementIssues.push(issue);warnings.push(issue.basis);delete quantities.paint_area;delete evidence.paint_area;}
  }
  // Adapter is private to the shared operation reconciler, not a reclassification
  // of the image as PDF and not a change to the stored analysis or 3D scene.
  return {adapter:{scheduled_quantities:quantities,pdf_analysis:{quantity_evidence:evidence}},warnings,measurementIssues};
}

function applyRasterDoorBudget(items,takeoff,adapter,prices,priceLevel) {
  const page=takeoff.page_evidence||takeoff.raw_result?.page_evidence;
  if(page?.kind!=='floor_plan')return items;
  const claims=adapter.pdf_analysis.quantity_evidence.door_count||[];
  const detail=[takeoff.notes,...claims.map(c=>c.evidence),
    ...(page.quantities||[]).filter(q=>/door/.test(q.key)).map(q=>q.evidence),
    JSON.stringify(takeoff.object_details?.doors||[])].join(' ');
  // An unspecified ordinary door may use the existing editable budget policy.
  // Special/material-specific doors must not inherit its timber assumption.
  if(/\b(?:garage|roller|shutter|overhead|steel|stainless|metal|alumini?um|glass|glazed|fib(?:re|er)glass|frp|grp|wpc|composite|upvc|pvc|fire|fireproof|fd\d+|security|acoustic|external|weatherproof|double[- ]leaf|double[- ]door|sliding|folding|revolving)\b/i.test(detail))return items;
  const count=adapter.scheduled_quantities.door_count,area=adapter.scheduled_quantities.door_area;
  if(area>0&&count>0&&area/count>2.5)return items;
  const doorRows=items.filter(i=>i.pdfEvidence?.metricKey==='door_count');
  if(!doorRows.length)return items;
  const priced=applyPdfDefaultSpecifications(doorRows,adapter,prices,priceLevel);
  const replacements=new Map(doorRows.map((row,i)=>[row,priced[i]]));
  return items.map(row=>{
    const next=replacements.get(row)||row;
    return next.defaultSpecification?.status==='applied'?{...next,source:'Image measured quantity + editable catalog specification assumption'}:next;
  });
}

export function buildRasterBoq({takeoff,prices=[],rules=[],projectId,projectName,priceLevel='standard',vatPercentage=5}) {
  const {adapter,warnings,measurementIssues}=rasterOperationEvidence(takeoff);
  const plan=planPdfCatalogRules(adapter,rules,prices);
  warnings.push(...plan.warnings.map(s=>s.replaceAll('PDF','Image')));
  const items=[];
  const byCode=new Map(prices.map(p=>[String(p.item_code||'').toUpperCase(),p]));
  for(const [code,q] of plan.bindings){
    const p=byCode.get(code);if(!p)continue;
    const rate=resolvePdfCatalogRate(p,priceLevel);
    items.push({itemCode:code,sectionCode:p.section_code||'07',section:p.category||'Measured work',
      description:p.description,unit:p.unit,quantity:q.quantity,rate:rate.rate,amount:boqLineAmount({quantity:q.quantity,rate:rate.rate}),
      rateSource:rate.source,rateMissing:rate.missingRate,status:rate.missingRate?'measured_rate_pending':'measured',
      verification:'pending',includeInCommercialTotal:false,source:'Image operation evidence',
      quantityBasis:'image_operation_evidence',pdfEvidence:{metricKey:q.metricKey,metricKeys:q.metricKeys,pages:[1],basis:q.evidence},
      imageEvidence:{metricKey:q.metricKey,basis:q.evidence},notes:q.evidence});
  }
  const unbound=retainUnboundPdfQuantities(items,adapter);
  warnings.push(...unbound.warnings.map(s=>s.replaceAll('PDF','Image')));
  for(const issue of measurementIssues)unbound.items.push({itemCode:'IMG-PAINT-MEASUREMENT-CONFLICT',
    section:'Internal finishes',description:'Wall paint — conflicting measurement, source review required',
    unit:'m2',quantity:0,rate:0,amount:0,rateMissing:true,status:'quantity_pending',verification:'pending',
    includeInCommercialTotal:false,source:'Image measurement consistency audit',
    imageEvidence:{metricKey:issue.metricKey,basis:issue.basis},measurementIssue:issue,notes:issue.basis});
  if(adapter.scheduled_quantities.window_count>0&&!adapter.scheduled_quantities.window_area){
    unbound.items.push({itemCode:'IMG-WINDOW-COUNT',section:'Doors and Windows',description:'Window sets — opening dimensions required',
      unit:'nr',quantity:adapter.scheduled_quantities.window_count,rate:0,amount:0,rateMissing:true,
      status:'measured_rate_pending',verification:'pending',includeInCommercialTotal:false,
      imageEvidence:{metricKey:'window_count',basis:'Saved window count; area unavailable.'},
      source:'Image operation evidence',notes:'Count retained as count. Supply measured window dimensions before area-based pricing.'});
  }
  const budgetItems=applyRasterDoorBudget(unbound.items,takeoff,adapter,prices,priceLevel);
  if(budgetItems.some(i=>i.pdfEvidence?.metricKey==='door_count'&&i.defaultSpecification?.status==='applied')){
    for(let i=warnings.length-1;i>=0;i--)if(warnings[i].startsWith('Image quantity door_count retained as an unpriced row;'))warnings.splice(i,1);
    warnings.push('Door budget uses the existing editable catalog specification assumption. Confirm material, opening size and required performance before tender approval.');
  }
  const finalItems=budgetItems.map((item,i)=>{
    const reviewed=requireBoqReview({...item,
    itemNumber:String(i+1).padStart(2,'0'),itemCode:item.itemCode?.replace(/^PDF-/,'IMG-'),
    source:String(item.source||'').replaceAll('PDF','Image'),notes:String(item.notes||'').replaceAll('PDF','Image'),
    quantityBasis:'image_operation_evidence',quantitySource:'image_operation_evidence',
    imageEvidence:item.imageEvidence||item.pdfEvidence,
    amount:boqLineAmount(item),
    });
    return item.defaultSpecification?.status==='applied'?{...reviewed,specificationVerification:'assumed'}:reviewed;
  });
  if(!finalItems.length)throw Error('No supported measurable operations were found in this image. Review dimensions and operation evidence; no allowance was invented.');
  const subtotal=currencySum(finalItems.filter(i=>!i.rateMissing).map(boqLineAmount));
  const budget=calculateBoqBudget({provisional:subtotal},{vatPercentage});
  return bindBoqSource({projectId,projectName,currency:'AED',priceLevel,takeoff,items:finalItems,
    calculationVersion:'image-operation-evidence-v1',measurementIssues,
    warnings:[...warnings,'Image quantities and catalog specifications require review. Unsupported work is not priced.'],
    assumptions:['Only saved image operation evidence is used. No CAD allowances or additional model requests.',
      ...finalItems.filter(i=>i.defaultSpecification?.status==='applied').map(i=>`Editable budget assumption: ${i.defaultSpecification.policy.label}; ${i.defaultSpecification.rateBasis}. ${i.defaultSpecification.policy.conditions||''}`)],
    summary:{totalItems:finalItems.length,verifiedSubtotal:0,provisionalSubtotal:subtotal,subtotal,
      vatPercentage,vatAmount:budget.vat,grandTotal:budget.total,commercialSafe:false,scopeCoverage:'unconfirmed'}},takeoff,projectId);
}
