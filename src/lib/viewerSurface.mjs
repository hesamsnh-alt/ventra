export function waitForViewerSurface(element,signal){
 return new Promise(resolve=>{
  let timer,observer,settled=false;
  const finish=value=>{if(settled)return;settled=true;clearInterval(timer);observer?.disconnect();signal?.removeEventListener('abort',abort);resolve(value);};
  const abort=()=>finish(false);
  const check=()=>{if(signal?.aborted)return finish(false);if(element?.isConnected&&element.clientWidth>0&&element.clientHeight>0)finish(true);};
  signal?.addEventListener('abort',abort,{once:true});
  if(typeof ResizeObserver!=='undefined'&&element){observer=new ResizeObserver(check);observer.observe(element);}
  timer=setInterval(check,250);check();
 });
}
