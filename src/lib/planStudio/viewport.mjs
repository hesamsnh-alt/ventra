import {bounds} from './geometry.mjs';
export const MIN_VIEW_WIDTH=.02,MAX_VIEW_WIDTH=10000;
const clamp=n=>Math.max(MIN_VIEW_WIDTH,Math.min(MAX_VIEW_WIDTH,n));
function viewportSize(size){return{width:Math.max(1,size.width||1),height:Math.max(1,size.height||1)};}
export function fitPlanView(entities,size){
 const b=bounds(entities),r=viewportSize(size),padding=Math.max(.5,Math.max(b.width,b.height)*.08),width=clamp(Math.max(b.width+2*padding,(b.height+2*padding)*r.width/r.height));
 return{x:b.x+b.width/2-width/2,y:b.y+b.height/2-width*r.height/r.width/2,width};
}
export function zoomPlanView(view,size,factor,anchor){
 const r=viewportSize(size),width=clamp(view.width*factor),p=anchor||{x:view.x+view.width/2,y:view.y+view.width*r.height/r.width/2};
 return{x:p.x-(p.x-view.x)*width/view.width,y:p.y-(p.y-view.y)*width/view.width,width};
}
function niceStep(target){const power=10**Math.floor(Math.log10(target)),v=target/power;return (v<2?1:v<5?2:5)*power;}
export function planViewportMetrics(viewWidth,pixelWidth){
 const worldPerPixel=viewWidth/Math.max(1,pixelWidth),minor=niceStep(worldPerPixel*40),scaleLength=niceStep(worldPerPixel*120);
 return{worldPerPixel,minor,major:minor*5,scaleLength,scalePixels:scaleLength/worldPerPixel,crossHalf:worldPerPixel*9,pickHalf:worldPerPixel*4};
}
export function formatViewDistance(metres,units='cm'){
 if(units==='in')return `${Number((metres/.0254).toFixed(3))} in`;
 const factor=metres>=1?1:metres>=.01?100:1000,unit=factor===1?'m':factor===100?'cm':'mm';
 return `${Number((metres*factor).toFixed(4))} ${unit}`;
}
