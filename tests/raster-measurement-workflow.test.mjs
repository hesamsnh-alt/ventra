import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileRasterMeasurements} from '../src/lib/rasterMeasurementAudit.mjs';
import {buildRasterBoq} from '../src/lib/rasterBoqEvidence.mjs';
import {applyBoqScope,scopeMetric} from '../src/lib/boqScope.mjs';
import {applyBoqCatalogSelection} from '../src/lib/boqPriceSelection.mjs';
import {editPdfBoqItem} from '../src/lib/boqPriceSelection.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
import {calculateProjectEstimate} from '../src/lib/projectEstimate.mjs';
import {quotationTotals} from '../src/lib/commercialDocument.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/raster-split-openings-20261106.json',import.meta.url)));
const run=(t=structuredClone(fixture.takeoff),prices=fixture.catalog)=>buildRasterBoq({takeoff:t,prices,projectId:t.project_id});
const metric=(b,k)=>b.items.filter(i=>i.imageEvidence?.metricKey===k);
test('actual submitted analysis retains 2 internal + 1 entrance doors and all measured, unallocated surfaces',()=>{
  const t=structuredClone(fixture.takeoff),before=structuredClone(t),b=run(t);
  assert.equal(b.takeoff.floor_area,46.5225);assert.equal(b.takeoff.ceiling_area,46.5225);assert.equal(b.takeoff.wall_area,141.3);
  assert.equal(b.measurementAudit.netInternalWall.value,126.81);assert.equal(b.items.length,6);
  for(const [key,count] of [['internal_door_count',2],['entrance_door_count',1]]){
    assert.equal(metric(b,key)[0].quantity,count);assert.equal(metric(b,key)[0].rate,1260);
    assert.equal(metric(b,key)[0].specificationVerification,'assumed');
  }
  assert.equal(metric(b,'door_count').length,0,'Do not bill the total on top of its breakdown');
  for(const [key,value] of [['unallocated_floor_finish_area',46.5225],['unallocated_ceiling_finish_area',46.5225],['unallocated_wall_finish_area',126.81]]){
    const row=metric(b,key)[0];assert.equal(row.quantity,value);assert.equal(row.rateMissing,true);assert.equal(row.status,'measured_rate_pending');
  }
  assert.equal(b.summary.unpricedMeasuredItems,3);assert.equal(b.summary.grandTotal,7938);
  assert.deepEqual(t,before,'Original extraction, opening data and 3D geometry preserved');
  assert.ok(b.measurementAudit.corrections.some(c=>c.key==='floor_area'&&c.reported===46.5125));
  assert.equal(reconcileRasterMeasurements(b.takeoff),b.takeoff,'Reopening cannot deduct openings twice');
  assert.equal(buildBoqExport(b.items).sums.verified,0);
  assert.equal(calculateProjectEstimate({items:b.items,basis:'boq',includeProvisional:true,vatPct:5}).finalTender,7938);
  assert.equal(quotationTotals(b.items,5).total,7938);
  assert.match(buildBoqExport(b.items,{}, {sourceDocumentName:t.document_name}).note,/split-opening-plan.png/);
});
test('unrelated external-wall/steel notes cannot block ordinary internal-door budgeting',()=>{
  const t=structuredClone(fixture.takeoff);t.notes+=' The external walls have steel reinforcement.';
  assert.equal(metric(run(t),'internal_door_count')[0].rate,1260);
});
test('known steel window material cannot inherit the aluminium catalog rate',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.find(q=>q.key==='window_area').evidence+=' Steel framed windows.';
  assert.equal(metric(run(t),'window_area')[0].rate,0);
});
for(const key of ['internal_door_count','entrance_door_count'])test(`special ${key} requirements retain count without a timber price`,()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.find(q=>q.key===key).evidence+=' Fire-rated steel doors.';
  const rows=run(t).items.filter(i=>/door_count$/.test(i.imageEvidence?.metricKey||''));
  assert.equal(rows.reduce((s,i)=>s+i.quantity,0),3);assert.ok(rows.every(i=>i.rate===0));
});
test('a breakdown exceeding the opening total is withheld rather than priced as four doors',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.find(q=>q.key==='internal_door_count').value=3;
  const b=run(t),row=metric(b,'door_count')[0];assert.equal(row.quantity,0);assert.equal(row.status,'quantity_pending');
  assert.equal(b.items.filter(i=>/door_count$/.test(i.imageEvidence?.metricKey||'')).reduce((s,i)=>s+i.amount,0),0);
});
test('mixed opening sizes cannot supply an invented extra-face deduction',()=>{
  const t=structuredClone(fixture.takeoff);t.detected_items.find(i=>i.name==='D0 Door').quantity=2;
  assert.equal(reconcileRasterMeasurements(t).raster_measurement_audit.netInternalWall,undefined);
});
test('floor finish exceeding checked available floor is withheld, with remaining surface shown explicitly',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.push({key:'ceramic_floor_area',value:90,unit:'m2',scope_id:'ground floor',evidence:'Reported ceramic floor'});
  const b=run(t);assert.equal(metric(b,'ceramic_floor_area')[0].quantity,0);assert.equal(metric(b,'ceramic_floor_area')[0].rate,0);
  assert.equal(metric(b,'unallocated_floor_finish_area')[0].quantity,46.5225);
});
test('ceiling board and ceiling paint are layers, not two disjoint rooms',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.push(...['ceiling_paint_area','gypsum_ceiling_area'].map(key=>({key,value:46.5225,unit:'m2',scope_id:'ground floor',evidence:'Whole enclosed ceiling'})));
  assert.equal(metric(run(t),'unallocated_ceiling_finish_area').length,0);
});
test('scope defaults replace unresolved surfaces and use checked net wall faces without duplicate charges',()=>{
  const b=run(),c={enabled:true,defaultsEnabled:true,trades:['finishes','openings'],wallFinish:'paint',ceilingFinish:'paint',screedEnabled:false};
  const scoped=applyBoqScope(b.items,b.takeoff,c);
  assert.equal(scoped.items.filter(i=>i.measurementPlaceholder).length,0);
  assert.equal(scoped.items.find(i=>scopeMetric(i)==='paint_area').quantity,126.81);
  assert.equal(scoped.items.find(i=>scopeMetric(i)==='ceramic_floor_area').quantity,46.5225);
});
test('compatible catalog selection fills a surface rate once; scope defaults cannot repeat that floor',()=>{
  const b=run(),floor=metric(b,'unallocated_floor_finish_area')[0];
  const selected=applyBoqCatalogSelection(floor,{itemCode:'OWN-CERAMIC',description:'Ceramic floor tiling',unit:'m2',rate:80,rateSource:'supplier',section:'Finishes'});
  assert.equal(selected.quantity,46.5225);assert.equal(selected.amount,3721.8);
  const scoped=applyBoqScope(b.items.map(i=>i===floor?selected:i),b.takeoff,{enabled:true,trades:['finishes'],defaultsEnabled:true,screedEnabled:false});
  assert.equal(scoped.items.filter(i=>scopeMetric(i)==='ceramic_floor_area').length,1);
  assert.throws(()=>applyBoqCatalogSelection(floor,{description:'Internal wall emulsion paint',unit:'m2',rate:20}),/compatible floor finish/);
});
test('manual project rates on measured placeholders are not duplicated by later scope defaults',()=>{
  const b=run(),items=b.items.map(i=>i.measurementPlaceholder?editPdfBoqItem(i,'rate',30):i);
  const scoped=applyBoqScope(items,b.takeoff,{enabled:true,trades:['finishes','openings'],defaultsEnabled:true,screedEnabled:false});
  assert.equal(scoped.items.filter(i=>i.measurementPlaceholder).length,3);
  assert.ok(!scoped.items.some(i=>i.scopeDefault));
});
test('known internal doors survive even when a total opening count is unavailable',()=>{
  const t=structuredClone(fixture.takeoff);t.doors=null;
  t.page_evidence.quantities=t.page_evidence.quantities.filter(q=>!['door_count','entrance_door_count','door_area'].includes(q.key));
  const b=run(t);assert.equal(metric(b,'internal_door_count')[0].quantity,2);assert.equal(metric(b,'internal_door_count')[0].rate,1260);
  assert.equal(metric(b,'door_count').length,0);assert.ok(b.warnings.some(w=>/inventory is unconfirmed/.test(w)));
});
test('an explicit zero count cannot price a contradictory positive window area',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities.find(q=>q.key==='window_count').value=0;
  const row=metric(run(t),'window_area')[0];assert.equal(row.quantity,0);assert.equal(row.rate,0);assert.equal(row.status,'quantity_pending');
});
test('an explicit zero door count cannot be rescued by a positive opening area',()=>{
  const t=structuredClone(fixture.takeoff);t.page_evidence.quantities=t.page_evidence.quantities.filter(q=>!['internal_door_count','entrance_door_count'].includes(q.key));
  t.page_evidence.quantities.find(q=>q.key==='door_count').value=0;
  assert.equal(metric(run(t),'door_count')[0].status,'quantity_pending');
});
for(const [name,mutate] of [
  ['overlap',t=>{t.area_geometry.spaces[1].polygon=t.area_geometry.spaces[0].polygon;}],
  ['duplicate room tag',t=>{t.area_geometry.spaces[1].tag=t.area_geometry.spaces[0].tag;}],
  ['missing wall footprint',t=>{t.area_geometry.spaces.pop();}],
  ['self intersection',t=>{t.area_geometry.spaces[0].polygon=[{x:0,y:0},{x:4,y:6},{x:0,y:6},{x:4,y:0}];}],
])test(`invalid ${name} does not silently correct a saved area or invent a finish`,()=>{
  const t=structuredClone(fixture.takeoff);mutate(t);const corrected=reconcileRasterMeasurements(t);
  assert.equal(corrected.floor_area,t.floor_area);assert.equal(corrected.raster_measurement_audit.status,'needs_review');
  assert.ok(!run(t).items.some(i=>i.measurementPlaceholder));
});
for(const extension of ['png','PNG','jpg','JPEG','webp'])test(`${extension} uses the same rules without a filename/project special case`,()=>{
  const t=structuredClone(fixture.takeoff);t.document_name='different-'+extension+'.'+extension;t.project_id='other-'+extension;
  const b=run(t);assert.equal(b.boqSource.name,t.document_name);assert.equal(b.takeoff.floor_area,46.5225);assert.equal(b.summary.grandTotal,7938);
});
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
for(let seed=1;seed<=30;seed++)test(`independent plan ${seed}: variable sizes, origins, room count and no opening assumptions`,()=>{
  const count=1+seed%4,w=2+(seed%7)*.35,h=2.5+(seed%5)*.6,x=-seed*3,y=seed*2;
  const spaces=Array.from({length:count},(_,i)=>({tag:'ROOM-'+i,kind:'enclosed',finish:'unknown',polygon:rect(x+i*w,y,w,h),reported_area:w*h,evidence:`Printed clear ${w} x ${h} m`}));
  const area=Math.round(count*w*h*1e6)/1e6;
  const t={document_name:'varied-'+seed+'.png',rooms:count,doors:0,windows:0,notes:'Room height = 2.80 m.',floor_area:area+.4,ceiling_area:area+.4,
    area_geometry:{basis:'clear_internal',coverage:'complete',envelope:rect(x,y,w*count,h),envelope_evidence:'Complete dimensioned room envelope',spaces},
    page_evidence:{kind:'floor_plan',scope_id:'floor',quantities:[{key:'door_count',value:0,unit:'nr',scope_id:'floor',evidence:'No doors in this isolated measured scope'},{key:'window_count',value:0,unit:'nr',scope_id:'floor',evidence:'No windows in this isolated measured scope'}]}};
  const b=run(t,[]);assert.equal(b.takeoff.floor_area,area);assert.equal(metric(b,'unallocated_floor_finish_area')[0].quantity,area);
  const gross=Math.round(count*2*(w+h)*2.8*1e6)/1e6;assert.equal(b.takeoff.wall_area,gross);
  assert.equal(metric(b,'unallocated_wall_finish_area')[0].quantity,gross);assert.equal(b.summary.subtotal,0);
  assert.ok(!b.items.some(i=>/concrete|hvac|cabinet/i.test(i.description)));
});
test('outdoor and void areas never enter enclosed ceiling or interior wall finish quantities',()=>{
  const t={document_name:'terrace-and-void.jpg',rooms:1,doors:0,windows:0,notes:'Room height = 3 m.',
    area_geometry:{basis:'clear_internal',coverage:'complete',envelope:rect(0,0,8,4),envelope_evidence:'Printed full envelope',spaces:[
      {tag:'ROOM',kind:'enclosed',finish:'unknown',polygon:rect(0,0,4,4),reported_area:16,evidence:'4 x 4'},
      {tag:'TERRACE',kind:'outdoor',finish:'outdoor',polygon:rect(4,0,2,4),reported_area:8,evidence:'2 x 4'},
      {tag:'VOID',kind:'void',finish:'unknown',polygon:rect(6,0,2,4),reported_area:8,evidence:'2 x 4'}]},
    page_evidence:{kind:'floor_plan',scope_id:'floor',quantities:[{key:'door_count',value:0,unit:'nr',evidence:'No openings'},{key:'window_count',value:0,unit:'nr',evidence:'No openings'}]}};
  const b=run(t,[]);assert.equal(b.takeoff.floor_area,24);assert.equal(b.takeoff.ceiling_area,16);assert.equal(b.takeoff.wall_area,48);
});
test('concave L-shaped clear geometry and rotated plans do not use a rectangular room template',()=>{
  const polygon=[{x:0,y:0},{x:5,y:0},{x:5,y:2},{x:3,y:2},{x:3,y:5},{x:0,y:5}];
  for(const angle of [0,.37,Math.PI/2]){
    const p=polygon.map(v=>({x:v.x*Math.cos(angle)-v.y*Math.sin(angle)+17,y:v.x*Math.sin(angle)+v.y*Math.cos(angle)-23}));
    const t={document_name:'concave.webp',rooms:1,doors:0,windows:0,notes:'Room height = 3 m.',floor_area:999,ceiling_area:999,
      area_geometry:{basis:'clear_internal',coverage:'complete',envelope:p,envelope_evidence:'Dimensioned L-shaped envelope',spaces:[{tag:'L-SHAPE',kind:'enclosed',finish:'unknown',polygon:p,reported_area:999,evidence:'Independent dimensioned L-shaped polygon'}]},
      page_evidence:{kind:'floor_plan',quantities:[{key:'door_count',value:0,unit:'nr',evidence:'No doors'},{key:'window_count',value:0,unit:'nr',evidence:'No windows'}]}};
    const b=run(t,[]);assert.equal(b.takeoff.floor_area,19);assert.equal(b.takeoff.wall_area,60);
  }
});
