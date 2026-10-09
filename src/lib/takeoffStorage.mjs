// Full geometry lives in IndexedDB; localStorage carries a small compatibility
// summary. Engineering and latest pointers share one stored CAD record.
const cache=new Map();const writes=new Map();let opening;
const rootKey=id=>`ventra:project-takeoff:${id}`,engKey=id=>`ventra:project-engineering-takeoff:${id}`;
const isEngineering=t=>!!(t?.aps_urn||t?.apsUrn||t?.urn||t?.advanced_takeoff?.aps_urn||t?.raw_result?.aps_urn)&&!/image|raster/i.test(t?.source||'')&&!/^(jpg|jpeg|png|webp)$/i.test(t?.document_type||'');
const local=()=>typeof window!=='undefined'?window.localStorage:null;
function database(){
 if(!opening)opening=new Promise((resolve,reject)=>{if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB is unavailable; full drawing geometry could not be saved.'));return;}
 const request=indexedDB.open('ventra-drawing-data',1);request.onupgradeneeded=()=>request.result.createObjectStore('takeoffs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close older Ventra tabs to open drawing storage.'));}).catch(error=>{opening=null;throw error;});
 return opening;
}
export const indexedTakeoffRecords={
 async putMany(entries){const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('takeoffs','readwrite'),store=tx.objectStore('takeoffs');for(const [key,value] of entries)store.put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Drawing storage transaction aborted.'));tx.onerror=()=>reject(tx.error);});},
 async put(key,value){const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('takeoffs','readwrite');tx.objectStore('takeoffs').put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Drawing storage transaction aborted.'));tx.onerror=()=>reject(tx.error);});},
 async get(key){const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('takeoffs','readonly').objectStore('takeoffs').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});},
 async delete(key){const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('takeoffs','readwrite');tx.objectStore('takeoffs').delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
};
export function compactTakeoff(takeoff,recordKey){
 const out={};for(const [k,v]of Object.entries(takeoff||{}))if(v===null||['number','boolean'].includes(typeof v)||typeof v==='string'&&!v.startsWith('data:')&&v.length<4000)out[k]=v;
 out.geometry={};for(const [k,v]of Object.entries(takeoff?.geometry||{}))if(typeof v==='number'||typeof v==='string'&&v.length<100)out.geometry[k]=v;
 out.__ventraTakeoffRecord=recordKey;out.__geometryStoredInIndexedDB=true;return out;
}
function parse(storage,key){try{return JSON.parse(storage?.getItem(key)||'null');}catch{return null;}}
export function readTakeoffSync(id,kind='latest',storage=local()){
 const key=kind==='engineering'?engKey(id):rootKey(id),value=parse(storage,key);
 if(cache.has(`${id}:${kind}`))return cache.get(`${id}:${kind}`);
 if(value?.__ventraTakeoffRecord&&cache.has(value.__ventraTakeoffRecord))return cache.get(value.__ventraTakeoffRecord);
 return cache.get(`${id}:${kind}`)||value;
}
async function persistRecord(id,takeoff,{kind='latest',storage=local(),records=indexedTakeoffRecords}={}){
 if(!id||!takeoff)return null;
 const engineering=isEngineering(takeoff),recordKey=`${id}:${engineering?'engineering':'raster'}`;
 const entries=[[recordKey,takeoff]];
 if(kind==='latest')entries.push([`${id}:latest-pointer`,{recordKey}]);
 if(records.putMany)await records.putMany(entries);
 else for(const [key,value] of entries)await records.put(key,value);
 cache.set(recordKey,takeoff);cache.set(`${id}:${kind}`,takeoff);if(engineering)cache.set(`${id}:engineering`,takeoff);
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
export async function readPersistedTakeoff(id,kind='latest',{storage=local(),records=indexedTakeoffRecords}={}){
 if(writes.has(id))await writes.get(id).catch(()=>{});
 const key=kind==='engineering'?engKey(id):rootKey(id),legacy=parse(storage,key);
 const pointer=kind==='latest'?await records.get(`${id}:latest-pointer`):null;
 const recordKey=pointer?.recordKey||legacy?.__ventraTakeoffRecord||`${id}:${kind==='engineering'?'engineering':'raster'}`;
 const stored=await records.get(recordKey);
 const stamp=t=>Math.max(0,...[t?.analyzed_at,t?.updated_at,t?.created_at].map(v=>{const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0;}));
 if(legacy&&!legacy.__ventraTakeoffRecord&&(!stored||stamp(legacy)>stamp(stored))){await persistTakeoff(id,legacy,{kind,storage,records});return legacy;}
 if(stored){cache.set(recordKey,stored);cache.set(`${id}:${kind}`,stored);return stored;}
 if(kind==='latest'){const engineering=await records.get(`${id}:engineering`);if(engineering){cache.set(`${id}:latest`,engineering);return engineering;}}
 return legacy;
}

export async function clearPersistedTakeoff(id,{storage=local(),records=indexedTakeoffRecords}={}){
 if(writes.has(id))await writes.get(id).catch(()=>{});
 await records.delete(`${id}:engineering`);await records.delete(`${id}:raster`);await records.delete(`${id}:latest-pointer`);
 for(const key of [`${id}:latest`,`${id}:engineering`,`${id}:raster`])cache.delete(key);
 storage?.removeItem(rootKey(id));storage?.removeItem(engKey(id));
}
