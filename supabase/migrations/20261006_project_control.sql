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
