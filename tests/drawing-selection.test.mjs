import test from 'node:test';import assert from 'node:assert/strict';
import {resolveDrawingSelection,schematicRequestKey,isSelectedApsDrawing} from '../src/lib/drawingSelection.mjs';
import {selectDrawingDocument,selectedDrawingSync,drawingSceneMatches} from '../src/lib/schematicStorage.mjs';
const docs=[{id:'cad'},{id:'image'}];
test('remount preserves image selection despite an older CAD takeoff',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 selectDrawingDocument('remount','image',storage);const id=resolveDrawingSelection(docs,selectedDrawingSync('remount',storage),'cad');assert.equal(id,'image');selectDrawingDocument('remount',id,storage);assert.ok(drawingSceneMatches('remount',{documentId:'image'},storage));
});
test('genuine CAD switch rejects late image output',()=>{
 const storage={getItem:()=>null,setItem(){}};selectDrawingDocument('switch','image',storage);assert.ok(drawingSceneMatches('switch',{documentId:'image'},storage));selectDrawingDocument('switch','cad',storage);assert.equal(drawingSceneMatches('switch',{documentId:'image'},storage),false);
});
test('quota does not replace current selection with old stored ID',()=>{
 const storage={getItem:()=> 'old',setItem(){throw Error('quota');}};selectDrawingDocument('quota','image',storage);assert.equal(selectedDrawingSync('quota',storage),'image');assert.ok(drawingSceneMatches('quota',{documentId:'image'},storage));
});
test('deleted selections fall back safely',()=>{assert.equal(resolveDrawingSelection(docs,'deleted','cad'),'cad');assert.equal(resolveDrawingSelection([{id:'one'}],null,null),'one');assert.equal(resolveDrawingSelection(docs,null,null),null);});
test('coalescing is isolated by project',()=>assert.notEqual(schematicRequestKey('a',{id:'same'}),schematicRequestKey('b',{id:'same'})));

test('an old CAD preview is not mounted behind the selected JPG or a different CAD',()=>{
 const takeoff={source:'autodesk-aps',aps_urn:'urn',document_id:'cad'};
 assert.equal(isSelectedApsDrawing(takeoff,{id:'image',file_name:'plan.jpg'}),false);
 assert.equal(isSelectedApsDrawing(takeoff,{id:'other-cad',file_name:'plan.dwg'}),false);
 assert.equal(isSelectedApsDrawing(takeoff,{id:'cad',file_name:'plan.dwg'}),true);
});
