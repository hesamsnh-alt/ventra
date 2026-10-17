import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {mergePdfEvidence,pdfScheduledRule,pdfRuleMetric} from '../src/lib/pdfTakeoffEvidence.mjs';
const claim=(key,value,scope_id='project',unit='m2')=>({key,value,scope_id,unit,evidence:'Printed schedule dimensions and quantity'});
const page=(pageNumber,kind,scope_id,values={},quantities=[])=>({pageNumber,confidence:80,rooms:0,doors:0,windows:0,floor_area:0,ceiling_area:0,wall_length:0,wall_area:0,window_area:0,door_area:0,detected_items:[],...values,page_evidence:{kind,scope_id,drawing_id:'test-'+pageNumber,revision:'R1',quantities}});
test('PDF merges only distinct architectural floors, not roof/structural/schedule page quantities',()=>{
 const p=[page(1,'floor_plan','ground',{floor_area:192,doors:11,windows:6}),page(2,'floor_plan','first',{floor_area:180,doors:8,windows:9}),page(3,'structural_plan','ground',{floor_area:192,doors:19}),page(4,'opening_schedule','project',{floor_area:348,windows:19}),page(5,'floor_plan','GF',{floor_area:192,doors:11,windows:6})];
 const r=mergePdfEvidence(p);assert.equal(r.floor_area,372);assert.equal(r.doors,19);assert.equal(r.windows,15);assert.equal(r.pdf_analysis.selected_floor_pages.length,2);assert.equal(r.pdf_analysis.excluded_pages.length,3);
});
test('schedule values reconcile matching scopes, including repeated schedules and project totals without double counting',()=>{
 const p=[page(1,'floor_plan','ground',{doors:20,windows:20}),page(2,'opening_schedule','ground',{},[claim('door_count',11,'GF','nr'),claim('window_area',16.74,'GF')]),page(3,'opening_schedule','first',{},[claim('door_count',8,'FF','nr'),claim('window_area',22.32,'FF')]),page(4,'opening_schedule','first',{},[claim('door_count',8,'first floor','nr'),claim('window_area',22.32,'first floor')])];
 const r=mergePdfEvidence(p);assert.equal(r.doors,19);assert.equal(r.window_area,39.06);
 const q=pdfScheduledRule(r,'Aluminium framed glazed window complete','m²');assert.equal(q.quantity,39.06);assert.deepEqual(q.pages,[2,3,4]);
 const whole=mergePdfEvidence([...p,page(5,'quantity_schedule','project',{},[claim('window_area',39.06)])]);assert.equal(whole.window_area,39.06);
});
test('missing dimensions never become window area, metric units are not interchangeable',()=>{
 const r=mergePdfEvidence([page(1,'floor_plan','ground',{windows:34})]);assert.equal(r.window_area,0);assert.equal(pdfScheduledRule(r,'Aluminium framed glazed window complete','m²'),null);
 const bad=mergePdfEvidence([page(1,'opening_schedule','project',{},[claim('window_area',34,'project','nr')])]);assert.equal(bad.window_area,0);assert.equal(bad.pdf_analysis.rejected_claims.length,1);
 assert.equal(pdfRuleMetric('Single leaf timber door complete','nos'),null);assert.equal(pdfRuleMetric('LED downlight','m2'),null);
});
test('schedule conflicts withhold quantities, missing floor scope and conflicting revisions are visible',()=>{
 const a=page(1,'floor_plan','ground',{floor_area:190}),b=page(2,'floor_plan','GF',{floor_area:200});b.page_evidence.revision='R2';
 const r=mergePdfEvidence([a,b,page(3,'floor_plan',null,{floor_area:400}),page(4,'quantity_schedule','project',{},[claim('window_area',10)]),page(5,'quantity_schedule','project',{},[claim('window_area',20)])]);
 assert.equal(r.floor_area,0);assert.equal(r.window_area,0);assert.equal(pdfScheduledRule(r,'glazed window','m2'),null);assert.ok(r.pdf_analysis.conflicts.length);assert.deepEqual(r.pdf_analysis.unresolved_floor_scopes,['floor:0']);
});
test('printed reinforcement mass converts kg to ton without a one-ton fallback',()=>{
 const r=mergePdfEvidence([page(1,'quantity_schedule','project',{},[claim('rebar_kg',12168.138,'project','kg')])]);assert.ok(Math.abs(pdfScheduledRule(r,'High yield steel reinforcement bars','ton').quantity-12.168138)<1e-9);
 assert.equal(pdfScheduledRule(r,'High yield steel reinforcement bars','m3'),null);
});
test('missing wall dimensions remain zero; failed pages are reported; generic PDF coefficients are disabled',()=>{
 const r=mergePdfEvidence([page(1,'floor_plan','ground',{floor_area:200,rooms:8})],[{pageNumber:2,error:'failed'}],2);assert.equal(r.wall_length,0);assert.equal(r.wall_area,0);assert.equal(r.failed_pages.length,1);
 const source=readFileSync('src/lib/serverBoqAnalysis.js','utf8');assert.ok(source.includes('!takeoff.pdf_analysis &&\n        allowProvisionalDerivation'));assert.ok(source.includes('quantity=pdfQuantity?.quantity??0'));assert.ok(source.includes('const allowBoqAi = !takeoff.pdf_analysis'));
});
test('actual BOQ normalization keeps count separate from missing area and retains PDF evidence',()=>{
 const source=readFileSync('src/lib/serverBoqAnalysis.js','utf8'),start=source.indexOf('function normalizeTakeoff('),end=source.indexOf('\nfunction ',start+10);
 const fn=vm.runInNewContext('('+source.slice(start,end)+')',{toNumber:n=>Number(n)||0,round:(n,d=2)=>Math.round(n*10**d)/10**d});
 const r=fn({windows:34,pdf_analysis:{version:104},scheduled_quantities:{}});assert.equal(r.windows,34);assert.equal(r.window_area,0);assert.equal(r.pdf_analysis.version,104);
});

test('compact PDF storage retains the safety marker; full evidence remains in durable records',async()=>{
 const {compactTakeoff}=await import('../src/lib/takeoffStorage.mjs');const full=mergePdfEvidence([page(1,'opening_schedule','project',{},[claim('window_area',12)])]);
 const compact=compactTakeoff(full,'test-pdf');assert.equal(compact.pdf_analysis.version,108);assert.equal(compact.pdf_analysis.summaryOnly,true);assert.deepEqual(compact.pdf_analysis.quantity_evidence,{});assert.equal(full.scheduled_quantities.window_area,12);
});

test('selected plan window area can feed BOQ with page provenance without a separate schedule',()=>{
 const r=mergePdfEvidence([page(1,'floor_plan','ground',{windows:2,window_area:5.4})]);const q=pdfScheduledRule(r,'Aluminium framed glazed window complete','m²');assert.equal(q.quantity,5.4);assert.deepEqual(q.pages,[1]);
});
