// Resolve only rates recorded on this catalog item; never borrow a peer rate.
export function resolvePdfCatalogRate(item, priceLevel='standard') {
  const positive=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;
  const components=['material_rate','labor_rate','equipment_rate','transport_rate'].map(k=>Number(item?.[k]||0));
  const rates={standard:positive(item?.standard_rate),economy:positive(item?.economy_rate),premium:positive(item?.premium_rate),
    component:components.every(v=>Number.isFinite(v)&&v>=0)?positive(components.reduce((a,b)=>a+b,0)):0};
  const level=String(priceLevel||'standard').toLowerCase();
  const order=level==='economy'?['economy','standard','premium','component']:level==='premium'?['premium','standard','economy','component']:['standard','economy','premium','component'];
  for(const key of order)if(rates[key]>0)return {rate:rates[key],source:key===level?`direct_${key}_rate`:`fallback_${key}_rate`,peerCount:0,missingRate:false};
  return {rate:0,source:'rate_missing_on_catalog_item',peerCount:0,missingRate:true};
}
