// Discover symbols before any semantic request. Circle geometry and leaf support
// come from pixels; no room names, source-specific coordinates or door count.
import sharp from 'sharp';
import {rasterInkContrast} from './rasterInkContrast.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function solve3(a,b){
 a=a.map((r,i)=>[...r,b[i]]);
 for(let k=0;k<3;k++){let best=k;for(let i=k+1;i<3;i++)if(Math.abs(a[i][k])>Math.abs(a[best][k]))best=i;[a[k],a[best]]=[a[best],a[k]];const v=a[k][k];if(Math.abs(v)<1e-9)return null;for(let j=k;j<4;j++)a[k][j]/=v;for(let i=0;i<3;i++)if(i!==k){const f=a[i][k];for(let j=k;j<4;j++)a[i][j]-=f*a[k][j];}}
 return a.map(r=>r[3]);
}
function fitCircle(points){
 const mean=points.reduce((s,p)=>({x:s.x+p.x/points.length,y:s.y+p.y/points.length}),{x:0,y:0}),matrix=Array.from({length:3},()=>[0,0,0]),rhs=[0,0,0];
 for(const p of points){const x=p.x-mean.x,y=p.y-mean.y,row=[x,y,1],target=-(x*x+y*y);for(let i=0;i<3;i++){rhs[i]+=row[i]*target;for(let j=0;j<3;j++)matrix[i][j]+=row[i]*row[j];}}
 const v=solve3(matrix,rhs);if(!v)return null;const x=mean.x-v[0]/2,y=mean.y-v[1]/2,radius=Math.sqrt((v[0]*v[0]+v[1]*v[1])/4-v[2]);if(!Number.isFinite(radius))return null;
 const residual=points.reduce((s,p)=>s+Math.abs(Math.hypot(p.x-x,p.y-y)-radius),0)/points.length;
 const angles=points.map(p=>Math.atan2(p.y-y,p.x-x)).sort((a,b)=>a-b);let gap=-1,after=0;
 for(let i=0;i<angles.length;i++){const d=(i===angles.length-1?angles[0]+2*Math.PI:angles[i+1])-angles[i];if(d>gap){gap=d;after=(i+1)%angles.length;}}
 return{x,y,radius,residual,startAngle:angles[after],span:2*Math.PI-gap};
}
function robustArcs(points,maxRadius){
 let seed=points.length;const groups=[];
 const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed%points.length;};
 for(let iteration=0;iteration<256;iteration++){
  const a=points[random()],b=points[random()],c=points[random()];
  if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<24)continue;
  const trial=fitCircle([a,b,c]);if(!trial||trial.radius<12||trial.radius>maxRadius)continue;
  const inliers=points.filter(p=>Math.abs(distance(p,trial)-trial.radius)<1.4);
  if(inliers.length<24||inliers.length<points.length*.15)continue;
  const previous=groups.find(g=>distance(g.circle,trial)<trial.radius*.2&&Math.abs(g.circle.radius-trial.radius)<trial.radius*.2);
  if(previous){if(inliers.length>previous.inliers.length){previous.circle=trial;previous.inliers=inliers;}}else groups.push({circle:trial,inliers});
 }
 const results=[];
 for(const group of groups.sort((a,b)=>b.inliers.length-a.inliers.length).slice(0,12)){
  let best=group.inliers;for(let i=0;i<3;i++){const circle=fitCircle(best);if(!circle)break;best=points.filter(p=>Math.abs(distance(p,circle)-circle.radius)<1.4);}
  const circle=fitCircle(best);if(circle&&circle.radius>=12&&circle.radius<=maxRadius)results.push({...circle,pixelCount:best.length});
 }
 return results;
}
export async function discoverRasterOpenings(buffer,graph,{includeComponentDiagnostics=false}={}){
 const{data,info}=await sharp(buffer).flatten({background:'#fff'}).removeAlpha().raw().toBuffer({resolveWithObject:true}),{width,height,channels}=info,tone=new Uint8Array(width*height),chroma=new Uint8Array(width*height);
 for(let i=0;i<tone.length;i++){const r=data[i*channels],g=data[i*channels+1],b=data[i*channels+2];tone[i]=Math.round((r+g+b)/3);chroma[i]=Math.max(r,g,b)-Math.min(r,g,b);}
 const{strokeMask}=rasterInkContrast(tone,width,height),mask=Uint8Array.from(tone,(v,i)=>chroma[i]<30&&(v<132||strokeMask[i])?1:0),curves=mask.slice();
 const angle=s=>Math.atan2(s.end.y-s.start.y,s.end.x-s.start.x),angleDistance=(a,b)=>Math.acos(Math.min(1,Math.abs(Math.cos(a-b))));
 const directionGroups=[];for(const s of [...graph.ink].filter(s=>!s.colorEvidence&&s.lengthPixels>Math.min(width,height)*.18).sort((a,b)=>b.lengthPixels-a.lengthPixels)){const a=angle(s),group=directionGroups.find(g=>angleDistance(a,g.angle)<.06);if(group)group.weight+=s.lengthPixels;else directionGroups.push({angle:a,weight:s.lengthPixels});}
 const maxWeight=Math.max(0,...directionGroups.map(g=>g.weight)),directions=directionGroups.filter(g=>g.weight>=maxWeight*.15).map(g=>g.angle);
 // Remove measured straight wall/leaf strokes only in observed dominant
 // directions. Oblique fragments approximating an arc are not erased.
 for(const s of graph.ink.filter(s=>!s.colorEvidence&&s.lengthPixels>=18&&directions.some(a=>angleDistance(a,angle(s))<.035))){
  const length=distance(s.start,s.end),nx=-(s.end.y-s.start.y)/length,ny=(s.end.x-s.start.x)/length;
  for(let t=0;t<=length;t++)for(let n=-2;n<=2;n++){const x=Math.round(s.start.x+(s.end.x-s.start.x)*t/length+nx*n),y=Math.round(s.start.y+(s.end.y-s.start.y)*t/length+ny*n);if(x>=0&&y>=0&&x<width&&y<height)curves[y*width+x]=0;}
 }
 const visited=new Uint8Array(mask.length),arcs=[],componentDiagnostics=[],clusters=[];
 for(let seed=0;seed<curves.length;seed++){
  if(!curves[seed]||visited[seed])continue;const queue=[seed],points=[];visited[seed]=1;
  for(let at=0;at<queue.length;at++){const i=queue[at],x=i%width,y=Math.floor(i/width);points.push({x,y});for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy,j=yy*width+xx;if(xx>=0&&yy>=0&&xx<width&&yy<height&&curves[j]&&!visited[j]){visited[j]=1;queue.push(j);}}}
  if(points.length<6||points.length>Math.min(width,height)*5)continue;
  const box={x0:Math.min(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),x1:Math.max(...points.map(p=>p.x)),y1:Math.max(...points.map(p=>p.y))};clusters.push(box);
  if(points.length<16)continue;const initial=fitCircle(points),circles=initial&&initial.residual<=1.5?[initial]:robustArcs(points,Math.min(width,height)*.28);
  if(includeComponentDiagnostics)componentDiagnostics.push({count:points.length,box,circles});
  for(const circle of circles){if(!circle||circle.radius<12||circle.radius>Math.min(width,height)*.28||circle.residual>1.5||circle.span<Math.PI*.2||circle.span>Math.PI*.85)continue;arcs.push({...circle,pixelCount:circle.pixelCount||points.length});}
 }
 const near=(p,r=1)=>{for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){const x=Math.round(p.x+dx),y=Math.round(p.y+dy);if(x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x])return true;}return false;};
 const doors=[],symbolDiagnostics=[],optionDiagnostics=[];
 for(const arc of arcs){
  // A fitted arc alone could be furniture. Require an observed thin radial
  // leaf and a closed direction aligned with actual drawing orientations.
  const options=[];
  for(const direction of directions)for(const closedAngle of [direction,direction+Math.PI])for(const side of [-1,1]){
   const closed={x:Math.cos(closedAngle),y:Math.sin(closedAngle)},hinge={x:arc.x,y:arc.y};let best=null;
   for(let degrees=45;degrees<=135;degrees+=2){
    if(degrees*Math.PI/180<arc.span-.15)continue;
    const theta=closedAngle+side*degrees*Math.PI/180,leaf={x:Math.cos(theta),y:Math.sin(theta)};let leafHits=0,arcHits=0;const offsets=[];
    for(let i=0;i<24;i++){
     const t=.15+.7*i/23,p={x:hinge.x+leaf.x*arc.radius*t,y:hinge.y+leaf.y*arc.radius*t};let dark=0;for(let n=-5;n<=5;n++){const x=Math.round(p.x-leaf.y*n),y=Math.round(p.y+leaf.x*n);if(x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x])dark++;}
     if(near(p,2)&&dark<=6){leafHits++;let closest=null;for(let n=-4;n<=4;n++){const x=Math.round(p.x-leaf.y*n),y=Math.round(p.y+leaf.x*n);if(x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x]&&(closest===null||Math.abs(n)<Math.abs(closest)))closest=n;}if(closest!==null)offsets.push(closest);}
     const a=closedAngle+side*degrees*Math.PI/180*(.1+.8*i/23);const radial={x:Math.cos(a),y:Math.sin(a)},q={x:hinge.x+radial.x*arc.radius,y:hinge.y+radial.y*arc.radius};let arcDark=0;for(let n=-5;n<=5;n++){const x=Math.round(q.x+radial.x*n),y=Math.round(q.y+radial.y*n);if(x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x])arcDark++;}if(near(q,2)&&arcDark<=6)arcHits++;
    }
    let beyond=0;for(let j=0;j<8;j++)if(near({x:hinge.x+leaf.x*arc.radius*(1.1+j*.04),y:hinge.y+leaf.y*arc.radius*(1.1+j*.04)},2))beyond++;
    const mean=offsets.reduce((s,v)=>s+v,0)/Math.max(1,offsets.length),deviation=Math.sqrt(offsets.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,offsets.length));
    if(includeComponentDiagnostics&&leafHits>=18&&arcHits>=18)optionDiagnostics.push({arc,closedAngle,side,degrees,leafHits,arcHits,beyond,deviation});
    if(leafHits<21||arcHits<20||beyond>4||deviation>1)continue;
    let tangentHits=0;
    for(let j=0;j<16;j++){
      const a=closedAngle+side*degrees*Math.PI/180*(.15+.7*j/15),q={x:hinge.x+Math.cos(a)*arc.radius,y:hinge.y+Math.sin(a)*arc.radius},points=[];
      for(let dx=-4;dx<=4;dx++)for(let dy=-4;dy<=4;dy++){if(dx*dx+dy*dy>16)continue;const x=Math.round(q.x+dx),y=Math.round(q.y+dy);if(x>=0&&y>=0&&x<width&&y<height&&curves[y*width+x])points.push({x,y});}
      if(points.length<3)continue;const mean=points.reduce((s,p)=>({x:s.x+p.x/points.length,y:s.y+p.y/points.length}),{x:0,y:0});let xx=0,xy=0,yy=0;for(const p of points){const dx=p.x-mean.x,dy=p.y-mean.y;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;}
      const t=.5*Math.atan2(2*xy,xx-yy);if(Math.abs(Math.cos(t-a))<.3)tangentHits++;
    }
    if(includeComponentDiagnostics)optionDiagnostics.at(-1).tangentHits=tangentHits;
    if(tangentHits<12)continue;
    const score=(leafHits+arcHits)/48-deviation*.08;if(!best||score>best.score)best={score,degrees,hinge,closed,side,leafSupport:leafHits/24,arcSupport:arcHits/24};
   }
   if(best)options.push(best);
  }
  options.sort((a,b)=>b.score-a.score);const best=options[0];if(!best||options[1]&&options[1].score>best.score-.035)continue;
  const glyphContext=directions.some(angle=>{
    const glyphs=clusters.map(b=>{const x=(b.x0+b.x1)/2-best.hinge.x,y=(b.y0+b.y1)/2-best.hinge.y,major=Math.max(b.x1-b.x0,b.y1-b.y0),minor=Math.min(b.x1-b.x0,b.y1-b.y0);return{along:x*Math.cos(angle)+y*Math.sin(angle),across:-x*Math.sin(angle)+y*Math.cos(angle),major,minor};}).filter(g=>g.major>=arc.radius*.25&&g.major<=arc.radius*2&&g.minor>=2&&g.major/g.minor<3&&Math.abs(g.along)<arc.radius*6&&Math.abs(g.across)<arc.radius*.7).sort((a,b)=>a.along-b.along);
    let group=[];const word=()=>{if(group.length<5||group.at(-1).along-group[0].along<arc.radius*2.5)return false;const mean=group.reduce((s,g)=>s+g.across,0)/group.length,spread=Math.sqrt(group.reduce((s,g)=>s+(g.across-mean)**2,0)/group.length),size=group.reduce((s,g)=>s+g.minor,0)/group.length;return spread<size*.55;};
    for(const g of glyphs){if(group.length&&g.along-group.at(-1).along>Math.max(arc.radius*.75,(g.major+group.at(-1).major)*.8)){if(word())return true;group=[];}group.push(g);}return word();
  });
  if(includeComponentDiagnostics)symbolDiagnostics.push({arc,best,glyphContext});
  if(glyphContext)continue;
  const start=best.hinge,end={x:start.x+best.closed.x*arc.radius,y:start.y+best.closed.y*arc.radius};
  if(doors.some(d=>distance(d.start,start)<5&&distance(d.end,end)<5))continue;
  doors.push({id:`source_door${doors.length+1}`,type:'door',start,end,widthPixels:arc.radius,hingeSide:'start',swingDirection:best.side>0?'clockwise':'counterclockwise',angleDegrees:best.degrees,leafSupport:best.leafSupport,arcSupport:best.arcSupport,circleResidual:arc.residual,source:'source_arc_and_radial_leaf'});
 }
 return{version:'source-opening-discovery-v1',doors,arcCandidates:arcs,...(includeComponentDiagnostics?{componentDiagnostics,symbolDiagnostics,optionDiagnostics}:{})};
}

