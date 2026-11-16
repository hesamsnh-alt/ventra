import {at,dist,EPS,segments} from './geometry.mjs';

export const POINT_STYLES={dot:0,plus:2,cross:3,'circle-cross':35};
export const isPointStyle=value=>Object.hasOwn(POINT_STYLES,value);
export const canDivide=e=>!e.hatch&&['line','polyline','arc','circle'].includes(e.type);

export function dividePath(entity,count){
 if(!Number.isInteger(count)||count<2||count>2000)
  throw Error('Enter a whole number from 2 to 2000. / تعداد بخش‌ها را بین ۲ تا ۲۰۰۰ وارد کن.');
 const path=segments(entity).map(segment=>({
  segment,length:segment.type==='line'?dist(segment.a,segment.b):segment.radius*Math.abs(segment.sweep),
 })).filter(piece=>piece.length>EPS);
 if(!path.length)throw Error('Pick a path with a length. / یک مسیر با طول مشخص انتخاب کن.');
 const length=path.reduce((sum,piece)=>sum+piece.length,0);
 const closed=entity.type==='circle'||entity.closed;
 let index=0,previous=0;
 return Array.from({length:closed?count:count-1},(_,i)=>{
  const station=(closed?i:i+1)*length/count;
  while(index<path.length-1&&station>previous+path[index].length){
   previous+=path[index++].length;
  }
  const piece=path[index];
  return at(piece.segment,(station-previous)/piece.length);
 });
}
