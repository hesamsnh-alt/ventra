import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
import {nativeDeclaredScheduleOperations} from '../src/lib/pdfDeclaredScheduleOperations.mjs';
import {bindPdfSourceRates,readPdfSourceRateBook} from '../src/lib/pdfSourceRateBook.mjs';
import {applyPdfDefaultSpecifications} from '../src/lib/pdfDefaultSpecifications.mjs';
import {pdfOperationProfile,bindPdfOperationRates} from '../src/lib/pdfOperationPricing.mjs';

const doc=await PDFDocument.load(readFileSync('tests/fixtures/pdf-declared-schedules-input.pdf'));
const original=doc.getPages().map((_,i)=>{
 const native=extractNativePdfText(doc,i,{allowRotated:true});
 return {pageNumber:i+1,native_text_evidence:native,page_evidence:{kind:[1,2].includes(i)?'floor_plan':'schedule',scope_id:i===1?'ground floor':i===2?'first floor':'project',revision:'1',drawing_id:'sheet-'+i,quantities:[]},
  ...([1,2].includes(i)?{native_plan_text:native,native_graphics:extractNativePdfGraphics(doc,i)}:{})};
});
original[0].document_measurement_review={calculations:[],floor_revisions:[],exclusions:[],notes:''};
original[0].document_review_status={status:'completed',source_pages:original.map(p=>p.pageNumber)};
// Replay the observed model failure, rather than expecting its grouping to be
// correct. The independently hosted source instance ledger must replace it.
original[8].page_evidence.quantities.push({key:'window_area',scope_id:'project',value:63.6,unit:'m2',pages:[9],evidence:'Earlier AI grouped 22 windows and omitted eight physical instances.'});
const replay=mergePdfEvidence(original,[],13);
const catalog=JSON.parse(readFileSync('tests/fixtures/pdf-operation-catalog-before-v158.json'));
const result=await runOfflinePdfCatalog(replay,catalog.prices,{rules:catalog.rules});
const positive=result.boq.items.filter(i=>i.quantity>0);
const row=code=>positive.find(i=>i.itemCode===code);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('actual server BOQ replaces wrong model window grouping and retains each door type and size variant',()=>{
 close(row('PDF-WINDOW-SET-W01').quantity,84.3);
 close(replay.scheduled_quantities.window_area,84.3);close(replay.scheduled_quantities.window_count,30);close(replay.scheduled_quantities.door_count,30);
 assert.equal(row('PDF-WINDOW-SET-W01').pdfEvidence.operation.instances.length,30);
 for(const [type,n]of [['D01',25],['D02',1],['D03',2],['D04',2]])close(row('PDF-DOOR-SET-'+type).quantity,n);
 assert.match(row('PDF-DOOR-SET-D04').description,/glass/i);
 assert.match(row('PDF-DOOR-SET-D01').description,/varying scheduled dimensions/i);
 assert.ok(!positive.some(i=>['window_area','door_count','internal_door_count','service_door_count','entrance_door_count'].includes(i.pdfEvidence?.metricKey)));
});
test('source diameters, water systems, FCUs, insulation, ducts and electrical routes reach priced rows without aggregate aliases',()=>{
 const quantities={'PDF-PIPE-CW20':58,'PDF-PIPE-CW25':32,'PDF-PIPE-HW20':26,'PDF-PIPE-DW50':42,'PDF-PIPE-DW110':28,'PDF-PIPE-CHW25':176,'PDF-PIPE-INSULATION-INS25':176,'PDF-DUCT-SHEET-DU01':92,'PDF-ELECTRICAL-ROUTE-CB20':420,'PDF-ELECTRICAL-ROUTE-CB40':186,'PDF-ELECTRICAL-ROUTE-CT01':96,'PDF-EQUIPMENT-FCU01':15};
 for(const [code,q]of Object.entries(quantities)){close(row(code).quantity,q);assert.ok(row(code).rate>0);}
 assert.match(row('PDF-PIPE-CW25').description,/25 mm/);
 assert.match(row('PDF-EQUIPMENT-FCU01').description,/fan coil.*3.5 kw/i);
 assert.ok(!positive.some(i=>/split air|copper pipe pair/i.test(i.description)));
 assert.ok(!positive.some(i=>['water_pipe_length','waste_pipe_length','ac_pipe_length','ac_count'].includes(i.pdfEvidence?.metricKey)));
 close(positive.filter(i=>i.pdfEvidence?.operation?.family==='skirting').reduce((s,i)=>s+i.quantity,0),569.4);
});
test('all 39 independent source rate lines reconcile after splitting finish operations; quantities never come from the rate book',()=>{
 const expected={MS01:80617.5,MS02:88980.08,GL01:23946,PL01:76430.08,PA01:35470.4,WT01:14580.9,WP01:7464.6,WP02:707.4,FL01:89761.2,FL02:35242.35,FL03:12893.4,C01:95927.4,CP01:17777.6,SKT01:12526.8,W01:75870,D01:27500,D02:2800,D03:2900,D04:4400,CW20:2204,CW25:1536,HW20:1144,DW50:2184,DW110:2184,CHW25:10208,INS25:3872,DU01:9660,CB20:5040,CB40:3348,CT01:6240,LT01:18270,SO01:10260,FCU01:31500,DB01:5800,SD01:3230,WC01:2340,WB01:2480,SH01:1120,SK01:2160};
 const actual={};for(const i of positive){assert.ok(i.sourceRate);actual[i.sourceRate.code]=(actual[i.sourceRate.code]||0)+Math.round(i.amount*100)/100;assert.equal(i.includeInCommercialTotal,false);}
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
 for(const [code,amount]of Object.entries(expected))close(actual[code],amount);
 close(positive.reduce((s,i)=>s+Math.round(i.amount*100)/100,0),830575.71);
 assert.equal(result.boq.pdfCompletion.unpricedMeasuredOperations,0);
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
 assert.equal(result.boq.summary.verifiedSubtotal,0);
 assert.ok(result.boq.assumptions.some(s=>s.includes('original PDF rate book')));
});
test('changing the original pipe quantity changes BOQ cost; source geometry and unrelated systems stay fixed',async()=>{
 const changed=structuredClone(original),spans=changed[9].native_text_evidence.spans,anchor=spans.find(s=>s.text==='CW20');
 spans.find(s=>Math.abs(s.y-anchor.y)<1.5&&s.text==='58').text='61';
 const next=mergePdfEvidence(changed,[],13),out=await runOfflinePdfCatalog(next,catalog.prices,{rules:catalog.rules});
 close(out.boq.items.find(i=>i.itemCode==='PDF-PIPE-CW20').quantity,61);
 close(out.boq.summary.provisionalSubtotal,830689.71);
 close(next.floor_area,replay.floor_area);
});

