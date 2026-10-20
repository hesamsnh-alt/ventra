import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PDFDocument,StandardFonts,rgb,PDFName} from 'pdf-lib';
import {extractNativePdfText,readNativePdfContent} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {measureNativeClearPlan} from '../src/lib/pdfNativeClearPlan.mjs';
import {nativeCoordinatedPdfCalculations,readNativeInstanceTables} from '../src/lib/pdfNativeCoordinatedQuantities.mjs';
import {mergePdfEvidence,normalizePdfScope,PDF_METRIC_UNITS} from '../src/lib/pdfTakeoffEvidence.mjs';
import {calculatePdfMeasurement} from '../src/lib/pdfMeasurementCalculations.mjs';
import {buildNativePdfSourceBasis} from '../src/lib/pdfNativeSourceBasis.mjs';
import {extractNativePdfPages} from '../src/lib/pdfNativePageExtraction.mjs';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
import {completeDrawingResult} from '../src/lib/drawingJobIdentity.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
import {nativePdfServiceOperations} from '../src/lib/pdfNativeServiceOperations.mjs';

const sourceBytes=readFileSync('tests/fixtures/pdf-complex-dimensioned-input.pdf');
const saved=JSON.parse(readFileSync('tests/fixtures/pdf-complex-saved-review.json'));
const pdf=await PDFDocument.load(sourceBytes);
function nativePages(doc=pdf){return saved.page_results.map(p=>({...structuredClone(p),native_text_evidence:extractNativePdfText(doc,p.pageNumber-1,{allowRotated:true}),...(p.page_evidence?.kind==='floor_plan'?{native_plan_text:extractNativePdfText(doc,p.pageNumber-1,{allowRotated:true}),native_graphics:extractNativePdfGraphics(doc,p.pageNumber-1)}:{})}));}
const input=nativePages();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const available=new Set(input.map(p=>p.pageNumber));
const replay=mergePdfEvidence(input,[],13);

