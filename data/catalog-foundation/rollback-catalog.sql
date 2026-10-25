-- Optional logical rollback, NOT executed. Keeps audit rows instead of deleting them.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
update public.price_items set is_active=false,status='RetiredScope'
where item_code in ('VNT-SCOPE-WOOD-FLOOR','VNT-SCOPE-KITCHEN-CABINET','VNT-SCOPE-KITCHEN-SINK','VNT-SCOPE-LAUNDRY-SINK','VNT-SCOPE-SHOWER','VNT-SCOPE-AC-PIPE','VNT-SCOPE-RAILING','VNT-SCOPE-HOB-HOOD')
and source_reference::jsonb->>'batch'='ventra-catalog-20261015'
and coalesce(standard_rate,0)=0 and coalesce(economy_rate,0)=0 and coalesce(premium_rate,0)=0
and coalesce(material_rate,0)+coalesce(labor_rate,0)+coalesce(equipment_rate,0)+coalesce(transport_rate,0)=0;
update public.price_items set section_code=null,source_name=null,source_reference=null
where item_code in ('PNT-008','PNT-010')
and source_reference::jsonb->>'batch'='ventra-catalog-20261015'
and coalesce(standard_rate,0)=0 and coalesce(economy_rate,0)=0 and coalesce(premium_rate,0)=0
and coalesce(material_rate,0)+coalesce(labor_rate,0)+coalesce(equipment_rate,0)+coalesce(transport_rate,0)=0;
-- ReferenceOnly supplier rows remain inactive for audit.
commit;