const cell=(x,y,text)=>({x,y,text});
function schedule(code='ZZ87',q='19',u='m',description='Hot water pipe 32 mm'){
 return {pageNumber:99,native_text_evidence:{status:'readable',spans:[cell(0,200,'Declared MEP project totals'),cell(0,100,'Code'),cell(150,100,'Source operation'),cell(500,100,'Quantity'),cell(600,100,'Unit'),cell(0,80,code),cell(150,80,description),cell(500,80,q),cell(600,80,u)]}};
}
function ratePage(code='ZZ87',rate='9.75',u='m',description='Hot water pipe 32 mm'){
 return {pageNumber:100,native_text_evidence:{status:'readable',spans:[cell(0,100,'Code'),cell(150,100,'Operation'),cell(500,100,'Unit'),cell(600,100,'AED/unit'),cell(0,80,code),cell(150,80,description),cell(500,80,u),cell(600,80,rate)]}};
}
test('independent arbitrary identifiers/quantities use their own source columns, not benchmark codes',()=>{
 const p=schedule(),rates=ratePage(),op=nativeDeclaredScheduleOperations([p],[]).operations[0];
 assert.equal(op.sourceCode,'ZZ87');assert.equal(op.quantity,19);assert.deepEqual(op.replacesMetrics,['water_pipe_length']);
 const item={quantity:op.quantity,unit:op.unit,rate:0,pdfEvidence:{metricKey:op.metricKey,operation:op}};
 const priced=bindPdfSourceRates([item],{page_results:[p,rates]})[0];close(priced.rate,9.75);close(priced.amount,185.25);
 assert.equal(nativeDeclaredScheduleOperations([schedule('OTHER9','19','m2')],[]).operations.length,0);
});
test('conflicting counts, duplicate rows, unsupported quantities and missing units withhold rather than invent source operations',()=>{
 for(const p of [schedule('ZZ87','-4'),schedule('ZZ87','NaN'),schedule('ZZ87','19','')]){
  const r=nativeDeclaredScheduleOperations([p],[]);assert.equal(r.operations.length,0);assert.ok(r.issues.length);
 }
 const p=schedule();p.native_text_evidence.spans.push(...p.native_text_evidence.spans.filter(s=>s.y===80).map(s=>({...s,y:60})));
 const r=nativeDeclaredScheduleOperations([p],[]);assert.equal(r.operations.length,0);assert.match(r.issues.join(' '),/Duplicate/);
 const counts={pageNumber:4,native_text_evidence:{status:'readable',spans:[cell(0,200,'Project counts'),...['Code','Description','Ground','First','Project qty'].map((s,i)=>cell(i*150,100,s)),...['ALPHA7','Fan coil units - 5 kW','2','3','9'].map((s,i)=>cell(i*150,80,s))]}};
 assert.equal(nativeDeclaredScheduleOperations([counts],[]).operations.length,0);
});
test('missing, incompatible or conflicting rate books do not supply rates, and manual/catalog/project choices are preserved',()=>{
 const op=nativeDeclaredScheduleOperations([schedule()],[]).operations[0],item={quantity:19,unit:'m',rate:0,pdfEvidence:{metricKey:op.metricKey,operation:op}};
 assert.equal(bindPdfSourceRates([item],{page_results:[]})[0].rate,0);
 const equipment={quantity:2,unit:'nr',rate:0,pdfEvidence:{metricKey:'native-equipment:ALPHA7',operation:{family:'equipment',sourceCode:'ALPHA7',sourceDescription:'Fan coil units 3.5 kW'}}};
 assert.equal(bindPdfSourceRates([equipment],{page_results:[ratePage('ALPHA7','2100','nr','Fan coil units 7 kW')]})[0].rate,0);
 const wrong=structuredClone(replay);wrong.page_results[11].native_text_evidence.spans.forEach(s=>s.text=s.text.replace('250 mm external masonry','200 mm external masonry'));
 const wall={quantity:644.94,unit:'m2',rate:0,pdfEvidence:{metricKey:'external_block_area'}};
 assert.equal(bindPdfSourceRates([wall],wrong)[0].rate,0);

 assert.equal(bindPdfSourceRates([item],{page_results:[ratePage('ZZ87','10','m','Hot water pipe 40 mm')]})[0].rate,0);
 assert.equal(readPdfSourceRateBook([ratePage(),ratePage('ZZ87','22')]).rates.length,0);
 assert.equal(bindPdfSourceRates([item],{page_results:[ratePage(),ratePage('ZZ87','22')]})[0].rate,0);
 for(const extra of [{source:'manual'},{catalogSelection:{}},{review:{confirmed:true}},{projectRateSelection:{}},{quantityBasis:'manual_quantity_override'}]){
  const protectedItem={...item,rate:77,...extra};assert.strictEqual(bindPdfSourceRates([protectedItem],{page_results:[ratePage()]})[0],protectedItem);
 }
});
test('source profile retains physical pipe diameters and cable cores with different accepted notations',()=>{
 assert.equal(pdfOperationProfile({family:'pipe',sourceDescription:'PPR pipe 32 mm'}).diameter_mm,32);
 assert.equal(pdfOperationProfile({family:'pipe',sourceDescription:'PPR DN25 uninsulated pipe'}).diameter_mm,25);
 const cable=pdfOperationProfile({family:'electrical-route',sourceDescription:'Power cable 3 x 2.5 mm2'});
 assert.equal(cable.cores,3);assert.equal(cable.area_mm2,2.5);
 const old=pdfOperationProfile({family:'electrical-route',sourceDescription:'Power cable 4c x 6 mm2'});
 assert.equal(old.cores,4);assert.equal(old.area_mm2,6);
});

