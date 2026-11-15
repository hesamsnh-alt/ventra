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

export function perimeterDimensions(entities, offset) {
  if (!entities.length || !entities.every(e => e.type === 'polyline' && e.closed) || !range(offset,.05,10)) {
    throw Error('Select closed polylines and set a positive dimension offset. / پلی‌لاین بسته و فاصلهٔ معتبر انتخاب کن.');
  }
  return entities.flatMap(entity => {
    const edges = segments(entity);
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
          if (dist(nearest,base)>EPS) result.push(line(nearest,base));
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
