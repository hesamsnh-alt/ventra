import {assertTakeoffReady} from '../src/lib/takeoffSource.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import parser from '@babel/parser';
const source=readFileSync(new URL('../src/app/projects/[id]/ProjectQuotation.jsx',import.meta.url),'utf8');
const tree=parser.parse(source,{sourceType:'module',plugins:['jsx']});
let declaration;
function find(node) {
  if (!node||typeof node!=='object') return;
  if(node.type==='FunctionDeclaration'&&node.id?.name==='refreshEstimate') declaration=node;
  for(const [key,value] of Object.entries(node)) {
    if(['loc','start','end'].includes(key))continue;
    if(Array.isArray(value))value.forEach(find);else if(value&&typeof value==='object')find(value);
  }
}
find(tree);
assert.ok(declaration);
function harness(raw,sourceBoq=null) {
  const errors=[],success=[],estimates=[],writes=[];
  const window={localStorage:{getItem:key=>key.includes('project-boq')?sourceBoq:raw,setItem:(...a)=>writes.push(a)},requestAnimationFrame:fn=>fn()};
  const create=new Function('window','projectId','setBusyAction','setErrorMessage','setStatusMessage','setEstimate','setRefreshNonce','markError','markSuccess','money','console','assertTakeoffReady',
    source.slice(declaration.start,declaration.end)+';return refreshEstimate;');
  const noop=()=>{};
  return {errors,success,estimates,writes,refresh:create(window,'qa-project',noop,noop,noop,v=>estimates.push(v),noop,v=>errors.push(v),v=>success.push(v),v=>String(v),{log(){}},assertTakeoffReady)};
}
test('automatic refresh does not report missing estimate as a broken manual quotation',()=>{
  const h=harness(null);assert.equal(h.refresh({automatic:true}),false);assert.deepEqual(h.errors,[]);assert.deepEqual(h.success,[]);
});
test('explicit refresh still explains why no saved estimate can be loaded',()=>{
  const h=harness(null);assert.equal(h.refresh(),false);assert.match(h.errors[0],/no saved Estimate/);
});
test('malformed or nonfinite estimate totals never become a successful refresh',()=>{
  for(const raw of ['{', '{}', '{"finalTender":"invalid"}', '{"finalTender":"Infinity"}', '{"finalTender":0}', '{"finalTender":-1}']) {
    const h=harness(raw);assert.equal(h.refresh({automatic:true}),false);
    assert.equal(h.errors.length,1);assert.equal(h.success.length,0);assert.equal(h.writes.length,0);
  }
});
test('valid saved estimate refresh keeps its amount and records the successful read',()=>{
  const h=harness(JSON.stringify({finalTender:1050,basis:'boq',tenderBeforeVat:1000,vat:50}));
  assert.equal(h.refresh(),true);assert.equal(h.estimates.at(-1).finalTender,1050);assert.equal(h.errors.length,0);assert.equal(h.success.length,1);assert.equal(h.writes.length,1);
});

test('a legacy priced estimate cannot refresh from translation-only CAD source',()=>{
 const h=harness(JSON.stringify({finalTender:58829.63,basis:'boq'}),JSON.stringify({takeoff:{source:'autodesk-aps',extraction_status:'translation-complete'}}));
 assert.equal(h.refresh(),false);assert.match(h.errors[0],/quantity extraction is incomplete/);
 assert.equal(h.estimates.at(-1),null);assert.equal(h.success.length,0);assert.equal(h.writes.length,0);
});
