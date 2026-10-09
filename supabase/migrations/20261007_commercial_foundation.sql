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
