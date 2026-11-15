import assert from 'node:assert/strict';
import test from 'node:test';
import {clickPoint,editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {ROOM_LAYOUTS} from '../src/lib/planStudio/roomLayout.mjs';
import {exportDXF} from '../src/lib/planStudio/export.mjs';
import {drawingSVG} from '../src/lib/planStudio/render2d.mjs';
import {createPlanScene,disposePlanScene} from '../src/lib/planStudio/scene.mjs';

const p=(x,y)=>({x,y});
const wall=(id,a,b)=>({id,type:'line',role:'wall',layer:'architecture',height:3,thickness:.2,a,b});
const state=(entities=[])=>editorState({...newDocument(),entities});
const click=(s,x,y)=>clickPoint(s,p(x,y),{raw:true,tolerance:.06});

test('ADT repeatedly places doors and keeps opening validation active',()=>{
 const s=startCommand(state([wall('w',p(0,0),p(7,0))]),'ADT');
 const placed=click(click(s,2,0),5,0);
 assert.equal(placed.command,'DOORRUN');
 assert.deepEqual(placed.doc.entities.slice(1).map(e=>e.kind),['door','door']);
 assert.throws(()=>click(placed,2.2,0),/overlap/);
 assert.equal(submit(placed,'').command,'SELECT');
});

test('WD measures two endpoints on one wall, accepts reverse direction and repeats',()=>{
 const a=wall('a',p(0,0),p(7,0)),b=wall('b',p(7,0),p(7,4));
 let s=startCommand(state([a,b]),'WD');
 s=click(s,3,0);
 assert.throws(()=>click(s,7,2),/same wall/);
 s=click(s,1,0);
 assert.equal(s.doc.entities.at(-1).width,2);
 assert.equal(s.doc.entities.at(-1).wall,'a');
 s=click(click(s,7,1),7,3);
 assert.equal(s.doc.entities.at(-1).wall,'b');
 assert.equal(s.doc.entities.length,4);
});

for(const [face,expected] of [['left',-.1],['right',.1]]){
 test(`W ${face} alignment offsets and joins the wall axes, with atomic undo`,()=>{
  let s=startCommand(state(),'W');
  s={...s,options:{...s.options,wallAlignment:face,thickness:.2}};
  s=submit(click(click(click(s,0,0),3,0),3,3),'');
  const [a,b]=s.doc.entities;
  assert.equal(a.a.y,expected);
  assert.deepEqual(a.b,b.a);
  assert.ok(s.doc.entities.every(e=>e.role==='wall'));
  assert.equal(startCommand(s,'UNDO').doc.entities.length,0);
 });
}

for(const [kind,,,items] of ROOM_LAYOUTS){
 test(`AF places a ${kind} from two corners, with one undo`,()=>{
  let s=startCommand(state(),'AF');
  s={...s,options:{...s.options,roomLayout:kind}};
  s=click(click(s,0,0),4,4);
  const assets=s.doc.entities.filter(e=>e.type==='asset');
  assert.equal(assets.length,kind==='dining'?5:items.length);
  assert.equal(new Set(assets.map(e=>e.setId)).size,1);
  assert.equal(startCommand(s,'UNDO').doc.entities.length,0);
  if(kind==='bathroom'||kind==='kitchen'){
   assert.ok(s.doc.entities.some(e=>e.role==='floor'&&e.hatch==='tile'));
   assert.match(drawingSVG(s.doc),/hatch-/);
   assert.match(exportDXF(s.doc),/HATCH/);
  }
  const root=createPlanScene(s.doc);
  assert.ok(root.children.some(group=>group.children.length));
  disposePlanScene(root);
 });
}

test('AF leaves the plan intact when all the fixtures cannot fit',()=>{
 let s=startCommand(state(),'AF');
 s={...s,options:{...s.options,roomLayout:'bathroom'}};
 s=click(s,0,0);
 assert.throws(()=>click(s,1,1),/space/);
 assert.equal(s.doc.entities.length,0);
});
