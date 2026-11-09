// Local evidence extraction: detects ink segments, NOT room or wall semantics.
// All coordinates originate in source pixels; classifiers only select IDs.
import sharp from 'sharp';
import {rasterInkContrast} from './rasterInkContrast.mjs';
import {rasterContentExtent} from './rasterContentExtent.mjs';
export const PIXEL_GRAPH_VERSION='pixel-line-graph-v4-content-extent';
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const at=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const round=p=>({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100});
function error(code,message,details={}){return Object.assign(Error(message),{name:'PixelGraphError',code,details});}
function project(p,a,b){const v=sub(b,a),length2=v.x*v.x+v.y*v.y,t=length2?((p.x-a.x)*v.x+(p.y-a.y)*v.y)/length2:0;return{t,distance:dist(p,at(a,b,t))};}

export function detectInkSegments(mask,width,height,{minLength=Math.max(18,Math.min(width,height)*.035),maxLines=512}={}){
  const edge=[],edgeMask=new Uint8Array(mask.length);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;if(mask[i]&&(!mask[i-1]||!mask[i+1]||!mask[i-width]||!mask[i+width])){edge.push({x,y});edgeMask[i]=1;}
  }
  if(!edge.length)return[];
  const diagonal=Math.ceil(Math.hypot(width,height)),stride=2*diagonal+1,angles=180,step=Math.max(1,Math.ceil(edge.length/90000));
  const votes=new Uint32Array(angles*stride),trig=Array.from({length:angles},(_,i)=>({c:Math.cos(i*Math.PI/180),s:Math.sin(i*Math.PI/180)}));
  for(let a=0;a<angles;a++){const{c,s}=trig[a],base=a*stride;for(let i=0;i<edge.length;i+=step){const p=edge[i];votes[base+Math.round(p.x*c+p.y*s)+diagonal]++;}}
  let peaks=[];
  for(let a=0;a<angles;a++)for(let r=2;r<stride-2;r++){
    const value=votes[a*stride+r];if(value<minLength*.65/step)continue;let peak=true;
    for(let da=-1;da<=1&&peak;da++)for(let dr=-2;dr<=2;dr++){
      const aa=a+da;if(aa<0||aa>=angles||(!da&&!dr))continue;
      const other=votes[aa*stride+r+dr];if(other>value||(other===value&&(da<0||(!da&&dr<0)))){peak=false;break;}
    }
    if(peak)peaks.push({a,rho:r-diagonal,value});
  }
  peaks.sort((a,b)=>b.value-a.value||a.a-b.a||a.rho-b.rho);
  // Short text strokes vote at almost every angle. Retain short runs only in
  // orientations also evidenced by long source lines; those orientations can
  // be rotated or oblique and are never hardcoded to horizontal/vertical.
  const angleDistance=(a,b)=>Math.min(Math.abs(a-b),180-Math.abs(a-b)),directions=[];
  for(const p of peaks){if(p.value<Math.max(minLength*3,Math.min(width,height)*.12)/step)break;if(directions.every(a=>angleDistance(a,p.a)>3))directions.push(p.a);if(directions.length===12)break;}
  if(!directions.length)return[];
  peaks=peaks.filter(p=>directions.some(a=>angleDistance(a,p.a)<=1));
  if(peaks.length>maxLines*6)throw error('PIXEL_GRAPH_TOO_COMPLEX','Too many source lines to classify safely.',{peakCount:peaks.length});
  const segments=[];
  for(const peak of peaks){
    const {c,s}=trig[peak.a],v={x:-s,y:c},corners=[{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}],ts=corners.map(p=>p.x*v.x+p.y*v.y);
    let start=null,last=null,misses=0;
    const emit=()=>{
      if(start===null||last-start<minLength)return;
      const rawStart={x:c*peak.rho+v.x*start,y:s*peak.rho+v.y*start},rawEnd={x:c*peak.rho+v.x*last,y:s*peak.rho+v.y*last};
      if([rawStart,rawEnd].some(p=>p.x<0||p.y<0||p.x>width||p.y>height))return;
      // Refine the integer-angle Hough seed with source-pixel least squares.
      const pts=[];for(const p of edge){const q=project(p,rawStart,rawEnd);if(q.t>=0&&q.t<=1&&q.distance<=1.7)pts.push(p);}
      if(pts.length<minLength*.4)return;
      const mean=pts.reduce((q,p)=>({x:q.x+p.x/pts.length,y:q.y+p.y/pts.length}),{x:0,y:0});
      let xx=0,xy=0,yy=0;for(const p of pts){const x=p.x-mean.x,y=p.y-mean.y;xx+=x*x;xy+=x*y;yy+=y*y;}
      const angle=.5*Math.atan2(2*xy,xx-yy),u={x:Math.cos(angle),y:Math.sin(angle)},values=pts.map(p=>(p.x-mean.x)*u.x+(p.y-mean.y)*u.y),lo=Math.min(...values),hi=Math.max(...values);
      let a=round({x:mean.x+u.x*lo,y:mean.y+u.y*lo}),b=round({x:mean.x+u.x*hi,y:mean.y+u.y*hi});
      if(a.x>b.x||(a.x===b.x&&a.y>b.y))[a,b]=[b,a];
      const duplicate=segments.some(g=>project(a,g.start,g.end).distance<2.2&&project(b,g.start,g.end).distance<2.2&&Math.max(project(a,g.start,g.end).t,project(b,g.start,g.end).t)>.05&&Math.min(project(a,g.start,g.end).t,project(b,g.start,g.end).t)<.95);
      if(!duplicate)segments.push({start:a,end:b,lengthPixels:Math.round(dist(a,b)),support:'observed_ink'});
    };
    for(let t=Math.floor(Math.min(...ts));t<=Math.ceil(Math.max(...ts));t++){
      let ink=false;for(let n=-1;n<=1;n++){const x=Math.round(c*(peak.rho+n)+v.x*t),y=Math.round(s*(peak.rho+n)+v.y*t);if(x>=0&&x<width&&y>=0&&y<height&&edgeMask[y*width+x]){ink=true;break;}}
      if(ink){if(start===null)start=t;last=t;misses=0;}else if(start!==null&&++misses>1){emit();start=last=null;misses=0;}
    }
    emit();
    if(segments.length>maxLines)throw error('PIXEL_GRAPH_TOO_COMPLEX','Source has more segments than the classifier budget; no geometry was truncated.',{segmentCount:segments.length});
  }
  return segments.sort((a,b)=>a.start.y-b.start.y||a.start.x-b.start.x||b.lengthPixels-a.lengthPixels).map((s,i)=>({id:`ink${i+1}`,...s}));
}

