import test from 'node:test';
import assert from 'node:assert/strict';
import {clickPoint,editorState,startCommand} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {roomArea} from '../src/lib/planStudio/roomArea.mjs';
import {entitySVG} from '../src/lib/planStudio/render2d.mjs';

const p=(x,y)=>({x,y});
const corners=[p(0,0),p(5,0),p(5,4),p(0,4)];
const outline=(id,points,extra={})=>({id,layer:'architecture',type:'polyline',role:'line',points,closed:true,...extra});
const line=(id,a,b,extra={})=>({id,layer:'architecture',type:'line',a,b,...extra});
const click=(s,x,y)=>clickPoint(s,p(x,y),{tolerance:.3});

test('MJ labels an enclosed room in square metres and preserves its source lines',()=>{
 const source=corners.map((a,i)=>line('s'+i,a,corners[(i+1)%corners.length]));
 const doc={...newDocument(),units:'in',entities:source};
 const initial=editorState(doc),next=click(startCommand(initial,'MJ'),2,2);
 const label=next.doc.entities.at(-1);
 assert.equal(label.text,'20 m²');
 assert.deepEqual(label.position,p(2,2));
 assert.deepEqual(next.doc.entities.slice(0,-1),source);
 assert.equal(next.areaOutline.length,1);
 assert.match(entitySVG(next.doc,label),/text-anchor="middle"/);
 assert.deepEqual(startCommand(next,'UNDO').doc,doc);
 assert.throws(()=>click(startCommand(initial,'AREA'),7,7),/No closed boundary/);
});

test('AREA measures between real wall faces and stays closed across a hosted door',()=>{
 const entities=corners.map((a,i)=>line('w'+i,a,corners[(i+1)%corners.length],{role:'wall',thickness:.2,height:3}));
 entities.push({id:'door',layer:'architecture',type:'opening',kind:'door',wall:'w0',offset:.5,width:.9,height:2.1});
 const doc=editorState({...newDocument(),entities}).doc;
 assert.equal(roomArea(doc,p(2,2)).label.text,'18.24 m²');
});

test('AREA counts exact circular voids once and omits a generated room finish or section',()=>{
 const entities=[
  outline('outer',corners),
  {id:'island',layer:'architecture',type:'circle',center:p(3,2),radius:1,start:0,sweep:2*Math.PI},
  {id:'nested',layer:'architecture',type:'circle',center:p(3,2),radius:.4,start:0,sweep:2*Math.PI},
  outline('finish',[p(0,0),p(2,0),p(2,2),p(0,2)],{role:'floor',roomFinish:true}),
  outline('section',[p(.5,.5),p(1.5,.5),p(1.5,1.5),p(.5,1.5)],{role:'section'}),
 ];
 assert.equal(roomArea({...newDocument(),entities},p(1,1)).label.text,'16.858 m²');
});
