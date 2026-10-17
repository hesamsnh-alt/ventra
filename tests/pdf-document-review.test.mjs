import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {calculatePdfMeasurement} from '../src/lib/pdfMeasurementCalculations.mjs';
import {mergePdfEvidence,PDF_METRIC_UNITS} from '../src/lib/pdfTakeoffEvidence.mjs';
import {retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';

const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-8.json','utf8'));
const geometry=JSON.parse(readFileSync('tests/fixtures/pdf-dimensioned-floors.json','utf8'));
const factor=(value,unit='m',pages=[3],operation='multiply')=>({value,unit,pages,operation,evidence:'Source printed operand'});
const term=(id,factors,operation='add')=>({id,factors,operation});
const calc=(key,terms,scope_id='project')=>({key,scope_id,terms,evidence:'Source dimensions and declared measurement convention'});
const run=c=>calculatePdfMeasurement(c,PDF_METRIC_UNITS,new Set([1,2,3,4,5,6,7,8]));

function sourceReview(){
  const pages=structuredClone(observed.page_results);
  // Controlled SOURCE transcription, not a live model response. Geometry is
  // independently specified in test fixtures, never inserted by production code.
  pages[0].document_measurement_review={floor_revisions:geometry.map((g,i)=>({pageNumber:i+1,source_pages:[i+1,6],
    evidence:'Plan boundary topology and source measurement specification',area_geometry:{...structuredClone(g),coverage:'complete'},
    detected_items:g.spaces.map(s=>({name:s.tag,unit:'m2',quantity:1,description:`${s.kind==='void'?'VOID':s.finish.toUpperCase()} | source printed zone label`}))})),
    calculations:[
      calc('column_volume',[term('net-column-storeys',[factor(39,'count'),factor(300,'mm'),factor(300,'mm'),factor(2.95)])]),
      calc('beam_volume',[term('FF-downstands',[factor(120),factor(.25),factor(.25)]),term('roof-downstands',[factor(117),factor(.25),factor(.25)])]),
      calc('foundation_formwork_area',[term('footing-sides',[factor(20,'count'),factor(4,'count'),factor(1.5),factor(.45)]),
        term('pedestal-sides',[factor(20,'count'),factor(4,'count'),factor(.45),factor(.6)])]),
      calc('column_formwork_area',[term('columns',[factor(39,'count'),factor(4,'count'),factor(.3),factor(2.95)])]),
      calc('beam_formwork_area',[term('two-downstand-sides',[factor(237),factor(2,'count'),factor(.25)])]),
      calc('slab_formwork_area',[term('FF-envelope',[factor(16),factor(12)]),term('FF-void',[factor(3),factor(4)],'subtract'),
        term('roof-envelope',[factor(16),factor(12)]),term('roof-terrace',[factor(3),factor(4)],'subtract')]),
    ],exclusions:['Stair flight concrete and backfill have no measured specification'],notes:'Test source transcription; AI extraction is not being tested here'};
  return pages;
}

test('observed report remains unresolved without new source evidence; no expected values are injected',()=>{
  const r=mergePdfEvidence(observed.page_results);assert.equal(r.floor_area,0);
  assert.equal(r.ceiling_area,0);assert.equal(r.ceramic_floor_area,0);
  assert.equal(r.pdf_analysis.document_measurement_review,null);
});
test('cross-page source revisions pass the geometry audit and compute omitted formwork from operands',()=>{
  const pages=sourceReview(),before=JSON.stringify(pages),r=mergePdfEvidence(pages);
  assert.equal(JSON.stringify(pages),before);
  assert.equal(r.floor_area,372);assert.equal(r.ceiling_area,360);assert.equal(r.wood_floor_area,178);
  assert.equal(r.ceramic_floor_area,154);assert.equal(r.epoxy_floor_area,28);assert.equal(r.terrace_floor_area,12);
  assert.ok(Math.abs(r.column_volume-10.3545)<1e-10);assert.equal(r.beam_volume,14.8125);
  assert.equal(r.foundation_formwork_area,75.6);assert.ok(Math.abs(r.column_formwork_area-138.06)<1e-10);
  assert.equal(r.beam_formwork_area,118.5);assert.equal(r.slab_formwork_area,360);
  assert.equal(r.doors,19);assert.equal(r.window_area,39.06);
  const replay=mergePdfEvidence(r.page_results);
  for(const k of ['floor_area','ceiling_area','ceramic_floor_area','column_volume','beam_volume','foundation_formwork_area'])assert.equal(replay[k],r[k]);
  assert.equal(replay.pdf_analysis.document_measurement_review.calculations.length,6);
  assert.deepEqual(r.pdf_analysis.quantity_evidence.column_volume[0].pages,[3]);
  assert.deepEqual(r.pdf_analysis.quantity_evidence.floor_area.find(q=>q.scope_id==='floor:1').pages,[2,6]);
  const rows=retainUnboundPdfQuantities([],r).items;
  assert.ok(rows.some(i=>i.itemCode==='PDF-COLUMN_FORMWORK_AREA'&&i.quantity>138));
  assert.ok(rows.every(i=>i.rate===0&&i.includeInCommercialTotal===false));
});
test('source review cannot bypass overlapping or incomplete geometry',()=>{
  for(const mutate of [p=>p[0].document_measurement_review.floor_revisions[1].area_geometry.spaces.pop(),
    p=>p[0].document_measurement_review.floor_revisions[1].area_geometry.spaces[3].polygon[1].x=10]){
    const p=sourceReview();mutate(p);const r=mergePdfEvidence(p);assert.equal(r.floor_area,0);assert.equal(r.ceramic_floor_area,0);
  }
});
test('dimensions vary independently of the supplied benchmark',()=>{
  const c=calc('foundation_volume',[term('source-footings',[factor(7,'count'),factor(2.2),factor(1.7),factor(.55)])]);
  assert.ok(Math.abs(run(c).value-14.399)<1e-10);
  const pages=sourceReview();for(const r of pages[0].document_measurement_review.floor_revisions){
    for(const poly of [r.area_geometry.envelope,...r.area_geometry.spaces.map(s=>s.polygon)])for(const v of poly){v.x=v.x*1.5+37;v.y=v.y*2-14;}
  }
  const r=mergePdfEvidence(pages);assert.equal(r.floor_area,1116);assert.equal(r.wood_floor_area,534);
  assert.equal(r.ceramic_floor_area,462);
});
test('rebar uses sourced diameter, count, cut length and divisor without intermediate rounding',()=>{
  const rows=[[12,480,1.4],[10,480,1.4],[16,160,1.2],[8,100,1.64],[16,312,3.7],[8,780,.96],[16,1,1044],[8,1185,1.32],[12,1,7200]];
  const c=calc('rebar_kg',rows.map(([d,n,l],i)=>term(`BBS-${i}`,[factor(n,'count',[8]),factor(l,'m',[8]),factor(d,'mm',[8]),factor(d,'mm',[8]),factor(162,'m_mm2_per_kg',[8],'divide')])));
  assert.ok(Math.abs(run(c).value-12168.138271604938)<1e-8);
});
test('units, source pages, counts, negative nets and duplicate physical terms are checked',()=>{
  const good=()=>calc('foundation_volume',[term('footings',[factor(2,'count'),factor(1),factor(1),factor(1)])]);
  for(const mutate of [c=>c.terms[0].factors.pop(),c=>c.terms[0].factors[0].pages=[999],c=>c.terms[0].factors[0].value=1.5,
    c=>c.terms.push(c.terms[0]),c=>{c.terms[0].operation='subtract';},c=>{c.terms[0].factors[0].value=0;c.terms[0].factors[0].operation='divide';},
    c=>c.terms[0].factors[0].evidence='',c=>c.key='floor_area']){
    const c=good();mutate(c);assert.throws(()=>run(c));
  }
});
test('wet-wall tiles and membrane clip openings at their own heights, rather than deducting full windows',()=>{
  const clipped=(height,sill,limit)=>({...factor(null,'m',[4,5,6]),clip:{opening_height_m:height,sill_m:sill,finish_height_m:limit}});
  const net=(key,height)=>run(calc(key,[term('four-wet-room-perimeters',[factor(54,'m',[1,2]),factor(height,'m',[6])]),
    term('wet-room-doors',[factor(4,'count',[6]),factor(.9,'m',[4,5]),clipped(2.1,0,height)],'subtract'),
    term('wet-room-windows',[factor(4,'count',[6]),factor(1.2,'m',[4,5]),clipped(1.2,1.4,height)],'subtract')])).value;
  assert.ok(Math.abs(net('wet_wall_tile_area',2.4)-117.24)<1e-10);
  assert.ok(Math.abs(net('wet_wall_waterproofing_area',2)-97.92)<1e-10);
  assert.equal(run(calc('wet_wall_tile_area',[term('window-above-finish',[factor(1.2),clipped(1.2,3,2.4)])])).value,0);
});
test('bad reviewed calculation blocks stale aggregate values and duplicate aliased scopes',()=>{
  const p=sourceReview();p[0].document_measurement_review.calculations[0].terms[0].factors[0].pages=[99];
  const r=mergePdfEvidence(p);assert.equal(r.column_volume,0);assert.equal(r.scheduled_quantities.column_volume,0);
  assert.equal(r.pdf_analysis.quantity_evidence.column_volume,undefined);
  const q=sourceReview();q[0].document_measurement_review.calculations=[calc('door_count',[term('doors',[factor(7,'count')])],'GF'),calc('door_count',[term('doors',[factor(8,'count')])],'ground floor')];
  assert.equal(mergePdfEvidence(q).doors,0);
});
test('review operands cannot cite pages omitted from the review packet',()=>{
  const p=sourceReview();p[0].document_review_status={status:'completed',source_pages:[1,2,6]};
  const r=mergePdfEvidence(p);assert.equal(r.column_volume,0);assert.equal(r.floor_area,372);
});
test('conflicting source revisions cannot be resolved by invented project totals',()=>{
  const p=sourceReview();p.push({...structuredClone(p[0]),pageNumber:9,page_evidence:{...p[0].page_evidence,revision:'R2'},document_measurement_review:undefined});
  const r=mergePdfEvidence(p);assert.equal(r.pdf_analysis.document_measurement_review.status,'withheld');
  assert.equal(r.foundation_formwork_area,undefined);
});
test('full door categories do not duplicate the aggregate; incomplete categories retain aggregate',()=>{
  const quantities=[['door_count',19],['internal_door_count',15],['service_door_count',2],['entrance_door_count',1],['garage_door_count',1]].map(([key,value])=>({key,value,unit:'nr',scope_id:'project',evidence:'Complete source opening classification'}));
  const page={pageNumber:4,page_evidence:{kind:'opening_schedule',scope_id:'project',quantities}};
  const rows=retainUnboundPdfQuantities([],mergePdfEvidence([page])).items;
  assert.equal(rows.length,4);assert.ok(!rows.some(i=>i.itemCode==='PDF-DOOR_COUNT'));
  assert.equal(rows.reduce((n,i)=>n+i.quantity,0),19);
  page.page_evidence.quantities.pop();const incomplete=retainUnboundPdfQuantities([],mergePdfEvidence([page])).items;
  assert.equal(incomplete.length,1);assert.equal(incomplete[0].quantity,19);
});

function reviewService(client){
  const schemaSource=readFileSync('src/services/takeoffSchema.js','utf8').replace(/^import[^\n]*\n/,'').replace('export const takeoffSchema','const takeoffSchema');
  const serviceSource=readFileSync('src/services/pdfDocumentReviewService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
  const sandbox={PDF_METRIC_UNITS,pdfAnalysisCacheKey,isPdfCreditBalanceError,structuredClone,getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text),File,console,process:{env:{}}};
  vm.createContext(sandbox);vm.runInContext(schemaSource+'\n'+serviceSource+'\nthis.review=reviewPdfDocumentMeasurements;this.schema=pdfDocumentReviewSchema;',sandbox);
  return sandbox;
}
test('review API uses only the source packet and original page numbering, strict schema, existing model and cleanup',async()=>{
  let payload,deleted,indexes;
  const service=reviewService({files:{create:async()=>({id:'source-file'}),delete:async id=>{deleted=id;}},responses:{create:async p=>{payload=p;return {output_text:JSON.stringify({floor_revisions:[],calculations:[],exclusions:[],notes:''})};}}});
  const result=await service.review({pdf:{},pages:observed.page_results,audit:{},extractPagePacket:async(_,i)=>{indexes=i;return new Uint8Array([1]);}});
  assert.equal(result.status,'completed');assert.equal(deleted,'source-file');assert.equal(indexes.length,8);
  assert.equal(payload.text.format.strict,true);assert.match(payload.input[0].content[0].text,/original pages in this exact order: 1, 2, 3, 4, 5, 6, 7, 8/);
  function strict(s){if(s.properties){assert.equal(s.additionalProperties,false);assert.equal(JSON.stringify([...s.required].sort()),JSON.stringify(Object.keys(s.properties).sort()));Object.values(s.properties).forEach(strict);}if(s.items)strict(s.items);}
  strict(service.schema);
});
test('review upload/model/extraction failures retain earlier page evidence with visible failure status',async()=>{
  const client={files:{create:async()=>({id:'source-file'}),delete:async()=>{}},responses:{create:async()=>{throw Error('model unavailable');}}};
  const service=reviewService(client),args={pdf:{},pages:observed.page_results,audit:{},extractPagePacket:async()=>new Uint8Array([1])};
  assert.equal((await service.review(args)).status,'failed');
  assert.equal((await service.review({...args,extractPagePacket:async()=>{throw Error('packet extraction failed');}})).status,'failed');
  const pages=structuredClone(observed.page_results);pages[0].document_review_status={status:'failed',reason:'model unavailable'};
  assert.ok(mergePdfEvidence(pages).pdf_analysis.conflicts.some(w=>w.includes('model unavailable')));
});
test('large review sets are explicitly pending, never silently truncated or submitted',async()=>{
  let called=false;const service=reviewService({});
  const pages=Array.from({length:21},(_,i)=>({...observed.page_results[0],pageNumber:i+1}));
  const result=await service.review({pdf:{},pages,audit:{},extractPagePacket:async()=>{called=true;return new Uint8Array([1]);}});
  assert.equal(result.status,'pending');assert.equal(called,false);
});
test('actual multi-page orchestration persists source review for replay without changing initial page analysis',async()=>{
  const source=readFileSync('src/services/largePdfAnalysisService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
  let analyses=0,reviews=0;
  const sandbox={needsPdfSourceMeasurements:()=>false,reviewPdfSourceMeasurements:async()=>({status:'not_required'}),mergePdfEvidence,URL,process:{env:{}},console:{log(){},warn(){}},buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},
    pdfAnalysisCacheKey:()=> 'isolated-test',readPdfAnalysisCache:async()=>null,writePdfAnalysisCache:async()=>true,coalescePdfAnalysis:async(_,work)=>work(),
    fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([1]).buffer}),
    loadPdf:async()=>({pdf:{},totalPages:8}),extractPdfPage:async()=>new Uint8Array([1]),extractPdfPagePacket:async()=>new Uint8Array([1]),
    runPageQueue:async({pages,context})=>{analyses+=pages.length;assert.equal(context.sourceFileName,'source.pdf');return observed.page_results.map(result=>({success:true,result:structuredClone(result)}));},
    reviewPdfDocumentMeasurements:async({pages,audit})=>{reviews++;assert.equal(pages.length,8);assert.ok(audit.withheld_area_metrics.length);return {status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:sourceReview()[0].document_measurement_review};},Uint8Array};
  vm.createContext(sandbox);vm.runInContext(source+'\nthis.analyze=analyzeLargePdf;',sandbox);
  const r=await sandbox.analyze({fileUrl:'https://source.invalid/drawing.pdf',fileName:'source.pdf'});
  assert.equal(analyses,8);assert.equal(reviews,1);assert.equal(r.floor_area,372);assert.equal(r.analyzed_pages,8);
  assert.equal(mergePdfEvidence(r.page_results).floor_area,372);assert.equal(reviews,1);
});
