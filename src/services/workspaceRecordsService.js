import { supabase } from "@/lib/supabase";

function result(data, error) { return { data: data || [], error }; }
export async function listWorkspaceRecords(projectId) {
  const [tasks, schedule, reports, activity, progress, access, plan] = await Promise.all([
    supabase.from("ventra_project_tasks").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("ventra_project_schedule").select("*").eq("project_id", projectId).order("start_date"),
    supabase.from("ventra_daily_reports").select("*").eq("project_id", projectId).order("report_date", { ascending: false }),
    supabase.from("ventra_project_activity").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
    supabase.rpc("ventra_project_progress", { p_project: projectId }),
    supabase.rpc("ventra_can_plan", {p_project:projectId}),
    supabase.from("ventra_schedule_plans").select("payload").eq("project_id",projectId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const failed = [tasks, schedule, reports, activity, progress].find((r) => r.error);
  return { tasks: tasks.data || [], schedule: schedule.data || [], reports: reports.data || [], activity: activity.data || [], progress: progress.data || {}, canEdit:access.data===true, plan:plan.data?.payload||null, error: failed?.error || null };
}
export async function createTask(projectId, task) { const r=await supabase.from("ventra_project_tasks").insert({ project_id: projectId, title: task.title.trim(), assignee: task.assignee?.trim() || "", priority: task.priority || "Medium" }).select().single(); return result(r.data,r.error); }
export async function updateTask(id, updates) { const r = await supabase.from("ventra_project_tasks").update(updates).eq("id", id).select().single(); return result(r.data, r.error); }
export async function deleteTask(id) { return supabase.from("ventra_project_tasks").delete().eq("id", id); }
export async function createSchedule(projectId, row) { const r = await supabase.from("ventra_project_schedule").insert({ project_id: projectId, name: row.name.trim(), start_date: row.start, end_date: row.end, progress: Number(row.progress) || 0 }).select().single(); return result(r.data, r.error); }
export async function updateSchedule(id, updates) { const r = await supabase.from("ventra_project_schedule").update(updates).eq("id", id).select().single(); return result(r.data, r.error); }
export async function deleteSchedule(id) { return supabase.from("ventra_project_schedule").delete().eq("id", id); }
export async function createDailyReport(projectId, report) { const r = await supabase.from("ventra_daily_reports").insert({ project_id: projectId, workers: Number(report.workers) || 0, weather: report.weather || "", progress: Number(report.progress) || 0, materials: report.materials || "", issues: report.issues || "", notes: report.notes || "", ...(report.siteEvidence?{site_evidence:report.siteEvidence}:{}) }).select().single(); return result(r.data, r.error); }
