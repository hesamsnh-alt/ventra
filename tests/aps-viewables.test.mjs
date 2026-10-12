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
