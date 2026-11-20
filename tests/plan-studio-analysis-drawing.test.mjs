import test from 'node:test';
import assert from 'node:assert/strict';
import {editorState,startCommand,submit} from '../src/lib/planStudio/controller.mjs';
import {analysisDrawingSVG,drawingMeasurementNotes} from '../src/lib/planStudio/analysisDrawing.mjs';
import {createPlanScene,disposePlanScene} from '../src/lib/planStudio/scene.mjs';

function draw(commands){
 let state=editorState();
 for(const text of commands)state=submit(state,text);
 return state;
}
test('the three QA plans retain authored wall dimensions in their analysis image and actual 3D geometry',()=>{
 for(const commands of [
  ['ML','0,0','600,0','600,400','0,400','C'],
  ['ML','0,0','1000,0','1000,800','0,800','C','ML','600,0','600,800',''],
  ['ML','0,0','800,0','800,400','400,400','400,800','0,800','C'],
 ]){
  const state=draw(commands),before=structuredClone(state.doc),rows=drawingMeasurementNotes(state.doc);
  assert.match(rows.join('\n'),/Height 3 m; thickness 0.2 m/);
  assert.match(rows.join('\n'),/wall closed centreline/);
  const svg=analysisDrawingSVG(state.doc);
  assert.match(svg,/DRAWING SPECIFICATIONS/);
  assert.match(svg,/All coordinates and dimensions below are in metres/);
  const root=createPlanScene(state.doc);
  try{assert.ok(root.children.some(m=>m.userData.planRole==='multiline-wall'));}
  finally{disposePlanScene(root);}
  assert.deepEqual(state.doc,before);
 }
});

test('the project image prints exact door and window sizes after multiline walls have been split',()=>{
 const state=draw(['ML','0,0','1000,0','1000,800','0,800','C','AD','300,0','WINDOW','1000,400']);
 const rows=drawingMeasurementNotes(state.doc).join('\n');
 assert.match(rows,/DOOR at .*width 0.9 m, height 2.1 m, sill 0 m/);
 assert.match(rows,/WINDOW at .*width 1.2 m, height 1.2 m, sill 0.9 m/);
 assert.match(rows,/Height 3 m; thickness 0.2 m/);
 assert.match(rows,/wall face path/);
 assert.match(rows,/\(0.1,7.9\)/);
 assert.match(rows,/\(10.1,8.1\)/);
});

test('drafting-only and hidden lines do not become measured walls in the image',()=>{
 let state=startCommand(editorState(),'ML');
 state={...state,options:{...state.options,section:{...state.options.section,multilinePurpose:'drafting'}}};
 for(const text of ['0,0','600,0','600,400','0,400','C'])state=submit(state,text);
 assert.deepEqual(drawingMeasurementNotes(state.doc),[]);
 const walls=draw(['ML','0,0','600,0','600,400','0,400','C']).doc;
 walls.layers=walls.layers.map(layer=>({...layer,visible:false}));
 assert.deepEqual(drawingMeasurementNotes(walls),[]);
});
