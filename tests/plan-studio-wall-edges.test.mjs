import assert from 'node:assert/strict';
import test from 'node:test';
import {clickPoint,editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {wallFaceLines} from '../src/lib/planStudio/openings.mjs';
import {drawingSVG} from '../src/lib/planStudio/render2d.mjs';

const p=(x,y)=>({x,y});
const line=(id,a,b)=>({id,type:'line',role:'line',layer:'architecture',a,b});
const click=(s,x,y)=>clickPoint(s,p(x,y),{raw:true,tolerance:.07});
const state=(entities)=>editorState({...newDocument(),entities});
const edges=[line('a',p(0,0),p(6,0)),line('b',p(6,.2),p(0,.2))];

test('AD works directly on Line → Offset geometry and creates a real break in both drawn faces',()=>{
 let draft=startCommand(editorState(),'L');
 draft=submit(click(click(draft,0,0),6,0),'');
 draft=submit(startCommand(draft,'O'),'20cm');
 draft=click(click(draft,3,0),3,.4);
 const prior=draft.doc;
 assert.deepEqual(prior.entities.map(e=>e.role),['line','line']);
 const placed=click(startCommand(draft,'AD'),3,.1);
 const wall=placed.doc.entities.find(e=>e.wallFromEdges);
 const door=placed.doc.entities.at(-1);
 assert.equal(wall.thickness,.2);
 assert.equal(door.kind,'door');
 assert.equal(door.wall,wall.id);
 assert.equal(wallFaceLines(placed.doc,wall).length,4);
 assert.ok(!wallFaceLines(placed.doc,wall).some(face=>face.a.x<3&&face.b.x>3));
 assert.match(drawingSVG(placed.doc),/data-opening-symbol="door"/);
 assert.match(exportDXF(placed.doc),/\nARC\n/);
 assert.deepEqual(startCommand(placed,'U').doc,prior);
});

test('WD waits for the second endpoint and stores a window of the measured width in one undo',()=>{
 const original=state(edges);
 const started=click(startCommand(original,'WD'),2,0);
 assert.deepEqual(started.doc,original.doc);
 const placed=click(started,4,.16);
 assert.equal(placed.doc.entities.at(-1).kind,'window');
 assert.equal(placed.doc.entities.at(-1).width,2);
 assert.equal(placed.history.length,1);
 assert.deepEqual(startCommand(placed,'U').doc,original.doc);
});

test('W2 retains the unmatched tails and places the wall on the span common to both lines',()=>{
 const source=[line('a',p(0,0),p(6,0)),line('b',p(8,.25),p(2,.25))];
 const original=state(source);
 const selected=startCommand({...original,selection:['a','b']},'W2');
 const [tailA,tailB,wall]=selected.doc.entities;
 assert.deepEqual([tailA.a,tailA.b],[p(0,0),p(2,0)]);
 assert.deepEqual([tailB.a,tailB.b],[p(8,.25),p(6,.25)]);
 assert.deepEqual([wall.a,wall.b],[p(2,.125),p(6,.125)]);
 assert.equal(wall.thickness,.25);
 assert.deepEqual(startCommand(selected,'U').doc,original.doc);
});

test('W2 can pick the two edges of offset polylines without losing neighboring segments',()=>{
 const poly=(id,points)=>({id,type:'polyline',role:'line',layer:'architecture',points,closed:false});
 const s=startCommand(state([poly('outer',[p(0,2),p(0,0),p(6,0)]),poly('inner',[p(.2,2),p(.2,.2),p(6,.2)])]),'W2');
 const selected=click(click(s,3,0),3,.2);
 const [outer,inner,wall]=selected.doc.entities;
 assert.equal(wall.role,'wall');
 assert.deepEqual(outer.points,[p(0,2),p(0,0),p(.2,0)]);
 assert.deepEqual([inner.a,inner.b],[p(.2,2),p(.2,.2)]);
});

test('single lines, perpendicular lines and locked walls do not sneak through automatic inference',()=>{
 for(const invalid of [[edges[0]],[edges[0],line('cross',p(3,0),p(3,3))]]){
  assert.throws(()=>click(startCommand(state(invalid),'AD'),3,0),/parallel wall edges/);
 }
 const locked=state(edges);
 locked.doc.layers.find(e=>e.id==='architecture').locked=true;
 assert.throws(()=>click(startCommand(locked,'AD'),3,.1),/Unlock/);
 assert.equal(locked.doc.entities.length,2);
});

test('center point of a thick pair and multiple successive openings work without duplicating the wall',()=>{
 const source=[edges[0],line('thick',p(0,.52),p(6,.52))];
 let s=startCommand(state(source),'ADT');
 s=click(click(s,2,.26),4,.26);
 assert.equal(s.doc.entities.filter(e=>e.role==='wall').length,1);
 assert.equal(s.doc.entities.filter(e=>e.type==='opening').length,2);
});
