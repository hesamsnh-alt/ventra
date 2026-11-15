import {id} from './document.mjs';
import {at,dist,point,EPS,validPolygon} from './geometry.mjs';

export const SECTION_LAYER='section-details';
export const SECTION_COMMANDS=['SECTIONWALL','SECTIONSLAB','SECTIONSTAIR','WINDOWELEVATION','CEILINGSECTION'];
export const SECTION_DEFAULTS=Object.freeze({
 wallThickness:.2,slabThickness:.3,multilineWidth:.2,
 stairStyle:'return',firstRun:'right',risers:18,landing:.95,waist:.16,beamWidth:.2,beamHeight:.35,stories:1,
 windowStyle:'sliding',sashes:2,frame:.05,sash:.035,transom:.5,
 board:.013,hangerSpacing:.6,
});

const line=(a,b,extra={})=>({type:'line',a,b,...extra});
const poly=(points,closed=false)=>({type:'polyline',points,closed});
const rect=(left,bottom,right,top)=>poly([{x:left,y:bottom},{x:right,y:bottom},{x:right,y:top},{x:left,y:top}],true);
const solid=(entity,hatch='diagonal')=>({...entity,hatch,hatchScale:.1});
const moved=(p,n,d)=>({x:p.x+n.x*d,y:p.y+n.y*d});
const normal=(a,b)=>{const size=dist(a,b);return{x:(a.y-b.y)/size,y:(b.x-a.x)/size};};
const between=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;

function bandPoints(points,offset,closed){
 return points.map((p,i)=>{
  const before=i>0||closed?normal(points[(i+points.length-1)%points.length],p):null;
  const after=i<points.length-1||closed?normal(p,points[(i+1)%points.length]):null;
  if(!before||!after)return moved(p,before||after,offset);
  const join=1+before.x*after.x+before.y*after.y;
  if(join<.15)throw Error('Section line turns too sharply. / پیچ خط برش بیش از حد تند است.');
  return moved(p,{x:before.x+after.x,y:before.y+after.y},offset/join);
 });
}

export function parallelLines(points,spacing,closed=false){
 if(!between(spacing,.01,3))throw Error('Spacing must be 0.01–3 m. / فاصلهٔ خطوط باید بین ۱ تا ۳۰۰ سانتی‌متر باشد.');
 if(points.length<(closed?3:2)||points.some((p,i)=>i>0&&dist(p,points[i-1])<EPS)||
   closed&&!validPolygon(points))throw Error('Draw a valid path with distinct points. / مسیر معتبر با نقاط مجزا ترسیم کن.');
 return [1,-1].map(side=>poly(bandPoints(points,side*spacing/2,closed),closed));
}

export function sectionBand(entity,thickness){
 if(!between(thickness,.01,3))throw Error('Thickness must be 0.01–3 m. / ضخامت باید بین ۱ تا ۳۰۰ سانتی‌متر باشد.');
 const half=thickness/2;
 if(entity.type==='arc'){
  if(entity.radius<=half)throw Error('Arc radius must exceed half the thickness. / شعاع قوس از نصف ضخامت بیشتر باشد.');
  const outer={type:'arc',center:entity.center,radius:entity.radius+half,start:entity.start,sweep:entity.sweep};
  const inner={...outer,radius:entity.radius-half};
  return [outer,inner,...[0,1].map(end=>line(at(outer,end),at(inner,end)))];
 }
 const points=entity.type==='line'?[entity.a,entity.b]:entity.points;
 const a=bandPoints(points,half,entity.closed),b=bandPoints(points,-half,entity.closed);
 if(entity.closed){
  if(!validPolygon(a)||!validPolygon(b))throw Error('Thickness does not fit the closed outline. / ضخامت در محدودهٔ بسته جا نمی‌شود.');
  return [poly(a,true),poly(b,true)];
 }
 return [solid(poly([...a,...b.reverse()],true))];
}

export function sectionWindowRect(entity){
 if(entity.type!=='polyline'||!entity.closed||entity.points.length!==4)return null;
 const [a,b,c,d]=entity.points,edges=[dist(a,b),dist(b,c),dist(c,d),dist(d,a)];
 if(edges.some(size=>size<EPS)||Math.abs(edges[0]-edges[2])>EPS||Math.abs(edges[1]-edges[3])>EPS||
   Math.abs((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))>1e-6)return null;
 const horizontal=Math.abs(b.x-a.x)/edges[0]>=Math.abs(c.x-b.x)/edges[1]?[a,b]:[b,c];
 const [p,q]=horizontal;
 const left=p.x<=q.x?p:q,right=p.x<=q.x?q:p;
 const width=dist(left,right),u={x:(right.x-left.x)/width,y:(right.y-left.y)/width},v={x:-u.y,y:u.x};
 const projections=entity.points.map(p=>(p.x-left.x)*v.x+(p.y-left.y)*v.y);
 const bottom=Math.min(...projections),height=Math.max(...projections)-bottom;
 return {width,height,origin:moved(left,v,bottom),u,v};
}

