import {id} from './document.mjs';
import {curveIntersections,dist,inside,polygonArea,segments,sub,validPolygon} from './geometry.mjs';
import {dot,normal,unit} from './draftingGeometry.mjs';
import {parallelLines} from './sections.mjs';
import {wallFaceLines} from './openings.mjs';

export const DEFAULT_MULTILINE_HEIGHT=3;
const TOL=1e-6;
const level=e=>e.z??0;
const wallFace=e=>e.type==='polyline'&&!e.hatch&&(!e.role||e.role==='line');
const line=(a,b)=>({type:'line',a,b});

export function identifyMultilinePair(first,second){
 if(!first||!second||!wallFace(first)||!wallFace(second)||first.layer!==second.layer||
   level(first)!==level(second)||first.closed!==second.closed||first.points.length!==second.points.length)return null;
 const u=unit(first.points[0],first.points[1]);
 const thickness=dot(sub(first.points[0],second.points[0]),normal(u));
 if(Math.abs(thickness)<.01||Math.abs(thickness)>3)return null;
 const axis=first.points.map((p,i)=>({x:(p.x+second.points[i].x)/2,y:(p.y+second.points[i].y)/2}));
 try{
  const outline=parallelLines(axis,Math.abs(thickness),first.closed);
  if(thickness<0)outline.reverse();
  if(!outline.every((edge,i)=>edge.points.every((p,j)=>dist(p,[first,second][i].points[j])<TOL)))return null;
 }catch{return null;}
 const inner=first.closed?(polygonArea(first.points)<polygonArea(second.points)?0:1):null;
 return {inner,thickness:Math.abs(thickness)};
}

export function createWallMultiline(points,closed,{section,wallHeight,z}){
 const faces=parallelLines(points,section.multilineWidth,closed);
 if(section.multilinePurpose==='drafting')return faces.map(face=>({...face,mlDrafting:true}));
 if(!Number.isFinite(wallHeight)||wallHeight<.1||wallHeight>30)throw Error('Choose a wall height between 0.10 and 30 m. / ارتفاع دیوار را بین ۱۰ سانتی‌متر و ۳۰ متر انتخاب کن.');
 if(closed&&(!faces.every(face=>validPolygon(face.points))||!nested(faces[0].points,faces[1].points)))
  throw Error('Wall thickness does not fit this outline. / ضخامت دیوار در این مسیر جا نمی‌شود.');
 const group=id();
 const inner=closed?(polygonArea(faces[0].points)<polygonArea(faces[1].points)?0:1):null;
 return faces.map((face,i)=>({...face,role:'line',mlGroup:group,mlSide:i,mlInner:inner,height:wallHeight,z}));
}

const edgesOf=points=>segments({type:'polyline',closed:true,points});
function nested(a,b){
 const [outer,inner]=polygonArea(a)>polygonArea(b)?[a,b]:[b,a];
 return inner.every(p=>inside(p,outer))&&!edgesOf(inner).some(edge=>edgesOf(outer).some(outerEdge=>curveIntersections(edge,outerEdge).length));
}
const overlaps=(a,b)=>a.some(p=>inside(p,b))||b.some(p=>inside(p,a))||
 edgesOf(a).some(x=>edgesOf(b).some(y=>curveIntersections(x,y).length));

function closeFace(lines){
 if(lines.length<3||lines.length>600)return null;
 const remaining=lines.slice(), first=remaining.pop();
 const points=[first.a,first.b];
 while(remaining.length){
  const last=points.at(-1);
  const next=remaining.findIndex(e=>Math.min(dist(e.a,last),dist(e.b,last))<TOL);
  if(next<0)return null;
  const [edge]=remaining.splice(next,1);
  points.push(dist(last,edge.a)<TOL?edge.b:edge.a);
 }
 if(points.length>301||dist(points[0],points.at(-1))>=TOL)return null;
 points.pop();
 return validPolygon(points)?points:null;
}

