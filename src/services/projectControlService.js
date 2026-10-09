import {supabase} from '@/lib/supabase';
import {normalizeContract} from '@/lib/projectControl.mjs';
export async function loadProjectControl(projectId){
 const summary=await supabase.rpc('ventra_control_summary',{p_project:projectId});if(summary.error)throw summary.error;
 const requests=[supabase.from('ventra_project_members').select('user_id,email,role,joined_at').eq('project_id',projectId),supabase.from('ventra_project_contracts').select('*').eq('project_id',projectId).maybeSingle(),supabase.from('ventra_payment_stages').select('*').eq('project_id',projectId).order('position')];
 if(summary.data.is_owner)requests.push(supabase.from('ventra_project_invites').select('id,email,role,expires_at,accepted_at').eq('project_id',projectId).is('accepted_at',null),supabase.from('ventra_project_seats').select('seat_limit').eq('project_id',projectId).maybeSingle());
 const results=await Promise.all(requests);for(const r of results)if(r.error)throw r.error;
 return {summary:summary.data,members:results[0].data,contract:results[1].data,stages:results[2].data,invites:results[3]?.data||[],seats:results[4]?.data?.seat_limit||2};
}
export async function inviteMember(projectId,email,role){const bytes=crypto.getRandomValues(new Uint8Array(32));const code=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');const result=await supabase.rpc('ventra_create_invite',{p_project:projectId,p_email:email.trim(),p_role:role,p_code:code});if(result.error)throw result.error;return code;}
export async function removeControlEntry(projectId,id,kind){const table=kind==='invite'?'ventra_project_invites':'ventra_project_members';const column=kind==='invite'?'id':'user_id';const result=await supabase.from(table).delete().eq('project_id',projectId).eq(column,id).select(column);if(result.error)throw result.error;if(!result.data?.length)throw new Error('No record changed. Check your permissions and refresh.');}
export async function saveProjectContract(projectId,contract,stages){const data=normalizeContract(contract,stages);const result=await supabase.rpc('ventra_save_contract',{p_project:projectId,p_contract:data.contract,p_stages:data.stages});if(result.error)throw result.error;}
