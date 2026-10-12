import {engineeringUrn,chooseEngineeringTakeoff} from './sceneStyle.mjs';

const timestamp=value=>Math.max(0,...['analyzed_at','updated_at','created_at'].map(key=>{
 const parsed=Date.parse(value?.[key]);return Number.isFinite(parsed)?parsed:0;
}));

// Choose a whole source record. Never borrow geometry or scale from another DWG.
export function reconcileEngineering(local,remote){
 if(!engineeringUrn(local))return engineeringUrn(remote)?remote:null;
 if(!engineeringUrn(remote))return local;
 if(engineeringUrn(local)===engineeringUrn(remote))return chooseEngineeringTakeoff(local,remote);
 return timestamp(remote)>timestamp(local)?remote:local;
}

export async function restoreEngineeringSnapshot(projectId,remote,{read,persist}){
 // Read after the network request: an upload may have completed during that request.
 const local=await read(projectId,'engineering');
 const selected=reconcileEngineering(local,remote);
 if(selected&&selected!==local)await persist(projectId,selected,{kind:'engineering'});
 return selected;
}
