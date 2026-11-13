import {resolveDwgCalibration} from './dwgCalibration.mjs';
import {createDrawingIndexedRecords} from './drawingIndexedRecords.mjs';
// Full geometry lives in IndexedDB; localStorage carries a small compatibility
// summary. Engineering and latest pointers share one stored CAD record.
const cache=new Map();const writes=new Map();
const rootKey=id=>`ventra:project-takeoff:${id}`,engKey=id=>`ventra:project-engineering-takeoff:${id}`;
const archiveKey=(id,documentId)=>`${id}:engineering:document:${encodeURIComponent(documentId)}`;
const isEngineering=t=>!!(t?.aps_urn||t?.apsUrn||t?.urn||t?.advanced_takeoff?.aps_urn||t?.raw_result?.aps_urn)&&!/image|raster/i.test(t?.source||'')&&!/^(jpg|jpeg|png|webp)$/i.test(t?.document_type||'');
const local=()=>typeof window!=='undefined'?window.localStorage:null;
export const indexedTakeoffRecords=createDrawingIndexedRecords();
export function compactTakeoff(takeoff,recordKey){
 const out={};for(const [k,v]of Object.entries(takeoff||{}))if(v===null||['number','boolean'].includes(typeof v)||typeof v==='string'&&!v.startsWith('data:')&&v.length<4000)out[k]=v;
 out.geometry={};for(const [k,v]of Object.entries(takeoff?.geometry||{}))if(typeof v==='number'||typeof v==='string'&&v.length<100)out.geometry[k]=v;
 if(takeoff?.pdf_analysis)out.pdf_analysis={version:takeoff.pdf_analysis.version,summaryOnly:true,total_pages:takeoff.pdf_analysis.total_pages,quantity_evidence:{}};
 out.__ventraTakeoffRecord=recordKey;out.__geometryStoredInIndexedDB=true;return out;
}
function parse(storage,key){try{return JSON.parse(storage?.getItem(key)||'null');}catch{return null;}}
export function readTakeoffSync(id,kind='latest',storage=local(),documentId=null){
 if(kind==='engineering'&&documentId){const value=cache.get(archiveKey(id,documentId))||readTakeoffSync(id,kind,storage);return value?.document_id===documentId?value:null;}
 const key=kind==='engineering'?engKey(id):rootKey(id),value=parse(storage,key);
 if(cache.has(`${id}:${kind}`))return cache.get(`${id}:${kind}`);
 if(value?.__ventraTakeoffRecord&&cache.has(value.__ventraTakeoffRecord))return cache.get(value.__ventraTakeoffRecord);
 return cache.get(`${id}:${kind}`)||value;
}
async function persistRecord(id,takeoff,{kind='latest',storage=local(),records=indexedTakeoffRecords}={}){
 if(!id||!takeoff)return null;
 const engineering=isEngineering(takeoff),recordKey=`${id}:${engineering?'engineering':'raster'}`;
 const entries=[[recordKey,takeoff]];
 if(engineering&&takeoff.document_id){
  const key=archiveKey(id,takeoff.document_id),indexKey=`${id}:document-records`,index=await records.get(indexKey)||[];
  const previous=await records.get(recordKey);
  if(previous?.document_id&&previous.document_id!==takeoff.document_id){const priorKey=archiveKey(id,previous.document_id);if(!await records.get(priorKey))entries.push([priorKey,previous]);index.push(priorKey);}
  entries.push([key,takeoff],[indexKey,[...new Set([...index,key])]]);
 }
 if(kind==='latest')entries.push([`${id}:latest-pointer`,{recordKey}]);
 if(records.putMany)await records.putMany(entries);
 else for(const [key,value] of entries)await records.put(key,value);
 cache.set(recordKey,takeoff);cache.set(`${id}:${kind}`,takeoff);if(engineering)cache.set(`${id}:engineering`,takeoff);
 if(engineering&&takeoff.document_id)cache.set(archiveKey(id,takeoff.document_id),takeoff);
 const summary=JSON.stringify(compactTakeoff(takeoff,recordKey));
 const keys=kind==='engineering'?[engKey(id)]:engineering?[engKey(id),rootKey(id)]:[rootKey(id)];
 for(const key of keys){try{storage?.setItem(key,summary);}catch(error){
  // Only replace this project's migrated records. Never clear all site storage.
  if(error?.name!=='QuotaExceededError')throw error;
  storage.removeItem(key);try{storage.setItem(key,summary);}catch{}
 }}
 return takeoff;
}
// Serialize writes for a project so older extracts cannot finish after newer ones.
export function persistTakeoff(id,takeoff,options={}){
 if(!id||!takeoff)return Promise.resolve(null);
 const previous=writes.get(id)||Promise.resolve();
 const task=previous.catch(()=>{}).then(()=>persistRecord(id,takeoff,options));
 writes.set(id,task);task.finally(()=>{if(writes.get(id)===task)writes.delete(id);}).catch(()=>{});
 return task;
}
export async function readPersistedTakeoff(id,kind='latest',{storage=local(),records=indexedTakeoffRecords,documentId=null}={}){
 if(writes.has(id))await writes.get(id).catch(()=>{});
 if(kind==='engineering'&&documentId){
  const scoped=await records.get(archiveKey(id,documentId));
  if(scoped?.document_id===documentId){cache.set(archiveKey(id,documentId),scoped);return scoped;}
  const legacy=await readPersistedTakeoff(id,kind,{storage,records});
  if(legacy?.document_id!==documentId)return null;
  await persistTakeoff(id,legacy,{kind,storage,records});return legacy;
 }
 const key=kind==='engineering'?engKey(id):rootKey(id),legacy=parse(storage,key);
 const pointer=kind==='latest'?await records.get(`${id}:latest-pointer`):null;
 const recordKey=pointer?.recordKey||legacy?.__ventraTakeoffRecord||`${id}:${kind==='engineering'?'engineering':'raster'}`;
 const stored=await records.get(recordKey);
 const stamp=t=>Math.max(0,...[t?.analyzed_at,t?.updated_at,t?.created_at].map(v=>{const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0;}));
 const urn=t=>t?.aps_urn||t?.apsUrn||t?.urn||t?.advanced_takeoff?.aps_urn||t?.raw_result?.aps_urn||'';
 const hasWalls=t=>{const {geometry:g}=resolveDwgCalibration(t);return !!(g.wallLineSegments?.length||g.lineSegments?.length);};
 // Preserve extracted source data when an older client writes a newer translation-only placeholder.
 const preserveStored=stored&&legacy&&isEngineering(stored)&&isEngineering(legacy)&&urn(stored)===urn(legacy)&&hasWalls(stored)&&!hasWalls(legacy);
 if(legacy&&!legacy.__ventraTakeoffRecord&&!preserveStored&&(!stored||stamp(legacy)>stamp(stored))){await persistTakeoff(id,legacy,{kind,storage,records});return legacy;}
 if(stored){cache.set(recordKey,stored);cache.set(`${id}:${kind}`,stored);return stored;}
 if(kind==='latest'){const engineering=await records.get(`${id}:engineering`);if(engineering){cache.set(`${id}:latest`,engineering);return engineering;}}
 return legacy;
}

export async function clearPersistedTakeoff(id,{storage=local(),records=indexedTakeoffRecords}={}){
 if(writes.has(id))await writes.get(id).catch(()=>{});
 for(const key of await records.get(`${id}:document-records`)||[]){await records.delete(key);cache.delete(key);}
 await records.delete(`${id}:document-records`);
 await records.delete(`${id}:engineering`);await records.delete(`${id}:raster`);await records.delete(`${id}:latest-pointer`);
 for(const key of [`${id}:latest`,`${id}:engineering`,`${id}:raster`])cache.delete(key);
 storage?.removeItem(rootKey(id));storage?.removeItem(engKey(id));
}
