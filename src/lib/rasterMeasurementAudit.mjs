import {auditPdfAreaGeometry} from './pdfAreaGeometry.mjs';

const round=n=>Math.round((n+Number.EPSILON)*1e6)/1e6;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const areaKeys=['floor_area','ceiling_area'];
export const formatRasterAuditNumber=value=>finite(value)?String(round(value)):'—';
function explicitHeight(t){
  if(t.wall_height_source==='user_confirmed_printed_dimension'&&finite(t.wall_height)&&t.wall_height>0)return t.wall_height;
  const notes=String(t.notes||'');
  if(/varying|variable|sloping|stepped|double.height/i.test(notes))return null;
  const values=[...notes.matchAll(/\b(?:wall|room|internal|enclosed)?\s*heights?\s*(?:=|:|is|of|at)?\s*(\d+(?:\.\d+)?)\s*m\b|\b(\d+(?:\.\d+)?)\s*m\s*(?:height|high)\b/gi)].map(m=>Number(m[1]||m[2]));
  if(finite(t.wall_height)&&t.wall_height>0&&typeof t.wall_height_evidence==='string'&&t.wall_height_evidence.trim())values.push(t.wall_height);
  if(finite(t.wall_height)&&t.wall_height>0&&/source|printed|explicit|measured/i.test(t.wall_height_source||'')&&!/default|assum/i.test(t.wall_height_source||''))values.push(t.wall_height);
  return values.length&&values.every(v=>v>0&&v===values[0])?values[0]:null;
}
function operation(t,key){
  const page=t.page_evidence||{},rows=(page.quantities||[]).filter(q=>q.key===key);
  const totals=rows.filter(q=>['project',page.scope_id,page.drawing_id].includes(q.scope_id));
  const selected=totals.length?totals:rows;
  if(!selected.length||selected.some(q=>!finite(q.value)||!q.evidence?.trim()||q.unit!==(/count$/.test(key)?'nr':'m2'))||new Set(selected.map(q=>q.value)).size!==1)return null;
  return selected[0].value;
}
function netWall(t,gross){
  const doors=operation(t,'door_count'),windows=operation(t,'window_count');
  if(!Number.isInteger(doors)||!Number.isInteger(windows))return null;
  const da=doors===0?0:operation(t,'door_area'),wa=windows===0?0:operation(t,'window_area');
  if(doors===0&&operation(t,'door_area')>0||windows===0&&operation(t,'window_area')>0)return null;
  if(!finite(da)||!finite(wa)||doors>0&&da<=0||windows>0&&wa<=0)return null;
  let extra=0;
  if(doors>0){
    const internal=operation(t,'internal_door_count'),entrance=operation(t,'entrance_door_count');
    if(!Number.isInteger(internal)||!Number.isInteger(entrance)||internal+entrance!==doors)return null;
    // Extra deductions require a complete, dimensioned door inventory. Equal
    // recorded door sizes permit a count split; mixed sizes need tagged faces.
    const inventory=(t.detected_items||[]).filter(i=>/\bdoor\b/i.test(i.name||'')).map(i=>{
      if(['m2','m²'].includes(i.unit))return i;
      if(!['nr','nos','no','each'].includes(i.unit)||i.quantity!==1)return {...i,quantity:null};
      const sizes=[...String(i.description||'').matchAll(/(\d+(?:\.\d+)?)\s*(?:m\s*)?[x×]\s*(\d+(?:\.\d+)?)\s*m\b/gi)];
      return {...i,quantity:sizes.length===1?round(Number(sizes[0][1])*Number(sizes[0][2])):null};
    });
    if(inventory.length!==doors||new Set(inventory.map(i=>i.name)).size!==doors||inventory.some(i=>!finite(i.quantity)||i.quantity<=0)||
      Math.abs(inventory.reduce((s,i)=>s+i.quantity,0)-da)>.001||inventory.some(i=>Math.abs(i.quantity-da/doors)>.001))return null;
    extra=internal*da/doors;
  }
  const net=round(gross-da-extra-wa);
  return net>=0?{value:net,basis:`Checked room perimeters × explicit height = ${gross} m2; deduct ${da} m2 door openings, ${extra} m2 additional internal-door faces and ${wa} m2 window openings. Finish specification remains unconfirmed.`}:null;
}

