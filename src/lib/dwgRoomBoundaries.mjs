import {canonicalRoomType} from './roomSemantics.mjs';

// Presentation geometry only: these portal closures are never rendered as walls
// and never change engineering takeoff quantities.
function distance2D(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function pkey(p){return `${Number(p?.x||0).toFixed(5)},${Number(p?.y||0).toFixed(5)}`;}

function lkey(s){const a=pkey(s?.start),b=pkey(s?.end);return a<b?`${a}|${b}`:`${b}|${a}`;}

function uniqLines(lines){const seen=new Set(),out=[];for(const l of Array.isArray(lines)?lines:[]){const k=lkey(l);if(seen.has(k))continue;seen.add(k);out.push(l);}return out;}

function segIntersect(a,b,c,d){const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;if(Math.abs(den)<1e-10)return null;const qx=c.x-a.x,qy=c.y-a.y,t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;if(t<-1e-8||t>1+1e-8||u<-1e-8||u>1+1e-8)return null;return {t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u))};}

function splitLines(lines){const src=uniqLines(lines),ts=src.map(()=>[0,1]);for(let i=0;i<src.length;i++)for(let j=i+1;j<src.length;j++){const r=segIntersect(src[i].start,src[i].end,src[j].start,src[j].end);if(r){ts[i].push(r.t);ts[j].push(r.u)}}const out=[];src.forEach((s,i)=>{const vals=[...new Set(ts[i].map(v=>Number(v.toFixed(9))))].sort((a,b)=>a-b);for(let k=0;k<vals.length-1;k++){const a=vals[k],b=vals[k+1];if(b-a<1e-8)continue;const start={x:s.start.x+(s.end.x-s.start.x)*a,y:s.start.y+(s.end.y-s.start.y)*a},end={x:s.start.x+(s.end.x-s.start.x)*b,y:s.start.y+(s.end.y-s.start.y)*b};out.push({...s,start,end,length:distance2D(start,end)});}});return uniqLines(out);}

function polyArea(ps){let s=0;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];s+=a.x*b.y-b.x*a.y;}return s/2;}

function polyPer(ps){let s=0;for(let i=0;i<ps.length;i++)s+=distance2D(ps[i],ps[(i+1)%ps.length]);return s;}

function polyCent(ps){const a=polyArea(ps);if(Math.abs(a)<1e-12)return ps.reduce((r,p)=>({x:r.x+p.x/ps.length,y:r.y+p.y/ps.length}),{x:0,y:0});let x=0,y=0;for(let i=0;i<ps.length;i++){const p=ps[i],q=ps[(i+1)%ps.length],c=p.x*q.y-q.x*p.y;x+=(p.x+q.x)*c;y+=(p.y+q.y)*c;}return {x:x/(6*a),y:y/(6*a)};}

