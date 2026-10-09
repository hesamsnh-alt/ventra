-- Requires 20261006_project_control.sql. Independent of the withdrawn workspace-records patch.
create table if not exists public.ventra_schedule_plans (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 payload jsonb not null, revision integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index if not exists ventra_schedule_plans_project on public.ventra_schedule_plans(project_id,created_at desc);
create table if not exists public.ventra_schedule_events (
 id bigint generated always as identity primary key, plan_id uuid not null references public.ventra_schedule_plans(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade, actor_id uuid not null references auth.users(id),
 action text not null, detail jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create or replace function public.ventra_can_plan(p_project uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.ventra_is_owner(p_project) or exists(select 1 from public.ventra_project_members where project_id=p_project and user_id=auth.uid() and role in ('manager','supervisor')));
$$;
alter table public.ventra_schedule_plans enable row level security;
alter table public.ventra_schedule_events enable row level security;
drop policy if exists schedule_plans_read on public.ventra_schedule_plans;
create policy schedule_plans_read on public.ventra_schedule_plans for select to authenticated using(public.ventra_can_read_project(project_id));
drop policy if exists schedule_events_read on public.ventra_schedule_events;
create policy schedule_events_read on public.ventra_schedule_events for select to authenticated using(public.ventra_can_read_project(project_id));
revoke all on public.ventra_schedule_plans,public.ventra_schedule_events from public,anon,authenticated;
grant select on public.ventra_schedule_plans,public.ventra_schedule_events to authenticated;

create or replace function public.ventra_save_schedule_plan(p_project uuid,p_payload jsonb,p_previous uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid; latest uuid; a jsonb; wd text; lastday date;
begin
 if not coalesce(public.ventra_can_plan(p_project),false) then raise exception 'Schedule editing is restricted to the owner, manager or supervisor'; end if;
 perform 1 from public.projects where id=p_project for update;
 select id into latest from public.ventra_schedule_plans where project_id=p_project order by created_at desc,id desc limit 1;
 if latest is distinct from p_previous then raise exception 'The schedule changed. Reload before saving a new baseline'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1500000 then raise exception 'Invalid schedule payload'; end if;
 if coalesce(p_payload->>'version','')<>'1' or jsonb_typeof(p_payload->'activities') is distinct from 'array' then raise exception 'Invalid activities'; end if;
 if jsonb_array_length(p_payload->'activities') not between 1 and 200 then raise exception 'Use 1 to 200 activities'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'activities')) <> jsonb_array_length(p_payload->'activities') then raise exception 'Activity IDs must be unique'; end if;
 for a in select value from jsonb_array_elements(p_payload->'activities') loop
  if coalesce(length(trim(a->>'name')),0)=0 or coalesce((a->>'progress')::numeric,-1)<>0 or coalesce((a->>'quantity')::numeric,0)<=0 or coalesce((a->>'rate')::numeric,0)<=0 or coalesce((a->>'crews')::numeric,0)<=0 then raise exception 'Invalid activity values'; end if;
  if coalesce(a->>'start_date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(a->>'end_date','') !~ '^\d{4}-\d{2}-\d{2}$' or (a->>'end_date')::date < (a->>'start_date')::date then raise exception 'Invalid activity dates'; end if;
  if jsonb_typeof(a->'workDates') is distinct from 'array' or jsonb_array_length(a->'workDates')=0 then raise exception 'Working dates required'; end if;
  if length(a->>'name')>10000 or length(a->>'id')>100 or coalesce((a->>'quantity')::numeric,0) not between 0.000001 and 1e12 or coalesce((a->>'rate')::numeric,0) not between 0.000001 and 1e9 or coalesce((a->>'crews')::numeric,0) not between 1 and 100 or (a->>'crews')::numeric<>trunc((a->>'crews')::numeric) then raise exception 'Invalid quantity, rate or crews'; end if;
  if coalesce((a->>'dailyCapacity')::numeric,0) not between 0.00000001 and 1e14 or coalesce((a->>'waitDays')::numeric,-1) not between 0 and 365 or (a->>'waitDays')::numeric<>trunc((a->>'waitDays')::numeric) then raise exception 'Invalid capacity or waiting period'; end if;
  if jsonb_array_length(a->'workDates')>3660 or coalesce((a->>'workingDays')::integer,0)<>jsonb_array_length(a->'workDates') then raise exception 'Invalid working duration'; end if;
  lastday:=null;
  for wd in select jsonb_array_elements_text(a->'workDates') loop
   if wd !~ '^\d{4}-\d{2}-\d{2}$' or wd::date<(a->>'start_date')::date or wd::date>(a->>'end_date')::date or (lastday is not null and wd::date<=lastday) then raise exception 'Invalid working dates'; end if;
   lastday:=wd::date;
  end loop;
  if a->'workDates'->>0<>a->>'start_date' or lastday<>(a->>'end_date')::date then raise exception 'Working dates must match activity bounds'; end if;
 end loop;
 insert into public.ventra_schedule_plans(project_id,payload,created_by) values(p_project,p_payload,auth.uid()) returning id into pid;
 insert into public.ventra_schedule_events(plan_id,project_id,actor_id,action,detail) values(pid,p_project,auth.uid(),'baseline_saved',jsonb_build_object('previous_plan',latest));
 return pid;
end; $$;
create or replace function public.ventra_update_schedule_progress(p_plan uuid,p_activity text,p_progress numeric,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.ventra_schedule_plans; idx integer; oldp numeric;
begin
 select * into r from public.ventra_schedule_plans where id=p_plan for update;
 if not found or not coalesce(public.ventra_can_plan(r.project_id),false) then raise exception 'Schedule access denied'; end if;
 if p_revision is distinct from r.revision then raise exception 'Another user changed this schedule. Reload and try again'; end if;
 if p_progress is null or p_progress::text in ('NaN','Infinity','-Infinity') or p_progress<0 or p_progress>100 then raise exception 'Progress must be 0 to 100'; end if;
 select (ordinality-1)::integer,(value->>'progress')::numeric into idx,oldp from jsonb_array_elements(r.payload->'activities') with ordinality where value->>'id'=p_activity;
 if idx is null then raise exception 'Activity not found'; end if;
 update public.ventra_schedule_plans set payload=jsonb_set(jsonb_set(payload,array['activities',idx::text,'progress'],to_jsonb(round(p_progress,2))),array['activities',idx::text,'progress_updated_at'],to_jsonb(clock_timestamp())),revision=revision+1,updated_at=clock_timestamp() where id=p_plan;
 insert into public.ventra_schedule_events(plan_id,project_id,actor_id,action,detail) values(p_plan,r.project_id,auth.uid(),'progress_updated',jsonb_build_object('activity',p_activity,'previous',oldp,'progress',round(p_progress,2)));
end; $$;
revoke all on function public.ventra_can_plan(uuid),public.ventra_save_schedule_plan(uuid,jsonb,uuid),public.ventra_update_schedule_progress(uuid,text,numeric,integer) from public,anon;
grant execute on function public.ventra_can_plan(uuid),public.ventra_save_schedule_plan(uuid,jsonb,uuid),public.ventra_update_schedule_progress(uuid,text,numeric,integer) to authenticated;
