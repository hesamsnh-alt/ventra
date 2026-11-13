import {interpretRasterSpace,inferRasterRoomUse,RASTER_SPACE_POLICY_VERSION} from './rasterSpaceSemantics.mjs';
import {assemblePixelTopology} from './rasterPixelGraph.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const key=p=>`${p.x},${p.y}`;
const fail=(code,message,details={})=>{throw Object.assign(Error(message),{name:'PixelGraphError',code,details});};
function containsPoint(point,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside;}
export function pixelGraphAnchors(graph,topology){
  const points=[...topology.nodes,...graph.ink.flatMap(s=>[s.start,s.end])],unique=[];
  for(const p of points)if(!unique.some(q=>distance(p,q)<.05))unique.push({id:`anchor${unique.length+1}`,x:p.x,y:p.y});
  return unique;
}
function unionBoundaries(polygons){
  const edges=new Map(),removed=new Set();
  for(const p of polygons)for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length],k=`${key(a)}>${key(b)}`,reverse=`${key(b)}>${key(a)}`;
    if(edges.has(reverse)){edges.delete(reverse);removed.add(k);removed.add(reverse);}else edges.set(k,{a,b});
  }
  if(!edges.size)fail('INVALID_STORAGE_PARENT','Storage and parent do not form a usable floor.');
  const start=[...edges.values()][0].a,polygon=[];let next=start;
  for(let i=0;i<=edges.size;i++){
    polygon.push(next);const options=[...edges.values()].filter(e=>key(e.a)===key(next));
    if(options.length!==1)fail('INVALID_STORAGE_PARENT','Storage must share an unambiguous boundary with its parent room.');
    next=options[0].b;if(key(next)===key(start))break;
  }
  if(polygon.length!==edges.size||key(next)!==key(start))fail('INVALID_STORAGE_PARENT','Storage must be adjacent to its parent room, not a separate nested polygon.');
  return{polygon,removed};
}

function wallRuns(topology,removed){
  const edges=topology.edges.filter(e=>!removed.has(`${key(topology.nodes[e.a])}>${key(topology.nodes[e.b])}`));
  const parent=edges.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j];if(a.type!==b.type||![a.a,a.b].some(n=>n===b.a||n===b.b))continue;
    const p=topology.nodes[a.a],q=topology.nodes[a.b],r=topology.nodes[b.a],s=topology.nodes[b.b];
    const cosine=Math.abs(((q.x-p.x)*(s.x-r.x)+(q.y-p.y)*(s.y-r.y))/(distance(p,q)*distance(r,s)));
    if(cosine>.9998)parent[find(j)]=find(i);
  }
  const groups=new Map();edges.forEach((e,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);});
  const walls=[],openings=[];
  for(const group of groups.values()){
    const pts=[...new Set(group.flatMap(e=>[e.a,e.b]))].map(i=>topology.nodes[i]),longest=group.reduce((a,b)=>distance(topology.nodes[a.a],topology.nodes[a.b])>distance(topology.nodes[b.a],topology.nodes[b.b])?a:b);
    const p=topology.nodes[longest.a],q=topology.nodes[longest.b],dx=q.x-p.x,dy=q.y-p.y;
    pts.sort((a,b)=>(a.x-b.x)*dx+(a.y-b.y)*dy);
    const wall={id:`wall${walls.length+1}`,type:group[0].type,start:{x:pts[0].x,y:pts[0].y},end:{x:pts.at(-1).x,y:pts.at(-1).y}};walls.push(wall);
    for(const source of topology.openings){
      const relevant=group.filter(e=>e.sourceId===source.id);if(!relevant.length)continue;
      const ends=[...new Set(relevant.flatMap(e=>[e.a,e.b]))].map(i=>topology.nodes[i]).sort((a,b)=>(a.x-b.x)*dx+(a.y-b.y)*dy);
      if(openings.some(o=>o.id===source.id))fail('SPLIT_PIXEL_OPENING','A source opening cannot belong to two noncollinear wall runs.');
      openings.push({id:source.id,type:source.type,wallId:wall.id,start:{x:ends[0].x,y:ends[0].y},end:{x:ends.at(-1).x,y:ends.at(-1).y},heightMeters:null,sillHeightMeters:null,hingeSide:source.hingeSide,swingDirection:source.swingDirection});
    }
  }
  if(openings.length!==topology.openings.length)fail('LOST_PIXEL_OPENING','A classified source opening was lost during wall assembly.');
  return{walls,openings};
}