export async function extractRasterPixelGraph(buffer){
  const {data,info}=await sharp(buffer).flatten({background:'#fff'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=info,tone=new Uint8Array(width*height),chroma=new Uint8Array(width*height),mask=new Uint8Array(width*height),coloredMask=new Uint8Array(width*height);
  for(let i=0;i<tone.length;i++){const r=data[i*channels],g=data[i*channels+1],b=data[i*channels+2];chroma[i]=Math.max(r,g,b)-Math.min(r,g,b);tone[i]=Math.round((r+g+b)/3);}
  const contrast=rasterInkContrast(tone,width,height);
  for(let i=0;i<mask.length;i++){mask[i]=chroma[i]<55&&contrast.mask[i]?1:0;coloredMask[i]=chroma[i]>=55&&(tone[i]<210||contrast.strokeMask[i])?1:0;}
  const contentExtent=rasterContentExtent(Uint8Array.from(mask,(v,i)=>v||coloredMask[i]),width,height),scalePixels=contentExtent.scalePixels;
  const ink=[...detectInkSegments(mask,width,height,{minLength:Math.max(18,scalePixels*.035)}),...detectInkSegments(coloredMask,width,height,{minLength:Math.max(18,scalePixels*.035)}).map(s=>({...s,id:`color_${s.id}`,colorEvidence:true}))];
  // Long-line voting misses short door jambs and can pair unrelated faces.
  // Erosion suppresses thin strokes; measure filled bands in original pixels.
  const eroded=new Uint8Array(mask.length),maximumBand=Math.max(12,scalePixels*.035);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;let full=true;for(let dy=-1;dy<=1&&full;dy++)for(let dx=-1;dx<=1;dx++)if(!mask[i+dy*width+dx]){full=false;break;}eroded[i]=full?1:0;}
  const bands=[];
  for(const s of detectInkSegments(eroded,width,height,{minLength:6,maxLines:512}).sort((a,b)=>b.lengthPixels-a.lengthPixels)){
    const length=dist(s.start,s.end),nx=-(s.end.y-s.start.y)/length,ny=(s.end.x-s.start.x)/length,offsets=[],thicknesses=[];
    const hit=(p,n)=>{const x=Math.round(p.x+nx*n),y=Math.round(p.y+ny*n);return x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x];};
    for(const t of [.2,.4,.6,.8]){const p=at(s.start,s.end,t);let low=0,high=0;if(!hit(p,0))continue;while(low>-maximumBand&&hit(p,low-1))low--;while(high<maximumBand&&hit(p,high+1))high++;offsets.push((low+high)/2);thicknesses.push(high-low+1);}
    if(offsets.length!==4||thicknesses.some(v=>v<3||v>maximumBand)||Math.max(...thicknesses)-Math.min(...thicknesses)>3)continue;
    const shift=offsets.reduce((a,b)=>a+b,0)/4,start=round({x:s.start.x+nx*shift,y:s.start.y+ny*shift}),end=round({x:s.end.x+nx*shift,y:s.end.y+ny*shift}),thicknessPixels=thicknesses.reduce((a,b)=>a+b,0)/4;
    const ux=(s.end.x-s.start.x)/length,uy=(s.end.y-s.start.y)/length;
    for(const [p,sign]of [[start,-1],[end,1]])for(let extension=0;extension<Math.ceil(thicknessPixels);extension++){const x=Math.round(p.x+sign*ux),y=Math.round(p.y+sign*uy);if(x<0||y<0||x>=width||y>=height||!mask[y*width+x])break;p.x+=sign*ux;p.y+=sign*uy;}
    if(bands.some(b=>{const a=project(start,b.start,b.end),z=project(end,b.start,b.end);return a.distance<2&&z.distance<2&&Math.min(a.t,z.t)>=-.02&&Math.max(a.t,z.t)<=1.02;}))continue;
    const boundarySourceIds=ink.filter(b=>{if(b.colorEvidence)return false;const a=project(start,b.start,b.end),z=project(end,b.start,b.end);return Math.abs(cross(sub(end,start),sub(b.end,b.start)))/(dist(start,end)*dist(b.start,b.end))<.012&&a.distance<thicknessPixels/2+2&&z.distance<thicknessPixels/2+2&&Math.min(a.t,z.t)>=-.05&&Math.max(a.t,z.t)<=1.05;}).map(s=>s.id);
    bands.push({id:`solid_band${bands.length+1}`,start:round(start),end:round(end),lengthPixels:Math.round(dist(start,end)),thicknessPixels,boundarySourceIds,centerlineEvidence:true,support:'measured_solid_band'});
  }
  ink.push(...bands);
  const candidates=ink.map(s=>({...s,sourceIds:[s.id,...(s.boundarySourceIds||[])],kind:s.centerlineEvidence?'solid_band':'stroke'}));
  const maxThickness=Math.max(12,scalePixels*.035),sourceCuts=new Map(ink.map(s=>[s.id,[0,1]])),pairOptions=[];
  for(let i=0;i<ink.length;i++)for(let j=i+1;j<ink.length;j++){
    const a=ink[i],b=ink[j],u=sub(a.end,a.start),v=sub(b.end,b.start),length=dist(a.start,a.end);
    if(a.centerlineEvidence||b.centerlineEvidence)continue;
    if(Math.abs(cross(u,v))/(length*dist(b.start,b.end))>.012)continue;
    const separation=project(b.start,a.start,a.end).distance;if(separation<3||separation>maxThickness)continue;
    const t0=project(b.start,a.start,a.end).t,t1=project(b.end,a.start,a.end).t,lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));
    if((hi-lo)*length<.8*Math.min(length,dist(b.start,b.end)))continue;
    const aa=at(a.start,a.end,lo),ab=at(a.start,a.end,hi),ba=at(b.start,b.end,project(aa,b.start,b.end).t),bb=at(b.start,b.end,project(ab,b.start,b.end).t);
    pairOptions.push({candidate:{id:`pair${i+1}_${j+1}`,kind:'face_pair',start:round(at(aa,ba,.5)),end:round(at(ab,bb,.5)),sourceIds:[a.id,b.id],thicknessPixels:Math.round(separation*100)/100,support:'two_observed_faces'},score:(hi-lo)*length/(1+separation),a,b,lo,hi,ba,bb});
  }
  // Prefer mutually supported long adjacent faces, rather than constructing
  // every possible pairing across a whole wall/door-symbol stroke cluster.
  const preferred=new Map(ink.map(s=>[s.id,pairOptions.filter(p=>p.candidate.sourceIds.includes(s.id)).sort((a,b)=>b.score-a.score).slice(0,2)]));
  for(const pair of pairOptions){
    const{a,b,lo,hi,ba,bb}=pair;if(!preferred.get(a.id).includes(pair)||!preferred.get(b.id).includes(pair))continue;
    const c=pair.candidate,length=dist(c.start,c.end),nx=-(c.end.y-c.start.y)/length,ny=(c.end.x-c.start.x)/length;let filled=0,total=0;
    for(const t of [.15,.35,.65,.85]){const p=at(c.start,c.end,t);for(let n=-Math.floor(c.thicknessPixels/2);n<=Math.floor(c.thicknessPixels/2);n++){const x=Math.round(p.x+nx*n),y=Math.round(p.y+ny*n);if(x>=0&&y>=0&&x<width&&y<height){total++;filled+=mask[y*width+x];}}}
    c.filledBandRatio=Math.round(100*filled/Math.max(1,total))/100;
    candidates.push(pair.candidate);sourceCuts.get(a.id).push(lo,hi);sourceCuts.get(b.id).push(project(ba,b.start,b.end).t,project(bb,b.start,b.end).t);
  }
  // A short thick wall may share one face with a longer thin balcony edge.
  // Preserve measured remainder fragments; never force the classifier to
  // discard the balcony or duplicate the whole long face to choose a pair.
  for(const source of ink){
    const cuts=[...new Set(sourceCuts.get(source.id).map(t=>Math.round(Math.max(0,Math.min(1,t))*10000)/10000))].sort((a,b)=>a-b);
    if(cuts.length===2)continue;
    for(let i=1;i<cuts.length;i++){if((cuts[i]-cuts[i-1])*source.lengthPixels<12)continue;
      candidates.push({id:`${source.id}_part${i}`,kind:'stroke_fragment',start:round(at(source.start,source.end,cuts[i-1])),end:round(at(source.start,source.end,cuts[i])),sourceIds:[source.id],support:'observed_ink_fragment'});
    }
  }
  if(candidates.length>700)throw error('PIXEL_GRAPH_TOO_COMPLEX','Too many alternative wall candidates; no paid classification started.',{candidateCount:candidates.length,inkCount:ink.length});
  const gaps=[];
  // Windows and closed doors can keep two thin drawn faces across the opening.
  // Detect the measured transition from a filled wall band to a sparse frame;
  // a missing black run is therefore not the only opening evidence.
  for(const wall of candidates.filter(c=>c.kind==='face_pair')){
    const length=dist(wall.start,wall.end),dx=(wall.end.x-wall.start.x)/length,dy=(wall.end.y-wall.start.y)/length,half=wall.thicknessPixels/2,samples=Math.floor(length),fill=[];
    for(let i=0;i<=samples;i++){
      const p=at(wall.start,wall.end,i/samples);let dark=0,count=0;
      for(let n=-Math.ceil(half);n<=Math.ceil(half);n++){const x=Math.round(p.x-dy*n),y=Math.round(p.y+dx*n);if(x>=0&&x<width&&y>=0&&y<height){dark+=mask[y*width+x];count++;}}
      fill.push(count?dark/count:0);
    }
    const sparse=[];let begin=-1;
    for(let i=0;i<=fill.length;i++){
      if(i<fill.length&&fill[i]<.5){if(begin<0)begin=i;}else if(begin>=0){
        const low=begin,high=i-1;begin=-1;
        if(high-low<14||low<8||high>samples-8)continue;
        const before=fill.slice(Math.max(0,low-12),low).filter(v=>v>=.6).length,after=fill.slice(high+1,high+13).filter(v=>v>=.6).length;
        if(before>=6&&after>=6)sparse.push([low/samples,high/samples]);
      }
    }
    if(!sparse.length)continue;
    const solids=[];let last=0;
    for(const [low,high]of sparse){solids.push([last,low]);last=high;}solids.push([last,1]);
    const pieces=solids.map(([low,high],i)=>({id:`${wall.id}_solid${i+1}`,kind:'observed_wall_fragment',start:round(at(wall.start,wall.end,low)),end:round(at(wall.start,wall.end,high)),sourceIds:wall.sourceIds,thicknessPixels:wall.thicknessPixels,support:'filled_source_wall_band'}));
    candidates.push(...pieces);
    sparse.forEach(([low,high],i)=>gaps.push({id:`frame_gap${gaps.length+1}`,a:pieces[i].id,b:pieces[i+1].id,start:round(at(wall.start,wall.end,low)),end:round(at(wall.start,wall.end,high)),lengthPixels:Math.round((high-low)*length),support:'thin_frame_between_solid_jambs'}));
  }
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
    const a=candidates[i],b=candidates[j];if(a.sourceIds.some(id=>b.sourceIds.includes(id)))continue;
    if(project(b.start,a.start,a.end).distance>2.5||project(b.end,a.start,a.end).distance>2.5)continue;
    const options=[[a.start,b.start],[a.start,b.end],[a.end,b.start],[a.end,b.end]].sort((p,q)=>dist(...p)-dist(...q)),[start,end]=options[0],length=dist(start,end);
    if(length<6||length>scalePixels*.4)continue;
    const ta=project(start,a.start,a.end).t,tb=project(end,a.start,a.end).t;
    if(Math.min(ta,tb)<1-.01&&Math.max(ta,tb)>.01&&tb>=0&&tb<=1)continue;
    gaps.push({id:`gap${gaps.length+1}`,a:a.id,b:b.id,start,end,lengthPixels:Math.round(length),support:'opening_hypothesis_not_wall'});
  }
  if(candidates.length>700||gaps.length>700)throw error('PIXEL_GRAPH_TOO_COMPLEX','Opening hypotheses exceed the classification budget; nothing was truncated.');
  return{version:PIXEL_GRAPH_VERSION,imageWidth:width,imageHeight:height,contentExtent,ink,candidates,gaps};
}