export function windowElevation(entity,{windowStyle,sashes,frame,sash,transom}){
 const basis=sectionWindowRect(entity);
 if(!basis)throw Error('Select complete rectangles for windows. / مستطیل‌های کامل پنجره را انتخاب کن.');
 const {width,height,origin,u,v}=basis;
 if(!['sliding','casement','fixed'].includes(windowStyle)||!Number.isInteger(sashes)||!between(sashes,1,6)||
  !between(frame,.008,.2)||!between(sash,.008,.12)||!between(transom,0,height))throw Error('Check window style and frame dimensions. / نوع و ابعاد قاب پنجره را بررسی کن.');
 const innerWidth=width-2*frame,top=height-frame,split=transom?top-transom:top;
 const panel=innerWidth/sashes,panelTop=split-(transom?frame:0);
 if(panel<=2*sash||panelTop-frame<=2*sash||transom&&transom<=2*sash)throw Error('Frame or transom does not fit this window. / قاب یا کتیبه در پنجره جا نمی‌شود.');
 const curves=[rect(0,0,width,height),rect(frame,frame,width-frame,top)];
 if(transom)curves.push(rect(frame,split,width-frame,top));
 for(let i=0;i<sashes;i++){
  const x=frame+i*panel;
  curves.push(rect(x+sash,frame+sash,x+panel-sash,panelTop-sash));
  const center=x+panel/2,middle=(frame+panelTop)/2;
  if(windowStyle==='sliding'){
   const sign=i%2?-1:1,tip=center+panel*.18*sign,head=Math.min(.07,panel*.12,(panelTop-frame)*.13);
   curves.push(poly([{x:center-panel*.18*sign,y:middle},{x:tip,y:middle}]),
    poly([{x:tip-head*sign,y:middle+head*.55},{x:tip,y:middle},{x:tip-head*sign,y:middle-head*.55}]));
  }
  if(windowStyle==='casement'){
   const left=x+sash,right=x+panel-sash,hinge=i%2?right:left,opposite=i%2?left:right;
   curves.push({...poly([{x:hinge,y:frame+sash},{x:opposite,y:middle},{x:hinge,y:panelTop-sash}]),dash:'dashed'});
  }
 }
 return curves.map(curve=>({...curve,points:curve.points.map(p=>moved(moved(origin,u,p.x),v,p.y))}));
}

export function staircaseSection(a,b,{stairStyle,firstRun,risers,landing,waist,beamWidth,beamHeight,stories}){
 const left=Math.min(a.x,b.x),bottom=Math.min(a.y,b.y),width=Math.abs(a.x-b.x),height=Math.abs(a.y-b.y);
 if(!['straight','return','scissor'].includes(stairStyle)||!['left','right'].includes(firstRun)||
  !Number.isInteger(risers)||!between(risers,3,40)||!Number.isInteger(stories)||!between(stories,1,12)||
  !between(landing,.15,5)||!between(waist,.04,1)||!between(beamWidth,.03,landing)||!between(beamHeight,.04,1))
  throw Error('Check stair, landing and beam dimensions. / ابعاد پله، پاگرد و تیر را بررسی کن.');
 const reversed=stairStyle==='return',run=width-2*landing,riser=height/risers;
 const first=reversed?Math.ceil(risers/2):risers,last=risers-first;
 if(run/first<.1||beamHeight<=waist||!between(riser,.075,.3))throw Error('The bay does not fit this tread and riser count. / تعداد پله با عرض و ارتفاع کادر سازگار نیست.');
 const result=[];
 function flight(x,y,sign,count,dashed=false){
  const tread=run/count,top=[{x:x-sign*landing,y},{x,y}];
  for(let i=0;i<count;i++)top.push({x:x+sign*i*tread,y:y+(i+1)*riser},{x:x+sign*(i+1)*tread,y:y+(i+1)*riser});
  const end=top.at(-1),outer={x:end.x+sign*landing,y:end.y};
  const profile=poly([...top,outer,{x:outer.x,y:outer.y-waist},{x:end.x,y:end.y-waist},{x,y:y-waist},{x:top[0].x,y:y-waist}],true);
  result.push(dashed?{...profile,dash:'dashed'}:profile);
 }
 const start=firstRun==='right'?landing:width-landing,sign=firstRun==='right'?1:-1;
 for(let story=0;story<stories;story++){
  const base=story*height;
  if(stairStyle==='scissor'){
   flight(width-start,base,-sign,risers,true);
  }
  flight(start,base,sign,first);
  if(reversed)flight(width-start,base+first*riser,-sign,last);
  const levels=reversed?[[width-start,base+first*riser],[start,base+height]]:[[width-start,base+height]];
  for(const [x,y] of levels){
   const toward=x<width/2?-1:1;
   const x2=x+toward*beamWidth;
   result.push(rect(Math.min(x,x2),y-beamHeight,Math.max(x,x2),y-waist));
  }
 }
 return result.map(curve=>({...curve,points:curve.points.map(p=>({x:p.x+left,y:p.y+bottom}))}));
}

