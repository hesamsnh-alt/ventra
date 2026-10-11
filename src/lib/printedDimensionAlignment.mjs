// Small, consistent printed dimensions can refine an orthogonal raster trace.
// One shared coordinate map moves rooms, walls, openings and furniture together.
const bounds=poly=>({minX:Math.min(...poly.map(p=>p.x)),maxX:Math.max(...poly.map(p=>p.x)),minY:Math.min(...poly.map(p=>p.y)),maxY:Math.max(...poly.map(p=>p.y))});
const area=poly=>Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0))/2;
const orthogonal=poly=>poly.every((p,i)=>{const q=poly[(i+1)%poly.length];return Math.abs(p.x-q.x)<.01||Math.abs(p.y-q.y)<.01;});
function solveAxis(rooms,axis,extent){
 const entries=rooms.filter(r=>r.polygon?.length>=4).map(room=>({room,b:bounds(room.polygon)}));
 const key0=axis==='x'?'minX':'minY',key1=axis==='x'?'maxX':'maxY';
 const values=[0,extent,...entries.flatMap(e=>[e.b[key0],e.b[key1]])].sort((a,b)=>a-b);
 const groups=[];
 for(const n of values){const last=groups.at(-1);if(last&&n-last[0]<=.025)last.push(n);else groups.push([n]);}
 const nodes=groups.map(g=>({initial:g.reduce((a,b)=>a+b,0)/g.length}));
 nodes[0].initial=0;nodes.at(-1).initial=extent;
 const nearest=v=>nodes.reduce((best,n,i)=>Math.abs(n.initial-v)<Math.abs(nodes[best].initial-v)?i:best,0);
 const adjacency=nodes.map(()=>[]),constraints=[];
 for(const {room,b} of entries){
  if(Math.abs(area(room.polygon)-(b.maxX-b.minX)*(b.maxY-b.minY))>.02)continue;
  const target=Number(axis==='x'?room.printedWidthMeters:room.printedDepthMeters);
  if(!(target>0))continue;
  const current=b[key1]-b[key0],i=nearest(b[key0]),j=nearest(b[key1]);
  if(i===j||target>extent+.005||Math.abs(current-target)>Math.max(.08,current*.05))return {applied:false,reason:'printed_dimension_outside_refinement_range',roomId:room.id};
  constraints.push({roomId:room.id,i,j,target});adjacency[i].push([j,target]);adjacency[j].push([i,-target]);
 }
 if(!constraints.length)return {applied:false,reason:'no_printed_dimensions'};
 const positions=new Array(nodes.length),visited=new Set();
 for(let seed=0;seed<nodes.length;seed++){
  if(visited.has(seed))continue;
  const relative=new Map([[seed,0]]),queue=[seed];
  for(let q=0;q<queue.length;q++){
   const i=queue[q];visited.add(i);
   for(const [j,delta] of adjacency[i]){
    const proposed=relative.get(i)+delta;
    if(relative.has(j)){if(Math.abs(relative.get(j)-proposed)>.005)return {applied:false,reason:'conflicting_printed_dimensions'};}
    else {relative.set(j,proposed);queue.push(j);}
   }
  }
  const anchors=queue.filter(i=>i===0||i===nodes.length-1).map(i=>nodes[i].initial-relative.get(i));
  if(anchors.length>1&&Math.abs(anchors[0]-anchors[1])>.005)return {applied:false,reason:'printed_dimensions_conflict_with_extent'};
  const origin=anchors.length?anchors[0]:queue.reduce((sum,i)=>sum+nodes[i].initial-relative.get(i),0)/queue.length;
  for(const i of queue)positions[i]=origin+relative.get(i);
 }
 const maxShift=Math.max(...positions.map((n,i)=>Math.abs(n-nodes[i].initial)));
 if(maxShift>Math.min(.25,extent*.02))return {applied:false,reason:'excessive_dimension_adjustment',maxShift};
 for(let i=1;i<positions.length;i++)if(positions[i]-positions[i-1]<.025)return {applied:false,reason:'dimension_grid_order_conflict'};
 const maxError=Math.max(...constraints.map(c=>Math.abs(positions[c.j]-positions[c.i]-c.target)));
 return {applied:true,reason:'consistent_printed_dimension_grid',nodes:nodes.map((n,i)=>({...n,value:positions[i]})),constraintCount:constraints.length,maxShift,maxError};
}
export function createPrintedDimensionAlignment(rooms,width,depth,footprint=[]){
 if(![footprint,...rooms.map(r=>r.polygon||[])].every(orthogonal))return {applied:false,reason:'non_orthogonal_source_preserved'};
 const x=solveAxis(rooms,'x',width),y=solveAxis(rooms,'y',depth);
 return {version:'printed_dimension_alignment_v54',applied:x.applied||y.applied,x,y};
}
export function mapPrintedDimensionPoint(point,alignment){
 const axis=(value,solution)=>{
  if(!solution?.applied||!Number.isFinite(value))return value;
  const nodes=solution.nodes;
  for(let i=1;i<nodes.length;i++)if(value<=nodes[i].initial){
   const a=nodes[i-1],b=nodes[i],t=(value-a.initial)/(b.initial-a.initial);
   return a.value+t*(b.value-a.value);
  }
  return value+(nodes.at(-1).value-nodes.at(-1).initial);
 };
 return {x:axis(point.x,alignment?.x),y:axis(point.y,alignment?.y)};
}
