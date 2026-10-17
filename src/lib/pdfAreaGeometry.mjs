import {recoverNativeRoomInventory} from './pdfNativeRoomInventory.mjs';
const EPS=1e-8;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const signed=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const area=p=>Math.abs(signed(p));
function on(a,b,p){return Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;}
function intersects(a,b,c,d){return (cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function polygon(raw){
 if(!Array.isArray(raw)||raw.length<3||raw.length>64)throw Error('Polygon requires 3–64 dimensioned vertices.');
 let p=raw.map(v=>({x:v.x,y:v.y}));
 if(p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>1e6||Math.abs(v.y)>1e6))throw Error('Invalid polygon coordinates.');
 if(p[0].x===p.at(-1).x&&p[0].y===p.at(-1).y)p.pop();
 for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
  if(j===i+1||(i===0&&j===p.length-1))continue;
  if(intersects(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length]))throw Error('Polygon crosses or touches itself.');
 }
 if(area(p)<EPS)throw Error('Polygon has no usable area.');
 if(signed(p)<0)p.reverse();return p;
}
function triangulate(p){
 const points=[...p],triangles=[];let guard=p.length*p.length;
 while(points.length>3&&guard--){
  let cut=false;
  for(let i=0;i<points.length;i++){
   const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
   if(Math.abs(cross(a,b,c))<EPS){points.splice(i,1);cut=true;break;}
   if(cross(a,b,c)<EPS)continue;
   if(points.some(v=>v!==a&&v!==b&&v!==c&&cross(a,b,v)>=-EPS&&cross(b,c,v)>=-EPS&&cross(c,a,v)>=-EPS))continue;
   triangles.push([a,b,c]);points.splice(i,1);cut=true;break;
  }
  if(!cut)throw Error('Polygon triangulation failed.');
 }
 if(points.length===3)triangles.push(points);else if(points.length>3)throw Error('Polygon triangulation exceeded limit.');
 return triangles;
}
function clip(subject,triangle){
 let out=subject;
 for(let i=0;i<3&&out.length;i++){
  const a=triangle[i],b=triangle[(i+1)%3],input=out;out=[];
  for(let j=0;j<input.length;j++){
   const p=input[j],q=input[(j+1)%input.length],dp=cross(a,b,p),dq=cross(a,b,q),pin=dp>=-EPS,qin=dq>=-EPS;
   if(pin)out.push(p);
   if(pin!==qin){const t=dp/(dp-dq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}
  }
 }
 return out.length>=3?area(out):0;
}
const bbox=p=>({minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minY:Math.min(...p.map(v=>v.y)),maxY:Math.max(...p.map(v=>v.y))});
function intersection(a,b){const x=bbox(a.p),y=bbox(b.p);if(x.maxX<=y.minX+EPS||y.maxX<=x.minX+EPS||x.maxY<=y.minY+EPS||y.maxY<=x.minY+EPS)return 0;return a.t.reduce((s,u)=>s+b.t.reduce((n,v)=>n+clip(u,v),0),0);}
const metricKeys=['floor_area','ceiling_area','wood_floor_area','ceramic_floor_area','epoxy_floor_area','terrace_floor_area'];
const material={wood:'wood_floor_area',tile:'ceramic_floor_area',epoxy:'epoxy_floor_area',outdoor:'terrace_floor_area'};
const inferred=/\binferred\b|\bassumed\b|\bremainder\b|\bderived\b|استنباط|تخمین/i;
const roomTag=name=>String(name||'').match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1]?.toUpperCase();
const labeledFinish=r=>/\bVOID\b/i.test(r.name)||/^VOID\b/i.test(r.description)?'void':/^OUTDOOR\b/i.test(r.description)?'outdoor':/^WOOD\b|^parquet\b/i.test(r.description)?'wood':/^TILE\b|^ceramic\b/i.test(r.description)?'tile':/^EPOXY\b/i.test(r.description)?'epoxy':null;

