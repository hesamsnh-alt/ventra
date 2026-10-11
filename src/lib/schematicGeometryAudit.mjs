const area=poly=>Math.abs((poly||[]).reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0))/2;
export function schematicGeometryAudit(scene){
 const walls=new Map((scene.walls||[]).map(w=>[String(w.id),w])),issues=[],spans=new Map(),observations=new Map((scene.geometryValidation?.openings?.observations||[]).map(o=>[String(o.id),o]));
 const openings=(scene.openings||[]).map((o,index)=>{
  if(o._syntheticAccess||String(o.id||'').startsWith('synthetic_door_'))issues.push({id:o.id,code:'unverified_synthetic_opening'});
  const wall=walls.get(String(o.wallId)),id=o.id||`opening_${index+1}`;
  if(!wall){issues.push({id,code:'missing_parent_wall'});return {...o,id};}
  const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y,length=Math.hypot(dx,dy),offset=Number(o.offset),width=Number(o.width),center=offset*length;
  if(!(length>0&&width>0&&Number.isFinite(offset))){issues.push({id,code:'invalid_opening_dimensions'});return {...o,id};}
  const observation=observations.get(String(id));
  if(observation?.center){
   const x=wall.start.x+dx*offset,y=wall.start.y+dy*offset;
   if(Math.hypot(x-observation.center.x,y-observation.center.y)>.05)issues.push({id,code:'source_opening_position_adjusted'});
   if(Math.abs(width-Number(observation.widthMeters))>.005)issues.push({id,code:'source_opening_width_adjusted'});
  }
  const start=center-width/2,end=center+width/2;
  if(start<-.02||end>length+.02)issues.push({id,code:'opening_exceeds_wall'});
  const siblings=spans.get(String(o.wallId))||[];
  for(const other of siblings)if(Math.min(end,other.end)-Math.max(start,other.start)>.02)issues.push({id,otherId:other.id,code:'overlapping_openings'});
  siblings.push({start,end,id});spans.set(String(o.wallId),siblings);
  const position=t=>({x:wall.start.x+dx*t/length,y:wall.start.y+dy*t/length});
  return {...o,id,start:position(start),end:position(end),distanceFromWallStart:start,distanceFromWallEnd:length-end,orientationConfirmed:o.orientationSource==='source_image_y_down'&&['start','end'].includes(o.hinge)&&['clockwise','counterclockwise'].includes(o.swing)};
 });
 for(const id of scene.geometryValidation?.openings?.rejectedObservationIds||[])issues.push({id,code:'source_opening_not_preserved'});
 for(const r of scene.rooms||[]) {
  const poly=r.polygon||[];if(!poly.length)continue;
  for(const [axis,field] of [['x','printedWidthMeters'],['y','printedDepthMeters']]) {
   const stated=Number(r[field]);if(!(stated>0))continue;
   const measured=Math.max(...poly.map(p=>p[axis]))-Math.min(...poly.map(p=>p[axis]));
   if(Math.abs(measured-stated)>Math.max(.05,stated*.05))issues.push({id:r.id,code:'printed_dimension_mismatch',axis,statedMeters:stated,measuredMeters:measured});
  }
 }
 return {version:'schematic_geometry_audit_v54',sourceVerified:false,units:'m',width:scene.width,depth:scene.depth,footprintArea:area(scene.footprint),rooms:(scene.rooms||[]).map(r=>{
   const poly=r.polygon||[],measuredWidth=Math.max(...poly.map(p=>p.x))-Math.min(...poly.map(p=>p.x)),measuredDepth=Math.max(...poly.map(p=>p.y))-Math.min(...poly.map(p=>p.y));
   return {id:r.id,name:r.name,type:r.type,area:area(poly),polygon:poly,printedWidthMeters:r.printedWidthMeters||null,printedDepthMeters:r.printedDepthMeters||null,measuredWidthMeters:measuredWidth,measuredDepthMeters:measuredDepth,widthDifferenceMeters:r.printedWidthMeters?measuredWidth-r.printedWidthMeters:null,depthDifferenceMeters:r.printedDepthMeters?measuredDepth-r.printedDepthMeters:null};
  }),doorCount:openings.filter(o=>o.type==='door').length,windowCount:openings.filter(o=>o.type==='window').length,openings,issues,assumptions:{wallHeight:scene.height,wallThickness:scene.wallThickness,externalWallThickness:scene.externalWallThickness,notice:'These display defaults are not verified measurements. Source drawing comparison is still required.'}};
}
