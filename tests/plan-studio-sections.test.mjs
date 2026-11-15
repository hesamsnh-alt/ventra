import assert from 'node:assert/strict';
import test from 'node:test';
import {newDocument,validateDocument} from '../src/lib/planStudio/document.mjs';
import {editorState,startCommand,submit,clickPoint} from '../src/lib/planStudio/controller.mjs';
import {SECTION_DEFAULTS,SECTION_LAYER,sectionWindowRect} from '../src/lib/planStudio/sections.mjs';
import {drawingSVG} from '../src/lib/planStudio/render2d.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {createPlanScene,disposePlanScene} from '../src/lib/planStudio/scene.mjs';

const p=(x,y)=>({x,y});
const line=(id,a,b)=>({id,type:'line',role:'line',layer:'architecture',a,b});
const rectangle=(id,x,y,w,h)=>({id,type:'polyline',role:'line',layer:'architecture',closed:true,points:[p(x,y),p(x+w,y),p(x+w,y+h),p(x,y+h)]});
const state=entities=>editorState({...newDocument(),entities});
const point=(s,x,y)=>clickPoint(s,p(x,y),{raw:true});
const selection=(s,command,ids)=>submit(startCommand({...s,selection:ids},command),'');

test('WW and SSL batch selection creates measured bands with distinct thicknesses and one undo',()=>{
 const baseline=state([line('wall',p(0,0),p(0,4)),line('slab',p(0,2),p(4,2))]);
 let s=selection(baseline,'WW',['wall']);
 assert.equal(s.doc.entities.find(e=>e.id==='wall'),undefined);
 assert.equal(s.doc.entities.find(e=>e.id==='slab').role,'line');
 const [wall]=s.doc.entities.filter(e=>e.layer===SECTION_LAYER);
 assert.deepEqual([...new Set(wall.points.map(p=>p.x))].sort(),[-.1,.1]);
 s=selection(s,'SSL',['slab']);
 const slab=s.doc.entities.at(-1);
 assert.equal(slab.points[0].y,2.15);
 assert.equal(slab.points.at(-1).y,1.85);
 assert.equal(startCommand(s,'UNDO').doc.entities.find(e=>e.id==='slab').type,'line');
});

test('WW accepts a true arc and a joined polyline, leaves untouched entities intact',()=>{
 const arc={id:'arc',type:'arc',role:'line',layer:'architecture',center:p(1,2),radius:1,start:0,sweep:1.5};
 const path={id:'path',type:'polyline',role:'line',layer:'architecture',points:[p(0,4),p(4,4),p(4,8)],closed:false};
 const out=selection(state([arc,path]),'WW',['arc','path']).doc.entities;
 assert.deepEqual(out.filter(e=>e.type==='arc').map(x=>x.radius),[1.1,.9]);
 assert.equal(out.at(-1).points.length,6);
});

test('section conversion rejects locked guides and model walls atomically',()=>{
 const wall={...line('wall',p(0,0),p(0,4)),role:'wall',height:3,thickness:.2};
 const s=state([wall,line('guide',p(2,0),p(2,4))]);
 assert.throws(()=>selection(s,'WW',['guide','wall']),/unlocked drafting guides/);
 assert.equal(s.doc.entities.length,2);
 const locked={...s,doc:{...s.doc,layers:s.doc.layers.map(l=>l.id==='architecture'?{...l,locked:true}:l)}};
 assert.throws(()=>selection(locked,'WW',['guide']),/unlocked drafting guides/);
});

test('WDE draws every selected rectangle with sash, transom and chosen motion markers',()=>{
 const s=state([rectangle('one',0,0,2,1.4),rectangle('two',3,2,1.7,1.4)]);
 const result=selection(s,'WDE',['one','two']);
 assert.equal(result.doc.entities.length,18);
 assert.ok(result.doc.entities.every(e=>e.role==='section'));
 assert.equal(windowCount('fixed'),5);
 assert.equal(windowCount('casement'),7);
 function windowCount(windowStyle){
  return selection({...s,options:{...s.options,section:{...SECTION_DEFAULTS,windowStyle}}},'WDE',['one']).doc.entities.filter(e=>e.role==='section').length;
 }
 assert.equal(sectionWindowRect({...s.doc.entities[0],points:[p(0,0),p(1,0),p(2,1),p(0,1)]}),null);
 assert.throws(()=>selection(s,'WDE',['bad']),/guides/);
});

