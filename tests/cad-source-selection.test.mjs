import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import parser from '@babel/parser';
import {drawingSourceBinding} from '../src/lib/pdfPlanScene.mjs';
import {selectDrawingDocument,selectedDrawingDetailsSync,selectedDrawingSync} from '../src/lib/schematicStorage.mjs';
import {chooseEngineeringTakeoff,engineeringUrn} from '../src/lib/sceneStyle.mjs';
const storage=()=>{const values=new Map();return{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
for(const extension of ['dxf','dwg','ifc','rvt'])test(`${extension} stays on APS when geometry is absent or belongs to another drawing`,()=>{
 for(const engineering of [null,{document_id:'other',aps_urn:'other-urn'}]){
  const out=drawingSourceBinding({selectedDocumentId:'chosen',selectedDocumentName:`plan.${extension}`,source:'schematic',engineering,scene:{documentId:'old-image'}});assert.equal(out.source,'aps');assert.equal(out.engineeringAllowed,false);assert.equal(out.scene,null);
 }
});
test('an explicit legacy APS request with no model does not become an image request',()=>{const out=drawingSourceBinding({selectedDocumentId:'cad',source:'aps',engineering:null});assert.equal(out.source,'aps');assert.equal(out.engineeringAllowed,false);});
test('a stale cloud image selection cannot hide the matching selected CAD model',()=>{
 const out=drawingSourceBinding({selectedDocumentId:'cad',selectedDocumentName:'drawing.DXF',engineering:{document_id:'cad',aps_urn:'cad-urn'},source:'schematic',scene:{documentId:'old-image'}});assert.equal(out.source,'aps');assert.equal(out.engineeringAllowed,true);assert.equal(out.scene,null);
});
for(const extension of ['pdf','jpg','png','webp'])test(`${extension} cannot restore another drawing's CAD model`,()=>{
 const scene={documentId:'image'},out=drawingSourceBinding({selectedDocumentId:'image',selectedDocumentName:`plan.${extension}`,engineering:{document_id:'cad',aps_urn:'other-urn'},source:'aps',scene});assert.equal(out.source,'schematic');assert.equal(out.engineeringAllowed,false);assert.equal(out.scene,scene);
});
test('matching DWG interior geometry remains available',()=>{
 const scene={documentId:'cad',source:'dwg-engineering-interior'},out=drawingSourceBinding({selectedDocumentId:'cad',selectedDocumentName:'plan.dwg',engineering:{document_id:'cad',aps_urn:'cad-urn'},source:'dwg-interior',scene});assert.equal(out.source,'dwg-interior');assert.equal(out.scene,scene);assert.equal(out.engineeringAllowed,true);
});
test('selection metadata stays with its exact document and clears on an untyped switch',()=>{
 const s=storage();selectDrawingDocument('metadata','cad',s,'plan.dxf');assert.deepEqual(selectedDrawingDetailsSync('metadata',s),{documentId:'cad',fileName:'plan.dxf'});selectDrawingDocument('metadata','cad',s);assert.equal(selectedDrawingDetailsSync('metadata',s).fileName,'plan.dxf');selectDrawingDocument('metadata','image',s);assert.equal(selectedDrawingDetailsSync('metadata',s),null);selectDrawingDocument('metadata','image',s,'plan.jpg');assert.equal(selectedDrawingDetailsSync('metadata',s).fileName,'plan.jpg');selectDrawingDocument('metadata',null,s);assert.equal(selectedDrawingDetailsSync('metadata',s),null);
});
test('storage quota preserves current CAD identity and filename in the session',()=>{
 const s={getItem:()=>null,setItem(){throw Error('quota');},removeItem(){throw Error('quota');}};selectDrawingDocument('quota-cad','cad',s,'plan.dxf');assert.equal(selectedDrawingSync('quota-cad',s),'cad');assert.equal(selectedDrawingDetailsSync('quota-cad',s).fileName,'plan.dxf');
});
const source=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
function find(node,name){if(!node||typeof node!=='object')return null;if(node.type==='FunctionDeclaration'&&node.id?.name===name)return node;for(const value of Object.values(node)){if(Array.isArray(value)){for(const item of value){const found=find(item,name);if(found)return found;}}else if(value&&typeof value==='object'){const found=find(value,name);if(found)return found;}}return null;}
const refresh=find(ast,'refreshProject3DSourceFromStorage');
test('actual viewer refresh retains selected DXF despite stale image preference and missing geometry',()=>{
 const state={},context=vm.createContext({projectId:'p',window:{},readTakeoffSync:()=>null,readSchematicSync:()=>({documentId:'old-image',width:10,depth:5}),selectedDrawingSync:()=> 'cad',selectedDrawingDetailsSync:()=>({documentId:'cad',fileName:'plan.dxf'}),drawingSceneMatches:()=>false,activeSourceSync:()=> 'schematic',chooseEngineeringTakeoff,engineeringUrn,drawingSourceBinding,
  setStatus:v=>state.status=v,setMessage:v=>state.message=v,setTakeoff:v=>state.takeoff=v,setSchematicScene:v=>state.scene=v,setUrn:v=>state.urn=v,setActive3DSource:v=>state.source=v,console:{log(){},error(e){throw e;}}});
 vm.runInContext(source.slice(refresh.start,refresh.end)+';refreshProject3DSourceFromStorage();',context);
 assert.equal(state.source,'aps');assert.equal(state.scene,null);assert.equal(state.urn,'');assert.equal(state.status,'missing');assert.match(state.message,/CAD drawing/);assert.match(state.message,/APS without AI/);
});
