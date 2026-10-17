// Pure arithmetic over source measurements. No eval, project constants or rates.
// AI supplies operands and provenance; this module computes and checks units.
import {calculatePdfSourceMeasurements} from './pdfSourceMeasurements.mjs';
import {nativePdfDocumentCalculations} from './pdfNativeDocumentCalculations.mjs';
import {auditPdfAreaGeometry} from './pdfAreaGeometry.mjs';
import {buildNativePdfSourceBasis} from './pdfNativeSourceBasis.mjs';
const units = {
  scalar: [1, 0, 0], count: [1, 0, 0], nr: [1, 0, 0],
  m: [1, 1, 0], mm: [.001, 1, 0], m2: [1, 2, 0], m3: [1, 3, 0],
  kg: [1, 0, 1], ton: [1000, 0, 1], kg_per_m: [1, -1, 1],
  m_mm2_per_kg: [1e-6, 3, -1],
};
const nonempty = s => typeof s === 'string' && s.trim().length > 0;
export const PDF_AREA_KEYS = ['floor_area','ceiling_area','wood_floor_area','ceramic_floor_area','epoxy_floor_area','terrace_floor_area'];

// Units alone cannot catch a repeated physical surface. Withhold an explicitly
// contradictory soffit calculation; never replace it with a benchmark total.
export function assertPdfSoffitCoverage(calculation, notes = '') {
  if (calculation?.key !== 'slab_formwork_area') return;
  const convention = `${calculation.evidence || ''} ${notes}`;
  const includesBeams = /slab\s+soffit\s+(?:already\s+)?includes?\s+beam\s+(?:undersides?|soffits?)/i.test(convention) ||
    /beam\s+(?:undersides?|soffits?)\s+(?:are\s+)?included\s+(?:within|in)\s+slab/i.test(convention);
  const addsBeamSoffit = (calculation.terms || []).some(term => term.operation === 'add' &&
    /beam[\s_-]*(?:soffit|underside)|(?:soffit|underside)[\s_-]*beam/i.test(`${term.id} ${(term.factors || []).map(f=>f.evidence).join(' ')}`));
  if (includesBeams && addsBeamSoffit) throw Error('Slab soffit includes beam undersides but calculation adds them again; source coverage review required');
}

// A narrow canonicalization of a fully expressed rectangular soffit: sourced
// gross envelope minus openings already includes beam undersides. Repeated
// beam strips can be removed only when their physical group matches that
// envelope, no other deductions reinterpret the surface, and every term passes
// the existing provenance/unit checks. Unknown geometry remains withheld.
export function reconcilePdfSoffitCoverage(calculation, notes, metricUnits, availablePages) {
  try {assertPdfSoffitCoverage(calculation,notes);return {calculation,adjustment:null};}
  catch (contradiction) {
    const rulePages=[...new Set([...String(calculation.evidence||'').matchAll(/\bp(?:age)?\s*(\d+)\b/gi)].map(m=>Number(m[1])))];
    if(!rulePages.length||rulePages.some(p=>!availablePages.has(p)))throw contradiction;
    const baseGroups=new Map(),beamTerms=[];
    for (const term of calculation.terms || []) {
      const id=String(term.id||'').toLowerCase();
      const gross=id.match(/^(.+?)[_-]slab[_-]soffit[_-]gross$/);
      const opening=id.match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/);
      const beam=id.match(/^(.+?)[_-]beam[_-](?:soffits?|undersides?)$/);
      // This is deliberately stricter than recognizing a narrative mention.
      if (!Array.isArray(term.factors)||term.factors.length!==2||term.factors.some(f=>f.unit!=='m'||f.operation!=='multiply'||f.clip)) throw contradiction;
      calculatePdfMeasurement({...calculation,terms:[{...term,operation:'add'}]},metricUnits,availablePages);
      if (gross && term.operation==='add' && term.factors.every(f=>/envelope|\bgross\b/i.test(f.evidence))) {
        if (baseGroups.has(gross[1])) throw contradiction;
        baseGroups.set(gross[1],{area:term.factors[0].value*term.factors[1].value,omitted:0,beamArea:0});
      } else if (opening && term.operation==='subtract') {
        // Matched to its gross physical group after the whole inventory is read.
      } else if (beam && term.operation==='add') beamTerms.push({term,group:beam[1]});
      else throw contradiction;
    }
    if (!baseGroups.size||!beamTerms.length) throw contradiction;
    for (const term of calculation.terms) if(term.operation==='subtract') {
      const group=term.id.toLowerCase().match(/^(.+?)[_-]slab[_-](?:soffit[_-])?(?:void|terrace|opening)(?:[_-](?:omit|deduct))?$/)?.[1];
      if(!baseGroups.has(group))throw contradiction;
      baseGroups.get(group).omitted+=term.factors[0].value*term.factors[1].value;
    }
    for (const {term,group} of beamTerms) {
      if(!baseGroups.has(group))throw contradiction;
      baseGroups.get(group).beamArea+=term.factors[0].value*term.factors[1].value;
    }
    if([...baseGroups.values()].some(g=>g.area-g.omitted<=0||g.beamArea>g.area-g.omitted))throw contradiction;
    const removed=new Set(beamTerms.map(x=>x.term.id));
    const adjusted={...calculation,terms:calculation.terms.filter(t=>!removed.has(t.id)),
      evidence:`${calculation.evidence} Coverage reconciliation: full sourced envelope minus openings already includes beam undersides; omitted repeated strips ${[...removed].join(', ')}.`};
    // Validate the complete original too, so canonicalization cannot hide an
    // invalid operand, duplicated term identity or contradictory original net.
    calculatePdfMeasurement(calculation,metricUnits,availablePages);
    calculatePdfMeasurement(adjusted,metricUnits,availablePages);
    return {calculation:adjusted,adjustment:{key:calculation.key,scope_id:calculation.scope_id,
      removed_terms:[...removed],source_pages:rulePages,reason:'Explicit included beam undersides duplicated within fully sourced gross soffit envelopes'}};
  }
}

