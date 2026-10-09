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
