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
