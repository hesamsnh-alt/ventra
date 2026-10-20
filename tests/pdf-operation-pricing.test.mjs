import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bindPdfOperationRates,pdfOperationProfile} from '../src/lib/pdfOperationPricing.mjs';
import {classifyEstimateItem} from '../src/lib/estimateClassification.mjs';
import {readPdfSourceSpecifications} from '../src/lib/pdfSourceSpecifications.mjs';
import {PDFDocument} from 'pdf-lib';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
const catalog=JSON.parse(readFileSync('data/construction-operation-catalog-v158.json'));
const row=(family,description,unit='m',quantity=10)=>({itemCode:'PDF-arbitrary',quantity,unit,rate:0,rateMissing:true,verification:'pending',pdfEvidence:{metricKey:'native-'+family+':arbitrary',operation:{family,sourceDescription:description}}});
test('material, diameter, insulation, family and units select a canonical rate independently of source codes',()=>{
 const r=bindPdfOperationRates([row('pipe','PPR cold water DN25')],catalog)[0];assert.equal(r.rate,33);assert.equal(r.amount,330);assert.equal(r.operationPricing.catalog_code,'VNT-OP-PPR-25');assert.equal(classifyEstimateItem(r),'provisional');
 for(const [d,u]of [['uPVC condensate DN25','m'],['PPR cold water DN32','m'],['Insulated PPR hot water DN25','m'],['PPR cold water DN25','m2']])assert.equal(bindPdfOperationRates([row('pipe',d,u)],catalog)[0].rate,0);
});
test('specific source method beats an editable default; known method cannot be contradicted',()=>{
 const rows=['LVT plank floor','Glue-down LVT plank floor','Click LVT plank floor'].map(d=>row('floor',d,'m2',20));
 assert.deepEqual(bindPdfOperationRates(rows,catalog).map(r=>r.rate),[160,195,160]);
 assert.equal(bindPdfOperationRates([row('floor','SPC plank floor','m2')],catalog)[0].rate,170);
 assert.equal(bindPdfOperationRates([row('floor','solid wood floor','m2')],catalog)[0].rate,0);
});
test('equal specificity is ambiguous even when only one candidate has a positive price',()=>{
 const p=structuredClone(catalog.find(p=>p.item_code==='VNT-OP-PPR-25'));p.item_code='COMPETING';p.standard_rate=0;p.total_rate=0;
 const result=bindPdfOperationRates([row('pipe','PPR DN25')],[...catalog,p])[0];assert.equal(result.rate,0);assert.equal(result.operationPricing.status,'ambiguous');
});
test('source quantities are preserved and dimensional rate conversions are explicit',()=>{
 const price=structuredClone(catalog.find(p=>p.item_code==='VNT-OP-SCREED'));price.unit='m2';price.standard_rate=100;const c=JSON.parse(price.source_reference);c.unit_basis='area_from_thickness';price.source_reference=JSON.stringify(c);
 const original=row('screed','Floor screed 50 mm','m3',3),result=bindPdfOperationRates([original],[price])[0];assert.equal(result.quantity,3);assert.equal(result.unit,'m3');assert.equal(result.rate,2000);assert.equal(result.amount,6000);assert.equal(result.operationPricing.rate_factor,20);
 assert.equal(bindPdfOperationRates([row('screed','Screed unknown thickness','m3')],[price])[0].rate,0);
 const door=structuredClone(catalog.find(p=>p.item_code==='VNT-OP-GLASS'));door.unit='m2';door.standard_rate=1000;const dc=JSON.parse(door.source_reference);dc.unit_basis='opening_area';door.source_reference=JSON.stringify(dc);
 assert.equal(bindPdfOperationRates([row('door-set','glass door 0.900 x 2.400','nr',2)],[door])[0].amount,4320);
});
test('missing quote is explicit, manual selection is preserved and unpriced placeholders are never verified',()=>{
 const fcu=bindPdfOperationRates([row('equipment','Fan-coil units','nr',8)],catalog)[0];assert.equal(fcu.rate,0);assert.equal(fcu.operationPricing.status,'catalog_rate_missing');assert.ok(fcu.operationPricing.required_information.length);
 const manual={...row('pipe','PPR DN25'),rate:50,rateMissing:false,catalogSelection:{itemCode:'OWN'}};assert.equal(bindPdfOperationRates([manual],catalog)[0],manual);
 assert.equal(classifyEstimateItem({source:'manual',status:'manual',quantity:1,rate:0,description:'New BOQ item'}),'pending');
});
test('wall heights above FFL are not block thickness; coded CMU specifications resolve independently',()=>{
 const page={pageNumber:1,page_evidence:{kind:'specification',scope_id:'project'},native_text_evidence:{status:'readable',spans:[{x:0,y:100,text:'Solid internal wall Q77 = 150 mm CMU'},{x:0,y:80,text:'Ground external and internal walls 4.000 m above ground FFL'},{x:0,y:60,text:'First external and internal walls 3.600 m above first FFL'}]}};
 const facts=readPdfSourceSpecifications({page_results:[page]});assert.deepEqual(facts.filter(f=>f.property==='thickness_mm').map(f=>f.value),[150]);assert.ok(facts.some(f=>f.property==='block_material'&&f.value==='concrete'));
});
test('actual page extraction caps reasoning/output, forbids retries and discards incomplete output before parsing',async()=>{
 const source=readFileSync('src/services/pageAnalysisService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'');
 for(const incomplete of [false,true]){let request,parse=0,deletes=0;const client={files:{create:async()=>({id:'fake'}),delete:async()=>deletes++},responses:{create:async(p,opts)=>{request=p;assert.equal(opts.maxRetries,0);return {status:incomplete?'incomplete':'completed',incomplete_details:{reason:'max_output_tokens'},output_text:'{}'};}}};
 const ctx={getOpenAIClient:()=>client,buildTakeoffPrompt:()=>'',parseTakeoffResponse:()=>{parse++;return {};},takeoffSchema:{},File,process:{env:{}},console:{log(){},warn(){},error(){}}};vm.createContext(ctx);vm.runInContext(source+'\nthis.run=analyzeDrawingPage;',ctx);
 if(incomplete)await assert.rejects(ctx.run({pageBytes:new Uint8Array([1]),pageNumber:1}),e=>e.code==='PDF_PAGE_RESPONSE_INCOMPLETE');else await ctx.run({pageBytes:new Uint8Array([1]),pageNumber:1});
 assert.equal(request.reasoning.effort,'minimal');assert.equal(request.max_output_tokens,12000);assert.equal(parse,incomplete?0:1);assert.equal(deletes,1);}
});
test('actual source-to-BOQ path prices distinct operations from the live catalog snapshot without model calls or database writes',async()=>{
 const pdf=await PDFDocument.load(readFileSync('tests/fixtures/pdf-complex-dimensioned-input.pdf'));
 const saved=JSON.parse(readFileSync('tests/fixtures/pdf-complex-saved-review.json'));
 const source=saved.page_results.map(p=>{const native=extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:true});return {...p,native_text_evidence:native,...(p.page_evidence.kind==='floor_plan'?{native_plan_text:native,native_graphics:extractNativePdfGraphics(pdf,p.pageNumber-1)}:{})};});
 const takeoff=mergePdfEvidence(source,[],13),snapshot=JSON.parse(readFileSync('tests/fixtures/pdf-operation-catalog-before-v158.json'));
 const prices=[...snapshot.prices,...catalog],result=await runOfflinePdfCatalog(takeoff,prices,{rules:snapshot.rules,sections:snapshot.sections});
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
 const positive=result.boq.items.filter(i=>i.quantity>0),code=c=>positive.find(i=>i.itemCode===c);
 assert.ok(Math.abs(code('MAS-002').quantity-926.72)<1e-7);assert.equal(code('MAS-002').rate,58);
 assert.equal(code('PDF-PIPE-CW25').rate,33);assert.equal(code('PDF-PIPE-WW50').rate,36);assert.equal(code('PDF-PIPE-SW110').rate,58);
 assert.equal(code('PDF-FLOOR-F02').rate,160);assert.equal(code('PDF-FLOOR-F03').rate,120);assert.equal(code('PDF-CEILING-BOARD-C02').rate,96);
 assert.equal(code('PDF-EQUIPMENT-FCU01').rate,0);assert.equal(code('PDF-EQUIPMENT-FCU01').operationPricing.status,'catalog_rate_missing');
 assert.equal(new Set(positive.map(i=>i.itemCode)).size,positive.length);
 for(const item of positive.filter(i=>i.operationPricing?.status==='priced_provisional')){assert.equal(classifyEstimateItem(item),'provisional');assert.equal(item.includeInCommercialTotal,false);assert.ok(Math.abs(item.amount-item.quantity*item.rate)<.02);}
 const updated=structuredClone(prices),lvt=updated.find(p=>p.item_code==='VNT-OP-LVT-CLICK');lvt.standard_rate+=10;
 const changed=await runOfflinePdfCatalog(takeoff,updated,{rules:snapshot.rules,sections:snapshot.sections});
 const delta=changed.boq.items.reduce((s,i)=>s+i.amount,0)-result.boq.items.reduce((s,i)=>s+i.amount,0);
 assert.ok(Math.abs(delta-code('PDF-FLOOR-F02').quantity*10)<.02);
});