function openBand(a,b){
 const perimeter=[...a,...b.slice().reverse()];
 return validPolygon(perimeter)?perimeter:null;
}
function remainingWallBands(sides){
 const [first,second]=sides.map(items=>items.flatMap(segments));
 const output=[];
 for(const a of first){
  const axis=unit(a.a,a.b),perp=normal(axis),length=dist(a.a,a.b);
  for(const b of second){
   if(Math.abs(dot(perp,unit(b.a,b.b)))>TOL)continue;
   const vectors=[sub(b.a,a.a),sub(b.b,a.a)];
   const thickness=Math.abs(dot(vectors[0],perp));
   if(thickness<.01-TOL||thickness>3+TOL)continue;
   const [left,right]=vectors.map(v=>dot(v,axis)).sort((x,y)=>x-y);
   if(Math.min(length,right)-Math.max(0,left)<TOL)continue;
   const oriented=dot(sub(b.b,b.a),axis)>0?[b.a,b.b]:[b.b,b.a];
   if(Math.abs(left)<=thickness*2&&Math.abs(right-length)<=thickness*2){
    const outline=openBand([a.a,a.b],oriented);
    if(outline)output.push(outline);
   }else{
    const x=Math.max(left,0),y=Math.min(right,length);
    const move=(n,offset)=>({x:a.a.x+axis.x*n+perp.x*offset,y:a.a.y+axis.y*n+perp.y*offset});
    const offset=dot(vectors[0],perp);
    output.push([move(x,0),move(y,0),move(y,offset),move(x,offset)]);
   }
  }
 }
 return output;
}

// Read legacy paired polylines only when the existing geometry reproduces an exact ML offset.
export function legacyMultilinePair(doc,idA,idB){
 const i=doc.entities.findIndex(e=>e.id===idA),j=doc.entities.findIndex(e=>e.id===idB);
 if(i<0||j<0||Math.abs(i-j)!==1)return null;
 const [first,second]=[i,j].sort((a,b)=>a-b).map(k=>doc.entities[k]);
 if(first.mlGroup||second.mlGroup||first.mlDrafting||second.mlDrafting)return null;
 const band=identifyMultilinePair(first,second);
 return band?{first,second,...band}:null;
}

export function multilinePreview(entities){
 const groups=new Map(), floorCandidates=[], bands=[];
 const add=e=>{
  if(!groups.has(e.mlGroup))groups.set(e.mlGroup,[]);
  groups.get(e.mlGroup).push(e);
 };
 for(let i=0;i<entities.length;i++){
  const e=entities[i],next=entities[i+1];
  if(e.mlGroup){add(e);continue;}
  if(!next||e.mlDrafting||next.mlDrafting||next.mlGroup)continue;
  const inferred=identifyMultilinePair(e,next);
  if(inferred){
   [e,next].forEach((face,side)=>add({...face,mlGroup:e.id,mlSide:side,mlInner:inferred.inner}));
   i++;
  }
 }
 for(const [group,items] of groups){
  const front=items.find(e=>e.role!=='wall')??items[0];
  const z=level(front),height=front.height??DEFAULT_MULTILINE_HEIGHT,inner=front.mlInner;
  const sides=[0,1].map(i=>items.filter(e=>e.role!=='wall'&&e.mlSide===i));
  const walls=items.filter(e=>e.role==='wall');
  const complete=sides.every(side=>side.length===1)&&identifyMultilinePair(sides[0][0],sides[1][0]);
  const style={group,z,height,surfaceColor:front.surfaceColor};
  if(complete){
   const [a,b]=sides.map(side=>side[0].points);
   if(complete.inner!==null){
    if(!nested(a,b))continue;
    const insideRing=complete.inner===0?a:b;
    bands.push({...style,points:complete.inner===0?b:a,holes:[insideRing]});
    floorCandidates.push({...style,points:insideRing});
   }else{
    const ring=openBand(a,b);
    if(ring)bands.push({...style,points:ring,holes:[]});
   }
  }else if(walls.length||sides.every(side=>side.length)){
   remainingWallBands(sides).forEach(points=>bands.push({...style,points,holes:[]}));
   if(walls.length&&inner!==null&&inner!==undefined){
    const segmentsOfInner=sides[inner].flatMap(segments);
    const completed=walls.filter(w=>[0,1].includes(w.mlInnerFace)).map(w=>
      wallFaceLines({entities:[]},w)[w.mlInnerFace]);
    const ring=closeFace([...segmentsOfInner,...completed]);
    if(ring)floorCandidates.push({...style,points:ring});
   }
  }
 }
 const explicit=entities.filter(e=>e.role==='floor'&&e.closed&&!e.roomFinish), floors=[];
 floorCandidates.sort((a,b)=>polygonArea(b.points)-polygonArea(a.points));
 for(const floor of floorCandidates){
  if([...explicit,...floors].some(other=>Math.abs(level(other)-floor.z)<.01&&overlaps(other.points,floor.points)))continue;
  floors.push({...floor,type:'polyline',closed:true,height:.12});
 }
 return {bands,floors};
}
