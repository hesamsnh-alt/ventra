-- Additive, server-only selection drafts and immutable customer-review snapshots.
begin;
create table if not exists public.ventra_selection_boards (
 project_id uuid primary key references public.projects(id) on delete cascade,
 revision integer not null default 1 check(revision>0),
 document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=2097152),
 updated_by uuid,
 updated_at timestamptz not null default now()
);
create table if not exists public.ventra_selection_shares (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.ventra_selection_boards(project_id) on delete cascade,
 board_revision integer not null check(board_revision>0),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1048576),
 previous jsonb,
 created_by uuid,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked boolean not null default false,
 decision text not null default 'pending' check(decision in ('pending','approved','rejected')),
 decided_name text,
 decided_at timestamptz
);
create index if not exists ventra_selection_shares_project_created on public.ventra_selection_shares(project_id,created_at desc);
alter table public.ventra_selection_boards enable row level security;
alter table public.ventra_selection_shares enable row level security;
revoke all on public.ventra_selection_boards,public.ventra_selection_shares from public,anon,authenticated;
grant select,insert,update,delete on public.ventra_selection_boards,public.ventra_selection_shares to service_role;

-- Called only by the server after validating the unguessable review token.
-- Decision, snapshot acceptance and version increment commit atomically.
create or replace function public.ventra_decide_selection(p_hash text,p_decision text,p_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.ventra_selection_shares%rowtype; b public.ventra_selection_boards%rowtype;
begin
 if p_decision is null or p_decision not in ('approved','rejected') or p_name is null or length(trim(p_name))<2 or length(p_name)>100 then
  return jsonb_build_object('error','invalid');
 end if;
 select * into s from public.ventra_selection_shares where token_hash=p_hash for update;
 if not found or s.revoked or s.expires_at<=now() then return jsonb_build_object('error','unavailable'); end if;
 if s.decision<>'pending' then
  if s.decision=p_decision and s.decided_name=trim(p_name) then return jsonb_build_object('decision',s.decision); end if;
  return jsonb_build_object('error','decided');
 end if;
 select * into b from public.ventra_selection_boards where project_id=s.project_id for update;
 if not found or b.revision<>s.board_revision then return jsonb_build_object('error','stale'); end if;
 update public.ventra_selection_shares set decision=p_decision,decided_name=trim(p_name),decided_at=now() where id=s.id;
 if p_decision='approved' then
  update public.ventra_selection_boards set revision=revision+1,updated_at=now(),document=document||jsonb_build_object(
   'baseline',s.snapshot,'approval',jsonb_build_object('shareId',s.id,'name',trim(p_name),'at',now(),'reviewedRevision',s.board_revision)
  ) where project_id=s.project_id;
 end if;
 return jsonb_build_object('decision',p_decision);
end;
$$;
revoke all on function public.ventra_decide_selection(text,text,text) from public,anon,authenticated;
grant execute on function public.ventra_decide_selection(text,text,text) to service_role;
commit;
