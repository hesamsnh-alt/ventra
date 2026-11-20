import {visibleEntities} from './document.mjs';
import {dist, inside, segments, validPolygon} from './geometry.mjs';
import {findHatchBoundary} from './hatchBoundary.mjs';
import {wallFaceLines} from './openings.mjs';
import {identifyMultilinePair, multilinePreview} from './multilineWalls.mjs';

const round = n => Number(n.toFixed(6));
const length = edges => edges.reduce((sum, e) => sum + dist(e.a, e.b), 0);

// Only measure complete, single-level ML networks that have closed envelopes.
export function measureAuthoredPlan(doc) {
  const entities = visibleEntities(doc);
  if (entities.some(e => (e.role==='wall' && !e.mlGroup || (['floor','hatch','stair'].includes(e.role) && !e.roomFinish)) || e.hatch && !e.roomFinish)) return null;
  const groups = new Map();
  for (const e of entities.filter(e => e.mlGroup && !e.mlDrafting)) {
    if (!groups.has(e.mlGroup)) groups.set(e.mlGroup, []);
    groups.get(e.mlGroup).push(e);
  }
  const envelopes = [], bands = [], boundaries = [], heights = new Set(), levels = new Set();
  let wallLength = 0;
  for (const faces of groups.values()) {
    const hosts=faces.filter(e=>e.role==='wall');
    const edges=faces.filter(e=>e.role!=='wall');
    if(hosts.length){
      const first=faces[0];
      if(faces.some(e=>e.height!==first.height || (e.z??0)!==(first.z??0)) || !(first.height>0))return null;
      heights.add(first.height);
      levels.add(first.z??0);
      const sides=[0,1].map(side=>edges.filter(e=>e.mlSide===side));
      wallLength+=(length(sides[0].flatMap(segments))+length(sides[1].flatMap(segments)))/2+length(hosts);
      const {floors,bands:pieces}=multilinePreview(faces);
      if(first.mlInner!=null){
        if(floors.length!==1)return null;
        const envelope={...first,type:'polyline',closed:true,points:floors[0].points};
        envelopes.push(envelope);
        boundaries.push(envelope);
      }else{
        for(const points of [...pieces.map(piece=>piece.points),...hosts.map(host=>{
          const [a,b]=wallFaceLines({entities:[]},host);
          return [a.a,a.b,b.b,b.a];
        })]){
          bands.push(points);
          boundaries.push({...first,type:'polyline',closed:true,points});
        }
      }
      continue;
    }
    const [a,b] = edges;
    const pair = faces.length === 2 && identifyMultilinePair(a,b);
    if (!pair || !(a.height > 0) || a.height !== b.height) return null;
    heights.add(a.height);
    levels.add(a.z ?? 0);
    wallLength += length(segments({...a, points:a.points.map((p,i)=>({x:(p.x+b.points[i].x)/2,y:(p.y+b.points[i].y)/2}))}));
    if (a.closed) {
      envelopes.push(faces[pair.inner]);
      boundaries.push(faces[pair.inner]);
    } else {
      const points = [...a.points,...b.points.slice().reverse()];
      if (!validPolygon(points)) return null;
      bands.push(points);
      boundaries.push({...a, points, closed:true});
    }
  }
  if (!envelopes.length || heights.size !== 1 || levels.size !== 1) return null;
  const faces = findHatchBoundary({...doc, entities:boundaries},null,{allFaces:true});
  const rooms = faces.filter(face => {
    const [a,b] = face.points, d = dist(a,b);
    const p = {x:(a.x+b.x)/2-(b.y-a.y)/d*1e-5,y:(a.y+b.y)/2+(b.x-a.x)/d*1e-5};
    return envelopes.some(e=>inside(p,e.points)) && !bands.some(band=>inside(p,band));
  });
  if (!rooms.length || rooms.some((room,i)=>rooms.some((other,j)=>i!==j && inside(room.points[0],other.points)))) return null;
  const openings = entities.filter(e=>e.type==='opening');
  if(openings.some(e=>!entities.some(host=>host.id===e.wall && host.role==='wall')))return null;
  if (openings.some(e=>!['door','window'].includes(e.kind) || !(e.width>0 && e.height>0))) return null;
  const [height] = heights;
  const area = round(rooms.reduce((sum,room)=>sum+room.area,0));
  const wallArea = round(rooms.reduce((sum,room)=>sum+length(segments({type:'polyline',closed:true,points:room.points})),0)*height);
  const deduction = openings.reduce((sum,e)=>{
    const host=entities.find(w=>w.id===e.wall);
    const d=dist(host.a,host.b);
    const center={x:host.a.x+(host.b.x-host.a.x)*e.offset,y:host.a.y+(host.b.y-host.a.y)*e.offset};
    const offset=(host.thickness/2+1e-5)/d;
    const sides=[-1,1].filter(sign=>rooms.some(room=>inside({
      x:center.x-sign*(host.b.y-host.a.y)*offset,
      y:center.y+sign*(host.b.x-host.a.x)*offset,
    },room.points)));
    return sum+sides.length*e.width*e.height;
  },0);
  const quantities = [];
  const basis = 'Measured from the original Plan Studio wall geometry and opening dimensions.';
  const record = (key,value,unit='m2') => quantities.push({key,value,unit,scope_id:'image',evidence:basis});
  const result = {source:'plan_studio_image', rooms:rooms.length, floor_area:area, room_area:area, ceiling_area:area,
    wall_length:round(wallLength), wall_height:height, wall_area:wallArea, wall_height_source:'authored_source',
    wall_height_evidence:basis, notes:basis, confidence:100,
    raster_measurement_audit:{version:2,status:'dimension_geometry_checked',height,wallMeasurementStatus:'computed',
      netInternalWall:{value:round(Math.max(0,wallArea-deduction)),basis:'Measured internal wall faces less openings on each room side.'}}, page_evidence:{kind:'floor_plan',scope_id:'image',quantities}};
  for (const key of ['floor_area','ceiling_area','wall_area']) record(key,result[key]);
  for (const kind of ['door','window']) {
    const matching = openings.filter(e=>e.kind===kind);
    result[kind+'s'] = matching.length;
    result[kind+'_area'] = round(matching.reduce((sum,e)=>sum+e.width*e.height,0));
    record(kind+'_count',matching.length,'nr');
    record(kind+'_area',result[kind+'_area']);
  }
  return result;
}
