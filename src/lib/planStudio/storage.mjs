import {validateDocument} from './document.mjs';
export const PLAN_DATABASE='ventra-independent-plan-studio-v1';
function open(){
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(PLAN_DATABASE,2);
  q.onupgradeneeded=()=>{
   if(!q.result.objectStoreNames.contains('drawings'))q.result.createObjectStore('drawings',{keyPath:'id'});
   if(!q.result.objectStoreNames.contains('models'))q.result.createObjectStore('models');
  };
  let blocked=false;
  q.onsuccess=()=>{
   const db=q.result;
   if(blocked){db.close();return;}
   db.onversionchange=()=>db.close();
   resolve(db);
  };
  q.onblocked=()=>{blocked=true;reject(Error('Close other Plan Studio tabs, then reopen this tab. / تب‌های دیگر پلن‌ساز را ببند و این صفحه را دوباره باز کن.'));};
  q.onerror=()=>reject(Error('Local drawing storage unavailable. Export JSON to keep your work. / ذخیرهٔ محلی در دسترس نیست؛ فایل JSON را نگه دار.'));
 });
}
async function run(stores,mode,task){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode),request=task(tx);
  tx.oncomplete=()=>resolve(request?.result);
  tx.onerror=()=>reject(tx.error||Error('Drawing could not be saved.'));
  tx.onabort=()=>reject(tx.error||Error('Drawing save was interrupted.'));
 });}finally{db.close();}
}
export async function savePlan(doc,{model}={}){
 const d={...validateDocument(doc),updatedAt:new Date().toISOString()};
 await run(model?['drawings','models']:['drawings'],'readwrite',tx=>{
  if(model)tx.objectStore('models').put({blob:model.blob,name:model.name},d.id);
  return tx.objectStore('drawings').put(d);
 });
 return d;
}
export async function loadPlan(id){
 const row=await run(['drawings'],'readonly',tx=>tx.objectStore('drawings').get(id));
 if(!row)throw Error('Drawing not found on this device.');
 return validateDocument(row);
}
export async function loadPlanModel(id){
 return await run(['models'],'readonly',tx=>tx.objectStore('models').get(id))??null;
}
export async function listPlans(){
 const rows=await run(['drawings'],'readonly',tx=>tx.objectStore('drawings').getAll());
 return rows.map(d=>({id:d.id,name:d.name,updatedAt:d.updatedAt})).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
