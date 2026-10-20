import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {readNativeSurfaceConventions,measureNativeSurfaceOperations} from '../src/lib/pdfNativeSurfaceOperations.mjs';
import {nativePdfServiceOperations} from '../src/lib/pdfNativeServiceOperations.mjs';
import {bindPdfOperationRates} from '../src/lib/pdfOperationPricing.mjs';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
const conventions=[{sourceCode:'GX88',family:'fixed-glazing',sourceDescription:'Full-height fixed internal glass',rule:'Declared net glazing',page:7},{sourceCode:'XP42',family:'external-paint',sourceDescription:'Exterior weather paint',rule:'Declared net exterior paint',page:7}];
test('one invalid floor never publishes a partial project surface total',()=>{
 const valid={page:2,rooms:[],surface_operations_valid:true,surface_operations:[{...conventions[0],quantity:13,unit:'m2',pages:[2,7],basis:'checked first floor'}]};
 const invalid={page:3,rooms:[],surface_operations_valid:false,surface_operations:[]};
 const result=nativePdfServiceOperations([],[valid,invalid]);assert.equal(result.operations.length,0);assert.match(result.issues.join(' '),/no partial aggregate/);
});
test('independent surface dimensions use one physical host, local height and unique openings; no project constants',()=>{
 const plan={page:{pageNumber:2},walls:[{classification:'glass',length:5},{classification:'external',length:24}]};
 const openings=[{id:'arbitrary-glass-door',kind:'door',width:1,height:2,page:4,host:{classification:'glass'}},{id:'arbitrary-window',kind:'window',width:2,height:1.5,page:5,host:{classification:'external'}}];
 const a=measureNativeSurfaceOperations(plan,openings,3,conventions);
 assert.equal(a[0].quantity,13);assert.equal(a[1].quantity,69);assert.equal(a[0].sourceCode,'GX88');assert.ok(a[0].pages.includes(4));
 const b=measureNativeSurfaceOperations({...plan,walls:[{classification:'glass',length:7},{classification:'external',length:30}]},openings,4,conventions);
 assert.equal(b[0].quantity,26);assert.equal(b[1].quantity,117);
 assert.deepEqual(measureNativeSurfaceOperations(plan,openings,3,[]),[]);
 assert.throws(()=>measureNativeSurfaceOperations(plan,[...openings,openings[0]],3,conventions),/duplicated/);
 assert.throws(()=>measureNativeSurfaceOperations(plan,[{...openings[0],width:50}],3,conventions),/exceed/);
});
test('surface scope requires an explicit readable material/measurement legend and supports arbitrary source codes',()=>{
 const cell=(x,y,text)=>({x,y,text});
 const page={pageNumber:7,native_text_evidence:{status:'readable',spans:[cell(0,100,'Code'),cell(100,100,'Material'),cell(400,100,'Measurement rule'),cell(0,80,'ZZ88'),cell(100,80,'Full-height fixed internal glass'),cell(400,80,'Net CL length x local height less KD01 glass door openings; BOQ m2'),cell(0,60,'COAT77'),cell(100,60,'Exterior weather paint'),cell(400,60,'Net EW99 wall area; no parapets or reveals')]}};
 assert.deepEqual(readNativeSurfaceConventions([page]).map(c=>c.sourceCode),['ZZ88','COAT77']);
 assert.deepEqual(readNativeSurfaceConventions([{...page,native_text_evidence:{status:'unreadable'}}]),[]);
 assert.throws(()=>readNativeSurfaceConventions([page,page]),/Duplicate/);
});
test('known glass thickness cannot be overwritten by a budget assumption; window glazing specification must match',()=>{
 const prices=JSON.parse(readFileSync('data/construction-surface-catalog-v160.json'));
 const row=(family,sourceDescription)=>({quantity:2,unit:'m2',rate:0,rateMissing:true,pdfEvidence:{operation:{family,sourceDescription}}});
 assert.equal(bindPdfOperationRates([row('fixed-glazing','Full-height fixed internal glass')],prices)[0].rate,500);
 assert.equal(bindPdfOperationRates([row('fixed-glazing','Full-height fixed internal glass 12 mm')],prices)[0].rate,0);
 assert.equal(bindPdfOperationRates([row('window-set','Aluminium single glazed window')],prices)[0].rate,0);
});
test('actual PDF restores GL01/EPNT and twelve window types without duplicate totals, AI calls or drawing-reference inputs',async()=>{
 const pdf=await PDFDocument.load(readFileSync('tests/fixtures/pdf-complex-dimensioned-input.pdf'));
 const saved=JSON.parse(readFileSync('tests/fixtures/pdf-complex-saved-review.json'));
 const pages=saved.page_results.map(p=>{const native=extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:true});return {...p,native_text_evidence:native,...(p.page_evidence.kind==='floor_plan'?{native_plan_text:native,native_graphics:extractNativePdfGraphics(pdf,p.pageNumber-1)}:{})};});
 const takeoff=mergePdfEvidence(pages,[],13),baseline=JSON.parse(readFileSync('tests/fixtures/pdf-operation-catalog-before-v158.json'));
 const byCode=new Map([...baseline.prices,...JSON.parse(readFileSync('data/construction-operation-catalog-v158.json')),...JSON.parse(readFileSync('data/construction-budget-v159/rates.json')),...JSON.parse(readFileSync('data/construction-surface-catalog-v160.json'))].map(r=>[r.item_code,r]));
 const result=await runOfflinePdfCatalog(takeoff,[...byCode.values()],{rules:baseline.rules,sections:baseline.sections}),positive=result.boq.items.filter(i=>i.quantity>0);
 const byFamily=f=>positive.filter(i=>i.pdfEvidence?.operation?.family===f);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
 near(byFamily('fixed-glazing')[0].quantity,96.32);assert.equal(byFamily('fixed-glazing')[0].rate,500);
 near(byFamily('external-paint')[0].quantity,676.94);assert.equal(byFamily('external-paint')[0].rate,26);
 assert.equal(byFamily('window-set').length,12);near(byFamily('window-set').reduce((s,i)=>s+i.quantity,0),142.74);
 assert.equal(positive.filter(i=>i.pdfEvidence?.metricKey==='window_area').length,0);
 assert.equal(positive.length,72);assert.equal(positive.filter(i=>!(i.rate>0)).length,0);
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
 assert.equal(new Set(positive.map(i=>i.itemCode)).size,positive.length);
 for(const i of [...byFamily('fixed-glazing'),...byFamily('external-paint'),...byFamily('window-set')]){assert.equal(i.includeInCommercialTotal,false);assert.ok(i.pdfEvidence.pages.includes(2)||i.pdfEvidence.pages.includes(3));}
});
