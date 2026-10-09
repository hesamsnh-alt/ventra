import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDwgReads,applyDwgScheduleToBoq} from '../src/lib/dwgSchedule.mjs';
import {classifyEstimateItem} from '../src/lib/estimateClassification.mjs';
const row=(mark,quantity,material='Aluminium')=>({mark,quantity,quantityText:String(quantity),material,dimensions:'900 x 1200 mm',description:'Casement',quote:`${mark} QTY ${quantity}`,confidence:.98});
const table=(rows,kind='window',extra={})=>({kind,scope:'Whole project',quantityHeader:'QTY',complete:true,coversProject:true,rows,...extra});
const read=table=>({tables:[table],specifications:[]});
const reconcile=t=>reconcileDwgReads(read(t),read(structuredClone(t)));
const old=[{description:'Aluminium window',unit:'m2',quantity:26,rate:400,amount:10400}];
test('varied schedule totals replace geometric count with typed, count-unit rows',()=>{
 for(const quantities of [[3,5],[21,2,4],[1]]){
  const t=table(quantities.map((q,i)=>row(`W${i+1}`,q))),ev=reconcile(t);
  const out=applyDwgScheduleToBoq(old,ev,[{item_code:'WIN',description:'Aluminium window',unit:'nos',resolvedRate:700}]);
  assert.equal(ev.tables[0].total,quantities.reduce((a,b)=>a+b,0));
  assert.equal(out.items.length,quantities.length);
  assert.equal(out.items.reduce((n,i)=>n+i.quantity,0),ev.tables[0].total);
  assert.ok(out.items.every(i=>i.unit==='nos'&&i.amount===i.quantity*700&&classifyEstimateItem(i)==='provisional'));
  assert.equal(old[0].quantity,26);
 }
});
test('dimensions, unreadable cells, disagreement, partial scopes and duplicate marks never override',()=>{
 const t=table([row('W1',5)]);
 for(const change of [x=>x.rows[0].quantityText='900x1200',x=>x.rows[0].quantity=null,x=>x.complete=false,x=>x.coversProject=false,x=>x.rows.push({...x.rows[0]}),x=>x.quantityHeader='COST']){
  const changed=structuredClone(t);change(changed);
  const ev=reconcileDwgReads(read(t),read(changed));
  assert.equal(ev.tables[0].accepted,false);
  assert.deepEqual(applyDwgScheduleToBoq(old,ev).items,old);
 }
 const changed=structuredClone(t);changed.rows[0]=row('W1',7);
 assert.equal(reconcileDwgReads(read(t),read(changed)).tables[0].accepted,false);
});
test('repeat/revision whole-project schedules do not double count',()=>{
 const t=table([row('D1',2)],'door'),r={tables:[t,{...t,scope:'Revision B'}]};
 assert.ok(reconcileDwgReads(r,r).tables.every(t=>!t.accepted));
});
test('area rates and wrong material rates cannot price counted openings; hardware retained',()=>{
 const ev=reconcile(table([row('W1',4)]));
 const out=applyDwgScheduleToBoq([...old,{description:'Window ironmongery',unit:'nos',quantity:4,rate:10}],ev,[
  {description:'Aluminium window',unit:'m2',resolvedRate:400},
  {description:'Timber window',unit:'nos',resolvedRate:500}]);
 const opening=out.items.find(i=>i.quantityBasis==='drawing_schedule_two_reads');
 assert.equal(opening.quantity,4);assert.equal(opening.rate,0);assert.equal(classifyEstimateItem(opening),'pending');
 assert.ok(out.items.some(i=>i.description==='Window ironmongery'));
});
test('description disagreement preserves accepted count while withholding rate',()=>{
 const t=table([row('W1',4)]),second=structuredClone(t);second.rows[0].material='Timber';
 const ev=reconcileDwgReads(read(t),read(second));
 assert.equal(ev.tables[0].accepted,true);assert.equal(ev.tables[0].rows[0].specificationAccepted,false);
 assert.equal(applyDwgScheduleToBoq(old,ev,[{description:'Aluminium window',unit:'nos',resolvedRate:100}]).items[0].rate,0);
});
const spec=(scope,location,material)=>({scope,location,material,quote:`${location}: ${material}`,confidence:.99});
test('explicit framing invalidates masonry assumption without inferring timber or inventing area',()=>{
 const r={tables:[],specifications:[spec('wall','Exterior','Framing 50x150 mm'),spec('wall','Interior','Framing 50x100 mm')]};
 const out=applyDwgScheduleToBoq([{description:'Concrete blockwork wall',quantity:80,rate:100,amount:8000}],reconcileDwgReads(r,r));
 assert.match(out.items[0].description,/Wall framing/);assert.equal(out.items[0].quantity,0);assert.equal(out.items[0].amount,0);
 assert.equal(out.items[0].section,'General');assert.equal(classifyEstimateItem(out.items[0]),'pending');
});
test('mixed floor finishes require room-specific areas, not whole-floor duplication',()=>{
 const r={tables:[],specifications:[spec('floor','Living','Hardwood'),spec('floor','Kitchen','Ceramic tile')]};
 const out=applyDwgScheduleToBoq([{description:'Ceramic floor tiles',unit:'m2',quantity:120,rate:50,amount:6000}],reconcileDwgReads(r,r));
 assert.equal(out.items.length,2);assert.ok(out.items.every(i=>i.quantity===0&&i.amount===0));
 assert.match(out.items[0].description,/Living/);assert.match(out.items[1].description,/Kitchen/);
});
test('missing evidence preserves rows; explicit NO. count header supported',()=>{
 assert.deepEqual(applyDwgScheduleToBoq(old,{}).items,old);
 assert.equal(reconcile(table([row('W1',3)],'window',{quantityHeader:'NO.'})).tables[0].total,3);
});
test('a single conflicting room finish also invalidates blanket floor assumption',()=>{
 const r={tables:[],specifications:[spec('floor','Living','Hardwood')]};
 const out=applyDwgScheduleToBoq([{description:'Ceramic floor tiles',quantity:100,rate:60}],reconcileDwgReads(r,r));
 assert.equal(out.items.length,1);assert.match(out.items[0].description,/Hardwood/);assert.equal(out.items[0].quantity,0);
});
test('explicit metal roof replaces incompatible covering but retains structure and waterproofing',()=>{
 const r={tables:[],specifications:[spec('roof','Main roof','Standing seam metal roof')]};
 const out=applyDwgScheduleToBoq([{description:'Clay roof tiles',amount:1000},{description:'Roof waterproofing',amount:300},{description:'Concrete roof slab',amount:2000}],reconcileDwgReads(r,r));
 assert.ok(!out.items.some(i=>i.description==='Clay roof tiles'));
 assert.ok(out.items.some(i=>i.description==='Roof waterproofing'));
 assert.ok(out.items.some(i=>i.description==='Concrete roof slab'));
 const roof=out.items.find(i=>i.id==='dwg-roof-covering');assert.equal(roof.quantity,0);assert.equal(classifyEstimateItem(roof),'pending');
});
test('unfamiliar explicit floor finishes remain visible with quantity pending',()=>{
 const r={tables:[],specifications:[spec('floor','Bedroom','Carpet'),spec('floor','Kitchen','Ceramic tile')]};
 const out=applyDwgScheduleToBoq([{description:'Ceramic floor tiles',quantity:100,rate:60}],reconcileDwgReads(r,r));
 assert.equal(out.items.length,2);assert.ok(out.items.some(i=>/Carpet/.test(i.description)));assert.ok(out.items.every(i=>i.quantity===0));
});
