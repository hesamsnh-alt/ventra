-- Ventra v44: run in Supabase SQL Editor for the existing Ventra database.
-- Preserves projects and records; installation is atomic and repeatable.
begin;

-- 20261006_project_control.sql
-- Phase 1. Run in the Supabase SQL editor as the project administrator.
-- Existing project ownership and all existing data are preserved.
create table if not exists public.ventra_project_members (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('manager','supervisor','viewer')),
 email text not null default '',
 joined_at timestamptz not null default now(), primary key(project_id,user_id)
);
alter table public.ventra_project_members add column if not exists email text not null default '';
create table if not exists public.ventra_project_seats (
 project_id uuid primary key references public.projects(id) on delete cascade,
 seat_limit integer not null default 2 check(seat_limit between 2 and 100)
);
create table if not exists public.ventra_project_invites (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 email text not null, role text not null check(role in ('manager','supervisor','viewer')),
 code_hash text unique not null, expires_at timestamptz not null default now()+interval '48 hours',
 accepted_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ventra_project_contracts (
 project_id uuid primary key references public.projects(id) on delete cascade,
 title text not null default '', currency text not null default 'AED' check(currency='AED'),
 amount numeric(16,2) not null check(amount>=0 and amount<100000000000000), retention_pct numeric(5,2) not null default 0 check(retention_pct between 0 and 100),
 notes text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.ventra_payment_stages (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 title text not null check(length(trim(title))>0), percentage numeric(5,2) not null check(percentage>0 and percentage<=100),
 trigger_type text not null check(trigger_type in ('advance','milestone','final')),
 approval_required boolean not null default true, position integer not null default 0
);
create or replace function public.ventra_is_owner(p_project uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects where id=p_project and user_id=auth.uid());
$$;
create or replace function public.ventra_can_read_project(p_project uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.ventra_is_owner(p_project) or exists(select 1 from public.ventra_project_members where project_id=p_project and user_id=auth.uid());
$$;
alter table public.ventra_project_members enable row level security;
alter table public.ventra_project_seats enable row level security;
alter table public.ventra_project_invites enable row level security;
alter table public.ventra_project_contracts enable row level security;
alter table public.ventra_payment_stages enable row level security;
drop policy if exists ventra_member_read on public.ventra_project_members;
create policy ventra_member_read on public.ventra_project_members for select to authenticated using(public.ventra_can_read_project(project_id));
drop policy if exists ventra_member_delete on public.ventra_project_members;
create policy ventra_member_delete on public.ventra_project_members for delete to authenticated using(public.ventra_is_owner(project_id));
drop policy if exists ventra_seats_read on public.ventra_project_seats;
create policy ventra_seats_read on public.ventra_project_seats for select to authenticated using(public.ventra_is_owner(project_id));
drop policy if exists ventra_invites_read on public.ventra_project_invites;
create policy ventra_invites_read on public.ventra_project_invites for select to authenticated using(public.ventra_is_owner(project_id));
drop policy if exists ventra_invites_delete on public.ventra_project_invites;
create policy ventra_invites_delete on public.ventra_project_invites for delete to authenticated using(public.ventra_is_owner(project_id));
drop policy if exists ventra_contract_read on public.ventra_project_contracts;
create policy ventra_contract_read on public.ventra_project_contracts for select to authenticated using(public.ventra_can_read_project(project_id));
drop policy if exists ventra_stage_read on public.ventra_payment_stages;
create policy ventra_stage_read on public.ventra_payment_stages for select to authenticated using(public.ventra_can_read_project(project_id));
-- Shared members use a dedicated control workspace. Legacy project policies are unchanged.
create or replace function public.ventra_control_summary(p_project uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ventra_can_read_project(p_project) then raise exception 'Project access denied'; end if;
 return (select jsonb_build_object('id',id,'name',name,'is_owner',user_id=auth.uid()) from public.projects where id=p_project);
end; $$;
create or replace function public.ventra_create_invite(p_project uuid,p_email text,p_role text,p_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare seats integer; occupied integer; invitation uuid;
begin
 if not public.ventra_is_owner(p_project) then raise exception 'Only the project owner can invite members'; end if;
 if p_role not in ('manager','supervisor','viewer') or p_code !~ '^[a-f0-9]{64}$' or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Invalid invitation'; end if;
 perform 1 from public.projects where id=p_project for update;
 insert into public.ventra_project_seats(project_id) values(p_project) on conflict do nothing;
 select seat_limit into seats from public.ventra_project_seats where project_id=p_project;
 select 1+(select count(*) from public.ventra_project_members where project_id=p_project)+(select count(*) from public.ventra_project_invites where project_id=p_project and accepted_at is null and expires_at>now()) into occupied;
 if occupied>=seats then raise exception 'Project seat limit reached. Ask the operator to enable additional seats.'; end if;
 insert into public.ventra_project_invites(project_id,email,role,code_hash) values(p_project,lower(trim(p_email)),p_role,encode(sha256(convert_to(p_code,'UTF8')),'hex')) returning id into invitation;
 return invitation;
end; $$;
create or replace function public.ventra_accept_invite(p_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.ventra_project_invites; seats integer; occupied integer;
begin
 if auth.uid() is null or p_code !~ '^[a-f0-9]{64}$' then raise exception 'Sign in and enter a valid code'; end if;
 select * into invitation from public.ventra_project_invites where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex');
 if not found then raise exception 'Invitation not found'; end if;
 perform 1 from public.projects where id=invitation.project_id for update;
 select * into invitation from public.ventra_project_invites where id=invitation.id for update;
 if not found then raise exception 'Invitation revoked'; end if;
 if invitation.accepted_at is not null or invitation.expires_at<=now() then raise exception 'Invitation expired or already used'; end if;
 if lower(coalesce(auth.jwt()->>'email',''))<>invitation.email then raise exception 'Sign in with the invited email address'; end if;
 if public.ventra_is_owner(invitation.project_id) then raise exception 'You already own this project'; end if;
 select seat_limit into seats from public.ventra_project_seats where project_id=invitation.project_id;
 select 1+count(*) into occupied from public.ventra_project_members where project_id=invitation.project_id;
 if occupied>=coalesce(seats,2) then raise exception 'Project seat limit reached'; end if;
 insert into public.ventra_project_members(project_id,user_id,role,email) values(invitation.project_id,auth.uid(),invitation.role,invitation.email);
 update public.ventra_project_invites set accepted_at=now() where id=invitation.id;
 return invitation.project_id;
end; $$;
-- Entire contract and its payment stages are replaced atomically.
create or replace function public.ventra_save_contract(p_project uuid,p_contract jsonb,p_stages jsonb) returns void language plpgsql security definer set search_path='' as $$
declare total numeric; stage jsonb;
begin
 if not public.ventra_is_owner(p_project) then raise exception 'Only the project owner can edit the contract'; end if;
 if jsonb_typeof(p_stages)<>'array' or jsonb_array_length(p_stages)>100 then raise exception 'Invalid payment stages'; end if;
 select sum(round((value->>'percentage')::numeric,2)) into total from jsonb_array_elements(p_stages);
 if total is null or abs(total-100)>0.001 then raise exception 'Payment percentages must total 100'; end if;
 perform 1 from public.projects where id=p_project for update;
 insert into public.ventra_project_contracts(project_id,title,amount,retention_pct,notes) values(p_project,coalesce(p_contract->>'title',''),(p_contract->>'amount')::numeric,coalesce((p_contract->>'retention_pct')::numeric,0),coalesce(p_contract->>'notes',''))
 on conflict(project_id) do update set title=excluded.title,amount=excluded.amount,retention_pct=excluded.retention_pct,notes=excluded.notes,updated_at=now();
 delete from public.ventra_payment_stages where project_id=p_project;
 for stage in select value from jsonb_array_elements(p_stages) loop
  insert into public.ventra_payment_stages(project_id,title,percentage,trigger_type,approval_required,position) values(p_project,stage->>'title',(stage->>'percentage')::numeric,stage->>'trigger_type',true,coalesce((stage->>'position')::integer,0));
 end loop;
end; $$;
revoke all on public.ventra_project_members,public.ventra_project_seats,public.ventra_project_invites,public.ventra_project_contracts,public.ventra_payment_stages from anon,authenticated;
grant select,delete on public.ventra_project_members,public.ventra_project_invites to authenticated;
grant select on public.ventra_project_seats,public.ventra_project_contracts,public.ventra_payment_stages to authenticated;
revoke all on function public.ventra_is_owner(uuid),public.ventra_can_read_project(uuid),public.ventra_control_summary(uuid),public.ventra_create_invite(uuid,text,text,text),public.ventra_accept_invite(text),public.ventra_save_contract(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.ventra_is_owner(uuid),public.ventra_can_read_project(uuid),public.ventra_control_summary(uuid),public.ventra_create_invite(uuid,text,text,text),public.ventra_accept_invite(text),public.ventra_save_contract(uuid,jsonb,jsonb) to authenticated;

-- 20261007_boq_schedule_plans.sql
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

-- 20261007_commercial_foundation.sql
-- Requires 20261006_project_control.sql. No changes to existing projects or geometry.
create table if not exists public.ventra_analysis_usage (
 id bigint generated always as identity primary key,
 owner_id uuid not null references auth.users(id), actor_id uuid not null references auth.users(id),
 project_id uuid not null references public.projects(id) on delete cascade,
 action text not null check(action in ('drawing','design','preview')),
 request_id text not null, request_hash text not null,
 created_at timestamptz not null default now(),
 unique(actor_id,action,request_id)
);
create index if not exists ventra_usage_owner_date on public.ventra_analysis_usage(owner_id,created_at);
alter table public.ventra_analysis_usage enable row level security;
revoke all on public.ventra_analysis_usage from public,anon,authenticated;
grant select on public.ventra_analysis_usage to authenticated;
grant all on public.ventra_analysis_usage to service_role;
grant usage,select on sequence public.ventra_analysis_usage_id_seq to service_role;
drop policy if exists ventra_usage_read on public.ventra_analysis_usage;
create policy ventra_usage_read on public.ventra_analysis_usage for select to authenticated using(owner_id=auth.uid());

create or replace function public.ventra_consume_analysis(p_owner uuid,p_actor uuid,p_project uuid,p_action text,p_request text,p_hash text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer; month_start timestamptz; old_hash text;
begin
 if p_action is null or p_limit is null or p_hash is null or p_action not in ('drawing','design','preview') or p_limit not between 1 and 1000 or p_request is null or length(p_request)>180 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid usage request'; end if;
 if not exists(select 1 from public.projects where id=p_project and user_id=p_owner) then raise exception 'Invalid project owner'; end if;
 if p_actor<>p_owner and not exists(select 1 from public.ventra_project_members where project_id=p_project and user_id=p_actor and role in ('manager','supervisor')) then raise exception 'Project access denied'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 select request_hash into old_hash from public.ventra_analysis_usage where actor_id=p_actor and action=p_action and request_id=p_request;
 if found then return jsonb_build_object('accepted',false,'duplicate',true); end if;
 month_start:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 select count(*) into n from public.ventra_analysis_usage where owner_id=p_owner and created_at>=month_start;
 if n>=p_limit then return jsonb_build_object('accepted',false,'used',n,'limit',p_limit); end if;
 insert into public.ventra_analysis_usage(owner_id,actor_id,project_id,action,request_id,request_hash) values(p_owner,p_actor,p_project,p_action,p_request,p_hash);
 return jsonb_build_object('accepted',true,'used',n+1,'limit',p_limit);
end; $$;
revoke all on function public.ventra_consume_analysis(uuid,uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ventra_consume_analysis(uuid,uuid,uuid,text,text,text,integer) to service_role;

create table if not exists public.ventra_commercial_snapshots (
 project_id uuid primary key references public.projects(id) on delete cascade,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8388608),
 revision bigint not null default 1 check(revision>0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
alter table public.ventra_commercial_snapshots enable row level security;
revoke all on public.ventra_commercial_snapshots from public,anon,authenticated;
grant select on public.ventra_commercial_snapshots to authenticated;
drop policy if exists ventra_commercial_read on public.ventra_commercial_snapshots;
create policy ventra_commercial_read on public.ventra_commercial_snapshots for select to authenticated using(public.ventra_can_read_project(project_id));
create or replace function public.ventra_save_commercial(p_project uuid,p_payload jsonb,p_expected bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_revision bigint; saved public.ventra_commercial_snapshots;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if not public.ventra_is_owner(p_project) and not exists(select 1 from public.ventra_project_members where project_id=p_project and user_id=auth.uid() and role in ('manager','supervisor')) then raise exception 'Project edit access required'; end if;
 if p_expected is null or p_expected<0 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8388608 then raise exception 'Invalid snapshot'; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) as keys(key) where key not in ('boq','estimate','quotation','branding')) then raise exception 'Invalid snapshot section'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project::text,1));
 select revision into current_revision from public.ventra_commercial_snapshots where project_id=p_project;
 if coalesce(current_revision,0)<>p_expected then raise exception 'SNAPSHOT_CONFLICT: another user saved changes. Load the shared version first.' using errcode='40001'; end if;
 insert into public.ventra_commercial_snapshots(project_id,payload,revision,updated_by) values(p_project,p_payload,1,auth.uid())
 on conflict(project_id) do update set payload=excluded.payload,revision=public.ventra_commercial_snapshots.revision+1,updated_by=auth.uid(),updated_at=now()
 returning * into saved;
 return jsonb_build_object('revision',saved.revision,'updatedAt',saved.updated_at);
end; $$;
revoke all on function public.ventra_save_commercial(uuid,jsonb,bigint) from public,anon;
grant execute on function public.ventra_save_commercial(uuid,jsonb,bigint) to authenticated;
-- Distributed support AI allowance, independent of paid project analyses.
create table if not exists public.ventra_help_usage (
 actor_id uuid not null references auth.users(id) on delete cascade,
 usage_day date not null, used integer not null default 0 check(used between 0 and 10),
 primary key(actor_id,usage_day)
);
alter table public.ventra_help_usage enable row level security;
revoke all on public.ventra_help_usage from public,anon,authenticated;
grant all on public.ventra_help_usage to service_role;
create or replace function public.ventra_consume_help(p_actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.ventra_help_usage(actor_id,usage_day,used) values(p_actor,(now() at time zone 'UTC')::date,1)
 on conflict(actor_id,usage_day) do update set used=public.ventra_help_usage.used+1 where public.ventra_help_usage.used<10 returning used into n;
 return n is not null;
end; $$;
revoke all on function public.ventra_consume_help(uuid) from public,anon,authenticated;
grant execute on function public.ventra_consume_help(uuid) to service_role;

-- 20261008_workspace_records.sql

create table if not exists public.ventra_project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  assignee text not null default '',
  priority text not null default 'Medium' check (priority in ('Low','Medium','High')),
  status text not null default 'Pending' check (status in ('Pending','In Progress','Completed')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ventra_project_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  start_date date not null,
  end_date date not null,
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create table if not exists public.ventra_daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null default current_date,
  workers integer not null default 0 check (workers >= 0),
  weather text not null default '', progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  materials text not null default '', issues text not null default '', notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.ventra_project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id), action text not null, entity text not null,
  entity_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.ventra_project_tasks enable row level security;
alter table public.ventra_project_schedule enable row level security;
alter table public.ventra_daily_reports enable row level security;
alter table public.ventra_project_activity enable row level security;

do $$ declare t text; begin
  foreach t in array array['ventra_project_tasks','ventra_project_schedule','ventra_daily_reports','ventra_project_activity'] loop
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using(public.ventra_can_read_project(project_id))',t||'_read',t);
  end loop;
end $$;
drop policy if exists ventra_tasks_write on public.ventra_project_tasks;
create policy ventra_tasks_write on public.ventra_project_tasks for all to authenticated using(public.ventra_can_plan(project_id)) with check(public.ventra_can_plan(project_id));
drop policy if exists ventra_schedule_write on public.ventra_project_schedule;
create policy ventra_schedule_write on public.ventra_project_schedule for all to authenticated using(public.ventra_can_plan(project_id)) with check(public.ventra_can_plan(project_id));
drop policy if exists ventra_reports_write on public.ventra_daily_reports;
create policy ventra_reports_write on public.ventra_daily_reports for all to authenticated using(public.ventra_can_plan(project_id)) with check(public.ventra_can_plan(project_id));

revoke all on public.ventra_project_tasks,public.ventra_project_schedule,public.ventra_daily_reports,public.ventra_project_activity from public,anon,authenticated;
grant select,insert,update,delete on public.ventra_project_tasks,public.ventra_project_schedule,public.ventra_daily_reports to authenticated;
grant select on public.ventra_project_activity to authenticated;

create or replace function public.ventra_log_workspace_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.ventra_project_activity(project_id,actor_id,action,entity,entity_id,details)
  values(coalesce((to_jsonb(new)->>'project_id')::uuid,(to_jsonb(old)->>'project_id')::uuid),auth.uid(),lower(tg_op),tg_table_name,coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid),jsonb_build_object('title',coalesce(to_jsonb(new)->>'title',to_jsonb(new)->>'name',to_jsonb(new)->>'notes',to_jsonb(old)->>'title',to_jsonb(old)->>'name',to_jsonb(old)->>'notes','')));
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists ventra_tasks_activity on public.ventra_project_tasks;
create trigger ventra_tasks_activity after insert or update or delete on public.ventra_project_tasks for each row execute function public.ventra_log_workspace_change();
drop trigger if exists ventra_schedule_activity on public.ventra_project_schedule;
create trigger ventra_schedule_activity after insert or update or delete on public.ventra_project_schedule for each row execute function public.ventra_log_workspace_change();
drop trigger if exists ventra_reports_activity on public.ventra_daily_reports;
create trigger ventra_reports_activity after insert or update or delete on public.ventra_daily_reports for each row execute function public.ventra_log_workspace_change();

-- Status counts are informational. Physical progress remains separately reported.
create or replace function public.ventra_project_progress(p_project uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.ventra_can_read_project(p_project) then raise exception 'Project access denied'; end if;
 select jsonb_build_object('task_total',count(*),'task_completed',count(*) filter(where status='Completed'),
  'task_progress',case when count(*)=0 then null else round(100.0*count(*) filter(where status='Completed')/count(*),2) end)
 into result from public.ventra_project_tasks where project_id=p_project;
 return result;
end; $$;
revoke all on function public.ventra_project_progress(uuid),public.ventra_log_workspace_change() from public,anon;
grant execute on function public.ventra_project_progress(uuid) to authenticated;

-- 20261008_shared_documents.sql
create table if not exists public.project_documents (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references auth.users(id),file_name text not null,file_path text not null unique,
 file_type text not null default '',file_size bigint not null default 0 check(file_size>=0 and file_size<=104857600),
 category text not null default 'document',status text not null default 'uploaded',created_at timestamptz not null default now()
);
alter table public.project_documents enable row level security;
grant select,insert,update,delete on public.project_documents to authenticated;
drop policy if exists ventra_documents_team_read on public.project_documents;
create policy ventra_documents_team_read on public.project_documents for select to authenticated using(public.ventra_can_read_project(project_id));
drop policy if exists ventra_documents_read_guard on public.project_documents;
create policy ventra_documents_read_guard on public.project_documents as restrictive for select to authenticated using(public.ventra_can_read_project(project_id));
drop policy if exists ventra_documents_team_write on public.project_documents;
create policy ventra_documents_team_write on public.project_documents for all to authenticated using(public.ventra_can_plan(project_id)) with check(public.ventra_can_plan(project_id));
-- Restrictive policies also constrain any legacy uploader-only permissive policies.
drop policy if exists ventra_documents_insert_guard on public.project_documents;
create policy ventra_documents_insert_guard on public.project_documents as restrictive for insert to authenticated with check(public.ventra_can_plan(project_id) and user_id=auth.uid() and file_path like auth.uid()::text||'/'||project_id::text||'/%');
drop policy if exists ventra_documents_update_guard on public.project_documents;
create policy ventra_documents_update_guard on public.project_documents as restrictive for update to authenticated using(public.ventra_can_plan(project_id)) with check(public.ventra_can_plan(project_id));
drop policy if exists ventra_documents_delete_guard on public.project_documents;
create policy ventra_documents_delete_guard on public.project_documents as restrictive for delete to authenticated using(public.ventra_can_plan(project_id));
create or replace function public.ventra_document_project(p_name text) returns uuid language sql immutable set search_path='' as $$
 select case when split_part(p_name,'/',2) ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then split_part(p_name,'/',2)::uuid else null end;
$$;
revoke all on function public.ventra_document_project(text) from public,anon;
grant execute on function public.ventra_document_project(text) to authenticated;
-- Supabase Storage uses the existing uploader/project/file path format.
insert into storage.buckets(id,name,public,file_size_limit) values('project-files','project-files',false,104857600) on conflict(id) do update set public=false;
drop policy if exists ventra_files_read on storage.objects;
create policy ventra_files_read on storage.objects for select to authenticated using(bucket_id='project-files' and public.ventra_can_read_project(public.ventra_document_project(name)));
drop policy if exists ventra_files_read_guard on storage.objects;
create policy ventra_files_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'project-files' or public.ventra_can_read_project(public.ventra_document_project(name)));
drop policy if exists ventra_files_insert on storage.objects;
create policy ventra_files_insert on storage.objects for insert to authenticated with check(bucket_id='project-files' and split_part(name,'/',1)=auth.uid()::text and public.ventra_can_plan(public.ventra_document_project(name)));
drop policy if exists ventra_files_delete on storage.objects;
create policy ventra_files_delete on storage.objects for delete to authenticated using(bucket_id='project-files' and public.ventra_can_plan(public.ventra_document_project(name)));
drop policy if exists ventra_files_insert_guard on storage.objects;
create policy ventra_files_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'project-files' or (split_part(name,'/',1)=auth.uid()::text and public.ventra_can_plan(public.ventra_document_project(name))));
drop policy if exists ventra_files_delete_guard on storage.objects;
create policy ventra_files_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'project-files' or public.ventra_can_plan(public.ventra_document_project(name)));
drop policy if exists ventra_files_update_guard on storage.objects;
create policy ventra_files_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'project-files' or public.ventra_can_plan(public.ventra_document_project(name))) with check(bucket_id<>'project-files' or public.ventra_can_plan(public.ventra_document_project(name)));

commit;
