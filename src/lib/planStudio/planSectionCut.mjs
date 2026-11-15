import {at, curveIntersections, dist, EPS, inside, param, segments} from './geometry.mjs';
import {basis, line, range, rect, text, unique, unit, xy} from './draftingGeometry.mjs';
import {visibleEntities} from './document.mjs';
import {shaftFitsFloor, shaftOuter} from './structures.mjs';

function intervals(curves, length, contains) {
  const axis=line(xy(0,0),xy(length,0));
  const xs=unique([0,length,...curves.flatMap(c=>curveIntersections(axis,c).map(p=>Math.max(0,Math.min(length,p.x))))]);
  return xs.slice(1).flatMap((right,i)=>{
    const left=xs[i];
    return contains(xy((left+right)/2,0))?[[left,right]]:[];
  });
}

function ringIntervals(rings,length) {
  return intervals(rings.flatMap(points=>segments({type:'polyline',points,closed:true})),length,
    p=>inside(p,rings[0])&&!rings.slice(1).some(ring=>inside(p,ring)));
}

function strip(a,b,half) {
  const u=unit(a,b), d=xy(-u.y*half,u.x*half);
  return [xy(a.x+d.x,a.y+d.y),xy(b.x+d.x,b.y+d.y),
    xy(b.x-d.x,b.y-d.y),xy(a.x-d.x,a.y-d.y)];
}

function arcIntervals(wall,local,length) {
  const center=local(wall.center), first=local(at(wall,0)), half=wall.thickness/2;
  const arc={...wall,center,start:Math.atan2(first.y-center.y,first.x-center.x)};
  const outer={...arc,radius:arc.radius+half}, inner={...arc,radius:arc.radius-half};
  return intervals([outer,inner,line(at(outer,0),at(inner,0)),line(at(outer,1),at(inner,1))],length,p=>{
    const r=dist(p,center);
    return r>inner.radius-EPS&&r<outer.radius+EPS&&param(arc,p)<=1+EPS;
  });
}

function wallPieces(wall,openings,local) {
  const pieces=[], length=dist(wall.a,wall.b), z=wall.z??0, top=z+wall.height;
  let cursor=0;
  const add=(start,end,bottom,head)=>{
    if(end-start>EPS&&head-bottom>EPS) pieces.push({
      footprint:strip(local(at(wall,start/length)),local(at(wall,end/length)),wall.thickness/2),
      bottom, top:head,
    });
  };
  const projectedOpenings=[];
  for (const opening of [...openings].sort((a,b)=>a.offset-b.offset)) {
    const half=opening.width/2, start=Math.max(0,opening.offset*length-half), end=Math.min(length,opening.offset*length+half);
    const sill=z+(opening.z??0);
    add(cursor,start,z,top);
    add(start,end,z,sill);
    if (opening.kind==='arched') {
      const count=24;
      for (let j=0;j<count;j++) {
        const arcHeight=opening.height-half+half*Math.sin(Math.acos(2*(j+.5)/count-1));
        add(start+(end-start)*j/count,start+(end-start)*(j+1)/count,sill+arcHeight,top);
      }
    } else add(start,end,sill+opening.height,top);
    projectedOpenings.push({start,end,sill,...opening});
    cursor=end;
  }
  add(cursor,length,z,top);
  return {pieces,projectedOpenings};
}

function projectionOfWall(wall,openings,local,length,depth) {
  const a=local(wall.a), b=local(wall.b), rise=b.y-a.y;
  const limits=Math.abs(rise)<EPS ? (a.y>0&&a.y<=depth?[0,1]:[]) :
    [Math.max(0,Math.min(-a.y/rise,(depth-a.y)/rise)),Math.min(1,Math.max(-a.y/rise,(depth-a.y)/rise))];
  if(limits.length<2||limits[1]-limits[0]<=EPS) return [];
  const xAt=t=>a.x+(b.x-a.x)*t;
  const [x0,x1]=limits.map(xAt).sort((x,y)=>x-y);
  const left=Math.max(0,x0), right=Math.min(length,x1);
  if(right-left<=EPS) return [];
  const base=wall.z??0, result=[rect(left,base,right,base+wall.height)];
  const planLength=dist(wall.a,wall.b);
  for(const opening of openings) {
    const arch=opening.kind==='arched', radius=opening.width/2;
    const [l,r]=[xAt(opening.start/planLength),xAt(opening.end/planLength)].sort((x,y)=>x-y);
    const from=Math.max(l,left),to=Math.min(r,right),sill=opening.sill,head=sill+opening.height;
    if(to-from<=EPS) continue;
    if(!arch) {result.push(rect(from,sill,to,head));continue;}
    const archPoints=Array.from({length:25},(_,i)=>{
      const x=to-(to-from)*i/24, t=(x-l)/(r-l)*2-1;
      return xy(x,head-radius+radius*Math.sqrt(Math.max(0,1-t*t)));
    });
    result.push({type:'polyline',closed:true,points:[xy(from,sill),xy(to,sill),...archPoints]});
  }
  return result.map(e=>({...e,dash:'dashed',weight:.13,detailKind:'section-projection'}));
}