export function compileClassifiedPixelGraph(graph,selection,semantics,providedTopology){
  const topology=providedTopology||assemblePixelTopology(graph,selection),regionMap=new Map(topology.regions.map(r=>[r.id,r])),classifications=new Map();
  for(const item of semantics.regions||[]){
    if(!regionMap.has(item.regionId)||classifications.has(item.regionId))fail('INVALID_REGION_SELECTION','Unknown or duplicate region classification.',{regionId:item.regionId});
    const use=inferRasterRoomUse({sourceText:item.sourceText??item.name,fixtures:item.fixtures||[]}),resolved={...item,useEvidence:use};
    if(!['other'].includes(use.type)){
      resolved.type=use.type;resolved.context=use.type==='room'?'unassigned':use.type==='wardrobe'?'bedroom':use.type==='stair'?'stair_core':use.type;
      resolved.explicitUse=use.type==='wardrobe'?'wardrobe':use.type==='stair'?'stair':'room';
    }else if(item.explicitUse==='room'||item.pattern==='none'){
      resolved.type='other';resolved.explicitUse='room';
    }
    classifications.set(item.regionId,{...resolved,interpretation:interpretRasterSpace({...resolved,enclosed:true})});
  }
  if(classifications.size!==regionMap.size)fail('INCOMPLETE_REGION_CLASSIFICATION','Every enclosed source region must be classified or explicitly left unresolved.');
  const rooms=[],holes=[],storage=[],removed=new Set(),merged=new Set();
  for(const item of classifications.values()){
    const region=regionMap.get(item.regionId),role=item.interpretation.role;
    if(role==='void'){holes.push({id:item.regionId,type:item.explicitUse==='courtyard'?'courtyard':'shaft',polygon:region.polygon});continue;}
    if(role==='wardrobe'||role==='furniture'){
      const parent=classifications.get(item.parentRegionId);
      if(!parent||parent.interpretation.role!=='room'||(role==='wardrobe'&&parent.context!=='bedroom'))fail('INVALID_STORAGE_PARENT','A wardrobe must belong to an adjacent bedroom; it cannot remove floor or become a stand-alone room.',{regionId:item.regionId,parentRegionId:item.parentRegionId});
      storage.push({regionId:item.regionId,parentRegionId:item.parentRegionId,role,polygon:region.polygon,architectural:true});continue;
    }
    if(role==='unresolved'||item.type==='unresolved')fail('UNRESOLVED_PIXEL_REGION','An enclosed region is not understood; no complete model was accepted.',{regionId:item.regionId});
  }
  for(const item of classifications.values()){
    if(item.interpretation.role!=='room'&&item.interpretation.role!=='stair'&&item.interpretation.role!=='shower')continue;
    const children=storage.filter(s=>s.parentRegionId===item.regionId&&s.architectural),polygons=[regionMap.get(item.regionId).polygon,...children.map(s=>s.polygon)];
    let polygon=polygons[0];if(children.length){const result=unionBoundaries(polygons);polygon=result.polygon;for(const edge of result.removed)removed.add(edge);children.forEach(c=>merged.add(c.regionId));}
    rooms.push({id:item.regionId,name:item.name,type:item.type,polygon});
  }
  if(storage.some(s=>!merged.has(s.regionId)))fail('INVALID_STORAGE_PARENT','Storage floor was not merged into its parent.');
  const symbolMap=new Map((topology.symbolEnclosures||[]).map(s=>[s.id,s])),seenSymbols=new Set();
  for(const symbol of semantics.symbols||[]){
    const enclosure=symbolMap.get(symbol.enclosureId),parent=classifications.get(symbol.parentRegionId),room=rooms.find(r=>r.id===symbol.parentRegionId);
    if(!enclosure||seenSymbols.has(symbol.enclosureId)||!parent||!room)fail('INVALID_SYMBOL_PARENT','A source furniture enclosure needs a real parent room.');
    seenSymbols.add(symbol.enclosureId);
    if(!enclosure.polygon.every(p=>containsPoint(p,room.polygon)))fail('STORAGE_OUTSIDE_PARENT','A wardrobe enclosure lies outside its stated room.');
    const interpretation=interpretRasterSpace({...symbol,context:parent.context,enclosed:true});
    if(interpretation.role==='void')fail('FURNITURE_CANNOT_REMOVE_FLOOR','A furniture symbol cannot remove structural floor.');
    if(interpretation.role==='wardrobe'){
      storage.push({regionId:enclosure.id,parentRegionId:room.id,role:'wardrobe',polygon:enclosure.polygon,architectural:false});
      classifications.set(enclosure.id,{...symbol,regionId:enclosure.id,name:symbol.sourceText||'Wardrobe',interpretation});
    }
  }
  if(seenSymbols.size!==symbolMap.size)fail('INCOMPLETE_SYMBOL_CLASSIFICATION','A closed furniture enclosure was not interpreted.');
  if(!rooms.length)fail('INCOMPLETE_PIXEL_SELECTION','No usable floor room was classified.');
  const anchors=pixelGraphAnchors(graph,topology),anchorMap=new Map(anchors.map(a=>[a.id,a]));
  const measurements=(semantics.measurements||[]).map((m,i)=>{
    const a=anchorMap.get(m.startAnchorId),b=anchorMap.get(m.endAnchorId);if(!a||!b||a.id===b.id)fail('INVALID_MEASUREMENT_ANCHOR','A dimension must use two distinct source-pixel anchors.');
    return{id:`measurement${i+1}`,text:m.text,axis:Math.abs(a.x-b.x)<.5?'vertical':Math.abs(a.y-b.y)<.5?'horizontal':'aligned',start:{x:a.x,y:a.y},end:{x:b.x,y:b.y},meters:m.meters};
  });
  if(!measurements.length)fail('MISSING_SCALE_EVIDENCE','No readable anchored dimension was classified.');
  const {walls,openings}=wallRuns(topology,removed);
  const trace={coordinateSpace:'image_pixels',imageWidth:graph.imageWidth,imageHeight:graph.imageHeight,title:semantics.title||'Source-pixel floor plan',confidence:semantics.confidence,wallHeightMeters:semantics.wallHeightMeters??null,footprint:topology.footprint,rooms,holes,walls,openings,measurements};
  return{trace,topology,spacePolicyVersion:RASTER_SPACE_POLICY_VERSION,spaceInterpretations:[...classifications.values()],storage};
}

