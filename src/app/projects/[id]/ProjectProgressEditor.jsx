"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useState,useEffect} from 'react';
import {updateProject} from '@/services/projectService';
import {validatedProgress} from '@/lib/projectProgress.mjs';
import {loadSchedule} from '@/services/boqScheduleService';
import {planProgress} from '@/lib/boqSchedule.mjs';
export default function ProjectProgressEditor({project,onSaved}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(project.progress??0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[schedule,setSchedule]=useState(null);
 useEffect(()=>{let live=true;const reload=()=>loadSchedule(project.id).then(r=>{if(live)setSchedule(r.plan?planProgress(r.plan.payload):null);}).catch(()=>{});reload();window.addEventListener('ventra:schedule-progress',reload);return()=>{live=false;window.removeEventListener('ventra:schedule-progress',reload);};},[project.id]);
 async function save(e){e.preventDefault();setError('');try{const progress=validatedProgress(value);setBusy(true);const r=await updateProject(project.id,{progress});if(r.error)throw r.error;onSaved(r.project);setEditing(false);}catch(e){setError(e.message||'Could not save progress.');}finally{setBusy(false);}}
 return <LocalizedElement as="div">{schedule&&<LocalizedElement as="p">BOQ schedule: {schedule.percent}% planned crew-effort complete ({schedule.completed}/{schedule.total} activities; {schedule.excluded} excluded). Separate from the reviewed overall project percentage.</LocalizedElement>}<LocalizedElement as="button" type="button" disabled={busy} onClick={()=>{setValue(project.progress??0);setEditing(!editing);}}>Update reviewed overall progress</LocalizedElement>{editing&&<LocalizedElement as="form" onSubmit={save}><LocalizedElement as="label">Overall progress % <LocalizedElement as="input" type="number" min="0" max="100" step="0.01" required value={value} onChange={e=>setValue(e.target.value)}/></LocalizedElement><LocalizedElement as="button" disabled={busy}>{busy?'Saving…':'Save'}</LocalizedElement><LocalizedElement as="p">Overall physical progress requires review. Schedule completion does not certify work or release payment.</LocalizedElement></LocalizedElement>}{error&&<LocalizedElement as="p" role="alert">{error}</LocalizedElement>}</LocalizedElement>;
}
