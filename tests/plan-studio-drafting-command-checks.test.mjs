import test from 'node:test';
import assert from 'node:assert/strict';
import {clickPoint,chooseRoomLayout,editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {multilinePreview} from '../src/lib/planStudio/multilineWalls.mjs';
import {trimCurve,at,TAU} from '../src/lib/planStudio/geometry.mjs';

const p=(x,y)=>({x,y});
const line=(id,a,b,layer='architecture')=>({type:'line',id,layer,a,b});
const state=(entities=[])=>editorState({...newDocument(),entities});
const click=(s,x,y,tolerance=.05)=>clickPoint(s,p(x,y),{tolerance});

test('Quick TRIM uses the actual click even when OSNAP would move it onto a cutter',()=>{
 const target=line('target',p(0,0),p(8,0));
 const cutter=line('cutter',p(3,-2),p(3,2));
 const original=state([target,cutter]);
 const s=click(startCommand(original,'TR'),3.08,0,.15);
 const part=s.doc.entities.find(e=>e.id!=='cutter');
 assert.deepEqual([part.a,part.b],[p(0,0),p(3,0)]);
 assert.deepEqual(startCommand(s,'U').doc,original.doc);
});

test('TRIM of a circle removes the whole chosen segment through its wrap point',()=>{
 const circle={type:'circle',center:p(0,0),radius:2,start:0,sweep:TAU};
 const [arc]=trimCurve(circle,[line('cut',p(1,-3),p(1,3))],p(2,0));
 assert.equal(arc.type,'arc');
 assert.ok(arc.sweep>Math.PI);
 assert.ok(at(arc,.5).x< -1.99);
});

test('EXTRIM uses a four-line outline and preserves objects outside the side it cuts',()=>{
 const boundary=[line('down',p(0,0),p(6,0)),line('right',p(6,0),p(6,5)),
  line('up',p(6,5),p(0,5)),line('left',p(0,5),p(0,0))];
 const target=line('through',p(-2,3),p(8,3)),unaffected=line('keep',p(8,8),p(10,8));
 const original=state([...boundary,target,unaffected]);
 let s=click(startCommand(original,'EXTRIM'),1,0);
 assert.equal(s.boundary.length,4);
 assert.throws(()=>click(s,2,0),/clearly inside or outside/);
 s=click(s,2,2);
 assert.ok(s.doc.entities.some(e=>e.id==='keep'));
 const pieces=s.doc.entities.filter(e=>e.id!=='keep'&&!boundary.some(b=>b.id===e.id));
 assert.deepEqual(pieces.map(e=>[e.a,e.b]),[[p(-2,3),p(0,3)],[p(6,3),p(8,3)]]);
 assert.deepEqual(startCommand(s,'U').doc,original.doc);
});

test('EXTRIM only clips eligible visible unlocked geometry and keeps unaffected hosted openings',()=>{
 const boundary={id:'boundary',type:'polyline',closed:true,points:[p(0,0),p(8,0),p(8,6),p(0,6)],layer:'architecture'};
 const wall={...line('host',p(1,1),p(6,1)),role:'wall',height:3,thickness:.2};
 const door={id:'door',layer:'architecture',type:'opening',kind:'door',wall:'host',width:1,height:2,offset:.5,z:0};
 const locked=line('locked',p(-2,4),p(2,4),'notes'),cross=line('cross',p(-2,2),p(2,2));
 let s=state([boundary,wall,door,locked,cross]);
 s.doc.layers.find(l=>l.id==='notes').locked=true;
 s=click(click(startCommand(s,'EXTRIM'),4,0),-3,2);
 assert.ok(s.doc.entities.some(e=>e.id==='locked'));
 assert.deepEqual(s.doc.entities.find(e=>e.id==='door'),door);
 assert.deepEqual(s.doc.entities.find(e=>e.id==='host'),wall);
});

test('AF uses diagonal opposite picks with ORTHO enabled and retains the ML floor beneath tile finish',()=>{
 let s=startCommand(state(),'ML');
 for(const pt of [p(0,0),p(8,0),p(8,6),p(0,6)])s=clickPoint(s,pt,{raw:true});
 s=submit(s,'C');
 s=chooseRoomLayout(startCommand({...s,ortho:true,snap:false},'AF'),'bathroom');
 s=click(click(s,.1,.1),3.8,3.55);
 assert.ok(s.doc.entities.some(e=>e.catalogId==='toilet'));
 assert.ok(s.doc.entities.some(e=>e.roomFinish&&e.hatch==='tile'));
 assert.equal(multilinePreview(s.doc.entities).floors.length,1);
});
