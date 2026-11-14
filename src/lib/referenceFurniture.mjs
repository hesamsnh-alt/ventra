const beds={
 'walnut-hotel':{rail:.17,head:'tufted',cover:'#9b9388',pillow:'#4d4843',lift:.10},
 'stone-tailored':{rail:.24,head:'split',cover:'#777a81',pillow:'#596572',lift:.04},
 'channel-linen':{rail:.22,head:'channels',cover:'#a49482',pillow:'#d5b765',lift:.06},
 'oak-platform':{rail:.13,head:'timber',cover:'#c7baa7',pillow:'#ebe0cc',lift:.12},
};
const sofas={
 'crescent-chaise':{bend:.22,chaise:.20,rise:.94,pillows:['#25504f','#aa6241']},
 'boucle-arc':{bend:.12,chaise:0,rise:.81,pillows:['#ad7d58','#d6bea0']},
 'cloud-modular':{bend:.025,chaise:0,rise:.98,pillows:['#eae4d8','#977952']},
};

export function buildReferenceBed({variant,w,d,h,accent,addBox,addCushion,textile,addCover}){
 const style=beds[variant];if(!style)return false;
 const {rail,head,lift}=style;
 const linen=textile('#ede7da');
 const upholstered=head!=='timber';
 const frame=upholstered?textile(accent.color.getHex()):accent;
 const base=(upholstered?addCushion:addBox);
 base(w*.98,d*.98,rail,0,0,lift+rail/2,frame);
 for(const x of [-.40,.40])for(const y of [-.37,.37])addBox(.045,.065,lift,x*w,y*d,lift/2,accent);
 const top=lift+rail+.19;
 addCushion(w*.93,d*.9,.19,0,d*.012,top-.095,linen);
 const headHeight=h-lift;
 base(w*.97,d*.065,headHeight,0,-d*.46,lift+headHeight/2,frame);
 if(head==='channels'){
  for(let i=0;i<7;i++){
   const x=(i-3)*w*.127;
   const panelHeight=headHeight*(.96-Math.abs(i-3)*.045);
   addCushion(w*.125,d*.038,panelHeight,x,-d*.427,lift+panelHeight/2,frame);
  }
 }else if(head==='tufted'){
  addCushion(w*.89,d*.035,h*.43,0,-d*.422,h*.72,frame);
  for(const x of [-.30,-.15,0,.15,.30])for(const y of [.62,.80]){
   addCushion(.027,.013,.027,x*w,-d*.397,h*y,frame);
  }
 }else if(head==='split'){
  for(const x of [-.22,.22])addCushion(w*.426,d*.029,h*.46,w*x,-d*.417,h*.68,frame);
 }
 for(const x of [-.22,.22]){
  const pillow=addCushion(w*.38,d*.165,.115,x*w,-d*.278,top+.056,linen);
  pillow.rotation.x=.13;
 }
 const layer=textile(style.cover);
 const accentPillow=textile(style.pillow);
 const cushion=addCushion(w*.24,d*.128,.106,head==='channels'?0:w*-.18,-d*.188,top+.087,accentPillow);
 cushion.rotation.x=.15;
 addCover(w,d,layer,{height:top+.021,depthStart:head==='split'?-.11:-.16,foldDepth:head==='timber'?.235:.18,foldWeight:head==='timber'?1.65:1});
 return true;
}

export function buildReferenceSofa({variant,w,d,h,accent,addBox,addCushion,textile,addSurface}){
 const style=sofas[variant];if(!style)return false;
 const {bend,chaise,rise,pillows}=style;
 const center=t=>.11-bend*Math.sin(Math.PI*t);
 const shell=(start,end,columns,profile)=>addSurface(columns,24,(u,v)=>{
  const t=start+(end-start)*u;
  const angle=-v*2*Math.PI;
  const rounded=Math.max(.001,Math.min(1,(u/.075),(1-u)/.075));
  const taper=Math.sqrt(rounded*(2-rounded));
  const [y,z,radiusY,radiusZ]=profile(t);
  return {x:(t-.5)*w,y:d*Math.max(-.495,Math.min(.495,y+radiusY*taper*Math.cos(angle))),z:h*(z+radiusZ*taper*Math.sin(angle))};
 },accent);
 shell(.015,.985,56,t=>[center(t),.29,.30+chaise*(1-t)**2,.215]);
 if(variant==='cloud-modular'){
  for(let i=0;i<3;i++){
   const x=(i-1)*w*.303;
   addCushion(w*.297,d*.60,h*.19,x,d*.11,h*.46,accent);
   addCushion(w*.30,d*.20,h*.49,x,-d*.31,h*.72,accent);
  }
  for(const side of [-1,1]) addCushion(w*.075,d*.72,h*.43,w*.443*side,-d*.03,h*.50,accent);
 }else{
  shell(.025,.975,56,t=>[center(t)+.035,.43,.27+chaise*(1-t)**2,.129]);
  shell(variant==='crescent-chaise'?.16:.03,.98,56,t=>{
   const curlEnd=.20*Math.abs(2*t-1)**3;
   return [center(t)-.27+curlEnd,.645,.125,.295*rise];
  });
 }
 for(const x of [-.34,.34])for(const y of [-.075,.17])
  addBox(.055,.05,h*.10,w*x,d*y,h*.05,accent);
 for(let i=0;i<pillows.length;i++){
  const t=variant==='crescent-chaise'?.56+i*.135:.27+i*.46;
  const pillow=addCushion(w*.126,d*.19,h*.25,(t-.5)*w,d*(center(t)-.11),h*.65,textile(pillows[i]));
  pillow.rotation.x=.29;
 }
 return true;
}
