import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {mergePdfEvidence,normalizePdfScope} from '../src/lib/pdfTakeoffEvidence.mjs';
import {buildNativePdfSourceBasis} from '../src/lib/pdfNativeSourceBasis.mjs';
import {measureNativeWallFloor} from '../src/lib/pdfNativeWallGeometry.mjs';
import {nativeOpeningEvidence} from '../src/lib/pdfNativeSchedules.mjs';
import {retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
const require=createRequire(import.meta.url);let lib;try{lib=require('pdf-lib');}catch{lib=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/pdf-lib');}
const plain=p=>readFileSync(p,'utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
const text={...lib,TextDecoder};vm.createContext(text);vm.runInContext(plain('src/services/pdfNativeTextService.mjs')+'\nthis.read=extractNativePdfText;this.content=readNativePdfContent;this.tokens=tokenizePdfContent;',text);
const graphics={readNativePdfContent:text.content,tokenizePdfContent:text.tokens};vm.createContext(graphics);vm.runInContext(plain('src/services/pdfNativeGraphicsService.mjs')+'\nthis.read=extractNativePdfGraphics;',graphics);
const bytes=readFileSync('tests/fixtures/pdf-native-opening-input.pdf'),observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-native-recovery.json','utf8'));
const pdf=await lib.PDFDocument.load(bytes);
function extract(doc=pdf){return structuredClone(observed.page_results).map(p=>({...p,
 native_text_evidence:text.read(doc,p.pageNumber-1,{allowRotated:p.page_evidence.kind!=='opening_schedule'}),
 ...(p.page_evidence.kind==='floor_plan'?{native_plan_text:text.read(doc,p.pageNumber-1,{allowRotated:true}),native_graphics:graphics.read(doc,p.pageNumber-1)}:{})}));}
function recover(pages){const preliminary=mergePdfEvidence(pages),native=buildNativePdfSourceBasis(preliminary.page_results,normalizePdfScope);pages[0].native_measurement_basis=native.basis;pages[0].native_source_status={source_pages:native.source_pages,geometry:native.geometry};return {result:mergePdfEvidence(pages),native};}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('actual original PDF vectors, source schedules and explicit specification recover walls, wet finishes and ceilings without a model',()=>{
 const {result:r,native}=recover(extract());
 for(const [key,value] of Object.entries({internal_wall_length:114,external_wall_length:112,wall_length:226,internal_block_area:336.45,external_block_area:305.72,plaster_area:978.62,paint_area:858.38,wet_wall_tile_area:117.24,wet_wall_waterproofing_area:97.92,ceiling_paint_area:360,gypsum_ceiling_area:312,slab_formwork_area:360,kitchen_cabinet_length:5,doors:19,door_area:41.97}))close(r[key],value);
 assert.deepEqual(native.geometry.map(g=>g.wall_count),[12,15]);assert.equal(native.geometry[0].discarded_annotations[0].room_tag,'G09');assert.ok(native.geometry.every(g=>g.requires_review));
 assert.equal(native.basis.floors.flatMap(f=>f.wet_rooms).length,4);assert.equal(r.pdf_analysis.document_measurement_review.rejected.length,0);
 close(native.basis.floors[0].ceiling_spaces.find(s=>s.room_name.startsWith('G07')).native_area.value,12);
 close(native.basis.floors[0].ceiling_spaces.find(s=>s.room_name.startsWith('G05')).native_area.value,24);
 assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete');assert.ok(r.pdf_analysis.measurement_completion.unmeasured_metrics.includes('entrance_door_count'));
 const replay=mergePdfEvidence(r.page_results);for(const key of ['wall_length','plaster_area','paint_area','gypsum_ceiling_area','slab_formwork_area'])close(replay[key],r[key]);
});
test('scale, translation and compression changes to the actual PDF preserve physical source measurements',async()=>{
 const doc=await lib.PDFDocument.load(bytes);for(const i of [0,1]){const stream=doc.context.flateStream('q 1.3 0 0 1.3 37 51 cm\n'+text.content(doc,i)+'\nQ');doc.getPage(i).node.set(lib.PDFName.of('Contents'),doc.context.register(stream));}
 const loaded=await lib.PDFDocument.load(await doc.save());const {result}=recover(extract(loaded));close(result.wall_length,226);close(result.internal_block_area,336.45);close(result.paint_area,858.38);
});
test('new operation quantities reach BOQ coverage without invented rates or automatic tender approval',()=>{
 const r=recover(extract()).result,rows=retainUnboundPdfQuantities([],r).items;
 for(const [key,value] of Object.entries({internal_block_area:336.45,plaster_area:978.62,paint_area:858.38,wet_wall_tile_area:117.24,wet_wall_waterproofing_area:97.92,gypsum_ceiling_area:312,ceiling_paint_area:360,slab_formwork_area:360,kitchen_cabinet_length:5})){
  const row=rows.find(i=>i.pdfEvidence?.metricKey===key);assert.ok(row,key);close(row.quantity,value);assert.equal(row.rate,0);assert.equal(row.includeInCommercialTotal,false);
 }
});
test('a source PDF with independently enlarged metric dimensions and openings produces new quantities, not benchmark totals',async()=>{
 const doc=await lib.PDFDocument.load(bytes),factor=1.25;
 for(let i=0;i<doc.getPageCount();i++){
  const changed=text.content(doc,i).replace(/\((?:\\.|[^\\()])*\)/g,s=>s.replace(/\d+\.\d+/g,n=>(Number(n)*factor).toFixed(5)));
  doc.getPage(i).node.set(lib.PDFName.of('Contents'),doc.context.register(doc.context.flateStream(changed)));
 }
 const loaded=await lib.PDFDocument.load(await doc.save());const p=extract(loaded),native=buildNativePdfSourceBasis(mergePdfEvidence(p).page_results,normalizePdfScope);
 assert.ok(native.geometry.every(g=>g.status==='provisional'));
 close(native.basis.floors.flatMap(f=>f.walls).reduce((n,w)=>n+w.length.value,0),226*factor);
 close(native.basis.rules.wall_height.value,3.2*factor);
 const {result}=recover(p);close(result.internal_block_area,336.45*factor*factor);close(result.wet_wall_tile_area,117.24*factor*factor);close(result.wall_height,3.2*factor);assert.equal(result.wall_height_source,'pdf_native_source_rule');
});
test('ambiguous vectors, untagged gaps and inconsistent scale anchors withhold native wall geometry instead of guessing',()=>{
 for(const change of [
  p=>p.native_plan_text.spans=p.native_plan_text.spans.filter(s=>s.text!=='GD07'),
  p=>p.native_plan_text.spans.find(s=>s.text.includes('16.00 x 12.00 envelope')).text='20.00 x 15.00 envelope',
  p=>p.native_graphics.strokes.push({width:3,color:[.090196,.137255,.192157],dash:[],curved:false,segments:[{a:{x:300,y:600},b:{x:330,y:600}}]}),
  p=>p.native_graphics.strokes.find(s=>s.width===5).curved=true,
  p=>p.native_plan_text.status='unsupported',
  p=>p.native_graphics.strokes=Array(5001).fill(p.native_graphics.strokes[0]),
 ]){const pages=extract(),schedule=nativeOpeningEvidence(pages,normalizePdfScope).schedules[0];change(pages[0]);const measured=measureNativeWallFloor(pages[0],schedule);assert.equal(measured.status,'pending');assert.equal(measured.walls.length,0);}
});
test('missing specification rules preserve independent groups and never introduce wall-height or finish defaults',()=>{
 const noHeight=extract();noHeight[5].native_text_evidence.spans.find(s=>s.text.startsWith('WALLS:')).text='WALLS: height unavailable.';const h=recover(noHeight).result;assert.equal(h.internal_block_area,0);assert.equal(h.paint_area,0);assert.equal(h.ceiling_paint_area,360);
 const noPlaster=extract();noPlaster[5].native_text_evidence.spans.find(s=>s.text.startsWith('PLASTER:')).text='PLASTER: face convention unavailable.';const p=recover(noPlaster).result;assert.equal(p.plaster_area,0);close(p.wet_wall_tile_area,117.24);close(p.wet_wall_waterproofing_area,97.92);
 const noGypsum=extract();noGypsum[5].native_text_evidence.spans.find(s=>s.text.startsWith('CEILINGS:')).text='CEILINGS: paint all enclosed areas. Gypsum exclusions unknown.';const g=recover(noGypsum).result;assert.equal(g.ceiling_paint_area,360);assert.equal(g.gypsum_ceiling_area,0);
});
test('changing a source gypsum exclusion uses the actual native room face rather than compensating errors in old room polygons',()=>{
 const p=extract();p[5].native_text_evidence.spans.find(s=>s.text.startsWith('CEILINGS:')).text=p[5].native_text_evidence.spans.find(s=>s.text.startsWith('CEILINGS:')).text.replace('GF stairs','GF foyer');
 const r=recover(p).result;close(r.gypsum_ceiling_area,316);close(r.ceiling_paint_area,360);
});
test('inconsistent cabinet equations or slab thickness cannot produce replacement measured quantities',()=>{
 const p=extract();for(const span of p[5].native_text_evidence.spans)if(span.text.includes('base cabinet measured'))span.text=span.text.replace('=5.00','=6.00');
 assert.equal(recover(p).result.kitchen_cabinet_length,0);
 const q=extract();for(const span of q[2].native_text_evidence.spans)if(span.text.startsWith('First slab:'))span.text=span.text.replace('.20','.25');
 assert.equal(recover(q).result.slab_formwork_area,0);
 const badOperand=extract();badOperand[0].document_measurement_review.calculations.find(c=>c.key==='first_slab_volume').terms[0].factors[0].value=20;
 assert.equal(recover(badOperand).result.slab_formwork_area,0);
});
test('the actual local-only server path recovers the new quantities with every model entry point forbidden',async()=>{
 const base=structuredClone(observed.page_results),cached={totalPages:8,pages:base,review:{status:'completed',source_pages:[1,2,3,4,5,6,7,8],review:base[0].document_measurement_review},source_basis:{status:'failed',source_pages:[1,2,4,5,6],reason:'Source measurement response incomplete: max_output_tokens'}};
 const forbidden=()=>{throw Error('Model entry point forbidden');};
 const c={mergePdfEvidence,normalizePdfScope,buildNativePdfSourceBasis,extractNativePdfText:text.read,extractNativePdfGraphics:graphics.read,Uint8Array,URL,process:{env:{}},console:{log(){},warn(){}},buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},pdfAnalysisCacheKey:()=> 'source-bytes',coalescePdfAnalysis:async(_,fn)=>fn(),fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>new Uint8Array([1]).buffer}),loadPdf:async()=>({pdf,totalPages:8}),readPdfAnalysisCache:async()=>cached,writePdfAnalysisCache:async()=>{},runPageQueue:async({pages})=>{assert.equal(pages.length,0);return [];},extractPdfPage:forbidden,reviewPdfDocumentMeasurements:forbidden,reviewPdfSourceMeasurements:forbidden,needsPdfSourceMeasurements:()=>true};
 vm.createContext(c);vm.runInContext(plain('src/services/largePdfAnalysisService.js')+'\nthis.run=analyzeLargePdf;',c);
 const r=await c.run({fileUrl:'https://source.invalid/d.pdf',fileName:'d.pdf',localPdfRecoveryOnly:true});close(r.internal_block_area,336.45);close(r.paint_area,858.38);close(r.slab_formwork_area,360);assert.equal(r.pdf_analysis.local_pdf_recovery.model_calls_disabled,true);
});