export function calculatePdfMeasurement(calculation, metricUnits, availablePages) {
  const {key, scope_id: scope, evidence, terms} = calculation || {};
  const expected = units[metricUnits[key]];
  if (!expected || !nonempty(scope) || !nonempty(evidence)) throw Error('Missing metric, scope or measurement evidence');
  // These require spatial validation; an arithmetic total cannot bypass it.
  if (PDF_AREA_KEYS.includes(key)) throw Error('Floor and finish areas require audited space geometry');
  if (!Array.isArray(terms) || !terms.length || terms.length > 500) throw Error('Missing or excessive calculation terms');
  let value = 0;
  const pages = new Set(), termIds = new Set(), basis = [];
  for (const term of terms) {
    if (!nonempty(term.id) || termIds.has(term.id)) throw Error('Missing or repeated physical term identity');
    termIds.add(term.id);
    if (!['add','subtract'].includes(term.operation) || !Array.isArray(term.factors) || !term.factors.length || term.factors.length > 16) throw Error('Invalid measurement term');
    let product = 1, length = 0, mass = 0;
    const factors = [];
    for (const input of term.factors) {
      const unit = units[input.unit];
      let operand = input.value;
      if (input.clip) {
        const {opening_height_m:h,sill_m:s,finish_height_m:f} = input.clip;
        if (input.value !== null || input.unit !== 'm' || ![h,s,f].every(n=>Number.isFinite(n)&&n>=0&&n<=1e6)) throw Error('Invalid clipped opening heights');
        operand = Math.max(0,Math.min(h,f-s));
      }
      if (!unit || !Number.isFinite(operand) || operand < 0 || operand > 1e12 ||
          !['multiply','divide'].includes(input.operation) || !nonempty(input.evidence) ||
          !Array.isArray(input.pages) || !input.pages.length || input.pages.some(p => !availablePages.has(p))) throw Error('Invalid or unsourced measurement operand');
      if (['count','nr'].includes(input.unit) && !Number.isInteger(operand)) throw Error('Fractional counted operand');
      const divisor = input.operation === 'divide';
      if (divisor && operand === 0) throw Error('Zero measurement divisor');
      product = divisor ? product / (operand * unit[0]) : product * operand * unit[0];
      length += (divisor ? -1 : 1) * unit[1]; mass += (divisor ? -1 : 1) * unit[2];
      input.pages.forEach(p => pages.add(p));
      factors.push(`${divisor ? '/' : '*'} ${operand} ${input.unit} [${input.evidence}${input.clip ? '; clip '+JSON.stringify(input.clip) : ''}]`);
    }
    if (length !== expected[1] || mass !== expected[2] || !Number.isFinite(product)) throw Error('Calculation dimensions do not match metric unit');
    value += term.operation === 'subtract' ? -product : product;
    basis.push(`${term.operation} ${term.id}: ${factors.join(' ')}`);
  }
  if (!Number.isFinite(value) || value < -1e-8 || value > 1e12) throw Error('Invalid net measurement');
  value = Math.max(0, value);
  if (metricUnits[key] === 'nr' && !Number.isInteger(value)) throw Error('Fractional counted result');
  return {key, scope_id: scope, value, unit: metricUnits[key], pages: [...pages].sort((a,b)=>a-b),
    evidence: `${evidence}. Independently calculated: ${basis.join('; ')} = ${value} ${metricUnits[key]}. Source transcription requires review.`};
}

