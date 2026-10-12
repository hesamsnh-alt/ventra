'use client';
import WorkspaceDisclosure from './WorkspaceDisclosure';
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {indexedTakeoffRecords} from '@/lib/takeoffStorage.mjs';
import {snapshotKeys,validateSnapshot} from '@/lib/commercialAccess.mjs';
export default function CommercialSync({projectId}){
 const [shared,setShared]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const revision=shared?.projectId===projectId?shared.revision:null,remote=shared?.projectId===projectId?shared.remote:null;
 useEffect(()=>{let alive=true;
  supabase.from('ventra_commercial_snapshots').select('revision,updated_at').eq('project_id',projectId).maybeSingle().then(({data,error})=>{if(!alive)return;if(error){setError('Shared storage is unavailable. The operator must apply the commercial database migration.');return;}setShared({projectId,revision:data?.revision||0,remote:data});});
  return ()=>{alive=false;};
 },[projectId]);
 async function save(){setBusy(true);setError('');setMessage('');try{
  if(revision===null)throw new Error('Shared storage has not loaded.');
  // Never overwrite an existing server version using a merely inspected revision.
  const loadedKey=`ventra:commercial-revision:${projectId}`;
  const base=Number(sessionStorage.getItem(loadedKey)||0);
  if(revision>0&&base!==revision)throw new Error('Load the shared version before saving changes from this browser.');
  const payload={};for(const [kind,key] of Object.entries(snapshotKeys(projectId))){const raw=localStorage.getItem(key);payload[kind]=raw?JSON.parse(raw):null;}
  validateSnapshot(payload,projectId);
  if(!payload.boq&&!payload.estimate&&!payload.quotation&&!payload.branding)throw new Error('No commercial document exists in this browser yet.');
  const {data,error}=await supabase.rpc('ventra_save_commercial',{p_project:projectId,p_payload:payload,p_expected:base});if(error)throw error;
  sessionStorage.setItem(loadedKey,String(data.revision));setShared({projectId,revision:data.revision,remote:{revision:data.revision,updated_at:data.updatedAt}});setMessage('Shared version saved. Your authorised project team can load it on another device.');
 }catch(e){setError(e.message||'Shared save failed.');}finally{setBusy(false);}}
 async function load(){
  if(!window.confirm('Replace this browser’s BOQ, estimate, quotation and branding with the shared version? Your current draft will be backed up locally.'))return;
  setBusy(true);setError('');setMessage('');try{
   const {data,error}=await supabase.from('ventra_commercial_snapshots').select('*').eq('project_id',projectId).maybeSingle();if(error)throw error;if(!data)throw new Error('No shared version has been saved yet.');
   validateSnapshot(data.payload,projectId);
   const previous={};const keys=snapshotKeys(projectId);for(const [kind,key] of Object.entries(keys))previous[kind]=localStorage.getItem(key);
   await indexedTakeoffRecords.put(`${projectId}:commercial-backup`,{previous,savedAt:new Date().toISOString()});
   try{for(const [kind,key] of Object.entries(keys)){if(data.payload[kind]===null||data.payload[kind]===undefined)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(data.payload[kind]));}}
   catch(e){for(const [kind,key] of Object.entries(keys)){if(previous[kind]===null)localStorage.removeItem(key);else localStorage.setItem(key,previous[kind]);}throw e;}
   sessionStorage.setItem(`ventra:commercial-revision:${projectId}`,String(data.revision));window.location.reload();
  }catch(e){setError(e.message||'Shared load failed.');}finally{setBusy(false);}
 }
 return <LocalizedElement as="aside" className="commercial-no-print" style={{border:'1px solid #64748b',borderRadius:12,padding:16,marginBottom:18}}>
  <WorkspaceDisclosure title="Shared commercial documents">
  <LocalizedElement as="strong">Shared commercial documents</LocalizedElement><LocalizedElement as="p">Editing uses a browser draft. Save your quotation draft first, then save the shared version to make BOQ, estimate, quotation and company branding available on other devices.</LocalizedElement>
  <LocalizedElement as="div" style={{display:'flex',gap:12,flexWrap:'wrap'}}><LocalizedElement as="button" type="button" disabled={busy||revision===null} onClick={save}>{busy?'Please wait…':'Save shared version'}</LocalizedElement><LocalizedElement as="button" type="button" disabled={busy||!remote} onClick={load}>Load shared version</LocalizedElement></LocalizedElement>
  {remote&&<LocalizedElement as="small">Shared revision {remote.revision} · {new Date(remote.updated_at).toLocaleString()}</LocalizedElement>}
  </WorkspaceDisclosure>
  {message&&<LocalizedElement as="p" role="status">{message}</LocalizedElement>}{error&&<LocalizedElement as="p" role="alert">{error}</LocalizedElement>}
 </LocalizedElement>;
}
