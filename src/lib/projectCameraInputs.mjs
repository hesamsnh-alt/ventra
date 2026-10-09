// Own exactly one input binding per canvas. Rebuilding a renderer must not
// leave a disposed renderer consuming drag events on the same DOM element.
const bindings=new WeakMap();
export function bindProjectCameraInputs(canvas,{orbit,pan,zoom,home,getMode=()=> 'orbit',onInteraction=()=>{}}) {
 bindings.get(canvas)?.();
 const points=new Map(),listeners=[];
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 canvas.style.touchAction='none';canvas.style.pointerEvents='auto';canvas.style.cursor='grab';canvas.tabIndex=0;
 const pair=()=>{const p=[...points.values()];return p.length===2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}:null;};
 const down=e=>{if(points.size>=2)return;e.preventDefault();onInteraction();canvas.focus?.({preventScroll:true});points.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button});canvas.style.cursor='grabbing';try{canvas.setPointerCapture(e.pointerId);}catch{}};
 const move=e=>{
  const p=points.get(e.pointerId);if(!p)return;e.preventDefault();
  const before=pair();points.set(e.pointerId,{x:e.clientX,y:e.clientY,button:p.button});const after=pair();
  if(before&&after){pan(after.x-before.x,after.y-before.y);if(before.d>5&&after.d>5)zoom(before.d/after.d);return;}
  const dx=e.clientX-p.x,dy=e.clientY-p.y;
  if(getMode()==='pan'||e.shiftKey||p.button===1||p.button===2)pan(dx,dy);
  else orbit(dx*2*Math.PI/Math.max(200,canvas.clientWidth),dy*Math.PI/Math.max(200,canvas.clientHeight));
 };
 const up=e=>{points.delete(e.pointerId);canvas.style.cursor=points.size?'grabbing':'grab';try{canvas.releasePointerCapture(e.pointerId);}catch{}};
 const wheel=e=>{e.preventDefault();onInteraction();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);zoom(Math.exp(Math.max(-.5,Math.min(.5,delta*.001))));};
 const key=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))return;e.preventDefault();onInteraction();if(e.key==='Home')home();else if(e.key==='+')zoom(.88);else if(e.key==='-')zoom(1.14);else orbit(e.key==='ArrowLeft'?Math.PI/12:e.key==='ArrowRight'?-Math.PI/12:0,e.key==='ArrowUp'?-Math.PI/24:e.key==='ArrowDown'?Math.PI/24:0);};
 listen(canvas,'pointerdown',down,{passive:false});listen(canvas,'pointermove',move,{passive:false});
 // Captured events normally target the canvas; document fallbacks cover capture failure.
 const doc=canvas.ownerDocument||canvas;listen(doc,'pointerup',up);listen(canvas,'pointercancel',up);listen(canvas,'lostpointercapture',up);
 if(doc!==canvas)listen(doc,'pointermove',e=>{if(e.target!==canvas)move(e);},{passive:false});
 listen(canvas,'wheel',wheel,{passive:false});listen(canvas,'keydown',key);listen(canvas,'contextmenu',e=>e.preventDefault());
 const dispose=()=>{listeners.splice(0).forEach(fn=>fn());points.clear();if(bindings.get(canvas)===dispose)bindings.delete(canvas);};
 bindings.set(canvas,dispose);return dispose;
}
