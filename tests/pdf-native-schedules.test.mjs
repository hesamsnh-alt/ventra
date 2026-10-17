import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {mergePdfEvidence,normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';
import {nativeOpeningEvidence} from '../src/lib/pdfNativeSchedules.mjs';
const require=createRequire(import.meta.url);
let lib;try{lib=require('pdf-lib');}catch{lib=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/pdf-lib');}
const context={...lib,TextDecoder};vm.createContext(context);
vm.runInContext(readFileSync('src/services/pdfNativeTextService.mjs','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.read=extractNativePdfText;this.tokens=tokenizePdfContent;',context);
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-28.json','utf8'));
const pdf=await lib.PDFDocument.load(readFileSync('tests/fixtures/pdf-native-opening-input.pdf'));
const sourcePages=()=>observed.page_results.map(p=>({...structuredClone(p),native_text_evidence:context.read(pdf,p.pageNumber-1)}));
test('the actual input PDF opening tables correct the observed undercount without any model or benchmark injection',()=>{
 const p=sourcePages(),r=mergePdfEvidence(p);assert.equal(r.doors,19);assert.ok(Math.abs(r.door_area-41.97)<1e-9);assert.equal(r.windows,15);assert.equal(r.window_area,39.06);
 assert.equal(r.floor_area,372);assert.equal(r.paint_area,0);assert.equal(r.slab_formwork_area,0);assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete');
 assert.deepEqual(r.pdf_analysis.native_opening_schedules.map(s=>s.rows),[17,17]);
 assert.ok(r.pdf_analysis.quantity_evidence.door_count.every(q=>q.native_calculated));
 assert.equal(mergePdfEvidence(r.page_results).doors,19);
});
test('a newer native floor ledger cannot be replaced by an older whole-project AI total',()=>{
 const p=sourcePages();p[0].document_measurement_review.calculations.push({key:'door_count',scope_id:'project',evidence:'Old model aggregate',terms:[{id:'aggregate',operation:'add',factors:[{value:500,unit:'nr',pages:[4],evidence:'Old aggregate',operation:'multiply',clip:null}]}]});
 assert.equal(mergePdfEvidence(p).doors,19);
});
test('unreadable schedules, duplicate tags, wrong scopes, missing dimensions and unsupported quantities never become partial native project totals',()=>{
 const changes=[p=>p[4].native_text_evidence.status='unsupported',p=>p[3].native_text_evidence.spans.find(s=>s.text==='GD02').text='GD01',p=>p[4].page_evidence.scope_id='Ground floor',
  p=>p[3].native_text_evidence.spans.find(s=>s.text==='3.00').text='unknown',p=>p[3].native_text_evidence.spans=p[3].native_text_evidence.spans.filter(s=>Math.abs(s.y-667.8898)>1||s.text==='GD01'),
  p=>p[3].native_text_evidence.spans.find(s=>s.text.includes('All dimensions are metres.')).text='Opening schedule without source units'];
 for(const change of changes){const p=sourcePages();change(p);const native=nativeOpeningEvidence(p,normalizePdfScope);assert.equal(native.claims.length,0);}
});
async function generatedSchedule({mm=false,width=850,quantity=null}={}){
 const doc=await lib.PDFDocument.create();doc.addPage([620,800]);const page=doc.addPage([620,800]),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const write=(text,x,y)=>page.drawText(text,{x,y,size:10,font});write('Ground floor',30,750);write(`All dimensions are ${mm?'millimetres':'metres'}.`,30,720);
 const cols=[['ID',30],['Host wall',110],['Type',210],['Width',330],['Height',410],['Sill',490]];if(quantity!==null)cols.push(['Qty',550]);
 for(const [text,x] of cols)write(text,x,680);
 const row=['A-71','outside-1','door',String(mm?width:width/1000),String(mm?2075:2.075),'0'];if(quantity!==null)row.push(String(quantity));row.forEach((t,i)=>write(t,cols[i][1],655));
 const loaded=await lib.PDFDocument.load(await doc.save());return [{pageNumber:1,page_evidence:{kind:'floor_plan',scope_id:'Ground floor'}},{pageNumber:2,page_evidence:{kind:'opening_schedule',scope_id:'Ground floor'},native_text_evidence:context.read(loaded,1)}];
}
test('different tags, dimensions, coordinates and source millimetres are read from a newly generated PDF',async()=>{
 for(const mm of [true,false]){const p=await generatedSchedule({mm,width:925}),r=nativeOpeningEvidence(p,normalizePdfScope);assert.equal(r.claims.find(c=>c.key==='door_count').value,1);assert.ok(Math.abs(r.claims.find(c=>c.key==='door_area').value-.925*2.075)<1e-10);}
 for(const quantity of [2,0])assert.equal(nativeOpeningEvidence(await generatedSchedule({quantity}),normalizePdfScope).claims.length,0);
});
test('unsupported font mappings invalidate native extraction rather than returning only the readable portion',async()=>{
 const doc=await lib.PDFDocument.load(readFileSync('tests/fixtures/pdf-native-opening-input.pdf')),fonts=doc.getPage(3).node.Resources().lookup(lib.PDFName.of('Font'));
 for(const [,ref] of fonts.entries())doc.context.lookup(ref).set(lib.PDFName.of('ToUnicode'),doc.context.stream('unsupported mapping'));
 const result=context.read(doc,3);assert.equal(result.status,'unsupported');assert.equal(result.spans.length,0);
 assert.throws(()=>context.tokens('(unterminated'));
});
test('local-only server recovery parses the original PDF while every model path is disabled, and rejects missing cache before requests',async()=>{
 let writes=0;const pages=structuredClone(observed.page_results),review=pages[0].document_measurement_review;
 const cached={totalPages:8,pages,review:{status:'completed',source_pages:[1,2,3,4,5,6,7,8],review},source_basis:{status:'failed',source_pages:[1,2,4,5,6],reason:'Source measurement response incomplete: max_output_tokens'}};
 const forbidden=()=>{throw Error('Model path must not run');};
 function engine(record){const c={mergePdfEvidence,extractNativePdfText:context.read,Uint8Array,URL,process:{env:{}},console:{log(){},warn(){}},buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},pdfAnalysisCacheKey:()=> 'same-pdf',coalescePdfAnalysis:async(_,fn)=>fn(),
  fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([1]).buffer}),loadPdf:async()=>({pdf,totalPages:8}),readPdfAnalysisCache:async()=>record,writePdfAnalysisCache:async()=>writes++,runPageQueue:async({pages})=>{assert.equal(pages.length,0);return [];},extractPdfPage:forbidden,reviewPdfDocumentMeasurements:forbidden,reviewPdfSourceMeasurements:forbidden,needsPdfSourceMeasurements:()=>true};
  vm.createContext(c);vm.runInContext(readFileSync('src/services/largePdfAnalysisService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=analyzeLargePdf;',c);return c;
 }
 const result=await engine(cached).run({fileUrl:'https://source.invalid/a.pdf',fileName:'a.pdf',localPdfRecoveryOnly:true});assert.equal(result.doors,19);assert.equal(result.pdf_analysis.source_measurement_status.status,'failed');assert.ok(writes>0);
 assert.equal(result.pdf_analysis.local_pdf_recovery.model_calls_disabled,true);assert.equal(mergePdfEvidence(result.page_results).pdf_analysis.local_pdf_recovery.model_calls_disabled,true);
 await assert.rejects(engine(null).run({fileUrl:'https://source.invalid/a.pdf',fileName:'a.pdf',localPdfRecoveryOnly:true}),e=>e.status===409&&e.code==='pdf_resume_cache_required');
});
