"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import { useEffect, useState } from "react";
import {planProgress} from "@/lib/boqSchedule.mjs";
import { listWorkspaceRecords } from "@/services/workspaceRecordsService";
import "./ProjectActivity.css";
export default function ProjectActivity({ projectId }) {
 const [data,setData]=useState({tasks:[],schedule:[],reports:[],activity:[],progress:{}}),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{listWorkspaceRecords(projectId).then(r=>{setData(r);setError(r.error?.message||"");setLoading(false);});},[projectId]);
 const schedule=data.plan?planProgress(data.plan):null;
 return <LocalizedElement as="section" className="activity-panel"><LocalizedElement as="h2">Workspace activity</LocalizedElement>{loading&&<LocalizedElement as="p">Loading shared activity…</LocalizedElement>}{error&&<LocalizedElement as="p" role="alert">{error}</LocalizedElement>}<LocalizedElement as="p">Shared records: {data.tasks.length} tasks · {data.plan?.activities?.length||0} scheduled activities · {data.reports.length} daily reports.</LocalizedElement><LocalizedElement as="p">Calculated progress: tasks {data.progress.task_progress ?? "—"}% · BOQ schedule {schedule?.percent ?? "—"}% (planned crew effort).</LocalizedElement><LocalizedElement as="div">{data.activity.map(item=><LocalizedElement as="p" key={item.id}><LocalizedElement as="strong">{item.action}</LocalizedElement> · {item.entity} · {new Date(item.created_at).toLocaleString("en-AE")}</LocalizedElement>)}</LocalizedElement></LocalizedElement>;
}