// A partial polygon set is never called a full geometric survey. Independently
// measure every inferred space; retain only explicit labels for other rooms.
// Their closure is a consistency check, not proof of their physical boundaries.
function partialInventory(page,geometry,spaces,envelopeArea,tolerance){
 if(geometry.basis!=='wall_centerline_zones')throw Error('Partial clear-area geometry cannot resolve missing wall footprints');
 const inventory=new Map(),polygons=new Map(),corrections=[],labels=[],unresolved=[];
 for(const r of spaces){const tag=roomTag(r.tag);if(!tag||polygons.has(tag))throw Error('Partial geometry requires unique printed room tags');polygons.set(tag,r);}
 const nativeInventory=recoverNativeRoomInventory(page,spaces);
 for(const item of nativeInventory.items){
  if(!['m2','m²'].includes(String(item.unit).toLowerCase()))continue;
  const tag=roomTag(item.name);if(!tag)continue;
  if(inventory.has(tag))throw Error(`Duplicate area inventory tag ${tag}`);
  const finish=labeledFinish(item),shape=polygons.get(tag);
  if(!finish||!Number.isFinite(item.quantity)||item.quantity<=0)throw Error(`Missing printed room area/material for ${tag}`);
  if(shape){
   if(shape.kind==='wall'||(finish==='void'?shape.kind!=='void':finish==='outdoor'?shape.kind!=='outdoor':shape.kind!=='enclosed')||(finish!=='void'&&shape.finish!==finish))throw Error(`Conflicting room identity/material for ${tag}`);
   if(Math.abs(item.quantity-shape.quantity)>.01)corrections.push({tag,reported:item.quantity,computed:shape.quantity,evidence:shape.evidence});
   inventory.set(tag,{...item,quantity:shape.quantity,finish,description:`${String(item.description).split('|')[0].trim()} | independently dimensioned polygon: ${shape.evidence}`});
  }else{
   if(inferred.test(item.description||''))unresolved.push(tag);
   else if(!/\bprinted\b|\breported\b|برچسب|چاپ|مذكور|مطبوعة/i.test(item.description||''))throw Error(`Room ${tag} lacks an explicit printed area basis`);
   labels.push(tag);inventory.set(tag,{...item,finish});
  }
 }
 for(const tag of polygons.keys())if(!inventory.has(tag))throw Error(`Dimensioned space ${tag} is absent from the tagged inventory`);
 if(unresolved.length)throw Error(`Inferred rooms still lack dimensioned polygons: ${unresolved.join(', ')}`);
 const list=[...inventory.values()],total=list.reduce((s,r)=>s+r.quantity,0);
 if(!list.length||Math.abs(total-envelopeArea)>tolerance)throw Error('Mixed polygon/printed-area inventory does not reconcile to the dimensioned envelope');
 const dimensions={floor_area:list.filter(r=>r.finish!=='void').reduce((s,r)=>s+r.quantity,0),ceiling_area:list.filter(r=>!['void','outdoor'].includes(r.finish)).reduce((s,r)=>s+r.quantity,0)};
 for(const [finish,key]of Object.entries(material))dimensions[key]=list.filter(r=>r.finish===finish).reduce((s,r)=>s+r.quantity,0);
 const quantities=(page.page_evidence.quantities||[]).filter(q=>!metricKeys.includes(q.key));
 const basis=`Partial dimensioned geometry plus printed room labels on page ${page.pageNumber}; dimensioned tags: ${[...polygons.keys()].join(', ')}; label-only tags: ${labels.join(', ')}; ${geometry.envelope_evidence}. Inventory closure checked; unmeasured room boundaries and AI materials require review.`;
 for(const [key,value]of Object.entries(dimensions))quantities.push({key,value,unit:'m2',scope_id:page.page_evidence.scope_id,evidence:basis});
 const updated={...page,...dimensions,__areaGeometryValidated:true,page_evidence:{...page.page_evidence,quantities},detected_items:nativeInventory.items.map(r=>inventory.has(roomTag(r.name))&&['m2','m²'].includes(String(r.unit).toLowerCase())?Object.fromEntries(Object.entries(inventory.get(roomTag(r.name))).filter(([k])=>k!=='finish')):r)};
 return {page:updated,audit:{page:page.pageNumber,status:'partial_geometry_with_printed_labels',basis:geometry.basis,envelope_area:envelopeArea,covered_area:spaces.reduce((s,r)=>s+r.quantity,0),dimensioned_tags:[...polygons.keys()],label_only_tags:labels,corrections,native_inventory_recovery:nativeInventory.recovered,withheld_metrics:[]},warnings:[`PDF page ${page.pageNumber}: partial area geometry; printed room labels retained provisionally, full room boundaries are not verified.`]};
}

