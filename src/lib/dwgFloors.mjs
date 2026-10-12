import {applyDesignDefaults} from './designDefaults.mjs';
// XY-separated drawing regions are candidates, never evidence of storey order.
export function splitDwgRegions(lines,factor){
 if(!Number.isFinite(factor)||factor<=0)throw new Error('Confirmed DWG scale is required.');
 const valid=(lines||[]).filter(l=>[l.start?.x,l.start?.y,l.end?.x,l.end?.y].every(Number.isFinite));
 const bounds=(ls,axis)=>({min:Math.min(...ls.flatMap(l=>[l.start[axis],l.end[axis]])),max:Math.max(...ls.flatMap(l=>[l.start[axis],l.end[axis]]))});
 function split(ls,depth=0){
  if(ls.length<8||depth>=5)return [ls];
  let best=null;
  for(const axis of ['x','y']){
   const sorted=[...ls].sort((a,b)=>Math.min(a.start[axis],a.end[axis])-Math.min(b.start[axis],b.end[axis]));
   let edge=-Infinity;
   for(let i=0;i<sorted.length-1;i++){
    edge=Math.max(edge,sorted[i].start[axis],sorted[i].end[axis]);
    const gap=(Math.min(sorted[i+1].start[axis],sorted[i+1].end[axis])-edge)*factor;
    if(i>=3&&sorted.length-i-1>=4&&gap>=1.25&&(!best||gap>best.gap))best={sorted,index:i+1,gap};
   }
  }
  return best?[...split(best.sorted.slice(0,best.index),depth+1),...split(best.sorted.slice(best.index),depth+1)]:[ls];
 }
 if(!valid.length)return [];
 return split(valid).map((ls,index)=>({index,lines:ls,axis:'region',splitGapMeters:0,x:bounds(ls,'x'),y:bounds(ls,'y')}));
}
export function dwgRoomScene({geometry,frame,factor,wallPieces=[],doors=[],roomUses={}}){
 if(!Number.isFinite(factor)||factor<=0||![frame?.minX,frame?.maxX,frame?.minY,frame?.maxY,frame?.widthMeters,frame?.depthMeters].every(Number.isFinite)||frame.widthMeters<=0||frame.depthMeters<=0)throw new Error("Valid calibrated floor bounds are required.");
 const width=frame.widthMeters,depth=frame.depthMeters;
 // Extractor room points are already metres; walls/frame remain model units.
 const minX=frame.minX*factor,minY=frame.minY*factor;
 const rooms=(geometry.roomPolygons||[]).flatMap((r,i)=>{
  const ps=r.points||r.polygon||[];
  if(ps.length<3||!ps.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=minX-.02&&p.x<=frame.maxX*factor+.02&&p.y>=minY-.02&&p.y<=frame.maxY*factor+.02))return [];
  const id=String(r.id||`room-${i+1}`);
  return [{id,name:r.name||id,type:roomUses[id]||r.semanticType||r.type||r.name,polygon:ps.map(p=>({x:p.x-minX,y:p.y-minY}))}];
 });
 const walls=wallPieces.map((w,i)=>({id:`dwg-wall-${i}`,start:{x:w.start.x+width/2,y:w.start.y+depth/2},end:{x:w.end.x+width/2,y:w.end.y+depth/2},thickness:.15}));
 // Clearance blockers use the verified snapped door positions, even when wall cuts split a wall.
 for(const [i,d] of doors.entries())if(d.wallPosition)walls.push({id:`clearance-${i}`,start:{x:d.wallPosition.x+width/2-.01,y:d.wallPosition.y+depth/2},end:{x:d.wallPosition.x+width/2+.01,y:d.wallPosition.y+depth/2},thickness:Math.max(1.6,Number(d.width)*2||1.6)});
 return applyDesignDefaults({width,depth,height:3.2,walls,rooms,assets:[],openings:[]});
}
