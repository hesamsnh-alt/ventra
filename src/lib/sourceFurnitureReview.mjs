import {mapPrintedDimensionPoint} from './printedDimensionAlignment.mjs';
import {compileSourceFurniture} from './sourceFurniture.mjs';
import {canonicalRoomType} from './roomSemantics.mjs';

// A furniture-only review cannot replace architecture or recalibrate the plan.
export function applySourceFurnitureReview(scene, observations) {
 const bounds=scene.geometryValidation?.sourceProjection?.sourceBounds;
 if(!bounds||!(bounds.maxX>bounds.minX)||!(bounds.maxY>bounds.minY)||!Array.isArray(observations))throw new Error('Furniture review has no valid source alignment.');
 const point=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
  ? mapPrintedDimensionPoint({x:(p.x-bounds.minX)/(bounds.maxX-bounds.minX)*scene.width,y:(bounds.maxY-p.y)/(bounds.maxY-bounds.minY)*scene.depth},scene.geometryValidation?.dimensionAlignment)
  : {x:NaN,y:NaN};
 const mapped=observations.map(o=>({...o,backLeft:point(o.backLeft),backRight:point(o.backRight),frontCenter:point(o.frontCenter)}));
 const result=compileSourceFurniture(mapped,scene.footprint,scene.rooms,scene.walls);
 const missing=[];
 for(const room of scene.rooms){
  if(canonicalRoomType(room)==='laundry'&&!result.assets.some(a=>a.roomId===room.id&&a.type==='washing_machine'))missing.push({roomId:room.id,type:'washing_machine',reason:'laundry_appliance_not_confirmed'});
 }
 const furnishing={...scene.geometryValidation.furnishing,version:'source_fidelity_v49',assetCount:result.assets.length,rejectedCount:result.rejected.length,completedEssentialCount:0,doorClearanceAware:false,byType:result.assets.reduce((c,a)=>(c[a.type]=(c[a.type]||0)+1,c),{}),byRoom:scene.rooms.map(r=>({roomId:r.id,type:canonicalRoomType(r),assetCount:result.assets.filter(a=>a.roomId===r.id).length,assetTypes:result.assets.filter(a=>a.roomId===r.id).map(a=>a.type)}))};
 return {...scene,assets:result.assets,furnishingMode:'source_observed',furnishingReview:{...scene.furnishingReview,observedCount:mapped.length,acceptedCount:result.assets.length,observations:mapped,observationCoordinateMode:'scene_meters_y_up',rejected:result.rejected,added:[],missing,requiresReview:!!(result.rejected.length||missing.length||!result.assets.length),coverageReview:{status:'completed',mode:'furniture_only_fixed_architecture'}},geometryValidation:{...scene.geometryValidation,furnishing}};
}
