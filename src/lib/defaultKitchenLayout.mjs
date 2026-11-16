import {pdfFurnitureClear} from './pdfFurnitureLayout.mjs';
import {placementProblem} from './scenePromptActions.mjs';
import {furnitureOverlaps} from './interiorPresentation.mjs';

const RUN_DEPTH=.62, WORK_AISLE=1.07;
const dist=(a,b)=>Math.hypot(a.xMeters-b.xMeters,a.yMeters-b.yMeters);
const local=(a,x,y)=>{const t=a.rotation*Math.PI/180;return {
 xMeters:a.xMeters+x*Math.cos(t)-y*Math.sin(t),yMeters:a.yMeters+x*Math.sin(t)+y*Math.cos(t),
};};
const boundaryEdges=points=>(points||[]).map((start,i)=>({start,end:points[(i+1)%points.length]}));
function wallRuns(room,scene){
 const perimeter=boundaryEdges(scene.footprint);
 const support=[...scene.walls.filter(w=>!['glass','railing'].includes(w.type)),...perimeter];
 return boundaryEdges(room.polygon).flatMap(({start:a,end:b},index)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(length<1.55)return [];
  const ux=dx/length,uy=dy/length;
  const signed=room.polygon.reduce((sum,p,i,poly)=>sum+p.x*poly[(i+1)%poly.length].y-poly[(i+1)%poly.length].x*p.y,0);
  const nx=-uy*Math.sign(signed),ny=ux*Math.sign(signed);
  const along=p=>(p.x-a.x)*ux+(p.y-a.y)*uy;
  const offset=p=>(p.x-a.x)*nx+(p.y-a.y)*ny;
  const ranges=support.flatMap(w=>{
   if(!w.start||!w.end||Math.abs(offset(w.start))>.25||Math.abs(offset(w.end))>.25)return [];
   const [lo,hi]=[along(w.start),along(w.end)].sort((x,y)=>x-y);
   const from=Math.max(.74,lo+.04),to=Math.min(length-.74,hi-.04);
   return to-from>=.65?[[from,to]]:[];
  }).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const range of ranges){
   const last=merged.at(-1);
   if(last&&range[0]<=last[1]+.05)last[1]=Math.max(last[1],range[1]);else merged.push(range);
  }
  return merged.map(([from,to])=>({index,from,to,pose(t,depth){
   const inset=depth/2+Math.max(.18,(scene.externalWallThickness||.2)/2+.05);
   return {xMeters:a.x+ux*t+nx*inset,yMeters:a.y+uy*t+ny*inset,rotation:Math.atan2(ny,nx)*180/Math.PI+90};
  }}));
 }).sort((a,b)=>(b.to-b.from)-(a.to-a.from));
}
const front=a=>({...a,...local(a,0,-a.depth/2)});
function spacing(a,b){
 const d=dist(front(a),front(b));
 return d<1.22?4+(1.22-d)*8:d>2.74?4+(d-2.74)*2:Math.abs(d-1.9);
}

