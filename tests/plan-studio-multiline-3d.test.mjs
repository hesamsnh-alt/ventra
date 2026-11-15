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
