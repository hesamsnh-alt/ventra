import {pdfOperationProfile} from './pdfOperationPricing.mjs';
import {declaredOperationKind} from './pdfDeclaredScheduleOperations.mjs';
const band=(spans,y)=>spans.filter(s=>Math.abs(s.y-y)<1.5).sort((a,b)=>a.x-b.x);
const unit=v=>({'m²':'m2','m³':'m3',nos:'nr',no:'nr',point:'nr',set:'nr'}[String(v).toLowerCase()]||String(v).toLowerCase());
const normalized=s=>String(s||'').toLowerCase().replace(/[-–]/g,' ').replace(/\s+/g,' ').trim();
// A rate is never a source of a quantity. Only explicit currency/unit columns
// constitute a rate book; numbers in notes or model output cannot price work.
export function readPdfSourceRateBook(pages){
 const rates=[],issues=[];
 for(const page of pages||[]){
  const spans=page.native_text_evidence?.status==='readable'?page.native_text_evidence.spans:[];
  for(const head of spans.filter(s=>s.text==='Code')){
   const cols=band(spans,head.y);
   if(cols.map(s=>s.text).join('|')!=='Code|Operation|Unit|AED/unit')continue;
   const start=rates.length;
   try{
    const anchors=spans.filter(s=>s.y<head.y-3&&Math.abs(s.x-head.x)<10&&/^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/.test(s.text));
    if(!anchors.length||anchors.length>500)throw Error('Empty/excessive source rate book');
    for(const anchor of anchors){
     const row=band(spans,anchor.y),at=i=>{const matches=row.filter(s=>Math.abs(s.x-cols[i].x)<10);if(matches.length!==1)throw Error('Missing source rate cell');return matches[0].text;};
     const raw=at(3),u=unit(at(2));
     if(!/^\d+(?:\.\d+)?$/.test(raw)||!['m','m2','m3','nr'].includes(u)||!(Number(raw)>0&&Number(raw)<1e9))throw Error('Unsupported source rate/unit');
     rates.push({code:anchor.text,description:at(1),unit:u,rate:Number(raw),currency:'AED',page:page.pageNumber});
    }
   }catch(e){rates.splice(start);issues.push(`Source rate page ${page.pageNumber} withheld: ${e.message}`);}
  }
 }
 const groups=new Map();for(const r of rates){const old=groups.get(r.code);if(old&&JSON.stringify([old.description,old.unit,old.rate])!==JSON.stringify([r.description,r.unit,r.rate])){issues.push('Conflicting source rates for '+r.code);groups.set(r.code,{invalid:true});}else if(!old)groups.set(r.code,r);}
 return {rates:[...groups.values()].filter(r=>!r.invalid),issues};
}
function rateScope(r){
 const d=normalized(r.description),u=r.unit;
 if(u==='m2'){
  const metrics=[[/external masonry|external (?:blockwork|block wall)/,'external_block_area'],[/internal masonry|internal (?:blockwork|block wall)/,'internal_block_area'],[/internal plaster/,'plaster_area'],[/internal wall paint/,'paint_area'],[/wet room wall tile|wet wall tile/,'wet_wall_tile_area'],[/wet floor waterproof/,'wet_floor_waterproofing_area'],[/waterproof upstand/,'wet_wall_waterproofing_area']];
  for(const [re,metric]of metrics)if(re.test(d))return {metric};
  if(/ceiling paint/.test(d))return {family:'ceiling-paint',generic:true};
  if(/gypsum ceiling/.test(d))return {family:'ceiling-board',generic:!/(?:moisture|fire) resistant|fire rated/.test(d)};
  if(/fixed internal glass/.test(d))return {family:'fixed-glazing'};
  if(/window/.test(d))return {family:'window-set'};
  if(/porcelain|wood floor|epoxy floor|ceramic floor|terrazzo/.test(d))return {family:'floor'};
 }
 if(u==='m'&&/skirting/.test(d))return {family:'skirting',generic:/^(?:dry room |dry-room )?skirting$/.test(d)};
 if(u==='nr'&&/door set/.test(d))return {family:'door-set'};
 return declaredOperationKind(r.description);
}
export function bindPdfSourceRates(items,takeoff){
 const book=readPdfSourceRateBook(takeoff?.page_results);
 if(!book.rates.length)return items;
 return items.map(item=>{
  if(!(item.quantity>0)||item.source==='manual'||item.review?.confirmed||item.catalogSelection||item.defaultSpecification?.rateOverridden||item.projectRateOverride||item.projectRateSelection||item.quantitySource==='manual'||item.quantityBasis==='manual_quantity_override')return item;
  const op=item.pdfEvidence?.operation,key=item.pdfEvidence?.metricKey;
  if(!key)return item;
  const candidates=book.rates.filter(r=>{
   if(r.unit!==unit(item.unit))return false;
   const scope=rateScope(r);
   if(!scope)return false;
   if(scope.metric){
    if(scope.metric!==key)return false;
    if(['external_block_area','internal_block_area'].includes(key)){
     const thickness=r.description.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i),kind=key.startsWith('external')?'external':'internal';
     if(thickness){
      const pattern=new RegExp('Solid '+kind+' wall\\s+[A-Z]+\\d+\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*mm','gi');
      const values=(takeoff.page_results||[]).flatMap(p=>(p.native_plan_text?.spans||[]).flatMap(s=>[...s.text.matchAll(pattern)].map(m=>Number(m[1]))));
      if(!values.length||values.some(v=>v!==Number(thickness[1])))return false;
     }
    }
    return true;
   }
   if(!op||op.family!==scope.family)return false;
   const actual=pdfOperationProfile(op),offered=pdfOperationProfile({family:scope.family,sourceDescription:r.description});
   if(Object.entries(offered).some(([k,v])=>k!=='family'&&typeof v!=='boolean'&&Object.hasOwn(actual,k)&&actual[k]!==v))return false;
   if(r.code===op.sourceCode)return true;
   // Explicitly generic finish rates can cover the same operation on several
   // finish codes; unlike door/pipe sizes are never priced via this fallback.
   return scope.generic===true;
  });
  const exact=candidates.filter(r=>r.code===op?.sourceCode),best=exact.length?exact:candidates;
  if(best.length!==1)return item;
  const r=best[0];
  return {...item,rate:r.rate,referenceRate:r.rate,amount:Math.round((item.quantity*r.rate+Number.EPSILON)*100)/100,rateMissing:false,
   rateSource:`Original PDF rate book p.${r.page}: ${r.code}, ${r.rate} AED/${r.unit}`,
   sourceRate:{code:r.code,description:r.description,page:r.page,rate:r.rate,unit:r.unit,currency:r.currency,requires_review:true},
   status:'provisional_estimate',verification:'provisional',reviewRequired:true,includeInCommercialTotal:false,
   notes:[String(item.notes||'').replace(/\s*\[BOQ GAP\][\s\S]*?\[\/BOQ GAP\]/g,'').replace(/Quantity retained without assuming a catalog specification or rate\. Not included in tender or priced budget\./g,''),`SOURCE RATE BOOK: page ${r.page}, ${r.code} ${r.description}: ${r.rate} AED/${r.unit}. Editable source budget rate; not a current market quotation or tender approval.`].join(' ')};
 });
}
