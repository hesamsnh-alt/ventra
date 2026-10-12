'use client';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {createDailyReport,listWorkspaceRecords} from '@/services/workspaceRecordsService';
import {uploadProjectDocument,downloadProjectDocument} from '@/services/documentService';
import {commercialFetch} from '@/lib/commercialFetch';
import {REPORT_PRESETS,SITE_WORKS,SITE_ZONES,labelFor,reviewedScopeProgress} from '@/lib/siteProgress.mjs';
import {DAILY_REPORT_COPY} from '@/lib/dailyReportCopy.mjs';
import './ProjectDailyReports.css';
const blank=()=>({workers:'',weather:'',progress:'',materials:'',issues:'',notes:'',workType:'',zone:'',scope:'',fullCoverage:false,planned:'',completed:'',unit:'m²',reviewed:''});
async function preparePhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Invalid site photo.');
 const url=URL.createObjectURL(file);
 try{
  const picture=await new Promise((resolve,reject)=>{const image=new window.Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});
  const scale=Math.min(1,1600/Math.max(picture.width,picture.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(picture.width*scale);canvas.height=Math.round(picture.height*scale);
  const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(picture,0,0,canvas.width,canvas.height);
  let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
  if(blob?.size>650000)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.6));
  if(!blob||blob.size>650000)throw new Error('Photo too large after compression.');
  const imageUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  return {id:crypto.randomUUID(),name:file.name,imageUrl,file:new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'})};
 }finally{URL.revokeObjectURL(url);}
}
export default function ProjectDailyReports({projectId}){
 const {language}=useLanguage(),t=DAILY_REPORT_COPY[language]||DAILY_REPORT_COPY.en;
 const [reports,setReports]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(''),[canEdit,setCanEdit]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[form,setForm]=useState(blank),[photos,setPhotos]=useState([]),[assessment,setAssessment]=useState(null),[confirmed,setConfirmed]=useState(false);
 const camera=useRef(null),gallery=useRef(null),uploaded=useRef(new Map()),active=useRef(null);
 useEffect(()=>{let live=true;listWorkspaceRecords(projectId).then(r=>{if(live){setCanEdit(r.canEdit);setReports(r.reports);setError(r.error?.message||'');setLoading(false);}}).catch(e=>{if(live){setError(e.message);setLoading(false);}});return()=>{live=false;active.current?.abort();};},[projectId]);
 function update(name,value){setForm(f=>({...f,[name]:value}));setConfirmed(false);if(['workType','zone','scope','fullCoverage'].includes(name))setAssessment(null);}
 function change(e){update(e.target.name,e.target.value);}
 function preset(name,id){const text=labelFor(REPORT_PRESETS[name].find(p=>p.id===id),language);if(!text)return;update(name,name==='weather'?text:form[name]?`${form[name]}\n${text}`:text);}
 async function choose(files){
  if(photos.length+files.length>6){setError(t.photoLimit);return;}
  setBusy(true);setError('');
  try{const added=[];for(const file of files)added.push(await preparePhoto(file));setPhotos(p=>[...p,...added]);setAssessment(null);setConfirmed(false);}
  catch{setError(t.photoError);}finally{setBusy(false);}
 }
 async function analyze(){
  if(busy||active.current)return;
  if(!form.workType||!form.zone.trim()||form.scope.trim().length<10){setError(t.noWork);return;}
  const controller=new AbortController();active.current=controller;setBusy(true);setError('');setAssessment(null);setConfirmed(false);
  try{
   const response=await commercialFetch('/api/ai/site-progress',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({projectId,workType:form.workType,zone:form.zone,scope:form.scope,fullCoverage:form.fullCoverage,language,images:photos.map(p=>p.imageUrl),requestId:crypto.randomUUID()})});
   const payload=await response.json();if(!response.ok||!payload.success)throw Object.assign(new Error(payload.error||t.failed),{code:payload.code});
   if(!controller.signal.aborted)setAssessment(payload.assessment);
  }catch(e){if(!controller.signal.aborted)setError(e.code==='RENDER_API_CREDIT_LIMIT'?t.credit:e.code==='RENDER_API_RATE_LIMIT'?t.rate:e.message||t.failed);}
  finally{if(!controller.signal.aborted)setBusy(false);active.current=null;}
 }
 async function submit(e){
  e.preventDefault();if(busy)return;setError('');
  let evidence=null;
  try{
   if(form.workType||photos.length){
    if(!form.workType||!form.zone.trim()||form.scope.trim().length<10)throw new Error(t.noWork);
    if(!confirmed)throw new Error(t.confirmNeeded);
    const reviewed=reviewedScopeProgress({planned:form.planned,completed:form.completed,percent:form.reviewed});
    evidence={version:1,workType:form.workType,zone:form.zone,scope:form.scope,fullCoverage:form.fullCoverage,unit:form.unit,reviewed,assessment,photos:[],reviewedAt:new Date().toISOString()};
   }
   setBusy(true);
   for(const photo of photos){
    let doc=uploaded.current.get(photo.id);
    if(!doc){const r=await uploadProjectDocument({projectId,file:photo.file,category:'photo'});if(r.error)throw r.error;doc=r.document;uploaded.current.set(photo.id,doc);}
    evidence.photos.push({documentId:doc.id,fileName:doc.file_name});
   }
   const r=await createDailyReport(projectId,{...form,siteEvidence:evidence});if(r.error)throw r.error;
   setReports(rows=>[r.data,...rows]);setOpen(false);setForm(blank());setPhotos([]);setAssessment(null);setConfirmed(false);uploaded.current.clear();
  }catch(e){setError(e.message||t.failed);}finally{setBusy(false);}
 }
 async function viewPhoto(id){try{const {supabase}=await import('@/lib/supabase');const r=await supabase.from('project_documents').select('*').eq('id',id).eq('project_id',projectId).single();if(r.error)throw r.error;const d=await downloadProjectDocument(r.data);if(d.error)throw d.error;window.location.assign(d.url);}catch(e){setError(e.message);}}
 const estimated=(()=>{try{return reviewedScopeProgress({planned:form.planned,completed:form.completed,percent:form.reviewed}).percent;}catch{return null;}})();
 return <section className="daily-reports-panel">
  <div className="daily-reports-header"><h2>{t.title}</h2><button type="button" disabled={!canEdit||busy} onClick={()=>setOpen(v=>!v)}>{t.add}</button></div>
  <p>{t.authority}</p>{error&&<p role="alert">{error}</p>}
  {open&&<form className="daily-report-form" onSubmit={submit}><fieldset disabled={busy}>
   <div className="daily-report-form-grid">
    <label>{t.workers}<input type="number" min="0" step="1" name="workers" list="site-worker-count" value={form.workers} onChange={change}/><datalist id="site-worker-count">{[2,5,10,20,30,50].map(n=><option key={n} value={n}/>)}</datalist></label>
    {['weather','materials','issues','notes'].map(name=><label key={name}>{t[name]}<select aria-label={`${t[name]} — ${t.preset}`} value="" onChange={e=>preset(name,e.target.value)}><option value="">{t.preset}</option>{REPORT_PRESETS[name].map(p=><option key={p.id} value={p.id}>{labelFor(p,language)}</option>)}</select>{['issues','notes'].includes(name)?<textarea name={name} maxLength={4000} value={form[name]} onChange={change}/>:<input name={name} maxLength={1000} value={form[name]} onChange={change}/>}</label>)}
    <label>{t.daily}<select value="" onChange={e=>update('progress',e.target.value)}><option value="">{t.preset}</option>{[0,5,10,25,50,75,100].map(n=><option key={n} value={n}>{n}%</option>)}</select><input type="number" min="0" max="100" step="0.01" name="progress" value={form.progress} onChange={change}/></label>
   </div>
   <hr/>
   <div className="daily-report-form-grid">
    <label>{t.work}<select name="workType" value={form.workType} onChange={change}><option value="">{t.preset}</option>{SITE_WORKS.map(w=><option key={w.id} value={w.id}>{labelFor(w,language)}</option>)}</select></label>
    <label>{t.zone}<input name="zone" list="site-zones" maxLength={160} value={form.zone} onChange={change}/><datalist id="site-zones">{SITE_ZONES.map(z=><option key={z.id} value={labelFor(z,language)}/>)}</datalist></label>
    <label className="daily-report-full-field">{t.scope}<textarea name="scope" maxLength={1200} value={form.scope} onChange={change}/><small>{t.scopeHelp} {t.photoScope}</small></label>
   </div>
   <div className="daily-report-form-actions"><button type="button" onClick={()=>camera.current.click()}>{t.camera}</button><button type="button" onClick={()=>gallery.current.click()}>{t.gallery}</button></div>
   <input ref={camera} type="file" hidden accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{choose(Array.from(e.target.files||[]));e.target.value='';}}/>
   <input ref={gallery} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{choose(Array.from(e.target.files||[]));e.target.value='';}}/>
   <p>{t.photoHelp}</p><div className="daily-evidence-photos">{photos.map(p=><figure key={p.id}><Image src={p.imageUrl} alt={p.name} width={240} height={160} unoptimized/><figcaption>{p.name}</figcaption><button type="button" onClick={()=>{setPhotos(rows=>rows.filter(row=>row.id!==p.id));setAssessment(null);setConfirmed(false);}}>{t.remove}</button></figure>)}</div>
   <label className="daily-evidence-check"><input type="checkbox" checked={form.fullCoverage} onChange={e=>update('fullCoverage',e.target.checked)}/>{t.coverage}</label>
   <p>{t.paid}</p><button type="button" disabled={!photos.length} onClick={analyze}>{t.analyze}</button>
   {assessment&&<div className="daily-evidence-result" role="status"><p>{t.stage}: {assessment.stage}</p><strong>{assessment.canEstimate?`${t.estimate}: ${assessment.minimumPercent}–${assessment.maximumPercent}%`:t.notEnough}</strong><p>{t.confidence}: {t[assessment.confidence]}</p>{[['observations','observations'],['limitations','limits'],['nextChecks','checks']].map(([key,title])=><div key={key}><h4>{t[title]}</h4><ul>{assessment[key].map((v,i)=><li key={i}>{v}</li>)}</ul></div>)}</div>}
   {form.workType&&<><div className="daily-report-form-grid"><label>{t.planned}<input type="number" min="0" step="any" name="planned" value={form.planned} onChange={change}/></label><label>{t.completed}<input type="number" min="0" step="any" name="completed" value={form.completed} onChange={change}/></label><label>{t.unit}<select name="unit" value={form.unit} onChange={change}>{['m²','m³','m','item','point'].map(u=><option key={u} value={u}>{u}</option>)}</select></label><label>{t.reviewed}<select value="" disabled={!!(form.planned||form.completed)} onChange={e=>update('reviewed',e.target.value)}><option value="">{t.preset}</option>{[0,10,25,50,75,100].map(n=><option key={n} value={n}>{n}%</option>)}</select><input type="number" min="0" max="100" step="0.01" name="reviewed" disabled={!!(form.planned||form.completed)} value={form.reviewed} onChange={change}/></label></div><p>{t.quantityHelp}</p>{estimated!==null&&<p>{t.activity}: {estimated}%</p>}<label className="daily-evidence-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t.confirm}</label></>}
   <div className="daily-report-form-actions"><button className="daily-report-save" type="submit">{t.save}</button></div>
  </fieldset>{busy&&<p role="status">{t.busy}</p>}</form>}
  <div className="daily-report-list">{reports.map(r=><article key={r.id} className="daily-report-card"><div className="daily-report-card-top"><h3>{r.report_date}</h3><strong>{t.daily}: {r.progress}%</strong></div><div className="daily-report-metrics"><p>{t.workers}: {r.workers}</p><p>{t.weather}: {r.weather||t.none}</p><p>{t.materials}: {r.materials||t.none}</p></div><p>{t.issues}: {r.issues||t.none}</p><p>{t.notes}: {r.notes||t.none}</p>{r.site_evidence&&<><p>{labelFor(SITE_WORKS.find(w=>w.id===r.site_evidence.workType),language)} — {r.site_evidence.zone}</p><p>{r.site_evidence.scope}</p><strong>{t.activity}: {r.site_evidence.reviewed?.percent}%</strong>{r.site_evidence.assessment&&<p>{t.stage}: {r.site_evidence.assessment.stage}{r.site_evidence.assessment.canEstimate?` (${t.estimate}: ${r.site_evidence.assessment.minimumPercent}–${r.site_evidence.assessment.maximumPercent}%)`:''}</p>}<div className="daily-report-form-actions">{r.site_evidence.photos?.map(p=><button type="button" key={p.documentId} onClick={()=>viewPhoto(p.documentId)}>{p.fileName}</button>)}</div></>}</article>)}</div>
  {!loading&&!reports.length&&<p>{t.empty}</p>}
 </section>;
}
