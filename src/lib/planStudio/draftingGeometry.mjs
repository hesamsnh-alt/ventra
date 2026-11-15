import {dist, EPS, segments, sub} from './geometry.mjs';

export const xy = (x, y) => ({x, y});
export const line = (a, b) => ({type: 'line', a, b});
export const polygon = points => ({type: 'polyline', closed: true, points});
export const rect = (x, y, right, top) => polygon([xy(x,y), xy(right,y), xy(right,top), xy(x,top)]);
export const text = (position, value, textHeight) => ({type: 'text', position, text: value, textHeight});
export const dimension = (a, b, offsetDistance) => ({type: 'dimension', a, b, offsetDistance});
export const dot = (a, b) => a.x*b.x + a.y*b.y;
export const unit = (a,b) => xy((b.x-a.x)/dist(a,b), (b.y-a.y)/dist(a,b));
export const normal = u => xy(-u.y, u.x);
export const range = (v,min,max) => Number.isFinite(v) && v >= min && v <= max;
export const unique = (values, tolerance = EPS) =>
  values.sort((a,b)=>a-b).reduce((out,x)=>{
    if (!out.length || x-out.at(-1)>tolerance) out.push(x);
    return out;
  }, []);
export function basis(origin, u) {
  const v = normal(u);
  return {
    local: p => {const d = sub(p,origin); return xy(dot(d,u),dot(d,v));},
    world: ({x,y}) => xy(origin.x+x*u.x+y*v.x, origin.y+x*u.y+y*v.y),
  };
}
export const guides = e => !e.hatch && (!e.role || e.role === 'line') && ['line','polyline'].includes(e.type);

export const canDimension=e=>['line','polyline'].includes(e.type)&&e.role!=='hatch'&&e.detailKind!=='dpl-extension';
const edgeKey=(a,b)=>[a,b].map(p=>[p.x,p.y].map(n=>Math.round(n*1e7)).join(',')).sort().join('|');

