import test from 'node:test';import assert from 'node:assert/strict';
import {resolveApsDocumentView} from '../src/lib/apsDocumentView.mjs';
import {selectApsGeometry} from '../src/lib/apsViewables.mjs';
const geometry={data:{type:'geometry',role:'2d',guid:'model-space'}};
test('populated tree wins over partial SDK search',()=>assert.equal(selectApsGeometry({children:[geometry],search:()=>[{data:{type:'resource',role:'metadata'}}]}),geometry));
test('failed derivative is not selected',()=>{
 const parent={data:{status:'failed'}},node={...geometry,parent};parent.children=[node];assert.equal(selectApsGeometry({children:[parent],search:()=>[node]}),null);
});
test('cached empty document recovers actual full-manifest geometry',async()=>{
 const manifest={status:'success',derivatives:[{children:[geometry.data]}]},original={getRoot:()=>({}),myPath:'path',acmSessionId:'session'},rebuilt={getRoot:()=>({children:[geometry]})};
 const r=await resolveApsDocumentView(original,{loadManifest:async()=>manifest,createDocument:(m,p,s)=>{assert.equal(m,manifest);assert.equal(p,'path');assert.equal(s,'session');return rebuilt;}});assert.equal(r.document,rebuilt);assert.equal(r.node,geometry);assert.equal(r.recovered,true);
});
test('native 3D avoids redundant network requests',async()=>{
 const node={data:{type:'geometry',role:'3d'}},document={getRoot:()=>({children:[node]})};const r=await resolveApsDocumentView(document,{loadManifest:()=>{throw Error('unexpected');}});assert.equal(r.document,document);assert.equal(r.node,node);
});
test('metadata-only success remains a failure with real diagnostics',async()=>{
 let built=false;await assert.rejects(resolveApsDocumentView({getRoot:()=>({})},{loadManifest:async()=>({status:'success',derivatives:[{children:[{type:'resource',role:'metadata'}],messages:[{message:'No drawing geometry'}]}]}),createDocument:()=>{built=true;}}),e=>e.code==='APS_NO_VIEWABLE_GEOMETRY'&&e.message.includes('No drawing geometry'));assert.equal(built,false);
});
test('Viewer loads the recovered SDK document',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm'),parser=await import('@babel/parser'),source=fs.readFileSync('src/app/components/ApsViewer.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']}),fn=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id?.name==='loadDocument');
 const original={getRoot:()=>({}),myPath:'path'},rebuilt={getRoot:()=>({children:[geometry]})},manifest={status:'success',derivatives:[{children:[geometry.data]}]};let loaded;
 const context=vm.createContext({window:{Autodesk:{Viewing:{Document:Object.assign(function(){return rebuilt;},{load:(urn,success)=>success(original)})}}},commercialFetch:async()=>({ok:true,json:async()=>({success:true,manifest})}),resolveApsDocumentView,isPlanCadUrn:()=>true,console:{info(){},log(){}}});vm.runInContext(source.slice(fn.start,fn.end),context);
 await context.loadDocument({impl:{},loadDocumentNode:async(d,n)=>{loaded={d,n};return {}; }},'model',()=>false);assert.equal(loaded.d,rebuilt);assert.equal(loaded.n,geometry);
});
