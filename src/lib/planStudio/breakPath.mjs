import {at,curveSlice,dist,EPS,nearest,segments,TAU} from './geometry.mjs';

export const isClosedPath=e=>e.type==='circle'||e.closed===true||
 e.type==='arc'&&Math.abs(Math.abs(e.sweep)-TAU)<EPS;
export const canBreakPath=e=>!e.hatch&&!e.hatchHoles&&
 (!e.role||['line','wall','pipe'].includes(e.role))&&['line','polyline','arc','circle'].includes(e.type);

export function breakPath(entity,first,second,{remove=false}={}){
 const closed=isClosedPath(entity);
 const edges=segments(entity);
 const end=edges.length;
 const pick=p=>{
  const {segment,t}=nearest(entity,p);
  const station=(segment.segment??0)+Math.max(0,Math.min(1,t));
  return closed&&station>=end-EPS?0:station;
 };
 const a=pick(first),b=second?pick(second):a;
 const [low,high]=[a,b].sort((x,y)=>x-y);
 const different=high-low>EPS&&(!closed||end-high+low>EPS);
 const needPair=remove||closed;
 if(needPair&&!different)
  throw Error('Pick two different points along the path. / دو نقطهٔ متفاوت روی مسیر انتخاب کن.');
 if(!needPair&&(a<=EPS||a>=end-EPS))
  throw Error('Pick a point between the endpoints. / یک نقطه بین دو سر مسیر انتخاب کن.');

 const forward=b>a?[a,b]:[a,b+end];
 const rest=b>a?[b,a+end]:[b,a];
 const spans=closed?(remove?[rest]:[forward,rest]):remove?[[0,low],[high,end]]:[[0,a],[a,end]];
 return spans.filter(([from,to])=>to-from>EPS).flatMap(([from,to])=>{
  if(entity.type!=='polyline'){
   const part=curveSlice(edges[0],from,to);
   if(part.type==='line')return dist(part.a,part.b)>EPS?[part]:[];
   return Math.abs(part.sweep)>EPS?[part]:[];
  }
  const pointAt=station=>{
   const index=Math.floor(station);
   return at(edges[index%end],station-index);
  };
  const endpoint=station=>!closed&&station>=end?edges.at(-1).b:pointAt(station);
  const points=[endpoint(from)];
  const append=p=>{if(dist(p,points.at(-1))>EPS)points.push(p);};
  for(let i=Math.floor(from)+1;i<to-EPS;i++)append(endpoint(i));
  append(endpoint(to));
  const paths=[];
  for(let i=0;i<points.length-1;i+=299)paths.push({...entity,points:points.slice(i,i+300),closed:false});
  return paths;
 });
}
