-- v89: durable per-user analysis results. Existing tables are unchanged.
create table if not exists public.ventra_preview_jobs (
 id uuid primary key,
 actor_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 status text not null check(status in ('queued','running','completed','failed')),
 nonce_hash text,
 request_body jsonb,
 result jsonb,
 http_status integer,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.ventra_preview_jobs enable row level security;
revoke all on public.ventra_preview_jobs from anon, authenticated;
-- All reads/writes use authenticated server handlers with actor/project checks.
grant all on public.ventra_preview_jobs to service_role;
create index if not exists ventra_preview_jobs_actor_created on public.ventra_preview_jobs(actor_id,created_at);