// Assemble a planar graph only from explicitly selected candidates/gaps.
export function assemblePixelTopology(graph,selection){
  const map=new Map(graph.candidates.map(s=>[s.id,s])),chosen=new Set(),lines=[];
  for(const item of selection.walls||[]){
    const s=map.get(item.candidateId);if(!s||chosen.has(s.id))throw error('INVALID_PIXEL_SELECTION','Unknown or duplicate wall candidate.',{id:item.candidateId});chosen.add(s.id);
    if(!['external','internal'].includes(item.type))throw error('INVALID_PIXEL_SELECTION','Wall classification is missing.');
    lines.push({...s,type:item.type});
  }
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)for(const id of lines[i].sourceIds.filter(id=>lines[j].sourceIds.includes(id))){
    const source=graph.ink.find(s=>s.id===id);
    if(!source)throw error('OVERLAPPING_PIXEL_SELECTION','Two selected alternatives share unknown source ink.');
    const interval=line=>[project(line.start,source.start,source.end).t,project(line.end,source.start,source.end).t].sort((a,b)=>a-b),a=interval(lines[i]),b=interval(lines[j]);
    if((Math.min(a[1],b[1])-Math.max(a[0],b[0]))*dist(source.start,source.end)>2)throw error('OVERLAPPING_PIXEL_SELECTION','A stroke and a wall-face alternative cannot duplicate the same source span.',{ids:[lines[i].id,lines[j].id]});
  }
  const openings=[];
  for(const item of selection.openings||[]){
    const gap=graph.gaps.find(g=>g.id===item.gapId);
    if(!gap||openings.some(o=>o.id===gap.id)||!['door','window'].includes(item.type))throw error('INVALID_PIXEL_OPENING','An opening must have selected source wall hosts.',{id:item.gapId});
    let hosts;
    if(gap.support==='observed_arc_and_leaf'){
      if(item.type!=='door')throw error('INVALID_PIXEL_OPENING','A source door arc cannot become a window.');
      const start=gap.endpointHosts.start.filter(id=>chosen.has(id)),end=gap.endpointHosts.end.filter(id=>chosen.has(id));
      hosts=[...new Set([...start,...end])].map(id=>lines.find(s=>s.id===id));
      const u=sub(gap.end,gap.start),parallel=hosts.some(h=>{const v=sub(h.end,h.start);return Math.abs(cross(u,v))/(dist(gap.start,gap.end)*dist(h.start,h.end))<.05;});
      if(!hosts.length||!parallel&&(!start.length||!end.length))throw error('INVALID_PIXEL_OPENING','A discovered door needs a selected parallel host or selected wall junctions at both jambs.',{id:item.gapId});
    }else{
      if(!chosen.has(gap.a)||!chosen.has(gap.b))throw error('INVALID_PIXEL_OPENING','An opening must join two selected, observed collinear wall segments.',{id:item.gapId});
      hosts=[lines.find(s=>s.id===gap.a),lines.find(s=>s.id===gap.b)];
    }
    if(hosts.some(h=>h.type!==hosts[0].type))throw error('INVALID_PIXEL_OPENING','Opening hosts disagree.');
    lines.push({...gap,type:hosts[0].type,kind:'opening',id:gap.id});openings.push({...gap,type:item.type,hingeSide:gap.sourceDoor?.hingeSide||item.hingeSide||'unknown',swingDirection:gap.sourceDoor?.swingDirection||item.swingDirection||'unknown'});
  }
  if(lines.length<3)throw error('INCOMPLETE_PIXEL_SELECTION','Fewer than three supported wall runs were selected.');
  const tolerance=Math.max(2,Math.min(6,Math.max((graph.contentExtent?.scalePixels||Math.min(graph.imageWidth,graph.imageHeight))*.004,...lines.map(s=>(s.thicknessPixels||0)/2))));
  const cuts=lines.map(s=>[{t:0,p:s.start},{t:1,p:s.end}]);
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i],b=lines[j],u=sub(a.end,a.start),v=sub(b.end,b.start),den=cross(u,v);
    if(Math.abs(den)>1e-7){const d=sub(b.start,a.start),t=cross(d,v)/den,q=cross(d,u)/den;
      if(t>=-tolerance/dist(a.start,a.end)&&t<=1+tolerance/dist(a.start,a.end)&&q>=-tolerance/dist(b.start,b.end)&&q<=1+tolerance/dist(b.start,b.end)){const p=at(a.start,a.end,t);cuts[i].push({t,p});cuts[j].push({t:q,p});}
    }
    for(const [p,k,l]of [[a.start,j,i],[a.end,j,i],[b.start,i,j],[b.end,i,j]]){
      const segment=lines[k],q=project(p,segment.start,segment.end);if(q.t>=0&&q.t<=1&&q.distance<=tolerance){const value=at(segment.start,segment.end,q.t);cuts[k].push({t:q.t,p:value});cuts[l].push({t:dist(p,lines[l].start)<1e-6?0:1,p:value});}
    }
  }
  const nodes=[],edges=[],node=p=>{let i=nodes.findIndex(n=>dist(n,p)<=tolerance);if(i<0){i=nodes.length;nodes.push({id:`node${i+1}`,...round(p)});}return i;};
  for(let i=0;i<lines.length;i++){
    const sorted=cuts[i].sort((a,b)=>a.t-b.t);for(let j=1;j<sorted.length;j++){
      const a=node(sorted[j-1].p),b=node(sorted[j].p);if(a===b||edges.some(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a)))continue;
      edges.push({id:`edge${edges.length+1}`,a,b,sourceId:lines[i].id,type:lines[i].type,opening:lines[i].kind==='opening'});
    }
  }
  const adjacency=nodes.map(()=>[]);edges.forEach((e,i)=>{adjacency[e.a].push({to:e.b,index:i});adjacency[e.b].push({to:e.a,index:i});});
  adjacency.forEach((list,i)=>list.sort((a,b)=>Math.atan2(nodes[a.to].y-nodes[i].y,nodes[a.to].x-nodes[i].x)-Math.atan2(nodes[b.to].y-nodes[i].y,nodes[b.to].x-nodes[i].x)));
  // Open branches (for example a door at a wall end) do not enclose a new
  // room. Trim them only from face walking, retaining every source edge for
  // wall/opening rendering and validation.
  const faceAdjacency=adjacency.map(list=>[...list]);let changed=true;
  while(changed){changed=false;for(let i=0;i<faceAdjacency.length;i++)if(faceAdjacency[i].length===1){const other=faceAdjacency[i][0].to;faceAdjacency[i]=[];faceAdjacency[other]=faceAdjacency[other].filter(e=>e.to!==i);changed=true;}}
  const seen=new Set(),cycles=[];
  for(let i=0;i<nodes.length;i++)for(const adjacent of faceAdjacency[i]){
    const first=`${i}:${adjacent.to}`;if(seen.has(first))continue;let a=i,b=adjacent.to,points=[],ids=[],closed=false;
    for(let steps=0;steps<edges.length*2+2;steps++){
      const key=`${a}:${b}`;if(seen.has(key)){closed=key===first;break;}seen.add(key);points.push(nodes[a]);ids.push(a);
      const list=faceAdjacency[b],reverse=list.findIndex(e=>e.to===a),next=list[(reverse+list.length-1)%list.length];if(!next)break;[a,b]=[b,next.to];
    }
    if(closed&&points.length>=3&&new Set(ids).size===ids.length&&Math.abs(area(points))>16)cycles.push({polygon:points.map(({x,y})=>({x,y})),signedArea:area(points)});
  }
  const exterior=cycles.filter(f=>f.signedArea<0).sort((a,b)=>a.signedArea-b.signedArea)[0];
  const regions=cycles.filter(f=>f.signedArea>0).map((f,i)=>({id:`region${i+1}`,polygon:f.polygon,areaPixels:f.signedArea}));
  if(!exterior||!regions.length)throw error('OPEN_PIXEL_TOPOLOGY','Selected pixel segments do not enclose usable floor regions. Missing walls/openings must be reviewed, not filled with a bounding box.',{nodeCount:nodes.length,edgeCount:edges.length});
  return{nodes,edges,regions,enclosures:cycles.filter(f=>f.signedArea<0).map((f,i)=>({id:`symbol${i+1}`,polygon:[...f.polygon].reverse()})),footprint:[...exterior.polygon].reverse(),lines,openings};
}

