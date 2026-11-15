'use client';

import {useRef,useState} from 'react';
import {useLanguage} from './i18n/LanguageProvider';
import {DXF_UNIT_OPTIONS} from '@/lib/planStudio/importDxf.mjs';
import {apsEditablePlan,editableApsUnits,editableApsViewports,editablePlanUrl} from '@/lib/planStudio/apsEditablePlan.mjs';
import {savePlan} from '@/lib/planStudio/storage.mjs';

export default function EditApsDrawing({geometry,viewerRef,model,title,projectId}){
 const {language}=useLanguage(),t=(en,fa)=>language==='fa'?fa:en;
 const viewports=editableApsViewports(geometry);
 const [unit,setUnit]=useState(()=>editableApsUnits(geometry));
 const [view,setView]=useState(()=>viewports.length===1?viewports[0]:'');
 const [selectionOnly,setSelectionOnly]=useState(false);
 const [working,setWorking]=useState(false);
 const [error,setError]=useState('');
 const [open,setOpen]=useState(false);
 const pending=useRef(false);
 async function edit(event){
  event.preventDefault();
  if(pending.current)return;
  pending.current=true;setWorking(true);setError('');
  try{
   const viewer=viewerRef.current;
   if(!viewer||viewer.model!==model)throw Error(t('Return to the 2D view originally opened from Drawings.','به نمای دوبعدی اولیه که از Drawings باز کردی برگرد.'));
   const selection=selectionOnly?viewer.getSelection?.()??[]:[];
   if(selectionOnly&&!selection.length)throw Error(t('Select objects in the Autodesk drawing first.','ابتدا اجسام را در نقشهٔ Autodesk انتخاب کن.'));
   const doc=apsEditablePlan(geometry,{name:title,unit,viewport:view,selection});
   await savePlan(doc);
   window.location.assign(editablePlanUrl(doc.id,projectId));
  }catch(cause){setError(cause.message);pending.current=false;setWorking(false);}
 }
 if(!viewports.length)return null;
 return <div>
  <button type="button" className="aps-diagnostic-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   {t('Edit in Plan Studio','ویرایش در پلن‌ساز')}
  </button>
  {open&&<form onSubmit={edit} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8}}>
   <label>{t('Drawing units','واحد نقشه')}{' '}
    <select value={unit} required onChange={e=>setUnit(e.target.value)}>
     <option value="">{t('Select units','انتخاب واحد')}</option>
     {DXF_UNIT_OPTIONS.map(([id,en,fa])=><option key={id} value={id}>{t(en,fa)}</option>)}
    </select>
   </label>
   {viewports.length>1&&<label>{t('Viewport','نمای نقشه')}{' '}
    <select value={view} required onChange={e=>setView(e.target.value)}>
     <option value="">{t('Select viewport','انتخاب نما')}</option>
     {viewports.map(value=><option key={value} value={value}>{value}</option>)}
    </select>
   </label>}
   <label><input type="checkbox" checked={selectionOnly} onChange={e=>setSelectionOnly(e.target.checked)}/>
    {t('Only objects I selected in Autodesk','فقط اجسام انتخاب‌شده در Autodesk')}
   </label>
   <button type="submit" className="aps-diagnostic-button" disabled={working||!unit||!view}>
    {working?t('Saving copy…','در حال ذخیرهٔ نسخه…'):t('Open editable copy','باز کردن نسخهٔ قابل‌ویرایش')}
   </button>
   {error&&<p role="alert">{error}</p>}
  </form>}
 </div>;
}
