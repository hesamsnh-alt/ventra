import {visibleEntities} from './document.mjs';
import {drawingSVG} from './render2d.mjs';
import {identifyMultilinePair} from './multilineWalls.mjs';

const number=value=>Number(value.toFixed(4)).toString();
const point=p=>`(${number(p.x)},${number(p.y)})`;
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// A raster snapshot otherwise loses the dimensions already authored in the CAD
// document. Print those values beside the plan without changing the saved drawing.
export function drawingMeasurementNotes(doc){
 const entities=visibleEntities(doc),rows=['PLAN STUDIO DRAWING SPECIFICATIONS','All coordinates and dimensions below are in metres.'];
 const groups=new Map();
 for(const entity of entities){
  if(entity.mlGroup){
   if(!groups.has(entity.mlGroup))groups.set(entity.mlGroup,[]);
   groups.get(entity.mlGroup).push(entity);
  }
 }
 let wallIndex=0;
 const wall=(points,closed,height,thickness,z)=>{
  rows.push(`W${++wallIndex}: wall ${closed?'closed centreline':'centreline'}`);
  rows.push(points.map(point).join(' > '));
  rows.push(`Height ${number(height)} m; thickness ${number(thickness)} m; base level ${number(z)} m`);
 };
 for(const items of groups.values()){
  const faces=[0,1].map(side=>items.filter(e=>e.mlSide===side&&e.role!=='wall'));
  const [a,b]=faces.map(side=>side.length===1?side[0]:null),pair=identifyMultilinePair(a,b);
  if(pair&&!a.mlDrafting&&!b.mlDrafting){
   wall(a.points.map((p,i)=>({x:(p.x+b.points[i].x)/2,y:(p.y+b.points[i].y)/2})),
    a.closed,a.height??3,pair.thickness,a.z??0);
  }else{
   for(const face of items.filter(e=>e.type==='polyline'&&e.role!=='wall'&&!e.mlDrafting)){
    if(!Number.isFinite(face.mlThickness))continue;
    rows.push(`W${++wallIndex}: wall face path (not centreline)`);
    rows.push(face.points.map(point).join(' > ')+(face.closed?' > CLOSED':''));
    rows.push(`Height ${number(face.height??3)} m; thickness ${number(face.mlThickness)} m; base level ${number(face.z??0)} m`);
   }
  }
 }
 for(const e of entities.filter(e=>e.role==='wall')){
  if(e.type==='line')wall([e.a,e.b],false,e.height,e.thickness,e.z??0);
  if(e.type==='arc'){
   rows.push(`W${++wallIndex}: curved wall; centre ${point(e.center)}; radius ${number(e.radius)} m`);
   rows.push(`Start ${number(e.start)} rad; sweep ${number(e.sweep)} rad; height ${number(e.height)} m; thickness ${number(e.thickness)} m`);
  }
 }
 for(const e of entities.filter(e=>e.type==='opening')){
  const host=entities.find(w=>w.id===e.wall);
  if(!host)continue;
  const centre={x:host.a.x+(host.b.x-host.a.x)*e.offset,y:host.a.y+(host.b.y-host.a.y)*e.offset};
  rows.push(`${e.kind==='window'?'WINDOW':'DOOR'} at ${point(centre)}: width ${number(e.width)} m, height ${number(e.height)} m, sill ${number(e.z??0)} m`);
 }
 return wallIndex?rows:[];
}

export function analysisDrawingSVG(doc){
 const notes=drawingMeasurementNotes(doc);
 if(!notes.length)return drawingSVG(doc,{print:true,width:3000,height:2000});
 let lines=notes.flatMap(row=>{
  const words=row.split(' '),out=[];let text='';
  for(const word of words){
   if(text.length+word.length>66){out.push(text);text='';}
   text+=(text?' ':'')+word;
  }
  if(text)out.push(text);
  return out;
 });
 // Keep a single raster within a practical canvas size. Dense drawings keep
 // their ordinary image and an explicit notice, rather than a clipped schedule.
 if(lines.length>160)lines=[
  'PLAN STUDIO DRAWING SPECIFICATIONS',
  'The complete measurement schedule is too dense for one image.',
  'Use the DXF export to retain all numeric wall and opening geometry.',
 ];
 const height=Math.max(2000,100+lines.length*30);
 const plan=drawingSVG(doc,{print:true,width:2000,height:2000});
 const text=lines.map((line,i)=>`<text x="2040" y="${60+i*30}" font-family="Arial,sans-serif" font-size="22" fill="#111">${escape(line)}</text>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="${height}" viewBox="0 0 3000 ${height}"><rect width="3000" height="${height}" fill="white"/>${plan}<line x1="2010" y1="30" x2="2010" y2="${height-30}" stroke="#bbb"/>${text}</svg>`;
}
