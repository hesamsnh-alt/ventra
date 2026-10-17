import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePdfEvidence, pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
import {planPdfCatalogBindings, retainUnboundPdfQuantities} from '../src/lib/pdfBoqCoverage.mjs';
import {requireBoqReview} from '../src/lib/boqEvidence.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {readFileSync} from 'node:fs';

function takeoff(quantities) {
  return mergePdfEvidence([{pageNumber:3,detected_items:[],page_evidence:{kind:'quantity_schedule',scope_id:'project',revision:'R1',quantities:
    quantities.map(([key,value,unit])=>({key,value,unit,scope_id:'project',evidence:'Printed complete project schedule total'}))}}]);
}
test('excavation is not disposal or backfilling, lighting points are not luminaires',()=>{
  const t=takeoff([['excavation_volume',72.2,'m3'],['light_count',60,'nr']]);
  assert.equal(pdfScheduledRule(t,'Excavation in normal soil including loading','m³').quantity,72.2);
  for(const d of ['Disposal of excavated material outside site','Cart away excavated soil','Backfilling excavated pits'])assert.equal(pdfScheduledRule(t,d,'m3'),null);
  assert.equal(pdfScheduledRule(t,'Lighting point including wiring conduit and accessories','point').quantity,60);
  for(const d of ['LED downlight complete with driver and installation','Light fixture','Luminaire'])assert.equal(pdfScheduledRule(t,d,'nos'),null);
});
test('competing catalog variants withhold pricing, repeated rule codes do not create ambiguity',()=>{
  const t=takeoff([['window_area',39.06,'m2']]);
  const a={item_code:'WIN-A',description:'Aluminium glazed window',unit:'m2'},b={...a,item_code:'WIN-B',description:'Aluminium glazed window premium'};
  assert.equal(planPdfCatalogBindings(t,[a,a]).bindings.size,1);
  const plan=planPdfCatalogBindings(t,[a,b]);assert.equal(plan.bindings.size,0);assert.equal(plan.warnings.length,1);
  const r=retainUnboundPdfQuantities([],t);assert.equal(r.items.length,1);assert.equal(r.items[0].quantity,39.06);assert.equal(r.items[0].rate,0);
});
test('unmatched concrete, finishes and services retain quantities without assuming specifications',()=>{
  const t=takeoff([['foundation_volume',20.25,'m3'],['column_volume',10.355,'m3'],['wood_floor_area',178,'m2'],['water_pipe_length',80,'m'],['ac_count',9,'nr'],['light_count',60,'nr'],['floor_area',372,'m2']]);
  const result=retainUnboundPdfQuantities([],t);
  assert.equal(result.items.length,6);assert.ok(!result.items.some(i=>i.itemCode==='PDF-FLOOR_AREA'));
  assert.equal(result.items.find(i=>i.itemCode==='PDF-WATER_PIPE_LENGTH').quantity,80);
  for(const i of result.items){assert.equal(i.rate,0);assert.equal(i.amount,0);assert.equal(i.includeInCommercialTotal,false);assert.equal(i.status,'measured_rate_pending');assert.ok(i.notes.includes('pages 3'));}
  assert.deepEqual(retainUnboundPdfQuantities(result.items,t).items,result.items);
  const e=buildBoqExport(result.items.map(requireBoqReview),{vatPercentage:5});
  assert.equal(e.sums.verified,0);assert.equal(e.sums.provisional,0);assert.ok(e.rows.every(r=>r[7]==='Quantity recorded / rate and specification pending'));
});
test('end-to-end evidence to catalog rows to export: no quantity multiplication across operations',()=>{
  const t=takeoff([['excavation_volume',72.2,'m3'],['pcc_volume',5.78,'m3'],['rebar_kg',12168.138,'kg'],['window_area',39.06,'m2'],['light_count',60,'nr']]);
  const prices=[
    {item_code:'EAR-1',description:'Excavation in normal soil including loading',unit:'m3',rate:39},
    {item_code:'EAR-2',description:'Disposal of excavated material outside site',unit:'m3',rate:34},
    {item_code:'CON-1',description:'Plain cement concrete blinding',unit:'m3',rate:340},
    {item_code:'CON-2',description:'High yield reinforcement',unit:'ton',rate:3550},
    {item_code:'WIN-1',description:'Aluminium glazed window',unit:'m2',rate:750},
    {item_code:'EL-1',description:'LED downlight',unit:'nos',rate:95},
    {item_code:'EL-2',description:'Lighting point including wiring',unit:'point',rate:120},
  ];
  const plan=planPdfCatalogBindings(t,prices),rows=prices.map(p=>{
    const q=plan.bindings.get(p.item_code),quantity=q?.quantity||0;
    return {itemCode:p.item_code,description:p.description,unit:p.unit,quantity,rate:quantity?p.rate:0,amount:quantity*p.rate,
      status:quantity?'measured':'quantity_pending',verification:quantity?'verified':'pending',
      pdfEvidence:q?{metricKey:q.metricKey,pages:q.pages,basis:q.evidence}:null};
  });
  const result=retainUnboundPdfQuantities(rows,t).items.map(requireBoqReview);
  assert.equal(result.length,7);assert.equal(result[1].quantity,0);assert.equal(result[5].quantity,0);assert.equal(result[6].quantity,60);
  assert.ok(Math.abs(result[3].quantity-12.168138)<1e-9);
  const exportResult=buildBoqExport(result,{});
  assert.equal(exportResult.sums.verified,0);assert.ok(Math.abs(exportResult.sums.provisional-84472.8899)<.001);
});
test('conflicts, unsupported units and compact summaries never produce priced or unpriced quantities',()=>{
  const t=takeoff([['column_volume',10,'m3'],['column_volume',11,'m3'],['water_pipe_length',80,'m2']]);
  assert.equal(retainUnboundPdfQuantities([],t).items.length,0);
  const compact={pdf_analysis:{summaryOnly:true,quantity_evidence:{}},scheduled_quantities:{column_volume:10}};
  assert.equal(retainUnboundPdfQuantities([],compact).items.length,0);
});
test('tampered aggregate without matching evidence is not copied into an unpriced quantity',()=>{
  const t=takeoff([['foundation_volume',20,'m3']]);t.scheduled_quantities.foundation_volume=999;
  assert.equal(retainUnboundPdfQuantities([],t).items.length,0);
  const window=takeoff([['window_area',10,'m2']]);window.scheduled_quantities.window_area=100;
  assert.equal(pdfScheduledRule(window,'Aluminium glazed window','m2'),null);
});
test('distinct waterproofing and finish measurements remain distinct operations',()=>{
  const t=takeoff([['wet_floor_area',46,'m2'],['wet_floor_waterproofing_area',46,'m2'],['wet_wall_tile_area',117.24,'m2'],['wet_wall_waterproofing_area',97.92,'m2']]);
  const rows=retainUnboundPdfQuantities([],t).items;
  assert.equal(rows.length,3);assert.ok(rows.some(i=>i.quantity===117.24));assert.ok(rows.some(i=>i.quantity===97.92));
  assert.equal(retainUnboundPdfQuantities([],takeoff([['wet_floor_area',46,'m2']])).items.length,0);
});
test('server integration retains the PDF pricing boundary even with an empty database',()=>{
  const s=readFileSync('src/lib/serverBoqAnalysis.js','utf8');
  assert.ok(s.includes('takeoff.pdf_analysis ? {items:[],warnings:[]} : buildLocalBoq'));
  assert.ok(s.includes('pdfCatalogPlan?.bindings.get(pdfCode)'));
  assert.ok(s.includes('isQuantityPending ? "unavailable"'));
});
test('recorded quantities and unpriced scope descriptions export in Persian and Arabic',()=>{
  const t=takeoff([['light_count',60,'nr']]),rows=retainUnboundPdfQuantities([],t).items;
  for(const language of ['fa','ar']) {
    const out=buildBoqExport(rows,{}, {language});
    assert.notEqual(out.rows[0][2],rows[0].description);
    assert.notEqual(out.rows[0][7],'Quantity recorded / rate and specification pending');
    assert.equal(out.rows[0][4],60);assert.equal(out.rows[0][5],0);
  }
});
