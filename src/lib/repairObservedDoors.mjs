import {prepareObservedOpeningWalls} from './sourceOpeningWalls.mjs';
import {observedDoorOrientation} from './schematicBoundaries.mjs';
import {repairOverlappingWalls} from './wallOverlapRepair.mjs';
import {filterOpenPlanPartitions} from './openPlanPartitions.mjs';

// Repair rejected image observations, never infer a new doorway from a room
// name or a relationship. Dimensions, furniture and room polygons stay intact.
export function repairObservedDoors(input){
 const evidence=input?.geometryValidation?.openings;
 if(evidence?.observationCoordinateMode!=='scene_meters_y_up')return {scene:input,restored:[]};
 const rejected=new Set(evidence.rejectedObservationIds||[]);
 const observations=(evidence.observations||[]).filter(o=>o.type==='door'&&rejected.has(o.id)&&!input.openings?.some(a=>a.id===o.id));
 const scene=structuredClone(input),restored=[];
 const openPlan=filterOpenPlanPartitions(scene.walls,scene.rooms,scene.relationships||[],scene.openings||[]);
 const supports=prepareObservedOpeningWalls(scene.walls,scene.rooms,observations,scene.relationships||[]);
 for(const o of observations){
  const wall=supports.walls.find(w=>w.id===`opening_support_${o.id}`.slice(0,100));
  if(!wall)continue;
  const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y,length=Math.hypot(dx,dy),width=Number(o.widthMeters);
  const along=((o.center.x-wall.start.x)*dx+(o.center.y-wall.start.y)*dy)/length;
  if(!(width>0)||along-width/2<-.005||along+width/2>length+.005)continue;
  const rawHeight=Number(o.heightMeters),height=rawHeight>0?Math.min(2.8,rawHeight):2.1;
  scene.openings.push({id:o.id,type:'door',wallId:wall.id,offset:along/length,width,height,sillHeight:0,heightSource:rawHeight>0?'source_annotation':'visual_default_not_measured',sillHeightSource:'door_floor_level',...observedDoorOrientation(o,wall),provenance:'source_observed',repairSource:'rejected_observation_shared_boundary_v62'});
  restored.push(o.id);
 }
 if(!restored.length&&!openPlan.removed)return {scene:input,restored:[],removedPartitions:[]};
 // Remove coincident strokes so the old segment cannot seal the repaired gap.
 const filtered=filterOpenPlanPartitions(supports.walls,scene.rooms,scene.relationships||[],scene.openings||[]);
 const used=filtered.partitions.filter(w=>!w.id.startsWith('opening_support_')||scene.walls.some(a=>a.id===w.id)||scene.openings.some(o=>o.wallId===w.id));
 const repaired=repairOverlappingWalls(used,scene.openings);
 scene.walls=repaired.walls;scene.openings=repaired.openings;
 scene.geometryValidation.openings={...evidence,preservedCount:scene.openings.length,rejectedObservationIds:[...rejected].filter(id=>!restored.includes(id)),sharedBoundarySupports:[...(evidence.sharedBoundarySupports||[]),...supports.added.filter(a=>restored.includes(a.openingId))],repairVersion:'observed-door-repair-v62'};
 scene.updatedAt=new Date().toISOString();
 return {scene,restored,removedPartitions:filtered.removedIds};
}
