import {DEFAULT_MULTILINE_HEIGHT,legacyMultilinePair} from './multilineWalls.mjs';
import {wallFaceLines} from './openings.mjs';
import {id} from './document.mjs';
import {dist,EPS,nearest,segments,sub} from './geometry.mjs';
import {dot,guides,normal,unit} from './draftingGeometry.mjs';

function eligibleEdges(doc){
 const visible=new Set(doc.layers.filter(layer=>layer.visible!==false).map(layer=>layer.id));
 return doc.entities.filter(e=>visible.has(e.layer)&&guides(e)).flatMap(e=>
  segments(e).filter(edge=>dist(edge.a,edge.b)>.1).map(edge=>({...edge,segment:edge.segment??0})));
}

function wallPair(first,second){
 if(first.id===second.id||Math.abs((first.z??0)-(second.z??0))>EPS)return null;
 const axis=unit(first.a,first.b),perp=normal(axis);
 if(Math.abs(dot(perp,unit(second.a,second.b)))>1e-4)return null;
 const start=sub(second.a,first.a),end=sub(second.b,first.a);
 const across=(dot(start,perp)+dot(end,perp))/2, thickness=Math.abs(across);
 if(thickness<.04-EPS||thickness>.65+EPS)return null;
 const side=[dot(start,axis),dot(end,axis)].sort((a,b)=>a-b);
 const left=Math.max(0,side[0]),right=Math.min(dist(first.a,first.b),side[1]);
 if(right-left<.15)return null;
 const point=(along,offset)=>({x:first.a.x+axis.x*along+perp.x*offset,y:first.a.y+axis.y*along+perp.y*offset});
 return {first,second,thickness,a:point(left,across/2),b:point(right,across/2),
  edgeEnds:[[point(left,0),point(right,0)],[point(left,across),point(right,across)]]};
}

export function pairedWallEdges(doc,p,tolerance,requiredId){
 const edges=eligibleEdges(doc),near=edges.filter(edge=>nearest(edge,p).distance<=tolerance+.65);
 const picked=near.filter(edge=>nearest(edge,p).distance<=tolerance+.325&&(!requiredId||edge.id===requiredId));
 const candidates=[];
 const seen=new Set();
 for(const first of picked){
  for(const second of near){
   const key=[`${first.id}:${first.segment}`,`${second.id}:${second.segment}`].sort().join('|');
   if(seen.has(key))continue;
   seen.add(key);
   const pair=wallPair(first,second);
   if(!pair)continue;
   const t=dot(sub(p,pair.a),unit(pair.a,pair.b));
   if(t < -tolerance || t > dist(pair.a,pair.b)+tolerance)continue;
   const middle=nearest({type:'line',a:pair.a,b:pair.b},p).distance;
   if(middle>pair.thickness/2+tolerance)continue;
   candidates.push({pair,score:Math.max(0,middle-pair.thickness/2)*3+middle});
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 if(candidates.length>1&&Math.abs(candidates[1].score-candidates[0].score)<.002)
  throw Error('Several parallel outlines match. Use W2 to choose the two wall edges. / چند جفت خط پیدا شد. با W2 دو لبهٔ موردنظر را انتخاب کن.');
 return candidates[0]?.pair??null;
}

export function selectWallEdge(doc,p,tolerance){
 return eligibleEdges(doc).map(edge=>({edge,distance:nearest(edge,p).distance}))
  .filter(item=>item.distance<=tolerance).sort((a,b)=>a.distance-b.distance)[0]?.edge;
}

export function chosenWallPair(first,second){
 const pair=first&&second&&wallPair(first,second);
 if(!pair)throw Error('Choose two parallel wall edges with a shared span and a gap of 4–65 cm. / دو لبهٔ موازی با طول مشترک و فاصلهٔ ۴ تا ۶۵ سانتی‌متر انتخاب کن.');
 return pair;
}

function withoutWallSpan(entity,index,ends){
 const pieces=segments(entity).flatMap((edge,i)=>{
  if(i!==index)return [[edge.a,edge.b]];
  const sorted=ends.slice().sort((a,b)=>dist(edge.a,a)-dist(edge.a,b));
  return [[edge.a,sorted[0]],[sorted[1],edge.b]].filter(([a,b])=>dist(a,b)>EPS);
 });
 if(!pieces.length)return [];
 const paths=[];
 for(const [a,b] of pieces){
  const path=paths.at(-1);
  if(path&&dist(path.at(-1),a)<EPS)path.push(b);
  else paths.push([a,b]);
 }
 if(entity.closed&&paths.length>1&&dist(paths.at(-1).at(-1),paths[0][0])<EPS){
  const last=paths.pop();
  paths[0]=[...last,...paths[0].slice(1)];
 }
 // Keep the untouched sides and tails as editable drafting geometry.
 const {points,closed,type,a,b,...base}=entity;
 return paths.map((path,i)=>{
  const common={...base,id:i?id():entity.id};
  return path.length===2?{...common,type:'line',a:path[0],b:path[1]}:
   {...common,type:'polyline',points:path,closed:false};
 });
}

export function useWallEdges(doc,pair,options){
 const {first,second,thickness,a,b,edgeEnds}=pair;
 const sources=[first,second];
 if(sources.some(edge=>doc.layers.find(layer=>layer.id===edge.layer)?.locked))
  throw Error('Unlock both wall edge layers first. / ابتدا لایهٔ هر دو خط را باز کن.');
 const legacy=legacyMultilinePair(doc,first.id,second.id);
 const mlGroup=first.mlGroup&&first.mlGroup===second.mlGroup?first.mlGroup:legacy?.first.id;
 const mlInner=legacy?legacy.inner:first.mlInner;
 const faceSide=edge=>legacy?Number(edge.id===legacy.second.id):edge.mlSide;
 const wall={id:id(),type:'line',role:'wall',a,b,thickness,
  height:mlGroup?(first.height??DEFAULT_MULTILINE_HEIGHT):options.wallHeight,z:first.z??options.z,
  layer:first.layer,color:first.color??'bylayer',wallFromEdges:true};
 if(mlGroup){
  wall.mlGroup=mlGroup;
  wall.mlInner=mlInner;
  wall.mlThickness=legacy?.thickness??first.mlThickness??thickness;
  if(mlInner!==null&&mlInner!==undefined){
   const expected=edgeEnds[sources.findIndex(source=>faceSide(source)===mlInner)][0];
   const [f0,f1]=wallFaceLines({entities:[]},wall);
   wall.mlInnerFace=dist(f0.a,expected)<=dist(f1.a,expected)?0:1;
  }
 }
 const entities=doc.entities.flatMap(entity=>{
  const index=sources.findIndex(edge=>edge.id===entity.id);
  if(index<0)return [entity];
  const face=mlGroup?{...entity,mlGroup,mlInner,mlSide:faceSide(entity),mlThickness:wall.mlThickness,height:wall.height,z:wall.z}:entity;
  return withoutWallSpan(face,sources[index].segment,edgeEnds[index]);
 });
 return {wall,doc:{...doc,entities:[...entities,wall]}};
}