// Clip only the annotation's anchor, never the measured source coordinates.
// Long walls crossing a crop must retain a visible ID in that crop.
export function pixelCandidateLabelAnchor(candidate,viewport){
  let low=0,high=1;const {start:a,end:b}=candidate;
  for(const [origin,delta,min,max]of [[a.x,b.x-a.x,viewport.left,viewport.right],[a.y,b.y-a.y,viewport.top,viewport.bottom]]){
    if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return null;continue;}
    const p=(min-origin)/delta,q=(max-origin)/delta;low=Math.max(low,Math.min(p,q));high=Math.min(high,Math.max(p,q));
    if(low>high)return null;
  }
  return at(a,b,(low+high)/2);
}
export function pixelGraphOverlay(graph,{layer='source',viewport={left:0,top:0,right:graph.imageWidth,bottom:graph.imageHeight}}={}){
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
  const occupied=[];
  const segments=graph.candidates.filter(c=>layer==='all'||(layer==='alternatives'?!['stroke','solid_band'].includes(c.kind):['stroke','solid_band'].includes(c.kind))).map(c=>{
    const anchor=pixelCandidateLabelAnchor(c,viewport);if(!anchor)return'';
    const width=Math.min(viewport.right-viewport.left-4,String(c.id).length*6+4);
    let label;
    for(let step=0;step<100;step++){
      const offset=step===0?-4:(step%2?1:-1)*Math.ceil(step/2)*14;
      const x=Math.max(viewport.left+2,Math.min(viewport.right-width-2,anchor.x)),y=Math.max(viewport.top+12,Math.min(viewport.bottom-2,anchor.y+offset));
      const box={left:x,right:x+width,top:y-11,bottom:y+2};
      if(!occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top)){label={x,y,box};break;}
    }
    label??={x:Math.max(viewport.left+2,Math.min(viewport.right-width-2,anchor.x)),y:Math.max(viewport.top+12,Math.min(viewport.bottom-2,anchor.y-4))};
    if(label.box)occupied.push(label.box);
    return `<g stroke="${c.kind==='solid_band'?'#e08012':'#087bbf'}"><path d="M${c.start.x} ${c.start.y}L${c.end.x} ${c.end.y}"/><path d="M${anchor.x} ${anchor.y}L${label.x} ${label.y}" stroke-width=".5"/><text x="${label.x}" y="${label.y}" fill="#075a8a" stroke="white" stroke-width="2" paint-order="stroke" font-size="10">${esc(c.id)}</text></g>`;
  }).join('');
  const doors=graph.gaps.filter(g=>g.sourceDoor).map(g=>{
    const d=g.sourceDoor,h=d.start,dx=d.end.x-h.x,dy=d.end.y-h.y,theta=(d.swingDirection==='clockwise'?1:-1)*d.angleDegrees*Math.PI/180,tip={x:h.x+dx*Math.cos(theta)-dy*Math.sin(theta),y:h.y+dx*Math.sin(theta)+dy*Math.cos(theta)};
    return `<g stroke="#008030" stroke-width="2"><path d="M${h.x} ${h.y}L${d.end.x} ${d.end.y}M${h.x} ${h.y}L${tip.x} ${tip.y}M${d.end.x} ${d.end.y}A${d.widthPixels} ${d.widthPixels} 0 0 ${theta>0?1:0} ${tip.x} ${tip.y}"/><circle cx="${h.x}" cy="${h.y}" r="3" fill="#008030"/><text x="${h.x+4}" y="${h.y-6}" fill="#008030" stroke="white" stroke-width="2" paint-order="stroke" font-size="13">${esc(g.id)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.imageWidth}" height="${graph.imageHeight}" viewBox="0 0 ${graph.imageWidth} ${graph.imageHeight}"><g fill="none" stroke-width="1.2" font-family="sans-serif">${segments}${doors}</g></svg>`;
}