function closedFaces(walls, f) {
  if (!(Number(f) > 0)) {
    return {
      polygons: [],
      area: 0,
      footprintArea: 0,
      footprintAreaModelUnits: 0,
      footprintPolygons: [],
      confidence: 0,
      source: "unavailable",
      footprintSource: "unavailable",
    };
  }

  const split =
    splitLines(walls);

  const adj = new Map();

  const point = (key) => {
    const [x, y] =
      key
        .split(",")
        .map(Number);

    return { x, y };
  };

  const add = (a, b) => {
    if (!adj.has(a)) {
      adj.set(a, new Set());
    }

    adj.get(a).add(b);
  };

  for (const segment of split) {
    const a = pkey(segment.start);
    const b = pkey(segment.end);

    if (a === b) continue;

    add(a, b);
    add(b, a);
  }

  for (const [vertex, neighbors] of adj) {
    const origin = point(vertex);

    adj.set(
      vertex,
      [...neighbors].sort((leftKey, rightKey) => {
        const left = point(leftKey);
        const right = point(rightKey);

        return (
          Math.atan2(
            left.y - origin.y,
            left.x - origin.x
          ) -
          Math.atan2(
            right.y - origin.y,
            right.x - origin.x
          )
        );
      })
    );
  }

  const componentByVertex = new Map();
  let componentId = 0;

  for (const vertex of adj.keys()) {
    if (componentByVertex.has(vertex)) continue;

    const queue = [vertex];
    componentByVertex.set(vertex, componentId);

    while (queue.length) {
      const current = queue.shift();

      for (const next of adj.get(current) || []) {
        if (componentByVertex.has(next)) continue;

        componentByVertex.set(next, componentId);
        queue.push(next);
      }
    }

    componentId += 1;
  }

  const used = new Set();
  const faces = [];

  for (const [startVertex, neighbors] of adj) {
    for (const nextVertex of neighbors) {
      const initialEdge = `${startVertex}>${nextVertex}`;

      if (used.has(initialEdge)) continue;

      let a = startVertex;
      let b = nextVertex;
      const vertices = [];

      for (
        let guard = 0;
        guard < Math.max(20, split.length * 6);
        guard += 1
      ) {
        const edgeKey = `${a}>${b}`;

        if (used.has(edgeKey)) break;

        used.add(edgeKey);
        vertices.push(a);

        const outgoing = adj.get(b) || [];
        const reverseIndex = outgoing.indexOf(a);

        if (reverseIndex < 0 || !outgoing.length) break;

        const c =
          outgoing[
            (reverseIndex - 1 + outgoing.length) %
              outgoing.length
          ];

        a = b;
        b = c;

        if (
          a === startVertex &&
          b === nextVertex
        ) {
          break;
        }
      }

      if (vertices.length < 3) continue;

      const points = vertices.map(point);
      const signedArea = polyArea(points);

      if (Math.abs(signedArea) <= 1e-8) continue;

      faces.push({
        component:
          componentByVertex.get(vertices[0]) || 0,
        points,
        area: Math.abs(signedArea),
      });
    }
  }

  const groups = new Map();

  for (const face of faces) {
    if (!groups.has(face.component)) {
      groups.set(face.component, []);
    }

    groups.get(face.component).push(face);
  }

  const boundedFaces = [];
  const exteriorFaces = [];

  for (const group of groups.values()) {
    if (!group.length) continue;

    const exterior =
      group.reduce(
        (best, face) =>
          !best || face.area > best.area
            ? face
            : best,
        null
      );

    if (exterior) {
      exteriorFaces.push(exterior);
    }

    boundedFaces.push(
      ...group.filter(
        (face) => face !== exterior
      )
    );
  }

  const dedupedRooms = new Map();

  for (const face of boundedFaces) {
    const points =
      face.points.map((pointValue) => ({
        x: pointValue.x * f,
        y: pointValue.y * f,
      }));

    const area = Math.abs(polyArea(points));
    const perimeter = polyPer(points);
    const centroid = polyCent(points);

    if (
      area < 1.2 ||
      area > 1000 ||
      perimeter <= 0
    ) {
      continue;
    }

    const key =
      `${centroid.x.toFixed(3)}:` +
      `${centroid.y.toFixed(3)}:` +
      `${area.toFixed(2)}`;

    if (dedupedRooms.has(key)) continue;

    dedupedRooms.set(key, {
      id: `room-${dedupedRooms.size + 1}`,
      name: `Room ${dedupedRooms.size + 1}`,
      area,
      areaModelUnits: face.area,
      perimeter,
      centroid,
      points,
      detectionMethod:
        "wall_centerline_planar_faces",
    });
  }

  const polygons = [...dedupedRooms.values()];

  const roomArea =
    polygons.reduce(
      (sum, polygon) =>
        sum + polygon.area,
      0
    );

  /*
   * Gross floor area must come from the closed exterior WALL loop,
   * not from the sum of internal room faces. Door/opening gaps can
   * legitimately reduce room-face area while the building footprint
   * remains unchanged.
   */
  const footprintPolygons = [];

  for (const face of exteriorFaces) {
    const points =
      face.points.map((pointValue) => ({
        x: pointValue.x * f,
        y: pointValue.y * f,
      }));

    const area =
      Math.abs(polyArea(points));

    const perimeter =
      polyPer(points);

    if (
      area < 1.2 ||
      area > 100000 ||
      perimeter <= 0
    ) {
      continue;
    }

    footprintPolygons.push({
      id:
        `floor-footprint-${
          footprintPolygons.length + 1
        }`,
      area,
      areaModelUnits: face.area,
      perimeter,
      centroid: polyCent(points),
      points,
      detectionMethod:
        "wall_exterior_closed_loop",
    });
  }

  const footprintArea =
    footprintPolygons.reduce(
      (sum, polygon) =>
        sum + polygon.area,
      0
    );

  const footprintAreaModelUnits =
    footprintPolygons.reduce(
      (sum, polygon) =>
        sum +
        (
          Number(
            polygon.areaModelUnits
          ) || 0
        ),
      0
    );

  return {
    polygons,
    area: roomArea,
    footprintArea,
    footprintAreaModelUnits,
    footprintPolygons,
    confidence:
      polygons.length
        ? 98
        : footprintPolygons.length
          ? 96
          : 0,
    source:
      polygons.length
        ? "wall_centerline_planar_faces"
        : "unavailable",
    footprintSource:
      footprintPolygons.length
        ? "wall_exterior_closed_loops"
        : "unavailable",
  };
}

