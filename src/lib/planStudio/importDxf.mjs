import {id,newDocument,validateDocument} from './document.mjs';
import {at,dist,EPS,norm,TAU,validPolygon} from './geometry.mjs';

export const DXF_UNIT_OPTIONS=[['mm','Millimetres','میلی‌متر'],['cm','Centimetres','سانتی‌متر'],['m','Metres','متر'],['in','Inches','اینچ'],['ft','Feet','فوت']];
const unitScale={mm:.001,cm:.01,m:1,in:.0254,ft:.3048};
const headerScale={1:.0254,2:.3048,3:1609.344,4:.001,5:.01,6:1,7:1000,8:2.54e-8,9:2.54e-5,10:.9144,11:1e-10,12:1e-9,13:1e-6,14:.1,15:10,16:100,17:1e9,21:1200/3937};
const fontText=s=>s.replace(/\\U\+([\da-f]{4})/ig,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\P/g,'\n');
const group=(pairs,code)=>pairs.find(([key])=>key===code)?.[1];
const num=(pairs,code,fallback=NaN)=>Number(group(pairs,code)??fallback);
const rgb=n=>'#'+n.toString(16).padStart(6,'0');
const aci=['','#e95959','#efcf45','#69c97c','#53cdcf','#6997e8','#d572d7','#dce6ed','#898e92','#aeb8bd'];

function readAscii(text){
 if(text.startsWith('AutoCAD Binary DXF'))throw Error('Save the DXF as ASCII before opening. / فایل DXF را با فرمت ASCII ذخیره کن.');
 const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);
 if(!lines.at(-1)?.trim()&&lines.length%2===1)lines.pop();
 if(lines.length%2!==0)throw Error('Invalid DXF group pairs. / ساختار فایل DXF معتبر نیست.');
 const pairs=[];
 for(let i=0;i<lines.length;i+=2){
  if(!/^\s*\d+\s*$/.test(lines[i]))throw Error('Invalid ASCII DXF. / فایل DXF معتبر نیست.');
  pairs.push([Number(lines[i]),lines[i+1].trim()]);
 }
 return pairs;
}

function records(pairs){
 const sections=new Map();let current, item;
 for(let i=0;i<pairs.length;i++){
  const [code,value]=pairs[i];
  if(code===0&&value==='SECTION'&&pairs[i+1]?.[0]===2){
   const name=pairs[++i][1];
   current=sections.get(name)??[];
   sections.set(name,current);
   item=null;
  }else if(code===0&&value==='ENDSEC'){
   current=null;
  }else if(current&&code===0){
   item={type:value,groups:[]};
   current.push(item);
  }else if(current&&item)item.groups.push([code,value]);
 }
 return sections;
}

export function readDxf(text){
 const pairs=readAscii(text), sections=records(pairs);
 const entities=sections.get('ENTITIES'), locations=sections.get('TABLES')??[];
 if(!entities)throw Error('DXF has no ENTITIES section. / بخش هندسه در فایل DXF پیدا نشد.');
 const units=pairs.findIndex(([k,v])=>k===9&&v==='$INSUNITS');
 return {scale:units<0?undefined:headerScale[pairs[units+1]?.[1]],entities,
  layers:locations.filter(record=>record.type==='LAYER').map(record=>record.groups)};
}

function polyVertices(groups){
 const vertices=[];
 for(const [key,value] of groups){
  if(key===10)vertices.push({x:Number(value),y:NaN,bulge:0});
  if(key===20&&vertices.length)vertices.at(-1).y=Number(value);
  if(key===42&&vertices.length)vertices.at(-1).bulge=Number(value);
 }
 return vertices;
}

function tessellate(vertices,closed){
 const points=[];
 for(let i=0;i<vertices.length;i++){
  const {x,y,bulge}=vertices[i],a={x,y};
  if(!points.length||dist(points.at(-1),a)>EPS)points.push(a);
  if(!bulge||(!closed&&i===vertices.length-1))continue;
  const b=vertices[(i+1)%vertices.length], chord=dist(a,b);
  if(chord<=EPS)continue;
  const h=chord*(1-bulge*bulge)/(4*bulge);
  const center={x:(x+b.x)/2-(b.y-y)*h/chord,y:(y+b.y)/2+(b.x-x)*h/chord};
  const arc={type:'arc',center,radius:dist(a,center),start:Math.atan2(y-center.y,x-center.x),sweep:4*Math.atan(bulge)};
  const steps=Math.ceil(Math.abs(arc.sweep)/(Math.PI/24));
  for(let j=1;j<steps;j++)points.push(at(arc,j/steps));
  if(points.length>300)return [];
 }
 if(closed&&points.length>2&&dist(points[0],points.at(-1))<=EPS)points.pop();
 return points;
}

