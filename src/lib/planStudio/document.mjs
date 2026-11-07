import {point,dist,validPolygon,segments,at,sub,EPS} from './geometry.mjs';
export const SCHEMA='ventra-plan-studio/1';
export const HATCHES=['diagonal','cross','concrete','steel','brick','interlock','sand','insulation','solid'];
export const id=()=>globalThis.crypto.randomUUID();
export const DEFAULT_LAYERS=[['architecture','Architecture','معماری','#dce6ed'],['mechanical','Mechanical','مکانیک','#faac59'],['electrical','Electrical','برق','#ffe04c'],['fluids','Fluids / piping','سیالات و لوله','#52c6ef'],['dimensions','Dimensions','اندازه‌گذاری','#b593fc'],['furniture','Furniture','مبلمان','#78d9a2'],['notes','Notes','یادداشت','#d8dce2']].map(([id,name,fa,color])=>({id,name,fa,color,visible:true,locked:false,weight:.25,dash:'solid'}));
export function newDocument(name='Untitled plan'){return {schema:SCHEMA,id:id(),name,units:'cm',printScale:50,layers:structuredClone(DEFAULT_LAYERS),entities:[],lighting:{intensity:1,color:'#fff2d7'},createdAt:new Date().toISOString()};}
export function lengthValue(text,units='cm'){
 const s=String(text).trim().replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))),m=s.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m|in|inch|\")?$/i);if(!m)throw Error('Enter a number, optionally mm/cm/m/in. / مقدار عددی با واحد وارد کن.');
 const unit=(m[2]||units).toLowerCase(),value=Number(m[1])*({m:1,cm:.01,mm:.001,in:.0254,inch:.0254,'"':.0254}[unit]);if(!Number.isFinite(value)||Math.abs(value)>20000)throw Error('Length outside supported range.');return value;
}
export function displayLength(value,units='cm'){return (value/(units==='in'?.0254:.01)).toLocaleString('en',{maximumFractionDigits:3})+(units==='in'?' in':' cm');}
export function parsePoint(text,origin,units,cursor){
 let s=String(text).trim().replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))),relative=s.startsWith('@');if(relative)s=s.slice(1);
 const base=relative?origin||{x:0,y:0}:{x:0,y:0};let p;
 if(s.includes('<')){const [d,a,...rest]=s.split('<');if(rest.length||!Number.isFinite(Number(a)))throw Error('Use @length<angle.');const l=lengthValue(d,units),r=Number(a)*Math.PI/180;p={x:base.x+l*Math.cos(r),y:base.y+l*Math.sin(r)};}
 else if(s.includes(',')){const a=s.split(',');if(a.length!==2)throw Error('Use x,y coordinates.');p={x:base.x+lengthValue(a[0],units),y:base.y+lengthValue(a[1],units)};}
 else{if(!origin||!cursor||dist(origin,cursor)<EPS)throw Error('Specify direction or use x,y / @length<angle.');const l=lengthValue(s,units),v=sub(cursor,origin),d=dist(origin,cursor);p={x:origin.x+v.x/d*l,y:origin.y+v.y/d*l};}
 if(!point(p))throw Error('Coordinates outside drawing range.');return p;
}
export function visibleEntities(doc){return doc.entities.filter(e=>doc.layers.find(l=>l.id===e.layer)?.visible!==false);}
export function styleFor(doc,e){const l=doc.layers.find(l=>l.id===e.layer)||DEFAULT_LAYERS[0];return{color:e.color&&e.color!=='bylayer'?e.color:l.color,weight:e.weight||l.weight,dash:e.dash&&e.dash!=='bylayer'?e.dash:l.dash};}
export function validateDocument(input){
 if(!input||input.schema!==SCHEMA||!Array.isArray(input.layers)||input.layers.length<1||input.layers.length>80||!Array.isArray(input.entities)||input.entities.length>2000)throw Error('Not a supported Ventra plan document. / فایل پلان معتبر نیست.');
 const d=structuredClone(input);d.lighting??={intensity:1,color:'#fff2d7'};if(!['cm','in'].includes(d.units)||![10,20,25,50,100,200,500].includes(d.printScale)||typeof d.name!=='string'||d.name.length>160||typeof d.id!=='string'||d.id.length>100)throw Error('Invalid drawing settings.');
 const ids=new Set(),layerIds=new Set();for(const l of d.layers){if(typeof l.id!=='string'||layerIds.has(l.id)||!/^#[0-9a-f]{6}$/i.test(l.color)||typeof l.name!=='string'||l.name.length>80||!['solid','dashed','center'].includes(l.dash)||!Number.isFinite(l.weight)||l.weight<.05||l.weight>2)throw Error('Invalid drawing layer.');l.visible=l.visible!==false;l.locked=l.locked===true;layerIds.add(l.id);}
 for(const e of d.entities){
  if(!e.id||ids.has(e.id)||!layerIds.has(e.layer))throw Error('Invalid entity ID or layer.');ids.add(e.id);if(e.color&&e.color!=='bylayer'&&!/^#[0-9a-f]{6}$/i.test(e.color))throw Error('Invalid entity color.');
  if(['line','dimension'].includes(e.type)){if(!point(e.a)||!point(e.b)||dist(e.a,e.b)<EPS)throw Error('Invalid line or dimension.');}
  else if(e.type==='polyline'){if(!Array.isArray(e.points)||e.points.length<2||e.points.length>300||e.points.some(p=>!point(p))||e.points.some((p,i)=>i>0&&dist(p,e.points[i-1])<EPS))throw Error('Invalid polyline.');if(e.closed&&!validPolygon(e.points))throw Error('Closed outline intersects itself or has zero area.');}
  else if(['arc','circle'].includes(e.type)){if(!point(e.center)||!Number.isFinite(e.radius)||e.radius<=.0001||e.radius>10000||!Number.isFinite(e.start)||!Number.isFinite(e.sweep)||Math.abs(e.sweep)>Math.PI*2+EPS||Math.abs(e.sweep)<EPS)throw Error('Invalid circle or arc.');}
  else if(e.type==='text'){if(!point(e.position)||typeof e.text!=='string'||e.text.length>1000||!e.text.trim()||!Number.isFinite(e.textHeight)||e.textHeight<.005||e.textHeight>10)throw Error('Invalid annotation.');}
  else if(['asset','plate','light'].includes(e.type)){if(!point(e.center))throw Error('Invalid object position.');if(e.type==='asset'&&(typeof e.catalogId!=='string'||![e.width,e.depth,e.height].every(n=>Number.isFinite(n)&&n>0&&n<=50)))throw Error('Invalid furniture size.');if(e.type==='plate'){if(![e.width,e.depth,e.thickness,e.boltDiameter,e.edge].every(n=>Number.isFinite(n)&&n>0)||e.width>20||e.depth>20||e.thickness>1||e.edge<=e.boltDiameter/2||e.edge+e.boltDiameter/2>=Math.min(e.width,e.depth)/2)throw Error('Base plate holes do not fit within the plate. / ابعاد سوراخ‌ها یا فاصلهٔ لبهٔ بیس‌پلیت معتبر نیست.');}}
  else if(e.type==='opening'){if(!d.entities.some(w=>w.id===e.wall&&w.role==='wall'&&w.type==='line')||!Number.isFinite(e.offset)||e.offset<0||e.offset>1||![e.width,e.height].every(n=>Number.isFinite(n)&&n>0)||!['door','window','arched'].includes(e.kind))throw Error('Invalid wall opening.');}
  else throw Error('Unsupported plan entity.');
  if(e.type==='opening'){const w=d.entities.find(x=>x.id===e.wall),length=dist(w.a,w.b);if(e.offset*length<e.width/2-EPS||(1-e.offset)*length<e.width/2-EPS||e.height+(e.z||0)>w.height+EPS||e.width/2>e.height&&e.kind==='arched')throw Error('Opening does not fit inside the wall.');const overlaps=d.entities.some(o=>o.id!==e.id&&o.type==='opening'&&o.wall===e.wall&&Math.abs(o.offset-e.offset)*length<(o.width+e.width)/2-EPS);if(overlaps)throw Error('Wall openings overlap.');}
  for(const k of ['rotation','z','height','thickness','diameter','hatchScale','intensity','offsetDistance'])if(e[k]!==undefined&&(!Number.isFinite(e[k])||Math.abs(e[k])>10000))throw Error('Invalid entity property.');
  if(e.role==='wall'&&!['line','arc'].includes(e.type))throw Error('A wall must be a straight line or arc.');
  if(e.role==='wall'&&e.type==='arc'&&e.radius<=e.thickness/2)throw Error('Curved wall radius must exceed half its thickness.');
  if(e.role==='wall'&&(!(e.height>0&&e.height<=30)||!(e.thickness>=.02&&e.thickness<=2)))throw Error('Wall height/thickness outside supported range.');if(e.role==='floor'&&(e.type!=='polyline'||!e.closed))throw Error('Floor needs a closed outline.');if(e.hatch&&!HATCHES.includes(e.hatch))throw Error('Unknown hatch pattern.');if(e.hatchScale!==undefined&&!(e.hatchScale>=.01&&e.hatchScale<=10))throw Error('Invalid hatch scale.');
 }
 if(d.lighting&&(!Number.isFinite(d.lighting.intensity)||d.lighting.intensity<0||d.lighting.intensity>5||!/^#[0-9a-f]{6}$/i.test(d.lighting.color)))throw Error('Invalid lighting.');return d;
}
export function transformEntity(e,kind,base,value){
 const convert=p=>{const v=sub(p,base);if(kind==='move'||kind==='copy')return{x:p.x+value.x,y:p.y+value.y};if(kind==='rotate'){const a=value*Math.PI/180;return{x:base.x+v.x*Math.cos(a)-v.y*Math.sin(a),y:base.y+v.x*Math.sin(a)+v.y*Math.cos(a)};}return{x:base.x+v.x*value,y:base.y+v.y*value};};
 const n=structuredClone(e);for(const key of ['a','b','center','position'])if(n[key])n[key]=convert(n[key]);if(n.points)n.points=n.points.map(convert);if(kind==='rotate'){n.rotation=(n.rotation||0)+value;if(['arc','circle'].includes(n.type))n.start+=value*Math.PI/180;}
 if(kind==='scale'){if(!Number.isFinite(value)||value<=.001||value>1000)throw Error('Use a positive scale factor.');for(const key of ['radius','width','depth','height','thickness','boltDiameter','edge','diameter','textHeight','offsetDistance','hatchScale'])if(n[key]!==undefined)n[key]*=value;}
 return n;
}