export function proposeKitchen(scene,room,{suppressed=[],laundry=true}={}){
 const added=[],runs=wallRuns(room,scene),own=()=>[...scene.assets,...added].filter(a=>a.roomId===room.id);
 const existing=type=>own().find(a=>a.type===type);
 const allowed=type=>!suppressed.includes(room.id+':'+type)&&scene.assets.length+added.length<300;
 const idFor=type=>{
  let index=added.length,id;
  do{id=`default_${room.id}_kitchen_layout_${type}_${index++}`;}while(own().some(a=>a.id===id));
  return id;
 };
 const item=(type,width,depth,height,pose,extra={})=>({
  id:idFor(type),roomId:room.id,type,width,depth,height,...pose,
  placementSource:'design_default_not_measured',provenance:'proposed',excludeFromTakeoff:true,...extra,
 });
 const fits=(asset,omit=[])=>!placementProblem(asset,{...scene,assets:[...scene.assets,...added].filter(a=>!omit.includes(a.id))});
 const add=asset=>{added.push(asset);return asset;};
 const counters=()=>own().filter(a=>a.type==='kitchen_counter'&&!a.worktopOnly);
 const counterSides=new Set();
 let integratedLaundry=null;
 if(!existing('kitchen_counter')&&allowed('kitchen_counter'))for(const run of runs){
  if(counterSides.has(run.index)||counterSides.size===3||!allowed('kitchen_counter'))continue;
  const canFitWasher=laundry&&!existing('washing_machine')&&allowed('washing_machine')&&run.to-run.from>=2.25&&scene.assets.length+added.length<=297;
  runAttempt:for(const installWasher of (canFitWasher?[true,false]:[false])){
   const slot=installWasher ? .72 : 0;
   for(const w of [Math.min(3.65,run.to-run.from-slot),2.4,1.8,1.2]){
    const spare=run.to-run.from-slot-w;
    if(w<1.15||spare<-.001)continue;
    for(const bias of [0,-.45,.45])for(const side of (installWasher?[1,-1]:[1])){
     const t=(run.from+run.to-side*slot)/2+bias*spare;
     const candidate=item('kitchen_counter',w,RUN_DEPTH,.92,run.pose(t,RUN_DEPTH),{variant:'kitchen-base'});
     if(!fits(candidate))continue;
     if(installWasher){
      const pose=run.pose(t+side*(w+slot)/2,.57);
      const washer=item('washing_machine',.61,.57,.86,pose,{underCounter:true});
      if(!fits(washer))continue;
      integratedLaundry=washer;
     }
     add(candidate);counterSides.add(run.index);
     if(integratedLaundry&&!added.includes(integratedLaundry)){
      add(integratedLaundry);
      const {xMeters,yMeters,rotation}=integratedLaundry;
      add(item('kitchen_counter',.62,.59,.06,{xMeters,yMeters,rotation},
       {zMeters:.86,worktopOnly:true,layoutAnchorId:integratedLaundry.id}));
     }
     break runAttempt;
    }
   }
  }
 }
 const fixture=(counter,type,shift)=>{
  const w=type==='sink'?.64:.6,d=type==='sink'?.45:.49;
  if(counter.depth<d+.05||Math.abs(shift)+w/2>counter.width/2-.04)return null;
  return item(type,w,d,type==='sink'?.85:.9,
   {...local(counter,shift,0),rotation:counter.rotation},{embeddedInCounter:true,layoutAnchorId:counter.id});
 };
 let sink=existing('sink');
 if(!sink&&allowed('sink')){
  for(const c of counters()){
   const a=fixture(c,'sink',0);
   if(a&&fits(a,[c.id])){sink=add(a);break;}
  }
 }
 const sourceFridge=existing('refrigerator');
 const fridges=sourceFridge?[sourceFridge]:allowed('refrigerator')?runs.flatMap(run=>Array.from({length:11},(_,i)=>{
  const t=run.from+.35+(run.to-run.from-.7)*i/10;
  return item('refrigerator',.7,.7,1.85,run.pose(t,.7));
 })).filter(a=>fits(a)&&pdfFurnitureClear(a,scene)):[];
 const fridgeScore=(fridge,cooker)=>{
  const score=[sink,cooker].filter(Boolean).reduce((sum,a)=>sum+spacing(fridge,a),0);
  if(!sink||!cooker)return score;
  const [a,b,c]=[sink,cooker,fridge].map(front);
  const area=Math.abs((b.xMeters-a.xMeters)*(c.yMeters-a.yMeters)-(b.yMeters-a.yMeters)*(c.xMeters-a.xMeters))/2;
  return score+Math.max(0,.45-area)*3+Math.max(0,dist(a,b)+dist(b,c)+dist(a,c)-7.92);
 };
 let stove=existing('stove');
 if(!stove&&allowed('stove')){
  const choices=counters().flatMap(c=>[0,1.35,-1.35,.85,-.85,.7,-.7].flatMap(shift=>{
   const a=fixture(c,'stove',shift);
   if(!a||sink&&dist(a,sink)<.7||!fits(a,[c.id]))return [];
   const score=(sink?spacing(a,sink):0)+(fridges.length?Math.min(...fridges.map(f=>fridgeScore(f,a))):0);
   return [{a,score}];
  })).sort((a,b)=>a.score-b.score);
  if(choices.length)stove=add(choices[0].a);
 }
 if(stove&&!existing('range_hood')&&allowed('range_hood')&&scene.height>=2.4){
  const h=item('range_hood',Math.max(.6,stove.width),.46,.45,
   {xMeters:stove.xMeters,yMeters:stove.yMeters,rotation:stove.rotation},{zMeters:1.95,mountedAboveId:stove.id});
  if(fits(h)&&pdfFurnitureClear(h,scene))add(h);
 }
 if(!sourceFridge&&allowed('refrigerator')&&fridges.length){
  const fridge=fridges.sort((a,b)=>fridgeScore(a,stove)-fridgeScore(b,stove)).find(a=>fits(a));
  if(fridge)add({...fridge,id:idFor('refrigerator')});
 }
 const worktops=counters();
 if(scene.height>=2.25)for(const c of worktops){
  if(c.variant==='l-shape'||!Number.isFinite(c.width)||!Number.isFinite(c.depth)||c.depth<.33)continue;
  const count=Math.max(1,Math.ceil(c.width/1.16)),w=c.width/count-.06;
  for(let i=0;i<count&&allowed('cabinet');i++){
   const a=item('cabinet',w,.33,.72,{...local(c,(i+.5)*c.width/count-c.width/2,(c.depth-.33)/2),rotation:c.rotation},
    {variant:'kitchen-upper',zMeters:1.5,layoutAnchorId:c.id});
   if(w>=.45&&fits(a)&&pdfFurnitureClear(a,scene))add(a);
  }
 }
 if(!existing('kitchen_island')&&allowed('kitchen_island')&&worktops.length){
  const xs=room.polygon.map(p=>p.x),ys=room.polygon.map(p=>p.y);
  const triangle=[sink,stove,existing('refrigerator')].filter(Boolean).map(front);
  const paths=triangle.length===3?triangle.map((a,i)=>{
   const b=triangle[(i+1)%3],length=dist(a,b);
   return {xMeters:(a.xMeters+b.xMeters)/2,yMeters:(a.yMeters+b.yMeters)/2,width:length,depth:.05,
    rotation:Math.atan2(b.yMeters-a.yMeters,b.xMeters-a.xMeters)*180/Math.PI};
  }):[];
  island:for(const fx of [.5,.57,.43,.65,.35])for(const fy of [.5,.57,.43,.65,.35])for(const rotation of [worktops[0].rotation,worktops[0].rotation+90]){
   const a=item('kitchen_island',1.8,.86,.92,{xMeters:Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*fx,
    yMeters:Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*fy,rotation});
   if(!fits({...a,width:a.width+2*WORK_AISLE,depth:a.depth+2*WORK_AISLE})||
    paths.some(path=>furnitureOverlaps(a,path,scene,0)))continue;
   add(a);
   const seatStart=added.length;
   const seatRequired=!suppressed.includes(room.id+':chair');
   if(allowed('chair'))for(const sign of [1,-1])for(const x of [-.45,.45]){
    if(!allowed('chair'))break;
    const chair=item('chair',.44,.46,1.1,{...local(a,x,sign*(a.depth/2+.36)),rotation:a.rotation+(sign>0?180:0)},
     {variant:'bar-stool',layoutAnchorId:a.id,groupId:a.id});
    const passage={...chair,...local(a,x,sign*(a.depth/2+.36+.455)),depth:chair.depth+.91};
    if(fits(chair)&&fits(passage,added.slice(seatStart).map(seat=>seat.id))&&
      paths.every(path=>!furnitureOverlaps(chair,path,scene,.1)))add(chair);
   }
   if(seatRequired&&added.length===seatStart){added.pop();continue;}
   break island;
  }
 }
 return {added,hasSeatedIsland:added.some(a=>a.variant==='bar-stool')};
}
