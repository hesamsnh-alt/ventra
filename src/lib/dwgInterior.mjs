import {auditDwgOpenings} from './dwgOpeningAudit.mjs';
import {dwgRoomScene,splitDwgRegions} from './dwgFloors.mjs';
import {resolveDwgCalibration} from './dwgCalibration.mjs';
import {applyDesignDefaults} from './designDefaults.mjs';

export const isInteriorSource=source=>source==='schematic'||source==='dwg-interior';
export function dwgInteriorMatches(scene,takeoff){
 return scene?.source==='dwg-engineering-interior'&&!!scene.engineeringUrn&&scene.engineeringUrn===(takeoff?.aps_urn||takeoff?.apsUrn||takeoff?.urn)&&scene.documentId===takeoff?.document_id;
}
export function savedDwgInterior(takeoff){
 const presentation=takeoff?.geometry?.dwgPresentation;
 const scene=presentation?.interiorScenes?.[presentation.activeRegion];
 return scene?.engineeringUrn===(takeoff?.aps_urn||takeoff?.apsUrn||takeoff?.urn)?upgradeDwgInterior(scene,takeoff):null;
}

export function upgradeDwgInterior(scene,takeoff={}){
 if(scene?.source!=='dwg-engineering-interior')return scene;
 const semantics=takeoff.object_details?.rooms||takeoff.advanced_takeoff?.object_details?.rooms||[];
 const audit=auditDwgOpenings(scene.openings,scene.walls);
 const roomUses=takeoff.geometry?.dwgPresentation?.roomUses||{};
 const needsDefaults=scene.dwgReview?.defaultsVersion!==81;
 const changed=new Set();
 const rooms=scene.rooms.map(room=>{
  if(roomUses[room.id]&&room.roomUseSource!=='user_confirmed'&&!room.scopeOnly){
   changed.add(room.id);
   return {...room,type:roomUses[room.id],semanticType:roomUses[room.id],roomUseSource:'user_confirmed',floorFinish:undefined};
  }
  const matches=semantics.filter(item=>item.geometryPolygonId&&String(item.geometryPolygonId)===String(room.id));
  if(matches.length!==1||room.scopeOnly||room.roomUseSource==='user_confirmed')return room;
  const evidence=matches[0];
  const type=evidence.roomType||evidence.detectedType||evidence.name;
  if(!type||room.semanticType===type&&room.name===evidence.name)return room;
  changed.add(room.id);
  return {...room,name:evidence.name||room.name,type,semanticType:type,roomUseSource:'aps_closed_face_spatial_match',floorFinish:undefined};
 });
 let addedScope=false;
 if(!rooms.some(room=>room.scopeOnly)&&scene.footprint?.length>=3){
  rooms.push({id:`dwg-floor-scope-${scene.dwgRegion}`,name:'Unassigned floor area',type:'unknown',polygon:structuredClone(scene.footprint),scopeOnly:true});addedScope=true;
 }
 if(!changed.size&&!addedScope&&!audit.rejected.length&&!needsDefaults)return scene;
 const assets=scene.assets.filter(asset=>!(changed.has(asset.roomId)&&asset.placementSource==='design_default_not_measured'));
 return applyDesignDefaults({...scene,rooms,assets,openings:audit.openings,designDefaults:undefined,dwgReview:{...scene.dwgReview,defaultsVersion:81,manualFloorScope:true,openingConflicts:[...(scene.dwgReview?.openingConflicts||[]),...audit.rejected]}},{force:true});
}

export function dwgInteriorScene({runtime,storey,projectId,documentId,urn,roomUses={}}){
 const frame=storey.frame,factor=runtime.meterFactor;
 const local=p=>({x:(p.x-frame.minX)*factor,y:(p.y-frame.minY)*factor});
 const walls=storey.lines.map((line,index)=>({id:`dwg-${storey.index}-wall-${index}`,start:local(line.start),end:local(line.end),type:'internal',thickness:runtime.wallThicknessMeters||.15,height:3.2,sourceDbId:line.dbId}));
 const openings=[],rejected=[];
 for(const opening of [...runtime.doors,...(runtime.windows||[])].filter(o=>o.storey?.index===storey.index)){
  const start={x:opening.wallStart.x+frame.widthMeters/2,y:opening.wallStart.y+frame.depthMeters/2};
  const end={x:opening.wallEnd.x+frame.widthMeters/2,y:opening.wallEnd.y+frame.depthMeters/2};
  const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<.001;
  const wall=walls.find(w=>(near(w.start,start)&&near(w.end,end))||(near(w.start,end)&&near(w.end,start)));
  if(!wall){rejected.push(opening.dbId);continue;}
  const p={x:opening.wallPosition.x+frame.widthMeters/2,y:opening.wallPosition.y+frame.depthMeters/2};
  const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y;
  openings.push({id:`dwg-${storey.index}-${opening.type}-${openings.length}`,wallId:wall.id,type:opening.type,width:opening.width,height:opening.height,sillHeight:opening.sillHeight||0,offset:((p.x-wall.start.x)*dx+(p.y-wall.start.y)*dy)/(dx*dx+dy*dy),sourceDbId:opening.dbId,snapDistance:opening.snapDistance});
 }
 const audit=auditDwgOpenings(openings,walls);
 const base=dwgRoomScene({geometry:runtime.geometry,frame,factor,roomUses});
 const missingRooms=base.rooms.length===0;
 // A floor scope permits manual placement; it does not invent bedroom/bathroom boundaries.
 const hull=runtime.storeys.find(s=>s.index===storey.index)?.hull||[];
 const scope=hull.map(p=>({x:p.x+frame.widthMeters/2,y:p.y+frame.depthMeters/2}));
 if(missingRooms&&scope.length<3)throw new Error('DWG floor boundary is missing. Complete geometry extraction first.');
 const scene=applyDesignDefaults({...base,designDefaults:undefined,assets:[],walls,openings:audit.openings,
  rooms:missingRooms?[{id:`dwg-floor-scope-${storey.index}`,name:'Unassigned floor area',type:'unknown',polygon:scope,scopeOnly:true}]:base.rooms,
  footprint:scope,
  projectId,documentId,engineeringUrn:urn,source:'dwg-engineering-interior',sceneType:'structured',furnishingMode:'source_observed',
  dwgRegion:storey.sourceRegionIndex??storey.index,height:3.2,updatedAt:new Date().toISOString(),
  dwgReview:{bindingVersion:82,roomRecovery:runtime.geometry?.interiorRoomRecovery||null,missingRooms,rejectedOpeningIds:rejected,openingConflicts:audit.rejected,floorOrderConfirmed:false}
 },{force:true});
 return upgradeDwgInterior(scene,{object_details:{rooms:runtime.semanticRooms||[]}});
}

