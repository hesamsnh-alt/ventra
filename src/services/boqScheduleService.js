import { supabase } from '@/lib/supabase';
export function scheduleError(e){return ['42P01','42883','PGRST202','PGRST205'].includes(e?.code)?'Shared scheduling is not installed. Ask the administrator to run 20261006_project_control.sql, then 20261007_boq_schedule_plans.sql. You can still preview and export a proposal.':e?.message||'Schedule request failed.';}
export async function loadSchedule(projectId){
 const [r,p]=await Promise.all([supabase.from('ventra_schedule_plans').select('*').eq('project_id',projectId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle(),supabase.rpc('ventra_can_plan',{p_project:projectId})]);
 if(r.error)throw r.error;if(p.error)throw p.error;return {plan:r.data,canEdit:p.data===true};
}
export async function saveSchedule(projectId,payload,previous){const r=await supabase.rpc('ventra_save_schedule_plan',{p_project:projectId,p_payload:payload,p_previous:previous||null});if(r.error)throw r.error;return r.data;}
export async function recordScheduleProgress(plan,activity,progress){const r=await supabase.rpc('ventra_update_schedule_progress',{p_plan:plan.id,p_activity:activity,p_progress:Number(progress),p_revision:plan.revision});if(r.error)throw r.error;}
