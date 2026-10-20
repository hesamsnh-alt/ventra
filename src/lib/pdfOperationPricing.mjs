import {resolvePdfCatalogRate} from './boqCatalogRate.mjs';
const unit=v=>({'m²':'m2',sqm:'m2','m³':'m3',cum:'m3',nos:'nr',no:'nr',each:'nr',point:'nr',lm:'m'}[String(v).toLowerCase()]||String(v).toLowerCase());
export function operationRateContract(item){
 try{const r=typeof item?.source_reference==='string'?JSON.parse(item.source_reference):item?.source_reference;
  return r?.kind==='construction_operation_rate'&&r.version===1&&r.enabled===true?r:null;
 }catch{return null;}
}
// Source codes are arbitrary. Match the measured operation and specification,
// never a project ID, benchmark row, nearest price, or a model's invented rate.
export function pdfOperationProfile(operation){
 const family=operation.family,d=String(operation.sourceDescription||'').toLowerCase().replace(/[-–]/g,' '),p={family};
 const one=(name,matches)=>{const xs=[...new Set(matches)];if(xs.length===1)p[name]=xs[0];};
 if(family==='pipe'){
  one('material',[...d.matchAll(/\b(ppr|upvc|pvc|cpvc|hdpe|copper|pex)\b/g)].map(m=>m[1]==='pvc'?'upvc':m[1]));
  one('diameter_mm',[...d.matchAll(/(?:\bdn\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*mm\b)/g)].map(m=>Number(m[1]||m[2])));
  p.insulated=/\binsulated\b/.test(d)&&!/\buninsulated\b/.test(d);
 }
 if(family==='floor'||family==='skirting'){
  one('material',['porcelain','lvt','terrazzo','ceramic','mdf','spc','marble','granite','wood','epoxy','resin'].filter(m=>new RegExp('\\b'+m+'\\b').test(d)));
  p.anti_slip=/anti\s+slip/.test(d);
  if(/glue\s+down/.test(d))p.installation_method='glue_down';else if(/\bclick\b/.test(d))p.installation_method='click';
 }
 if(family==='ceiling-board'){p.material='gypsum';p.moisture_resistant=/moisture\s+resistant/.test(d);p.fire_rated=/fire\s+rated/.test(d);}
 if(family==='ceiling-paint')p.system='ceiling_paint';
 if(family==='external-paint')p.system='exterior_weather_paint';
 if(family==='fixed-glazing'&&/fixed internal glass/.test(d)){p.system='fixed_internal_glass';const m=d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);if(m)p.glass_thickness_mm=Number(m[1]);}
 if(family==='window-set'&&/aluminium double\s+glazed/.test(d)){p.material='aluminium';p.glazing='double';}
 if(family==='door-set'){
  one('material',['timber','metal','glazed','glass'].filter(m=>new RegExp('\\b'+m+'\\b').test(d)));
  p.double_leaf=/\bdouble\b/.test(d);p.external=/\bexternal\b/.test(d);
  const dims=d.match(/\b(\d+\.\d+)\s*x\s*(\d+\.\d+)/);
  if(dims){p.width_m=Number(dims[1]);p.height_m=Number(dims[2]);}
 }
 if(family==='screed'){const m=d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);if(m)p.thickness_mm=Number(m[1]);}
 if(family==='duct-sheet')p.material=/\bgi\b|galvani[sz]ed/.test(d)?'gi':/stainless/.test(d)?'stainless':null;
 if(family==='duct-insulation'){const m=d.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);if(m)p.thickness_mm=Number(m[1]);}
 if(['electrical','electrical-fixture','electrical-point','equipment','fixture','railing','stair-finish'].includes(family)){
  const types=[['fan_coil',/fan\s+coil/],['extract_fan',/extract fans?/],['supply_diffuser',/supply diffusers?/],['return_grille',/return grilles?/],['data',/data outlets?/],['emergency_light',/emergency lights?/],['exit_sign',/exit signs?/],['led_light',/led lights?|led light fittings?/] ,['socket',/socket/],['distribution_board',/distribution board/],['smoke_detector',/smoke detector/],['toilet',/toilet pan|water closet/],['wash_basin',/wash basin/],['shower',/shower/],['switch',/light switches?/],['water_heater',/water heater/],['floor_drain',/floor drain/],['sink',/\bsink\b/],['handrail',/handrail/],['guardrail',/guardrail/],['stair_finish',/stair finish/]];
  one('type',types.filter(([,re])=>re.test(d)).map(([name])=>name));
  const capacity=d.match(/\b(\d+(?:\.\d+)?)\s*kw\b/);if(capacity)p.capacity_kw=Number(capacity[1]);
 }
 if(family==='electrical-route'){
  if(/cable tray/.test(d)){p.type='cable_tray';const m=d.match(/(\d+)\s*x\s*(\d+)\s*mm/);if(m){p.width_mm=+m[1];p.depth_mm=+m[2];}}
  else if(/conduit/.test(d)){p.type='conduit';const m=d.match(/(\d+)\s*mm/);if(m)p.diameter_mm=+m[1];}
  else if(/power cable/.test(d)){p.type='power_cable';const m=d.match(/(\d+)\s*(?:c\s*x|x)\s*(\d+(?:\.\d+)?)\s*mm2/);if(m){p.cores=+m[1];p.area_mm2=+m[2];}}
 }
 return p;
}
export function bindPdfOperationRates(items,catalog,priceLevel='standard'){
 const configured=(catalog||[]).filter(p=>p.is_active!==false).map(p=>({p,c:operationRateContract(p)})).filter(x=>x.c);
 const codes=new Set(configured.map(({p})=>p.item_code));
 return items.filter(item=>!(codes.has(item.itemCode)&&!(item.quantity>0)&&item.source!=='manual')).map(item=>{
  const op=item.pdfEvidence?.operation;
  if(!op||!(item.quantity>0)||item.rate>0&&!item.rateMissing||item.catalogSelection||item.review?.confirmed)return item;
  const profile=pdfOperationProfile(op),matches=[];
  for(const {p,c}of configured){
   if(!c.match||c.match.family!==profile.family||!c.rate_basis||!c.conditions||!c.provenance||p.currency!=='AED')continue;
   const entries=Object.entries(c.match);
   if(entries.some(([k,v])=>!Object.hasOwn(profile,k)||profile[k]!==v))continue;
   // Known source properties cannot be contradicted by an estimating default.
   if(Object.entries(c.assumed_specification||{}).some(([k,v])=>Object.hasOwn(profile,k)&&profile[k]!==v))continue;
   let factor=unit(p.unit)===unit(item.unit)?1:null;
   if(c.unit_basis==='opening_area'&&unit(p.unit)==='m2'&&unit(item.unit)==='nr'&&profile.width_m>0&&profile.height_m>0)factor=profile.width_m*profile.height_m;
   if(c.unit_basis==='area_from_thickness'&&unit(p.unit)==='m2'&&unit(item.unit)==='m3'&&profile.thickness_mm>0)factor=1000/profile.thickness_mm;
   if(!(factor>0))continue;
   matches.push({p,c,factor,specificity:entries.length});
  }
  if(!matches.length)return item;
  // Specific variants beat broad defaults. Equally specific candidates are
  // ambiguous even if one is free/unpriced; price never chooses specification.
  const max=Math.max(...matches.map(m=>m.specificity)),best=matches.filter(m=>m.specificity===max);
  if(best.length!==1)return {...item,operationPricing:{status:'ambiguous',candidate_codes:best.map(m=>m.p.item_code)}};
  const {p,c,factor}=best[0],resolution=resolvePdfCatalogRate(p,priceLevel);
  const section={sectionCode:p.section_code,section:p.category,category:p.category};
  if(resolution.missingRate)return {...item,...section,operationPricing:{status:'catalog_rate_missing',candidate_codes:[p.item_code],required_information:c.required_information||[]}};
  const rate=resolution.rate*factor;
  return {...item,...section,rate,referenceRate:rate,amount:Number(item.quantity)*rate,rateMissing:false,status:'provisional_estimate',verification:'provisional',reviewRequired:true,includeInCommercialTotal:false,
   rateSource:`Operation catalog ${p.item_code}: ${resolution.source}`,source:'PDF source operation + specification-matched budget catalog',
   operationPricing:{status:'priced_provisional',catalog_code:p.item_code,profile,match:c.match,catalog_unit:p.unit,catalog_rate:resolution.rate,rate_factor:factor,rate_basis:c.rate_basis,conditions:c.conditions,provenance:c.provenance,assumed_specification:c.assumed_specification||{},required_information:c.required_information||[]},
   notes:[String(item.notes||'').replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g,''),`OPERATION RATE ${p.item_code}: ${resolution.rate} AED/${p.unit} × ${factor} = ${rate} AED/${item.unit}. ${c.rate_basis}. Conditions: ${c.conditions}. Provisional editable budget only; not a supplier quote or tender approval.`].join(' ')};
 });
}
