import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3} from 'three';
import {clickPoint,editorState,startCommand,submit,updateProperties} from '../src/lib/planStudio/controller.mjs';
import {newDocument} from '../src/lib/planStudio/document.mjs';
import {multilinePreview} from '../src/lib/planStudio/multilineWalls.mjs';
import {parallelLines} from '../src/lib/planStudio/sections.mjs';
import {createPlanScene,disposePlanScene} from '../src/lib/planStudio/scene.mjs';
import {drawingSVG} from '../src/lib/planStudio/render2d.mjs';

const p=(x,y)=>({x,y});
const rectangle=[p(0,0),p(7,0),p(7,4),p(0,4)];
const click=(s,pt)=>clickPoint(s,pt,{raw:true,tolerance:.07});
const shape=(points=rectangle,close=true,patch={})=>{
 let s=startCommand(editorState(),'ML');
 s={...s,options:{...s.options,...patch}};
 for(const pt of points)s=click(s,pt);
 return submit(s,close?'C':'');
};
const floor=(points=rectangle)=>({id:'manual',layer:'architecture',role:'floor',type:'polyline',points,closed:true,height:.15});

test('closed ML keeps two ordinary drafting polylines and produces true 3 m walls and a floor without a FLOOR entity',()=>{
 const {doc}=shape();
 assert.equal(doc.entities.length,2);
 assert.ok(doc.entities.every(e=>e.type==='polyline'&&e.role==='line'&&e.height===3));
 const view=multilinePreview(doc.entities);
 assert.equal(view.bands.length,1);
 assert.equal(view.bands[0].holes.length,1);
 assert.equal(view.floors.length,1);
 const root=createPlanScene(doc);
 try {
  const wall=root.children.find(e=>e.userData.planRole==='multiline-wall');
  assert.equal(new Box3().setFromObject(wall).max.z,3);
  const deck=root.children.find(e=>e.userData.planRole==='automatic-floor');
  assert.ok(Math.abs(new Box3().setFromObject(deck).max.z)<1e-8);
  assert.doesNotMatch(drawingSVG(doc),/automatic-floor/);
 } finally {disposePlanScene(root);}
});

test('open ML has walls at their requested height and level without an invented floor',()=>{
 const s=shape(rectangle.slice(0,3),false,{wallHeight:2.7,z:3});
 const {bands,floors}=multilinePreview(s.doc.entities);
 assert.equal(bands.length,1);
 assert.equal(bands[0].height,2.7);
 assert.equal(bands[0].z,3);
 assert.equal(floors.length,0);
});

test('an existing closed ML is reconstructed automatically and manual floor excludes duplicate coverage',()=>{
 const old=parallelLines(rectangle,.2,true).map((e,i)=>({...e,id:'old-'+i,layer:'architecture'}));
 const original=structuredClone(old);
 const result=multilinePreview(old);
 assert.equal(result.bands[0].height,3);
 assert.equal(result.floors.length,1);
 assert.equal(multilinePreview([...old,floor()]).floors.length,0);
 assert.deepEqual(old,original);
 assert.equal(multilinePreview([old[0],{...old[1],points:[...old[1].points.slice(0,3),p(0,3)]}]).bands.length,0);
});

test('2D-only ML stays as two drafting lines with no 3D objects',()=>{
 const blank=editorState();
 const s=shape(rectangle,true,{section:{...blank.options.section,multilinePurpose:'drafting'}});
 assert.deepEqual(multilinePreview(s.doc.entities),{bands:[],floors:[]});
});

test('an opening in a closed ML keeps nearby walls, its floor, and the initial wall height',()=>{
 let s=shape(rectangle,true,{wallHeight:2.85});
 s=click(startCommand({...s,options:{...s.options,wallHeight:4}},'AD'),p(3,0));
 const wall=s.doc.entities.find(e=>e.wallFromEdges);
 assert.equal(wall.height,2.85);
 assert.equal(s.doc.entities.at(-1).kind,'door');
 const result=multilinePreview(s.doc.entities);
 assert.equal(result.bands.length,3);
 assert.equal(result.floors.length,1);
 assert.equal(multilinePreview(startCommand(s,'U').doc.entities).bands.length,1);
});

test('editing one ML face height updates both faces and copies get a separate wall group',()=>{
 let s=shape();
 const ids=s.doc.entities.map(e=>e.id);
 s=updateProperties({...s,selection:[ids[0]]},{height:3.4});
 assert.ok(s.doc.entities.every(e=>e.height===3.4));
 assert.equal(multilinePreview(s.doc.entities).bands[0].height,3.4);
 s=startCommand({...s,selection:ids},'COPY');
 s=click(click(s,p(0,0)),p(10,0));
 assert.equal(new Set(s.doc.entities.map(e=>e.mlGroup)).size,2);
 assert.equal(multilinePreview(s.doc.entities).floors.length,2);
});

test('legacy ML fragments recover walls from their nearby faces without filling the space between them',()=>{
 const edge=(id,x,y1,y2,metadata={})=>({id,layer:'architecture',role:'line',type:'line',a:p(x,y1),b:p(x,y2),...metadata});
 const doc=newDocument();
 doc.entities=[
  edge('left',0,0,4,{mlGroup:'partition',mlSide:0,height:2.8}),
  edge('right',3,0,4,{mlGroup:'partition',mlSide:1,height:2.8}),
  edge('left-trimmed',-.2,0,4),
  edge('right-trimmed',3.2,0,4),
  edge('guide-a',8,0,4),edge('guide-b',8.2,0,4),
 ];
 const before=structuredClone(doc.entities);
 const scene=createPlanScene(doc);
 try{
  const walls=scene.children.filter(e=>e.userData.planRole==='multiline-wall').map(e=>new Box3().setFromObject(e));
  assert.equal(walls.length,2);
  for(const wall of walls){
   assert.ok(Math.abs(wall.max.x-wall.min.x-.2)<1e-6);
   assert.ok(Math.abs(wall.max.z-2.8)<1e-6);
  }
  assert.deepEqual(doc.entities,before);
 }finally{disposePlanScene(scene);}
});

test('recovered drafting edges do not cover an opening in a native wall host',()=>{
 const edge=(id,y,metadata={})=>({id,layer:'architecture',role:'line',type:'line',a:p(0,y),b:p(6,y),...metadata});
 const host={id:'host',layer:'architecture',role:'wall',type:'line',a:p(2,0),b:p(4,0),wallFromEdges:true,thickness:.2,height:3};
 const doc=newDocument();
 doc.entities=[
  host,
  {id:'door',layer:'architecture',type:'opening',kind:'door',wallId:'host',t:.5,width:.9,height:2.1},
  edge('remaining-face',-.1,{mlGroup:'partition',mlSide:0,mlThickness:.2}),
  edge('trimmed-face',.104),
 ];
 const {bands}=multilinePreview(doc.entities);
 assert.equal(bands.length,2);
 const intervals=bands.map(band=>[Math.min(...band.points.map(v=>v.x)),Math.max(...band.points.map(v=>v.x))]);
 assert.deepEqual(intervals,[[0,2],[4,6]]);
});
