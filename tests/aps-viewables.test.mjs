import test from 'node:test';import assert from 'node:assert/strict';
import {apsGeometryNodes,selectApsGeometry,apsManifestGeometry,isPlanCadUrn} from '../src/lib/apsViewables.mjs';
test('DWG loads a real 2D geometry even when SDK default is absent or a 3D view exists',()=>{
 const two={data:{type:'geometry',role:'2d',name:'Model'}},three={data:{type:'geometry',role:'3d'}};
 const root={search:()=>[three,two],getDefaultGeometry:()=>null};assert.equal(selectApsGeometry(root),two);assert.equal(selectApsGeometry(root,{prefer2D:false}),three);
});
test('missing search falls back to recursive model/layout geometry; excludes failed nodes',()=>{
 const two={data:{type:'geometry',role:'2d'}},failed={data:{type:'geometry',role:'3d',status:'failed'}};
 assert.deepEqual(apsGeometryNodes({children:[{children:[failed,two]}],getDefaultGeometry(){throw new Error('missing default');}}),[two]);
 assert.equal(selectApsGeometry({children:[],getDefaultGeometry:()=>null}),null);
});
test('metadata-only successful translation is not a drawable model, errors retain useful diagnostics',()=>{
 const m={status:'success',derivatives:[{status:'success',children:[{type:'resource',role:'metadata'}],messages:[{message:'No valid model geometry'}]}]};
 const check=apsManifestGeometry(m);assert.equal(check.views.length,0);assert.equal(check.messages[0],'No valid model geometry');
 const good={status:'success',derivatives:[{children:[{type:'geometry',role:'2d',guid:'floor-1'},{type:'geometry',role:'3d',status:'failed'}]}]};assert.equal(apsManifestGeometry(good).views.length,1);
});
test('cancelled or wrong-document extraction is rejected before expensive analysis begins',async()=>{
 const [{readFileSync},vm,parser]=await Promise.all([import('node:fs'),import('node:vm'),import('@babel/parser')]);
 const source=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let fn;
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name==='handleApsGeometryExtracted')fn=n;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(ast);
 const context=vm.createContext({takeoffResultRef:{current:{source:'autodesk-aps',aps_urn:'new',document_id:'new-document'}},selectedDocumentId:'new-document',console:{warn(){}}});
 vm.runInContext(source.slice(fn.start,fn.end),context);
 // No geometry/AI helpers are supplied: reaching either stage would fail the test.
 await context.handleApsGeometryExtracted({apsUrn:'old'});
 context.selectedDocumentId='other-document';await context.handleApsGeometryExtracted({apsUrn:'new'});
});

test('only DWG and DXF extraction prefer sheets; IFC and RVT retain native 3D priority',()=>{
 for(const ext of ['dwg','dxf','ifc','rvt']){const urn=Buffer.from(`urn:adsk.objects:os.object:bucket/owner%2Fproject%2Fplan.${ext}`).toString('base64url');assert.equal(isPlanCadUrn(urn),['dwg','dxf'].includes(ext));}
 assert.equal(isPlanCadUrn('garbage'),false);
});

test('CAD model space wins over an earlier blank paper layout',()=>{
 const layout={data:{type:'geometry',role:'2d',name:'Layout1'}},model={data:{type:'geometry',role:'2d',name:'Model'}};
 assert.equal(selectApsGeometry({children:[layout,model]}),model);
});
test('CAD model space can be named on a parent SDK view node',()=>{
 const parent={data:{name:'*Model_Space'}},model={data:{type:'geometry',role:'2d',name:'Top'},parent},layout={data:{type:'geometry',role:'2d',name:'Layout1'}};parent.children=[model];
 assert.equal(selectApsGeometry({children:[layout,parent]}),model);
});
test('a partial SDK search cannot hide a model-space default behind a sheet',()=>{
 const layout={data:{type:'geometry',role:'2d',name:'Layout1'}},model={data:{type:'geometry',role:'2d',name:'Model'}};
 assert.equal(selectApsGeometry({search:()=>[layout],getDefaultGeometry:()=>model}),model);
});
test('native 3D priority and sheet-only drawings remain loadable',()=>{
 const sheet={data:{type:'geometry',role:'2d',name:'Sheet1'}},model={data:{type:'geometry',role:'2d',name:'Model'}},native={data:{type:'geometry',role:'3d',name:'Default'}};
 assert.equal(selectApsGeometry({children:[sheet,model,native]},{prefer2D:false}),native);
 assert.equal(selectApsGeometry({children:[sheet]}),sheet);
});
test('a Layout child does not inherit model-space identity from its generic parent',()=>{
 const parent={data:{name:'Model'}},sheet={data:{type:'geometry',role:'2d',name:'Layout1'},parent},actual={data:{type:'geometry',role:'2d',name:'*Model_Space'}};parent.children=[sheet];
 assert.equal(selectApsGeometry({children:[parent,actual]}),actual);
});

test('actual project 3D initialization uses Model space for DXF and native 3D for IFC',async()=>{
 const [{readFileSync},vm,parser]=await Promise.all([import('node:fs'),import('node:vm'),import('@babel/parser')]);
 const source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let initializer;
 function visit(n){if(!n||typeof n!=='object')return;if(n.type==='VariableDeclarator'&&n.id?.name==='preferredIndex')initializer=n.init;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(ast);assert.ok(initializer);
 const sheet={data:{type:'geometry',role:'2d',name:'Layout1'}},model={data:{type:'geometry',role:'2d',name:'Model'}},native={data:{type:'geometry',role:'3d',name:'3D'}};
 const available=[sheet,model,native].map((node,index)=>({node,index,is3D:node===native}));
 for(const [ext,expected]of [['dxf',1],['dwg',1],['ifc',2],['rvt',2]]){
  const context=vm.createContext({available,doc:{getRoot:()=>({children:[sheet,model,native]})},urn:Buffer.from(`urn:adsk.objects:os.object:bucket/file.${ext}`).toString('base64url'),selectApsGeometry,isPlanCadUrn});
  assert.equal(vm.runInContext(source.slice(initializer.start,initializer.end),context),expected);
 }
});
