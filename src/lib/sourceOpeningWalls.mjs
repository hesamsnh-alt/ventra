// A drawn door is commonly a gap between two wall strokes. The gap needs a
// parent centerline for the renderer, not a door moved to a stroke endpoint.
// Support is created only for an observed opening on a shared room boundary.
const EPS = 0.005;
const vector = edge => {
  const dx=edge.end.x-edge.start.x,dy=edge.end.y-edge.start.y,length=Math.hypot(dx,dy);
  return length>EPS ? {x:edge.start.x,y:edge.start.y,ux:dx/length,uy:dy/length,length} : null;
};
const along=(g,p)=>(p.x-g.x)*g.ux+(p.y-g.y)*g.uy;
const separation=(g,p)=>Math.abs((p.x-g.x)*g.uy-(p.y-g.y)*g.ux);
const at=(g,t)=>({x:g.x+g.ux*t,y:g.y+g.uy*t});
const axisMatches=(g,axis)=>axis==='horizontal'?Math.abs(g.uy)<=.2:axis==='vertical'?Math.abs(g.ux)<=.2:axis==='diagonal'?Math.abs(g.ux)>.2&&Math.abs(g.uy)>.2:true;
const edges=room=>(room.polygon||[]).map((start,i,poly)=>({start,end:poly[(i+1)%poly.length]}));

export function prepareObservedOpeningWalls(walls,rooms,observations,relationships=[],{distanceTolerance=.12}={}) {
  const output=[...walls],added=[];
  for(const observation of observations) {
    if(observation.type!=='door')continue;
    const center=observation.center,width=Number(observation.widthMeters);
    if(!Number.isFinite(center?.x)||!Number.isFinite(center?.y)||!(width>0))continue;
    const fits=edge=>{
      const g=vector(edge);if(!g||!axisMatches(g,observation.wallAxis)||separation(g,center)>distanceTolerance)return false;
      const t=along(g,center);return t-width/2>=-EPS&&t+width/2<=g.length+EPS;
    };
    if(output.some(fits))continue;
    let best=null;
    for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++) {
      const a=rooms[i],b=rooms[j];
      const relation=relationships.find(r=>(r.roomAId===a.id&&r.roomBId===b.id)||(r.roomAId===b.id&&r.roomBId===a.id));
      if(relation&&['open','separate'].includes(relation.relation)&&relation.confidence>=.6)continue;
      for(const ea of edges(a)) {
        const g=vector(ea);if(!g||!axisMatches(g,observation.wallAxis)||separation(g,center)>distanceTolerance)continue;
        for(const eb of edges(b)) {
          // Clear room polygons lie on opposite faces of a wall, not always
          // on the same centreline. Accept only a wall-thickness-sized gap.
          const h=vector(eb),faceTolerance=Math.min(.12,distanceTolerance);
          if(!h||Math.abs(g.ux*h.uy-g.uy*h.ux)>.02||separation(g,eb.start)>faceTolerance||separation(g,eb.end)>faceTolerance)continue;
          const lo=Math.max(0,Math.min(along(g,eb.start),along(g,eb.end))),hi=Math.min(g.length,Math.max(along(g,eb.start),along(g,eb.end)));
          const t=along(g,center);if(t-width/2<lo-EPS||t+width/2>hi+EPS)continue;
          const distance=separation(g,center);
          if(!best||distance<best.distance)best={start:at(g,lo),end:at(g,hi),distance,roomIds:[a.id,b.id]};
        }
      }
    }
    if(best) {
      const wall={id:`opening_support_${observation.id}`.slice(0,100),type:'internal',provenance:'observed_opening_shared_boundary',start:best.start,end:best.end};
      output.push(wall);added.push({wallId:wall.id,openingId:observation.id,roomIds:best.roomIds,sourceDistance:best.distance});
    }
  }
  return {walls:output,added};
}