function withheld(page,keys,reason){
 const original=page.__withheldAreaClaims||{claims:(page.page_evidence?.quantities||[]).filter(q=>keys.includes(q.key)),fields:Object.fromEntries(keys.filter(k=>Number.isFinite(page[k])).map(k=>[k,page[k]]))};
 const quantities=(page.page_evidence?.quantities||[]).filter(q=>!keys.includes(q.key));
 const next={...page,__withheldAreaClaims:original,page_evidence:{...page.page_evidence,quantities}};
 for(const key of keys)next[key]=0;
 return {page:next,audit:{page:page.pageNumber,status:'withheld',reason,withheld_metrics:keys,original_area_evidence:original},warnings:[`PDF page ${page.pageNumber}: ${reason}; ${keys.join(', ')} withheld.`]};
}

export function auditPdfAreaGeometry(page){
 if(page.page_evidence?.kind!=='floor_plan')return {page,audit:null,warnings:[]};
 const geometry=page.area_geometry;
 if(!geometry){
  const ambiguous=(page.detected_items||[]).filter(r=>['m2','m²'].includes(String(r.unit).toLowerCase())&&inferred.test(r.description||''));
  if(!ambiguous.length)return {page,audit:{page:page.pageNumber,status:'label_areas_only',reason:'Independent dimensioned polygons unavailable.'},warnings:[]};
  const keys=new Set(['floor_area','ceiling_area']);
  for(const r of ambiguous){const desc=String(r.description||'');if(/^WOOD\b/i.test(desc))keys.add('wood_floor_area');else if(/^TILE\b/i.test(desc))keys.add('ceramic_floor_area');else if(/^EPOXY\b/i.test(desc))keys.add('epoxy_floor_area');else if(/^OUTDOOR\b/i.test(desc))keys.add('terrace_floor_area');else for(const key of Object.values(material))keys.add(key);}
  return withheld(page,[...keys],'Inferred room areas lack independent dimensioned geometry');
 }
 try{
  if(!['wall_centerline_zones','clear_internal'].includes(geometry.basis)||!geometry.envelope_evidence?.trim())throw Error('Independent area measurement basis or envelope evidence missing');
  const envelope=polygon(geometry.envelope),outer={p:envelope,t:triangulate(envelope)},envelopeArea=area(envelope),tolerance=Math.max(.01,envelopeArea*.001);
  if(!Array.isArray(geometry.spaces)||!geometry.spaces.length||geometry.spaces.length>200)throw Error('A complete tagged space inventory is required');
  const seen=new Set(),spaces=[];
  for(const r of geometry.spaces){
   if(!r.tag?.trim()||seen.has(r.tag.trim().toUpperCase())||!r.evidence?.trim()||!['enclosed','outdoor','void','wall'].includes(r.kind)||!['wood','tile','epoxy','outdoor','unknown'].includes(r.finish))throw Error('Missing or duplicate room identity/material/geometry evidence');
   seen.add(r.tag.trim().toUpperCase());
   // A strict model schema can represent a printed-label-only space with an
   // empty polygon. In partial mode it belongs to the label inventory, never
   // the independently measured polygon set. Malformed nonempty polygons and
   // unsupported/inferred labels still fail the existing audit.
   if(geometry.coverage==='partial'&&Array.isArray(r.polygon)&&r.polygon.length===0){
    const tag=roomTag(r.tag),items=(page.detected_items||[]).filter(i=>roomTag(i.name)===tag&&['m2','m²'].includes(String(i.unit).toLowerCase()));
    if(geometry.basis!=='wall_centerline_zones'||!tag||items.length!==1||!Number.isFinite(r.reported_area)||r.reported_area<=0||
       Math.abs(items[0].quantity-r.reported_area)>.01||!(/\bprinted\b|\breported\b|\blabel\b/i.test(r.evidence))||
       inferred.test(items[0].description||'')||!(/\bprinted\b|\breported\b|برچسب|چاپ/i.test(items[0].description||'')))throw Error(`Unmeasured space ${r.tag} lacks a consistent printed label`);
    const finish=labeledFinish(items[0]);
    if(!finish||(finish==='void'?r.kind!=='void':finish==='outdoor'?r.kind!=='outdoor':r.kind!=='enclosed')||(finish!=='void'&&r.finish!==finish))throw Error(`Conflicting printed-label identity/material for ${r.tag}`);
    continue;
   }
   const p=polygon(r.polygon),shape={p,t:triangulate(p)},quantity=area(p);
   if(Math.abs(intersection(shape,outer)-quantity)>tolerance)throw Error(`Space ${r.tag} lies outside the dimensioned envelope`);
   for(const old of spaces)if(intersection(shape,old.shape)>tolerance)throw Error(`Spaces ${old.tag} and ${r.tag} overlap`);
   if(r.kind==='outdoor'&&r.finish!=='outdoor'||r.kind==='enclosed'&&r.finish==='outdoor')throw Error(`Space ${r.tag} has conflicting indoor/outdoor classification`);
   spaces.push({...r,quantity,shape});
  }
  const total=spaces.reduce((s,r)=>s+r.quantity,0);
  if(geometry.coverage==='partial')return partialInventory(page,geometry,spaces,envelopeArea,tolerance);
  if(geometry.coverage!=null&&geometry.coverage!=='complete')throw Error('Unknown area geometry coverage mode');
  if(Math.abs(total-envelopeArea)>tolerance)throw Error('Space polygons do not cover the complete dimensioned envelope');
  const usable=r=>['enclosed','outdoor'].includes(r.kind);
  const dimensions={floor_area:spaces.filter(usable).reduce((s,r)=>s+r.quantity,0),ceiling_area:spaces.filter(r=>r.kind==='enclosed').reduce((s,r)=>s+r.quantity,0)};
  for(const [finish,key]of Object.entries(material))dimensions[key]=spaces.filter(r=>usable(r)&&r.finish===finish).reduce((s,r)=>s+r.quantity,0);
  const scope=page.page_evidence.scope_id,quantities=(page.page_evidence.quantities||[]).filter(q=>!metricKeys.includes(q.key));
  for(const [key,value]of Object.entries(dimensions))quantities.push({key,value,unit:'m2',scope_id:scope,evidence:`Area computed from dimensioned, non-overlapping space polygons (${geometry.basis}) on page ${page.pageNumber}; ${geometry.envelope_evidence}; AI dimension transcription and materials require review.`});
  const corrections=[];
  for(const r of spaces)if(Number.isFinite(r.reported_area)&&Math.abs(r.reported_area-r.quantity)>.01)corrections.push({tag:r.tag,reported:r.reported_area,computed:r.quantity,evidence:r.evidence});
  // Avoid the older inventory routine replacing geometric results with the
  // same AI-reported room area that the audit has just corrected.
  const unknown=spaces.filter(r=>usable(r)&&r.finish==='unknown').map(r=>r.tag);
  const measuredRooms=spaces.filter(r=>r.kind!=='wall').map(r=>({name:r.tag,unit:'m2',quantity:r.quantity,
    description:`${r.kind==='void'?'VOID':r.kind==='outdoor'?'OUTDOOR':r.finish.toUpperCase()} | source dimensioned space: ${r.evidence}`}));
  return {page:{...page,...dimensions,page_evidence:{...page.page_evidence,quantities},__areaGeometryValidated:true,
    detected_items:[...(page.detected_items||[]).filter(i=>!['m2','m²'].includes(String(i.unit).toLowerCase())),...measuredRooms]},
   audit:{page:page.pageNumber,status:'dimension_geometry_checked',basis:geometry.basis,envelope_area:envelopeArea,covered_area:total,corrections,unknown_finish_spaces:unknown,withheld_metrics:unknown.length?Object.values(material):[]},warnings:unknown.length?[`PDF page ${page.pageNumber}: unknown floor finishes; complete material totals withheld.`]:[]};
 }catch(error){return withheld(page,metricKeys,error.message);}
}
