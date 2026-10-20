import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PDFDocument} from 'pdf-lib';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {recoverSavedPdfReport} from '../src/services/pdfSavedReportRecovery.mjs';
const input=JSON.parse(readFileSync('tests/fixtures/pdf-complex-saved-review.json'));
const bytes=readFileSync('tests/fixtures/pdf-complex-dimensioned-input.pdf');
const document={id:'doc-1',project_id:'project-1',file_path:'private/source.pdf',file_name:'source.pdf'};
const saved={...mergePdfEvidence(input.page_results,[],13),project_id:'project-1',document_id:'doc-1',document_name:'source.pdf'};
const args={saved,document,projectId:'project-1',fileUrl:'https://source.invalid/private/source.pdf'};
const download=()=>new Response(bytes,{headers:{'content-type':'application/pdf'}});

test('recovers the actual saved 13-page report without any server analysis or temporary cache',async()=>{
 let downloads=0;const before=JSON.stringify(saved);
 const result=await recoverSavedPdfReport({...args,fetchFile:async url=>{assert.equal(url,args.fileUrl);downloads++;return download();}});
 assert.equal(downloads,1);assert.equal(JSON.stringify(saved),before);
 assert.ok(Math.abs(result.floor_area-1214.835625)<1e-7);assert.ok(Math.abs(result.plaster_area-2474.14)<1e-7);
 assert.equal(result.pdf_analysis.local_pdf_recovery.model_calls_disabled,true);
 assert.equal(result.pdf_analysis.local_pdf_recovery.saved_report_verified,true);
 assert.equal(result.analysis_source.document_id,document.id);
 // A corrected saved report can itself be used next time, without old totals doubling.
 const again=await recoverSavedPdfReport({...args,saved:{...result,project_id:'project-1',document_id:'doc-1',document_name:'source.pdf'},fetchFile:async()=>download()});
 assert.equal(again.floor_area,result.floor_area);assert.equal(again.plaster_area,result.plaster_area);
});
test('wrong document/project, summary-only, duplicate pages and missing/failed base review stop before downloading',async()=>{
 for(const change of [s=>s.document_id='other',s=>s.project_id='other',s=>delete s.page_results,
  s=>s.page_results[1].pageNumber=1,s=>s.pdf_analysis.document_review_status.status='failed',
  s=>delete s.page_results[0].document_measurement_review]){
  const altered=structuredClone(saved);change(altered);let calls=0;
  await assert.rejects(recoverSavedPdfReport({...args,saved:altered,fetchFile:async()=>{calls++;return download();}}),{code:'PDF_SAVED_REPORT_REQUIRED'});
  assert.equal(calls,0);
 }
});
test('source page count changes, source text mismatch, failed download and incomplete source review cannot publish recovery',async()=>{
 const smaller=await PDFDocument.create();smaller.addPage();const smallBytes=await smaller.save();
 await assert.rejects(recoverSavedPdfReport({...args,fetchFile:async()=>new Response(smallBytes)}),/page count differs/);
 const changed=structuredClone(saved);changed.page_results[0].native_text_evidence={status:'readable',spans:[{text:'different source'}]};
 await assert.rejects(recoverSavedPdfReport({...args,saved:changed,fetchFile:async()=>download()}),/text differs/);
 await assert.rejects(recoverSavedPdfReport({...args,fetchFile:async()=>new Response('',{status:403})}),/403/);
 const incomplete=structuredClone(saved);incomplete.page_results[0].source_measurement_status.status='pending';
 await assert.rejects(recoverSavedPdfReport({...args,saved:incomplete,fetchFile:async()=>download()}),/source detail review is incomplete/);
});
test('the actual client local action bypasses all analysis HTTP calls and persists only successful recovery',async()=>{
 const source=readFileSync('src/services/takeoffService.js','utf8');
 const fn=source.slice(source.indexOf('export async function analyzeProjectDrawing('),source.indexOf('export async function getLatestProjectTakeoff('))
  .replace('export ','').replace('const { downloadProjectDocument } = await import("@/services/documentService");','')
  .replace("const {recoverSavedPdfReport}=await import('@/services/pdfSavedReportRecovery.mjs');",'');
 for(const fail of [false,true]){
  let writes=0,calls=0;const previous={floor_area:17};let stored=previous;
  const ctx={Date,JSON,Error,console:{error(){}},downloadProjectDocument:async()=>({url:args.fileUrl}),
   readPersistedTakeoff:async()=>saved,recoverSavedPdfReport:async input=>{calls++;assert.equal(input.saved,saved);if(fail)throw Error('Incomplete report');return {floor_area:81};},
   submitDrawingAnalysis:()=>{throw Error('Analysis transport must never run');},commercialFetch:()=>{throw Error('Commercial API must never run');},
   saveTakeoffLocally:async(_,value)=>{writes++;stored=value;}};
  vm.createContext(ctx);vm.runInContext(fn+'\nthis.run=analyzeProjectDrawing;',ctx);
  const result=await ctx.run({projectId:'project-1',document,localPdfRecoveryOnly:true});
  assert.equal(calls,1);assert.equal(writes,fail?0:1);
  if(fail){assert.equal(stored,previous);assert.equal(result.takeoff,null);}else assert.equal(stored.floor_area,81);
 }
});
