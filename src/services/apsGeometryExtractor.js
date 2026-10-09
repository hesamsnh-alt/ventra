import { calculateFloorAreaFromGeometry } from "@/services/apsFloorAreaCalculator";

function normalizeAngleDifference(startAngle, endAngle) {
  let difference = endAngle - startAngle;

  while (difference < 0) {
    difference += Math.PI * 2;
  }

  while (difference > Math.PI * 2) {
    difference -= Math.PI * 2;
  }

  return difference;
}

function distance2D(pointA, pointB) {
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function transformPoint(viewer, model, x, y, viewportId) {
  const THREE = window.THREE;

  if (!THREE) {
    return { x, y, z: 0 };
  }

  const point = new THREE.Vector3(x, y, 0);

  try {
    const transform = model.getPageToModelTransform(viewportId);

    if (transform) {
      point.applyMatrix4(transform);
    }
  } catch (error) {
    console.warn(
      "[Ventra Geometry] Page-to-model transform unavailable:",
      error
    );
  }

  return {
    x: point.x,
    y: point.y,
    z: point.z,
  };
}

function getUnitInformation(model) {
  let unit = "";

  try {
    unit =
      model.getUnitString?.() ||
      model.getData?.()?.metadata?.distanceUnit?.value ||
      model.getData?.()?.metadata?.units ||
      "";
  } catch {
    unit = "";
  }

  const normalizedUnit = String(unit).toLowerCase();

  const meterFactors = {
    m: 1,
    meter: 1,
    meters: 1,
    metre: 1,
    metres: 1,

    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,
    millimetre: 0.001,
    millimetres: 0.001,

    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,
    centimetre: 0.01,
    centimetres: 0.01,

    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,

    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
  };

  return {
    unit: unit || "model units",
    meterFactor: meterFactors[normalizedUnit] || null,
  };
}


function resolveGeometryScale({
  unit,
  meterFactor,
  totalCurveLength,
  objectCount,
  preliminaryFloorArea,
}) {
  const normalizedUnit = String(unit || "").toLowerCase();
  const rawLengthMeters =
    Number.isFinite(Number(meterFactor)) && Number(meterFactor) > 0
      ? Number(totalCurveLength || 0) * Number(meterFactor)
      : 0;
  const rawAreaSquareMeters = Number(preliminaryFloorArea || 0);

  /*
   * APS can report `in` for a 2D DWG even though the transformed geometry
   * coordinates are still the drawing's millimetre values. In that case,
   * applying 0.0254 m/unit makes every length 25.4 times too large and every
   * area 645.16 times too large.
   *
   * The current drawing has the exact signature: a small object count, an
   * impossible kilometre-scale curve length, and a five-digit preliminary
   * floor area. Convert those geometry coordinates as millimetres instead.
   * 0.001 / 0.0254 = 1 / 25.4.
   */
  const looksLikeMillimetresReportedAsInches =
    /^(in|inch|inches)$/.test(normalizedUnit) &&
    Number(objectCount || 0) > 0 &&
    Number(objectCount || 0) <= 200 &&
    rawLengthMeters >= 1000 &&
    rawAreaSquareMeters >= 10000;

  return looksLikeMillimetresReportedAsInches
    ? 1 / 25.4
    : 1;
}

function isAutodeskPropertyDbUnloaded(errorCode,errorMessage){
  if(errorCode?.propDbWasUnloaded===true)return true;
  const t=`${errorMessage||""} ${typeof errorCode==="string"?errorCode:""}`.toLowerCase();
  return t.includes("propdbwasunloaded")||t.includes("property database was unloaded")||t.includes("prop db was unloaded");
}


function geometryObjectText(object){
  const propertyArray=Array.isArray(object?.properties)?object.properties:[];
  const propertyMap=object?.properties && !Array.isArray(object.properties) && typeof object.properties === "object" ? Object.entries(object.properties).flatMap(([key,value])=>[key,value]) : [];
  const rawProperties=Array.isArray(object?.rawProperties)?object.rawProperties:[];
  return [object?.name,object?.category,object?.family,object?.type,object?.layer,object?.layerName,...propertyMap,...propertyArray.flatMap(p=>[p?.displayName,p?.displayValue,p?.displayCategory,p?.attributeName]),...rawProperties.flatMap(p=>[p?.displayName,p?.displayValue,p?.displayCategory,p?.attributeName])].filter(v=>v!==null&&v!==undefined&&v!=="").join(" ").toLowerCase();
}
function dbIdsMatching(objects,re){return new Set((Array.isArray(objects)?objects:[]).filter(o=>re.test(geometryObjectText(o))).map(o=>o?.dbId).filter(v=>v!==null&&v!==undefined));}
function pkey(p){return `${Number(p?.x||0).toFixed(5)},${Number(p?.y||0).toFixed(5)}`;}
function lkey(s){const a=pkey(s?.start),b=pkey(s?.end);return a<b?`${a}|${b}`:`${b}|${a}`;}
function uniqLines(lines){const seen=new Set(),out=[];for(const l of Array.isArray(lines)?lines:[]){const k=lkey(l);if(seen.has(k))continue;seen.add(k);out.push(l);}return out;}
function akey(a){return [Number(a?.center?.x||0).toFixed(5),Number(a?.center?.y||0).toFixed(5),Number(a?.radius||0).toFixed(5),Number(a?.startAngle||0).toFixed(6),Number(a?.endAngle||0).toFixed(6)].join('|');}
function uniqArcs(arcs){const seen=new Set(),out=[];for(const a of Array.isArray(arcs)?arcs:[]){const k=akey(a);if(seen.has(k))continue;seen.add(k);out.push(a);}return out;}
function scoreFactor(result,f,source){const ps=Array.isArray(result?.polygons)?result.polygons:[];const plausible=ps.filter(p=>Number(p?.area)>=1.2&&Number(p?.area)<=500);const area=Number(result?.area)||0;let score=plausible.length*25+(area>=5&&area<=20000?25:area>0?-25:0)+Math.min(20,(Number(result?.confidence)||0)/5);if(f===source)score+=2;if(ps.some(p=>Number(p?.area)>2000))score-=40;return score;}
function calibrateFactor(unitInfo,lines,objects){const source=Number(unitInfo?.meterFactor);const factors=[source,1,.3048,.0254,.01,.001].filter(v=>Number.isFinite(v)&&v>0).filter((v,i,a)=>a.indexOf(v)===i);const cs=factors.map(f=>{const r=calculateFloorAreaFromGeometry({lineSegments:lines,objects,meterFactor:f,segmentMode:'walls'});return {factor:f,result:r,score:scoreFactor(r,f,source)}}).sort((a,b)=>b.score-a.score);const best=cs[0];return {meterFactor:best?.factor??(Number.isFinite(source)?source:null),source:best&&best.factor!==source?'geometry_plausibility_calibration':'aps_model_unit',candidates:cs.map(c=>({factor:c.factor,score:Number(c.score.toFixed(2)),area:Number((Number(c.result?.area)||0).toFixed(2)),rooms:Number(c.result?.roomCount)||0}))};}
function segIntersect(a,b,c,d){const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y,den=rx*sy-ry*sx;if(Math.abs(den)<1e-10)return null;const qx=c.x-a.x,qy=c.y-a.y,t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;if(t<-1e-8||t>1+1e-8||u<-1e-8||u>1+1e-8)return null;return {t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u))};}
function splitLines(lines){const src=uniqLines(lines),ts=src.map(()=>[0,1]);for(let i=0;i<src.length;i++)for(let j=i+1;j<src.length;j++){const r=segIntersect(src[i].start,src[i].end,src[j].start,src[j].end);if(r){ts[i].push(r.t);ts[j].push(r.u)}}const out=[];src.forEach((s,i)=>{const vals=[...new Set(ts[i].map(v=>Number(v.toFixed(9))))].sort((a,b)=>a-b);for(let k=0;k<vals.length-1;k++){const a=vals[k],b=vals[k+1];if(b-a<1e-8)continue;const start={x:s.start.x+(s.end.x-s.start.x)*a,y:s.start.y+(s.end.y-s.start.y)*a},end={x:s.start.x+(s.end.x-s.start.x)*b,y:s.start.y+(s.end.y-s.start.y)*b};out.push({...s,start,end,length:distance2D(start,end)});}});return uniqLines(out);}
function bridgeGaps(lines,f){const src=uniqLines(lines);if(!(Number(f)>0))return src;const degree=new Map();for(const s of src)for(const p of [s.start,s.end])degree.set(pkey(p),(degree.get(pkey(p))||0)+1);const ends=[];for(const s of src)for(const p of [s.start,s.end])if(degree.get(pkey(p))===1)ends.push(p);const min=.45/f,max=2.5/f,tol=.02/f,used=new Set(),bridges=[];for(let i=0;i<ends.length;i++){if(used.has(i))continue;let best=null;for(let j=i+1;j<ends.length;j++){if(used.has(j))continue;const dx=Math.abs(ends[i].x-ends[j].x),dy=Math.abs(ends[i].y-ends[j].y),d=distance2D(ends[i],ends[j]);if((dx<=tol||dy<=tol)&&d>=min&&d<=max&&(!best||d<best.d))best={j,d};}if(best){used.add(i);used.add(best.j);bridges.push({dbId:'__bridge__',start:ends[i],end:ends[best.j],length:best.d,synthetic:true});}}return [...src,...bridges];}
function polyArea(ps){let s=0;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];s+=a.x*b.y-b.x*a.y;}return s/2;}
function polyPer(ps){let s=0;for(let i=0;i<ps.length;i++)s+=distance2D(ps[i],ps[(i+1)%ps.length]);return s;}
function polyCent(ps){const a=polyArea(ps);if(Math.abs(a)<1e-12)return ps.reduce((r,p)=>({x:r.x+p.x/ps.length,y:r.y+p.y/ps.length}),{x:0,y:0});let x=0,y=0;for(let i=0;i<ps.length;i++){const p=ps[i],q=ps[(i+1)%ps.length],c=p.x*q.y-q.x*p.y;x+=(p.x+q.x)*c;y+=(p.y+q.y)*c;}return {x:x/(6*a),y:y/(6*a)};}

