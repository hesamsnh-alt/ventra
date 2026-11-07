import {at,dist,nearest,inside} from './geometry.mjs';
export function openingProblem(doc,e,{overlap=true}={}){
 const wall=doc.entities.find(w=>w.id===e.wall&&w.role==='wall'&&w.type==='line');
 if(!wall||!Number.isFinite(e.offset)||e.offset<0||e.offset>1||![e.width,e.height].every(n=>Number.isFinite(n)&&n>0)||!['door','window','arched'].includes(e.kind))return 'Invalid wall opening. / اطلاعات بازشو معتبر نیست.';
 if(e.hinge!==undefined&&!['left','right'].includes(e.hinge)||e.swing!==undefined&&![1,-1].includes(e.swing)||e.openAngle!==undefined&&(!Number.isFinite(e.openAngle)||e.openAngle<0||e.openAngle>180))return 'Invalid opening direction. / جهت بازشو معتبر نیست.';
 const length=dist(wall.a,wall.b),z=e.z??0;
 if(!Number.isFinite(z)||z<0||e.offset*length<e.width/2-1e-8||(1-e.offset)*length<e.width/2-1e-8||e.height+z>wall.height+1e-8||e.kind==='arched'&&e.width/2>e.height)return 'Opening does not fit inside the wall. / ابعاد یا محل بازشو داخل دیوار جا نمی‌شود.';
 if(overlap&&doc.entities.some(o=>o.id!==e.id&&o.type==='opening'&&o.wall===e.wall&&Math.abs(o.offset-e.offset)*length<(o.width+e.width)/2-1e-8))return 'Wall openings overlap. / بازشوها با هم تداخل دارند.';
 return null;
}
export function openingCandidate(doc,command,p,options,{wallId,tolerance=.15}={}){
 const candidates=doc.entities.filter(e=>e.role==='wall'&&e.type==='line'&&doc.layers.find(l=>l.id===e.layer)?.visible!==false&&(!wallId||e.id===wallId)).map(w=>({wall:w,distance:Math.max(0,nearest(w,p).distance-w.thickness/2)})).filter(c=>wallId||c.distance<=tolerance).sort((a,b)=>a.distance-b.distance);
 const wall=candidates[0]?.wall;if(!wall)return null;const window=command==='WINDOW';
 return{type:'opening',wall:wall.id,offset:nearest(wall,p).t,width:window?options.windowWidth??1.2:options.openingWidth??.9,height:window?options.windowHeight??1.2:options.openingHeight??2.1,z:window?options.windowSill??.9:options.doorBase??0,kind:window?'window':command==='ARCHDOOR'?'arched':'door',hinge:options.doorHinge||'left',swing:options.doorSwing??1,openAngle:options.doorAngle??90};
}
export function openingPlanGeometry(doc,e){
 const wall=doc.entities.find(w=>w.id===e.wall);if(!wall)return null;
 const center=at(wall,e.offset),angle=Math.atan2(wall.b.y-wall.a.y,wall.b.x-wall.a.x),c=Math.cos(angle),s=Math.sin(angle),world=p=>({x:center.x+p.x*c-p.y*s,y:center.y+p.x*s+p.y*c}),curves=[],line=(a,b)=>curves.push({type:'line',a:world(a),b:world(b)}),half=e.width/2,t=wall.thickness/2;
 line({x:-half,y:-t},{x:-half,y:t});line({x:half,y:-t},{x:half,y:t});
 let hinge=null,leafEnd=null;
 if(e.kind==='window'){for(const y of [-t*.38,t*.38])line({x:-half,y},{x:half,y});}
 else{const direction=e.hinge==='right'?-1:1,swing=e.swing??1,start=direction===1?0:Math.PI,sweep=direction*swing*(e.openAngle??90)*Math.PI/180,h={x:-direction*half,y:swing*t},end={x:h.x+e.width*Math.cos(start+sweep),y:h.y+e.width*Math.sin(start+sweep)};line(h,end);hinge=world(h);leafEnd=world(end);if(Math.abs(sweep)>1e-8)curves.push({type:'arc',center:hinge,radius:e.width,start:start+angle,sweep});}
 const footprint=[{x:-half,y:-t},{x:half,y:-t},{x:half,y:t},{x:-half,y:t}].map(world);
 return{wall,center,angle,curves,hinge,leafEnd,footprint};
}
export function openingHitDistance(doc,e,p){
 const g=openingPlanGeometry(doc,e);if(!g)return Infinity;
 if(inside(p,g.footprint))return 0;
 return Math.min(...g.curves.map(c=>nearest(c,p)?.distance??Infinity));
}
export function slideOpening(doc,e,delta){
 const wall=doc.entities.find(w=>w.id===e.wall&&w.role==='wall'&&w.type==='line');if(!wall)throw Error('Opening wall is missing.');
 const length=dist(wall.a,wall.b),along=(delta.x*(wall.b.x-wall.a.x)+delta.y*(wall.b.y-wall.a.y))/length,center=Math.max(e.width/2,Math.min(length-e.width/2,e.offset*length+along));
 return{...e,offset:center/length};
}
export function wallOpeningSegments(doc,wall){
 const length=dist(wall.a,wall.b),gaps=doc.entities.filter(e=>e.type==='opening'&&e.wall===wall.id).map(e=>({a:Math.max(0,e.offset*length-e.width/2),b:Math.min(length,e.offset*length+e.width/2)})).sort((a,b)=>a.a-b.a),pieces=[];let cursor=0;
 for(const gap of gaps){if(gap.a>cursor+1e-8)pieces.push({...wall,a:at(wall,cursor/length),b:at(wall,gap.a/length)});cursor=Math.max(cursor,gap.b);}
 if(cursor<length-1e-8)pieces.push({...wall,a:at(wall,cursor/length),b:wall.b});return pieces;
}