export function updateDwgInterior(takeoff,scene){
 const urn=takeoff?.aps_urn||takeoff?.apsUrn||takeoff?.urn;
 if(!urn||scene.engineeringUrn!==urn)throw new Error('The DWG source changed; interior changes were not saved.');
 const previous=takeoff.geometry?.dwgPresentation||{};
 return {...takeoff,updated_at:new Date().toISOString(),geometry:{...takeoff.geometry,dwgPresentation:{...previous,activeRegion:scene.dwgRegion,interiorScenes:{...previous.interiorScenes,[scene.dwgRegion]:scene}}}};
}

export function rebuildDwgInterior(previous,input){
 const next=dwgInteriorScene(input);
 if(!previous||previous.engineeringUrn!==next.engineeringUrn||previous.documentId!==next.documentId)return next;
 const confirmed=new Map(previous.rooms.filter(r=>r.roomUseSource==='user_confirmed').map(r=>[r.id,r]));
 next.rooms=next.rooms.map(r=>confirmed.has(r.id)?{...r,type:confirmed.get(r.id).type,semanticType:confirmed.get(r.id).semanticType,roomUseSource:'user_confirmed',floorFinish:undefined}:r);
 // Retain user edits by asset ID; regenerate only untouched automatic proposals.
 const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
 const edited=previous.assets.filter(a=>a.placementSource!=='design_default_not_measured').map(a=>{
  if(next.rooms.some(r=>r.id===a.roomId))return a;
  const room=next.rooms.find(r=>!r.scopeOnly&&inside({x:a.xMeters,y:a.yMeters},r.polygon))||next.rooms.find(r=>r.scopeOnly);
  return room?{...a,roomId:room.id}:a;
 });
 if(previous.manualOpeningEditor&&JSON.stringify(previous.walls)===JSON.stringify(next.walls)){
  next.openings=structuredClone(previous.openings);next.manualOpeningEditor=structuredClone(previous.manualOpeningEditor);
 }
 const ids=new Set(edited.map(a=>a.id));
 next.assets=[...next.assets.filter(a=>!ids.has(a.id)&&!confirmed.has(a.roomId)),...edited];
 return applyDesignDefaults({...next,designDefaults:undefined},{force:true});
}

// Repair an older preview without rebuilding its walls or discarding user edits.
export function repairDwgInterior(previous,input,takeoff){
 if(!dwgInteriorMatches(previous,takeoff))return dwgInteriorScene(input);
 let scene=previous;
 if(!previous.openings?.length&&!previous.manualOpeningEditor){
  const source=dwgInteriorScene(input);
  const walls=new Map(previous.walls.map(w=>[w.id,w]));
  const samePoint=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<.001;
  const openings=source.openings.filter(o=>{
   const old=walls.get(o.wallId),fresh=source.walls.find(w=>w.id===o.wallId);
   return old&&fresh&&samePoint(old.start,fresh.start)&&samePoint(old.end,fresh.end);
  });
  if(openings.length)scene={...previous,openings};
 }
 return upgradeDwgInterior(scene,takeoff);
}

export function patchDwgPresentation(takeoff,patch){
 return {...takeoff,updated_at:new Date().toISOString(),geometry:{...takeoff.geometry,dwgPresentation:{...takeoff.geometry?.dwgPresentation,...patch}}};
}
export function dwgInteriorCameraKey(projectId,scene){
 return `${projectId}:${scene?.documentId}:${scene?.source||'image'}:${scene?.dwgRegion??'image'}`;
}
export function dwgFloorIndices(takeoff){
 const ids=new Set(Object.entries(takeoff?.geometry?.dwgPresentation?.interiorScenes||{}).filter(([,s])=>dwgInteriorMatches(s,takeoff)).map(([key])=>Number(key)));
 try{
  const {geometry,meterFactor}=resolveDwgCalibration(takeoff||{});
  let lines=geometry.wallLineSegments||[];
  if(!lines.length){const wallIds=new Set((takeoff?.object_details?.walls||takeoff?.advanced_takeoff?.object_details?.walls||[]).map(o=>String(o.dbId)));lines=(geometry.lineSegments||[]).filter(l=>wallIds.has(String(l.dbId)));}
  for(const region of splitDwgRegions(lines,meterFactor))ids.add(region.index);
 }catch{}
 return [...ids].filter(Number.isInteger).sort((a,b)=>a-b);
}
