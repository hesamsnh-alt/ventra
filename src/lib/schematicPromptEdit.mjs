import {furnitureOverlaps} from './interiorPresentation.mjs';

const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const reject=message=>{const error=new Error(message);error.code='PROMPT_PLACEMENT_REJECTED';throw error;};
const metric=a=>Number.isFinite(a?.xMeters)&&Number.isFinite(a?.yMeters);
const samples=a=>{const r=(a.rotation||0)*Math.PI/180;return [-1,0,1].flatMap(x=>[-1,0,1].map(y=>({x:a.xMeters+x*a.width/2*Math.cos(r)-y*a.depth/2*Math.sin(r),y:a.yMeters+x*a.width/2*Math.sin(r)+y*a.depth/2*Math.cos(r)})));};

// Furniture-only relative edit. Ambiguous references and insufficient space
// fail without mutating the source architecture or the previous scene.
export function editDiningPrompt(scene,prompt){
 const text=String(prompt).toLowerCase();
 if(!/(dining\s*table|میز\s*(ناهار|نهار|غذا)|طاولة\s*(الطعام|طعام))/u.test(text))return null;
 if(!/(front\s*of|in\s*front|جلوی|جلو|أمام|امام)/u.test(text)||!/(cabinet|counter|کابینت|خزانة|خزائن)/u.test(text))reject('Specify the dining table and cabinet to move it in front of. / محل میز و کابینت را مشخص کنید.');
 const next=structuredClone(scene),assets=next.assets||[];
 const anchors=assets.filter(a=>['cabinet','kitchen_counter'].includes(a.type)&&metric(a));
 if(anchors.length!==1)reject('Cabinet reference is missing or ambiguous. / کابینت مرجع مشخص نیست یا چند کابینت وجود دارد.');
 const anchor=anchors[0],tables=assets.filter(a=>a.type==='dining_table');
 if(tables.length>1)reject('There is more than one dining table. / بیش از یک میز ناهارخوری وجود دارد.');
 const table=tables[0]||{id:'prompt-dining-table',type:'dining_table',width:1.8,depth:.95,height:.76};
 const room=(next.rooms||[]).find(r=>r.id===anchor.roomId);
 const allowedRooms=(next.rooms||[]).filter(r=>r.id===anchor.roomId||['living','dining','kitchen','living_dining'].includes(r.semanticType||r.type));
 if(!room?.polygon?.length)reject('A calibrated room is required for this move. / هندسه متری اتاق برای جابه‌جایی لازم است.');
 const rotation=Number(anchor.rotation)||0,r=rotation*Math.PI/180;
 let candidate;
 // The observed counter front is local -Y (source furniture convention).
 const options=[];
 const walls=(next.walls||[]).map(w=>({xMeters:(w.start.x+w.end.x)/2,yMeters:(w.start.y+w.end.y)/2,width:Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y),depth:Number(w.thickness)||.12,rotation:Math.atan2(w.end.y-w.start.y,w.end.x-w.start.x)*180/Math.PI}));
 for(const turn of [0,90])for(const gap of [.6,.75,.9,1.05,1.2,1.4])for(const slide of [0,-.3,.3,-.6,.6,-.9,.9,-1.2,1.2]){
  const facingDepth=Number(turn===0?table.depth:table.width);
  const offset=Number(anchor.depth)/2+facingDepth/2+gap;
  // Keep the table abreast of the cabinet, rather than moving it anywhere.
  if(Math.abs(slide)>Number(anchor.width)/2+Number(table.width)/2)continue;
  const c={...table,rotation:rotation+turn,xMeters:anchor.xMeters+Math.sin(r)*offset+Math.cos(r)*slide,yMeters:anchor.yMeters-Math.cos(r)*offset+Math.sin(r)*slide,placementSource:'user_prompt',userPlaced:true};
  const targetRoom=allowedRooms.find(target=>target.polygon?.length&&samples(c).every(p=>inside(p,target.polygon)));
  if(!targetRoom)continue;
  c.roomId=targetRoom.id;
  if(assets.some(a=>a!==table&&a.type!=='rug'&&furnitureOverlaps(c,a,next,.08)))continue;
  if(walls.some(w=>furnitureOverlaps(c,w,next,.08)))continue;
  // Do not jump across a partition to a different room. Check the clear
  // connection from the counter's front edge to the proposed table centre.
  const start={x:anchor.xMeters+Math.sin(r)*(Number(anchor.depth)/2+.06),y:anchor.yMeters-Math.cos(r)*(Number(anchor.depth)/2+.06)};
  const path={xMeters:(start.x+c.xMeters)/2,yMeters:(start.y+c.yMeters)/2,width:Math.hypot(c.xMeters-start.x,c.yMeters-start.y),depth:.12,rotation:Math.atan2(c.yMeters-start.y,c.xMeters-start.x)*180/Math.PI};
  if(walls.some(w=>furnitureOverlaps(path,w,next,0)))continue;
  const doors=(next.openings||[]).filter(o=>o.type==='door').map(o=>{
   const w=(next.walls||[]).find(w=>w.id===o.wallId);if(!w)return null;
   return {xMeters:w.start.x+(w.end.x-w.start.x)*o.offset,yMeters:w.start.y+(w.end.y-w.start.y)*o.offset,width:Math.max(.9,Number(o.width)||.9)*2,depth:Math.max(.9,Number(o.width)||.9)*2,rotation:0};
  }).filter(Boolean);
  if(doors.some(d=>furnitureOverlaps(c,d,next,0)))continue;
  options.push({candidate:c,score:Math.abs(slide)+gap+turn/180});
 }
 options.sort((a,b)=>a.score-b.score);candidate=options[0]?.candidate;
 if(!candidate)reject('No clear space in front of this cabinet; the scene was kept unchanged. / فضای آزاد کافی جلوی کابینت نیست؛ مدل تغییر نکرد.');
 next.assets=tables.length?assets.map(a=>a===table?candidate:a):[...assets,candidate];
 next.updatedAt=new Date().toISOString();
 return next;
}