// Persist the review with an existing page result so Generate BOQ and stored
// report replay use exactly the same evidence, without another model call.
export function applyPdfDocumentReview(inputPages, metricUnits, normalizeScope = s=>String(s).trim().toLowerCase()) {
  const host = inputPages.find(p => p.document_measurement_review);
  if (!host) return {pages: inputPages, audit: null, warnings: [], blocked: []};
  const review = host.document_measurement_review;
  const actualPages = new Set(inputPages.map(p => p.pageNumber));
  const sourcePages = host.document_review_status?.source_pages;
  const available = new Set(sourcePages?.length ? sourcePages.filter(p=>actualPages.has(p)) : actualPages);
  const revisionsByDrawing = new Map();
  for (const p of inputPages) {
    const e=p.page_evidence;
    const id=e?.drawing_id || (e?.kind==='floor_plan' ? normalizeScope(e.scope_id) : null);
    if (!id) continue;
    const revisions=revisionsByDrawing.get(id)||new Set();revisions.add(e.revision);
    revisionsByDrawing.set(id,revisions);
  }
  if ([...revisionsByDrawing.values()].some(r=>r.size>1)) return {pages:inputPages,blocked:[],
    audit:{status:'withheld',reason:'Conflicting source revisions'},warnings:['PDF document review withheld: conflicting source revisions require selection.']};
  const pages = inputPages.map(p => ({...p, page_evidence: p.page_evidence ? {...p.page_evidence, quantities: [...(p.page_evidence.quantities || [])]} : undefined}));
  const warnings = [], accepted = [], rejected = [], revised = [], adjustments = [], blocked = new Set(), identities = new Set();
  const revisions = review.floor_revisions || [];
  const targetCounts = new Map();
  for (const r of revisions) targetCounts.set(r.pageNumber, (targetCounts.get(r.pageNumber)||0)+1);
  for (const r of revisions) {
    const p = pages.find(p => p.pageNumber === r.pageNumber);
    if (!p || p.page_evidence?.kind !== 'floor_plan' || targetCounts.get(r.pageNumber) !== 1 || !r.area_geometry ||
        !nonempty(r.evidence) || !Array.isArray(r.source_pages) || !r.source_pages.includes(r.pageNumber) || r.source_pages.some(n => !available.has(n)) ||
        !Array.isArray(r.detected_items) || !r.detected_items.length) {
      warnings.push(`PDF document review: invalid floor revision on page ${r.pageNumber}`); continue;
    }
    // The subsequent geometry audit still checks coverage, overlap and labels.
    p.document_original_area_evidence = p.document_original_area_evidence || {
      area_geometry: p.area_geometry, detected_items: p.detected_items,
      fields: Object.fromEntries(PDF_AREA_KEYS.map(k => [k, p[k] || 0]))};
    p.area_geometry = r.area_geometry; p.detected_items = r.detected_items;
    p.document_area_source_pages = r.source_pages;
    delete p.__areaGeometryValidated;
    revised.push({page: r.pageNumber, source_pages: r.source_pages, evidence: r.evidence});
  }
  // Source measurement arithmetic needs the validated room inventory too.
  // A review response can contain usable polygons but omit its room rows.
  // Recover only source-labelled rows before deriving ceilings/finish rules.
  for(const p of pages)if(p.page_evidence?.kind==='floor_plan'&&p.native_plan_text?.status==='readable'){
    const checked=auditPdfAreaGeometry(p);
    if(checked.audit?.status!=='withheld')Object.assign(p,checked.page);
  }
  const nativeFresh=host.native_measurement_basis&&pages.some(p=>p.native_graphics?.status==='readable')?
    buildNativePdfSourceBasis(pages,normalizeScope):null;
  if(nativeFresh){const target=pages.find(p=>p.pageNumber===host.pageNumber);target.native_measurement_basis=nativeFresh.basis;target.native_source_status={source_pages:nativeFresh.source_pages,geometry:nativeFresh.geometry};}
  const sourceAvailable=new Set((host.source_measurement_status?.source_pages||[]).filter(p=>available.has(p)));
  const sourceResult=review.measurement_basis?calculatePdfSourceMeasurements(review.measurement_basis,pages,metricUnits,sourceAvailable):null;
  const nativeAvailable=new Set((nativeFresh?.source_pages||host.native_source_status?.source_pages||[]).filter(p=>available.has(p)));
  const nativeBasis=nativeFresh?.basis||host.native_measurement_basis;
  const nativeResult=nativeBasis?calculatePdfSourceMeasurements(nativeBasis,pages,metricUnits,nativeAvailable):null;
  const nativeDocument=nativePdfDocumentCalculations(pages,review,c=>calculatePdfMeasurement(c,metricUnits,available));
  const nativeKeys=new Set([...(nativeResult?.calculations.map(c=>c.key)||[]),...nativeDocument.calculations.map(c=>c.key)]);
  const derivedKeys=new Set([...(sourceResult?.calculations.map(c=>c.key)||[]),...nativeKeys]);
  const allCalculations=[...(review.calculations||[]).filter(c=>!derivedKeys.has(c.key)),...(sourceResult?.calculations||[]).filter(c=>!nativeKeys.has(c.key)),...(nativeResult?.calculations||[]),...nativeDocument.calculations];
  // A newer explicit incomplete source inventory cannot validate an earlier
  // AI aggregate from that same review. Keep the raw claim for diagnostics,
  // but suppress every affected operation at the pricing boundary.
  for(const key of sourceResult?.blocked||[])if(!nativeKeys.has(key))blocked.add(key);
  warnings.push(...(sourceResult?.issues||[]).map(s=>`PDF source measurement withheld: ${s}`));
  warnings.push(...(nativeResult?.issues||[]).map(s=>`PDF native source measurement pending: ${s}`));
  warnings.push(...nativeDocument.issues.map(s=>`PDF native document measurement pending: ${s}`));
  for (const c of allCalculations) {
    const id = `${c.key}|${normalizeScope(c.scope_id)}`;
    try {
      if (identities.has(id)) throw Error('Duplicate complete metric/scope calculation');
      identities.add(id);
      const reconciled = reconcilePdfSoffitCoverage(c, review.notes, metricUnits, available);
      assertPdfSoffitCoverage(reconciled.calculation, review.notes);
      const claim = calculatePdfMeasurement(reconciled.calculation, metricUnits, available);
      if(reconciled.adjustment){
        claim.pages=[...new Set([...claim.pages,...reconciled.adjustment.source_pages])].sort((a,b)=>a-b);
        adjustments.push(reconciled.adjustment);
      }
      accepted.push(claim);
    } catch (error) {
      rejected.push({key: c.key, scope_id: c.scope_id, reason: error.message});
      if (metricUnits[c.key] && !PDF_AREA_KEYS.includes(c.key)) blocked.add(c.key);
      warnings.push(`PDF document calculation ${c.key} withheld: ${error.message}`);
    }
  }
  for (const key of blocked) {
    for (const p of pages) {
      if (Object.hasOwn(p,key)) p[key] = 0;
      p.page_evidence?.quantities.splice(0, p.page_evidence.quantities.length,
        ...p.page_evidence.quantities.filter(q => q.key !== key));
    }
  }
  const target = pages.find(p => p.pageNumber === host.pageNumber);
  // Complete review claims replace the earlier AI-calculated claim for exactly
  // the same physical scope. Other scopes still reconcile through the merger.
  for (const q of accepted.filter(q => !blocked.has(q.key))) {
    for (const p of pages) if (p.page_evidence) p.page_evidence.quantities = p.page_evidence.quantities.filter(old =>
      old.key !== q.key || normalizeScope(old.scope_id) !== normalizeScope(q.scope_id));
    target.page_evidence.quantities = target.page_evidence.quantities.filter(old => !(old.document_calculated && old.key === q.key && old.scope_id === q.scope_id));
    target.page_evidence.quantities.push({...q, document_calculated: true});
  }
  return {pages, blocked: [...blocked], warnings, audit: {status: 'source_document_review',
    floor_revisions: revised, calculations: accepted.filter(q=>!blocked.has(q.key)), rejected, adjustments,
    source_measurements:sourceResult?{status:sourceResult.blocked.length?'incomplete':'calculated',issues:sourceResult.issues}:null,
    native_source_measurements:nativeResult?{status:nativeResult.blocked.length?'partial':'provisional',issues:nativeResult.issues,derived_keys:[...nativeKeys],geometry:host.native_source_status?.geometry||[],requires_review:true}:null,
    exclusions: [...new Set([...(review.exclusions || []).filter(s=>!derivedKeys.has(s)),...(review.measurement_basis?.exclusions||[])])].filter(nonempty),
    notes: [review.notes,review.measurement_basis?.notes].filter(nonempty).join('\n')}};
}
