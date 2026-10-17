import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyPdfDefaultSpecifications} from '../src/lib/pdfDefaultSpecifications.mjs';
import {readPdfSourceSpecifications} from '../src/lib/pdfSourceSpecifications.mjs';
import {annotatePdfBoqCompletion} from '../src/lib/pdfBoqCompletion.mjs';
import {applyBoqCatalogSelection,editPdfBoqItem} from '../src/lib/boqPriceSelection.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {classifyEstimateItem} from '../src/lib/estimateClassification.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';

const key='water_pipe_length';
function setup(quantity=37,text=''){
 const claim={key,unit:'m',value:quantity,evidence:`Water pipe route length ${quantity} m`,pages:[1]};
 const takeoff={pdf_analysis:{quantity_evidence:{[key]:[claim]}},scheduled_quantities:{[key]:quantity},page_results:text?[{pageNumber:1,page_evidence:{scope_id:'project'},native_text_evidence:{status:'readable',spans:[{x:10,y:10,text}]}}]:[]};
 const item={itemCode:'PDF-WATER_PIPE_LENGTH',description:'Water pipes',unit:'m',quantity,rate:0,amount:0,rateMissing:true,status:'measured_rate_pending',verification:'pending',pdfEvidence:{metricKey:key,pages:[1],basis:claim.evidence}};
 const policy={kind:'pricing_default',enabled:true,metric:key,specification:{pipe_material:'PPR',diameter_mm:20},label:'Water supply pipe PPR 20mm',rate_basis:'Existing catalog budget rate; review required'};
 const price={item_code:'PLB-001',description:'PPR water supply pipe 20mm including fittings and installation',unit:'m',standard_rate:27,premium_rate:31,is_active:true,currency:'AED',source_reference:JSON.stringify(policy)};
 return {takeoff,item,price,policy};
}
test('different projects use catalog-configured defaults without inventing quantity or source facts',()=>{
 for(const quantity of [37,86.5]){
  const {takeoff,item,price}=setup(quantity),before=structuredClone(takeoff),row=applyPdfDefaultSpecifications([item],takeoff,[price])[0];
  assert.equal(row.quantity,quantity);assert.equal(row.rate,27);assert.equal(row.amount,Math.round(quantity*27*100)/100);
  assert.equal(row.defaultSpecification.assumed.diameter_mm,20);assert.equal(row.specificationVerification,'assumed');
  assert.match(row.description,/assumed specification/);assert.match(row.notes,/NOT A DRAWING SPECIFICATION/);
  assert.equal(classifyEstimateItem(row),'provisional');assert.equal(row.includeInCommercialTotal,false);assert.deepEqual(takeoff,before);
 }
});
test('a different explicit diameter/material and mixed source specifications override the fallback',()=>{
 for(const text of ['Water supply pipe PPR 25mm','Water supply pipe PPR Ø25','Water supply pipe PPR DN25','Water supply pipe PPR 20/25mm','Water supply pipe copper 20mm','Water supply pipe CPVC 20mm','Water supply pipe PPR 20mm; Water supply pipe PPR 25mm']){
  const {takeoff,item,price}=setup(37,text);assert.deepEqual(applyPdfDefaultSpecifications([item],takeoff,[price]),[item]);
 }
});
test('compatible source material is retained while only the missing diameter is assumed',()=>{
 const {takeoff,item,price}=setup(37,'Water supply pipes PPR');
 const row=applyPdfDefaultSpecifications([item],takeoff,[price])[0];
 assert.deepEqual(row.defaultSpecification.assumed,{diameter_mm:20});assert.equal(row.defaultSpecification.sourceSpecifications[0].value,'PPR');
});
test('one floor detail cannot supply a default for an aggregate project quantity',()=>{
 const {takeoff,item,price}=setup(37,'Water supply pipes PPR');takeoff.page_results[0].page_evidence.scope_id='floor:0';takeoff.pdf_analysis.selected_floor_pages=[{scope:'floor:0'},{scope:'floor:1'}];
 assert.deepEqual(applyPdfDefaultSpecifications([item],takeoff,[price]),[item]);
});
test('inactive, malformed, wrong-currency, duplicate or unpriced policies cannot produce a charge',()=>{
 const {takeoff,item,price,policy}=setup();
 for(const catalog of [[{...price,is_active:false}],[{...price,source_reference:'bad json'}],[{...price,source_reference:JSON.stringify({...policy,label:34})}],[{...price,currency:'USD'}],[price,{...price,item_code:'DUP'}],[{...price,standard_rate:0,premium_rate:0}]])assert.deepEqual(applyPdfDefaultSpecifications([item],takeoff,catalog),[item]);
});
test('missing or inconsistent measurement evidence and duplicate measured rows are not default-priced',()=>{
 const {takeoff,item,price}=setup();
 for(const t of [{...takeoff,pdf_analysis:{}},{...takeoff,pdf_analysis:{quantity_evidence:{[key]:[{key,unit:'m',value:36,evidence:'Different total',pages:[1]}]}}}])assert.deepEqual(applyPdfDefaultSpecifications([item],t,[price]),[item]);
 assert.deepEqual(applyPdfDefaultSpecifications([item,{...item,itemCode:'DUP'}],takeoff,[price]),[item,{...item,itemCode:'DUP'}]);
});
test('manual, reviewed, already-priced and non-PDF rows are preserved; repeated application is idempotent',()=>{
 const {takeoff,item,price}=setup();
 for(const row of [{...item,source:'manual'},{...item,review:{confirmed:true}},{...item,rate:99}])assert.deepEqual(applyPdfDefaultSpecifications([row],takeoff,[price]),[row]);
 assert.deepEqual(applyPdfDefaultSpecifications([item],{},[price]),[item]);
 const rows=applyPdfDefaultSpecifications([item],takeoff,[price]);assert.deepEqual(applyPdfDefaultSpecifications(rows,takeoff,[price]),rows);
});
test('price level remains respected and the audit separately counts assumption-priced operations',()=>{
 const {takeoff,item,price}=setup();const r=annotatePdfBoqCompletion([item],takeoff,[price],'premium');
 assert.equal(r.items[0].rate,31);assert.equal(r.summary.assumedSpecificationOperations,1);assert.equal(r.summary.unpricedMeasuredOperations,0);
});
test('catalog selection replaces an assumption with the selected rate and preserves quantity; edits recalculate amounts',()=>{
 const {takeoff,item,price}=setup();const row=applyPdfDefaultSpecifications([item],takeoff,[price])[0];
 const selected=applyBoqCatalogSelection(row,{itemCode:'PLB-002',description:'PPR water supply pipe 25mm',unit:'m',rate:33,section:'Plumbing',rateSource:'direct_standard_rate'});
 assert.equal(selected.quantity,37);assert.equal(selected.rate,33);assert.equal(selected.amount,1221);assert.equal(selected.defaultSpecification.status,'superseded_by_catalog_selection');
 assert.match(selected.notes,/PREVIOUS PRICING ASSUMPTION \(SUPERSEDED/);assert.doesNotMatch(selected.notes,/PRICING ASSUMPTION \(EDITABLE/);
 const changed=editPdfBoqItem(row,'rate',29);assert.equal(changed.amount,1073);assert.equal(changed.defaultSpecification.rateOverridden,true);
 const renamed=editPdfBoqItem(row,'description','PPR water supply pipe 25mm');assert.equal(renamed.rate,0);assert.equal(renamed.rateMissing,true);assert.equal(renamed.defaultSpecification.status,'specification_edited');
 const manual=editPdfBoqItem(renamed,'rate',33);assert.equal(manual.amount,1221);
});
test('export includes explicit assumption disclosure and keeps the provisional charge outside verified tender',()=>{
 const {takeoff,item,price}=setup();const row=applyPdfDefaultSpecifications([item],takeoff,[price])[0],out=buildBoqExport([row]);
 assert.equal(out.sums.provisional,999);assert.equal(out.sums.verified,0);assert.match(JSON.stringify(out),/NOT A DRAWING SPECIFICATION/);
});
test('native AC pair sizes and insulation are read as source facts; unknown or different detail is not overwritten',()=>{
 for(const text of ['AC copper pipe pair 1/4 inch and 1/2 inch with 9mm insulation','AC copper pipe pair 3/8 inch and 5/8 inch with 13mm insulation','AC copper pipes diameter 22mm']){
  const {takeoff}=setup(37,text),facts=readPdfSourceSpecifications(takeoff).filter(f=>f.metric==='ac_pipe_length');
  assert.ok(facts.length>0);assert.ok(facts.some(f=>f.property==='diameter_pair_mm'||f.property==='unparsed_pipe_detail'));
 }
});
test('AC defaults price unspecified route lengths but reject different or unreadable detailed source sizes',()=>{
 const p={kind:'pricing_default',enabled:true,metric:'ac_pipe_length',specification:{pipe_material:'COPPER',diameter_pair_mm:'6.35+12.7',insulation_mm:9},label:'AC copper pair 1/4 and 1/2 inch, 9mm insulation',rate_basis:'Assumed budget allowance'};
 const price={item_code:'AC-EST',unit:'m',currency:'AED',standard_rate:72.5,source_reference:JSON.stringify(p)};
 for(const [text,applies] of [['AC pipe 16 m',true],['AC copper pipe pair 1/4 inch and 1/2 inch with 9mm insulation',true],['AC copper pipe pair 3/8 inch and 5/8 inch with 13mm insulation',false],['AC copper pipe pair 3/8 and 5/8 inch',false],['AC copper pipes diameter 22mm',false]]){
  const {takeoff,item}=setup(16,text);takeoff.pdf_analysis.quantity_evidence={ac_pipe_length:[{key:'ac_pipe_length',unit:'m',value:16,evidence:'AC route 16 m',pages:[1]}]};item.pdfEvidence.metricKey='ac_pipe_length';
  const row=applyPdfDefaultSpecifications([item],takeoff,[price])[0];assert.equal(row.rate,applies?72.5:0,text);
 }
});
test('unparsed detailed scanned evidence is preserved instead of being overwritten by an unknown default',()=>{
 const {takeoff,item,price}=setup();takeoff.pdf_analysis.quantity_evidence[key][0].evidence='Scanned water supply DN25 schedule: 37 m';
 assert.deepEqual(applyPdfDefaultSpecifications([item],takeoff,[price]),[item]);
});
test('actual server route applies configured policies to saved reports and uses no model or database write',async()=>{
 const report=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-v129-missing-room-inventory.json',import.meta.url),'utf8'));
 const {price}=setup();const result=await runOfflinePdfCatalog(report,[price]);
 const row=result.boq.items.find(i=>i.pdfEvidence?.metricKey===key&&i.quantity>0);
 assert.equal(row.quantity,80);assert.equal(row.rate,27);assert.equal(row.amount,2160);assert.equal(row.defaultSpecification.assumed.diameter_mm,20);
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
});
