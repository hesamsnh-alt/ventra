-- Apply after 20261007_commercial_foundation.sql. No historical usage is reset.
-- A failed attempt is released only by the server, for the exact reservation.
create or replace function public.ventra_release_analysis(
 p_owner uuid,p_actor uuid,p_project uuid,p_action text,p_request text,p_hash text
) returns boolean language plpgsql security definer set search_path='' as $$
declare released bigint;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 delete from public.ventra_analysis_usage
 where owner_id=p_owner and actor_id=p_actor and project_id=p_project
 and action=p_action and request_id=p_request and request_hash=p_hash
 returning id into released;
 return released is not null;
end; $$;
revoke all on function public.ventra_release_analysis(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.ventra_release_analysis(uuid,uuid,uuid,text,text,text) to service_role;