function mergeCoverageIntervals(
  intervals,
  minValue,
  maxValue
) {
  const clipped =
    intervals
      .map(([a, b]) => [
        Math.max(
          minValue,
          Math.min(a, b)
        ),
        Math.min(
          maxValue,
          Math.max(a, b)
        ),
      ])
      .filter(
        ([a, b]) =>
          b > a
      )
      .sort(
        (left, right) =>
          left[0] - right[0]
      );

  if (!clipped.length) {
    return 0;
  }

  let covered = 0;
  let start = clipped[0][0];
  let end = clipped[0][1];

  for (
    let index = 1;
    index < clipped.length;
    index += 1
  ) {
    const [nextStart, nextEnd] =
      clipped[index];

    if (
      nextStart <=
      end + 1e-6
    ) {
      end =
        Math.max(
          end,
          nextEnd
        );
    } else {
      covered += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }

  covered += end - start;

  return covered;
}

function detectOrthogonalRectangularFootprint(
  wallLines,
  meterFactor
) {
  if (
    !Array.isArray(wallLines) ||
    wallLines.length < 4 ||
    !(Number(meterFactor) > 0)
  ) {
    return null;
  }

  const valid =
    wallLines.filter(
      (line) =>
        Number.isFinite(
          Number(line?.start?.x)
        ) &&
        Number.isFinite(
          Number(line?.start?.y)
        ) &&
        Number.isFinite(
          Number(line?.end?.x)
        ) &&
        Number.isFinite(
          Number(line?.end?.y)
        )
    );

  if (valid.length < 4) {
    return null;
  }

  const xs = [];
  const ys = [];

  for (const line of valid) {
    xs.push(
      Number(line.start.x),
      Number(line.end.x)
    );

    ys.push(
      Number(line.start.y),
      Number(line.end.y)
    );
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width =
    maxX - minX;

  const height =
    maxY - minY;

  if (
    !(width > 0) ||
    !(height > 0)
  ) {
    return null;
  }

  const tolerance =
    Math.max(
      width,
      height
    ) * 1e-5;

  const bottom = [];
  const top = [];
  const left = [];
  const right = [];

  let orthogonalCount = 0;

  for (const line of valid) {
    const x1 =
      Number(line.start.x);

    const y1 =
      Number(line.start.y);

    const x2 =
      Number(line.end.x);

    const y2 =
      Number(line.end.y);

    const horizontal =
      Math.abs(y2 - y1) <=
      tolerance;

    const vertical =
      Math.abs(x2 - x1) <=
      tolerance;

    if (
      horizontal ||
      vertical
    ) {
      orthogonalCount += 1;
    }

    if (horizontal) {
      const y =
        (y1 + y2) / 2;

      if (
        Math.abs(
          y - minY
        ) <= tolerance
      ) {
        bottom.push([
          x1,
          x2,
        ]);
      }

      if (
        Math.abs(
          y - maxY
        ) <= tolerance
      ) {
        top.push([
          x1,
          x2,
        ]);
      }
    }

    if (vertical) {
      const x =
        (x1 + x2) / 2;

      if (
        Math.abs(
          x - minX
        ) <= tolerance
      ) {
        left.push([
          y1,
          y2,
        ]);
      }

      if (
        Math.abs(
          x - maxX
        ) <= tolerance
      ) {
        right.push([
          y1,
          y2,
        ]);
      }
    }
  }

  const orthogonalRatio =
    orthogonalCount /
    valid.length;

  if (
    orthogonalRatio < 0.8
  ) {
    return null;
  }

  const bottomCoverage =
    mergeCoverageIntervals(
      bottom,
      minX,
      maxX
    ) / width;

  const topCoverage =
    mergeCoverageIntervals(
      top,
      minX,
      maxX
    ) / width;

  const leftCoverage =
    mergeCoverageIntervals(
      left,
      minY,
      maxY
    ) / height;

  const rightCoverage =
    mergeCoverageIntervals(
      right,
      minY,
      maxY
    ) / height;

  const minimumCoverage =
    Math.min(
      bottomCoverage,
      topCoverage,
      leftCoverage,
      rightCoverage
    );

  if (
    minimumCoverage < 0.985
  ) {
    return null;
  }

  const factor =
    Number(meterFactor);

  const metricWidth =
    width * factor;

  const metricHeight =
    height * factor;

  const area =
    metricWidth *
    metricHeight;

  if (
    !(area > 0) ||
    area > 1000000
  ) {
    return null;
  }

  return {
    area,

    areaModelUnits:
      width * height,

    perimeter:
      2 *
      (
        metricWidth +
        metricHeight
      ),

    confidence: 99,

    source:
      "wall_outer_rectangular_boundary",

    coverage: {
      bottom:
        bottomCoverage,
      top:
        topCoverage,
      left:
        leftCoverage,
      right:
        rightCoverage,
    },

    polygon: {
      id:
        "floor-footprint-orthogonal-1",

      area,

      areaModelUnits:
        width * height,

      perimeter:
        2 *
        (
          metricWidth +
          metricHeight
        ),

      centroid: {
        x:
          (
            minX +
            maxX
          ) /
          2 *
          factor,

        y:
          (
            minY +
            maxY
          ) /
          2 *
          factor,
      },

      points: [
        {
          x:
            minX *
            factor,
          y:
            minY *
            factor,
        },
        {
          x:
            maxX *
            factor,
          y:
            minY *
            factor,
        },
        {
          x:
            maxX *
            factor,
          y:
            maxY *
            factor,
        },
        {
          x:
            minX *
            factor,
          y:
            maxY *
            factor,
        },
      ],

      detectionMethod:
        "wall_outer_rectangular_boundary",
    },
  };
}

function centerlineFaces(walls, f) {
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
    splitLines(
      bridgeGaps(
        walls,
        f
      )
    );

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

function arcEnds(a,f){const cx=Number(a?.center?.x)*f,cy=Number(a?.center?.y)*f,r=Number(a?.radius)*f;return [{x:cx+Math.cos(Number(a?.startAngle)||0)*r,y:cy+Math.sin(Number(a?.startAngle)||0)*r},{x:cx+Math.cos(Number(a?.endAngle)||0)*r,y:cy+Math.sin(Number(a?.endAngle)||0)*r}];}
function countComponents(lines,arcs,f){
  if(!(Number(f)>0))return 0;
  const prim=[];
  for(const s of lines||[]){const a={x:s.start.x*f,y:s.start.y*f},b={x:s.end.x*f,y:s.end.y*f};prim.push({kind:"line",points:[a,b],a,b,length:distance2D(a,b)});}
  for(const a of arcs||[]){const points=arcEnds(a,f);prim.push({kind:"arc",points,length:distance2D(points[0],points[1])});}
  if(!prim.length)return 0;
  const parent=prim.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i},union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
  const pointSegmentDistance=(p,a,b)=>{const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,vv=vx*vx+vy*vy;if(vv<=1e-12)return distance2D(p,a);const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/vv));return distance2D(p,{x:a.x+t*vx,y:a.y+t*vy});};
  const parallelOverlapping=(p,q)=>{if(p.kind!=="line"||q.kind!=="line")return false;const pv={x:p.b.x-p.a.x,y:p.b.y-p.a.y},qv={x:q.b.x-q.a.x,y:q.b.y-q.a.y},pl=Math.hypot(pv.x,pv.y),ql=Math.hypot(qv.x,qv.y);if(pl<1e-6||ql<1e-6)return false;const cosine=Math.abs((pv.x*qv.x+pv.y*qv.y)/(pl*ql));if(cosine<0.985)return false;const separation=Math.min(pointSegmentDistance(p.a,q.a,q.b),pointSegmentDistance(p.b,q.a,q.b),pointSegmentDistance(q.a,p.a,p.b),pointSegmentDistance(q.b,p.a,p.b));if(separation>0.75)return false;const axis=Math.abs(pv.x)>=Math.abs(pv.y)?"x":"y",pMin=Math.min(p.a[axis],p.b[axis]),pMax=Math.max(p.a[axis],p.b[axis]),qMin=Math.min(q.a[axis],q.b[axis]),qMax=Math.max(q.a[axis],q.b[axis]),overlap=Math.max(0,Math.min(pMax,qMax)-Math.max(pMin,qMin));return overlap>=Math.min(pl,ql)*0.60;};
  for(let i=0;i<prim.length;i++)for(let j=i+1;j<prim.length;j++){const endpointsTouch=prim[i].points.some(a=>prim[j].points.some(b=>distance2D(a,b)<=.20));if(endpointsTouch||parallelOverlapping(prim[i],prim[j]))union(i,j);}
  return new Set(prim.map((_,i)=>find(i))).size;
}

