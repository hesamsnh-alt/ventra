import {rateCatalogFromCsv} from './boqRateCsv.mjs';
import {planPdfCatalogBindings} from './pdfBoqCoverage.mjs';
import {boqUnitFactor,clearBoqGapNote} from './boqPriceSelection.mjs';
import {invalidateBoqReview,requireBoqReview} from './boqEvidence.mjs';
import {PDF_METRIC_UNITS} from './pdfTakeoffEvidence.mjs';

const metricKeys=row=>row.pdfEvidence?.metricKeys||[row.pdfEvidence?.metricKey].filter(Boolean);
const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-9);
const clearImportNote=s=>clearBoqGapNote(s).replace(/\s*\[PROJECT CSV\][\s\S]*?\[\/PROJECT CSV\]/g,'').trim();
function sourceUnit(row){
  const keys=metricKeys(row);
  // The earlier PDF builder displayed these explicit count schedules with a
  // catalog "point" unit. Recover their retained SOURCE unit, with the count
  // checked below. This is not a general point-to-device unit conversion.
  return String(row.unit).toLowerCase()==='point'&&row.quantityBasis==='pdf_schedule_evidence'&&keys.length===1&&
    ['light_count','socket_count','smoke_detector_count'].includes(keys[0])?'nr':row.unit;
}

// Apply explicit rates to existing, source-backed PDF rows in memory. This
// function cannot read/write a database or call a model. Unknown scopes stay
// unchanged, and quantities never come from the CSV or its reference answers.
export function applyProjectRateCsv(items,takeoff,csvText,{fileName='project-rates.csv',appliedAt=new Date().toISOString()}={}){
  if(!takeoff?.pdf_analysis?.quantity_evidence)throw Error('A PDF takeoff with retained source evidence is required.');
  if(!Array.isArray(items)||!items.length)throw Error('Generate the PDF BOQ before applying project rates.');
  const catalog=rateCatalogFromCsv(csvText),plan=planPdfCatalogBindings(takeoff,catalog);
  const positive=items.filter(i=>Number(i.quantity)>0),edits=new Map(),removed=new Set(),skipped=[];
  const filename=String(fileName).replace(/[\r\n]/g,' ').slice(0,200);
  for(const candidate of catalog){
    const binding=plan.bindings.get(candidate.item_code);if(!binding)continue;
    const keys=binding.metricKeys||[binding.metricKey],keySet=new Set(keys);
    const rows=positive.filter(i=>metricKeys(i).some(k=>keySet.has(k)));
    const seen=rows.flatMap(metricKeys);
    if(!rows.length||seen.length!==keys.length||new Set(seen).size!==seen.length||keys.some(k=>!seen.includes(k))){skipped.push(`${candidate.item_code}: current BOQ has missing, duplicated or overlapping quantity rows.`);continue;}
    if(rows.some(i=>i.quantitySource==='manual'||i.quantityBasis==='manual_quantity_override'||i.source==='manual'||i.status==='manual')){
      skipped.push(`${candidate.item_code}: manual quantity retained; project rates were not applied to it.`);continue;
    }
    // Check each existing measured row, not merely a coincidentally matching
    // composite total. A changed room/fixture count cannot hide in a pair sum.
    let supported=true;
    for(const row of rows){
      const atomic=metricKeys(row),unit=PDF_METRIC_UNITS[atomic[0]],factor=boqUnitFactor(sourceUnit(row),unit);
      const expected=atomic.reduce((n,k)=>n+Number(takeoff.scheduled_quantities?.[k]),0);
      if(atomic.some(k=>PDF_METRIC_UNITS[k]!==unit)||factor===null||!Number.isFinite(expected)||!close(Number(row.quantity)*factor,expected))supported=false;
    }
    const first=rows[0],factor=boqUnitFactor(sourceUnit(first),candidate.unit);
    const quantity=rows.reduce((n,row)=>{const f=boqUnitFactor(sourceUnit(row),candidate.unit);return f===null?NaN:n+Number(row.quantity)*f;},0);
    if(!supported||factor===null||!Number.isFinite(quantity)||!close(quantity,binding.quantity)){
      skipped.push(`${candidate.item_code}: current BOQ quantities/units differ from the retained source; no quantity was overwritten.`);continue;
    }
    const rate=candidate.standard_rate;
    const previous=rows.map(row=>({id:row.id,itemCode:row.itemCode,description:row.description,quantity:row.quantity,unit:row.unit,rate:row.rate,rateSource:row.rateSource}));
    const recoveredUnit=rows.some(row=>sourceUnit(row)!==row.unit);
    const note=`[PROJECT CSV] ${filename}; ${candidate.item_code}: ${candidate.description}; ${rate} AED/${candidate.unit}. Source-backed quantity preserved with compatible unit conversion.${recoveredUnit?' Earlier catalog point unit replaced with the explicit source schedule count unit; count checked against source.':''} Imported rates and specifications require review; this is not tender approval. [/PROJECT CSV]`;
    const notes=[...new Set(rows.map(i=>clearImportNote(i.notes)).filter(Boolean)),note].join(' ');
    const updated=requireBoqReview({...invalidateBoqReview(first),description:candidate.description,quantity,unit:candidate.unit,rate,referenceRate:rate,
      amount:quantity*rate,rateMissing:!(rate>0),status:rate>0?'provisional_estimate':'measured_rate_pending',verification:rate>0?'provisional':'pending',
      includeInCommercialTotal:false,reviewRequired:true,specificationVerification:'unconfirmed',source:'PDF evidence / project rate CSV',
      materialRate:0,laborRate:0,equipmentRate:0,transportRate:0,
      pdfEvidence:{...first.pdfEvidence,metricKey:binding.metricKey,...(binding.metricKeys?{metricKeys:binding.metricKeys}:{}),pages:binding.pages,basis:binding.evidence},
      rateSource:`Project CSV ${filename}: ${candidate.item_code} (${rate} AED/${candidate.unit})`,
      projectRateSelection:{fileName:filename,itemCode:candidate.item_code,description:candidate.description,unit:candidate.unit,rate,appliedAt,metricKeys:keys,previousRows:previous,sourceCountUnitRecovered:recoveredUnit},
      completion:{code:rate>0?'line_review_required':'project_rate_missing',required_information:[rate>0?'Review source quantity, applicable specification and imported project rate.':'A positive applicable project rate is required.']},notes});
    // A previous global catalog choice is historical, not the active rate.
    if(updated.catalogSelection){updated.previousCatalogSelection=updated.catalogSelection;delete updated.catalogSelection;}
    edits.set(first,updated);for(const row of rows.slice(1))removed.add(row);
  }
  if(!edits.size)throw Error('No project rates could be applied. Check CSV scopes/units and the current source-backed PDF BOQ.');
  const next=items.filter(i=>!removed.has(i)).map(i=>edits.get(i)||i);
  const appliedCodes=[...edits.values()].map(i=>i.projectRateSelection.itemCode);
  return {items:next,summary:{fileName:filename,appliedAt,catalogRows:catalog.length,appliedRows:edits.size,
    unboundCodes:catalog.filter(i=>!appliedCodes.includes(i.item_code)).map(i=>i.item_code),
    zeroRateRows:[...edits.values()].filter(i=>i.rate===0).length,mergedRows:removed.size,
    otherPricedRowsRetained:positive.filter(i=>!edits.has(i)&&!removed.has(i)&&Number(i.rate)>0).length,
    warnings:[...plan.warnings,...skipped],productionCatalogChanged:false}};
}
