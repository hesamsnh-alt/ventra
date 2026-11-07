import {id,newDocument,validateDocument,parsePoint,lengthValue} from './document.mjs';
import {dist,point,segments,nearest,curveIntersections,arc3,inside,trimCurve,extendCurve,extrimCurve,offsetCurve,at,TAU,EPS} from './geometry.mjs';
import {transformEntity} from './document.mjs';
export const ALIASES={L:'LINE',LINE:'LINE',PL:'PLINE',PLINE:'PLINE',W:'WALL',WALL:'WALL',FLOOR:'FLOOR',PIPE:'PIPE',REC:'RECTANG',RECTANG:'RECTANG',C:'CIRCLE',CIRCLE:'CIRCLE',A:'ARC',ARC:'ARC',TR:'TRIM',TRIM:'TRIM',EX:'EXTEND',EXTEND:'EXTEND',EXTRIM:'EXTRIM',O:'OFFSET',OFFSET:'OFFSET',M:'MOVE',MOVE:'MOVE',CO:'COPY',CP:'COPY',COPY:'COPY',RO:'ROTATE',ROTATE:'ROTATE',SC:'SCALE',SCALE:'SCALE',E:'ERASE',ERASE:'ERASE',H:'HATCH',HATCH:'HATCH',T:'TEXT',TEXT:'TEXT',MT:'TEXT',MTEXT:'TEXT',DLI:'DIMLINEAR',DIM:'DIMLINEAR',DIMLINEAR:'DIMLINEAR',DI:'DIST',DIST:'DIST',BP:'BASEPLATE',BASEPLATE:'BASEPLATE',DOOR:'DOOR',WINDOW:'WINDOW',ARCHDOOR:'ARCHDOOR',LIGHT:'LIGHT',U:'UNDO',UNDO:'UNDO',REDO:'REDO',SELECT:'SELECT',ESC:'SELECT',Z:'ZOOM',ZOOM:'ZOOM'};
export function editorState(doc=newDocument()){return{doc:validateDocument(doc),activeLayer:doc.layers.some(l=>l.id==='architecture')?'architecture':doc.layers[0].id,selection:[],command:'SELECT',phase:'',points:[],boundary:[],history:[],future:[],log:['Ventra Plan Studio · L / PL / TR / EX / EXTRIM · Enter / Esc'],options:{wallHeight:3,thickness:.15,z:0,color:'bylayer',hatch:'diagonal',hatchScale:.2,text:'Text',textHeight:.2,plateWidth:.4,plateDepth:.4,plateThickness:.02,boltDiameter:.02,edge:.06,openingWidth:.9,openingHeight:2.1,diameter:.05},ortho:false,snap:true,grid:.1,cursor:null};}
export function commitDocument(s,doc,message='Saved edit'){
 const next=validateDocument(doc);if(JSON.stringify(next)===JSON.stringify(s.doc))return s;return{...s,doc:next,history:[...s.history,s.doc].slice(-80),future:[],log:[...s.log,message].slice(-50)};
}
const note=(s,message)=>({...s,log:[...s.log,message].slice(-50)});
const finish=(s)=>({...s,command:'SELECT',phase:'',points:[],boundary:[]});
function layerGuard(s,ids=s.selection){for(const e of s.doc.entities.filter(e=>ids.includes(e.id)))if(s.doc.layers.find(l=>l.id===e.layer)?.locked)throw Error('Unlock the layer first. / ابتدا لایه را باز کن.');}
function add(s,entities,message){const l=s.doc.layers.find(l=>l.id===s.activeLayer);if(l?.locked)throw Error('Current layer is locked.');return commitDocument(s,{...s.doc,entities:[...s.doc.entities,...entities.map(e=>({id:id(),layer:s.activeLayer,color:s.options.color,...e}))]},message);}
function reboundOpenings(target,fragments,children){return children.flatMap(o=>{const p=at(target,o.offset),fragment=fragments.find(f=>f.type==='line'&&f.role==='wall'&&(()=>{const n=nearest(f,p),l=dist(f.a,f.b);return n.distance<EPS&&n.t*l>=o.width/2-EPS&&(1-n.t)*l>=o.width/2-EPS;})());return fragment?[{...o,wall:fragment.id,offset:nearest(fragment,p).t}]:[];});}
function replace(s,target,replacements,message){const children=s.doc.entities.filter(e=>e.type==='opening'&&e.wall===target.id),ids=new Set([target.id,...children.map(e=>e.id)]);layerGuard(s,[...ids]);const fragments=replacements.map(e=>({...e,id:id()})),openings=target.type==='line'?reboundOpenings(target,fragments,children):[];return commitDocument(s,{...s.doc,entities:s.doc.entities.filter(e=>!ids.has(e.id)).concat(fragments,openings)},message+(openings.length<children.length?' · opening in removed wall part removed':''));}
export function startCommand(s,raw){
 const command=ALIASES[String(raw).toUpperCase().replace(/^_/, '')];if(!command)throw Error('Unknown command. / فرمان ناشناخته است.');
 if(command==='UNDO')return s.history.length?{...finish(s),doc:s.history.at(-1),history:s.history.slice(0,-1),future:[s.doc,...s.future],selection:[]}:note(s,'Nothing to undo.');
 if(command==='REDO')return s.future.length?{...finish(s),doc:s.future[0],history:[...s.history,s.doc],future:s.future.slice(1),selection:[]}:note(s,'Nothing to redo.');
 if(command==='SELECT'||command==='ZOOM')return {...finish(s),lastCommand:command};
 if(command==='ERASE'){if(!s.selection.length)throw Error('Select objects first.');layerGuard(s);const ids=new Set(s.selection);for(const e of s.doc.entities)if(e.type==='opening'&&ids.has(e.wall))ids.add(e.id);return finish(commitDocument({...s,selection:[]},{...s.doc,entities:s.doc.entities.filter(e=>!ids.has(e.id))},'ERASE'));}
 if(['MOVE','COPY','ROTATE','SCALE'].includes(command)&&!s.selection.length)throw Error('Select objects before this command. / ابتدا اجسام را انتخاب کن.');
 let phase=['TRIM','EXTEND','EXTRIM'].includes(command)?'boundary':command==='OFFSET'?'distance':'';
 return note({...s,command,phase,points:[],boundary:[],value:null,lastCommand:command},command+' → '+(phase||'first point'));
}
export function snappedPoint(s,p,{shift=false,tolerance=.12}={}){
 const from=s.points.at(-1);if((shift||s.ortho)&&from){const dx=Math.abs(p.x-from.x),dy=Math.abs(p.y-from.y);p=dx>=dy?{x:p.x,y:from.y}:{x:from.x,y:p.y};}
 if(!s.snap)return p;let candidates=[];const visible=s.doc.entities.filter(e=>s.doc.layers.find(l=>l.id===e.layer)?.visible!==false);
 for(const e of visible)for(const seg of segments(e)){candidates.push(at(seg,0),at(seg,1),at(seg,.5));if(seg.type!=='line')candidates.push(seg.center);}
 // Intersection snap is bounded to nearby curves; large drawings do not do O(n²) every move.
 const near=visible.filter(e=>(nearest(e,p)?.distance??Infinity)<tolerance*3).slice(0,32);for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++)for(const a of segments(near[i]))for(const b of segments(near[j]))candidates.push(...curveIntersections(a,b));
 candidates=candidates.filter(q=>dist(q,p)<tolerance&&(!(shift||s.ortho)||!from||Math.abs(q.x-from.x)<EPS||Math.abs(q.y-from.y)<EPS));if(candidates.length)return candidates.sort((a,b)=>dist(a,p)-dist(b,p))[0];return p;
}
export function hitEntity(s,p,tolerance=.15){return s.doc.entities.filter(e=>s.doc.layers.find(l=>l.id===e.layer)?.visible!==false).map(e=>{const n=nearest(e,p);let distance=n?.distance??Infinity;if(e.center){distance=Math.min(distance,dist(e.center,p));if(['asset','plate'].includes(e.type)){const a=-(e.rotation||0)*Math.PI/180,dx=p.x-e.center.x,dy=p.y-e.center.y;if(Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=e.width/2&&Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=e.depth/2)distance=0;}}if(e.position)distance=dist(e.position,p);if(e.type==='dimension')distance=nearest({type:'line',a:e.a,b:e.b},p)?.distance??Infinity;return{e,distance};}).filter(x=>x.distance<=tolerance).sort((a,b)=>a.distance-b.distance)[0]?.e;}
function drawRole(s){return s.command==='WALL'?{role:'wall',height:s.options.wallHeight,thickness:s.options.thickness,z:s.options.z}:s.command==='PIPE'?{role:'pipe',diameter:s.options.diameter,z:s.options.z}:{role:'line'};}
export function clickPoint(s,raw,event={}){
 if(!point(raw))throw Error('Invalid point.');const p=event.raw?raw:snappedPoint(s,raw,event),cmd=s.command,hit=event.entityId?s.doc.entities.find(e=>e.id===event.entityId):hitEntity(s,p,event.tolerance),n=s.points.length;
 if(cmd==='SELECT'){const selection=hit?(event.shift?(s.selection.includes(hit.id)?s.selection.filter(i=>i!==hit.id):[...s.selection,hit.id]):[hit.id]):[];return{...s,selection};}
 if(['TRIM','EXTEND'].includes(cmd)){
  if(s.phase==='boundary'){if(!hit)return note(s,'Select cutting/boundary edge, then Enter (or Enter for all).');return{...s,boundary:[...new Set([...s.boundary,hit.id])]};}
  if(!hit)throw Error('Pick the part/end to trim or extend.');const cutters=s.doc.entities.filter(e=>e.id!==hit.id&&(!s.boundary.length||s.boundary.includes(e.id))),operation=event.shift?(cmd==='TRIM'?'EXTEND':'TRIM'):cmd;
  return operation==='TRIM'?replace(s,hit,trimCurve(hit,cutters,p),'TRIM'):replace(s,hit,[extendCurve(hit,cutters,p)],'EXTEND');
 }
 if(cmd==='EXTRIM'){
  if(s.phase==='boundary'){if(!hit||!(hit.type==='circle'||hit.type==='polyline'&&hit.closed))throw Error('Pick a closed polyline/circle boundary.');return{...s,boundary:[hit.id],phase:'side'};}
  const b=s.doc.entities.find(e=>e.id===s.boundary[0]),poly=b.type==='circle'?Array.from({length:96},(_,i)=>at(b,i/96)):b.points,removeInside=inside(p,poly);layerGuard(s,s.doc.entities.filter(e=>e.id!==b.id&&segments(e).length).map(e=>e.id));
  const removedParents=new Set();const entities=s.doc.entities.flatMap(e=>{if(e.id===b.id||!segments(e).length||s.doc.layers.find(l=>l.id===e.layer)?.visible===false)return[e];removedParents.add(e.id);return extrimCurve(e,b,removeInside).map(r=>({...r,id:id(),role:e.role==='floor'?'line':e.role}));}).filter(e=>e.type!=='opening'||!removedParents.has(e.wall));
  return finish(commitDocument(s,{...s.doc,entities},'EXTRIM '+(removeInside?'inside':'outside')));
 }
 if(cmd==='OFFSET'){if(s.phase==='distance')throw Error('Enter offset distance first.');if(s.phase==='object'){if(!hit)throw Error('Pick a line, circle or arc.');return{...s,boundary:[hit.id],phase:'side'};}const e=s.doc.entities.find(e=>e.id===s.boundary[0]);return {...add(s,[{...offsetCurve(e,s.value,p),id:id()}],'OFFSET'),phase:'object',boundary:[]};}
 if(['MOVE','COPY','ROTATE','SCALE'].includes(cmd)){
  if(!n)return{...s,points:[p]};if(cmd==='ROTATE'||cmd==='SCALE')throw Error('Enter rotation angle or scale factor.');
  const v={x:p.x-s.points[0].x,y:p.y-s.points[0].y};return transformSelection(s,cmd.toLowerCase(),v);
 }
 if(cmd==='HATCH'){
  const e=hit?.type==='polyline'&&hit.closed||hit?.type==='circle'?hit:s.doc.entities.slice().reverse().find(e=>e.type==='polyline'&&e.closed&&inside(p,e.points)||e.type==='circle'&&dist(p,e.center)<e.radius);if(!e)throw Error('Hatch needs a closed outline. / محدودهٔ بسته انتخاب کن.');layerGuard(s,[e.id]);return finish(commitDocument(s,{...s.doc,entities:s.doc.entities.map(a=>a.id===e.id?{...a,hatch:s.options.hatch,hatchScale:s.options.hatchScale}:a)},'HATCH'));
 }
 if(cmd==='TEXT')return finish(add(s,[{type:'text',position:p,text:s.options.text,textHeight:s.options.textHeight,rotation:0,layer:'notes'}],'TEXT'));
 if(cmd==='BASEPLATE')return finish(add(s,[{type:'plate',center:p,width:s.options.plateWidth,depth:s.options.plateDepth,thickness:s.options.plateThickness,boltDiameter:s.options.boltDiameter,edge:s.options.edge,rotation:0,z:s.options.z}],'BASEPLATE'));
 if(cmd==='LIGHT')return finish(add(s,[{type:'light',center:p,z:2.7,intensity:1,color:'#fff2d7'}],'LIGHT'));
 if(['DOOR','WINDOW','ARCHDOOR'].includes(cmd)){
  const wall=hit;if(wall?.role!=='wall'||wall.type!=='line')throw Error('Choose a straight wall. / یک دیوار مستقیم انتخاب کن.');const offset=nearest(wall,p).t,width=s.options.openingWidth,l=dist(wall.a,wall.b);if(offset*l<width/2||(1-offset)*l<width/2)throw Error('Opening extends beyond wall ends.');
  return finish(add(s,[{type:'opening',wall:wall.id,offset,width,height:s.options.openingHeight,z:cmd==='WINDOW'?.9:0,kind:cmd==='WINDOW'?'window':cmd==='ARCHDOOR'?'arched':'door'}],cmd));
 }
 if(['LINE','WALL'].includes(cmd)){
  if(!n)return{...s,points:[p]};const last=s.points.at(-1);if(dist(last,p)<EPS)throw Error('Line length must be positive.');return{...add(s,[{type:'line',a:last,b:p,...drawRole(s)}],cmd),points:[...s.points,p]};
 }
 if(['PLINE','FLOOR','PIPE'].includes(cmd)){if(n>=3&&dist(p,s.points[0])<EPS)return submit(s,'C');return{...s,points:[...s.points,p]};}
 if(['RECTANG','CIRCLE','ARC','DIMLINEAR','DIST'].includes(cmd)){
  if(!n)return{...s,points:[p]};const a=s.points[0];if(cmd==='ARC'&&n===1)return{...s,points:[...s.points,p]};
  if(cmd==='DIST')return finish(note({...s,lastDistance:dist(a,p)},'DIST = '+dist(a,p).toFixed(6)+' m'));
  if(cmd==='DIMLINEAR'&&n===1)return{...s,points:[...s.points,p]};
  let e;if(cmd==='RECTANG')e={type:'polyline',points:[a,{x:p.x,y:a.y},p,{x:a.x,y:p.y}],closed:true,role:'line'};
  if(cmd==='CIRCLE')e={type:'circle',center:a,radius:dist(a,p),start:0,sweep:TAU,role:'line'};
  if(cmd==='ARC')e={type:'arc',...arc3(a,s.points[1],p),...drawRole({...s,command:s.options.arcWall?'WALL':'ARC'})};
  if(cmd==='DIMLINEAR'){const b=s.points[1],len=dist(a,b),v={x:(b.x-a.x)/len,y:(b.y-a.y)/len};e={type:'dimension',a,b,offsetDistance:(p.x-a.x)*-v.y+(p.y-a.y)*v.x,layer:'dimensions',color:'bylayer'};}
  return finish(add(s,[e],cmd));
 }
 return s;
}
function transformSelection(s,kind,value){layerGuard(s);const selected=new Set(s.selection),map=new Map();for(const e of s.doc.entities)if(selected.has(e.id))map.set(e.id,id());const items=s.doc.entities.filter(e=>selected.has(e.id));if(items.some(e=>e.type==='opening'))throw Error('Move the parent wall or edit opening properties.');const transformed=items.map(e=>({...transformEntity(e,kind,s.points[0],value),id:kind==='copy'?map.get(e.id):e.id}));let entities=kind==='copy'?[...s.doc.entities,...transformed]:s.doc.entities.map(e=>transformed.find(x=>x.id===e.id)||e);if(kind==='copy')entities.push(...s.doc.entities.filter(e=>e.type==='opening'&&selected.has(e.wall)).map(e=>({...e,id:id(),wall:map.get(e.wall)})));if(kind==='scale')entities=entities.map(e=>e.type==='opening'&&selected.has(e.wall)?{...e,width:e.width*value,height:e.height*value,z:e.z*value}:e);return finish(commitDocument(s,{...s.doc,entities},kind.toUpperCase()));}
export function submit(s,raw){
 const text=String(raw).trim(),upper=text.toUpperCase();if(s.command==='SELECT')return text?startCommand(s,text):s.lastCommand?startCommand(s,s.lastCommand):s;
 if(upper==='ESC')return finish(s);
 if(upper==='U'&&['TRIM','EXTEND'].includes(s.command)){const next=startCommand(s,'UNDO');return{...next,command:s.command,phase:s.phase,boundary:s.boundary};}
 if(['TRIM','EXTEND'].includes(s.command)&&!text)return{...s,phase:'target'};
 if(['LINE','WALL','PLINE','PIPE','FLOOR'].includes(s.command)&&['C','CLOSE'].includes(upper)){
  if(s.points.length<3)throw Error('At least 3 points to close.');if(['LINE','WALL'].includes(s.command)){if(dist(s.points.at(-1),s.points[0])<EPS)return finish(s);const next=clickPoint(s,s.points[0],{raw:true});return finish(next);}return finish(add(s,[{type:'polyline',points:s.points,closed:true,...drawRole(s),...(s.command==='FLOOR'?{role:'floor',height:.12,hatch:s.options.hatch,hatchScale:s.options.hatchScale}: {})}],s.command+' Close'));
 }
 if(['LINE','WALL','PLINE','PIPE','FLOOR'].includes(s.command)&&upper==='U')return s.command==='LINE'||s.command==='WALL'?{...startCommand(s,'UNDO'),command:s.command,points:s.points.slice(0,-1)}:{...s,points:s.points.slice(0,-1)};
 if(!text){if(['PLINE','PIPE'].includes(s.command)&&s.points.length>=2)return finish(add(s,[{type:'polyline',points:s.points,closed:false,...drawRole(s)}],s.command));if(s.command==='FLOOR'&&s.points.length>=3)return submit(s,'C');return finish(s);}
 if(s.command==='OFFSET'&&s.phase==='distance'){const value=lengthValue(text,s.doc.units);if(value<=0)throw Error('Offset must be positive.');return{...s,value,phase:'object'};}
 if(['ROTATE','SCALE'].includes(s.command)&&s.points.length){const value=Number(text);if(!Number.isFinite(value))throw Error('Enter a number.');return transformSelection(s,s.command.toLowerCase(),value);}
 if(s.command==='CIRCLE'&&s.points.length&&!text.includes(',')&&!text.includes('<')){const radius=lengthValue(text,s.doc.units);return finish(add(s,[{type:'circle',center:s.points[0],radius,start:0,sweep:TAU,role:'line'}],'CIRCLE'));}
 return clickPoint(s,parsePoint(text,s.points.at(-1),s.doc.units,s.cursor),{raw:true});
}
export function updateProperties(s,patch){layerGuard(s);const selected=new Set(s.selection);return commitDocument(s,{...s.doc,entities:s.doc.entities.map(e=>{if(!selected.has(e.id))return e;let value=e;if(patch.rotation!==undefined&&['line','arc','circle','polyline','dimension'].includes(e.type)){const base=e.center||e.a||e.points[0];value=transformEntity(e,'rotate',base,patch.rotation-(e.rotation||0));}return{...value,...patch};})},'Properties');}
