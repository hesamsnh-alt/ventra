const bindings=new WeakMap();
export function bindFurnitureInputs(canvas,{getTool,pickPoint,pickAsset,preview,clearPreview}){
 bindings.get(canvas)?.();const listeners=[];let gesture=null;
 const on=(target,type,fn)=>{const options={capture:true,passive:false};target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
 const consume=e=>{e.preventDefault();e.stopImmediatePropagation?.();};
 on(canvas,'pointerdown',e=>{
  const tool=getTool();if(!tool||e.button!==0)return;
  consume(e);canvas.focus?.({preventScroll:true});const point=pickPoint(e);if(!point)return;
  const data=tool.start?.(pickAsset(e),point,e);if(data===false)return;
  gesture={id:e.pointerId,x:e.clientX,y:e.clientY,tool,data,moved:false};
  try{canvas.setPointerCapture(e.pointerId);}catch{}
 });
 on(canvas,'pointermove',e=>{
  const tool=getTool();if(!tool)return;consume(e);const point=pickPoint(e);if(!point)return;
  if(gesture&&gesture.id===e.pointerId)gesture.moved ||= Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>4;
  const result=tool.preview?.(point,gesture?.data,e);preview(result?.candidate||null,!!result?.valid);
 });
 const finish=e=>{
  if(!gesture||gesture.id!==e.pointerId)return;consume(e);const current=gesture;gesture=null;
  try{canvas.releasePointerCapture(e.pointerId);}catch{}
  if(e.type==='pointerup'){const point=pickPoint(e);if(point)current.tool.commit?.(point,current.data,current.moved,e);}
  clearPreview();
 };
 on(canvas,'pointerup',finish);on(canvas,'pointercancel',finish);on(canvas,'lostpointercapture',finish);
 if(canvas.ownerDocument&&canvas.ownerDocument!==canvas)on(canvas.ownerDocument,'pointerup',finish);
 on(canvas,'dragover',e=>{if(getTool()){consume(e);const point=pickPoint(e),result=point&&getTool().preview?.(point);preview(result?.candidate||null,!!result?.valid);}});
 on(canvas,'drop',e=>{const tool=getTool();if(!tool)return;consume(e);const point=pickPoint(e);if(point)tool.commit?.(point,null,true);clearPreview();});
 const dispose=()=>{listeners.splice(0).forEach(fn=>fn());gesture=null;clearPreview();if(bindings.get(canvas)===dispose)bindings.delete(canvas);};
 dispose.cancel=()=>{gesture=null;clearPreview();};
 bindings.set(canvas,dispose);return dispose;
}
