'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {getCurrentUser} from '@/services/authService';
import {getProjects} from '@/services/projectService';
import {uploadProjectDocument} from '@/services/documentService';
import {selectDrawingDocument,saveActiveSource} from '@/lib/schematicStorage.mjs';
import {exportJPG} from '@/lib/planStudio/export.mjs';
import {transferPlanToProject} from '@/lib/planStudio/projectTransfer.mjs';
export default function PlanProjectTransfer({doc,fa}){
 const [open,setOpen]=useState(false),[projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[format,setFormat]=useState('jpg'),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[signedIn,setSignedIn]=useState(false),[sent,setSent]=useState(null);
 const sending=useRef(false),latest=useRef(doc);latest.current=doc;
 const t=(en,ps)=>fa?ps:en;
 useEffect(()=>{if(!open)return;let live=true;setLoading(true);setError('');(async()=>{try{const auth=await getCurrentUser();if(auth.error)throw auth.error;if(!live)return;setSignedIn(!!auth.user);if(!auth.user)return;const result=await getProjects();if(result.error)throw result.error;if(!live)return;const rows=result.projects||[];setProjects(rows);const requested=new URLSearchParams(window.location.search).get('project');setProjectId(current=>rows.some(p=>p.id===current)?current:rows.some(p=>p.id===requested)?requested:rows.length===1?rows[0].id:'');}catch(e){if(live)setError(e.message);}finally{if(live)setLoading(false);}})();return()=>{live=false};},[open]);
 async function send(){if(sending.current)return;setError('');setSent(null);if(!projects.some(p=>p.id===projectId)){setError(t('Choose a project.','پروژه را انتخاب کن.'));return;}sending.current=true;setBusy(true);try{const version=latest.current;const result=await transferPlanToProject({doc:version,projectId,format},{exportImage:exportJPG,upload:uploadProjectDocument,selectDocument:selectDrawingDocument,selectSource:saveActiveSource});setSent({...result,version});}catch(e){setError(e.message);}finally{sending.current=false;setBusy(false);}}
 return <div className="ps-transfer">
  <button type="button" aria-expanded={open} onClick={()=>{if(!busy)setOpen(v=>!v)}}>{t('Send to project Drawings','ارسال به Drawings پروژه')}</button>
  {open&&<section className="ps-transfer-panel" aria-label={t('Send plan to project','ارسال پلان به پروژه')}>
   <strong>{t('Send this plan to Drawings','ارسال همین پلان به Drawings')}</strong>
   <p>{t('Send a snapshot to an existing project, then open Drawings to analyze it or build 3D. AI analysis runs only when you choose it there. Add dimensions and room names for a useful takeoff.','یک نسخه از پلان را به پروژه بفرست؛ سپس در Drawings آنالیز یا ساخت سه‌بعدی را اجرا کن. تحلیل AI فقط با انتخاب خودت اجرا می‌شود. برای مترهٔ قابل استفاده، اندازه‌گذاری و نام فضاها را کامل کن.')}</p>
   {loading?<p role="status">{t('Loading projects…','در حال دریافت پروژه‌ها…')}</p>:!signedIn?<Link href="/login">{t('Sign in to send to a project','برای ارسال به پروژه وارد حساب شو')}</Link>:<>
    <label>{t('Destination project','پروژهٔ مقصد')}<select aria-label={t('Destination project','پروژهٔ مقصد')} disabled={busy} value={projectId} onChange={e=>{setProjectId(e.target.value);setSent(null);}}><option value="">{t('Select project','انتخاب پروژه')}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {!projects.length&&<Link href="/projects/new">{t('Create a project','ایجاد پروژه')}</Link>}
    <label>{t('Drawing format','نوع فایل نقشه')}<select disabled={busy} value={format} onChange={e=>{setFormat(e.target.value);setSent(null);}}><option value="jpg">{t('JPG · image analysis and image 3D','JPG · تحلیل تصویر و سه‌بعدی تصویر')}</option><option value="dxf">{t('DXF · CAD geometry / Autodesk APS','DXF · هندسهٔ CAD / Autodesk APS')}</option></select></label>
    <button type="button" disabled={busy||!projectId||sent?.version===doc} onClick={send}>{busy?t('Sending…','در حال ارسال…'):t('Send this plan','ارسال همین پلان')}</button>
   </>}
   {error&&<p role="alert" className="ps-error">{error}</p>}
   {sent&&<div role="status"><p>{t('Drawing uploaded. Open Drawings to continue.','نقشه ارسال شد. برای ادامه Drawings را باز کن.')}</p>{sent.warning&&<p>{sent.warning}</p>}<Link className="ps-transfer-open" href={sent.url}>{t('Open project Drawings','باز کردن Drawings پروژه')}</Link></div>}
   <button type="button" disabled={busy} onClick={()=>setOpen(false)}>{t('Close','بستن')}</button>
  </section>}
 </div>;
}
