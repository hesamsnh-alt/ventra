import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pixelCandidateRolesSchema,normalizePixelCandidateRoles} from '../src/lib/rasterCandidateRoles.mjs';
import {pixelWallClassificationSchema,validatePixelClassification} from '../src/lib/rasterGraphPipeline.mjs';
const {graph}=JSON.parse(fs.readFileSync(new URL('./fixtures/pixel-classification-rejection-v140.json',import.meta.url)));
const conflict=JSON.parse(fs.readFileSync(new URL('./fixtures/pixel-classification-conflict-v141.json',import.meta.url)));
test('the real v141 conflict is not silently resolved by preferring walls or furniture',()=>{
 assert.ok(conflict.walls.some(c=>c.candidateId==='solid_band5'));
 assert.ok(conflict.nonWalls.some(c=>c.candidateId==='solid_band5'&&c.reason==='furniture'));
 assert.equal(normalizePixelCandidateRoles(graph,conflict),conflict);
 assert.throws(()=>validatePixelClassification(graph,conflict),{code:'INVALID_PIXEL_SELECTION'});
});
test('wire schema has one required scalar role per measured ID and no independent wall/non-wall lists',()=>{
 const schema=pixelWallClassificationSchema(graph),roles=schema.properties.candidateRoles;
 assert.equal(schema.properties.walls,undefined);assert.equal(schema.properties.nonWalls,undefined);
 assert.equal(roles.additionalProperties,false);assert.equal(roles.required.length,330);
 for(const id of roles.required)assert.equal(roles.properties[id].$ref,'#/$defs/pixelCandidateRole');
 assert.equal(schema.$defs.pixelCandidateRole.type,'string');assert.ok(schema.$defs.pixelCandidateRole.enum.includes('unresolved'));
 assert.deepEqual(roles,pixelCandidateRolesSchema(graph));
});
test('maximum source budget reuses the role enum within Structured Outputs enum limits',()=>{
 const maximum={candidates:Array.from({length:700},(_,i)=>({id:`c${i}`})),gaps:Array.from({length:700},(_,i)=>({id:`g${i}`}))};
 const schema=pixelWallClassificationSchema(maximum);
 const count=node=>!node||typeof node!=='object'?0:(node.enum?.length||0)+Object.values(node).reduce((sum,value)=>sum+(typeof value==='object'?count(value):0),0);
 assert.ok(count(schema)<=1000);assert.ok(JSON.stringify(schema).length<120000);
});
const small={candidates:[{id:'wall'},{id:'symbol'},{id:'alternative'}]};
const good={complete:true,candidateRoles:{wall:'internal_wall',symbol:'furniture',alternative:'alternative_face'}};
test('one role map converts to disjoint compiler collections without changing the model decision',()=>{
 const before=JSON.stringify(good),result=normalizePixelCandidateRoles(small,good);
 assert.deepEqual(result.walls,[{candidateId:'wall',type:'internal'}]);
 assert.deepEqual(result.nonWalls,[{candidateId:'symbol',reason:'furniture'},{candidateId:'alternative',reason:'alternative_face'}]);
 assert.deepEqual(result.unresolvedCandidateIds,[]);assert.equal(JSON.stringify(good),before);
});
test('incomplete, invented, multi-valued and mixed-format roles remain rejected',()=>{
 for(const value of [
  {...good,candidateRoles:{wall:'internal_wall'}},
  {...good,candidateRoles:{...good.candidateRoles,alternative:'guess'}},
  {...good,candidateRoles:{wall:'internal_wall',symbol:'furniture',invented:'alternative_face'}},
  {...good,candidateRoles:{...good.candidateRoles,wall:['internal_wall','furniture']}},
  {...good,walls:[{candidateId:'symbol',type:'internal'}]},
 ])assert.throws(()=>normalizePixelCandidateRoles(small,value),{code:'INVALID_PIXEL_SELECTION'});
});
test('an unresolved role cannot be hidden behind complete=true',()=>{
 const result=normalizePixelCandidateRoles(small,{...good,candidateRoles:{...good.candidateRoles,wall:'unresolved'}});
 assert.throws(()=>validatePixelClassification(small,result),{code:'INCOMPLETE_PIXEL_CLASSIFICATION'});
});
