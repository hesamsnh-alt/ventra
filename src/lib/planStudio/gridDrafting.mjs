import {curveIntersections, dist, segments} from './geometry.mjs';
import {basis, dimension, dot, guides, line, range, rect, text, unique, unit, xy} from './draftingGeometry.mjs';

function gridFromEntities(entities) {
  const edges = entities.filter(guides).flatMap(segments).filter(e=>dist(e.a,e.b)>.01);
  if (!edges.length || edges.length>180) throw Error('Select up to 180 grid segments. / حداکثر ۱۸۰ خط آکس انتخاب کن.');
  const axes = edges.map(edge=>({edge, direction:unit(edge.a,edge.b)}));
  let best=axes[0], bestScore=0;
  for(const candidate of axes) {
    let parallel=0, perpendicular=0;
    for(const axis of axes) {
      const alignment=Math.abs(dot(candidate.direction,axis.direction));
      if(alignment>1-1e-8) parallel++;
      if(alignment<1e-8) perpendicular++;
    }
    const score=parallel*perpendicular;
    if(score>bestScore) {best=candidate;bestScore=score;}
  }
  const {edge:anchor,direction}=best;
  let u = Math.abs(direction.x)>=Math.abs(direction.y)?direction:xy(direction.y,-direction.x);
  if (u.x<0) u=xy(-u.x,-u.y);
  const {local,world} = basis(anchor.a,u);
  const rows=[], columns=[];
  for (const edge of edges) {
    const a=local(edge.a), b=local(edge.b);
    const axis=line(a,b), alignment=Math.abs(dot(unit(edge.a,edge.b),u));
    if (alignment>1-1e-8) rows.push(axis);
    if (alignment<1e-8) columns.push(axis);
  }
  const crossings=rows.flatMap(row=>columns.flatMap(col=>curveIntersections(row,col)));
  if (!crossings.length) throw Error('Select two crossing families of grid lines. / خطوط متقاطع دو جهت آکس را انتخاب کن.');
  return {crossings,world};
}

export function columnSymbols(entities, existing, {gridColumnWidth,gridColumnDepth}) {
  if (!range(gridColumnWidth,.05,3)||!range(gridColumnDepth,.05,3)) {
    throw Error('Check column symbol dimensions. / ابعاد علامت ستون را بررسی کن.');
  }
  const {crossings,world}=gridFromEntities(entities), seen=new Set();
  const key=({x,y})=>`${Math.round(x*10000)}:${Math.round(y*10000)}`;
  existing.filter(e=>e.detailKind==='grid-column'&&e.type==='polyline'&&e.points.length===4)
    .forEach(e=>seen.add(key(xy(
      e.points.reduce((n,p)=>n+p.x,0)/4, e.points.reduce((n,p)=>n+p.y,0)/4))));
  return crossings.flatMap(({x,y})=>{
    const k=key(world(xy(x,y)));
    if (seen.has(k)) return [];
    seen.add(k);
    const outline=rect(x-gridColumnWidth/2,y-gridColumnDepth/2,x+gridColumnWidth/2,y+gridColumnDepth/2);
    return [{...outline,points:outline.points.map(world),detailKind:'grid-column',hatch:'solid',weight:.35}];
  });
}

function letters(index) {
  let label='';
  for (let n=index+1;n>0;n=Math.floor((n-1)/26)) label=String.fromCharCode(65+(n-1)%26)+label;
  return label;
}

export function labelGrid(entities,{gridLabelOffset,gridBubbleRadius}) {
  if (!range(gridLabelOffset,.1,10)||!range(gridBubbleRadius,.04,1)) {
    throw Error('Check the grid label offset and bubble radius. / فاصله و اندازهٔ حباب آکس را بررسی کن.');
  }
  const {crossings,world}=gridFromEntities(entities);
  const xs=unique(crossings.map(p=>p.x),.001),ys=unique(crossings.map(p=>p.y),.001);
  if (xs.length<2||ys.length<2) throw Error('Select at least two axes in each direction. / در هر جهت حداقل دو آکس انتخاب کن.');
  const r=gridBubbleRadius, gap=gridLabelOffset, geometry=[];
  function sides(stations,opposite,swap,format){
    opposite.forEach((edge,i)=>{
      const outside=i===0?-1:1;
      const point=(x,y)=>world(swap?xy(y,x):xy(x,y));
      stations.forEach((station,j)=>{
        const p=point(station,edge);
        const center=point(station,edge+outside*(gap*2.7+r));
        const value=format(j);
        geometry.push({...line(p,point(station,edge+outside*gap*2.7)),dash:'center'},
          {type:'circle',center,radius:r,start:0,sweep:Math.PI*2},
          text(xy(center.x-r*Math.min(.72,value.length*.22),center.y-r*.28),value,r*.85));
        if(j>0) geometry.push(dimension(point(stations[j-1],edge),p,outside*gap*(swap?-1:1)));
      });
      geometry.push(dimension(point(stations[0],edge),point(stations.at(-1),edge),outside*gap*2*(swap?-1:1)));
    });
  }
  sides(xs,[ys[0],ys.at(-1)],false,i=>String(i+1));
  sides(ys,[xs[0],xs.at(-1)],true,letters);
  return geometry;
}
