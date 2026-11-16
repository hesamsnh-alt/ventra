import {pdfFurnitureClear} from './pdfFurnitureLayout.mjs';
import {placementProblem} from './scenePromptActions.mjs';
import {furnitureOverlaps} from './interiorPresentation.mjs';

const RUN_DEPTH=.62, WORK_AISLE=1.07;
const dist=(a,b)=>Math.hypot(a.xMeters-b.xMeters,a.yMeters-b.yMeters);
const local=(a,x,y)=>{const t=(a.rotation||0)*Math.PI/180;return {
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
  const wallInset=Math.max(.18,(scene.externalWallThickness||.2)/2+.05);
  return merged.map(([from,to])=>({index,from,to,supports(counter){
   const center={x:counter.xMeters,y:counter.yMeters};
   const rotation=(counter.rotation||0)*Math.PI/180;
   const t=along(center),rear=offset(center)-counter.depth/2;
   return Math.abs(ux*Math.cos(rotation)+uy*Math.sin(rotation))>=.98 &&
    rear>=-.08&&rear<=wallInset+.18&&t>=from-.3&&t<=to+.3;
  },pose(t,depth){
   const inset=depth/2+wallInset;
   return {xMeters:a.x+ux*t+nx*inset,yMeters:a.y+uy*t+ny*inset,rotation:Math.atan2(ny,nx)*180/Math.PI+90};
  }}));
 }).sort((a,b)=>(b.to-b.from)-(a.to-a.from));
}
const front=a=>({...a,...local(a,0,-a.depth/2)});
function spacing(a,b){
 const d=dist(front(a),front(b));
 return d<1.22?4+(1.22-d)*8:d>2.74?4+(d-2.74)*2:Math.abs(d-1.9);
}

function containsFixture(counter,fixture){
 const rotation=(counter.rotation||0)*Math.PI/180,c=Math.cos(rotation),s=Math.sin(rotation);
 return [-1,1].every(x=>[-1,1].every(y=>{
  const p=local(fixture,x*fixture.width/2,y*fixture.depth/2);
  const dx=p.xMeters-counter.xMeters,dy=p.yMeters-counter.yMeters;
  return Math.abs(dx*c+dy*s)<=counter.width/2+.015&&Math.abs(-dx*s+dy*c)<=counter.depth/2+.015;
 }));
}