test('real source vector graph closes both irregular footprints and deducts one hosted stair hole per level',()=>{
 const plans=input.filter(p=>p.page_evidence.kind==='floor_plan').map(p=>measureNativeClearPlan(p,input));
 assert.ok(plans.every(p=>p.status==='checked'));
 for(const p of plans){assert.equal(p.rooms.length,12);near(p.audit.envelope_area,688);assert.equal(p.rooms.flatMap(r=>r.deductions).length,1);near(p.rooms.flatMap(r=>r.deductions)[0].area,18);}
 near(plans[0].dimensions.floor_area,638.033125);near(plans[1].dimensions.floor_area,576.8025);
 assert.equal(plans[1].rooms.filter(r=>r.void).length,1);
});
test('source replay recovers net masonry and independently calculated finish quantities with valid units',()=>{
 const expected={floor_area:1214.835625,ceiling_area:1214.835625,external_block_area:676.94,internal_block_area:926.72,
  wet_wall_tile_area:233.28,wet_floor_waterproofing_area:183.00625,wet_wall_waterproofing_area:30.84,gypsum_ceiling_area:1067.14375,ceiling_paint_area:1214.835625,toilet_count:8};
 for(const [key,value]of Object.entries(expected))near(replay[key],value);
 assert.equal(replay.pdf_analysis.area_validation.filter(a=>a.status==='native_clear_geometry_checked').length,2);
 assert.ok(replay.pdf_analysis.quantity_evidence.external_block_area.every(q=>q.native_coordinated));
});
test('source routes retain pipe diameters, explicit risers, ducts, fixtures and electrical counts without merging unlike operations',()=>{
 const ops=replay.pdf_analysis.document_measurement_review.native_source_operations;
 const expected={CW25:34.2,HW20:30.2,WW50:36.2,SW110:22.2,CD25:64.2,HD01:134.4,HD02:149.89,HI01:284.29,SD01:27,RG01:21,EF01:8,FCU01:8,LT01:144,DA01:52,SW01:25,EM01:10,EX01:6,CT01:60.2,CB01:84.2,CC01:72.2,'floor-drain':6,sink:4,'electric-water-heater':2};
 for(const [code,q]of Object.entries(expected))near(ops.find(o=>o.sourceCode===code)?.quantity,q);
 assert.ok(ops.find(o=>o.sourceCode==='CW25').sourceDescription.includes('DN25'));
 assert.equal(ops.find(o=>o.sourceCode==='FCU01').replacesMetric,'ac_count');
});
test('changing source equipment multipliers changes counts; an unsourced missing riser withholds only its service page',()=>{
 const changed=structuredClone(input),details=replay.pdf_analysis.document_measurement_review.native_coordinated_measurements;
 changed[9].native_text_evidence.spans.forEach(s=>{s.text=s.text.replace('1 per occupied room except corridor: 3 each floor','2 per occupied room except corridor: 4 each floor');});
 let result=nativePdfServiceOperations(changed,details);near(result.operations.find(o=>o.sourceCode==='SD01').quantity,50);
 changed[10].native_text_evidence.spans.forEach(s=>s.text=s.text.replace('One 4.200 m interstorey riser on F-CW25 only','Unspecified riser'));
 result=nativePdfServiceOperations(changed,details);assert.ok(result.issues.some(i=>i.includes('page 11')));assert.ok(!result.operations.some(o=>o.family==='pipe'));assert.ok(result.operations.some(o=>o.sourceCode==='HD01'));
});
test('the actual BOQ path retains distinct floor/ceiling/source rows with quantities and no invented generic rates',async()=>{
 const rates=JSON.parse(readFileSync('tests/fixtures/pdf-catalog-before-v132.json'));
 const result=await runOfflinePdfCatalog(replay,rates),items=result.boq.items;
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
 const row=code=>items.find(i=>i.itemCode===code);
 near(row('PDF-FLOOR-F01').quantity,122.656875);near(row('PDF-FLOOR-F02').quantity,550.29);near(row('PDF-FLOOR-F03').quantity,358.8825);near(row('PDF-FLOOR-F04').quantity,183.00625);
 near(row('PDF-CEILING-BOARD-C01').quantity,884.1375);near(row('PDF-CEILING-BOARD-C02').quantity,183.00625);
 near(row('PDF-PIPE-CW25').quantity,34.2);assert.equal(row('PDF-PIPE-CW25').unit,'m');
 assert.ok(!items.some(i=>i.quantity>0&&['gypsum_ceiling_area','ac_count','light_count','internal_door_count','entrance_door_count'].includes(i.pdfEvidence?.metricKey)));
 assert.equal(row('PDF-FLOOR-F02').rate,0);assert.equal(row('PDF-FLOOR-F02').rateMissing,true);assert.equal(row('PDF-FLOOR-F02').includeInCommercialTotal,false);
 near(row('PDF-SCREED-SC01').quantity,60.74178125);assert.equal(row('PDF-SCREED-SC01').unit,'m3');
 for(const [code,q]of [['PDF-DOOR-SET-D01',12],['PDF-DOOR-SET-D02',7],['PDF-DOOR-SET-DE12',4],['PDF-DOOR-SET-DE20',1],['PDF-DOOR-SET-DG09',2],['PDF-DOOR-SET-DG12',2]])near(row(code).quantity,q);
});
test('partial glass faces use both rooms clear extents, not the entire corridor side as in the erroneous reference',()=>{
 const c=nativeCoordinatedPdfCalculations(replay.page_results);
 assert.deepEqual(c.issues,[]);
 const corridor=c.details.flatMap(d=>d.rooms.map(r=>({...r,scope:d.scope}))).filter(r=>['G05','F05'].includes(r.tag));
 assert.equal(corridor.length,2);
 for(const r of corridor){
  const result=calculatePdfMeasurement({key:'plaster_area',scope_id:r.scope,evidence:'Source room-face arithmetic',terms:r.plaster_terms},PDF_METRIC_UNITS,available);
  near(result.value,r.tag==='G05'?225.64:203.94);
  const glass=r.plaster_terms.find(t=>t.id.includes(':glass:'));near(glass.factors[0].value,7.85);
 }
 near(replay.plaster_area,2474.14);near(replay.paint_area,2240.86);
 // These are deliberately not forced to the reference's 2292.12/2058.84.
});
test('replaying corrected floors removes stale project totals, does not double-count, and does not mutate its input',()=>{
 const pages=structuredClone(replay.page_results),before=JSON.stringify(pages);
 pages[0].page_evidence.quantities.push({key:'gypsum_ceiling_area',scope_id:'project',unit:'m2',value:9999,pages:[6],document_calculated:true,evidence:'Older aggregate'});
 const changed=JSON.stringify(pages),second=mergePdfEvidence(pages,[],13),third=mergePdfEvidence(second.page_results,[],13);
 near(second.gypsum_ceiling_area,1067.14375);near(third.gypsum_ceiling_area,1067.14375);near(third.plaster_area,replay.plaster_area);
 assert.equal(JSON.stringify(pages),changed);assert.notEqual(changed,before);
});
test('a source height change alters masonry and paint; original cached/model totals cannot win',async()=>{
 const changed=await PDFDocument.load(sourceBytes),page=changed.getPage(3),content=readNativePdfContent(changed,3);
 assert.ok(content.includes('(4.000 m above ground FFL)'));
 page.node.set(PDFName.of('Contents'),changed.context.register(changed.context.flateStream(content.replace('(4.000 m above ground FFL)','(3.200 m above ground FFL)'))));
 const result=mergePdfEvidence(nativePages(changed),[],13);
 near(result.external_block_area,588.94);assert.ok(result.internal_block_area<replay.internal_block_area);assert.ok(result.paint_area<replay.paint_area);
 near(result.floor_area,replay.floor_area);
});
test('incorrect scale, ambiguous tags, conflicting clear dimensions and unhosted deductions fail closed',()=>{
 for(const change of [
  p=>p.native_plan_text.spans.forEach(s=>s.text=s.text.replace('Scale 1:100','Scale 1:50')),
  p=>p.native_plan_text.spans.push({...p.native_plan_text.spans.find(s=>s.text==='G02')}),
  p=>p.native_plan_text.spans.forEach(s=>s.text=s.text.replace('Clear 7.850 x 7.825 m','Clear 9.850 x 7.825 m')),
  p=>p.native_plan_text.spans.forEach(s=>s.text=s.text.replace('X25.000-28.000','X125.000-128.000')),
 ]){const p=structuredClone(input[1]);change(p);assert.equal(measureNativeClearPlan(p,input).status,'pending');}
});
test('duplicate instances, wrong widths and wrong source room hosts cannot retain prior native wall claims',()=>{
 for(const mutate of [
  p=>p[6].native_text_evidence.spans.push(...structuredClone(p[6].native_text_evidence.spans.filter(s=>Math.abs(s.y-p[6].native_text_evidence.spans.find(x=>x.text==='G-D01').y)<1.5))),
  p=>{const spans=p[6].native_text_evidence.spans,anchor=spans.find(s=>s.text==='G-D01');spans.find(s=>Math.abs(s.y-anchor.y)<1.5&&s.text==='1.200').text='1.800';},
  p=>{const spans=p[6].native_text_evidence.spans;spans.find(s=>s.text==='G01 / G05').text='G02 / G05';},
 ]){
  const p=structuredClone(replay.page_results);mutate(p);
  const r=mergePdfEvidence(p,[],13);assert.equal(r.external_block_area,0);assert.ok(r.pdf_analysis.conflicts.some(s=>/Native coordinated quantities withheld/.test(s)));
 }
});