// The host may end at a jamb or meet it at a corner. It need not continue
// collinearly on BOTH sides of a door. A measured leaf is never made a wall.
export function sourceDoorGapCandidates(graph,discovery){
 const pointDistance=(p,s)=>{const dx=s.end.x-s.start.x,dy=s.end.y-s.start.y,length2=dx*dx+dy*dy,t=((p.x-s.start.x)*dx+(p.y-s.start.y)*dy)/length2,q={x:s.start.x+Math.max(0,Math.min(1,t))*dx,y:s.start.y+Math.max(0,Math.min(1,t))*dy};return distance(p,q);};
 return discovery.doors.map(door=>{
  const dx=door.end.x-door.start.x,dy=door.end.y-door.start.y,length=distance(door.start,door.end),mid={x:(door.start.x+door.end.x)/2,y:(door.start.y+door.end.y)/2};
  const eligible=graph.candidates.filter(c=>{
   if(c.colorEvidence)return false;const ux=c.end.x-c.start.x,uy=c.end.y-c.start.y,parallel=Math.abs((ux*dx+uy*dy)/(distance(c.start,c.end)*length))>.98,tolerance=Math.max(4,(c.thicknessPixels||0)/2+3);
   // A candidate crossing the entire opening is a frame/alternative, not a
   // solid host that can remain across a door cut.
   return !(parallel&&pointDistance(mid,c)<tolerance&&pointDistance(door.start,c)<tolerance&&pointDistance(door.end,c)<tolerance);
  });
  const bands=eligible.filter(c=>(c.kind==='solid_band'||c.kind==='face_pair'&&c.filledBandRatio>=.65)&&Math.abs(((c.end.x-c.start.x)*dx+(c.end.y-c.start.y)*dy)/(distance(c.start,c.end)*length))>.98&&(pointDistance(door.start,c)<c.thicknessPixels/2+4||pointDistance(door.end,c)<c.thicknessPixels/2+4)).sort((a,b)=>(a.kind==='solid_band'?0:1)-(b.kind==='solid_band'?0:1)||Math.min(pointDistance(door.start,a),pointDistance(door.end,a))-Math.min(pointDistance(door.start,b),pointDistance(door.end,b)));
  let start={...door.start},end={...door.end},attachmentEvidence=null;
  if(bands.length){
   const band=bands[0],ux=(band.end.x-band.start.x)/distance(band.start,band.end),uy=(band.end.y-band.start.y)/distance(band.start,band.end),offset=(start.x-band.start.x)*(-uy)+(start.y-band.start.y)*ux;
   start={x:start.x+uy*offset,y:start.y-ux*offset};end={x:end.x+uy*offset,y:end.y-ux*offset};
   for(const p of [start,end]){
    const nearby=bands.flatMap(b=>[b.start,b.end]).filter(q=>distance(p,q)<=Math.max(5,band.thicknessPixels/2+3)).sort((a,b)=>distance(p,a)-distance(p,b));
    if(nearby.length){p.x=nearby[0].x;p.y=nearby[0].y;}
   }
   attachmentEvidence={method:'measured_wall_band_jambs',bandId:band.id,normalOffsetPixels:offset};
  }
  const hosts=p=>eligible.filter(c=>pointDistance(p,c)<=Math.max(5,(c.thicknessPixels||0)/2+3)).map(c=>c.id);
  return{id:door.id,start,end,lengthPixels:distance(start,end),support:'observed_arc_and_leaf',endpointHosts:{start:hosts(start),end:hosts(end)},sourceDoor:door,attachmentEvidence};
 });
}
