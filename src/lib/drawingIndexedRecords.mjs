// Retain the existing database, store and version. Only a failed transaction
// creation on a closed connection is retried; submitted writes are not replayed.
export function createDrawingIndexedRecords(getFactory=()=>globalThis.indexedDB){
  let active=null,opening=null;
  function discard(db){if(active===db)active=null;try{db.close();}catch{}}
  function database(){
    if(active)return Promise.resolve(active);
    if(opening)return opening;
    const task=new Promise((resolve,reject)=>{
      let cancelled=false;
      const factory=getFactory();
      if(!factory){reject(new Error('IndexedDB is unavailable; full drawing geometry could not be saved.'));return;}
      const request=factory.open('ventra-drawing-data',1);
      request.onupgradeneeded=()=>{
        if(cancelled){request.transaction?.abort();return;}
        if(!request.result.objectStoreNames.contains('takeoffs'))request.result.createObjectStore('takeoffs');
      };
      request.onsuccess=()=>{
        const db=request.result;
        if(cancelled){db.close();return;}
        active=db;db.onversionchange=()=>discard(db);db.onclose=()=>discard(db);resolve(db);
      };
      request.onerror=()=>{cancelled=true;reject(request.error||new Error('Could not open drawing storage.'));};
      request.onblocked=()=>{cancelled=true;reject(new Error('Close older Ventra tabs to open drawing storage.'));};
    });
    opening=task;task.finally(()=>{if(opening===task)opening=null;}).catch(()=>{});return task;
  }
  async function transaction(mode){
    const db=await database();
    try{return db.transaction('takeoffs',mode);}catch(error){
      if(error?.name!=='InvalidStateError')throw error;
      discard(db);const reopened=await database();
      try{return reopened.transaction('takeoffs',mode);}catch(nextError){
        if(nextError?.name==='InvalidStateError')discard(reopened);throw nextError;
      }
    }
  }
  async function write(work){
    const tx=await transaction('readwrite');
    return new Promise((resolve,reject)=>{
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error||new Error('Drawing storage transaction aborted.'));
      tx.onerror=()=>reject(tx.error||new Error('Drawing storage transaction failed.'));
      try{work(tx.objectStore('takeoffs'));}catch(error){
        // Roll back earlier rows if a later value cannot be cloned. Never
        // publish a latest-pointer without the associated complete geometry.
        try{tx.abort();}catch{}reject(error);
      }
    });
  }
  return {
    putMany:entries=>write(store=>{for(const [key,value] of entries)store.put(value,key);}),
    put:(key,value)=>write(store=>store.put(value,key)),delete:key=>write(store=>store.delete(key)),
    async get(key){
      const tx=await transaction('readonly');
      return new Promise((resolve,reject)=>{
        let result=null;
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(tx.error||new Error('Drawing read transaction aborted.'));
        tx.onerror=()=>reject(tx.error||new Error('Drawing read transaction failed.'));
        try{
          const request=tx.objectStore('takeoffs').get(key);
          request.onsuccess=()=>{result=request.result??null;};
          request.onerror=()=>reject(request.error||new Error('Drawing read failed.'));
        }catch(error){try{tx.abort();}catch{}reject(error);}
      });
    },
  };
}
