import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {auditPdfAreaGeometry} from '../src/lib/pdfAreaGeometry.mjs';
import {mergePdfEvidence,pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
const dimensioned=JSON.parse(readFileSync('tests/fixtures/pdf-dimensioned-floors.json','utf8'));
const page=(geometry)=>({pageNumber:2,rooms:10,floor_area:176,ceiling_area:164,detected_items:[],area_geometry:geometry,page_evidence:{kind:'floor_plan',scope_id:'first_floor',quantities:[{key:'ceramic_floor_area',value:42,unit:'m2',scope_id:'first_floor',evidence:'Wrong hall subtraction reported by AI'}]}});
test('dimensioned boundaries compute hall independently of its erroneous reported area',()=>{
 const g=structuredClone(dimensioned[1]);g.spaces.find(r=>r.tag==='F04').reported_area=20;
 const input=page(g),before=JSON.stringify(input),r=auditPdfAreaGeometry(input);
 assert.equal(r.audit.status,'dimension_geometry_checked');assert.equal(r.page.floor_area,180);assert.equal(r.page.ceiling_area,168);assert.equal(r.page.ceramic_floor_area,46);
 assert.deepEqual(r.audit.corrections.map(({tag,reported,computed})=>({tag,reported,computed})),[{tag:'F04',reported:20,computed:24}]);assert.equal(JSON.stringify(input),before);
});
test('complete ground and upper geometry computes project quantities and leaves exact opening metrics separate',()=>{
 const a=page(dimensioned[0]);a.pageNumber=1;a.page_evidence.scope_id='ground_floor';a.page_evidence.quantities=[];
 const b=page(dimensioned[1]);const r=mergePdfEvidence([a,b]);
 assert.equal(r.floor_area,372);assert.equal(r.ceiling_area,360);assert.equal(r.wood_floor_area,178);assert.equal(r.ceramic_floor_area,154);assert.equal(r.epoxy_floor_area,28);assert.equal(r.terrace_floor_area,12);
 assert.equal(pdfScheduledRule(r,'Ceramic floor tiles including adhesive and grout','m2').quantity,154);
});
test('same wrong room sum and floor summary cannot bypass missing independent dimensions',()=>{
 const p=page(null);p.detected_items=[{name:'F04 Hall',quantity:20,unit:'m2',description:'TILE | inferred 2 x 12 minus 4 landing'}];
 const a=page(dimensioned[0]);a.pageNumber=1;a.page_evidence.scope_id='ground_floor';
 const r=mergePdfEvidence([a,p]);assert.equal(r.floor_area,0);assert.equal(r.ceramic_floor_area,0);assert.equal(pdfScheduledRule(r,'Ceramic floor tiles','m2'),null);
 assert.ok(r.pdf_analysis.withheld_area_metrics.includes('ceramic_floor_area'));
 assert.equal(r.pdf_analysis.area_validation.find(a=>a.page===2).original_area_evidence.claims[0].value,42);
});
test('overlapping landing, incomplete region coverage and outside-room geometry are rejected',()=>{
 for(const mutate of [g=>{g.spaces.find(r=>r.tag==='F05').polygon=g.spaces.find(r=>r.tag==='F04').polygon;},g=>{g.spaces=g.spaces.filter(r=>r.tag!=='F05');},g=>{g.spaces[0].polygon[0].x=-1;}]){
  const g=structuredClone(dimensioned[1]);mutate(g);const r=auditPdfAreaGeometry(page(g));assert.equal(r.audit.status,'withheld');assert.equal(r.page.floor_area,0);
 }
});
test('self-crossing, nonfinite coordinates and repeated identities never produce accepted geometry',()=>{
 for(const mutate of [g=>{g.envelope=[{x:0,y:0},{x:16,y:12},{x:16,y:0},{x:0,y:12}];},g=>{g.spaces[0].polygon[0].x=NaN;},g=>{g.spaces[1].tag=g.spaces[0].tag;}]){
  const g=structuredClone(dimensioned[1]);mutate(g);assert.equal(auditPdfAreaGeometry(page(g)).audit.status,'withheld');
 }
});
test('translation and winding do not change area; L-shaped rooms remain correctly measured',()=>{
 const g=structuredClone(dimensioned[1]);for(const p of [g.envelope,...g.spaces.map(r=>r.polygon)]){p.reverse();for(const v of p){v.x-=50;v.y+=100;}}
 const r=auditPdfAreaGeometry(page(g));assert.equal(r.audit.status,'dimension_geometry_checked');assert.equal(r.page.wood_floor_area,122);
});
test('different sized project is calculated from its own coordinates, without benchmark constants',()=>{
 const g=structuredClone(dimensioned[1]);for(const p of [g.envelope,...g.spaces.map(r=>r.polygon)])for(const v of p){v.x*=1.5;v.y*=2;}
 const r=auditPdfAreaGeometry(page(g));assert.equal(r.page.floor_area,540);assert.equal(r.page.ceiling_area,504);assert.equal(r.page.ceramic_floor_area,138);
});
test('unclassified material does not borrow a known finish or invent a rate-bearing total',()=>{
 const g=structuredClone(dimensioned[1]);g.spaces[0].finish='unknown';const r=mergePdfEvidence([page(g)]);
 assert.equal(r.floor_area,180);assert.equal(r.wood_floor_area,0);assert.equal(r.ceramic_floor_area,0);assert.ok(r.pdf_analysis.withheld_area_metrics.length);
});
test('clear area partition includes wall footprint coverage but does not price it as usable floor',()=>{
 const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const space=(tag,kind,finish,polygon)=>({tag,kind,finish,polygon,reported_area:null,evidence:'Printed clear dimensions and wall footprint'});
 const g={basis:'clear_internal',envelope:rect(0,0,10,10),envelope_evidence:'Printed 10 x 10 m shell interior',spaces:[space('A','enclosed','tile',rect(0,0,4,10)),space('W','wall','unknown',rect(4,0,1,10)),space('B','enclosed','wood',rect(5,0,5,10))]};
 const r=auditPdfAreaGeometry(page(g));assert.equal(r.audit.status,'dimension_geometry_checked');assert.equal(r.page.floor_area,90);assert.equal(r.page.ceiling_area,90);assert.equal(r.page.ceramic_floor_area,40);assert.equal(r.page.wood_floor_area,50);assert.equal(r.audit.withheld_metrics.length,0);
});