const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const finite=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
const cleanText=value=>String(value||'').replace(/\\P/g,'\n').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').trim();

export function collectInteriorRoomLabels(objects,centroids={},viewerLabels=[]){
 const labels=[],seen=new Set();
 for(const object of [...(objects||[]),...(viewerLabels||[])]){
  const spatial=centroids[String(object.dbId)];
  // All label coordinates must come from transformed APS geometry, in metres.
  if(!finite(spatial))continue;
  const properties=object.properties||object.rawProperties||[];
  const values=[object.text,object.label,object.name,...(Array.isArray(properties)?properties.filter(p=>/text|contents|value/i.test(p.displayName||p.attributeName||'')).map(p=>p.displayValue):[])];
  const candidates=values.map(cleanText).filter(t=>t&&t.length<=200&&canonicalRoomType({name:t})!=='room');
  const name=candidates.sort((a,b)=>b.length-a.length)[0];if(!name)continue;
  const key=String(object.dbId);if(seen.has(key))continue;seen.add(key);
  labels.push({dbId:object.dbId,name,centroid:{x:spatial.x,y:spatial.y},coordinateSource:'aps_dbid_geometry_bounds'});
 }
 return labels;
}

function portalClosures(walls,openingLines,factor){
 const groups=new Map();
 for(const l of openingLines){if(!finite(l.start)||!finite(l.end)||l.dbId==null)continue;const id=String(l.dbId),g=groups.get(id)||{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const p of [l.start,l.end]){g.minX=Math.min(g.minX,p.x);g.maxX=Math.max(g.maxX,p.x);g.minY=Math.min(g.minY,p.y);g.maxY=Math.max(g.maxY,p.y);}groups.set(id,g);}
 const ends=[...new Map(walls.flatMap(l=>[l.start,l.end]).map(p=>[pkey(p),p])).values()],out=[],seen=new Set(),tol=.002/factor;
 if(ends.length>3000)return [];
 for(let i=0;i<ends.length;i++)for(let j=i+1;j<ends.length;j++){
  const a=ends[i],b=ends[j],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(len*factor<.45||len*factor>2.5||Math.min(Math.abs(dx),Math.abs(dy))>tol)continue;
  const ux=dx/len,uy=dy/len;
  const continues=(p,sign)=>walls.some(l=>{const q=distance2D(l.start,p)<tol?l.end:distance2D(l.end,p)<tol?l.start:null;return q&&Math.abs((q.x-p.x)*uy-(q.y-p.y)*ux)<tol&&((q.x-p.x)*ux+(q.y-p.y)*uy)*sign>.02/factor;});
  if(!continues(a,-1)||!continues(b,1))continue;
  const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  if(walls.some(l=>Math.abs((l.start.x-a.x)*uy-(l.start.y-a.y)*ux)<tol&&Math.abs((l.end.x-a.x)*uy-(l.end.y-a.y)*ux)<tol&&Math.min(len,Math.max((l.start.x-a.x)*ux+(l.start.y-a.y)*uy,(l.end.x-a.x)*ux+(l.end.y-a.y)*uy))-Math.max(0,Math.min((l.start.x-a.x)*ux+(l.start.y-a.y)*uy,(l.end.x-a.x)*ux+(l.end.y-a.y)*uy))>tol))continue;
  const evidence=[...groups.entries()].find(([,g])=>mid.x>=g.minX-.2/factor&&mid.x<=g.maxX+.2/factor&&mid.y>=g.minY-.2/factor&&mid.y<=g.maxY+.2/factor);
  if(!evidence)continue;
  const line={start:a,end:b},key=lkey(line);if(seen.has(key))continue;seen.add(key);
  out.push({...line,dbId:`portal-${out.length}`,openingDbId:evidence[0],synthetic:true,presentationBoundaryOnly:true});
 }
 return out;
}