for(const stairStyle of ['straight','return','scissor']){
 test(`LTP ${stairStyle} stair spans the selected bay and repeats to the chosen top level`,()=>{
  let s=startCommand(state([]),'LTP');
  s={...s,options:{...s.options,section:{...SECTION_DEFAULTS,stairStyle,firstRun:'left',stories:3}}};
  s=point(point(s,2,0),7,3.15);
  const all=s.doc.entities.flatMap(e=>e.points);
  assert.ok(all.every(pt=>pt.x>=2-1e-7&&pt.x<=7+1e-7));
  assert.ok(Math.abs(Math.max(...all.map(pt=>pt.y))-9.45)<1e-7);
  assert.equal(s.history.length,1);
  if(stairStyle==='scissor')assert.equal(s.doc.entities.filter(e=>e.dash==='dashed').length,3);
 });
}

test('LTP and SGB reject insufficient clear space',()=>{
 const stair=point(startCommand(state([]),'LTP'),0,0);
 assert.throws(()=>point(stair,1,3),/bay/);
 const ceiling=point(point(startCommand(state([]),'SGB'),0,3),4,3);
 assert.throws(()=>point(ceiling,2,3),/soffit/);
 assert.throws(()=>point(ceiling,6,2),/soffit/);
});

test('SGB outputs gypsum board, channel and repeated hangers with 2D export and no 3D objects',()=>{
 const s=point(point(point(startCommand(state([]),'SGB'),1,3.5),5,4),2,3);
 assert.equal(s.doc.entities.length,16);
 assert.equal(s.doc.entities[0].points[0].y,3);
 assert.equal(s.doc.entities[0].points.at(-1).y,3.013);
 const doc=validateDocument(JSON.parse(JSON.stringify(s.doc)));
 assert.match(drawingSVG(doc),/hatch-/);
 assert.match(exportDXF(doc),/section-details/);
 const three=createPlanScene(doc);
 assert.equal(three.children.length,0);
 disposePlanScene(three);
});

test('ML draws two joined parallel polylines with measured spacing, Enter and undo',()=>{
 let s=startCommand(state([]),'ML');
 s=point(point(point(s,0,0),3,0),3,3);
 s=submit(s,'');
 assert.equal(s.doc.entities.length,2);
 assert.deepEqual(s.doc.entities[0].points,[p(0,.1),p(2.9,.1),p(2.9,3)]);
 assert.deepEqual(s.doc.entities[1].points,[p(0,-.1),p(3.1,-.1),p(3.1,3)]);
 assert.equal(startCommand(s,'UNDO').doc.entities.length,0);
});

test('ML closes both offsets on C and respects locked layers',()=>{
 let s=startCommand(state([]),'ML');
 s=point(point(point(point(s,0,0),4,0),4,3),0,3);
 assert.ok(submit(s,'C').doc.entities.every(e=>e.closed));
 const locked={...s,doc:{...s.doc,layers:s.doc.layers.map(l=>l.id===s.activeLayer?{...l,locked:true}:l)}};
 assert.throws(()=>submit(locked,'C'),/locked/);
});

test('AD invokes the existing wall-bound door with actual opening dimensions',()=>{
 const wall={...line('wall',p(0,0),p(4,0)),type:'line',role:'wall',height:3,thickness:.2};
 const s=point(startCommand(state([wall]),'AD'),2,0);
 const door=s.doc.entities.at(-1);
 assert.equal(door.kind,'door');
 assert.equal(door.wall,'wall');
 assert.equal(door.offset,.5);
 assert.ok(door.width>0&&door.height>0);
});