export function perimeterDimensions(entities, offset) {
  if (!entities.length || !entities.every(canDimension) || !range(offset,.05,10)) {
    throw Error('Select lines or polylines and set a valid offset. / خط یا پلی‌لاین و فاصلهٔ معتبر انتخاب کن.');
  }
  const closedEdges=new Set(entities.filter(e=>e.closed).flatMap(segments).map(({a,b})=>edgeKey(a,b)));
  return entities.flatMap(entity => {
    const edges = segments(entity);
    if(!entity.closed){
      return edges.flatMap(({a,b})=>{
        const key=edgeKey(a,b);
        if(closedEdges.has(key))return [];
        closedEdges.add(key);
        if(a.x>b.x||a.x===b.x&&a.y>b.y)[a,b]=[b,a];
        return [dimension(a,b,a.x===b.x?-offset:offset)];
      });
    }
    const ccw = edges.reduce((area,{a,b})=>area+a.x*b.y-a.y*b.x,0)>0;
    const result = [];
    const axisEdges = edges.every(({a,b})=> Math.abs(a.x-b.x)<EPS || Math.abs(a.y-b.y)<EPS);
    if (axisEdges) {
      const xs = entity.points.map(p=>p.x), ys = entity.points.map(p=>p.y);
      const limits = [Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
      const ranges = [[],[],[],[]];
      for (const {a,b} of edges) {
        const outward = normal(unit(ccw?b:a,ccw?a:b));
        const side = Math.abs(outward.x)>.5 ? (outward.x<0?0:1) : (outward.y<0?2:3);
        ranges[side].push(a,b);
      }
      ranges.forEach((corners, side)=>{
        const vertical = side<2;
        const coord = p => vertical ? p.y : p.x;
        const stations = unique(corners.map(coord));
        const p = t => vertical ? xy(limits[side],t) : xy(t,limits[side]);
        const sign = side===0||side===3?1:-1;
        for(const station of stations) {
          const base = p(station);
          const nearest = corners.filter(corner=>Math.abs(coord(corner)-station)<EPS)
            .reduce((a,b)=>dist(a,base)<dist(b,base)?a:b);
          if (dist(nearest,base)>EPS) result.push({...line(nearest,base),detailKind:'dpl-extension'});
        }
        for (let i=1;i<stations.length;i++) {
          result.push(dimension(p(stations[i-1]),p(stations[i]),sign*offset));
        }
        if (stations.length>2) result.push(dimension(p(stations[0]),p(stations.at(-1)),sign*offset*2));
      });
    } else {
      for (const {a,b} of edges) result.push(dimension(a,b,ccw?-offset:offset));
    }
    return result;
  });
}

const dimensionNumber=new Intl.NumberFormat('en',{maximumFractionDigits:3});
function dimensionLane(entity,labelHeight,units){
  const axis=unit(entity.a,entity.b), perpendicular=normal(axis);
  const offset=entity.offsetDistance||.3, shift=p=>xy(p.x+perpendicular.x*offset,p.y+perpendicular.y*offset);
  const a=shift(entity.a),b=shift(entity.b),center=xy((a.x+b.x)/2,(a.y+b.y)/2);
  const unitsPerMetre=units==='in'?1/.0254:100;
  const number=dimensionNumber.format(dist(entity.a,entity.b)*unitsPerMetre);
  const halfWidth=(number.length+3)*labelHeight*.34;
  const label={left:center.x-halfWidth,right:center.x+halfWidth,bottom:center.y-labelHeight*.58,top:center.y+labelHeight*.58};
  return {a,b,axis,perpendicular,label};
}

function dimensionsConflict(candidate,other,spacing){
  const a=candidate.label,b=other.label;
  const labelsOverlap=a.left<b.right&&a.right>b.left&&a.bottom<b.top&&a.top>b.bottom;
  if(labelsOverlap)return true;
  if(Math.abs(dot(candidate.axis,other.axis))<.9999)return false;
  const deltas=[sub(other.a,candidate.a),sub(other.b,candidate.a)];
  const gap=Math.min(...deltas.map(delta=>Math.abs(dot(delta,candidate.perpendicular))));
  if(gap>=spacing)return false;
  const projected=deltas.map(delta=>dot(delta,candidate.axis));
  return Math.min(dist(candidate.a,candidate.b),Math.max(...projected))-Math.max(0,Math.min(...projected))>EPS;
}

export function layoutDplDimensions(geometry,existing,{units,printScale,offset}){
  const height=Math.max(.125,Math.min(.3,.0025*printScale));
  const spacing=Math.max(.28,Math.min(offset,.65),height*1.3);
  const dimensions=existing.filter(e=>e.type==='dimension');
  const occupied=dimensions.map(e=>dimensionLane(e,height,units));
  const covered=new Set(dimensions.map(e=>edgeKey(e.a,e.b)));
  const placements=new Map();
  const newDimensions=geometry.filter(e=>e.type==='dimension')
    .sort((a,b)=>Math.abs(a.offsetDistance)-Math.abs(b.offsetDistance));
  for(const entity of newDimensions){
    const key=edgeKey(entity.a,entity.b);
    if(covered.has(key))continue;
    const outward=Math.sign(entity.offsetDistance)||1;
    let next=entity, lane=dimensionLane(next,height,units);
    for(let attempt=1;attempt<=64&&occupied.some(item=>dimensionsConflict(lane,item,spacing-EPS));attempt++){
      next={...entity,offsetDistance:entity.offsetDistance+outward*spacing*attempt};
      lane=dimensionLane(next,height,units);
    }
    covered.add(key);
    occupied.push(lane);
    placements.set(entity,next);
  }
  if(!placements.size)return [];
  return geometry.flatMap(e=>e.type==='dimension'?(placements.has(e)?[placements.get(e)]:[]):[e]);
}