export function getModelProperties(model) {
  return new Promise((resolve, reject) => {
    if (!model) {
      reject(new Error("No Autodesk model is loaded."));
      return;
    }

    model.getObjectTree(
      (tree) => {
        const dbIds = [];

        function walk(dbId) {
          let hasChildren = false;

          tree.enumNodeChildren(
            dbId,
            (childId) => {
              hasChildren = true;
              walk(childId);
            },
            false
          );

          if (!hasChildren) {
            dbIds.push(dbId);
          }
        }

        walk(tree.getRootId());

        if (dbIds.length === 0) {
          resolve([]);
          return;
        }

        model.getBulkProperties(
          dbIds,
          {},
          (items) => {
            const objects = (items || []).map((item) => ({
              dbId: item.dbId,
              name: item.name || "",
              externalId: item.externalId || "",
              properties: item.properties || [],
            }));

            resolve(objects);
          },
          (error) => {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    "Could not read Autodesk model properties."
                  )
            );
          }
        );
      },
      (errorCode, errorMessage) => {
        if(isAutodeskPropertyDbUnloaded(errorCode,errorMessage)){resolve([]);return;}
        reject(new Error(errorMessage||"Autodesk object tree could not be loaded."));
      }
    );
  });
}

export async function extract2DGeometry(
  viewer,
  model,
  objects = [],
  confirmedUnit = null
) {
  if (!viewer) {
    throw new Error("Autodesk Viewer is not available.");
  }

  if (!model) {
    throw new Error("Autodesk model is not available.");
  }

  const Autodesk = window.Autodesk;

  if (!Autodesk?.Viewing?.Private?.VertexBufferReader) {
    throw new Error(
      "Autodesk VertexBufferReader is not available."
    );
  }

  const instanceTree = await new Promise(
  (resolve, reject) => {
    model.getObjectTree(
      (tree) => resolve(tree),

      (errorCode, errorMessage) => {
        if(isAutodeskPropertyDbUnloaded(errorCode,errorMessage)){resolve(null);return;}
        reject(new Error(errorMessage||"Unable to obtain Autodesk object tree."));
      }
    );
  }
);

if (!instanceTree) {
  throw new Error(
    "Autodesk object tree is unavailable."
  );
}
  const dbIds =
    objects.length > 0
      ? objects.map((object) => object.dbId)
      : [];

  const lineSegments = [];
  const circularArcs = [];
  const ellipticalArcs = [];

  const processedObjects = new Set();

  for (const dbId of dbIds) {
    if (processedObjects.has(dbId)) {
      continue;
    }

    processedObjects.add(dbId);

    instanceTree.enumNodeFragments(
      dbId,
      (fragmentId) => {
        const renderProxy = viewer.impl.getRenderProxy(
          model,
          fragmentId
        );

        if (!renderProxy?.geometry) {
          return;
        }

        const reader =
          new Autodesk.Viewing.Private.VertexBufferReader(
            renderProxy.geometry,
            viewer.impl.use2dInstancing
          );

        const callback = {
          onLineSegment(
            x1,
            y1,
            x2,
            y2,
            viewportId
          ) {
            const start = transformPoint(
              viewer,
              model,
              x1,
              y1,
              viewportId
            );

            const end = transformPoint(
              viewer,
              model,
              x2,
              y2,
              viewportId
            );

            const length = distance2D(start, end);

            lineSegments.push({
              dbId,
              fragmentId,
              viewportId,
              start,
              end,
              length,
            });
          },

          onCircularArc(
            centerX,
            centerY,
            startAngle,
            endAngle,
            radius,
            viewportId
          ) {
            const center = transformPoint(
              viewer,
              model,
              centerX,
              centerY,
              viewportId
            );

            const radiusPoint = transformPoint(
              viewer,
              model,
              centerX + radius,
              centerY,
              viewportId
            );

            const transformedRadius = distance2D(
              center,
              radiusPoint
            );

            const angle = normalizeAngleDifference(
              startAngle,
              endAngle
            );

            circularArcs.push({
              dbId,
              fragmentId,
              viewportId,
              center,
              radius: transformedRadius,
              startAngle,
              endAngle,
              angle,
              length: transformedRadius * angle,
            });
          },

          onEllipticalArc(
            centerX,
            centerY,
            startAngle,
            endAngle,
            majorRadius,
            minorRadius,
            tilt,
            viewportId
          ) {
            const center = transformPoint(
              viewer,
              model,
              centerX,
              centerY,
              viewportId
            );

            const majorPoint = transformPoint(
              viewer,
              model,
              centerX + majorRadius,
              centerY,
              viewportId
            );

            const minorPoint = transformPoint(
              viewer,
              model,
              centerX,
              centerY + minorRadius,
              viewportId
            );

            const transformedMajorRadius = distance2D(
              center,
              majorPoint
            );

            const transformedMinorRadius = distance2D(
              center,
              minorPoint
            );

            const angle = normalizeAngleDifference(
              startAngle,
              endAngle
            );

            /*
             * Ramanujan approximation for a complete ellipse.
             * The result is scaled by the fraction of the arc angle.
             */
            const a = transformedMajorRadius;
            const b = transformedMinorRadius;

            const h =
              Math.pow(a - b, 2) /
              Math.pow(a + b || 1, 2);

            const fullCircumference =
              Math.PI *
              (a + b) *
              (1 +
                (3 * h) /
                  (10 + Math.sqrt(4 - 3 * h)));

            const arcLength =
              fullCircumference *
              (angle / (Math.PI * 2));

            ellipticalArcs.push({
              dbId,
              fragmentId,
              viewportId,
              center,
              majorRadius: a,
              minorRadius: b,
              startAngle,
              endAngle,
              tilt,
              angle,
              length: arcLength,
            });
          },
        };

        reader.enumGeomsForObject(dbId, callback);
      },
      true
    );
  }

  const uniqueLines=uniqLines(lineSegments), uniqueArcs=uniqArcs(circularArcs);
  const wallIds=dbIdsMatching(objects,/(?:^|[^a-z])(?:wall|walls|partition|partitions)(?:[^a-z]|$)/i);
  const doorIds=dbIdsMatching(objects,/(?:^|[^a-z])(?:door|doors|gate|shutter)(?:[^a-z]|$)/i);
  const windowIds=dbIdsMatching(objects,/(?:^|[^a-z])(?:window|windows|glazing|skylight)(?:[^a-z]|$)/i);
  const noteIds=dbIdsMatching(objects,/(?:text|mtext|annotation|dimension|hatch|title|legend|schedule)/i);
  const engIds=new Set([...wallIds,...doorIds,...windowIds]);
  const engineeringLines=engIds.size?uniqueLines.filter(x=>engIds.has(x?.dbId)):uniqueLines.filter(x=>!noteIds.has(x?.dbId));
  const engineeringArcs=engIds.size?uniqueArcs.filter(x=>engIds.has(x?.dbId)):uniqueArcs.filter(x=>!noteIds.has(x?.dbId));
  const unitInformation=getUnitInformation(model);
  const calibration=confirmedUnit&&Number(confirmedUnit.meterFactor)>0?{meterFactor:Number(confirmedUnit.meterFactor),source:"user_confirmed_drawing_unit",candidates:[]}:calibrateFactor(unitInformation,engineeringLines.length?engineeringLines:uniqueLines,objects);
  const effectiveMeterFactor=Number.isFinite(Number(calibration.meterFactor))?Number(calibration.meterFactor):null;
  const wallLines=wallIds.size?uniqueLines.filter(x=>wallIds.has(x?.dbId)):[];
  const wallArcs=wallIds.size?uniqueArcs.filter(x=>wallIds.has(x?.dbId)):[];
  const doorLines=doorIds.size?uniqueLines.filter(x=>doorIds.has(x?.dbId)):[];
  const doorArcs=doorIds.size?uniqueArcs.filter(x=>doorIds.has(x?.dbId)):[];
  const windowLines=windowIds.size?uniqueLines.filter(x=>windowIds.has(x?.dbId)):[];
  const windowArcs=windowIds.size?uniqueArcs.filter(x=>windowIds.has(x?.dbId)):[];
  const lineLength=engineeringLines.reduce((t,x)=>t+(Number(x?.length)||0),0);
  const circularArcLength=engineeringArcs.reduce((t,x)=>t+(Number(x?.length)||0),0);
  const ellipticalArcLength=0;
  const totalCurveLength=lineLength+circularArcLength;
  const totalLengthMeters=effectiveMeterFactor!==null?totalCurveLength*effectiveMeterFactor:null;
  const wallLengthModelUnits=wallLines.reduce((t,x)=>t+(Number(x?.length)||0),0)+wallArcs.reduce((t,x)=>t+(Number(x?.length)||0),0);
  const wallLengthMeters=effectiveMeterFactor!==null?wallLengthModelUnits*effectiveMeterFactor:null;
  const exactRooms =
    wallLines.length >= 3
      ? centerlineFaces(
          wallLines,
          effectiveMeterFactor
        )
      : {
          polygons: [],
          area: 0,
          footprintArea: 0,
          footprintAreaModelUnits: 0,
          footprintPolygons: [],
          confidence: 0,
          source: "unavailable",
          footprintSource: "unavailable",
        };

  const fallbackFloor =
    calculateFloorAreaFromGeometry({
      lineSegments: uniqueLines,
      objects,
      meterFactor: effectiveMeterFactor,
      segmentMode: "walls",
    });

  const hasExteriorFootprint =
    Number(exactRooms.footprintArea) > 0;

  const hasRoomFaces =
    exactRooms.polygons.length > 0;

  let floorAreaResult =
    hasExteriorFootprint || hasRoomFaces
      ? {
          area:
            hasExteriorFootprint
              ? Number(
                  exactRooms.footprintArea
                )
              : Number(
                  exactRooms.area
                ) || 0,

          areaModelUnits:
            hasExteriorFootprint
              ? Number(
                  exactRooms
                    .footprintAreaModelUnits
                ) || 0
              : effectiveMeterFactor
                ? (
                    Number(
                      exactRooms.area
                    ) || 0
                  ) /
                  (
                    effectiveMeterFactor *
                    effectiveMeterFactor
                  )
                : 0,

          polygonCount:
            hasExteriorFootprint
              ? exactRooms
                  .footprintPolygons
                  .length
              : exactRooms
                  .polygons
                  .length,

          floorPolygons:
            exactRooms
              .footprintPolygons,

          polygons:
            exactRooms
              .polygons,

          roomCount:
            exactRooms
              .polygons
              .length,

          roomArea:
            Number(
              exactRooms.area
            ) || 0,

          source:
            hasExteriorFootprint
              ? exactRooms
                  .footprintSource
              : exactRooms
                  .source,

          confidence:
            exactRooms
              .confidence,
        }
      : fallbackFloor;

  const rectangularFootprint =
    detectOrthogonalRectangularFootprint(
      wallLines,
      effectiveMeterFactor
    );

  if (
    rectangularFootprint &&
    (
      !Number(
        floorAreaResult?.area
      ) ||
      rectangularFootprint.area >
        Number(
          floorAreaResult.area
        ) * 1.01
    )
  ) {
    floorAreaResult = {
      ...floorAreaResult,

      area:
        rectangularFootprint.area,

      areaModelUnits:
        rectangularFootprint
          .areaModelUnits,

      polygonCount: 1,

      floorPolygons: [
        rectangularFootprint
          .polygon,
      ],

      source:
        rectangularFootprint
          .source,

      confidence:
        rectangularFootprint
          .confidence,

      rectangularBoundaryCoverage:
        rectangularFootprint
          .coverage,
    };
  }

  const doorCount=doorIds.size?countComponents(doorLines,doorArcs,effectiveMeterFactor):0;
  const windowCount=windowIds.size?countComponents(windowLines,windowArcs,effectiveMeterFactor):0;
  console.log("[VENTRA GEOMETRY] opening layers",{wallDbIds:wallIds.size,doorDbIds:doorIds.size,windowDbIds:windowIds.size,doorLines:doorLines.length,doorArcs:doorArcs.length,windowLines:windowLines.length,windowArcs:windowArcs.length,doorCount,windowCount,windowLineGeometry:windowLines.map((line)=>({dbId:line?.dbId,start:line?.start,end:line?.end,length:effectiveMeterFactor!==null?(Number(line?.length)||0)*effectiveMeterFactor:null}))});
  const geometryScale=Number.isFinite(Number(unitInformation.meterFactor))&&Number(unitInformation.meterFactor)>0&&effectiveMeterFactor!==null?effectiveMeterFactor/Number(unitInformation.meterFactor):1;
  console.log(
    "[VENTRA GEOMETRY] calibrated",
    {
      reportedUnit:
        unitInformation.unit,
      reportedFactor:
        unitInformation.meterFactor,
      effectiveMeterFactor,
      calibrationSource:
        calibration.source,
      candidates:
        calibration.candidates,
      rawLines:
        lineSegments.length,
      uniqueLines:
        uniqueLines.length,
      engineeringLines:
        engineeringLines.length,
      wallLines:
        wallLines.length,
      wallLengthMeters,
      floorArea:
        floorAreaResult.area,
      floorAreaSource:
        floorAreaResult.source,
      rectangularBoundaryCoverage:
        floorAreaResult
          .rectangularBoundaryCoverage ||
        null,
      roomArea:
        floorAreaResult.roomArea,
      roomCount:
        floorAreaResult.roomCount,
      doorCount,
      windowCount,
      totalLengthMeters,
    }
  );

  // Build a stable geometry centroid for every APS dbId. Autodesk model
  // properties expose MTEXT/room labels by dbId, while room polygons are
  // built from transformed geometry. Joining both through dbId keeps the
  // label and polygon in the exact same coordinate system.
  const geometryBoundsByDbId = new Map();
  const includeGeometryPoint = (dbId, point) => {
    if (dbId === null || dbId === undefined || !point) return;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const key = String(dbId);
    const current = geometryBoundsByDbId.get(key) || {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      pointCount: 0,
    };

    current.minX = Math.min(current.minX, x);
    current.minY = Math.min(current.minY, y);
    current.maxX = Math.max(current.maxX, x);
    current.maxY = Math.max(current.maxY, y);
    current.pointCount += 1;
    geometryBoundsByDbId.set(key, current);
  };

  for (const segment of lineSegments) {
    includeGeometryPoint(segment.dbId, segment.start);
    includeGeometryPoint(segment.dbId, segment.end);
  }

  for (const arc of circularArcs) {
    const radius = Number(arc.radius) || 0;
    includeGeometryPoint(arc.dbId, { x: arc.center.x - radius, y: arc.center.y - radius });
    includeGeometryPoint(arc.dbId, { x: arc.center.x + radius, y: arc.center.y + radius });
  }

  for (const arc of ellipticalArcs) {
    const rx = Number(arc.majorRadius) || 0;
    const ry = Number(arc.minorRadius) || 0;
    includeGeometryPoint(arc.dbId, { x: arc.center.x - rx, y: arc.center.y - ry });
    includeGeometryPoint(arc.dbId, { x: arc.center.x + rx, y: arc.center.y + ry });
  }

  const centroidScale =
    effectiveMeterFactor !== null && Number.isFinite(Number(effectiveMeterFactor))
      ? Number(effectiveMeterFactor)
      : 1;

  const objectGeometryCentroids = Object.fromEntries(
    [...geometryBoundsByDbId.entries()]
      .filter(([, bounds]) =>
        [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
      )
      .map(([dbId, bounds]) => [
        dbId,
        {
          x: ((bounds.minX + bounds.maxX) / 2) * centroidScale,
          y: ((bounds.minY + bounds.maxY) / 2) * centroidScale,
          width: (bounds.maxX - bounds.minX) * centroidScale,
          height: (bounds.maxY - bounds.minY) * centroidScale,
          pointCount: bounds.pointCount,
          source: "aps_dbid_geometry_bounds",
        },
      ])
  );


  return {
    objectCount: objects.length,

    lineCount: engineeringLines.length,
    rawLineCount: lineSegments.length,
    circularArcCount: engineeringArcs.length,
    rawCircularArcCount: circularArcs.length,
    ellipticalArcCount: 0,

    lineLength, circularArcLength, ellipticalArcLength, totalCurveLength,

    unit: confirmedUnit?.unit || unitInformation.unit,
    unitConfirmation: confirmedUnit || null,
    meterFactor: effectiveMeterFactor,
    sourceMeterFactor: unitInformation.meterFactor,
    geometryScale,
    unitCalibrationSource: calibration.source,
    unitCalibrationCandidates: calibration.candidates,
    totalLengthMeters,
    wallLengthMeters,
    wallLengthModelUnits,
    wallLengthSource: wallLines.length ? "aps_wall_centerline_geometry" : "unavailable",

    floorArea: floorAreaResult.area,
    floorAreaModelUnits: floorAreaResult.areaModelUnits,
    floorAreaPolygonCount: floorAreaResult.polygonCount,
    floorAreaSource: floorAreaResult.source,
    floorAreaConfidence: floorAreaResult.confidence,
    floorPolygons:
      Array.isArray(
        floorAreaResult.floorPolygons
      )
        ? floorAreaResult.floorPolygons
        : [],

    roomCount: floorAreaResult.roomCount,
    roomArea: floorAreaResult.roomArea,
    roomPolygons: floorAreaResult.polygons,
    roomCandidatePolygons: floorAreaResult.polygons,
    objectGeometryCentroids,
    expandedRoomCandidateCount: floorAreaResult.roomCount,
    roomDetectionConfidence: Number(floorAreaResult.confidence)||0,
    roomDetectionSource: floorAreaResult.roomCount>0?floorAreaResult.source:"unavailable",
    wallObjectCount: wallIds.size,
    doorEntityCount: doorIds.size,
    windowEntityCount: windowIds.size,

    doorCount,
    windowCount,
    openingCountSource:
      (doorIds.size || windowIds.size)
        ? "aps_connected_geometry_components"
        : "unavailable",

    lineSegments: uniqueLines,
    wallLineSegments: wallLines,
    doorLineSegments: doorLines,
    windowLineSegments: windowLines,
    wallCircularArcs: wallArcs,
    doorCircularArcs: doorArcs,
    windowCircularArcs: windowArcs,
    circularArcs: uniqueArcs,
    ellipticalArcs: [],
  };
}