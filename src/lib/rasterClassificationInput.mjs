// Semantic selection operates on measured source geometry. Alternative faces
// are not independent physical walls and do not need hundreds of negative IDs.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function intervalOn(line,source){
 const dx=source.end.x-source.start.x,dy=source.end.y-source.start.y,length=distance(source.start,source.end);
 if(!length||!distance(line.start,line.end))return null;
 const project=p=>({t:((p.x-source.start.x)*dx+(p.y-source.start.y)*dy)/(length*length),d:Math.abs((p.x-source.start.x)*dy-(p.y-source.start.y)*dx)/length});
 const a=project(line.start),b=project(line.end),angle=Math.abs((line.end.x-line.start.x)*dy-(line.end.y-line.start.y)*dx)/(length*distance(line.start,line.end));
 if(angle>.025||Math.max(a.d,b.d)>Math.max(2.5,(source.thicknessPixels||0)/2+1.5))return null;
 return[Math.max(0,Math.min(a.t,b.t)),Math.min(1,Math.max(a.t,b.t))];
}
export function measuredSpanCoverage(source,lines){
 const spans=lines.map(line=>intervalOn(line,source)).filter(s=>s&&s[1]>s[0]).sort((a,b)=>a[0]-b[0]);let covered=0,end=0;
 for(const [a,b]of spans){covered+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return covered;
}
export function requiredSourceBands(graph){
 // Thin lettering and frame strokes are not promoted to mandatory walls.
 // Thick observations still need a wall selection OR an explicit non-wall
 // explanation; completeness alone cannot silently throw them away.
 return graph.candidates.filter(c=>c.kind==='solid_band'&&c.thicknessPixels>=5&&distance(c.start,c.end)>=6);
}
export function measuredWallAlternatives(graph){
 const sources=new Map((graph.ink||[]).map(s=>[s.id,s]));
 return graph.candidates.filter(c=>c.kind==='solid_band').map(band=>({candidateId:band.id,overlappingAlternativeIds:graph.candidates.filter(c=>{
  if(c.id===band.id)return false;
  return (band.sourceIds||[]).some(id=>{
   if(!c.sourceIds?.includes(id))return false;const source=sources.get(id);if(!source)return false;
   const dx=source.end.x-source.start.x,dy=source.end.y-source.start.y,length=distance(source.start,source.end);if(!length)return false;
   const project=p=>((p.x-source.start.x)*dx+(p.y-source.start.y)*dy)/length;
   const a=[project(band.start),project(band.end)].sort((a,b)=>a-b),b=[project(c.start),project(c.end)].sort((a,b)=>a-b);
   return Math.min(a[1],b[1])-Math.max(a[0],b[0])>2;
  });
 }).map(c=>c.id)})).filter(g=>g.overlappingAlternativeIds.length);
}
export function compactPixelClassificationInput(graph,sourceOpenings){
 return{imageFrame:{width:graph.imageWidth,height:graph.imageHeight,coordinateSpace:'full_source_pixels'},
  candidates:graph.candidates.map(c=>({id:c.id,kind:c.kind,start:c.start,end:c.end,sourceIds:c.sourceIds||[c.id],...(c.thicknessPixels?{thicknessPixels:c.thicknessPixels}:{}),...(c.colorEvidence?{colorEvidence:true}:{}),...(c.filledBandRatio!==undefined?{filledBandRatio:c.filledBandRatio}:{})})),
  gaps:graph.gaps.map(g=>({id:g.id,a:g.a,b:g.b,start:g.start,end:g.end,support:g.support,...(g.endpointHosts?{endpointHosts:g.endpointHosts}:{}),...(g.sourceDoor?{sourceDoor:g.sourceDoor}:{})})),
  sourceDoors:sourceOpenings.doors,requiredSourceBandIds:requiredSourceBands(graph).map(c=>c.id),measuredWallAlternatives:measuredWallAlternatives(graph),
  selectionContract:'Assign exactly one candidateRoles value for every candidate ID. Use alternative_face for redundant representations, furniture for furniture enclosures and unresolved for unclear roles. complete=true confirms the whole source was reviewed.'};
}
export function validateSourceBandCoverage(graph,selection){
 const selectedIds=new Set(selection.walls.map(w=>w.candidateId)),selected=graph.candidates.filter(c=>selectedIds.has(c.id)),reviewed=new Set((selection.nonWalls||[]).map(c=>c.candidateId));
 return requiredSourceBands(graph).filter(c=>!reviewed.has(c.id)&&measuredSpanCoverage(c,selected)<.9).map(c=>c.id);
}
