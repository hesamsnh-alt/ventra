import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {extractNativePdfPages} from '../src/lib/pdfNativePageExtraction.mjs';
import {mergePdfEvidence,normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';
import {buildNativePdfSourceBasis} from '../src/lib/pdfNativeSourceBasis.mjs';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {submitDrawingAnalysis} from '../src/lib/drawingAnalysisTransport.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';

const require=createRequire(import.meta.url);let lib;
try{lib=require('pdf-lib');}catch{lib=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/pdf-lib');}
const strip=p=>readFileSync(p,'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const text=vm.createContext({...lib,TextDecoder});
vm.runInContext(strip('src/services/pdfNativeTextService.mjs')+'\nthis.read=extractNativePdfText;this.content=readNativePdfContent;this.tokens=tokenizePdfContent;',text);
const graphics=vm.createContext({readNativePdfContent:text.content,tokenizePdfContent:text.tokens});
vm.runInContext(strip('src/services/pdfNativeGraphicsService.mjs')+'\nthis.read=extractNativePdfGraphics;',graphics);
const bytes=readFileSync('tests/fixtures/pdf-native-opening-input.pdf');
const pdf=await lib.PDFDocument.load(bytes);
const old=JSON.parse(readFileSync('tests/fixtures/pdf-observed-native-recovery.json','utf8'));
const readAll=doc=>Array.from({length:doc.getPageCount()},(_,i)=>({pageNumber:i+1,native_text_evidence:text.read(doc,i,{allowRotated:true})}));

test('all original source pages are readable and five supported pages extract locally without source answers or a model',()=>{
 const readings=readAll(pdf),before=structuredClone(readings),r=extractNativePdfPages(readings,normalizePdfScope);
 assert.ok(readings.every(p=>p.native_text_evidence.status==='readable'));
 assert.deepEqual(r.pages.map(p=>p.pageNumber),[4,5,6,7,8]);assert.equal(JSON.stringify(readings),JSON.stringify(before));
 const claims=r.pages.flatMap(p=>p.page_evidence.quantities);
 assert.equal(claims.filter(q=>q.key==='light_count').reduce((s,q)=>s+q.value,0),60);
 assert.equal(claims.filter(q=>q.key==='water_pipe_length').reduce((s,q)=>s+q.value,0),80);
 assert.ok(Math.abs(claims.find(q=>q.key==='rebar_kg').value-12168.13827160494)<1e-8);
 assert.ok(r.pages.every(p=>p.native_extraction.requires_source_review));
});

function engine(record=null,{failPages=false}={}){
 let saved=record?structuredClone(record):null;
 const stats={textPages:[],pageRequests:[],reviewRequests:0,writes:0};
 const c={mergePdfEvidence,normalizePdfScope,buildNativePdfSourceBasis,extractNativePdfPages,pdfAnalysisCacheKey,URL,Uint8Array,
  process:{env:{}},console:{log(){},warn(){}},buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},
  coalescePdfAnalysis:async(_,fn)=>fn(),readPdfAnalysisCache:async()=>saved,writePdfAnalysisCache:async(_,r)=>{saved=structuredClone(r);stats.writes++;},
  fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),
  loadPdf:async()=>({pdf,totalPages:8}),extractPdfPage:async(_,i)=>{assert.equal(stats.textPages.length,8);return new Uint8Array([i+1]);},extractPdfPagePacket:()=>{throw Error('Unexpected packet extraction');},
  extractNativePdfText:(doc,i,options)=>{stats.textPages.push(i+1);return text.read(doc,i,options);},extractNativePdfGraphics:graphics.read,
  runPageQueue:async({pages,onProgress})=>{
   assert.equal(stats.textPages.length,8);stats.pageRequests.push(...pages.map(p=>p.pageNumber));
   const results=[];for(const p of pages){
    let result;
    if(failPages)result={success:false,pageNumber:p.pageNumber,status:429,code:'credit_balance_exhausted',creditUnavailable:true,error:'No credits remaining'};
    else {
     const page=structuredClone(old.page_results.find(x=>x.pageNumber===p.pageNumber));
     for(const key of ['document_measurement_review','document_review_status','native_measurement_basis','native_source_status','source_measurement_status'])delete page[key];
     page.page_evidence.quantities=page.page_evidence.quantities.filter(q=>!q.document_calculated);
     result={success:true,pageNumber:p.pageNumber,result:page};
    }
    results.push(result);await onProgress({result});
   }return results;
  },
  reviewPdfDocumentMeasurements:async()=>{stats.reviewRequests++;return {status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:structuredClone(old.page_results[0].document_measurement_review)};},
  needsPdfSourceMeasurements:()=>false,reviewPdfSourceMeasurements:()=>{throw Error('Unexpected source model request');}};
 vm.createContext(c);vm.runInContext(strip('src/services/largePdfAnalysisService.js')+'\nthis.run=analyzeLargePdf;',c);
 return {stats,run:flags=>c.run({fileUrl:'https://source.invalid/project/input.pdf',fileName:'input.pdf',...flags}),record:()=>saved};
}

test('cold production orchestration reads all eight original pages before any model step and queues only three unresolved pages',async()=>{
 const e=engine(),r=await e.run();
 assert.deepEqual(e.stats.pageRequests,[1,2,3]);assert.equal(e.stats.reviewRequests,1);
 assert.equal(r.analyzed_pages,8);assert.equal(r.failed_pages.length,0);
 assert.deepEqual(Array.from(r.pdf_analysis.native_first_read.locally_extracted_pages),[4,5,6,7,8]);
 assert.equal(r.pdf_analysis.native_first_read.readable_text_pages,8);
 assert.equal(r.scheduled_quantities.light_count,60);assert.equal(r.scheduled_quantities.socket_count,70);
 assert.ok(Math.abs(r.scheduled_quantities.internal_block_area-336.45)<1e-6);
 const second=engine(e.record());await second.run();assert.equal(second.stats.pageRequests.length,0);assert.equal(second.stats.reviewRequests,0);
});

test('credit failure on unresolved plans does not prevent reading and checkpointing native schedules',async()=>{
 const e=engine(null,{failPages:true}),r=await e.run();
 assert.deepEqual(e.stats.textPages,[1,2,3,4,5,6,7,8]);assert.deepEqual(e.stats.pageRequests,[1,2,3]);
 assert.equal(e.stats.reviewRequests,0);assert.equal(r.analyzed_pages,5);assert.equal(r.failed_pages.length,3);
 assert.deepEqual(e.record().pages.map(p=>p.pageNumber),[4,5,6,7,8]);
 assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete');
 assert.equal(r.scheduled_quantities.light_count,60);assert.ok(r.scheduled_quantities.rebar_kg>12000);
});

test('complete legacy cache remains reusable with every model entry point forbidden',async()=>{
 const e=engine({totalPages:8,pages:old.page_results,review:{status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:old.page_results[0].document_measurement_review}});
 const r=await e.run({localPdfRecoveryOnly:true});assert.equal(e.stats.pageRequests.length,0);assert.equal(e.stats.reviewRequests,0);
 assert.equal(r.floor_area,372);assert.equal(r.ceiling_area,360);assert.ok(Math.abs(r.wall_area-642.17)<1e-6);
 assert.equal(r.pdf_analysis.local_pdf_recovery.model_calls_disabled,true);
 assert.equal(r.pdf_analysis.native_first_read.reused_pages,8);
});

test('native table source values override wrong model review totals and remain stable when merged again',()=>{
 const pages=structuredClone(old.page_results),native=extractNativePdfPages(readAll(pdf),normalizePdfScope);
 for(const p of native.pages){const target=pages.find(x=>x.pageNumber===p.pageNumber);target.native_text_evidence=p.native_text_evidence;}
 const review=pages[0].document_measurement_review;
 review.calculations=review.calculations.filter(c=>c.key!=='rebar_kg'&&c.key!=='light_count');
 for(const key of ['rebar_kg','light_count'])review.calculations.push({key,scope_id:'project',evidence:'Wrong old model aggregate',terms:[{id:key,operation:'add',factors:[{value:999999,unit:key==='rebar_kg'?'kg':'nr',operation:'multiply',pages:[7,8],evidence:'Wrong source transcription',clip:null}]}]});
 const r=mergePdfEvidence(pages);assert.equal(r.scheduled_quantities.light_count,60);assert.ok(Math.abs(r.scheduled_quantities.rebar_kg-12168.13827160494)<1e-8);
 assert.equal(mergePdfEvidence(r.page_results).scheduled_quantities.light_count,60);
});

async function independentPdf({light=7,second=11,diameter=16,count=8,length=2.7}={}){
 const doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const draw=(p,text,x,y)=>p.drawText(text,{x,y,size:10,font});
 const service=doc.addPage([650,800]);draw(service,'Services quantity schedule',30,760);
 const cols=[30,300,410,530];['Item','Ground floor','First floor','Unit'].forEach((s,i)=>draw(service,s,cols[i],700));
 ['Light points',String(light),String(second),'nr'].forEach((s,i)=>draw(service,s,cols[i],675));
 ['Water supply pipes','19.5','8.75','m'].forEach((s,i)=>draw(service,s,cols[i],650));
 const bar=doc.addPage([650,800]);draw(bar,'Complete project reinforcement schedule',30,760);draw(bar,'Formula: diameter(mm)^2 /162 kg/m. Sum all rows; all project reinforcement.',30,735);
 const bcols=[30,300,410,530];['Element','Dia mm','Count','Cut length m'].forEach((s,i)=>draw(bar,s,bcols[i],700));
 ['Footing mesh',String(diameter),String(count),String(length)].forEach((s,i)=>draw(bar,s,bcols[i],675));
 return lib.PDFDocument.load(await doc.save());
}

test('two independent generated PDFs use their own service quantities and reinforcement operands',async()=>{
 for(const args of [{light:7,second:11,diameter:16,count:8,length:2.7},{light:19,second:5,diameter:20,count:31,length:4.2}]){
  const r=extractNativePdfPages(readAll(await independentPdf(args)),normalizePdfScope);assert.equal(r.pages.length,2);
  const t=mergePdfEvidence(r.pages);assert.equal(t.scheduled_quantities.light_count,args.light+args.second);
  assert.equal(t.scheduled_quantities.water_pipe_length,28.25);
  assert.ok(Math.abs(t.scheduled_quantities.rebar_kg-args.count*args.length*args.diameter**2/162)<1e-9);
 }
});

test('unknown units, fractional fixture counts, duplicate rows and conflicting headers never become accepted local tables',async()=>{
 const original=readAll(await independentPdf());
 for(const mutate of [
  p=>p.native_text_evidence.spans.find(s=>s.text==='nr').text='m2',
  p=>p.native_text_evidence.spans.find(s=>s.text==='7').text='2.5',
  p=>p.native_text_evidence.spans.find(s=>s.text==='Water supply pipes').text='Light points',
  p=>p.native_text_evidence.spans.push({...p.native_text_evidence.spans.find(s=>s.text==='Unit'),x:560}),
 ]){
  const input=structuredClone(original);mutate(input[0]);assert.ok(!extractNativePdfPages(input,normalizePdfScope).pages.some(p=>p.pageNumber===1));
 }
 const duplicate=structuredClone(original);const spans=duplicate[1].native_text_evidence.spans;
 for(const s of spans.filter(s=>s.y===675))spans.push({...s,y:650});
 assert.ok(!extractNativePdfPages(duplicate,normalizePdfScope).pages.some(p=>p.pageNumber===2));
});

test('unsupported encodings and arbitrary readable prose stay on the unresolved path',()=>{
 const readings=[{pageNumber:1,native_text_evidence:{version:1,status:'unsupported',spans:[]}},{pageNumber:2,native_text_evidence:{version:1,status:'readable',spans:[{text:'A photograph is not a measured wall inventory',x:30,y:700,height:10}]}}];
 assert.equal(extractNativePdfPages(readings,normalizePdfScope).pages.length,0);
});

test('native two-floor tables cannot erase a third floor or price a partial building as a complete total',async()=>{
 const native=extractNativePdfPages(readAll(await independentPdf()),normalizePdfScope).pages[0];native.pageNumber=4;
 const floors=[0,1,2].map((n,i)=>({pageNumber:i+1,detected_items:[],page_evidence:{kind:'floor_plan',scope_id:`floor:${n}`,revision:null,quantities:n===2?[{key:'light_count',value:13,unit:'nr',scope_id:'floor:2',evidence:'Explicit complete third floor light-point schedule'}]:[]}}));
 floors[0].page_evidence.quantities.push({key:'light_count',value:99999,unit:'nr',scope_id:'project',evidence:'Older model aggregate'});
 const r=mergePdfEvidence([...floors,native]);assert.equal(r.scheduled_quantities.light_count,31);
 floors[2].page_evidence.quantities=[];
 const partial=mergePdfEvidence([...floors,native]);assert.equal(partial.scheduled_quantities.light_count,0);assert.equal(partial.pdf_analysis.quantity_evidence.light_count,undefined);
 assert.equal(partial.pdf_analysis.measurement_completion.status,'incomplete');
 assert.ok(partial.pdf_analysis.conflicts.some(s=>s.includes('every selected floor')));
});

test('actual client rejects a successful HTTP response containing interrupted PDF analysis before any saved report write',async()=>{
 const source=readFileSync('src/services/takeoffService.js','utf8');
 const start=source.indexOf('export async function analyzeProjectDrawing('),end=source.indexOf('export async function getLatestProjectTakeoff(',start);
 const fn=source.slice(start,end).replace('export ','').replace('const { downloadProjectDocument } = await import("@/services/documentService");','');
 for(const partial of [
  {total_pages:8,analyzed_pages:3,page_results:[1,2,3].map(pageNumber=>({pageNumber})),failed_pages:[{pageNumber:4}],pdf_analysis:{document_review_status:{status:'failed',reason:'No credits remaining'}}},
  {total_pages:8,analyzed_pages:8,page_results:[1,2,3].map(pageNumber=>({pageNumber})),pdf_analysis:{document_review_status:{status:'completed'}}},
  {total_pages:1,page_results:[{pageNumber:1}],pdf_analysis:{document_review_status:{status:'pending'}}},
 ]){
  let writes=0,posts=0;
  const c={Date,JSON,Error,submitDrawingAnalysis,console:{error(){}},downloadProjectDocument:async()=>({url:'https://source.invalid/file.pdf'}),
   commercialFetch:async(_,r)=>{if(r.method==='GET')return Response.json({success:true});posts++;return Response.json({success:true,result:partial});},saveTakeoffLocally:async()=>writes++};
  vm.createContext(c);vm.runInContext(fn+'\nthis.run=analyzeProjectDrawing;',c);
  const r=await c.run({projectId:'p',document:{id:'d',file_path:'f',file_name:'source.pdf'}});
  assert.equal(posts,1);assert.equal(writes,0);assert.equal(r.takeoff,null);assert.equal(r.error.code,'PDF_ANALYSIS_INCOMPLETE');
 }
});

test('actual BOQ server rejects interrupted PDF before any catalog/model/storage access',async()=>{
 let reads=0,writes=0,models=0;
 const c={NextResponse:{json:Response.json},console:{error(){}},createClient:()=>{reads++;throw Error('Catalog must not be read');},
  buildLocalBoq:()=>{models++;},normalizeTakeoff:()=>{throw Error('Must stop before normalization');}};
 // Use the handler itself, including its early validation, not a mirror of it.
 vm.createContext(c);vm.runInContext(readFileSync('src/lib/serverBoqAnalysis.js','utf8').replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export /g,'')+'\nthis.run=handleCommercialRequest;',c);
 const r=await c.run({json:async()=>({takeoff:{total_pages:8,analyzed_pages:3,failed_pages:[{pageNumber:4}],pdf_analysis:{document_review_status:{status:'failed'}}}})});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'PDF_ANALYSIS_INCOMPLETE');assert.equal(reads+writes+models,0);
});

test('native kg to catalog ton conversion and source quantities are priced once through the actual server BOQ path',async()=>{
 const native=extractNativePdfPages(readAll(await independentPdf()),normalizePdfScope),t=mergePdfEvidence(native.pages);
 const prices=[{item_code:'REBAR-T',description:'High yield reinforcement',unit:'ton',standard_rate:3600,is_active:true},
  {item_code:'LIGHT',description:'Lighting point including wiring',unit:'point',standard_rate:125,is_active:true}];
 const r=await runOfflinePdfCatalog(t,prices);
 const steel=r.boq.items.find(i=>i.itemCode==='REBAR-T'),light=r.boq.items.find(i=>i.itemCode==='LIGHT');
 assert.ok(Math.abs(steel.quantity-(8*2.7*16**2/162)/1000)<1e-12);assert.equal(steel.amount,Math.round(steel.quantity*3600*100)/100);
 assert.equal(light.quantity,18);assert.equal(light.amount,2250);assert.equal(r.modelCalls,0);assert.equal(r.databaseWrites,0);
});
