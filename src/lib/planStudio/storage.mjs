import {validateDocument} from './document.mjs';
export const PLAN_DATABASE='ventra-independent-plan-studio-v1';
export const PLAN_HISTORY_LIMIT=20;

function open(){
 return new Promise((resolve,reject)=>{
  const q=indexedDB.open(PLAN_DATABASE,3);
  q.onupgradeneeded=()=>{
   if(!q.result.objectStoreNames.contains('drawings'))q.result.createObjectStore('drawings',{keyPath:'id'});
   if(!q.result.objectStoreNames.contains('models'))q.result.createObjectStore('models');
   if(!q.result.objectStoreNames.contains('revisions'))q.result.createObjectStore('revisions').createIndex('plan','id');
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

function result(request){
 return new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}

async function run(stores,mode,task){
 const db=await open();
 try{
  const tx=db.transaction(stores,mode);
  const done=new Promise((resolve,reject)=>{
   tx.oncomplete=resolve;
   tx.onabort=()=>reject(tx.error||Error('Drawing save was interrupted.'));
  });
  const value=Promise.resolve().then(()=>task(tx)).catch(error=>{
   try{tx.abort();}catch{}
   throw error;
  });
  const [data]=await Promise.all([value,done]);
  return data;
 }finally{db.close();}
}

const savedTime=doc=>(Date.parse(doc.updatedAt)||Date.parse(doc.createdAt)||0);
function sameDrawing(a,b){
 if(!a)return false;
 const {updatedAt:previousTime,...previous}=a;
 const {updatedAt:nextTime,...next}=b;
 return JSON.stringify(previous)===JSON.stringify(next);
}

async function replaceDrawing(tx,doc,previous){
 if(sameDrawing(previous,doc))return previous;
 const savedAt=Math.max(Date.now(),previous?savedTime(previous)+1:0);
 const next={...doc,updatedAt:new Date(savedAt).toISOString()};
 if(previous){
  const revisions=tx.objectStore('revisions');
  revisions.put(previous,[doc.id,Math.max(0,savedTime(previous))]);
  const keys=await result(revisions.index('plan').getAllKeys(doc.id));
  for(const key of keys.slice(0,Math.max(0,keys.length-PLAN_HISTORY_LIMIT)))revisions.delete(key);
 }
 await result(tx.objectStore('drawings').put(next));
 return next;
}

export async function savePlan(doc,{model}={}){
 const validated=validateDocument(doc);
 return await run(model?['drawings','revisions','models']:['drawings','revisions'],'readwrite',async tx=>{
  const previous=await result(tx.objectStore('drawings').get(validated.id));
  if(model)tx.objectStore('models').put({blob:model.blob,name:model.name},validated.id);
  return await replaceDrawing(tx,validated,previous);
 });
}

export async function listPlanRevisions(id){
 const keys=await run(['revisions'],'readonly',tx=>result(tx.objectStore('revisions').index('plan').getAllKeys(id)));
 return keys.reverse().map(([,savedAt])=>savedAt);
}

export async function restorePlanRevision(id,savedAt,currentDoc){
 const current=currentDoc&&validateDocument(currentDoc);
 if(current&&current.id!==id)throw Error('Version belongs to another plan. / نسخه متعلق به پلان دیگری است.');
 return await run(['drawings','revisions'],'readwrite',async tx=>{
  const snapshot=await result(tx.objectStore('revisions').get([id,savedAt]));
  const previous=await result(tx.objectStore('drawings').get(id));
  if(!snapshot||!previous)throw Error('This version is unavailable. / این نسخه در دسترس نیست.');
  const beforeRestore=current?await replaceDrawing(tx,current,previous):previous;
  return await replaceDrawing(tx,validateDocument(snapshot),beforeRestore);
 });
}

export async function loadPlan(id){
 const row=await run(['drawings'],'readonly',tx=>result(tx.objectStore('drawings').get(id)));
 if(!row)throw Error('Drawing not found on this device.');
 return validateDocument(row);
}
export async function loadPlanModel(id){
 return await run(['models'],'readonly',tx=>result(tx.objectStore('models').get(id)))??null;
}
export async function listPlans(){
 const rows=await run(['drawings'],'readonly',tx=>result(tx.objectStore('drawings').getAll()));
 return rows.map(d=>({id:d.id,name:d.name,updatedAt:d.updatedAt})).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
