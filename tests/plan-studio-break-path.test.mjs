import test from 'node:test';
import assert from 'node:assert/strict';
import {breakPath} from '../src/lib/planStudio/breakPath.mjs';
import {clickPoint,editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {at,dist,TAU} from '../src/lib/planStudio/geometry.mjs';

const p=(x,y)=>({x,y});
const line={id:'line',layer:'architecture',type:'line',a:p(0,0),b:p(5,0),color:'#112233',dash:'dashed'};
const state=entities=>editorState({...newDocument(),entities});
const click=(s,x,y)=>clickPoint(s,p(x,y),{raw:true});

test('SPLIT selects a line then makes two adjacent pieces in a single undo',()=>{
 const original=state([line]);
 let s=click(startCommand(original,'SPLIT'),1,0);
 assert.equal(s.phase,'split-point');
 assert.throws(()=>click(s,0,0),/between the endpoints/);
 s=click(s,2,.4);
 assert.deepEqual(s.doc.entities.map(e=>[e.a,e.b]),[[p(0,0),p(2,0)],[p(2,0),p(5,0)]]);
 assert.ok(s.doc.entities.every(e=>e.color===line.color&&e.dash===line.dash));
 assert.deepEqual(startCommand(s,'UNDO').doc,original.doc);
});

test('CUT uses preselection and accepts coordinate input in either order',()=>{
 const original={...state([line]),selection:[line.id]};
 const first=submit(startCommand(original,'BR'),'4m,0m');
 assert.equal(first.phase,'second');
 assert.throws(()=>submit(first,'4m,0m'),/two different points/);
 const s=submit(first,'1m,0m');
 assert.deepEqual(s.doc.entities.map(e=>[e.a,e.b]),[[p(0,0),p(1,0)],[p(4,0),p(5,0)]]);
 assert.deepEqual(startCommand(s,'UNDO').doc,original.doc);
});

test('Closed paths can split into two arcs and CUT follows the order of picks across the seam',()=>{
 const circle={type:'circle',center:p(0,0),radius:3,start:0,sweep:TAU};
 const first=at(circle,.75),second=at(circle,.25);
 const parts=breakPath(circle,first,second);
 assert.equal(parts.length,2);
 assert.ok(parts.every(e=>e.type==='arc'&&Math.abs(e.sweep-Math.PI)<1e-9));
 const [remaining]=breakPath(circle,first,second,{remove:true});
 assert.ok(dist(at(remaining,0),second)<1e-9);
 assert.ok(dist(at(remaining,1),first)<1e-9);
 assert.ok(at(remaining,.5).x<0);
 const square={type:'polyline',points:[p(0,0),p(4,0),p(4,4),p(0,4)],closed:true};
 const [open]=breakPath(square,p(0,1),p(2,0),{remove:true});
 assert.deepEqual(open.points,[p(2,0),p(4,0),p(4,4),p(0,4),p(0,1)]);
 assert.equal(open.closed,false);
});

test('SPLIT rehosts intact wall openings and rejects cutting through an opening',()=>{
 const wall={...line,role:'wall',height:3,thickness:.2};
 const door={id:'door',layer:'architecture',type:'opening',kind:'door',wall:wall.id,offset:.6,width:1,height:2};
 const s=click(startCommand(state([wall,door]),'SPLIT'),1,0);
 assert.throws(()=>click(s,3,0),/Split outside/);
 const {doc}=click(s,2,0);
 const opening=doc.entities.find(e=>e.type==='opening');
 const host=doc.entities.find(e=>e.id===opening.wall);
 assert.deepEqual(host.a,p(2,0));
 assert.ok(dist(at(host,opening.offset),p(3,0))<1e-9);
});
