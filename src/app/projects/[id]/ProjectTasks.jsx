"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {translateText,languageDirection} from '@/lib/i18n/translate.mjs';
import {TASK_ROLES,TASK_GROUPS,TASK_PRESETS,taskPresetDraft} from '@/lib/taskPresets.mjs';
import { useEffect, useState } from "react";
import { createTask, deleteTask, listWorkspaceRecords, updateTask } from "@/services/workspaceRecordsService";
import "./ProjectTasks.css";
export default function ProjectTasks({ projectId }) {
  const {language}=useLanguage();
  const emptyDraft=()=>({title:'',assignee:'',priority:'Medium'});
  const [draft,setDraft]=useState(emptyDraft),[presetId,setPresetId]=useState(''),[roleId,setRoleId]=useState(''),[saving,setSaving]=useState(false);
  function choosePreset(id){setPresetId(id);const next=taskPresetDraft(id,language);if(next){setDraft(next);setRoleId(TASK_PRESETS.find(p=>p.id===id).role);}}
  function chooseRole(id){setRoleId(id);const role=TASK_ROLES.find(r=>r.id===id);if(role)setDraft(d=>({...d,assignee:translateText(role.label,language)}));}
  function toggleForm(){if(!open){setDraft(emptyDraft());setPresetId('');setRoleId('');setError('');}setOpen(!open);}
  const [tasks,setTasks]=useState([]),[open,setOpen]=useState(false),[error,setError]=useState(""),[canEdit,setCanEdit]=useState(false),[loading,setLoading]=useState(true);
  async function load(){setLoading(true);const r=await listWorkspaceRecords(projectId);setCanEdit(r.canEdit);setTasks(r.tasks);setError(r.error?.message||"");setLoading(false);}
  useEffect(()=>{let live=true;listWorkspaceRecords(projectId).then(r=>{if(!live)return;setCanEdit(r.canEdit);setTasks(r.tasks);setError(r.error?.message||'');setLoading(false);}).catch(e=>{if(live){setError(e.message);setLoading(false);}});return()=>{live=false;};},[projectId]);
  async function add(e){e.preventDefault();if(saving||!canEdit)return;setSaving(true);setError('');try{const r=await createTask(projectId,draft);if(r.error)setError(r.error.message);else{setTasks(x=>[r.data,...x]);setOpen(false);setDraft(emptyDraft());setPresetId('');setRoleId('');}}catch(e){setError(e.message);}finally{setSaving(false);}}
  async function status(id,status){const r=await updateTask(id,{status});if(r.error)setError(r.error.message);else setTasks(x=>x.map(t=>t.id===id?r.data:t));}
  async function remove(id){const r=await deleteTask(id);if(r.error)setError(r.error.message);else setTasks(x=>x.filter(t=>t.id!==id));}
  return <LocalizedElement as="section" className="tasks-panel" dir={languageDirection(language)}><LocalizedElement as="div" className="tasks-header"><LocalizedElement as="h2">Task Management</LocalizedElement><LocalizedElement as="button" disabled={!canEdit||saving} onClick={toggleForm}>+ New Task</LocalizedElement></LocalizedElement><LocalizedElement as="p">Shared project records stored in the project database.</LocalizedElement>{error&&<LocalizedElement as="p" role="alert">{error}</LocalizedElement>}{loading&&<LocalizedElement as="p">Loading tasks…</LocalizedElement>}{open&&<LocalizedElement as="form" className="task-entry-form" onSubmit={add}>
  <LocalizedElement as="label">Task template
   <LocalizedElement as="select" value={presetId} disabled={saving} onChange={e=>choosePreset(e.target.value)}>
    <LocalizedElement as="option" value="">Manual entry / choose a template</LocalizedElement>
    {TASK_GROUPS.map(group=><optgroup key={group} label={translateText(group,language)}>{TASK_PRESETS.filter(p=>p.group===group).map(p=><LocalizedElement as="option" key={p.id} value={p.id}>{p.title}</LocalizedElement>)}</optgroup>)}
   </LocalizedElement>
  </LocalizedElement>
  <LocalizedElement as="label">Task <LocalizedElement as="input" name="title" required maxLength={200} value={draft.title} disabled={saving} onChange={e=>{setPresetId('');setDraft(d=>({...d,title:e.target.value}));}}/></LocalizedElement>
  <LocalizedElement as="label">Suggested responsible role
   <LocalizedElement as="select" value={roleId} disabled={saving} onChange={e=>chooseRole(e.target.value)}><LocalizedElement as="option" value="">Manual entry / choose a role</LocalizedElement>{TASK_ROLES.map(r=><LocalizedElement as="option" key={r.id} value={r.id}>{r.label}</LocalizedElement>)}</LocalizedElement>
  </LocalizedElement>
  <LocalizedElement as="label">Responsible person or role <LocalizedElement as="input" name="assignee" maxLength={100} value={draft.assignee} disabled={saving} onChange={e=>{setRoleId('');setDraft(d=>({...d,assignee:e.target.value}));}}/></LocalizedElement>
  <LocalizedElement as="label">Priority <LocalizedElement as="select" name="priority" value={draft.priority} disabled={saving} onChange={e=>setDraft(d=>({...d,priority:e.target.value}))}>{['Low','Medium','High'].map(v=><LocalizedElement as="option" value={v} key={v}>{v}</LocalizedElement>)}</LocalizedElement></LocalizedElement>
  <LocalizedElement as="p" className="task-entry-note">A template fills the task, suggested role and priority. Edit any field before saving. A role is a text label, not a linked user or an automatic notification.</LocalizedElement>
  <LocalizedElement as="div" className="task-entry-actions"><LocalizedElement as="button" type="submit" disabled={saving||!canEdit||!draft.title.trim()}>{saving?'Saving…':'Save task'}</LocalizedElement><LocalizedElement as="button" type="button" disabled={saving} onClick={()=>setOpen(false)}>Cancel</LocalizedElement></LocalizedElement>
 </LocalizedElement>}<LocalizedElement as="table" className="tasks-table"><LocalizedElement as="thead"><LocalizedElement as="tr"><LocalizedElement as="th">Task</LocalizedElement><LocalizedElement as="th">Assigned to</LocalizedElement><LocalizedElement as="th">Priority</LocalizedElement><LocalizedElement as="th">Status</LocalizedElement><LocalizedElement as="th">Action</LocalizedElement></LocalizedElement></LocalizedElement><LocalizedElement as="tbody">{tasks.map(t=><LocalizedElement as="tr" key={t.id}><LocalizedElement as="td"><OriginalText>{t.title}</OriginalText></LocalizedElement><LocalizedElement as="td">{t.assignee?<OriginalText>{t.assignee}</OriginalText>:"Unassigned"}</LocalizedElement><LocalizedElement as="td">{t.priority}</LocalizedElement><LocalizedElement as="td"><LocalizedElement as="select" disabled={!canEdit} aria-label={`Status of ${t.title}`} value={t.status} onChange={e=>status(t.id,e.target.value)}>{["Pending","In Progress","Completed"].map(v=><LocalizedElement as="option" key={v}>{v}</LocalizedElement>)}</LocalizedElement></LocalizedElement><LocalizedElement as="td"><LocalizedElement as="button" disabled={!canEdit} onClick={()=>remove(t.id)}>Delete</LocalizedElement></LocalizedElement></LocalizedElement>)}</LocalizedElement></LocalizedElement>{!loading&&!tasks.length&&<LocalizedElement as="p">No tasks yet.</LocalizedElement>}</LocalizedElement>;
}
