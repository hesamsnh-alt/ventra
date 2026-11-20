'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {getCurrentUser} from '@/services/authService';
import {getProjects} from '@/services/projectService';
import {uploadProjectDocument} from '@/services/documentService';
import {selectDrawingDocument,saveActiveSource} from '@/lib/schematicStorage.mjs';
import {indexedTakeoffRecords} from '@/lib/takeoffStorage.mjs';
import {exportJPG} from '@/lib/planStudio/export.mjs';
import {openProjectCadFile,transferPlanToProject} from '@/lib/planStudio/projectTransfer.mjs';
export default function PlanProjectTransfer({doc,fa,cadFile,onCloseCad}){
 const [open,setOpen]=useState(Boolean(cadFile)),[projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[format,setFormat]=useState('jpg'),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[signedIn,setSignedIn]=useState(false),[sent,setSent]=useState(null);
 const sending=useRef(false),latest=useRef(doc);latest.current=doc;
 const t=(en,ps)=>fa?ps:en;
 useEffect(()=>{if(!open)return;let live=true;setLoading(true);setError('');(async()=>{try{const auth=await getCurrentUser();if(auth.error&&auth.error.name!=='AuthSessionMissingError')throw auth.error;if(!live)return;setSignedIn(!!auth.user);if(!auth.user)return;const result=await getProjects();if(result.error)throw result.error;if(!live)return;const rows=result.projects||[];setProjects(rows);const requested=new URLSearchParams(window.location.search).get('project');setProjectId(current=>rows.some(p=>p.id===current)?current:rows.some(p=>p.id===requested)?requested:rows.length===1?rows[0].id:'');}catch(e){if(live)setError(e.message);}finally{if(live)setLoading(false);}})();return()=>{live=false};},[open]);
 async function send(){if(sending.current)return;setError('');setSent(null);if(!projects.some(p=>p.id===projectId)){setError(t('Choose a project.','پروژه را انتخاب کن.'));return;}sending.current=true;setBusy(true);try{const version=latest.current;const services={exportImage:exportJPG,upload:uploadProjectDocument,selectDocument:selectDrawingDocument,selectSource:saveActiveSource,saveMeasurements:(project,document,result)=>indexedTakeoffRecords.put(`plan-studio:${project}:${document}`,result)};
 const result=cadFile?await openProjectCadFile({projectId,file:cadFile},services):await transferPlanToProject({doc:version,projectId,format},services);setSent({...result,version});}catch(e){setError(e.message);}finally{sending.current=false;setBusy(false);}}
 function close(){setOpen(false);if(cadFile)onCloseCad();}
 return <div className="ps-transfer">
  {!cadFile&&<button type="button" aria-expanded={open} onClick={()=>{if(!busy)setOpen(v=>!v)}}>{t('Send to project Drawings','ارسال به Drawings پروژه')}</button>}
  {open&&<section className="ps-transfer-panel" aria-label={t('Send plan to project','ارسال پلان به پروژه')}>
   <strong>{cadFile?cadFile.name:t('Send this plan to Drawings','ارسال همین پلان به Drawings')}</strong>
   {cadFile?<p>{/\.dwg$/i.test(cadFile.name)?t('Save the original in a project. For a DWG, use Prepare CAD for editing with APS in Drawings.','فایل اصلی را در پروژه ذخیره کن. برای DWG، در Drawings گزینهٔ آماده‌سازی نقشه برای ویرایش با APS را بزن.'):t('Save the original in a project, then open it in Drawings with APS.','فایل اصلی را در پروژه ذخیره کن و از Drawings با APS بازش کن.')}</p>:
     <p>{t('Send a snapshot to a project. Then open Drawings to analyze it or build 3D.','یک نسخه از پلان را به پروژه بفرست. سپس در Drawings آنالیز یا ساخت سه‌بعدی را اجرا کن.')}</p>}
   {loading?<p role="status">{t('Loading projects…','در حال دریافت پروژه‌ها…')}</p>:!signedIn?<Link href="/login">{t('Sign in to send to a project','برای ارسال به پروژه وارد حساب شو')}</Link>:<>
    <label>{t('Destination project','پروژهٔ مقصد')}<select aria-label={t('Destination project','پروژهٔ مقصد')} disabled={busy} value={projectId} onChange={e=>{setProjectId(e.target.value);setSent(null);}}><option value="">{t('Select project','انتخاب پروژه')}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {!projects.length&&<Link href="/projects/new">{t('Create a project','ایجاد پروژه')}</Link>}
    {!cadFile&&<label>{t('Drawing format','نوع فایل نقشه')}<select disabled={busy} value={format} onChange={e=>{setFormat(e.target.value);setSent(null);}}><option value="jpg">{t('JPG · image analysis and image 3D','JPG · تحلیل تصویر و سه‌بعدی تصویر')}</option><option value="dxf">{t('DXF · CAD geometry / Autodesk APS','DXF · هندسهٔ CAD / Autodesk APS')}</option></select></label>}
    <button type="button" disabled={busy||!projectId||(cadFile?Boolean(sent):sent?.version===doc)} onClick={send}>{busy?t('Sending…','در حال ارسال…'):cadFile?t('Save CAD file to project','ذخیرهٔ فایل CAD در پروژه'):t('Send this plan','ارسال همین پلان')}</button>
   </>}
   {error&&<p role="alert" className="ps-error">{error}</p>}
   {sent&&<div role="status"><p>{t('Drawing uploaded. Open Drawings to continue.','نقشه ارسال شد. برای ادامه Drawings را باز کن.')}</p>{sent.warning&&<p>{sent.warning}</p>}<Link className="ps-transfer-open" href={sent.url}>{t('Open project Drawings','باز کردن Drawings پروژه')}</Link></div>}
   <button type="button" disabled={busy} onClick={close}>{t('Close','بستن')}</button>
  </section>}
 </div>;
}