function toGeometry(type,g,scale,legacy){
 const atPoint=(x,y)=>({x:num(g,x)*scale,y:num(g,y)*scale});
 const base=atPoint(10,20);
 if(type==='LINE'){
  const b=atPoint(11,21);
  if(dist(base,b)>EPS)return {type:'line',a:base,b};
 }
 if(type==='LWPOLYLINE'||type==='POLYLINE'){
  const flags=num(g,70,0);
  if(type==='POLYLINE'&&(flags&120))return;
  const vertices=(legacy??polyVertices(g)).map(p=>({...p,x:p.x*scale,y:p.y*scale}));
  const closed=Boolean(flags&1);
  const points=tessellate(vertices,closed);
  if(points.length>=2&&points.length<=300&&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))&&(!closed||validPolygon(points)))return {type:'polyline',points,closed};
 }
 if(type==='CIRCLE'||type==='ARC'){
  const radius=num(g,40)*scale, start=type==='ARC'?num(g,50)*Math.PI/180:0;
  const sweep=type==='ARC'?norm(num(g,51)*Math.PI/180-start):TAU;
  if(radius>.0001&&sweep>EPS&&Number.isFinite(base.x)&&Number.isFinite(base.y))return {type:type.toLowerCase(),center:base,radius,start,sweep};
 }
 if(type==='TEXT'||type==='MTEXT'){
  const value=fontText(g.filter(([key])=>key===1||key===3).map(pair=>pair[1]).join('')).slice(0,1000);
  if(value.trim()&&[base.x,base.y,num(g,40)].every(Number.isFinite))return {type:'text',position:base,text:value,textHeight:Math.min(10,Math.max(.005,num(g,40)*scale)),rotation:num(g,50,0)};
 }
}

export function importDxf(source,name,unit){
 const scale=unit?unitScale[unit]:source.scale;
 if(!scale)throw Error('Choose the drawing units for this DXF. / واحد نقشهٔ DXF را انتخاب کن.');
 const doc=newDocument(name.slice(0,160));
 const layers=new Map(), layerDefs=new Map(source.layers.map(g=>[group(g,2),g]));
 const skipped=new Map();
 const omit=type=>skipped.set(type,(skipped.get(type)??0)+1);
 const style=g=>{
  const color=num(g,420), indexed=aci[num(g,62)];
  return Number.isInteger(color)&&color>=0&&color<=0xffffff?rgb(color):indexed??'bylayer';
 };
 const layerFor=name=>{
  if(layers.has(name))return layers.get(name);
  if(doc.layers.length>=80)throw Error('The drawing has too many CAD layers for Plan Studio. / تعداد لایه‌های فایل بیش از ظرفیت پلن‌ساز است.');
  const src=layerDefs.get(name)??[], color=num(src,420), index=num(src,62,7), layerId='cad-'+layers.size;
  doc.layers.push({id:layerId,name:fontText(name).slice(0,80),color:Number.isInteger(color)&&color>=0&&color<=0xffffff?rgb(color):aci[Math.abs(index)]??'#a9bfcc',
    dash:'solid',weight:.25,visible:index>=0&&!(num(src,70,0)&1),locked:Boolean(num(src,70,0)&4)});
  layers.set(name,layerId);
  return layerId;
 };
 for(let i=0;i<source.entities.length;i++){
  const {type,groups:g}=source.entities[i];
  let vertices;
  const paper=num(g,67,0)===1||!/^model$/i.test(group(g,410)??'Model');
  if(type==='POLYLINE'){
   vertices=[];
   while(source.entities[i+1]?.type==='VERTEX'){
    const v=source.entities[++i].groups;
    vertices.push({x:num(v,10),y:num(v,20),bulge:num(v,42,0)});
   }
   if(source.entities[i+1]?.type==='SEQEND')i++;
  }
  if(paper)continue;
  const normal=[num(g,210,0),num(g,220,0),num(g,230,1)];
  const entity=normal.every((value,index)=>value===(index===2?1:0))?toGeometry(type,g,scale,vertices):null;
  if(!entity){omit(type);continue;}
  doc.entities.push({...entity,role:entity.type==='text'?undefined:'line',id:id(),layer:layerFor(group(g,8)||'0'),color:style(g)});
  if(doc.entities.length>2000)throw Error('DXF exceeds the 2,000 editable entities in a Plan Studio drawing. / فایل بیش از ۲۰۰۰ جزء قابل ویرایش دارد.');
 }
 if(!doc.entities.length)throw Error('No supported 2D model-space geometry found in this DXF. / هندسهٔ دوبعدی قابل ویرایش در فضای مدل DXF پیدا نشد.');
 // CAD survey coordinates can exceed the editor's drawing range. Translate only when needed.
 const locations=doc.entities.flatMap(e=>e.points??[e.a,e.b,e.center,e.position].filter(Boolean));
 if(locations.some(p=>Math.abs(p.x)>10000||Math.abs(p.y)>10000)){
  const first=locations[0];
  const offset={...first};
  for(const p of locations){p.x-=offset.x;p.y-=offset.y;}
  doc.cadOriginMeters=offset;
 }
 return {doc:validateDocument(doc),skipped};
}