async function independentPlan(width,depth,split){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),p=doc.addPage([1300,1000]),scale=72/.0254/100,origin={x:60,y:80};
 const line=(a,b,thickness)=>p.drawLine({start:{x:origin.x+a[0]*scale,y:origin.y+a[1]*scale},end:{x:origin.x+b[0]*scale,y:origin.y+b[1]*scale},thickness:thickness*scale,color:rgb(.1,.1,.1)});
 for(const [a,b]of [[ [0,0],[width,0] ],[[width,0],[width,depth]],[[width,depth],[0,depth]],[[0,depth],[0,0]]])line(a,b,.2);
 line([split,0],[split,depth],.15);
 const write=(s,x,y)=>p.drawText(s,{x,y,size:9,font});
 for(const [i,x0,x1]of [[1,0,split],[2,split,width]]){
  write('R'+i,origin.x+(x0+x1)/2*scale,origin.y+depth/2*scale);
  write(`Clear ${(x1-x0-.175).toFixed(3)} x ${(depth-.2).toFixed(3)} m`,origin.x+(x0+x1)/2*scale-35,origin.y+depth/2*scale-15);
 }
 const notes=['Units: metres unless noted.','Scale 1:100 at original sheet.',`CL polygon: (0,0) (${width},0) (${width},${depth}) (0,${depth}).`,
  'Solid external wall E91 = 200 mm CMU.','Solid internal wall P93 = 150 mm CMU.',
  'Room clear faces offset 100 mm from external CL; 75 mm from internal CL.',
  'Ceiling areas are net clear room areas, with the same core stair-zone deductions as floors.'];
 notes.forEach((s,i)=>write(s,60,950-i*15));
 const loaded=await PDFDocument.load(await doc.save()),native=extractNativePdfText(loaded,0,{allowRotated:true});
 const page={pageNumber:1,native_plan_text:native,native_text_evidence:native,native_graphics:extractNativePdfGraphics(loaded,0)};
 return measureNativeClearPlan(page,[page]);
}
test('two independently generated plans use their own dimensions, tags and native geometry rather than a benchmark total',async()=>{
 for(const [w,d,s]of [[12,8,5],[21,11,8]]){const r=await independentPlan(w,d,s);assert.equal(r.status,'checked',r.audit.reason);near(r.dimensions.floor_area,(w-.35)*(d-.2));assert.deepEqual(r.rooms.map(r=>r.tag).sort(),['R1','R2']);}
});

