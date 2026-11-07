import {segments,curveIntersections,param,dist,inside,validPolygon,polygonArea,at,TAU,nearest} from './geometry.mjs';
const TOL=1e-7,MAX_SEGMENTS=3000,MAX_EDGES=12000;
export const hatchContains=(e,p)=>{
 const contained=e.type==='circle'?dist(e.center,p)<e.radius:inside(p,e.points||[]);
 return contained&&!(e.hatchHoles||[]).reduce((odd,ring)=>inside(p,ring)?!odd:odd,false);
};
function simple(points){
 let result=points.slice(),changed=true;
 while(changed&&result.length>3){changed=false;result=result.filter((p,i)=>{const a=result[(i+result.length-1)%result.length],b=result[(i+1)%result.length],l=dist(a,b),cross=(p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);if(l>TOL&&Math.abs(cross)/l<TOL){changed=true;return false;}return true;});}
 return result;
}
function key(points){const values=simple(points).map(p=>`${Math.round(p.x/TOL)},${Math.round(p.y/TOL)}`),start=values.indexOf(values.slice().sort()[0]),forward=values.map((_,i)=>values[(start+i)%values.length]).join(';'),backward=values.map((_,i)=>values[(start-i+values.length)%values.length]).join(';');return forward<backward?forward:backward;}
export function findHatchBoundary(doc,p){
 const visible=doc.entities.filter(e=>doc.layers.find(l=>l.id===e.layer)?.visible!==false),source=visible.filter(e=>e.role!=='hatch'&&['line','polyline'].includes(e.type)),lines=source.flatMap(e=>segments(e).map(s=>({...s,sourceId:e.id}))).filter(e=>dist(e.a,e.b)>TOL);
 if(lines.length>MAX_SEGMENTS)throw Error('Too many boundary edges; use a smaller drawing or hide unrelated layers. / برای تشخیص هچ، لایه‌های اضافی را مخفی کن.');
 const cuts=lines.map(e=>[{p:e.a,t:0},{p:e.b,t:1}]);
 let cutCount=lines.length*2;const append=(i,p)=>{const t=param(lines[i],p);if(t>=-TOL&&t<=1+TOL&&!cuts[i].some(c=>dist(c.p,p)<=TOL)){if(++cutCount>MAX_EDGES*4)throw Error('Boundary intersection limit exceeded.');cuts[i].push({p,t:Math.max(0,Math.min(1,t))});}};
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
  const a=lines[i],b=lines[j];if(Math.max(a.a.x,a.b.x)+TOL<Math.min(b.a.x,b.b.x)||Math.max(b.a.x,b.b.x)+TOL<Math.min(a.a.x,a.b.x)||Math.max(a.a.y,a.b.y)+TOL<Math.min(b.a.y,b.b.y)||Math.max(b.a.y,b.b.y)+TOL<Math.min(a.a.y,a.b.y))continue;
  for(const q of curveIntersections(a,b)){append(i,q);append(j,q);}
  // Split collinear overlaps and endpoint-on-edge junctions as well.
  for(const [edge,index,points]of [[a,i,[b.a,b.b]],[b,j,[a.a,a.b]]])for(const q of points){const t=param(edge,q);if(t>=-TOL&&t<=1+TOL&&dist(at(edge,t),q)<=TOL)append(index,q);}
 }
 const nodes=[],buckets=new Map(),edges=new Map();
 function node(q){const x=Math.floor(q.x/TOL),y=Math.floor(q.y/TOL);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const id of buckets.get(`${x+dx}:${y+dy}`)||[])if(dist(nodes[id].p,q)<=TOL)return id;const id=nodes.length;nodes.push({p:{...q},links:new Map()});const k=`${x}:${y}`;buckets.set(k,[...(buckets.get(k)||[]),id]);return id;}
 cuts.forEach((points,i)=>{points.sort((a,b)=>a.t-b.t);for(let j=1;j<points.length;j++){if(dist(points[j-1].p,points[j].p)<=TOL)continue;const a=node(points[j-1].p),b=node(points[j].p);if(a===b)continue;const k=[a,b].sort((x,y)=>x-y).join(':');if(!edges.has(k)){if(edges.size>=MAX_EDGES)throw Error('Boundary intersection limit exceeded. / تعداد تقاطع‌ها بیش از حد است.');edges.set(k,{a,b,sources:new Set()});}edges.get(k).sources.add(lines[i].sourceId);}});
 for(const edge of edges.values()){nodes[edge.a].links.set(edge.b,edge);nodes[edge.b].links.set(edge.a,edge);}
 // Dangling strokes cannot enclose a region and must not spoil a valid room.
 const queue=nodes.map((_,i)=>i).filter(i=>nodes[i].links.size<2);
 while(queue.length){const i=queue.pop();if(nodes[i].links.size>1)continue;for(const j of nodes[i].links.keys()){nodes[j].links.delete(i);if(nodes[j].links.size===1)queue.push(j);}nodes[i].links.clear();}
 let component=0;const components=[];
 for(let i=0;i<nodes.length;i++)if(nodes[i].links.size&&nodes[i].component===undefined){const stack=[i];nodes[i].component=component;while(stack.length){const a=stack.pop();for(const b of nodes[a].links.keys())if(nodes[b].component===undefined){nodes[b].component=component;stack.push(b);}}components.push(component++);}
 const outgoing=nodes.map(n=>[...n.links.keys()].sort((a,b)=>Math.atan2(nodes[a].p.y-n.p.y,nodes[a].p.x-n.p.x)-Math.atan2(nodes[b].p.y-n.p.y,nodes[b].p.x-n.p.x))),visited=new Set(),faces=[],exteriors=[];
 for(let a=0;a<nodes.length;a++)for(const b of outgoing[a]){
  if(visited.has(`${a}:${b}`))continue;let u=a,v=b,closed=false;const ring=[],sources=new Set();
  for(let count=0;count<=edges.size*2;count++){
   const k=`${u}:${v}`;if(visited.has(k))break;visited.add(k);ring.push(nodes[u].p);for(const id of nodes[u].links.get(v).sources)sources.add(id);
   const next=outgoing[v][(outgoing[v].indexOf(u)+outgoing[v].length-1)%outgoing[v].length];u=v;v=next;if(u===a&&v===b){closed=true;break;}
  }
  if(!closed)continue;const points=simple(ring);if(points.length>300)throw Error('Hatch boundary exceeds 300 vertices.');if(!validPolygon(points))continue;
  const signed=points.reduce((sum,q,i)=>sum+q.x*points[(i+1)%points.length].y-points[(i+1)%points.length].x*q.y,0)/2,face={points,area:Math.abs(signed),sources:[...sources],component:nodes[a].component};
  (signed>0?faces:exteriors).push(face);
 }
 const candidates=faces.filter(f=>inside(p,f.points)||(nearest({type:'polyline',points:f.points,closed:true},p)?.distance??Infinity)<=TOL).map(f=>({...f,type:'polyline'}));
 for(const e of visible.filter(e=>e.type==='circle'&&dist(e.center,p)<=e.radius+TOL))candidates.push({type:'circle',entity:e,area:Math.PI*e.radius**2,sources:[e.id],component:null});
 candidates.sort((a,b)=>a.area-b.area);const selected=candidates[0];if(!selected)return null;
 const outer=selected.type==='circle'?Array.from({length:128},(_,i)=>at({...selected.entity,start:0,sweep:TAU},i/128)):selected.points;
 const holes=[];
 for(const face of exteriors){if(face.component===selected.component||face.area>=selected.area-TOL)continue;if(face.points.every(q=>inside(q,outer)))holes.push(face.points.slice().reverse());}
 for(const e of visible.filter(e=>e.type==='circle'&&e.id!==selected.entity?.id)){
  const ring=Array.from({length:128},(_,i)=>at({...e,start:0,sweep:TAU},i/128));if(Math.PI*e.radius**2<selected.area&&ring.every(q=>inside(q,outer)))holes.push(ring);
 }
 if(holes.length>32||holes.reduce((sum,r)=>sum+r.length,0)>2000)throw Error('Too many hatch islands. / تعداد جزیره‌های هچ بیش از حد است.');
 const existing=selected.entity||visible.find(e=>e.type==='polyline'&&e.closed&&key(e.points)===key(outer));
 return{...selected,points:outer,holes,existingId:existing?.id||null};
}
