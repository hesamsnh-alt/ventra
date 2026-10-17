import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pdfRuleMetric,pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
import {planPdfCatalogBindings,retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
import {parseCsv,rateCatalogFromCsv,runOfflinePdfCatalogCheck,compareExpectedRows} from '../tools/check-pdf-rate-catalog.mjs';
const observed=JSON.parse(readFileSync(new URL('./fixtures/pdf-observed-catalog-recovery.json',import.meta.url),'utf8'));
const rateCsv=readFileSync(new URL('./fixtures/pdf-villa02-test-rates.csv',import.meta.url),'utf8');
const price=(code,description,unit)=>({item_code:code,description,unit,is_active:true});

test('actual 52-row supplied rate CSV connects 48 explicit operations without reading the answer key',async()=>{
  const input=structuredClone(observed),prices=rateCatalogFromCsv(rateCsv),plan=planPdfCatalogBindings(observed,prices);
  assert.equal(prices.length,52);assert.equal(plan.bindings.size,48);
  assert.deepEqual(prices.filter(p=>!plan.bindings.has(p.item_code)).map(p=>p.item_code),['DOR-01','DOR-02','DOR-03','DOR-04']);
  const result=await runOfflinePdfCatalogCheck(observed,rateCsv);
  assert.equal(result.modelCalls,0);assert.equal(result.databaseWrites,0);assert.equal(result.productionCatalogChanged,false);
  assert.equal(result.boq.summary.provisionalItems,48);assert.equal(result.boq.summary.pendingItems,1);
  assert.equal(result.boq.summary.provisionalSubtotal,492535.51);assert.equal(result.boq.summary.verifiedSubtotal,0);
  assert.deepEqual(observed,input);assert.ok(result.boq.items.every(i=>!i.includeInCommercialTotal));
  const sinks=result.boq.items.find(i=>i.itemCode==='PLB-04');assert.equal(sinks.quantity,2);assert.deepEqual(sinks.pdfEvidence.metricKeys,['kitchen_sink_count','laundry_sink_count']);
  assert.ok(!result.boq.items.some(i=>/^PDF-(KITCHEN|LAUNDRY)_SINK_COUNT$/.test(i.itemCode)));
});
test('matching uses equivalent scope words rather than benchmark codes, rates, counts or quantities',()=>{
  const variants=[['Column side formwork','Formwork to columns','m2','column_formwork_area'],
    ['Beam downstand side formwork','Formwork to beam sides','m2','beam_formwork_area'],
    ['Footing and pedestal side formwork','Formwork to footing and pedestal sides','m2','foundation_formwork_area'],
    ['Wet-room wall tiles','Wet room wall tiles','m2','wet_wall_tile_area'],
    ['Wet-room floor waterproofing','Wet area floor waterproofing','m2','wet_floor_waterproofing_area']];
  for(const [a,b,u,key] of variants){assert.equal(pdfRuleMetric(a,u)?.key,key);assert.equal(pdfRuleMetric(b,u)?.key,key);}
  const modified=structuredClone(observed);
  modified.scheduled_quantities.column_volume=7.25;modified.pdf_analysis.quantity_evidence.column_volume=[{key:'column_volume',value:7.25,unit:'m3',pages:[2],evidence:'Different source project, column calculation'}];
  const plan=planPdfCatalogBindings(modified,[price('UNRELATED-CODE','RC columns, net clear length','m3')]);assert.equal(plan.bindings.get('UNRELATED-CODE').quantity,7.25);
});
test('beam soffit-only and combined unrelated formwork packages cannot consume side-only or single-member quantities',()=>{
  for(const d of ['Beam soffit formwork','Formwork to beam undersides','Column and beam formwork','Slab and column formwork','Formwork to columns and slabs','Formwork to beam sides and slabs'])assert.equal(pdfRuleMetric(d,'m2'),null,d);
  assert.equal(pdfRuleMetric('Slab and beam soffit formwork','m2').key,'slab_formwork_area');
  assert.equal(pdfRuleMetric('Beam downstand side formwork','m3'),null);
});
test('new generic descriptions never select unknown grades, pipe diameters, AC capacities or opening materials',()=>{
  for(const [d,u] of [['RC columns C30','m3'],['RC first-floor slab grade C25','m3'],['RC isolated footings and pedestals','m3'],
    ['Water supply pipes 20mm','m'],['Waste pipes UPVC','m'],['Split AC units 2 ton','nr'],['AC insulated pipework 16mm','m'],
    ['Internal timber door sets 900 x 2100','nr'],['Main entrance door set 1200 x 2200','nr'],
    ['Excavate swimming pool','m3'],['Terrace ceramic wall tiles','m2']])assert.equal(pdfScheduledRule(observed,d,u),null,d);
});
test('catalog thickness and wet-wall finish heights are checked against source operands, not copied into the measurement',()=>{
  assert.equal(pdfScheduledRule(observed,'RC ground slab, 150 mm','m3').quantity,observed.ground_slab_volume);
  assert.equal(pdfScheduledRule(observed,'RC ground slab, 200 mm','m3'),null);
  assert.equal(pdfScheduledRule(observed,'Wet-room wall tiles, 2.40 m high','m2').quantity,observed.wet_wall_tile_area);
  assert.equal(pdfScheduledRule(observed,'Wet-room wall tiles, 3.00 m high','m2'),null);
  assert.equal(pdfScheduledRule(observed,'Wet-room wall waterproofing to 2.0 m','m2').quantity,observed.wet_wall_waterproofing_area);
  assert.equal(pdfScheduledRule(observed,'Wet-room wall waterproofing to 2.4 m','m2'),null);
  const noOperands=structuredClone(observed);noOperands.pdf_analysis.quantity_evidence.ground_slab_volume[0].evidence='Summary volume only';
  assert.equal(pdfScheduledRule(noOperands,'RC ground slab, 150 mm','m3'),null);
});
test('combined sink scope requires both source claims and cannot be repeated in separate catalog rows or retained quantities',()=>{
  const combined=price('PAIR','Kitchen and laundry sink sets','nr'),kitchen=price('K','Kitchen sink sets','nr');
  const binding=planPdfCatalogBindings(observed,[combined]);assert.equal(binding.bindings.get('PAIR').quantity,2);
  const row={quantity:2,pdfEvidence:{metricKey:'kitchen_sink_count+laundry_sink_count',metricKeys:['kitchen_sink_count','laundry_sink_count']}};
  const retained=retainUnboundPdfQuantities([row],observed).items;
  assert.ok(!retained.some(i=>['kitchen_sink_count','laundry_sink_count'].includes(i.pdfEvidence?.metricKey)));
  assert.equal(planPdfCatalogBindings(observed,[combined,kitchen]).bindings.size,0);
  const partial=structuredClone(observed);delete partial.pdf_analysis.quantity_evidence.laundry_sink_count;
  assert.equal(pdfScheduledRule(partial,combined.description,combined.unit),null);
});
test('CSV parsing handles quoted commas/newlines, BOM and escaped quotes and rejects malformed or contradictory rates',()=>{
  assert.deepEqual(parseCsv('\uFEFFcode,description_en\r\nA,"First, second\nthird ""quoted"""\r\n'),[{code:'A',description_en:'First, second\nthird "quoted"'}]);
  for(const text of ['code,code\nA,B','code,description_en\nA,"unfinished','code,description_en\nA,"finished"x','a,b\n1,2,3'])assert.throws(()=>parseCsv(text));
  const header='code,description_en,unit,rate_aed\n';
  for(const rows of ['A,Test,m,NaN','A,Test,m,-10','A,Test,m,0x20','A,Test,m,1\na,Test,m,1','A,Test,m,'])assert.throws(()=>rateCatalogFromCsv(header+rows));
  assert.equal(rateCatalogFromCsv(header+'A,Test,m,0')[0].standard_rate,0);
});
test('answer-key comparison cannot alter an already generated quantity/rate and reports partial rows honestly',()=>{
  const result={boq:{items:[{itemCode:'A',quantity:10.3545,unit:'m3',rate:400,amount:4141.8}]}};
  const before=structuredClone(result),check=compareExpectedRows(result,'code,description_en,unit,quantity,rate_aed,amount_aed\nA,Column,m3,10.355,400,4142.00\nB,Missing,nr,2,5,10\n');
  assert.equal(check.matchedQuantityRows,1);assert.equal(check.differenceRows,1);assert.equal(check.unboundRows,1);assert.deepEqual(result,before);
});