export function proposeKitchen(scene,room,{suppressed=[],laundry=true}={}){
 const added=[],replaced=new Map(),runs=wallRuns(room,scene);
 const assets=()=>[...scene.assets.map(a=>replaced.get(a.id)||a),...added];
 const own=()=>assets().filter(a=>a.roomId===room.id);
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
 const fits=(asset,omit=[])=>!placementProblem(asset,{...scene,assets:assets().filter(a=>!omit.includes(a.id))});
 const add=asset=>{added.push(asset);return asset;};
 const counters=()=>own().filter(a=>a.type==='kitchen_counter'&&!a.worktopOnly&&runs.some(run=>run.supports(a)));
 const observed=asset=>asset?.placementSource==='source_image_observation_v1'&&!asset.userPlaced&&!asset.customModelId;
 const worktopFor=asset=>own().find(a=>['kitchen_counter','kitchen_island'].includes(a.type)&&!a.worktopOnly&&containsFixture(a,asset));
 const attachObserved=asset=>{
  if(!observed(asset)||asset.embeddedInCounter&&asset.layoutAnchorId)return asset;
  const worktop=worktopFor(asset);
  if(!worktop)return asset;
  const attached={...asset,embeddedInCounter:true,layoutAnchorId:worktop.id};
  replaced.set(asset.id,attached);
  return attached;
 };
 const detachedObservation=asset=>observed(asset)&&!(asset.embeddedInCounter&&asset.layoutAnchorId);
 const install=(candidate,previous,reason='attached_to_kitchen_worktop')=>{
  if(!previous)return add(candidate);
  const repaired={...previous,...candidate,id:previous.id,sourceAdjustment:{reason}};
  replaced.set(previous.id,repaired);
  return repaired;
 };
 const counterSides=new Set(runs.filter(run=>counters().some(a=>run.supports(a))).map(run=>run.index));
 const sourceWasher=existing('washing_machine');
 const moveWasher=observed(sourceWasher)&&!sourceWasher.underCounter&&!worktopFor(sourceWasher);
 let integratedLaundry=null;
 for(const run of runs){
  if(counterSides.has(run.index)||counterSides.size>=3||!allowed('kitchen_counter'))continue;
  const canFitWasher=laundry&&!integratedLaundry&&(!sourceWasher||moveWasher)&&allowed('washing_machine')&&run.to-run.from>=2.25&&scene.assets.length+added.length<=297;
  runAttempt:for(const installWasher of (canFitWasher?[true,false]:[false])){
   const slot=installWasher ? .72 : 0;
   for(const w of [Math.min(4.8,run.to-run.from-slot),2.4,1.8,1.2]){
    const spare=run.to-run.from-slot-w;
    if(w<1.15||spare<-.001)continue;
    for(const bias of [0,-.45,.45])for(const side of (installWasher?[1,-1]:[1])){
     const t=(run.from+run.to-side*slot)/2+bias*spare;
     const candidate=item('kitchen_counter',w,RUN_DEPTH,.92,run.pose(t,RUN_DEPTH),{variant:'kitchen-base',fittedKitchen:true});
     if(!fits(candidate))continue;
     if(installWasher){
      const pose=run.pose(t+side*(w+slot)/2,.57);
      const washer=item('washing_machine',.61,.57,.86,pose,{underCounter:true});
      if(!fits(washer,[sourceWasher?.id]))continue;
      integratedLaundry=washer;
     }
     add(candidate);counterSides.add(run.index);
     if(installWasher){
      const washer=install(integratedLaundry,sourceWasher,'placed_under_kitchen_worktop');
      const {xMeters,yMeters,rotation}=washer;
      add(item('kitchen_counter',.62,.59,.06,{xMeters,yMeters,rotation},
       {zMeters:.86,worktopOnly:true,fittedKitchen:true,layoutAnchorId:washer.id}));
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
 let sink=attachObserved(existing('sink'));
 if((!sink||detachedObservation(sink))&&allowed('sink')){
  for(const c of counters()){
   const a=fixture(c,'sink',0);
   if(a&&fits(a,[c.id,sink?.id])){sink=install(a,sink);break;}
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
 let stove=attachObserved(existing('stove'));
 if((!stove||detachedObservation(stove))&&allowed('stove')){
  const choices=counters().flatMap(c=>[0,1.35,-1.35,.85,-.85,.7,-.7].flatMap(shift=>{
   const a=fixture(c,'stove',shift);
   if(!a||sink&&dist(a,sink)<.7||!fits(a,[c.id,stove?.id]))return [];
   const score=(sink?spacing(a,sink):0)+(fridges.length?Math.min(...fridges.map(f=>fridgeScore(f,a))):0);
   return [{a,score}];
  })).sort((a,b)=>a.score-b.score);
  if(choices.length)stove=install(choices[0].a,stove);
 }
 if(stove&&!existing('range_hood')&&allowed('range_hood')&&scene.height>=2.4){
  const fitted=!!stove.embeddedInCounter;
  const h=item('range_hood',Math.max(.6,stove.width),.46,fitted?.11:.45,
   {xMeters:stove.xMeters,yMeters:stove.yMeters,rotation:stove.rotation},
   {zMeters:fitted?1.63:1.95,mountedAboveId:stove.id,fittedKitchen:fitted});
  if(fits(h)&&pdfFurnitureClear(h,scene))add(h);
 }
 if(!sourceFridge&&allowed('refrigerator')&&fridges.length){
  const fridge=fridges.sort((a,b)=>fridgeScore(a,stove)-fridgeScore(b,stove)).find(a=>fits(a));
  if(fridge)add({...fridge,id:idFor('refrigerator')});
 }
 const worktops=counters();
 const fridge=existing('refrigerator');
 if(fridge&&scene.height>=2.34&&allowed('cabinet')&&!own().some(a=>a.variant==='kitchen-tall')){
  for(const side of [-1,1]){
   const pose={...local(fridge,side*(fridge.width/2+.34),((fridge.depth||.7)-.62)/2),rotation:fridge.rotation||0};
   const tall=item('cabinet',.62,.62,Math.min(scene.height-.12,2.58),pose,{variant:'kitchen-tall',fittedKitchen:true});
   if(runs.some(run=>run.supports(tall))&&fits(tall)&&pdfFurnitureClear(tall,scene)){add(tall);break;}
  }
 }
 if(scene.height>=2.25)for(const c of worktops){
  if(c.variant==='l-shape'||!Number.isFinite(c.width)||!Number.isFinite(c.depth)||c.depth<.33)continue;
  const count=Math.max(1,Math.ceil(c.width/1.16)),w=c.width/count-.035;
  let lit=false;
  for(let i=0;i<count&&allowed('cabinet');i++){
   const pose={...local(c,(i+.5)*c.width/count-c.width/2,(c.depth-.33)/2),rotation:c.rotation||0};
   const hood=existing('range_hood'),overHood=hood?.fittedKitchen&&furnitureOverlaps({...pose,width:w,depth:.33},hood,scene,.02);
   const baseLevel=overHood?hood.zMeters+hood.height+.01:1.63;
   const upperHeight=Math.min(2.70,scene.height-.10)-baseLevel;
   const a=item('cabinet',w,.33,upperHeight,pose,
    {variant:'kitchen-upper',zMeters:baseLevel,layoutAnchorId:c.id,fittedKitchen:true,
     backsplashHeight:Math.max(0,baseLevel-c.height-(c.zMeters||0)),underCabinetLight:!lit&&!overHood,displayShelves:count>=4&&i===0&&!overHood});
   if(w>=.45&&upperHeight>=.50&&fits(a)&&pdfFurnitureClear(a,scene)){
    add(a);
    lit ||= a.underCabinetLight;
   }
  }
 }
 const island=existing('kitchen_island');
 if((island||allowed('kitchen_island'))&&worktops.length){
  const xs=room.polygon.map(p=>p.x),ys=room.polygon.map(p=>p.y);
  const triangle=[sink,stove,existing('refrigerator')].filter(Boolean).map(front);
  const paths=triangle.length===3?triangle.map((a,i)=>{
   const b=triangle[(i+1)%3],length=dist(a,b);
   return {xMeters:(a.xMeters+b.xMeters)/2,yMeters:(a.yMeters+b.yMeters)/2,width:length,depth:.05,
    rotation:Math.atan2(b.yMeters-a.yMeters,b.xMeters-a.xMeters)*180/Math.PI};
  }):[];
  const placeSeats=a=>{
   const seatStart=added.length;
   if(own().some(seat=>seat.type==='chair'&&(seat.groupId===a.id||seat.layoutAnchorId===a.id)))return true;
   for(const sign of [1,-1]){
    for(const x of (a.width>=1.75?[-.56,0,.56]:[-.34,.34])){
     if(!allowed('chair'))break;
     const chair=item('chair',.44,.46,1.1,{...local(a,x,sign*(a.depth/2+.36)),rotation:(a.rotation||0)+(sign>0?180:0)},
      {variant:'bar-stool',layoutAnchorId:a.id,groupId:a.id});
     const passage={...chair,...local(a,x,sign*(a.depth/2+.36+.455)),depth:chair.depth+.91};
     if(fits(chair)&&fits(passage,added.slice(seatStart).map(seat=>seat.id))&&
       paths.every(path=>!furnitureOverlaps(chair,path,scene,.1)))add(chair);
    }
    if(added.length>seatStart){
     if(added.includes(a))a.seatingSide=sign;
     break;
    }
   }
   return added.length>seatStart;
  };
  if(island){
   placeSeats(island);
  }else{
   islandSearch:for(const fx of [.5,.57,.43,.65,.35])for(const fy of [.5,.57,.43,.65,.35])for(const rotation of [worktops[0].rotation,worktops[0].rotation+90]){
    const a=item('kitchen_island',2.12,1.02,.92,{xMeters:Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*fx,
     yMeters:Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*fy,rotation},{fittedKitchen:true,pendantCeiling:scene.height});
    if(!fits({...a,width:a.width+2*WORK_AISLE,depth:a.depth+2*WORK_AISLE})||
     paths.some(path=>furnitureOverlaps(a,path,scene,0)))continue;
    add(a);
    if(placeSeats(a)||suppressed.includes(room.id+':chair'))break islandSearch;
    added.pop();
   }
  }
 }
 const islandId=existing('kitchen_island')?.id;
 const hasSeatedIsland=!!islandId&&own().some(a=>a.type==='chair'&&(a.layoutAnchorId===islandId||a.groupId===islandId));
 return {added,replaced,hasSeatedIsland};
}
