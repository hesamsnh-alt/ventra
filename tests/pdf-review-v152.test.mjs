import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PDF_METRIC_UNITS} from '../src/lib/pdfTakeoffEvidence.mjs';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {completeDrawingResult} from '../src/lib/drawingJobIdentity.mjs';
function service(){
 const calls=[];
 const client={files:{create:async()=>({id:'source'}),delete:async()=>{}},responses:{create:async p=>{
  calls.push(p);return {status:'completed',output_text:JSON.stringify({calculations:[],exclusions:[],notes:''})};
 }}};
 const schema=readFileSync('src/services/takeoffSchema.js','utf8').replace(/^import[^\n]*\n/,'').replace('export const takeoffSchema','const takeoffSchema');
 const source=readFileSync('src/services/pdfDocumentReviewService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
 const s={PDF_METRIC_UNITS,pdfAnalysisCacheKey,isPdfCreditBalanceError,structuredClone,Uint8Array,File,getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text),console:{log(){},warn(){}},process:{env:{}}};
 vm.createContext(s);vm.runInContext(schema+'\n'+source+'\nthis.api={reviewPdfDocumentMeasurements,pdfMeasurementReviewPasses,scopedPdfReviewSchema,buildPdfDocumentReviewPrompt,buildFocusedPdfReviewPrompt,pdfDocumentReviewSchema};',s);
 return {...s.api,calls};
}
test('v152 reuses v151 geometry, structure and any exact completed broad family, then reuses every completed batch',async()=>{
 const s=service(),pages=[1,2].map(pageNumber=>({pageNumber,page_evidence:{kind:'floor_plan',scope_id:`floor:${pageNumber-1}`}})),audit={withheld_area_metrics:['floor_area']};
 const cachedGroups={};
 for(const p of s.pdfMeasurementReviewPasses(audit)){
  if(p.id==='inventory')continue;
  const schema=s.scopedPdfReviewSchema(p);
  const prompt=p.id==='surfaces'?s.buildFocusedPdfReviewPrompt(p,pages):s.buildPdfDocumentReviewPrompt(pages,audit)+(p.id==='geometry'?
   '\nTHIS PASS IS GEOMETRY ONLY. Return floor_revisions, exclusions and notes. Do not produce any operation calculations. Correct only source-supported withheld floor geometry.':
   `\nTHIS PASS IS STRUCTURE ONLY. Allowed operation keys: ${p.keys.join(', ')}. Return calculations, exclusions and notes. Do not output floor_revisions or perform geometry extraction. Use the same original source evidence and measurement conventions. Omit unsupported quantities with a brief explanation; do not fill them with assumptions. Keep operand evidence concise; avoid repeating long narrative descriptions.`);
  const options={max_output_tokens:12000,reasoning:{effort:'low'}};
  cachedGroups[p.id]={contract:pdfAnalysisCacheKey(new Uint8Array(),p.id==='surfaces'?{schema,prompt,options}:{schema,prompt}),status:'completed',review:{floor_revisions:[],calculations:[],exclusions:[],notes:'saved v151'}};
 }
 const args={pdf:{},pages,audit,cachedGroups,extractPagePacket:async()=>new Uint8Array([1])};
 const first=await s.reviewPdfDocumentMeasurements(args);
 assert.equal(first.status,'completed');assert.ok(s.calls.length>0);assert.ok(s.calls.every(p=>p.text.format.name.includes('inventory_v152_')));
 for(const id of ['geometry','structure','surfaces'])assert.equal(first.groups[id].contract,cachedGroups[id].contract);
 const calls=s.calls.length;
 const second=await s.reviewPdfDocumentMeasurements({...args,cachedGroups:first.groups,extractPagePacket:async()=>{throw Error('must not upload a completed review');}});
 assert.equal(second.status,'completed');assert.equal(s.calls.length,calls);
});
test('incomplete drawing HTTP response identifies completed pages and actual truncation instead of a generic error',async()=>{
 const result={total_pages:13,page_results:Array.from({length:13},(_,i)=>({pageNumber:i+1})),pdf_analysis:{document_review_status:{status:'failed',reason:'surfaces: max_output_tokens; inventory: max_output_tokens'}}};
 const ctx={reportDrawingProgress:async()=>{},completeDrawingResult,NextResponse:{json:(body,init)=>Response.json(body,init)},analyzeDrawing:async()=>result,commercialRun:async(request,kind,handler)=>handler(request),console:{log(){},error(){}}};
 vm.createContext(ctx);vm.runInContext(readFileSync('src/lib/serverDrawingAnalysis.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=runDrawingRequest;',ctx);
 const r=await ctx.run({json:async()=>({fileUrl:'https://source.invalid/test.pdf',fileName:'test.pdf'})}),p=await r.json();
 assert.equal(r.status,409);assert.equal(p.success,false);assert.equal(p.result,undefined);assert.match(p.error,/13\/13 pages/);assert.match(p.error,/max_output_tokens/);assert.match(p.error,/Previous BOQ was not replaced/);
});