export function ceilingSection(a,b,soffit,{board,hangerSpacing}){
 const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x);
 if(right-left<.12||soffit.x<left-EPS||soffit.x>right+EPS||!between(board,.005,.08)||!between(hangerSpacing,.15,3)||
   soffit.y>=Math.min(a.y,b.y)-board-.03)throw Error('Pick a soffit below both supports, inside a valid span. / زیرِ سقف کاذب را پایین‌تر از هر دو تکیه‌گاه بزن.');
 const y=soffit.y,result=[solid(rect(left,y,right,y+board))];
 const channels=y+board+.025;
 result.push(line({x:left,y:channels},{x:right,y:channels}));
 const count=Math.max(1,Math.ceil((right-left)/hangerSpacing));
 if(count>100)throw Error('Use a shorter span or wider hanger spacing. / دهانه را کوتاه‌تر یا فاصلهٔ آویزها را بیشتر کن.');
 for(let i=0;i<count;i++){
  const x=left+(i+.5)*(right-left)/count,top=a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x),width=Math.min(.027,(right-left)/count*.2);
  result.push(rect(x-width/2,channels,x+width/2,top),
    rect(x-width,channels-.012,x+width,channels+.012));
 }
 return result;
}

export function sectionSelection(doc,selection,command,options){
 const selected=new Set(selection);
 const entities=doc.entities.filter(e=>selected.has(e.id));
 if(!entities.length)throw Error('Select drawing guides first. / ابتدا خطوط راهنما یا مستطیل‌ها را انتخاب کن.');
 if(entities.some(e=>!['line','arc','polyline'].includes(e.type)||!['line',undefined].includes(e.role)||e.hatch||
   doc.layers.find(layer=>layer.id===e.layer)?.locked))throw Error('Use unlocked drafting guides only. / فقط خطوط راهنمای ترسیمیِ قفل‌نشده را انتخاب کن.');
 const geometry=entities.flatMap(e=>command==='WINDOWELEVATION'?windowElevation(e,options):
  sectionBand(e,command==='SECTIONSLAB'?options.slabThickness:options.wallThickness));
 return saveSectionGeometry(doc,geometry,command,selected);
}

export function saveSectionGeometry(doc,geometry,command,replaced=new Set()){
 const layer=doc.layers.find(layer=>layer.id===SECTION_LAYER);
 if(layer?.locked||layer?.visible===false)throw Error('Show and unlock the section layer first. / ابتدا لایهٔ برش را روشن و باز کن.');
 if(geometry.length>2000||geometry.some(e=>[...(e.points||[]),...[e.a,e.b,e.center].filter(Boolean)].some(p=>!point(p))))
  throw Error('Section exceeds the drawing limits. / برش از محدودهٔ ترسیم خارج است.');
 const colors={SECTIONWALL:'#e5e9ec',SECTIONSLAB:'#daa197',SECTIONSTAIR:'#e7ce93',WINDOWELEVATION:'#e1d77f',CEILINGSECTION:'#9adbd6'};
 const items=geometry.map(e=>({id:id(),layer:SECTION_LAYER,role:'section',color:colors[command],...e}));
 return {doc:{...doc,layers:layer?doc.layers:[...doc.layers,{id:SECTION_LAYER,name:'Sections / برش‌ها',color:'#bccfdd',dash:'solid',weight:.25,visible:true,locked:false}],
  entities:[...doc.entities.filter(e=>!replaced.has(e.id)),...items]},selection:items.map(e=>e.id)};
}
