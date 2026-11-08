// Source leaf AND arc evidence. Internal doors are inward to one room and
// outward from the neighbour; unknown symbols never receive an invented swing.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const rotate=(v,a)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)});
function inside(p,polygon){let value=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)value=!value;
}return value;}
export function inspectRasterDoorSymbol(opening,evidence){
 const{width,height,mask,tone,symbolMask}=evidence,w=distance(opening.start,opening.end),tolerance=Math.max(1,Math.min(4,Math.round(w*.035)));
 const ink=(x,y)=>{const xx=Math.round(x),yy=Math.round(y);if(xx<0||yy<0||xx>=width||yy>=height)return false;const i=yy*width+xx;return symbolMask?!!symbolMask[i]:tone?tone[i]<132:!!mask[i];};
 const near=(p,r=1)=>{for(let x=-r;x<=r;x++)for(let y=-r;y<=r;y++)if(ink(p.x+x,p.y+y))return true;return false;};
 if(w<12||opening.type!=='door')return{status:'unresolved',hingeSide:'unknown',swingDirection:'unknown',reason:'door_arc_unreadable'};
 const options=[];
 for(const hingeSide of ['start','end'])for(const side of [-1,1]){
  const jamb=opening[hingeSide],other=opening[hingeSide==='start'?'end':'start'],closed={x:(other.x-jamb.x)/w,y:(other.y-jamb.y)/w},normal={x:-closed.y,y:closed.x};let best=null;
  for(const offset of [0,-2,2,-4,4]){
   const hinge={x:jamb.x+normal.x*offset,y:jamb.y+normal.y*offset};
   for(let degrees=20;degrees<=160;degrees+=2){
    const theta=degrees*Math.PI/180,leaf=rotate(closed,side*theta);let leafSupport=0;
    for(let i=0;i<18;i++){
     const reach=w*(.18+.7*i/17),p={x:hinge.x+leaf.x*reach,y:hinge.y+leaf.y*reach},n={x:-leaf.y,y:leaf.x};
     let dark=0;for(let t=-tolerance-2;t<=tolerance+2;t++)if(ink(p.x+n.x*t,p.y+n.y*t))dark++;
     if(near(p,tolerance)&&dark<=tolerance*2+1)leafSupport++;
    }
    leafSupport/=18;if(leafSupport<.78)continue;
    for(const radius of [w-3,w,w+3]){
     let arcSupport=0;
     for(let i=0;i<24;i++){const ray=rotate(closed,side*theta*(.08+.84*i/23)),p={x:hinge.x+ray.x*radius,y:hinge.y+ray.y*radius};if(near(p,tolerance))arcSupport++;}
     arcSupport/=24;if(arcSupport<.58)continue;
     const score=.45*leafSupport+.55*arcSupport;
     if(!best||score>best.score)best={score,leafSupport,arcSupport,hingeSide,side,degrees,hinge,closed};
    }
   }
  }
  if(best)options.push(best);
 }
 options.sort((a,b)=>b.score-a.score);
 const best=options[0];if(!best||options[1]&&options[1].score>best.score-.08)return{status:'unresolved',hingeSide:'unknown',swingDirection:'unknown',reason:best?'ambiguous_door_arc':'door_arc_unreadable'};
 const v=rotate(best.closed,best.side*best.degrees*Math.PI/360);
 return{status:'observed',hingeSide:best.hingeSide,swingDirection:best.side>0?'clockwise':'counterclockwise',angleDegrees:best.degrees,leafSupport:best.leafSupport,arcSupport:best.arcSupport,sectorPoint:{x:best.hinge.x+v.x*w*.45,y:best.hinge.y+v.y*w*.45},basis:'source_leaf_and_arc'};
}
export function applyRasterDoorSymbols(trace,evidence){
 const walls=new Map(trace.walls.map(w=>[w.id,w]));
 return trace.openings.map(opening=>{
  if(opening.type!=='door')return{...opening,swingEvidence:{status:'not_applicable'}};
  const wall=walls.get(opening.wallId),dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y;
  let start=opening.start,end=opening.end;if((end.x-start.x)*dx+(end.y-start.y)*dy<0)[start,end]=[end,start];
  const measured=inspectRasterDoorSymbol({...opening,start,end},evidence),mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2},length=distance(start,end),n={x:-(end.y-start.y)/length,y:(end.x-start.x)/length};
  const adjacent=(trace.rooms||[]).filter(r=>[-1,1].some(side=>inside({x:mid.x+n.x*length*.15*side,y:mid.y+n.y*length*.15*side},r.polygon)));
  const roomDirections=measured.status==='observed'?adjacent.map(r=>({roomId:r.id,direction:inside(measured.sectorPoint,r.polygon)?'inward':'outward'})):[];
  return{...opening,start,end,hingeSide:measured.hingeSide,swingDirection:measured.swingDirection,swingEvidence:measured,roomDirections,exteriorSwing:measured.status==='observed'&&!inside(measured.sectorPoint,trace.footprint)?'outward':measured.status==='observed'?'inward':'unknown'};
 });
}
