import {at,curveIntersections,dist,inside,nearest,param,segments,sub,validPolygon} from './geometry.mjs';
import {dot,line,normal,unit,unique} from './draftingGeometry.mjs';

const EDGE_TOL=.004;
const WIDTH_TOL=.018;
const DEFAULT_LEGACY_WIDTH=.2;
const level=e=>e.z??0;
const isEdge=e=>!e.hatch&&!e.mlDrafting&&(!e.role||e.role==='line')&&['line','polyline'].includes(e.type);
const ringEdges=points=>segments({type:'polyline',points,closed:true});

function ringRegion(points,holes,z){
 return {points,holes,z,edges:[...ringEdges(points),...holes.flatMap(ringEdges)]};
}
function wallRegion(wall){
 const n=normal(unit(wall.a,wall.b));
 const face=(p,side)=>({x:p.x+n.x*wall.thickness/2*side,y:p.y+n.y*wall.thickness/2*side});
 return ringRegion([face(wall.a,1),face(wall.b,1),face(wall.b,-1),face(wall.a,-1)],[],level(wall));
}
const contains=(region,p)=>inside(p,region.points)&&!region.holes.some(ring=>inside(p,ring));

function candidate(first,second,widths){
 const u=unit(first.a,first.b),n=normal(u);
 const length=dist(first.a,first.b);
 const ends=[second.a,second.b].map(p=>{
  const delta=sub(p,first.a);
  return {t:dot(delta,u),d:dot(delta,n)};
 }).sort((a,b)=>a.t-b.t);
 const [a,b]=ends;
 if(Math.abs(a.d-b.d)>EDGE_TOL||b.t-a.t<.12)return null;
 const signedWidth=(a.d+b.d)/2, width=Math.abs(signedWidth);
 if(width<.04||width>.65||!widths.some(value=>Math.abs(value-width)<=WIDTH_TOL))return null;
 const start=Math.max(0,a.t),end=Math.min(length,b.t);
 if(end-start<.14)return null;
 const project=(distance,side)=>{
  const offset=(a.d+(distance-a.t)/(b.t-a.t)*(b.d-a.d))*side;
  return {x:first.a.x+u.x*distance+n.x*offset,y:first.a.y+u.y*distance+n.y*offset};
 };
 const axis=line(project(start,.5),project(end,.5));
 return {axis,first,second,z:level(first),length:end-start,
  ring(from,to){
   const s=start+(end-start)*from,t=start+(end-start)*to;
   return [project(s,0),project(t,0),project(t,1),project(s,1)];
  }};
}

function connected(pair,regions){
 return regions.some(region=>region.z===pair.z&&[pair.axis.a,pair.axis.b].some(p=>
  contains(region,p)||region.edges.some(edge=>nearest(edge,p)?.distance<=.06)));
}

function uncovered(pair,regions){
 const sameLevel=regions.filter(region=>region.z===pair.z);
 const cuts=unique([0,1,...sameLevel.flatMap(region=>region.edges.flatMap(edge=>
  curveIntersections(pair.axis,edge).map(p=>Math.max(0,Math.min(1,param(pair.axis,p))))))],1e-6);
 return cuts.slice(1).flatMap((end,i)=>{
  const start=cuts[i],center=at(pair.axis,(start+end)/2);
  if((end-start)*pair.length<.04||sameLevel.some(region=>contains(region,center)))return [];
  const points=pair.ring(start,end);
  return validPolygon(points)?[points]:[];
 });
}

export function recoverWallBands(entities,existing,fragmentedLayers){
 if(!fragmentedLayers.size)return [];
 const hosts=entities.filter(e=>e.role==='wall'&&e.type==='line'&&dist(e.a,e.b)>.04);
 const regions=[...existing.map(e=>ringRegion(e.points,e.holes,e.z)),...hosts.map(wallRegion)];
 const edges=entities.filter(e=>fragmentedLayers.has(e.layer)&&isEdge(e))
  .flatMap(e=>segments(e)).filter(e=>dist(e.a,e.b)>=.14);
 if(edges.length>900)return [];
 const widthsByLayer=new Map([...fragmentedLayers].map(layer=>{
  const known=[...edges.filter(e=>e.layer===layer&&Number.isFinite(e.mlThickness)).map(e=>e.mlThickness),
   ...hosts.filter(e=>e.layer===layer&&e.wallFromEdges).map(e=>e.thickness)];
  return [layer,known.length?unique(known,EDGE_TOL/2):[DEFAULT_LEGACY_WIDTH]];
 }));
 const proposals=[];
 for(let i=0;i<edges.length;i++){
  const first=edges[i],widths=widthsByLayer.get(first.layer);
  for(let j=i+1;j<edges.length;j++){
   const second=edges[j];
   if(first.id===second.id||first.layer!==second.layer||level(first)!==level(second))continue;
   const pair=candidate(first,second,widths);
   if(pair)proposals.push(pair);
  }
 }
 proposals.sort((a,b)=>b.length-a.length);
 const recovered=[];
 // Matching thickness alone is not enough: an untagged pair must tie into
 // confirmed walls. Iterate to follow a chain of trimmed wall segments.
 let pending=proposals;
 while(pending.length){
  const deferred=[];
  for(const pair of pending){
   if(!pair.first.mlGroup&&!pair.second.mlGroup&&!connected(pair,regions)){
    deferred.push(pair);
    continue;
   }
   for(const points of uncovered(pair,regions)){
    const source=pair.first.mlGroup?pair.first:pair.second;
    recovered.push({points,holes:[],height:source.height??3,z:pair.z,group:source.mlGroup??source.id,surfaceColor:source.surfaceColor});
    regions.push(ringRegion(points,[],pair.z));
   }
  }
  if(deferred.length===pending.length)break;
  pending=deferred;
 }
 return recovered;
}