test('unsupported aggregate model HVAC evidence cannot turn a known hydronic source into a split allowance',()=>{
 const claim={key:'ac_count',value:15,unit:'nr',pages:[11],evidence:'Scheduled equipment total'};
 const takeoff={page_results:[{pageNumber:11,native_text_evidence:{status:'readable',spans:[cell(0,0,'Fan coil units 3.5 kW')]}}],pdf_analysis:{quantity_evidence:{ac_count:[claim]}}};
 const item={quantity:15,unit:'nr',rate:0,pdfEvidence:{metricKey:'ac_count'}};
 assert.equal(applyPdfDefaultSpecifications([item],takeoff,catalog.prices)[0].rate,0);
 const without=structuredClone(takeoff);without.page_results=[];
 assert.ok(applyPdfDefaultSpecifications([item],without,catalog.prices)[0].rate>0,'the pre-existing split allowance remains available when source is unspecified');
});

test('an explicit source rate book prices the same measured operations even with no database catalog',async()=>{
 const out=await runOfflinePdfCatalog(replay,[]);
 const items=out.boq.items.filter(i=>i.quantity>0);
 assert.equal(items.length,44);assert.ok(items.every(i=>i.rate>0&&i.sourceRate));
 close(items.reduce((s,i)=>s+Math.round(i.amount*100)/100,0),830575.71);
 assert.equal(out.modelCalls,0);assert.equal(out.databaseWrites,0);
});