export function planSectionCut(doc,start,end,side,origin,{cutDepth,cutLabel}) {
  const length=dist(start,end);
  if(length<.15||!range(cutDepth,0,100)||!/^[A-Za-z0-9]{1,4}$/.test(cutLabel)) {
    throw Error('Check the cut line, projection depth and section label. / خط برش، عمق نما و عنوان برش را بررسی کن.');
  }
  const first=basis(start,unit(start,end));
  const direction=Math.sign(first.local(side).y);
  if(Math.abs(first.local(side).y)<.01) throw Error('Pick a side away from the cut line. / جهت دید را کنار خط برش انتخاب کن.');
  const {local,world}=direction>0?first:basis(end,unit(end,start));
  const entities=visibleEntities(doc);
  const openingsByWall=new Map();
  for(const e of entities.filter(e=>e.type==='opening')) {
    if(!openingsByWall.has(e.wall)) openingsByWall.set(e.wall,[]);
    openingsByWall.get(e.wall).push(e);
  }
  const cut=[], projection=[];
  const add=(spans,bottom,top,hatch)=>spans.forEach(([a,b])=>
    cut.push({...rect(a,bottom,b,top),hatch,hatchScale:.1,detailKind:'section-cut',weight:.45}));
  for(const wall of entities.filter(e=>e.role==='wall')) {
    if(wall.type==='arc') {
      add(arcIntervals(wall,local,length),wall.z??0,(wall.z??0)+wall.height,'diagonal');
      continue;
    }
    const {pieces,projectedOpenings}=wallPieces(wall,openingsByWall.get(wall.id)??[],local);
    for(const piece of pieces) add(ringIntervals([piece.footprint],length),piece.bottom,piece.top,'diagonal');
    if(cutDepth) projection.push(...projectionOfWall(wall,projectedOpenings,local,length,cutDepth));
  }
  const shafts=entities.filter(e=>e.role==='shaft');
  for(const floor of entities.filter(e=>e.role==='floor')) {
    const z=floor.z??0;
    const voids=[...(floor.hatchHoles??[]),...shafts.filter(shaft=>Math.abs((shaft.z??0)-z)<EPS&&shaftFitsFloor(shaft,floor)).map(shaftOuter)];
    add(ringIntervals([floor.points,...voids].map(ring=>ring.map(local)),length),z-(floor.height??.12),z,'concrete');
  }
  for(const shaft of shafts) {
    const z=shaft.z??0;
    add(ringIntervals([shaftOuter(shaft),shaft.points].map(ring=>ring.map(local)),length),z-shaft.pitDepth,z+shaft.height,'concrete');
  }
  if(!cut.length&&!projection.length) {
    throw Error('No walls, floors or shaft walls found for this section. / دیوار، کف یا دیوارهٔ چاه در این برش پیدا نشد.');
  }
  const titleLevel=Math.min(0,...cut.map(e=>e.points[0].y),...projection.map(e=>e.points[0].y))-.45;
  const drawing=[...projection,...cut,text(xy(0,titleLevel),`${cutLabel}-${cutLabel}`,.2)].map(entity=>
    entity.points?{...entity,points:entity.points.map(p=>xy(origin.x+p.x,origin.y+p.y))}:
      {...entity,position:xy(origin.x+entity.position.x,origin.y+entity.position.y)});
  const arrowSize=Math.min(.24,length/5);
  const marker=[{...line(start,end),dash:'center'}];
  for(const x of [0,length]) {
    const tip=world(xy(x,arrowSize));
    marker.push(line(world(xy(x,0)),tip),
      line(tip,world(xy(x-arrowSize*.26,arrowSize*.60))),
      line(tip,world(xy(x+arrowSize*.26,arrowSize*.60))),
      text(world(xy(x,arrowSize*1.35)),cutLabel,.16));
  }
  return [...drawing,...marker.map(e=>({...e,detailKind:'section-marker'}))];
}
