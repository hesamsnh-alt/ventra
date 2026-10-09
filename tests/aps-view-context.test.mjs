import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import vm from 'node:vm';

test('Loaded APS view metadata reaches room extraction after document-load block has ended',async()=>{
 const source=readFileSync('src/app/components/ApsViewer.jsx','utf8');
 const ast=parse(source,{sourceType:'module',plugins:['jsx']});const calls=[];
 function visit(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee?.name==='ventraExtractApsRoomLabels')calls.push(node);for(const key in node){if(['loc','start','end'].includes(key))continue;const value=node[key];if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
 visit(ast);assert.equal(calls.length,1);
 for(const is2d of [true,false]){
  // loadedDocument intentionally does not exist here: it is block-scoped.
  const args=await vm.runInNewContext(`(async()=>await ${source.slice(calls[0].start,calls[0].end)})()`,{model:{is2d:()=>is2d},objects:[],properties:[],geometry:{},urn:'source-urn',currentViewGuid:'loaded-guid',currentViewName:'Actual loaded floor',ventraExtractApsRoomLabels:async args=>args});
  assert.equal(args.viewName,'Actual loaded floor');assert.equal(args.viewGuid,'loaded-guid');assert.equal(args.viewRole,is2d?'2d':'3d');
 }
});
