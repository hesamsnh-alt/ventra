// Native fullscreen where supported; viewport-size fallback for mobile browsers.
export function createViewportFullscreen({getHost,className,onChange=()=>{},onError=()=>{},doc=document}){
 let host=null,fallback=false,overflow='',disposed=false;
 const current=()=>doc.fullscreenElement||doc.webkitFullscreenElement;
 const reset=()=>{if(!host)return;const old=host;host=null;old.classList.remove(className);old.removeAttribute('data-ventra-walk-fullscreen');doc.body.style.overflow=overflow;fallback=false;if(!disposed)onChange(null);doc.defaultView?.dispatchEvent(new Event('resize'));};
 const exit=()=>{if(!host)return;const own=current()===host;reset();if(own)try{const p=(doc.exitFullscreen||doc.webkitExitFullscreen)?.call(doc);p?.catch?.(()=>{});}catch{}};
 const changed=()=>{if(host&&!fallback&&current()!==host)reset();};
 const key=e=>{if(host&&e.key==='Escape'){e.preventDefault();exit();}};
 doc.addEventListener('fullscreenchange',changed);doc.addEventListener('webkitfullscreenchange',changed);doc.addEventListener('keydown',key,true);
 return{exit,isActive:()=>!!host,enter:async()=>{
  if(host||disposed)return;const element=getHost();if(!element)throw Error('3D viewport is not ready.');
  if(current())throw Error('Exit the other fullscreen view first.');
  const request=element.requestFullscreen||element.webkitRequestFullscreen;
  if(request)try{await request.call(element);}catch(e){onError(e);throw Error('Fullscreen was blocked by the browser. / مرورگر اجازه تمام‌صفحه نداد.');}
  if(disposed){if(current()===element)(doc.exitFullscreen||doc.webkitExitFullscreen)?.call(doc);return;}
  host=element;fallback=!request;overflow=doc.body.style.overflow;doc.body.style.overflow='hidden';host.classList.add(className);host.setAttribute('data-ventra-walk-fullscreen','');onChange(host);doc.defaultView?.dispatchEvent(new Event('resize'));
 },dispose:()=>{disposed=true;exit();doc.removeEventListener('fullscreenchange',changed);doc.removeEventListener('webkitfullscreenchange',changed);doc.removeEventListener('keydown',key,true);}};
}
