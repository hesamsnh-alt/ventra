import {bounds,inside} from './geometry.mjs';
import {normal,unit} from './draftingGeometry.mjs';
import {findHatchBoundary} from './hatchBoundary.mjs';

function areaEdges(entity){
 if(['section','stair','hatch','pipe'].includes(entity.role)||entity.roomFinish||entity.hatch&&entity.role==='line')return [];
 if(entity.role!=='wall'||entity.type!=='line')return [entity];
 const perpendicular=normal(unit(entity.a,entity.b)),half=entity.thickness/2;
 const face=(p,offset)=>({x:p.x+offset*perpendicular.x,y:p.y+offset*perpendicular.y});
 const points=[face(entity.a,half),face(entity.b,half),face(entity.b,-half),face(entity.a,-half)];
 return [{...entity,type:'polyline',points,closed:true}];
}

export function roomArea(doc,p){
 const boundary=findHatchBoundary({...doc,entities:doc.entities.flatMap(areaEdges)},p);
 if(!boundary)throw Error('No closed boundary here. / مرز بسته پیدا نشد.');
 const {points,holes,holeAreas,area}=boundary;
 // An island inside another island is already outside the clicked connected region.
 const islandArea=holeAreas.reduce((total,size,index)=>{
  const nested=holes.some((ring,other)=>holeAreas[other]>size&&holes[index].every(vertex=>inside(vertex,ring)));
  return nested?total:total+size;
 },0);
 const squareMetres=area-islandArea;
 if(squareMetres<=0)throw Error('The enclosed area could not be measured. / مساحت محدوده قابل اندازه‌گیری نیست.');
 const {width,height}=bounds([{points}]);
 return {rings:[points,...holes],label:{
  type:'text',detailKind:'plan-area',position:p,
  text:`${Number(squareMetres.toFixed(3))} m²`,textHeight:Math.min(.23,Math.max(.035,Math.min(width,height)*.12)),
 }};
}
