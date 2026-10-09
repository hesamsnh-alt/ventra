-- Read-only database structure report. Does not return customer/project data or keys.
select jsonb_pretty(jsonb_build_object(
 'project_columns',(select coalesce(jsonb_agg(jsonb_build_object('column',column_name,'type',data_type)),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='projects'),
 'ventra_tables',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity)),'[]'::jsonb) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'ventra_%'),
 'access_functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'security_definer',p.prosecdef)),'[]'::jsonb) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ventra_%'),
 'shared_schedule_installed',to_regclass('public.ventra_schedule_plans') is not null and to_regclass('public.ventra_schedule_events') is not null and to_regprocedure('public.ventra_can_plan(uuid)') is not null and to_regprocedure('public.ventra_save_schedule_plan(uuid,jsonb,uuid)') is not null and to_regprocedure('public.ventra_update_schedule_progress(uuid,text,numeric,integer)') is not null,
 'commercial_migration_present',to_regclass('public.ventra_commercial_snapshots') is not null and to_regclass('public.ventra_analysis_usage') is not null,
 'workspace_records_installed',to_regclass('public.ventra_project_tasks') is not null and to_regclass('public.ventra_daily_reports') is not null and to_regclass('public.ventra_project_activity') is not null,
 'shared_documents_installed',to_regclass('public.project_documents') is not null and to_regprocedure('public.ventra_document_project(text)') is not null
)) as ventra_database_structure;