// Private deterministic BOQ/analysis reconciliation. The saved original claims
// and renderer geometry are retained; no model request or template dimensions.
export function reconcileRasterMeasurements(t={}){
  if(t.pdf_analysis||t.page_evidence?.kind!=='floor_plan')return t;
  const height=explicitHeight(t);
  if(t.raster_measurement_audit?.version===2&&t.raster_measurement_audit.height===height)return t;
  const geometry=t.area_geometry;
  if(geometry?.coverage!=='complete'||geometry?.basis!=='clear_internal')return t;
  const checked=auditPdfAreaGeometry({...t,pageNumber:1});
  const report={version:2,height,status:checked.audit?.status,wallMeasurementStatus:'height_required',corrections:[...(t.raster_measurement_audit?.corrections||[])],warnings:checked.warnings.map(s=>s.replaceAll('PDF','Image'))};
  if(checked.audit?.status!=='dimension_geometry_checked')return {...t,raster_measurement_audit:{...report,status:'needs_review',reason:checked.audit?.reason}};
  const next={...t,page_evidence:{...t.page_evidence,quantities:[...t.page_evidence.quantities]},raster_measurement_audit:report};
  const record=(key,value,basis)=>{
    if(!finite(value))return;
    const claims=next.page_evidence.quantities.filter(q=>q.key===key);
    if(Math.abs((t[key]??0)-value)>.000001||claims.some(q=>Math.abs(q.value-value)>.000001))report.corrections.push({key,reported:t[key],reportedClaims:claims,computed:round(value),basis});
    next[key]=round(value);
    next.page_evidence.quantities=next.page_evidence.quantities.filter(q=>q.key!==key);
    next.page_evidence.quantities.push({key,value:next[key],unit:'m2',scope_id:t.page_evidence.scope_id||'image',evidence:basis});
  };
  for(const key of areaKeys)record(key,checked.page[key],'Computed from complete, non-overlapping clear room polygons; wall footprints and voids excluded; outdoor spaces excluded from ceiling. Source dimensions require review.');
  const rooms=new Map(checked.page.detected_items.map(i=>[i.name,i]));
  next.detected_items=(t.detected_items||[]).map(i=>{
    const measured=rooms.get(i.name);
    if(!measured||!['m2','m²'].includes(i.unit))return i;
    if(Math.abs(i.quantity-measured.quantity)>.000001)report.corrections.push({key:'room_area',tag:i.name,reported:i.quantity,computed:round(measured.quantity)});
    return {...i,quantity:round(measured.quantity)};
  });
  const enclosed=geometry.spaces.filter(s=>s.kind==='enclosed');
  if(enclosed.length===t.rooms&&height){
    const gross=round(enclosed.reduce((sum,s)=>sum+s.polygon.reduce((n,p,i)=>{const q=s.polygon[(i+1)%s.polygon.length];return n+Math.hypot(q.x-p.x,q.y-p.y);},0)*height,0));
    record('wall_area',gross,`Gross INTERNAL wall faces from all ${enclosed.length} enclosed room perimeters × explicit height ${height} m; not wall centreline length × height.`);
    report.wallMeasurementStatus='computed';
    const net=netWall(next,gross);
    if(net)next.raster_measurement_audit.netInternalWall=net;
  }
  return next;
}

export function confirmRasterWallHeight(t,value){
  const height=Number(value);
  if(!Number.isFinite(height)||height<=0)throw Error('Enter the positive room height printed on this drawing.');
  const next=reconcileRasterMeasurements({...t,wall_height:height,wall_height_source:'user_confirmed_printed_dimension',wall_height_evidence:`User confirmed printed clear room height: ${height} m.`});
  if(next.raster_measurement_audit?.wallMeasurementStatus!=='computed')throw Error('Complete checked room geometry is required before calculating wall faces.');
  return next;
}
