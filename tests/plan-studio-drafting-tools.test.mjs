import test from 'node:test';
import assert from 'node:assert/strict';
import {clickPoint, editorState, snappedPoint, startCommand, submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {dist, EPS, inside} from '../src/lib/planStudio/geometry.mjs';
import {SECTION_DEFAULTS} from '../src/lib/planStudio/sections.mjs';
import {planSectionCut} from '../src/lib/planStudio/planSectionCut.mjs';
import {columnSymbols,labelGrid} from '../src/lib/planStudio/gridDrafting.mjs';
import {perimeterDimensions} from '../src/lib/planStudio/draftingGeometry.mjs';

const p=(x,y)=>({x,y});
const e=(id,geometry)=>({layer:'architecture',id,...geometry});
const line=(id,a,b)=>e(id,{role:'line',type:'line',a,b});
const wall=(id,a,b,z=0)=>e(id,{type:'line',role:'wall',thickness:.2,height:3,a,b,z});
const poly=(id,points)=>e(id,{role:'line',type:'polyline',closed:true,points});
const square=(x,y,r,t)=>[p(x,y),p(r,y),p(r,t),p(x,t)];
const graph=[
 ...[0,2,7].map(x=>line('c'+x,p(x,0),p(x,5))),
 ...[0,1,5].map(y=>line('r'+y,p(0,y),p(7,y))),
];
const click=(s,x,y)=>clickPoint(s,p(x,y),{raw:true});
const state=entities=>editorState({...newDocument(),entities});
const outlines=entities=>entities.filter(e=>e.type==='dimension');
const spaces=entities=>outlines(entities).map(e=>+dist(e.a,e.b).toFixed(4));
const section=(entities,patch={}, side=p(0,1))=>
 planSectionCut({...newDocument(),entities},p(-1,0),p(9,0),side,p(0,0),{...SECTION_DEFAULTS,...patch});

test('ZZBZ creates a symbol at every actual crossing in a selection box, preserving source and undo',()=>{
 let s=startCommand(state(graph),'ZZBZ');
 s=click(click(s,-.2,-.2),7.2,5.2);
 assert.equal(s.doc.entities.length,15);
 assert.deepEqual(s.doc.entities.slice(0,6),graph);
 assert.ok(s.doc.entities.slice(6).every(e=>e.detailKind==='grid-column'&&e.role==='section'&&e.hatch==='solid'));
 const again=click(click(startCommand(s,'ZZBZ'),-.2,-.2),7.2,5.2);
 assert.equal(again.doc.entities.length,15);
 assert.deepEqual(startCommand(s,'UNDO').doc.entities,graph);
});

test('ZZBZ uses finite rotated guides, ignores parallels and entities outside selection',()=>{
 const rot=({x,y})=>p((x-y)*Math.SQRT1_2,(x+y)*Math.SQRT1_2);
 const partial=[line('diagonal annotation',p(-10,-10),p(20,20)),line('short',p(2,0),p(2,.2)),...graph.filter(e=>e.id!=='c2')];
 const tilted=partial.map(e=>({...e,a:rot(e.a),b:rot(e.b)}));
 const created=columnSymbols(tilted,[],{...SECTION_DEFAULTS,gridColumnWidth:.4,gridColumnDepth:.7});
 assert.equal(created.length,7);
 assert.ok(created.every(e=>Math.abs(dist(e.points[0],e.points[1])-.4)<EPS));
 assert.ok(created.every(e=>Math.abs(dist(e.points[1],e.points[2])-.7)<EPS));
 assert.throws(()=>columnSymbols([graph[0]],[],SECTION_DEFAULTS),/two crossing families/);
});

test('AZH draws both sides of both families with measured bay widths and overall lengths',()=>{
 const all=labelGrid(graph,SECTION_DEFAULTS);
 assert.deepEqual(all.filter(e=>e.type==='text').map(e=>e.text),['1','2','3','1','2','3','A','B','C','A','B','C']);
 assert.equal(all.filter(e=>e.type==='circle').length,12);
 assert.deepEqual(spaces(all),[2,5,7,2,5,7,1,4,5,1,4,5]);
 let s=startCommand({...state(graph),selection:graph.map(e=>e.id)},'AZH');
 s=submit(s,'');
 assert.match(exportDXF(s.doc),/CIRCLE/);
 assert.deepEqual(s.doc.entities.slice(0,6),graph);
});

const L=poly('notched',[p(0,0),p(8,0),p(8,4),p(5,4),p(5,7),p(0,7)]);
test('DPL measures each step of a concave outline and links dimension extensions to vertices',()=>{
 const dimensions=perimeterDimensions([L],.4);
 assert.deepEqual(spaces(dimensions),[7,4,3,7,8,5,3,8]);
 assert.ok(dimensions.filter(e=>e.type==='line').some(e=>e.a.x===5&&e.b.x===8));
 const reversed=perimeterDimensions([{...L,points:[...L.points].reverse()}],.4);
 assert.deepEqual(outlines(reversed),outlines(dimensions));
});

test('DPL clicks the closed outline even when an ordinary line is coincident',()=>{
 const source=[line('duplicate',p(0,0),p(8,0)),L];
 const s=click(startCommand(state(source),'DPL'),3,0);
 assert.deepEqual(s.doc.entities.slice(0,2),source);
 assert.equal(outlines(s.doc.entities).length,8);
 assert.throws(()=>click(startCommand(state([source[0]]),'DPL'),3,0),/closed polylines/);
});

test('DPL measures sloped segments by their true aligned length',()=>{
 const result=perimeterDimensions([poly('slope',[p(0,0),p(4,0),p(4,3)])],.4);
 assert.deepEqual(spaces(result),[4,3,5]);
 assert.ok(result.every(e=>e.offsetDistance===-.4));
});

test('LM uses actual wall width, floor thickness and Z elevations',()=>{
 const floor={...poly('floor',square(0,-2,8,2)),role:'floor',height:.25,z:.6};
 const geometry=section([wall('crossing',p(2,-1),p(2,1),.6),floor],{cutDepth:0});
 const cut=geometry.filter(e=>e.detailKind==='section-cut');
 assert.equal(cut.length,2);
 assert.ok(Math.abs(cut[0].points[0].x-2.9)<EPS);
 assert.ok(Math.abs(cut[0].points[1].x-3.1)<EPS);
 assert.equal(cut[0].points[2].y,3.6);
 assert.equal(cut[1].points[0].y,.35);
 assert.equal(cut[1].hatch,'concrete');
});

test('LM wall cut retains solids above and below a window while preserving its opening',()=>{
 const w=wall('long',p(0,0),p(8,0));
 const window=e('win',{type:'opening',kind:'window',wall:w.id,offset:.5,width:2,height:1.3,z:.8});
 const cut=section([w,window],{cutDepth:0}).filter(e=>e.detailKind==='section-cut');
 assert.equal(cut.length,4);
 assert.ok(!cut.some(e=>inside(p(5,1.5),e.points)));
 assert.ok(cut.some(e=>inside(p(5,.4),e.points)));
 assert.ok(cut.some(e=>inside(p(5,2.7),e.points)));
});

test('LM projects only the selected side within the configured depth and carries its openings',()=>{
 const w=wall('behind',p(1,2),p(7,2));
 const win=e('win',{type:'opening',kind:'window',wall:w.id,offset:.5,width:1,height:1,z:.8});
 const entities=[w,win,wall('far',p(1,7),p(7,7)),wall('other side',p(1,-2),p(7,-2))];
 const pos=section(entities,{cutDepth:3});
 assert.equal(pos.filter(e=>e.detailKind==='section-projection').length,2);
 const neg=section(entities,{cutDepth:3},p(0,-2));
 assert.equal(neg.filter(e=>e.detailKind==='section-projection').length,1);
 assert.ok(neg.some(e=>e.detailKind==='section-marker'&&e.type==='line'&&e.a.y===0&&e.b.y<0));
});

test('LM cuts curved walls at the actual arc radii',()=>{
 const arc=e('curve',{type:'arc',role:'wall',center:p(2,0),radius:1,start:-.25,sweep:.5,thickness:.2,height:3});
 const [cut]=section([arc],{cutDepth:0}).filter(e=>e.detailKind==='section-cut');
 assert.ok(Math.abs(cut.points[0].x-3.9)<EPS);
 assert.ok(Math.abs(cut.points[1].x-4.1)<EPS);
});

test('LM preserves holes in the slab cut',()=>{
 const floor={...poly('floor',square(0,-2,8,2)),role:'floor',hatchHoles:[square(3,-1,5,1)]};
 const cut=section([floor],{cutDepth:0}).filter(e=>e.detailKind==='section-cut');
 assert.deepEqual(cut.map(e=>[e.points[0].x,e.points[1].x]),[[1,4],[6,9]]);
});

test('LM inserts a labelled section and arrows in one edit, outside the plan even with ORTHO',()=>{
 const source=[wall('w',p(2,-1),p(2,1))];
 let s=startCommand(state(source),'LM');
 s=click(click(s,-1,0),4,0);
 assert.throws(()=>click(s,1,0),/side away/);
 assert.deepEqual(snappedPoint({...s,ortho:true},p(1,2)),p(1,2));
 s=click(click(s,1,1),25,12);
 assert.deepEqual(s.doc.entities[0],source[0]);
 assert.ok(s.doc.entities.find(e=>e.text==='A-A').position.x>=25);
 assert.equal(s.history.length,1);
 assert.match(exportDXF(s.doc),/A-A/);
});
