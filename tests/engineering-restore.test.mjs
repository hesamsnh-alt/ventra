import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileEngineering,restoreEngineeringSnapshot} from '../src/lib/engineeringRestore.mjs';

const record=(urn,time,geometry={})=>({aps_urn:urn,source:'autodesk-aps',analyzed_at:time,geometry});
const old=record('old','2026-10-10T12:00:00Z');
const fresh=record('new','2026-10-11T12:00:00Z');
test('older cloud source cannot replace a freshly uploaded DWG',()=>{
 assert.equal(reconcileEngineering(fresh,old),fresh);
});
test('another device restores newer cloud DWG and does not merge old geometry',()=>{
 assert.equal(reconcileEngineering(old,fresh),fresh);
 assert.equal(reconcileEngineering(null,fresh),fresh);
});
test('same DWG retains full calibrated wall evidence over a newer placeholder',()=>{
 const full=record('new','2026-10-10T12:00:00Z',{meterFactor:0.001,wallLineSegments:[{dbId:1}]});
 assert.equal(reconcileEngineering(fresh,full),full);
});
test('missing or ambiguous remote timestamps do not switch local source',()=>{
 assert.equal(reconcileEngineering(fresh,{aps_urn:'old'}),fresh);
 assert.equal(reconcileEngineering(record('new',null),record('old',null)).aps_urn,'new');
});
test('cloud restore re-reads local state after the request rather than restoring its stale snapshot',async()=>{
 let stored=fresh;const writes=[];
 const result=await restoreEngineeringSnapshot('project',old,{
  read:async()=>stored,persist:async(id,value)=>{writes.push(value);stored=value;}
 });
 assert.equal(result,fresh);assert.equal(writes.length,0);
});
test('cloud restore persists selected cloud record and preserves source identity',async()=>{
 let stored=old;
 const result=await restoreEngineeringSnapshot('project',fresh,{
  read:async()=>stored,persist:async(id,value,options)=>{assert.equal(options.kind,'engineering');stored=value;}
 });
 assert.equal(result,stored);assert.equal(stored.aps_urn,'new');
});
