import {useEffect,useRef,useState} from 'react';
import {listPlanRevisions,PLAN_HISTORY_LIMIT} from '@/lib/planStudio/storage.mjs';

export default function PlanHistory({doc,language,onRestore,onClose}){
 const fa=language==='fa',t=(en,ps)=>fa?ps:en;
 const dialog=useRef(null),restoring=useRef(false);
 const [versions,setVersions]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState(null);
 useEffect(()=>{
  const panel=dialog.current;
  panel.showModal();
  return ()=>{if(panel.open)panel.close();};
 },[]);
 useEffect(()=>{
  let live=true;
  listPlanRevisions(doc.id).then(rows=>{if(live)setVersions(rows);},error=>{if(live)setError(error.message);});
  return ()=>{live=false;};
 },[doc.id]);

 async function restore(){
  if(restoring.current||selected===null)return;
  restoring.current=true;
  setBusy(true);setError('');
  try{
   await onRestore(selected);
   dialog.current?.close();
  }catch(error){setError(error.message);}
  finally{restoring.current=false;setBusy(false);}
 }

 const date=new Intl.DateTimeFormat(fa?'fa-IR':language==='ar'?'ar':'en',{
  year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',
 });
 return <dialog ref={dialog} className="ps-history" aria-labelledby="ps-history-title"
  onClose={event=>{if(!event.currentTarget.open)onClose();}} onCancel={event=>{if(restoring.current)event.preventDefault();}}
  onKeyDown={event=>event.stopPropagation()}>
  <header>
   <h2 id="ps-history-title">{t('Plan history','تاریخچهٔ پلان')}</h2>
   <button type="button" autoFocus disabled={busy} onClick={()=>dialog.current.close()}>{t('Close','بستن')}</button>
  </header>
  <p className="ps-history-name">{doc.name}</p>
  <p>{t(`The last ${PLAN_HISTORY_LIMIT} previous versions are saved in this browser.`,
   `آخرین ${PLAN_HISTORY_LIMIT.toLocaleString('fa-IR')} نسخهٔ قبلی در همین مرورگر ذخیره می‌شوند.`)}</p>
  {error&&<p className="ps-error" role="alert">{error}</p>}
  {versions===null&&!error&&<p role="status">{t('Loading history…','در حال بارگذاری تاریخچه…')}</p>}
  {versions?.length===0&&<p>{t('Earlier versions will appear here after you edit and save this plan.','بعد از ویرایش و ذخیرهٔ پلان، نسخه‌های قبلی اینجا نمایش داده می‌شوند.')}</p>}
  {!!versions?.length&&<>
   <label>{t('Version to restore','نسخه برای بازیابی')}
    <select value={selected??''} disabled={busy} onChange={e=>setSelected(e.target.value===''?null:Number(e.target.value))}>
     <option value="">{t('Choose by save date and time','با تاریخ و ساعت ذخیره انتخاب کن')}</option>
     {versions.map((time,index)=><option key={time} value={time}>{date.format(time)} · {t(`Version ${versions.length-index}`,`نسخهٔ ${(versions.length-index).toLocaleString('fa-IR')}`)}</option>)}
    </select>
   </label>
   <p>{t('Your current plan will be kept in history.','نسخهٔ فعلی پلان در تاریخچه می‌ماند.')}</p>
   <button type="button" disabled={busy||selected===null} onClick={restore}>
    {busy?t('Restoring…','در حال بازیابی…'):t('Restore version','بازیابی نسخه')}
   </button>
  </>}
 </dialog>;
}
