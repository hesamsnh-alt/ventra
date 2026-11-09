import test from 'node:test';
import assert from 'node:assert/strict';
import {PIXEL_CANDIDATE_ROLES,pixelCandidateRolesSchema,normalizePixelCandidateRoles} from '../src/lib/rasterCandidateRoles.mjs';
import {compactPixelClassificationInput,validateSourceBandCoverage} from '../src/lib/rasterClassificationInput.mjs';
const graph={
 imageWidth:200,imageHeight:120,
 ink:[{id:'ink1',start:{x:10,y:10},end:{x:150,y:10}}],
 candidates:[
  {id:'ink1',kind:'stroke',start:{x:10,y:10},end:{x:150,y:10},sourceIds:['ink1']},
  {id:'ink2',kind:'stroke',start:{x:10,y:30},end:{x:150,y:30},sourceIds:['ink2']},
  {id:'solid_band1',kind:'solid_band',start:{x:10,y:10},end:{x:150,y:10},sourceIds:['solid_band1','ink1'],thicknessPixels:8}
 ],
 gaps:[{id:'gap1',start:{x:60,y:10},end:{x:80,y:10},support:'opening_hypothesis_not_wall'}]
};
const roles={ink1:'alternative_face',ink2:'internal_wall',solid_band1:'external_wall'};
test('role schema requires every candidate exactly once',()=>{
 const schema=pixelCandidateRolesSchema(graph);
 assert.deepEqual(schema.required,['ink1','ink2','solid_band1']);
 assert.equal(schema.additionalProperties,false);
 assert.deepEqual(Object.keys(schema.properties),schema.required);
 assert.deepEqual(PIXEL_CANDIDATE_ROLES.includes('unresolved'),true);
});
test('one role map yields non-overlapping wall and non-wall lists',()=>{
 const r=normalizePixelCandidateRoles(graph,{complete:true,candidateRoles:roles});
 assert.equal(r.walls.length,2);
 assert.equal(r.nonWalls.length,1);
 assert.equal(new Set([...r.walls,...r.nonWalls].map(x=>x.candidateId)).size,3);
});
test('unresolved candidates remain explicitly unresolved',()=>{
 const r=normalizePixelCandidateRoles(graph,{candidateRoles:{...roles,ink2:'unresolved'}});
 assert.deepEqual(r.unresolvedCandidateIds,['ink2']);
});
for(const [name,candidateRoles] of [
 ['missing ID',{ink1:'noise',ink2:'internal_wall'}],
 ['invented ID',{...roles,fake:'external_wall'}],
 ['invalid role',{...roles,ink2:'wall'}],
 ['multiple role',{...roles,ink2:['internal_wall','noise']}],
 ['null value',null],
 ['array value',[]]
])test('invalid role map rejected: '+name,()=>assert.throws(()=>normalizePixelCandidateRoles(graph,{candidateRoles}),{code:'INVALID_PIXEL_SELECTION'}));
test('cannot mix role map with contradictory legacy walls',()=>{
 assert.throws(()=>normalizePixelCandidateRoles(graph,{candidateRoles:roles,walls:[{candidateId:'ink2',type:'external'}]}),{code:'INVALID_PIXEL_SELECTION'});
});
test('explicit thick wall is considered covered',()=>{
 const s=normalizePixelCandidateRoles(graph,{candidateRoles:roles});
 assert.deepEqual(validateSourceBandCoverage(graph,s),[]);
});
test('unreviewed solid wall remains uncovered',()=>{
 const s=normalizePixelCandidateRoles(graph,{candidateRoles:{...roles,solid_band1:'unresolved',ink1:'noise'}});
 assert.deepEqual(validateSourceBandCoverage(graph,s),['solid_band1']);
});
test('compact source data retains full-image coordinates and door observations',()=>{
 const input=compactPixelClassificationInput(graph,{doors:[{id:'door1'}]});
 assert.deepEqual(input.imageFrame,{width:200,height:120,coordinateSpace:'full_source_pixels'});
 assert.equal(input.candidates.length,3);
 assert.equal(input.sourceDoors.length,1);
 assert.equal(input.gaps.length,1);
 assert.equal(input.requiredSourceBandIds.includes('solid_band1'),true);
});
test('role definitions stay within bounded schema enum',()=>{
 assert.ok(PIXEL_CANDIDATE_ROLES.length<=10);
});
