import {createWalkWorld,walkPositionAllowed,walkSpawn,WALK_RADIUS} from './walkthrough.mjs';
export const DEFAULT_VR_SETTINGS=Object.freeze({profile:'quest2',movement:true,speed:.9,snapDegrees:30,showBoundary:true,boundary:null});
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)-1e-8&&p.x<=Math.max(a.x,b.x)+1e-8&&p.y>=Math.min(a.y,b.y)-1e-8&&p.y<=Math.max(a.y,b.y)+1e-8;
const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
export function resolveVRSettings(scene,input={}){
 const options={...DEFAULT_VR_SETTINGS,...input};
 if(!['quest2','quest3'].includes(options.profile)||typeof options.movement!=='boolean'||typeof options.showBoundary!=='boolean'||!Number.isFinite(options.speed)||options.speed<.2||options.speed>1.5||![15,30,45,90].includes(options.snapDegrees))throw Error('Invalid VR movement settings. / تنظیمات حرکت VR معتبر نیست.');
 const base=createWalkWorld(scene);let world=base;
 if(options.boundary!==null){
  const p=options.boundary;if(!Array.isArray(p)||p.length<3||p.length>32||p.some(v=>!Number.isFinite(v?.x)||!Number.isFinite(v?.y)))throw Error('Set 3–32 boundary points. / مرز باید ۳ تا ۳۲ نقطه داشته باشد.');
  const area=Math.abs(p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0))/2;
  if(area<.5)throw Error('VR boundary is too small. / محدودهٔ VR خیلی کوچک است.');
  for(let i=0;i<p.length;i++){
   const a=p[i],b=p[(i+1)%p.length];if(Math.hypot(a.x-b.x,a.y-b.y)<.05)throw Error('Boundary points are too close. / نقاط مرز خیلی نزدیک‌اند.');
   for(let j=i+1;j<p.length;j++){if(j===i+1||i===0&&j===p.length-1)continue;if(intersects(a,b,p[j],p[(j+1)%p.length]))throw Error('Boundary edges cross. / خطوط مرز همدیگر را قطع می‌کنند.');}
   // A navigation boundary must stay within the floor, including concave edges.
   const floor={...base,walls:[],obstacles:[]};if(!walkPositionAllowed(floor,a,0)||!walkPositionAllowed(floor,b,0))throw Error('Keep boundary points inside the floor. / نقاط مرز باید داخل کف باشند.');
   for(const outline of [...(base.footprint?[base.footprint]:[]),...base.holes])if(outline.some((c,j)=>intersects(a,b,c,outline[(j+1)%outline.length])))throw Error('Boundary crosses a floor edge or void. / مرز از لبهٔ کف یا فضای خالی عبور می‌کند.');
   const steps=Math.min(2048,Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.04)));for(let n=0;n<=steps;n++){
    const t=n/steps,q={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    if(!walkPositionAllowed(floor,q,0))throw Error('Keep the boundary inside the floor and away from voids. / مرز را داخل کف و دور از فضای خالی رسم کن.');
   }
  }
  // Interior voids remain protected by the original collision world.
  world={...base,footprint:p.map(v=>({x:v.x,y:v.y}))};
 }
 const spawn=walkSpawn(world);return {options:{...options,boundary:options.boundary?.map(v=>({...v}))||null},world,spawn};
}
export function vrBoundaryPoints(world){return world.footprint||world.rooms.flatMap(r=>r.polygon);}
export function vrBoundaryNear(world,point,distance=.45){
 if(!walkPositionAllowed({...world,walls:[],obstacles:[]},point,0))return true;
 const polygons=world.footprint?[world.footprint]:world.rooms.map(r=>r.polygon);
 return polygons.some(p=>p.some((a,i)=>{const b=p[(i+1)%p.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy)<Math.max(WALK_RADIUS,distance);}));
}
