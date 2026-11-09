// Evidence-only classification views: do not add/remove geometric candidates.
// Separate source strokes, filled wall bands and alternative representations so
// dense ID labels do not hide actual walls in photographed or hand-drawn plans.
import sharp from 'sharp';

const intersects=(candidate,viewport)=>{
 const a=candidate.start,b=candidate.end;
 if(!a||!b)return false;
 let lo=0,hi=1;
 for(const [origin,delta,min,max] of [[a.x,b.x-a.x,viewport.left,viewport.right],[a.y,b.y-a.y,viewport.top,viewport.bottom]]){
  if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return false;continue;}
  const t1=(min-origin)/delta,t2=(max-origin)/delta;
  lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
  if(lo>hi)return false;
 }
 return true;
};
const point=(c,t)=>({x:c.start.x+(c.end.x-c.start.x)*t,y:c.start.y+(c.end.y-c.start.y)*t});
const clipCenter=(c,v)=>{
 let lo=0,hi=1;
 for(const [origin,delta,min,max] of [[c.start.x,c.end.x-c.start.x,v.left,v.right],[c.start.y,c.end.y-c.start.y,v.top,v.bottom]]){
  if(Math.abs(delta)<1e-9)continue;
  const t1=(min-origin)/delta,t2=(max-origin)/delta;
  lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
 }
 return point(c,(lo+hi)/2);
};
const groupOf=c=>c.kind==='stroke'?'stroke':c.kind==='solid_band'?'solid_band':c.kind==='face_pair'?'face_pair':'fragments';

export function pixelClassificationViewLayout(graph,{maxViews=6}={}){
 const width=graph.imageWidth,height=graph.imageHeight;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid pixel graph frame.');
 const groups=['stroke','solid_band','face_pair','fragments'].map(kind=>({kind,items:graph.candidates.filter(c=>groupOf(c)===kind)})).filter(g=>g.items.length);
 if(!groups.length)return [];
 const budget=Math.max(groups.length,Math.min(6,Math.floor(maxViews)));
 const allocations=groups.map(g=>({group:g,views:1}));
 let remaining=budget-allocations.length;
 for(const entry of [...allocations].sort((a,b)=>b.group.items.length-a.group.items.length)){
  if(!remaining)break;
  if(entry.group.items.length>=80){entry.views=2;remaining--;}
 }
 const result=[];
 for(const entry of allocations){
  const split=entry.views===2,vertical=height>=width;
  for(let n=0;n<entry.views;n++){
   const viewport=split?(vertical?
    {left:0,top:Math.floor(n*height/2),right:width,bottom:Math.ceil((n+1)*height/2)}:
    {left:Math.floor(n*width/2),top:0,right:Math.ceil((n+1)*width/2),bottom:height}):
    {left:0,top:0,right:width,bottom:height};
   // Small overlap preserves labels beside lines crossing an internal tile seam.
   if(split){const pad=20;viewport.left=Math.max(0,viewport.left-pad);viewport.top=Math.max(0,viewport.top-pad);viewport.right=Math.min(width,viewport.right+pad);viewport.bottom=Math.min(height,viewport.bottom+pad);}
   const items=entry.group.items.filter(c=>intersects(c,viewport));
   if(items.length)result.push({kind:entry.group.kind,viewport,candidateIds:items.map(c=>c.id)});
  }
 }
 return result;
}
export function pixelClassificationOverlay(graph,view){
 const {viewport:v,candidateIds}=view,ids=new Set(candidateIds),labels=[];
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const paths=graph.candidates.filter(c=>ids.has(c.id)).map(c=>{
  const p=clipCenter(c,v),w=Math.min(v.right-v.left-4,c.id.length*6+4);
  let chosen=null;
  for(let step=0;step<80;step++){
   const offset=step?((step%2?1:-1)*Math.ceil(step/2)*13):-5;
   const x=Math.max(v.left+2,Math.min(v.right-w-2,p.x)),y=Math.max(v.top+12,Math.min(v.bottom-2,p.y+offset));
   const b={left:x,right:x+w,top:y-11,bottom:y+2};
   if(!labels.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top)){chosen={x,y};labels.push(b);break;}
  }
  chosen??={x:p.x,y:p.y};
  const stroke=c.kind==='solid_band'?'#d88400':c.kind==='face_pair'?'#8e3dbe':c.kind==='stroke'?'#087bbf':'#b04453';
  return `<g stroke="${stroke}"><path d="M${c.start.x} ${c.start.y}L${c.end.x} ${c.end.y}" opacity=".8"/><path d="M${p.x} ${p.y}L${chosen.x} ${chosen.y}" stroke-width=".5"/><text x="${chosen.x}" y="${chosen.y}" fill="#074477" stroke="white" stroke-width="2" paint-order="stroke" font-size="11">${escape(c.id)}</text></g>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.imageWidth}" height="${graph.imageHeight}" viewBox="0 0 ${graph.imageWidth} ${graph.imageHeight}"><g fill="none" stroke-width="1.2" font-family="sans-serif">${paths}</g></svg>`;
}
export async function pixelClassificationDetailViews(buffer,graph,views=pixelClassificationViewLayout(graph)){
 const images=[];
 for(const view of views){
  const {left,top,right,bottom}=view.viewport;
  const data=await sharp(buffer).composite([{input:Buffer.from(pixelClassificationOverlay(graph,view))}]).png().toBuffer();
  const cropped=await sharp(data).extract({left,top,width:right-left,height:bottom-top}).jpeg({quality:82,chromaSubsampling:'4:4:4'}).toBuffer();
  images.push('data:image/jpeg;base64,'+cropped.toString('base64'));
 }
 return images;
}