export function sourceStorageAssets(compiled,scene){
  const footprint=compiled.trace.footprint,minX=Math.min(...footprint.map(p=>p.x)),maxX=Math.max(...footprint.map(p=>p.x)),minY=Math.min(...footprint.map(p=>p.y)),maxY=Math.max(...footprint.map(p=>p.y));
  const assets=[];
  for(const storage of compiled.storage.filter(s=>s.role==='wardrobe')){
    const polygon=storage.polygon.map(p=>({x:(p.x-minX)*scene.width/(maxX-minX),y:(maxY-p.y)*scene.depth/(maxY-minY)}));
    let best;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],angle=Math.atan2(b.y-a.y,b.x-a.x),c=Math.cos(angle),s=Math.sin(angle),x=polygon.map(p=>p.x*c+p.y*s),y=polygon.map(p=>-p.x*s+p.y*c),loX=Math.min(...x),hiX=Math.max(...x),loY=Math.min(...y),hiY=Math.max(...y),area=(hiX-loX)*(hiY-loY);
      if(!best||area<best.area)best={area,angle,c,s,loX,hiX,loY,hiY};
    }
    const measuredArea=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
    // Do not replace L-shaped or irregular built-ins with a guessed box.
    if(!best||best.area<=0||Math.abs(best.area-measuredArea)>Math.max(.002,measuredArea*.01))continue;
    const x=(best.loX+best.hiX)/2,y=(best.loY+best.hiY)/2;
    assets.push({id:`source-${storage.regionId}`,type:'wardrobe',roomId:storage.parentRegionId,xMeters:x*best.c-y*best.s,yMeters:x*best.s+y*best.c,width:best.hiX-best.loX,depth:best.hiY-best.loY,height:Math.min(2.2,scene.height*.9),rotation:best.angle*180/Math.PI,placementSource:'source_pixel_graph',heightSource:'design_default_not_measured',sourceRegionId:storage.regionId});
  }
  return assets;
}
