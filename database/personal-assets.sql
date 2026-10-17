-- Additive feature only. No existing project, BOQ, price or auth policy changes.
create table if not exists public.ventra_personal_assets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('model','material')), name text not null check(length(name) between 1 and 100),
 furniture_type text not null default 'sofa' check(furniture_type in ('sofa','chair','bed','dining_table','cabinet','plant','desk','coffee_table')),
 width numeric not null default 1 check(width between 0.05 and 6), depth numeric not null default 1 check(depth between 0.05 and 4), height numeric not null default 1 check(height between 0.05 and 3),
 mime text not null, created_at timestamptz not null default now()
);
create index if not exists ventra_personal_assets_user on public.ventra_personal_assets(user_id,created_at desc);
create table if not exists public.ventra_model_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade, image_hash text not null,
 name text not null, furniture_type text not null default 'sofa', width numeric not null default 1, depth numeric not null default 1, height numeric not null default 1,
 status text not null default 'submitting' check(status in ('submitting','pending','ready','failed','unknown')),
 provider_id text, progress integer not null default 0, error text, credits numeric, created_at timestamptz not null default now(),
 unique(user_id,image_hash)
);
create index if not exists ventra_model_jobs_daily on public.ventra_model_jobs(user_id,created_at desc);
create table if not exists public.ventra_project_asset_links (
 project_id uuid not null references public.projects(id) on delete cascade, asset_id uuid not null references public.ventra_personal_assets(id) on delete cascade,
 primary key(project_id,asset_id)
);
create index if not exists ventra_project_asset_links_asset on public.ventra_project_asset_links(asset_id);
alter table public.ventra_personal_assets enable row level security;
alter table public.ventra_model_jobs enable row level security;
alter table public.ventra_project_asset_links enable row level security;
-- All access goes through authenticated server routes with explicit owner/project checks.
revoke all on public.ventra_personal_assets,public.ventra_model_jobs,public.ventra_project_asset_links from public,anon,authenticated;
grant select,insert,update,delete on public.ventra_personal_assets,public.ventra_model_jobs,public.ventra_project_asset_links to service_role;
create or replace function public.ventra_claim_model_job(p_user uuid,p_project uuid,p_hash text,p_name text,p_type text,p_width numeric,p_depth numeric,p_height numeric,p_limit integer,p_global_limit integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.ventra_model_jobs; used integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(140,140);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text,140));
 select * into job from public.ventra_model_jobs where user_id=p_user and image_hash=p_hash;
 if found then return jsonb_build_object('created',false,'job',to_jsonb(job)); end if;
 select count(*) into used from public.ventra_model_jobs where user_id=p_user and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if used>=least(greatest(p_limit,1),10) then raise exception 'Daily model generation limit reached.' using errcode='P0001'; end if;
 if exists(select 1 from public.ventra_model_jobs where user_id=p_user and status in ('submitting','pending','unknown')) then raise exception 'A model request is already pending. Check its status first.' using errcode='P0001'; end if;
 if (select count(*) from public.ventra_model_jobs where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=least(greatest(p_global_limit,1),100) then raise exception 'Site daily model limit reached.' using errcode='P0001'; end if;
 insert into public.ventra_model_jobs(user_id,project_id,image_hash,name,furniture_type,width,depth,height) values(p_user,p_project,p_hash,p_name,p_type,p_width,p_depth,p_height) returning * into job;
 return jsonb_build_object('created',true,'job',to_jsonb(job));
end $$;
revoke all on function public.ventra_claim_model_job(uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer) from public,anon,authenticated;
grant execute on function public.ventra_claim_model_job(uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ventra-personal-assets','ventra-personal-assets',false,26214400,array['model/gltf-binary','image/png','image/jpeg','image/webp'])
 on conflict(id) do nothing;
