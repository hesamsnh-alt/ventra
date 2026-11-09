// A candidate can have only one semantic role. Separate wall/non-wall arrays
// let the live classifier place the same ID in both collections.
export const PIXEL_CANDIDATE_ROLES=['external_wall','internal_wall','alternative_face','furniture','door_symbol','window_symbol','text','dimension','noise','unresolved'];
export function pixelCandidateRolesSchema(graph){
 const ids=graph.candidates.map(c=>c.id);
 return{type:'object',properties:Object.fromEntries(ids.map(id=>[id,{$ref:'#/$defs/pixelCandidateRole'}])),required:ids,additionalProperties:false};
}
export function normalizePixelCandidateRoles(graph,selection){
 // Retain read compatibility with previously saved diagnostic selections;
 // they still pass through all the original ID/conflict/topology checks.
 if(!Object.hasOwn(selection,'candidateRoles'))return selection;
 const roles=selection.candidateRoles,ids=new Set(graph.candidates.map(c=>c.id));
 const invalid=()=>{throw Object.assign(Error('Every source candidate needs exactly one recognized role.'),{code:'INVALID_PIXEL_SELECTION'});};
 if(!roles||typeof roles!=='object'||Array.isArray(roles)||Object.keys(roles).length!==ids.size)invalid();
 if(['walls','nonWalls','unresolvedCandidateIds'].some(k=>Object.hasOwn(selection,k)))invalid();
 const walls=[],nonWalls=[],unresolvedCandidateIds=[];
 for(const [candidateId,role]of Object.entries(roles)){
  if(!ids.has(candidateId)||!PIXEL_CANDIDATE_ROLES.includes(role))invalid();
  if(role==='external_wall'||role==='internal_wall')walls.push({candidateId,type:role==='external_wall'?'external':'internal'});
  else if(role==='unresolved')unresolvedCandidateIds.push(candidateId);
  else nonWalls.push({candidateId,reason:role});
 }
 return{...selection,walls,nonWalls,unresolvedCandidateIds};
}
