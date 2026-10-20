import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {nativePdfSupplementaryScope} from '../src/lib/pdfNativeSupplementaryScope.mjs';
import {calculatePdfMeasurement} from '../src/lib/pdfMeasurementCalculations.mjs';
import {mergePdfEvidence,PDF_METRIC_UNITS} from '../src/lib/pdfTakeoffEvidence.mjs';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
const pdf=await PDFDocument.load(readFileSync('tests/fixtures/pdf-native-opening-input.pdf'));
const saved=JSON.parse(readFileSync('tests/fixtures/pdf-observed-native-recovery.json','utf8'));
const original=saved.page_results.map(p=>{const text=extractNativePdfText(pdf,p.pageNumber-1,{allowRotated:true});return{...structuredClone(p),native_text_evidence:text,...(p.page_evidence?.kind==='floor_plan'?{native_plan_text:text,native_graphics:extractNativePdfGraphics(pdf,p.pageNumber-1)}:{})};});
const quantities=pages=>Object.fromEntries(nativePdfSupplementaryScope(pages).calculations.map(c=>{const q=calculatePdfMeasurement(c,PDF_METRIC_UNITS,new Set(pages.map(p=>p.pageNumber)));return[q.key,q.value];}));
test('original source independently recovers excluded roof, separate terrace and railing, with distinct fixtures',()=>{
 const q=quantities(original);assert.equal(q.roof_waterproofing_area,180);assert.equal(q.terrace_waterproofing_area,12);assert.equal(q.terrace_railing_length,7);assert.equal(q.basin_count,3);assert.equal(q.toilet_count,3);assert.equal(q.shower_count,3);assert.equal(q.kitchen_sink_count,1);assert.equal(q.laundry_sink_count,1);
});
const page=(number,text,kind)=>{const native={status:'readable',spans:[{text,x:0,y:0}]};return{pageNumber:number,native_text_evidence:native,native_plan_text:native,...(kind?{page_evidence:{kind}}:{})};};
const changed=()=>[page(1,'20 x 14 envelope','floor_plan'),page(2,'Roof slab: .25; omit 2 x 5 terrace. All dimensions in metres'),page(3,'WATERPROOFING: roof excludes open terrace; terrace is a separate line. Terrace railing west edge3.5 m + north edge6.2 m, height1.20 m. Sanitary fixtures: one toilet pan, one basin and one shower in each of R21 and R22. Separate kitchen sink in K18 and laundry sink in U42.')];
test('independent dimensions, decimal railing lengths and different room identifiers change calculated outputs',()=>{
 const q=quantities(changed());assert.equal(q.roof_waterproofing_area,270);assert.equal(q.terrace_waterproofing_area,10);assert.equal(q.terrace_railing_length,9.7);assert.equal(q.basin_count,2);
});
test('unknown units, absent scope and conflicting footprints never fabricate a waterproofing quantity',()=>{
 const cases=[changed().filter(p=>p.pageNumber!==3),changed().map(p=>page(p.pageNumber,p.native_text_evidence.spans[0].text.replace('metres','feet'),p.page_evidence?.kind)),[...changed(),page(4,'21 x 14 envelope','floor_plan')]];
 for(const pages of cases)assert.equal(quantities(pages).roof_waterproofing_area,undefined);
});
test('repeated room names or railing segments are withheld rather than counted twice',()=>{
 const p=changed();p[2].native_text_evidence.spans[0].text=p[2].native_text_evidence.spans[0].text.replace('R21 and R22','R21 and R21').replace('north edge6.2','west edge6.2');const q=quantities(p);assert.equal(q.basin_count,undefined);assert.equal(q.terrace_railing_length,undefined);
});
test('complete native project totals replace stale AI project and floor claims and are idempotent',()=>{
 const pages=structuredClone(original),host=pages.find(p=>p.document_measurement_review);assert.ok(host);
 host.document_measurement_review.calculations.push({key:'basin_count',scope_id:'project',evidence:'stale AI five basins',terms:[{id:'stale-basins',operation:'add',factors:[{value:5,unit:'count',operation:'multiply',pages:[7],evidence:'stale model aggregate',clip:null}]}]});
 pages[0].page_evidence.quantities.push({key:'basin_count',scope_id:'project',value:5,unit:'nr',evidence:'stale five basins'});
 const a=mergePdfEvidence(pages,[],8);assert.equal(a.scheduled_quantities.basin_count,3);assert.equal(a.scheduled_quantities.roof_waterproofing_area,180);assert.equal(a.scheduled_quantities.terrace_railing_length,7);
 const b=mergePdfEvidence(a.page_results,[],8);for(const key of Object.keys(quantities(original)))assert.equal(a.scheduled_quantities[key],b.scheduled_quantities[key],key);
});
test('existing database default policies price the recovered scopes once without inventing supplier approval',async()=>{
 const defaultRow=(item_code,key,unit,rate,specification)=>({item_code,description:item_code,unit,currency:'AED',is_active:true,standard_rate:rate,total_rate:rate,source_reference:JSON.stringify({kind:'pricing_default',fallback_only:true,enabled:true,metric:key,specification,label:item_code,rate_basis:'Existing editable catalog budget, not a supplier quote'})});
 const catalog=[defaultRow('roof','roof_waterproofing_area','m2',46,{waterproofing_system:'torch_bitumen'}),defaultRow('terrace','terrace_waterproofing_area','m2',46,{waterproofing_system:'torch_bitumen'}),defaultRow('railing','terrace_railing_length','m',500,{railing_system:'ss316_glass_infill'})];
 const result=await runOfflinePdfCatalog(mergePdfEvidence(original,[],8),catalog);
 for(const[key,q,rate,amount]of[['roof_waterproofing_area',180,46,8280],['terrace_waterproofing_area',12,46,552],['terrace_railing_length',7,500,3500]]){const rows=result.boq.items.filter(i=>i.quantity>0&&i.pdfEvidence?.metricKey===key);assert.equal(rows.length,1);assert.equal(rows[0].quantity,q);assert.equal(rows[0].rate,rate);assert.equal(rows[0].amount,amount);assert.equal(rows[0].includeInCommercialTotal,false);}
 assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);
});
