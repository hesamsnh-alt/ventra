// Supported subset: a dimensioned, axis-aligned centreline plan with two
// unambiguous line weights proportional to its printed wall classifications.
// Every scheduled opening must close one geometrically matching gap. Unknown
// lines, dangling wall ends, ambiguity or an open envelope withhold the floor.
const EPS=1e-5,near=(a,b)=>Math.abs(a-b)<EPS;
const round=n=>Math.round(n*1e6)/1e6;
const dist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const signed=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
function contains(poly,p){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++)if((poly[i].y>p.y)!==(poly[j].y>p.y)&&p.x<(poly[j].x-poly[i].x)*(p.y-poly[i].y)/(poly[j].y-poly[i].y)+poly[i].x)yes=!yes;return yes;}
function facesOf(walls){
 const nodes=new Map(),edges=[];
 const node=p=>{const id=`${round(p.x)},${round(p.y)}`;if(!nodes.has(id))nodes.set(id,{...p,id,to:[]});return nodes.get(id);};
 for(const w of walls){const points=[w.a,w.b];for(const other of walls)for(const p of [other.a,other.b])if(dist(p,w.a,w.b)<EPS)points.push(p);
  for(const other of walls)if(w.axis!==other.axis){const h=w.axis==='h'?w:other,v=w.axis==='v'?w:other,p={x:v.a.x,y:h.a.y};if(dist(p,h.a,h.b)<EPS&&dist(p,v.a,v.b)<EPS)points.push(p);}
  const sorted=[...new Map(points.map(p=>[`${round(p.x)},${round(p.y)}`,p])).values()].sort((a,b)=>w.axis==='h'?a.x-b.x:a.y-b.y);
  for(let i=1;i<sorted.length;i++){const a=node(sorted[i-1]),b=node(sorted[i]);if(!a.to.includes(b.id)){a.to.push(b.id);b.to.push(a.id);edges.push([a.id,b.id],[b.id,a.id]);}}
 }
 for(const n of nodes.values())n.to.sort((a,b)=>Math.atan2(nodes.get(a).y-n.y,nodes.get(a).x-n.x)-Math.atan2(nodes.get(b).y-n.y,nodes.get(b).x-n.x));
 const visited=new Set(),faces=[];
 for(const edge of edges){let [a,b]=edge;const start=a+'|'+b;if(visited.has(start))continue;const polygon=[];let closed=false;
  for(let guard=0;guard<=edges.length;guard++){
   const id=a+'|'+b;if(visited.has(id)){closed=id===start;break;}visited.add(id);polygon.push(nodes.get(a));
   const n=nodes.get(b),index=n.to.indexOf(a),next=n.to[(index+n.to.length-1)%n.to.length];a=b;b=next;
  }
  if(closed&&polygon.length>=3&&signed(polygon)>EPS)faces.push({polygon:polygon.map(({x,y})=>({x,y})),area:signed(polygon)});
 }
 return faces;
}
export function measureNativeWallFloor(page,schedule){
 const audit={page:page.pageNumber,status:'pending',method:'calibrated_centreline_graph',warnings:[]};
 try{
  const text=page.native_plan_text,graphics=page.native_graphics;
  if(text?.status!=='readable'||graphics?.status!=='readable'||schedule?.status!=='read')throw Error('Readable plan text, vectors and complete opening table are required');
  if(graphics.strokes.length>5000||schedule.rows.length>300)throw Error('Native wall graph size limit; independent extraction required');
  const all=text.spans.map(s=>s.text).join(' '),envelopes=[...all.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s+envelope\b/gi)];
  const declared=[...all.matchAll(/all dimensions (?:in|are)\s*(millimet(?:re|er)s|centimet(?:re|er)s|met(?:re|er)s|mm|cm|m)\b/gi)].map(m=>/^milli|^mm$/i.test(m[1])?.001:/^centi|^cm$/i.test(m[1])?.01:1);
  if(envelopes.length!==1||!declared.length||new Set(declared).size!==1||!/datum\s*:\s*wall cent(?:re|er)lines/i.test(all))throw Error('Explicit metric envelope and wall-centreline datum are required');
  const dimensionFactor=declared[0],ew=Number(envelopes[0][1])*dimensionFactor,eh=Number(envelopes[0][2])*dimensionFactor,ext=all.match(/External:\s*(\d+(?:\.\d+)?)\s*mm/i),int=all.match(/Internal:\s*(\d+(?:\.\d+)?)\s*mm/i);
  if(!(ew>0&&eh>0)||!ext||!int||!(Number(ext[1])>0&&Number(int[1])>0)||Number(ext[1])===Number(int[1]))throw Error('Two explicit distinct source wall thickness classes are required');
  const styles=new Map();for(const s of graphics.strokes){if(s.dash?.length)continue;const id=s.width.toFixed(5)+'|'+s.color.map(n=>n.toFixed(5)).join(',');if(!styles.has(id))styles.set(id,{width:s.width,color:s.color,paths:[]});styles.get(id).paths.push(s);}
  if(styles.size>50)throw Error('Excessive source line styles');
  const pairs=[];for(const outer of styles.values())for(const inner of styles.values()){
   if(!(outer.width>0&&inner.width>0)||outer.width===inner.width||JSON.stringify(outer.color)!==JSON.stringify(inner.color)||Math.abs(outer.width/inner.width-Number(ext[1])/Number(int[1]))>.01)continue;
   if(outer.paths.some(p=>p.curved)||inner.paths.some(p=>p.curved))continue;
   const pts=outer.paths.flatMap(s=>s.segments.flatMap(l=>[l.a,l.b]));if(!pts.length)continue;
   const x0=Math.min(...pts.map(p=>p.x)),x1=Math.max(...pts.map(p=>p.x)),y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y)),sx=(x1-x0)/ew,sy=(y1-y0)/eh;
   if(sx>0&&Math.abs(sx-sy)/sx<.001)pairs.push({outer,inner,x0,y0,scale:(sx+sy)/2});
  }
  if(pairs.length!==1)throw Error('Wall stroke classes or envelope calibration are ambiguous');
  const {outer,inner,x0,y0,scale}=pairs[0],toMetres=p=>({x:round((p.x-x0)/scale),y:round((p.y-y0)/scale)});
  const numeric=text.spans.filter(s=>/^\d+(?:\.\d+)?$/.test(s.text));
  const widthAnchors=numeric.filter(s=>near(Number(s.text)*dimensionFactor,ew)&&Math.abs(s.angle||0)<EPS&&s.y<y0&&y0-s.y<6*s.height&&Math.abs(s.x-(x0+ew*scale/2))<2*s.height);
  const heightAnchors=numeric.filter(s=>near(Number(s.text)*dimensionFactor,eh)&&Math.abs(Math.abs(s.angle||0)-Math.PI/2)<EPS&&s.x<x0&&x0-s.x<6*s.height&&Math.abs(s.y-(y0+eh*scale/2))<2*s.height);
  if(widthAnchors.length!==1||heightAnchors.length!==1)throw Error('Independent overall dimension anchors do not confirm the envelope scale');
  const spans=text.spans.filter(s=>Math.abs(s.angle||0)<EPS).map(s=>({...s,...toMetres(s),height:s.height/scale}));
  const groups=new Map();
  for(const [style,classification] of [[outer,'external'],[inner,'internal']])for(const path of style.paths)for(const segment of path.segments){
   let a=toMetres(segment.a),b=toMetres(segment.b);
   if(Math.hypot(b.x-a.x,b.y-a.y)<EPS)continue;const axis=near(a.y,b.y)?'h':near(a.x,b.x)?'v':null;if(!axis)throw Error('Only orthogonal centreline walls are supported');
   if((axis==='h'?a.x>b.x:a.y>b.y))[a,b]=[b,a];const fixed=axis==='h'?a.y:a.x,id=`${classification}:${axis}:${fixed}`;
   if(!groups.has(id))groups.set(id,{classification,axis,fixed,pieces:[]});groups.get(id).pieces.push({a:axis==='h'?a.x:a.y,b:axis==='h'?b.x:b.y});
  }
  const gaps=[];for(const g of groups.values()){
   const sorted=g.pieces.sort((a,b)=>a.a-b.a),merged=[];
   for(const p of sorted){const last=merged.at(-1);if(last&&p.a<=last.b+EPS)last.b=Math.max(last.b,p.b);else merged.push({...p});}
   g.pieces=merged;for(let i=1;i<merged.length;i++){const a=merged[i-1].b,b=merged[i].a;gaps.push({g,a,b,width:b-a});}
  }
  const bindings=[];for(const opening of schedule.rows){
   const labels=spans.filter(s=>s.text.trim().toLowerCase()===opening.id.toLowerCase());if(labels.length!==1)throw Error('Opening tag missing or repeated on the source plan: '+opening.id);
   const label=labels[0],candidates=gaps.filter(g=>Math.abs(g.width-opening.width)<.001&&Math.abs((g.g.axis==='h'?label.y:label.x)-g.g.fixed)<3.5*label.height&&
    (g.g.axis==='h'?label.x:label.y)>g.a-label.height&&(g.g.axis==='h'?label.x:label.y)<g.b+label.height);
   if(candidates.length!==1||bindings.some(b=>b.gap===candidates[0]))throw Error('Opening gap or tag location is ambiguous: '+opening.id);
   bindings.push({opening,gap:candidates[0]});
  }
  const walls=[];for(const g of groups.values()){
   const pieces=[];for(const piece of g.pieces){const last=pieces.at(-1),bridge=last&&bindings.find(b=>b.gap.g===g&&near(b.gap.a,last.b)&&near(b.gap.b,piece.a));if(bridge)last.b=piece.b;else pieces.push({...piece});}
   const divided=[];for(const p of pieces){
    const attached=bindings.filter(o=>o.gap.g===g&&o.gap.a>=p.a-EPS&&o.gap.b<=p.b+EPS).sort((a,b)=>a.gap.a-b.gap.a),cuts=[];
    for(let i=1;i<attached.length;i++)if(attached[i-1].opening.wall_id&&attached[i].opening.wall_id&&attached[i-1].opening.wall_id!==attached[i].opening.wall_id){
     const junctions=[...new Set([...groups.values()].filter(other=>other.axis!==g.axis&&other.fixed>attached[i-1].gap.b+EPS&&other.fixed<attached[i].gap.a-EPS&&other.pieces.some(piece=>g.fixed>=piece.a-EPS&&g.fixed<=piece.b+EPS)).map(other=>other.fixed))];
     if(junctions.length!==1)throw Error('Different source host IDs require one unambiguous intervening wall junction');cuts.push(junctions[0]);
    }
    const bounds=[p.a,...cuts,p.b];for(let i=1;i<bounds.length;i++)divided.push({a:bounds[i-1],b:bounds[i]});
   }
   for(const p of divided){const a=g.axis==='h'?{x:p.a,y:g.fixed}:{x:g.fixed,y:p.a},b=g.axis==='h'?{x:p.b,y:g.fixed}:{x:g.fixed,y:p.b};
    const attached=bindings.filter(o=>o.gap.g===g&&o.gap.a>=p.a-EPS&&o.gap.b<=p.b+EPS),hosts=[...new Set(attached.map(o=>o.opening.wall_id).filter(Boolean))];
    if(hosts.length>1)throw Error(`Physical wall ${g.axis}:${g.fixed}:${p.a}:${p.b} maps to conflicting source host IDs: ${hosts.join(', ')}`);
    walls.push({id:hosts[0]||`native:${g.axis}:${g.fixed}:${p.a}:${p.b}`,a,b,axis:g.axis,classification:g.classification,length:round(p.b-p.a),openings:attached.map(o=>o.opening.id)});
   }
  }
  const discarded=[];
  if(walls.length>300)throw Error('Native wall graph exceeds bounded connectivity check');
  for(const w of [...walls])if(w.classification==='internal'&&[w.a,w.b].every(p=>!walls.some(other=>other!==w&&dist(p,other.a,other.b)<EPS))){
   // A TV mark fully inside a labelled room is a separate annotated object,
   // not a connecting wall. Keep this exclusion visible and provisional.
   const tv=spans.find(s=>/^TV$/i.test(s.text.trim())&&dist(s,w.a,w.b)<3*s.height);
   if(!tv)throw Error('Unclassified isolated wall-weight stroke');
   discarded.push({a:w.a,b:w.b,source_label:tv.text,reason:'Isolated annotated TV object; requires source review'});walls.splice(walls.indexOf(w),1);
  }
  for(const w of walls)for(const p of [w.a,w.b])if(!walls.some(other=>other!==w&&dist(p,other.a,other.b)<EPS))throw Error('Unclosed wall endpoint; untagged gap or free-standing wall requires review');
  const external=walls.filter(w=>w.classification==='external');
  for(const w of external)for(const p of [w.a,w.b])if(external.filter(other=>other!==w&&dist(p,other.a,other.b)<EPS).length!==1)throw Error('External centreline envelope is not a single closed boundary');
  const faces=facesOf(walls);if(!faces.length||faces.length>200)throw Error('Closed wall faces unavailable');
  const roomSpans=text.spans.map(s=>({...s,...toMetres(s)}));
  for(const face of faces){face.tags=roomSpans.filter(s=>/^[A-Z]{1,4}[-_]?\d{1,4}(?=\s)/i.test(s.text.trim())&&contains(face.polygon,s)).map(s=>s.text.trim().match(/^[A-Z]{1,4}[-_]?\d{1,4}/i)[0]);
   face.opening_ids=bindings.filter(o=>{const g=o.gap,p=g.g.axis==='h'?{x:(g.a+g.b)/2,y:g.g.fixed}:{x:g.g.fixed,y:(g.a+g.b)/2};return face.polygon.some((a,i)=>dist(p,a,face.polygon[(i+1)%face.polygon.length])<EPS);}).map(o=>o.opening.id);
  }
  for(const d of discarded){const enclosing=faces.filter(f=>f.tags.length===1&&contains(f.polygon,d.a)&&contains(f.polygon,d.b));if(enclosing.length!==1)throw Error('Isolated annotation is not inside one tagged source room');d.room_tag=enclosing[0].tags[0];}
  Object.assign(audit,{status:'provisional',calibration:{width_m:ew,height_m:eh,points_per_m:scale,source_dimension_factor_to_m:dimensionFactor,origin:{x:x0,y:y0}},wall_styles:{external:outer.width,internal:inner.width},discarded_annotations:discarded,
   opening_bindings:bindings.map(o=>({id:o.opening.id,host:o.opening.wall_id,gap_width_m:o.gap.width})),wall_count:walls.length,requires_review:true});
  return {status:'provisional',walls,faces,audit};
 }catch(e){audit.reason=e.message;return {status:'pending',walls:[],faces:[],audit};}
}
