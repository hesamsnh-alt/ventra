// Touch input is deferred until release: a second finger can begin a gesture
// without first adding an unwanted CAD point. No document geometry lives here.
export function createPlanTouchInput({getState,getView,getRect,isPan,onView,onPoint,onPreview}){
 const fingers=new Map();let gesture=null;
 const world=(p,v=getView())=>{const r=getRect(),h=v.width*r.height/r.width;return{x:v.x+(p.x-r.left)/r.width*v.width,y:v.y+(1-(p.y-r.top)/r.height)*h};};
 const position=e=>({x:e.clientX,y:e.clientY});
 const midpoint=()=>{const a=[...fingers.values()];return{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};};
 function down(e){
  fingers.set(e.pointerId,position(e));
  if(fingers.size===1){const s=getState(),p=position(e);gesture={start:p,view:{...getView()},multi:false,moved:false,pan:isPan()||s.command==='SELECT',explicitPan:isPan(),command:s.command,pointCount:s.points.length};}
  else if(fingers.size===2){const a=[...fingers.values()],mid=midpoint(),view={...getView()};gesture={...gesture,multi:true,view,distance:Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)),anchor:world(mid,view)};}
 }
 function move(e){
  if(!fingers.has(e.pointerId)||!gesture)return;fingers.set(e.pointerId,position(e));
  if(fingers.size>=2){const a=[...fingers.values()],mid=midpoint(),r=getRect(),distance=Math.max(1,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)),width=Math.max(.02,Math.min(10000,gesture.view.width*gesture.distance/distance)),height=width*r.height/r.width;
   onView({x:gesture.anchor.x-(mid.x-r.left)/r.width*width,y:gesture.anchor.y-(1-(mid.y-r.top)/r.height)*height,width});return;
  }
  if(gesture.multi)return;
  const p=position(e),r=getRect();gesture.moved ||= Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>8;
  if(gesture.pan&&gesture.moved){onView({x:gesture.view.x-(p.x-gesture.start.x)/r.width*gesture.view.width,y:gesture.view.y+(p.y-gesture.start.y)/r.width*gesture.view.width,width:gesture.view.width});}
  else onPreview(world(p));
 }
 function up(e){
  if(!fingers.has(e.pointerId)||!gesture)return;const g=gesture;fingers.delete(e.pointerId);
  if(g.multi){if(!fingers.size)gesture=null;return;}
  gesture=null;const p=position(e),moved=g.moved||Math.hypot(p.x-g.start.x,p.y-g.start.y)>8;
  if(g.explicitPan||g.pan&&moved)return;
  if(moved&&['LINE','WALL'].includes(g.command)&&g.pointCount===0)onPoint(world(g.start,g.view));
  onPoint(world(p,g.view));
 }
 function cancel(){fingers.clear();gesture=null;}
 return{down,move,up,cancel,active:()=>fingers.size>0};
}
