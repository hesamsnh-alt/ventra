// Metres internally; CAD angles are counter-clockwise from +X.
export const EPS=1e-8,TAU=Math.PI*2;
export const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=10000&&Math.abs(p.y)<=10000;
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
export const cross=(a,b)=>a.x*b.y-a.y*b.x;
export const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
export const norm=a=>((a%TAU)+TAU)%TAU;
export function arc3(a,b,c){
 const d=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));if(Math.abs(d)<EPS)throw Error('Arc points must not be collinear. / نقاط قوس نباید هم‌خط باشند.');
 const q=p=>p.x*p.x+p.y*p.y,center={x:(q(a)*(b.y-c.y)+q(b)*(c.y-a.y)+q(c)*(a.y-b.y))/d,y:(q(a)*(c.x-b.x)+q(b)*(a.x-c.x)+q(c)*(b.x-a.x))/d};
 const start=Math.atan2(a.y-center.y,a.x-center.x),end=Math.atan2(c.y-center.y,c.x-center.x),mid=Math.atan2(b.y-center.y,b.x-center.x),sweep=norm(mid-start)<=norm(end-start)?norm(end-start):-norm(start-end);
 return {center,radius:dist(a,center),start,sweep};
}
export function at(e,t){return e.type==='arc'||e.type==='circle'?{x:e.center.x+e.radius*Math.cos(e.start+t*e.sweep),y:e.center.y+e.radius*Math.sin(e.start+t*e.sweep)}:mix(e.a,e.b,t);}
export function param(e,p){if(e.type==='arc'||e.type==='circle'){const a=Math.atan2(p.y-e.center.y,p.x-e.center.x),span=e.sweep>=0?norm(a-e.start):norm(e.start-a);return span/Math.abs(e.sweep);}const v=sub(e.b,e.a);return ((p.x-e.a.x)*v.x+(p.y-e.a.y)*v.y)/(v.x*v.x+v.y*v.y);}
export function segments(e){
 if(['line','arc','circle'].includes(e.type))return [{...e,start:e.start||0,sweep:e.type==='circle'?TAU:e.sweep}];
 if(e.type==='polyline')return e.points.slice(0,e.closed?e.points.length:e.points.length-1).map((p,i)=>({...e,type:'line',a:p,b:e.points[(i+1)%e.points.length],segment:i}));return [];
}
export function curveIntersections(a,b,extendA=false){
 const circle=e=>e.type==='arc'||e.type==='circle';let points=[];
 if(!circle(a)&&!circle(b)){
  const v=sub(a.b,a.a),w=sub(b.b,b.a),den=cross(v,w);if(Math.abs(den)<EPS)return [];
  const d=sub(b.a,a.a),t=cross(d,w)/den,u=cross(d,v)/den;if(u>=-EPS&&u<=1+EPS&&(extendA||t>=-EPS&&t<=1+EPS))points=[at(a,t)];
 }else if(circle(a)&&circle(b)){
  const d=dist(a.center,b.center);if(d<EPS||d>a.radius+b.radius+EPS||d<Math.abs(a.radius-b.radius)-EPS)return [];
  const x=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),h=Math.sqrt(Math.max(0,a.radius*a.radius-x*x)),v=sub(b.center,a.center),p={x:a.center.x+x*v.x/d,y:a.center.y+x*v.y/d};points=[{x:p.x-h*v.y/d,y:p.y+h*v.x/d},{x:p.x+h*v.y/d,y:p.y-h*v.x/d}];
 }else{
  const line=circle(a)?b:a,c=circle(a)?a:b,v=sub(line.b,line.a),f=sub(line.a,c.center),A=v.x*v.x+v.y*v.y,B=2*(f.x*v.x+f.y*v.y),C=f.x*f.x+f.y*f.y-c.radius*c.radius,det=B*B-4*A*C;if(det<-EPS||A<EPS)return [];
  const root=Math.sqrt(Math.max(0,det));points=[(-B-root)/(2*A),(-B+root)/(2*A)].filter(t=>line===a&&extendA||t>=-EPS&&t<=1+EPS).map(t=>at(line,t));
 }
 return points.filter((p,i,ps)=>ps.findIndex(q=>dist(p,q)<EPS)===i).filter(p=>(extendA||!circle(a)||a.type==='circle'||param(a,p)<=1+EPS)&&(!circle(b)||b.type==='circle'||param(b,p)<=1+EPS));
}
export function nearest(e,p){
 let best=null;for(const s of segments(e)){const t=s.type==='line'?Math.max(0,Math.min(1,param(s,p))):Math.max(0,Math.min(1,param(s,p))),q=at(s,t),candidates=[q,at(s,0),at(s,1)];for(const q of candidates){const d=dist(p,q);if(!best||d<best.distance)best={point:q,distance:d,t:param(s,q),segment:s};}}return best;
}
export function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
export function polygonArea(p){return Math.abs(p.reduce((sum,a,i)=>sum+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0))/2;}
export function validPolygon(p){if(!Array.isArray(p)||p.length<3||p.some(v=>!point(v))||polygonArea(p)<1e-6)return false;for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){if(j===i+1||i===0&&j===p.length-1)continue;if(curveIntersections({type:'line',a:p[i],b:p[(i+1)%p.length]},{type:'line',a:p[j],b:p[(j+1)%p.length]}).length)return false;}return true;}
export function curveSlice(e,a,b){if(e.type==='line')return {...e,a:at(e,a),b:at(e,b)};return {...e,type:'arc',start:e.start+e.sweep*a,sweep:e.sweep*(b-a)};}
export function trimCurve(entity,cutters,click){
 const picked=nearest(entity,click);if(!picked)throw Error('Choose a line, arc or polyline.');const e=picked.segment,t=picked.t,cuts=[0,1,...cutters.flatMap(c=>segments(c).flatMap(b=>curveIntersections(e,b).map(p=>param(e,p))))].filter(t=>t>=-EPS&&t<=1+EPS).sort((a,b)=>a-b).filter((t,i,a)=>i===0||Math.abs(t-a[i-1])>EPS);
 if(cuts.length<3)throw Error('No cutting intersection. / تقاطعی برای تریم پیدا نشد.');let i=cuts.findIndex((v,i)=>i<cuts.length-1&&t>=v-EPS&&t<=cuts[i+1]+EPS);if(i<0)i=cuts.length-2;
 const remaining=[];if(cuts[i]>EPS)remaining.push(curveSlice(e,0,cuts[i]));if(cuts[i+1]<1-EPS)remaining.push(curveSlice(e,cuts[i+1],1));
 if(entity.type==='polyline')return [...segments(entity).filter(s=>s.segment!==picked.segment.segment),...remaining].map(s=>{const next={...s};delete next.points;delete next.closed;delete next.segment;return next;});return remaining;
}
export function extendCurve(entity,cutters,click){
 const pick=nearest(entity,click);if(!pick||entity.type==='circle'||entity.type==='polyline'&&entity.closed)throw Error('Extend needs an open line or arc.');
 const segs=segments(entity),first=dist(click,at(segs[0],0))<=dist(click,at(segs.at(-1),1)),e=first?segs[0]:segs.at(-1);
 let ts=cutters.flatMap(c=>segments(c).flatMap(b=>curveIntersections(e,b,true).map(p=>{if(e.type==='line')return param(e,p);const a=Math.atan2(p.y-e.center.y,p.x-e.center.x);return first?-norm((e.sweep>0?1:-1)*(e.start-a))/Math.abs(e.sweep):norm((e.sweep>0?1:-1)*(a-e.start))/Math.abs(e.sweep);}))).filter(t=>first?t<-EPS:t>1+EPS);
 if(!ts.length)throw Error('No boundary in the extension direction. / مرزی در جهت امتداد پیدا نشد.');const t=first?Math.max(...ts):Math.min(...ts),next=curveSlice(e,first?t:0,first?1:t);
 if(entity.type==='polyline'){const p=entity.points.map(p=>({...p}));p[first?0:p.length-1]=at(next,first?0:1);return {...entity,points:p};}return {...entity,...next};
}
export function extrimCurve(entity,boundary,removeInside){
 const poly=boundary.type==='circle'?Array.from({length:128},(_,i)=>at({...boundary,start:0,sweep:TAU},i/128)):boundary.points;if(!validPolygon(poly))throw Error('EXTRIM needs a closed, simple boundary. / مرز EXTRIM باید بسته و بدون تقاطع باشد.');
 return segments(entity).flatMap(e=>{const cuts=[0,1,...segments(boundary).flatMap(b=>curveIntersections(e,b).map(p=>param(e,p)))].sort((a,b)=>a-b).filter((t,i,a)=>t>=0&&t<=1&&(i===0||Math.abs(t-a[i-1])>EPS));return cuts.slice(0,-1).flatMap((t,i)=>inside(at(e,(t+cuts[i+1])/2),poly)===removeInside?[]:[curveSlice(e,t,cuts[i+1])]);});
}
export function offsetCurve(entity,distance,side){
 const n=nearest(entity,side);if(!n)throw Error('Offset needs a curve.');if(entity.type==='line'){const v=sub(entity.b,entity.a),l=dist(entity.a,entity.b),sign=cross(v,sub(side,entity.a))>=0?1:-1,dx=-v.y/l*distance*sign,dy=v.x/l*distance*sign;return {...entity,a:{x:entity.a.x+dx,y:entity.a.y+dy},b:{x:entity.b.x+dx,y:entity.b.y+dy}};}
 if(['arc','circle'].includes(entity.type)){const radius=entity.radius+(dist(side,entity.center)>entity.radius?distance:-distance);if(radius<=EPS)throw Error('Offset radius must remain positive.');return {...entity,radius};}throw Error('Offset a single line, circle or arc. / آفست فعلاً برای خط، دایره و قوس است.');
}
export function bounds(entities){
 const points=entities.flatMap(e=>{
  if(e.type==='dimension'){const l=dist(e.a,e.b),n={x:-(e.b.y-e.a.y)/l,y:(e.b.x-e.a.x)/l},o=e.offsetDistance||.3,a={x:e.a.x+n.x*o,y:e.a.y+n.y*o},b={x:e.b.x+n.x*o,y:e.b.y+n.y*o};return[e.a,e.b,a,b,{x:(a.x+b.x)/2-.6,y:(a.y+b.y)/2-.2},{x:(a.x+b.x)/2+.6,y:(a.y+b.y)/2+.2}];}
  if(e.type==='text'){const w=e.text.length*e.textHeight*1.2,h=e.textHeight,r=(e.rotation||0)*Math.PI/180,rtl=/[\u0600-\u06ff]/.test(e.text);return[[rtl?-w:0,-h*.3],[rtl?0:w,-h*.3],[rtl?0:w,h*1.3],[rtl?-w:0,h*1.3]].map(([x,y])=>({x:e.position.x+x*Math.cos(r)-y*Math.sin(r),y:e.position.y+x*Math.sin(r)+y*Math.cos(r)}));}
  if(e.points)return e.points;if(e.a)return[e.a,e.b];
  if(e.center){if(e.type==='arc'||e.type==='circle')return[{x:e.center.x-e.radius,y:e.center.y-e.radius},{x:e.center.x+e.radius,y:e.center.y+e.radius}];const r=(e.rotation||0)*Math.PI/180;return[-1,1].flatMap(x=>[-1,1].map(y=>({x:e.center.x+x*(e.width||.3)/2*Math.cos(r)-y*(e.depth||.3)/2*Math.sin(r),y:e.center.y+x*(e.width||.3)/2*Math.sin(r)+y*(e.depth||.3)/2*Math.cos(r)})));}
  if(e.type==='opening'){const wall=entities.find(w=>w.id===e.wall);if(wall){const p=at(wall,e.offset);return[{x:p.x-e.width,y:p.y-e.width},{x:p.x+e.width,y:p.y+e.width}];}}
  return e.position?[e.position]:[];
 }).filter(point);if(!points.length)return{x:-1,y:-1,width:12,height:9};const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return{x,y,width:Math.max(.2,Math.max(...points.map(p=>p.x))-x),height:Math.max(.2,Math.max(...points.map(p=>p.y))-y)};
}
