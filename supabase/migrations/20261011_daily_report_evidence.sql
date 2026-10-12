-- Apply after the workspace records installer. Existing reports remain valid.
alter table public.ventra_daily_reports add column if not exists site_evidence jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.ventra_daily_reports'::regclass and conname='ventra_daily_evidence_shape') then
  alter table public.ventra_daily_reports add constraint ventra_daily_evidence_shape check(site_evidence is null or (jsonb_typeof(site_evidence)='object' and octet_length(site_evidence::text)<=65536));
 end if;
end $$;
-- Existing RLS policies continue to restrict writes to owners/managers/supervisors.