test('actual local-only orchestration reuses 13 pages and completed reviews while every model entry point is forbidden',async()=>{
 const host=saved.page_results[0],cache={totalPages:13,pages:structuredClone(saved.page_results),review:{status:'completed',review:host.document_measurement_review,source_pages:host.document_review_status.source_pages},source_basis:{status:'completed',basis:host.document_measurement_review.measurement_basis,source_pages:host.source_measurement_status.source_pages}};
 let calls=0,writes=0,nativeReads=0;
 const forbidden=()=>{calls++;throw Error('Model entry point forbidden');};
 const ctx={Uint8Array,URL,structuredClone,process:{env:{}},console:{log(){},warn(){}},mergePdfEvidence,normalizePdfScope,buildNativePdfSourceBasis,extractNativePdfPages,pdfAnalysisCacheKey,
  buildTakeoffPrompt:()=>'',takeoffSchema:{},buildPdfDocumentReviewPrompt:()=>'',pdfDocumentReviewSchema:{},coalescePdfAnalysis:async(_,fn)=>fn(),readPdfAnalysisCache:async()=>cache,writePdfAnalysisCache:async()=>{writes++;},
  fetch:async()=>({ok:true,headers:{get:()=> 'application/pdf'},arrayBuffer:async()=>sourceBytes.buffer.slice(sourceBytes.byteOffset,sourceBytes.byteOffset+sourceBytes.byteLength)}),
  loadPdf:async()=>({pdf,totalPages:13}),extractPdfPage:forbidden,extractPdfPagePacket:forbidden,
  extractNativePdfText:(...args)=>{nativeReads++;return extractNativePdfText(...args);},extractNativePdfGraphics,
  runPageQueue:async({pages})=>{assert.equal(pages.length,0);return [];},reviewPdfDocumentMeasurements:forbidden,reviewPdfSourceMeasurements:forbidden,needsPdfSourceMeasurements:()=>true};
 vm.createContext(ctx);vm.runInContext(readFileSync('src/services/largePdfAnalysisService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=analyzeLargePdf;',ctx);
 const result=await ctx.run({fileUrl:'https://source.invalid/input.pdf',fileName:'input.pdf',localPdfRecoveryOnly:true,resumeSourceMeasurementsOnly:true});
 assert.equal(calls,0);assert.equal(nativeReads,13);assert.ok(writes>0);assert.equal(completeDrawingResult(result),true);
 assert.equal(result.pdf_analysis.local_pdf_recovery.model_calls_disabled,true);near(result.floor_area,1214.835625);near(result.external_block_area,676.94);near(result.plaster_area,2474.14);
});
