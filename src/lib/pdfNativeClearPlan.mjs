import {facesOf} from './pdfNativeWallGeometry.mjs';

// Local, bounded subset: an explicitly coordinated orthogonal CL polygon,
// printed scale, physical wall weights, room clear-face offsets and tagged
// rectangular cells. This does not accept model polygons or expected totals.
const E=.0002,near=(a,b)=>Math.abs(a-b)<E;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const on=(p,a,b)=>Math.abs(cross(a,b,p))<E&&p.x>=Math.min(a.x,b.x)-E&&p.x<=Math.max(a.x,b.x)+E&&p.y>=Math.min(a.y,b.y)-E&&p.y<=Math.max(a.y,b.y)+E;
const signed=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const bounds=p=>({x0:Math.min(...p.map(p=>p.x)),x1:Math.max(...p.map(p=>p.x)),y0:Math.min(...p.map(p=>p.y)),y1:Math.max(...p.map(p=>p.y))});
function inside(p,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++)if((polygon[i].y>p.y)!==(polygon[j].y>p.y)&&p.x<(polygon[j].x-polygon[i].x)*(p.y-polygon[i].y)/(polygon[j].y-polygon[i].y)+polygon[i].x)yes=!yes;return yes;}
const textOf=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans.map(s=>s.text).join(' '):'';
const unique=(values,label)=>{if(values.length!==1)throw Error('Ambiguous or missing '+label);return values[0];};
function pairList(text){
 const pairs=[];
 for(const m of text.matchAll(/\b([A-Z])\/([A-Z])(\d+)-to-\1\/\2(\d+)\b/g))for(const prefix of [m[1],m[2]])pairs.push([prefix+m[3],prefix+m[4]]);
 for(const m of text.matchAll(/\b([A-Z]+\d+)-to-([A-Z]+\d+)\b/g))pairs.push([m[1],m[2]]);
 return pairs;
}
export function measureNativeClearPlan(page,sourcePages=[]){
 const audit={page:page.pageNumber,status:'pending',method:'native_clear_axis_graph',requires_review:true};
 try{
  const text=page.native_plan_text,graphics=page.native_graphics;
  if(text?.status!=='readable'||graphics?.status!=='readable'||graphics.strokes.length>5000||text.spans.length>3000)throw Error('Bounded readable plan text and vectors required');
  const all=text.spans.map(s=>s.text).join(' '),source=sourcePages.map(p=>({page:p.pageNumber,text:textOf(p)}));
  if(!/Units:\s*metres unless noted/i.test(all))throw Error('Explicit metre coordinate units required');
  const polyText=unique([...all.matchAll(/CL polygon:\s*((?:\([^()]+\)\s*)+)\./gi)],'source CL polygon')[1];
  const envelope=[...polyText.matchAll(/\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map(m=>({x:Number(m[1]),y:Number(m[2])}));
  if(envelope.length<4||envelope.length>32||envelope.some((a,i)=>{const b=envelope[(i+1)%envelope.length];return !near(a.x,b.x)&&!near(a.y,b.y);})||Math.abs(signed(envelope))<E)throw Error('Only bounded orthogonal source CL polygons supported');
  const scale=72/.0254/Number(unique([...all.matchAll(/\bScale\s+1:(\d+)\b/gi)],'printed drawing scale')[1]);
  const classes=[...all.matchAll(/Solid (external|internal) wall\s+([A-Z]+\d+)\s*=\s*(\d+(?:\.\d+)?)\s*mm\b/gi)];
  const ext=unique(classes.filter(m=>m[1].toLowerCase()==='external'),'external wall class'),int=unique(classes.filter(m=>m[1].toLowerCase()==='internal'),'internal wall class');
  const offsets=source.flatMap(p=>[...p.text.matchAll(/Room clear faces offset\s+(\d+(?:\.\d+)?)\s*mm from external CL;\s*(\d+(?:\.\d+)?)\s*mm from internal CL/gi)].map(m=>({external:Number(m[1])/1000,internal:Number(m[2])/1000,page:p.page})));
  const offset=unique(offsets,'source clear-face offset rule');
  if(!(scale>0&&offset.external>0&&offset.internal>0)||!near(offset.external*2,Number(ext[3])/1000)||!near(offset.internal*2,Number(int[3])/1000))throw Error('Wall weights and clear-face offset source disagree');
  const styles=new Map();
  for(const s of graphics.strokes){if(s.dash?.length||s.curved)continue;const id=JSON.stringify([s.width,s.color]);if(!styles.has(id))styles.set(id,{width:s.width,color:s.color,segments:[]});styles.get(id).segments.push(...s.segments);}
  const external=unique([...styles.values()].filter(s=>near(s.width/scale,Number(ext[3])/1000)),'physical external-wall vector weight');
  const internal=unique([...styles.values()].filter(s=>near(s.width/scale,Number(int[3])/1000)&&JSON.stringify(s.color)===JSON.stringify(external.color)),'physical internal-wall vector weight');
  const eb=bounds(envelope),gb=bounds(external.segments.flatMap(s=>[s.a,s.b]));
  const origin={x:gb.x0-eb.x0*scale,y:gb.y0-eb.y0*scale};
  if(!near((gb.x1-gb.x0)/scale,eb.x1-eb.x0)||!near((gb.y1-gb.y0)/scale,eb.y1-eb.y0))throw Error('Printed scale does not match the dimensioned source polygon');
  const axes={x:[...new Set(envelope.map(p=>p.x))],y:[...new Set(envelope.map(p=>p.y))]};
  for(const axis of ['X','Y'])for(const m of all.matchAll(new RegExp(`Grid ${axis}:\\s*([\\d. /-]+)\\.`,'g')))axes[axis.toLowerCase()].push(...m[1].split('/').map(Number).filter(Number.isFinite));
  const metres=p=>Object.fromEntries(['x','y'].map(axis=>{const v=(p[axis]-origin[axis])/scale,matches=[...new Set(axes[axis])].filter(n=>near(n,v));return [axis,matches.length===1?matches[0]:Math.round(v*1e6)/1e6];}));
  const wall=(segment,classification)=>{const a=metres(segment.a),b=metres(segment.b);if(!near(a.x,b.x)&&!near(a.y,b.y)||distance(a,b)<E)throw Error('Nonorthogonal or empty wall vector');return {a,b,classification,axis:near(a.y,b.y)?'h':'v',length:distance(a,b)};};
  const walls=[...external.segments.map(s=>wall(s,'external')),...internal.segments.map(s=>wall(s,'internal'))];
  if(walls.length>200)throw Error('Native room graph size limit');
  const boundaryLength=envelope.reduce((s,a,i)=>s+distance(a,envelope[(i+1)%envelope.length]),0);
  if(!near(walls.filter(w=>w.classification==='external').reduce((s,w)=>s+w.length,0),boundaryLength)||walls.filter(w=>w.classification==='external').some(w=>!envelope.some((a,i)=>on(w.a,a,envelope[(i+1)%envelope.length])&&on(w.b,a,envelope[(i+1)%envelope.length]))))throw Error('External vectors do not close the declared CL boundary');
  const glassDeclaration=[...all.matchAll(/\b([A-Z]+\d+):\s*full-height glass on the complete\s+([^.]+)\./gi)];
  const declaredGlass=glassDeclaration.length?pairList(unique(glassDeclaration,'full-height glass boundary declaration')[2]):[];
  const glass=[];
  if(declaredGlass.length){
   for(const style of styles.values()){
    if(style===external||style===internal||style.width>=internal.width||style.color.every(c=>c>.95))continue;
    for(const s of style.segments){let w;try{w=wall(s,'glass');}catch{continue;}
     const middle={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
     if(!inside(middle,envelope)||walls.some(v=>on(middle,v.a,v.b))||![w.a,w.b].every(p=>walls.some(v=>on(p,v.a,v.b))))continue;
     if(!glass.some(v=>on(w.a,v.a,v.b)&&on(w.b,v.a,v.b)))glass.push(w);
    }
   }
   if(!glass.length)throw Error('Declared glass boundaries have no unambiguous closing vectors');
   walls.push(...glass);
  }
  for(const w of walls)for(const p of [w.a,w.b])if(!walls.some(v=>v!==w&&on(p,v.a,v.b)))throw Error('Unclosed room-wall endpoint');
  const faces=facesOf(walls);
  if(!faces.length||faces.length>100||!near(faces.reduce((s,f)=>s+f.area,0),Math.abs(signed(envelope))))throw Error('Room CL cells do not cover the declared footprint');
  const tags=text.spans.filter(s=>/^[A-Z]{1,4}\d{1,4}$/.test(s.text.trim())&&inside(metres(s),envelope));
  const rooms=[],seen=new Set();
  for(const face of faces){
   const label=unique(tags.filter(s=>inside(metres(s),face.polygon)),'one printed room tag per closed cell'),tag=label.text.trim();
   if(seen.has(tag))throw Error('Repeated source room tag');seen.add(tag);
   const b=bounds(face.polygon);if(!near((b.x1-b.x0)*(b.y1-b.y0),face.area))throw Error('Nonrectangular clear cells require independent offset geometry');
   const offsetsBySide={};
   for(const [name,a,c] of [['left',{x:b.x0,y:b.y0},{x:b.x0,y:b.y1}],['right',{x:b.x1,y:b.y0},{x:b.x1,y:b.y1}],['bottom',{x:b.x0,y:b.y0},{x:b.x1,y:b.y0}],['top',{x:b.x0,y:b.y1},{x:b.x1,y:b.y1}]]){
    const edges=walls.filter(w=>on(w.a,a,c)&&on(w.b,a,c)||on(a,w.a,w.b)&&on(c,w.a,w.b));
    const values=[...new Set(edges.map(w=>w.classification==='external'?offset.external:offset.internal))];offsetsBySide[name]=unique(values,'consistent clear offset on cell side');
   }
   const clear={x0:b.x0+offsetsBySide.left,x1:b.x1-offsetsBySide.right,y0:b.y0+offsetsBySide.bottom,y1:b.y1-offsetsBySide.top};
   const width=clear.x1-clear.x0,depth=clear.y1-clear.y0;
   if(!(width>0&&depth>0))throw Error('Nonpositive clear room dimensions');
   const captions=text.spans.filter(s=>s!==label&&inside(metres(s),face.polygon)),printed=captions.flatMap(s=>[...s.text.matchAll(/^Clear\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*m$/gi)].map(m=>[Number(m[1]),Number(m[2])]));
   if(printed.length>1||printed.length===1&&(!near(width,printed[0][0])||!near(depth,printed[0][1])))throw Error('Printed room clear dimensions conflict with calibrated wall faces: '+tag);
   rooms.push({tag,bounds:b,clear,width,depth,grossArea:width*depth,area:width*depth,deductions:[],void:captions.some(s=>/^VOID\s*-?\s*no floor\s*\/\s*no ceiling/i.test(s.text)),polygon:face.polygon,caption:captions.map(s=>s.text).join(' ')});
  }
  if(tags.length!==rooms.length)throw Error('Unmapped source room tag');
  for(const w of glass){const touching=rooms.filter(r=>r.polygon.some((a,i)=>on(w.a,a,r.polygon[(i+1)%r.polygon.length])&&on(w.b,a,r.polygon[(i+1)%r.polygon.length]))).map(r=>r.tag).sort();
   if(touching.length!==2||!declaredGlass.some(pair=>pair.slice().sort().join('|')===touching.join('|')))throw Error('Glass vector does not match its declared room boundary');w.rooms=touching;
  }
  for(const pair of declaredGlass.filter(pair=>rooms.some(r=>r.tag===pair[0])))if(glass.filter(w=>w.rooms?.slice().sort().join('|')===pair.slice().sort().join('|')).length!==1)throw Error('Missing or repeated declared glass boundary');
  const stairs=[...all.matchAll(/Stair zone:\s*X(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\s*\/\s*Y(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\./gi)];
  if(stairs.length){
   const m=unique(stairs,'explicit stair exclusion coordinates'),[x0,x1,y0,y1]=m.slice(1).map(Number);
   if(!(x1>x0&&y1>y0)||!/exclude\s+stair (?:footprint|opening)/i.test(all))throw Error('Stair coordinates lack a floor exclusion rule');
   const r=unique(rooms.filter(r=>x0>=r.clear.x0-E&&x1<=r.clear.x1+E&&y0>=r.clear.y0-E&&y1<=r.clear.y1+E&&!r.void),'stair exclusion host room');
   const quantity=(x1-x0)*(y1-y0);if(quantity>=r.area)throw Error('Stair exclusion consumes the host room');r.area-=quantity;r.deductions.push({kind:'stair',x0,x1,y0,y1,area:quantity});
  }else if(/exclude\s+stair (?:footprint|opening)/i.test(all))throw Error('Explicit stair exclusion missing coordinates');
  const ceilingRule=source.filter(p=>/Ceiling areas are net clear room areas, with the same\s+core stair-zone deductions as floors/i.test(p.text));
  const dimensions={floor_area:rooms.filter(r=>!r.void).reduce((s,r)=>s+r.area,0)};
  if(ceilingRule.length===1)dimensions.ceiling_area=dimensions.floor_area;
  Object.assign(audit,{status:'native_clear_geometry_checked',source_pages:[...new Set([page.pageNumber,offset.page,...ceilingRule.map(p=>p.page)])],calibration:{points_per_m:scale,origin},envelope_area:Math.abs(signed(envelope)),centrelines_cover_area:faces.reduce((s,f)=>s+f.area,0),rooms,wall_count:walls.length});
  return {status:'checked',audit,rooms,walls,dimensions,footprint:envelope,externalWallThickness:Number(ext[3])/1000,wallThickness:Number(int[3])/1000};
 }catch(e){audit.reason=e.message;return {status:'pending',audit,rooms:[],walls:[],dimensions:{}};}
}
