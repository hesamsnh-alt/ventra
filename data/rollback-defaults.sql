-- Optional: disable only this default-specification configuration. Not executed.
begin;
update public.price_items set source_reference=null
where item_code in ('PLB-001','PLB-004')
and source_reference::jsonb->>'batch'='ventra-v131-default-specifications';
update public.price_items set is_active=false
where item_code='VNT-EST-AC-PIPE-PAIR'
and status='ProvisionalEstimate' and standard_rate=72.50
and source_reference::jsonb->>'batch'='ventra-v131-default-specifications';
commit;
