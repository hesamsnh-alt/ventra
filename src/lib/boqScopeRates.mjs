import {boqUnitFactor,catalogPriceEntries} from './boqPriceSelection.mjs';
import {scopeMetric} from './boqScope.mjs';
// Conservative matching against the existing read-only catalog. Ambiguity is a gap, never a guessed price.
const patterns={
 ceramic_floor_area:/ceramic|porcelain/,wood_floor_area:/wood|parquet|lvt|spc/,stone_floor_area:/stone|marble|granite/,
 cement_floor_area:/cement|concrete/,unallocated_floor_finish_area:/ceramic|porcelain|stone|wood|cement/,
 screed_area:/screed/,gypsum_ceiling_area:/gypsum.*ceiling|ceiling.*gypsum/,ceiling_paint_area:/ceiling.*paint|paint.*ceiling/,roof_waterproofing_area:/roof.*waterproof|waterproof.*roof/,plaster_area:/plaster/,paint_area:/paint/,wet_wall_tile_area:/wall.*tile|tile.*wall/,
 wet_floor_waterproofing_area:/waterproof|membrane/,wet_wall_waterproofing_area:/waterproof|membrane/,
 toilet_count:/toilet|water closet|\bwc\b/,basin_count:/wash.?basin/,
 basin_tap_count:/(?:basin.*(?:tap|mixer)|(?:tap|mixer).*basin)/,
 kitchen_sink_count:/(?:kitchen.*sink|sink.*kitchen)/,kitchen_tap_count:/(?:kitchen.*(?:tap|mixer)|(?:tap|mixer).*kitchen)/,
 shower_count:/shower/,kitchen_cabinet_length:/kitchen.*cabinet|base.*cabinet/,light_count:/lighting point/,
};
export function priceScopeDefaults(items,catalog){
 const entries=Array.isArray(catalog)?catalog:catalogPriceEntries(catalog);
 return items.map(row=>{
  if(!row.scopeDefault||Number(row.rate)>0)return row;
  const metric=scopeMetric(row),pattern=patterns[metric];if(!pattern)return row;
  const candidates=entries.filter(e=>{
   const d=String(e.description||'').toLowerCase(),factor=boqUnitFactor(row.unit,e.unit);
   if(factor!==1||!(Number(e.rate)>0)||!pattern.test(d))return false;
   if(metric.includes('floor')&&metric.includes('area')&&!/waterproof/.test(metric)&&!/(?:floor|flooring)/.test(d))return false;
   if(metric==='ceramic_floor_area'&&!d.includes(row.description.toLowerCase().includes('porcelain')?'porcelain':'ceramic'))return false;
   if(metric==='screed_area'&&!/50\s*mm/.test(d))return false;
   if(metric==='paint_area'&&/ceiling|external|exterior|steel|wood/.test(d))return false;
   if(metric==='plaster_area'&&/external|exterior/.test(d))return false;
   if(metric.startsWith('wet_')&&!/wet|bath|toilet/.test(d))return false;
   if(metric==='wet_wall_waterproofing_area'&&!/upstand/.test(d))return false;
   if(metric==='wet_floor_waterproofing_area'&&/upstand/.test(d))return false;
   if(['toilet_count','basin_count','kitchen_sink_count','shower_count'].includes(metric)&&!/set|complete|including|incl\./.test(d))return false;
   // Do not price a separate mixer if a chosen fixture package already includes fittings.
   if(metric.endsWith('_tap_count'))return false;
   return true;
  });
  if(candidates.length!==1)return {...row,scopeRateMatch:{status:candidates.length?'ambiguous':'missing',candidateCodes:candidates.map(x=>x.itemCode)}};
  const chosen=candidates[0],rate=Number(chosen.rate);
  return {...row,description:chosen.description+' [scope default specification; editable]',rate,referenceRate:rate,amount:Number(row.quantity)*rate,rateMissing:false,
   status:'provisional_estimate',verification:'provisional',reviewRequired:true,includeInCommercialTotal:false,
   rateSource:`Existing catalog ${chosen.itemCode}; ${chosen.rateSource||'recorded rate'}`,
   scopeRateMatch:{status:'matched',catalogCode:chosen.itemCode,description:chosen.description},
   notes:row.notes+` Existing catalog specification assumed: ${chosen.itemCode}; ${chosen.description}. Confirm inclusions and installation scope.`};
 });
}
export function removeIncludedDefaultComponents(items){
 const fixturePackage=metric=>items.find(i=>i.scopeDefault&&scopeMetric(i)===metric&&i.scopeRateMatch?.status==='matched'&&/fittings|mixer|tap/.test(i.scopeRateMatch.description.toLowerCase()));
 return items.filter(i=>!(i.scopeDefault&&((scopeMetric(i)==='basin_tap_count'&&fixturePackage('basin_count'))||(scopeMetric(i)==='kitchen_tap_count'&&fixturePackage('kitchen_sink_count')))));
}