export function recoverInteriorRoomBoundaries({wallLines=[],openingLines=[],meterFactor,labels=[]}){
 if(!(meterFactor>0)||wallLines.length>3000)return {rooms:[],closures:[],unmatchedLabels:labels,reason:'missing_calibration_or_geometry_limit'};
 // Normalize before graph snapping so millimetre and metre files share precision.
 const metricPoint=p=>({x:Number((p.x*meterFactor).toFixed(6)),y:Number((p.y*meterFactor).toFixed(6))});
 const normalize=lines=>lines.filter(l=>finite(l.start)&&finite(l.end)).map(l=>({...l,start:metricPoint(l.start),end:metricPoint(l.end)})).sort((a,b)=>lkey(a).localeCompare(lkey(b)));
 const walls=normalize(wallLines);
 const closures=portalClosures(walls,normalize(openingLines),1);
 const candidates=closedFaces([...walls,...closures],1).polygons;
 const assigned=new Map(),unmatchedLabels=[];
 for(const label of labels){
  if(!finite(label.centroid)){unmatchedLabels.push(label);continue;}
  const fits=candidates.filter(p=>inside(label.centroid,p.points)).sort((a,b)=>a.area-b.area);
  if(!fits.length){unmatchedLabels.push(label);continue;}
  const room=fits[0];assigned.set(room.id,[...(assigned.get(room.id)||[]),label]);
 }
 const rooms=candidates.flatMap(room=>{
  const evidence=assigned.get(room.id)||[];
  // Omit enclosing floor outlines: assigning a use to them would furnish over rooms.
  if(!evidence.length&&candidates.some(other=>other.id!==room.id&&assigned.has(other.id)&&other.area<room.area&&inside(other.centroid,room.points)))return [];
  const types=new Set(evidence.map(l=>canonicalRoomType(l))),privateTypes=[...types].filter(t=>['bathroom','bedroom'].includes(t));
  const conflict=privateTypes.length>1||privateTypes.length&&types.size>1;
  const name=evidence.map(l=>l.name).join(' / ')||room.name;
  const type=conflict?'unknown':canonicalRoomType({name});
  // IDs depend on geometry, not loop enumeration or label text.
  const id=`dwg-space-${room.centroid.x.toFixed(4)}-${room.centroid.y.toFixed(4)}-${room.area.toFixed(3)}`;
  return [{...room,id,name,type,semanticType:type,roomUseSource:evidence.length&&!conflict?'cad_label_in_closed_boundary':'unclassified',sourceLabelDbIds:evidence.map(l=>l.dbId),classificationConflict:!!conflict}];
 });
 return {rooms,closures,unmatchedLabels,reason:'calibrated_walls_and_classified_portals'};
}
