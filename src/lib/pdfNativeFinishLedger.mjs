// Distinct source finish codes are separate measured operations. Until a
// specification-specific rate is selected they must not inherit one generic
// ceramic/gypsum/paint rate merely because it exists in the catalog.
export function nativePdfFinishLedger(takeoff){
 const report=takeoff?.pdf_analysis,details=report?.document_measurement_review?.native_coordinated_measurements;
 if(!details?.length||details.length!==report?.selected_floor_pages?.length)return null;
 const groups=new Map(),tags=new Set();let total=0;
 for(const floor of details){
  const audit=report.area_validation?.find(a=>a.page===floor.page&&a.status==='native_clear_geometry_checked');
  if(!audit||!floor.rooms?.length||floor.rooms.length!==audit.rooms?.length)return null;
  for(const room of floor.rooms){
   const actual=audit.rooms.find(r=>r.tag===room.tag);
   if(tags.has(room.tag)||!actual||!Number.isFinite(room.floor_area)||Math.abs(room.floor_area-(actual.void?0:actual.area))>1e-7||!room.finish_source_pages?.length)return null;
   tags.add(room.tag);if(room.floor_code==='VOID'){if(room.floor_area!==0) return null;continue;}
   if(!(room.floor_area>0)||!room.floor_description||!room.ceiling_description)return null;
   total+=room.floor_area;
   const add=(family,code,description)=>{const key=`native-${family}:${code}`,old=groups.get(key);if(old&&old.sourceDescription!==description)throw Error('Conflicting native finish descriptions');
    const group=old||{metricKey:key,family,sourceCode:code,sourceDescription:description,quantity:0,unit:'m2',pages:[],rooms:[]};
    group.quantity+=room.floor_area;group.pages=[...new Set([...group.pages,...room.finish_source_pages])];group.rooms.push(room.tag);groups.set(key,group);};
   add('floor',room.floor_code,room.floor_description);
   if(/gypsum/i.test(room.ceiling_description))add('ceiling-board',room.ceiling_code,room.ceiling_description);
   add('ceiling-paint',room.ceiling_code,'Paint to '+room.ceiling_description);
  }
 }
 if(Math.abs(total-(takeoff.scheduled_quantities?.floor_area??takeoff.floor_area))>1e-7)return null;
 return [...groups.values()];
}
export function nativeFinishReplacesMetric(takeoff,key){
 return (['gypsum_ceiling_area','ceiling_paint_area','wood_floor_area','ceramic_floor_area','epoxy_floor_area','terrace_floor_area'].includes(key)||
  takeoff?.pdf_analysis?.document_measurement_review?.native_source_operations?.some(o=>o.replacesMetric===key||o.replacesMetrics?.includes(key)))&&!!nativePdfFinishLedger(takeoff);
}
export function nativePdfSourceOperationLedger(takeoff){
 if(!nativePdfFinishLedger(takeoff))return [];
 return (takeoff.pdf_analysis.document_measurement_review.native_source_operations||[]).filter(o=>
  o.metricKey?.startsWith('native-')&&o.sourceCode&&o.sourceDescription&&Number.isFinite(o.quantity)&&o.quantity>0&&['m','m2','m3','nr'].includes(o.unit)&&
  (o.unit!=='nr'||Number.isInteger(o.quantity))&&o.pages?.length&&o.pages.every(n=>takeoff.page_results?.some(p=>p.pageNumber===n))&&o.basis);
}
