'use client';
import {useEffect,useState} from 'react';import LocalizedElement from '@/app/components/i18n/LocalizedElement';import {loadProjectControl} from '@/services/projectControlService';
import MaterialSelectionPanel from './MaterialSelectionPanel';
import ProjectControl from './ProjectControl';import ProjectTimeline from './ProjectTimeline';import ProjectTasks from './ProjectTasks';import ProjectDailyReports from './ProjectDailyReports';import ProjectDocuments from './ProjectDocuments';import ProjectPhotos from './ProjectPhotos';import ProjectActivity from './ProjectActivity';import CommercialSync from './CommercialSync';
const TABS=[['team','Team & Contract'],['selections','Selections & Budget'],['schedule','Schedule'],['tasks','Tasks'],['reports','Daily Reports'],['photos','Site photos'],['documents','Documents'],['activity','Activity']];
export default function SharedProjectWorkspace({projectId}){
 const [tab,setTab]=useState('team'),[allowed,setAllowed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;loadProjectControl(projectId).then(()=>{if(live)setAllowed(true);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[projectId]);
 if(!allowed)return <LocalizedElement as="p" role={error?'alert':'status'}>{error||'Loading shared project records…'}</LocalizedElement>;
 return <><nav aria-label="Project sections" style={{display:'flex',flexWrap:'wrap',gap:10,marginBottom:20}}>{TABS.map(([id,label])=><LocalizedElement as="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</LocalizedElement>)}</nav>{tab==='team'&&<ProjectControl projectId={projectId}/>} {tab==='selections'&&<MaterialSelectionPanel projectId={projectId}/>} {tab==='schedule'&&<><CommercialSync projectId={projectId}/><ProjectTimeline projectId={projectId}/></>} {tab==='tasks'&&<ProjectTasks projectId={projectId}/>} {tab==='reports'&&<ProjectDailyReports projectId={projectId}/>} {tab==='photos'&&<ProjectPhotos projectId={projectId}/>} {tab==='documents'&&<ProjectDocuments projectId={projectId}/>} {tab==='activity'&&<ProjectActivity projectId={projectId}/>}</>;
}
