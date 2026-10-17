import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyPdfDefaultSpecifications} from '../src/lib/pdfDefaultSpecifications.mjs';
import {readPdfSourceSpecifications} from '../src/lib/pdfSourceSpecifications.mjs';
import {planPdfCatalogRules} from '../src/lib/pdfBoqCoverage.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
import {editPdfBoqItem} from '../src/lib/boqPriceSelection.mjs';
const load=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const before=load('pdf-catalog-before-v132.json').filter(p=>p.is_active),changes=load('pdf-default-prices-v132.json');
const map=new Map(before.map(p=>[p.item_code,p]));for(const p of changes)map.set(p.item_code,{...map.get(p.item_code),...p});const prices=[...map.values()];
const report=load('pdf-observed-v129-missing-room-inventory.json');
const after=await runOfflinePdfCatalog(report,prices),baseline=await runOfflinePdfCatalog(report,before);
const measured=r=>r.boq.items.filter(i=>i.quantity>0);
const totals=r=>Object.entries(measured(r).reduce((a,i)=>{const k=i.pdfEvidence?.metricKey;if(k)a[k]=(a[k]||0)+i.quantity;return a;},{})).sort();
function single(key,value,unit,text=''){
 const claim={key,value,unit,pages:[1],evidence:`Measured source operation ${key}: ${value} ${unit}`};
 const t={scheduled_quantities:{[key]:value},pdf_analysis:{quantity_evidence:{[key]:[claim]}},page_results:text?[{pageNumber:1,page_evidence:{scope_id:'project',kind:'specification'},native_text_evidence:{status:'readable',spans:[{text,x:10,y:10,height:10}]}}]:[]};
 return {t,row:{itemCode:'PDF-'+key.toUpperCase(),description:'Measured operation',quantity:value,unit,rate:0,rateMissing:true,status:'measured_rate_pending',pdfEvidence:{metricKey:key,pages:[1],basis:claim.evidence}}};
}
test('all 29 previously unpriced operations receive rates; quantities are conserved and no oracle or model supplies them',()=>{
 assert.equal(measured(baseline).filter(i=>!(i.rate>0)).length,29);
 assert.equal(measured(after).filter(i=>!(i.rate>0)).length,0);assert.equal(measured(after).length,51);
 assert.deepEqual(totals(after),totals(baseline));assert.equal(after.modelCalls,0);assert.equal(after.databaseWrites,0);
 for(const old of measured(baseline).filter(i=>i.rate>0)){
  const next=after.boq.items.find(i=>i.itemCode===old.itemCode);assert.equal(next.rate,old.rate);assert.equal(next.amount,old.amount);
 }
});
test('native door categories remain disjoint and ordinary doors never receive the garage package price',()=>{
 const doors=measured(after).filter(i=>i.pdfEvidence?.metricKey==='door_count');
 assert.equal(doors.length,2);assert.equal(doors.reduce((n,i)=>n+i.quantity,0),19);
 const garage=doors.find(i=>i.defaultSpecification.openingKind==='garage_door'),ordinary=doors.find(i=>i.defaultSpecification.openingKind==='door');
 assert.equal(garage.quantity,1);assert.equal(garage.rate,5675);assert.equal(ordinary.quantity,18);assert.equal(ordinary.rate,1260);
 assert.ok(garage.pdfEvidence.sourceAllocation.tags.includes('GD02'));assert.equal(ordinary.pdfEvidence.sourceAllocation.tags.length,18);
});
test('every amount reconciles, the subtotal comes from generated rows, and assumptions survive export',()=>{
 for(const row of measured(after))assert.ok(Math.abs(row.amount-row.quantity*row.rate)<=.011);
 const sum=Math.round(measured(after).reduce((n,i)=>n+i.amount,0)*100)/100;assert.equal(sum,494205.81);
 const out=buildBoqExport(after.boq.items,{vatPercentage:5});assert.equal(out.sums.verified,0);assert.equal(out.sums.pending,0);assert.equal(out.sums.provisional.toFixed(2),'494205.81');
 assert.match(JSON.stringify(out),/PRICING ASSUMPTION/);
 assert.ok(measured(after).every(i=>!/has no own rate|Not included in tender or priced budget/.test(i.notes||'')));
});
test('the same database policies work with different quantities in independent projects across units and trades',()=>{
 for(const [key,q,u] of [['foundation_volume',9.75,'m3'],['ceiling_paint_area',94,'m2'],['wood_floor_area',22.5,'m2'],['kitchen_cabinet_length',8.3,'m'],['kitchen_sink_count',2,'nr'],['ac_count',4,'nr'],['landscape_area',45,'m2']]){
  const {t,row}=single(key,q,u),r=applyPdfDefaultSpecifications([row],t,prices)[0];assert.equal(r.quantity,q);assert.ok(r.rate>0,key);assert.ok(r.notes.includes('NOT A DRAWING SPECIFICATION'));
 }
});
test('defaults are not regular commercial variants and cannot suppress a documented existing concrete grade',()=>{
 const {t,row}=single('foundation_volume',9,'m3','Foundations C30 reinforced concrete');
 const plan=planPdfCatalogRules(t,[],prices);assert.ok(plan.bindings.has('CON-003'));
 assert.ok(![...plan.bindings.keys()].some(k=>k==='VNT-DEF-FOUNDATION'));
 assert.deepEqual(applyPdfDefaultSpecifications([row],t,prices),[row]);
});
test('explicit block thickness picks the matching variant; missing thickness uses only the registered default',()=>{
 for(const [text,rate,thickness] of [['Internal walls 120 mm',53.2,120],['Internal walls 150 mm',58,150],['Internal walls 200 mm',66,200],['',50,100]]){
  const {t,row}=single('internal_block_area',26,'m2',text),r=applyPdfDefaultSpecifications([row],t,prices)[0];assert.equal(r.rate,rate);assert.equal(r.defaultSpecification.policy.specification.thickness_mm,thickness);
 }
});
test('explicit incompatible systems, capacity and materials are not overwritten to force a priced total',()=>{
 for(const [key,u,text] of [['foundation_volume','m3','Foundations C40 reinforced concrete'],['internal_block_area','m2','Internal concrete walls 175 mm'],['internal_block_area','m2','Internal AAC blockwork 120 mm'],['wood_floor_area','m2','Solid wood flooring'],['terrace_floor_area','m2','Terrace porcelain tiles'],['roof_waterproofing_area','m2','Roof waterproofing polyurethane membrane'],['kitchen_cabinet_length','m','Kitchen cabinets MDF'],['ac_count','nr','VRF AC units 3 ton']]){
  const {t,row}=single(key,4,u,text);assert.ok(readPdfSourceSpecifications(t).length,text);assert.deepEqual(applyPdfDefaultSpecifications([row],t,prices),[row],text);
 }
});
test('zero/missing measurements and fractional fixture counts cannot turn a default rate into invented scope',()=>{
 for(const [key,q,u] of [['kitchen_sink_count',0,'nr'],['kitchen_sink_count',1.5,'nr'],['foundation_volume',0,'m3']]){const {t,row}=single(key,q,u);assert.deepEqual(applyPdfDefaultSpecifications([row],t,prices),[row]);}
 const {t,row}=single('ceiling_paint_area',94,'m2');delete t.pdf_analysis.quantity_evidence.ceiling_paint_area;assert.deepEqual(applyPdfDefaultSpecifications([row],t,prices),[row]);
});
test('editing the specification keeps it editable and does not resurrect its old default price',()=>{
 const {t,row}=single('wood_floor_area',30,'m2'),r=applyPdfDefaultSpecifications([row],t,prices)[0];
 const edited=editPdfBoqItem(r,'description','Solid timber floor — custom project selection');assert.equal(edited.rate,0);assert.deepEqual(applyPdfDefaultSpecifications([edited],t,prices),[edited]);
 const rated=editPdfBoqItem(edited,'rate',290);assert.equal(rated.amount,8700);assert.equal(rated.defaultSpecification.status,'specification_edited');
 const cleared=editPdfBoqItem(r,'rate',0);assert.deepEqual(applyPdfDefaultSpecifications([cleared],t,prices),[cleared]);
});
test('price policies are reusable data and never contain a project ID, target total or expected quantity',()=>{
 for(const item of changes){const p=JSON.parse(item.source_reference);for(const k of ['project_id','expected_quantity','expected_total','target_total'])assert.equal(Object.hasOwn(p,k),false);}
 const all=changes.map(i=>i.item_code);assert.equal(new Set(all).size,all.length);
});
