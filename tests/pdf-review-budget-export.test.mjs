import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {latestPdfReportForExport} from '../src/lib/pdfReportExport.mjs';
import {assertPdfSoffitCoverage,applyPdfDocumentReview} from '../src/lib/pdfMeasurementCalculations.mjs';
import {PDF_METRIC_UNITS,mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-19.json','utf8'));
const f=(value,unit,evidence)=>({value,unit,evidence,pages:[3],operation:'multiply',clip:null});
const term=(id,operation,values)=>({id,operation,factors:values.map(([v,u,e])=>f(v,u,e))});
function slab(length=16,width=12,beamLength=120){return {key:'slab_formwork_area',scope_id:'project',evidence:'Slab soffit includes beam undersides',terms:[
  term('ff_slab_soffit_gross','add',[[length,'m','Envelope length'],[width,'m','Envelope width']]),
  term('ff_slab_void_omit','subtract',[[3,'m','Stair void length'],[4,'m','Stair void width']]),
  term('roof_slab_soffit_gross','add',[[length,'m','Envelope length'],[width,'m','Envelope width']]),
  term('roof_slab_terrace_omit','subtract',[[3,'m','Terrace length'],[4,'m','Terrace width']]),
  term('ff_beam_soffits','add',[[beamLength,'m','Beam length'],[.25,'m','Beam soffit width']]),
  term('roof_beam_soffits','add',[[117,'m','Beam length'],[.25,'m','Beam soffit width']]),
]};}
test('an ambiguous soffit inventory is withheld without substituting reference quantities or removing valid beam sides',()=>{
 for (const dimensions of [[16,12,120],[20,15,95]]) {
  const c=slab(...dimensions);c.terms[0].id='unclassified_surface';assert.throws(()=>assertPdfSoffitCoverage(c),/adds them again/);
  const pages=structuredClone(observed.page_results);pages[0].document_measurement_review={floor_revisions:[],calculations:[c],exclusions:[],notes:''};pages[0].document_review_status={source_pages:[1,2,3,4,5,6,7,8]};
  const audit=applyPdfDocumentReview(pages,PDF_METRIC_UNITS);assert.ok(audit.blocked.includes('slab_formwork_area'));assert.equal(audit.audit.calculations.length,0);
  const merged=mergePdfEvidence(pages);assert.equal(merged.slab_formwork_area,0);assert.equal(merged.column_formwork_area,138.06);assert.equal(merged.floor_area,372);
 }
});
test('soffit guard permits the complete slab surface without a redundant beam term and does not reinterpret unspecified source conventions',()=>{
 const c=slab();c.terms=c.terms.slice(0,4);assert.doesNotThrow(()=>assertPdfSoffitCoverage(c));
 const unspecified=slab();unspecified.evidence='Separate measurement schedule';assert.doesNotThrow(()=>assertPdfSoffitCoverage(unspecified));
 const beam=slab();beam.key='beam_formwork_area';assert.doesNotThrow(()=>assertPdfSoffitCoverage(beam));
});
const saved={document_id:'pdf',analyzed_at:'2026-10-14T15:00:00Z',pdf_analysis:{document_review_status:{status:'failed'}},page_results:[{pageNumber:1}],beam_formwork_area:118.5};
test('report export reads the latest saved record rather than an old visible React snapshot',async()=>{
 let reads=0;const r=await latestPdfReportForExport({projectId:'p',visible:{...saved,beam_formwork_area:177.75},workflow:()=>({active:null,analysisFailed:false}),readLatest:async()=>{reads++;return {takeoff:saved};}});
 assert.equal(reads,1);assert.equal(r,saved);assert.equal(r.beam_formwork_area,118.5);
});
test('report export blocks active or failed analysis, a storage-read race and a different document',async()=>{
 for (const state of [{active:'analysis'},{active:'boq'},{analysisFailed:true}]) {
  let reads=0;await assert.rejects(latestPdfReportForExport({projectId:'p',workflow:()=>state,readLatest:async()=>{reads++;return {takeoff:saved};}}));assert.equal(reads,0);
 }
 let active=null;await assert.rejects(latestPdfReportForExport({projectId:'p',workflow:()=>({active}),readLatest:async()=>{active='analysis';return {takeoff:saved};}}),/Wait/);
 await assert.rejects(latestPdfReportForExport({projectId:'p',visible:{document_id:'another'},workflow:()=>({}),readLatest:async()=>({takeoff:saved})}),/different drawing/);
 for (const takeoff of [null,{pdf_analysis:{summaryOnly:true}},{pdf_analysis:{}}]) await assert.rejects(latestPdfReportForExport({projectId:'p',workflow:()=>({}),readLatest:async()=>({takeoff})}),/Full saved/);
});
function service(client){
 const schema=readFileSync('src/services/takeoffSchema.js','utf8').replace(/^import[^\n]*\n/,'').replace('export const takeoffSchema','const takeoffSchema');
 const source=readFileSync('src/services/pdfDocumentReviewService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
 const sandbox={PDF_METRIC_UNITS,pdfAnalysisCacheKey,isPdfCreditBalanceError,structuredClone,Uint8Array,getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text),File,console:{log(){},warn(){}},process:{env:{}}};
 vm.createContext(sandbox);vm.runInContext(schema+'\n'+source+'\nthis.run=reviewPdfDocumentMeasurements;this.passes=pdfMeasurementReviewPasses;this.schema=scopedPdfReviewSchema;this.base=buildPdfDocumentReviewPrompt;this.focus=buildFocusedPdfReviewPrompt;',sandbox);return sandbox;
}
test('bounded reviews preserve completed v151 structure and checkpoint each disjoint operation batch; truncated responses are not accepted or retried',async()=>{
 const calls=[],client={files:{create:async()=>({id:'file'}),delete:async()=>{}},responses:{create:async(p,o)=>{
  const id=p.text.format.name;calls.push(p);assert.equal(o.maxRetries,0);assert.equal(p.model,'gpt-5');assert.equal(p.reasoning.effort,'minimal');
  if(id.endsWith('surfaces_v152_1'))return {status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:JSON.stringify({calculations:[],exclusions:[],notes:''})};
  return {status:'completed',output_text:JSON.stringify({calculations:[],exclusions:[],notes:''})};
 }}};
 const s=service(client),pages=structuredClone(observed.page_results),audit=mergePdfEvidence(pages).pdf_analysis,pass=s.passes(audit).find(p=>p.id==='structure');
 const prompt=s.base(pages,audit)+`\nTHIS PASS IS STRUCTURE ONLY. Allowed operation keys: ${pass.keys.join(', ')}. Return calculations, exclusions and notes. Do not output floor_revisions or perform geometry extraction. Use the same original source evidence and measurement conventions. Omit unsupported quantities with a brief explanation; do not fill them with assumptions. Keep operand evidence concise; avoid repeating long narrative descriptions.`;
 const cachedGroups={structure:{contract:pdfAnalysisCacheKey(new Uint8Array(),{schema:s.schema(pass),prompt}),status:'completed',review:{floor_revisions:[],calculations:[],exclusions:[],notes:'Previously completed'}}};
 const r=await s.run({pdf:{},pages,audit,cachedGroups,extractPagePacket:async()=>new Uint8Array([1])});
 assert.ok(calls.length>2);assert.equal(r.groups.structure.status,'completed');assert.equal(r.groups.surfaces_v152_1.status,'failed');assert.match(r.groups.surfaces_v152_1.reason,/max_output_tokens/);
 assert.ok(Object.entries(r.groups).filter(([id])=>id.startsWith('inventory_')).every(([,g])=>g.status==='completed'));
 const assigned=[];
 for(const p of calls){assert.equal(p.max_output_tokens,12000);const keys=p.text.format.schema.properties.calculations.items.properties.key.enum;assert.ok(keys.length<=6);assigned.push(...keys);}
 assert.equal(new Set(assigned).size,assigned.length);
 const expected=s.passes(audit).filter(p=>['surfaces','inventory'].includes(p.id)).flatMap(p=>Array.from(p.keys));
 assert.deepEqual([...assigned].sort(),Array.from(expected).sort());
 const initialCalls=calls.length;
 const second=await s.run({pdf:{},pages,audit,cachedGroups:r.groups,extractPagePacket:async()=>new Uint8Array([1])});
 assert.equal(calls.length,initialCalls+1);assert.equal(second.status,'failed');assert.ok(calls.at(-1).text.format.name.endsWith('surfaces_v152_1'));

 for (const p of calls) {const text=p.input[0].content[0].text;assert.ok(!text.includes('Re-read every floor'));assert.ok(!text.includes('area_validation'));assert.ok(text.length<prompt.length);}
});
