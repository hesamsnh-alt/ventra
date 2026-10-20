import {measureNativeWallFloor,facesOf} from './pdfNativeWallGeometry.mjs';
import {readNativeOpeningSchedule} from './pdfNativeSchedules.mjs';
const eps=1e-5,near=(a,b)=>Math.abs(a-b)<eps;
const floorNames=['GROUND','FIRST','SECOND','THIRD','BASEMENT','ROOF'];
const lines=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans:[];
const unique=(list,label)=>{if(list.length!==1)throw Error('Missing or ambiguous '+label);return list[0];};
const contains=(poly,p)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const canonical=s=>String(s).trim().toUpperCase().replace(/ FLOOR$/,'');
// Read floor identity from a positioned sheet title, never from the filename or a saved AI report.
export function centrelinePlanFloor(native){
 if(native?.status!=='readable')return null;
 const matches=native.spans.flatMap(s=>{const m=s.text.trim().match(/^[A-Z][\w.-]*\s*\/\s*(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF) FLOOR$/i);return m?[m[1].toUpperCase()]:[];});
 return matches.length===1?matches[0]:null;
}
function schedulePages(pages){
 const schedules=[];
 for(const p of pages){
  const spans=lines(p);if(!spans.some(s=>/^ID$/i.test(s.text.trim()))||!spans.some(s=>/^Width(?:\s*\((?:m|mm)\))?$/i.test(s.text.trim()))||!spans.some(s=>/^Height(?:\s*\((?:m|mm)\))?$/i.test(s.text.trim())))continue;
  const floor=unique(spans.filter(s=>floorNames.includes(canonical(s.text))).map(s=>canonical(s.text)),'printed opening schedule floor');
  const previous=schedules.at(-1),inherited=previous?.page===p.pageNumber-1?previous.dimension_basis:null;
  const parsed=readNativeOpeningSchedule({...p,page_evidence:{kind:'opening_schedule',scope_id:floor}},canonical,inherited);
  if(parsed.status!=='read')throw Error(`Opening schedule page ${p.pageNumber}: ${parsed.reason||'unreadable table'}`);
  schedules.push(parsed);
 }
 return schedules;
}
function sourceRegions(page,measured){
 const cal=measured.audit.calibration;
 const point=p=>({x:Math.round((p.x-cal.origin.x)/cal.points_per_m*1e6)/1e6,y:Math.round((p.y-cal.origin.y)/cal.points_per_m*1e6)/1e6});
 const labels=lines(page).flatMap(s=>{const m=s.text.trim().match(/^([A-Z]{1,4}[-_]?\d{1,4})\s+(.+)$/i);return m?[{id:m[1],name:s.text.trim(),...point(s),void:/\bVOID\b/i.test(s.text),outdoor:/\bTERRACE\b|\bBALCONY\b/i.test(s.text)}]:[];}).filter(l=>l.x>0&&l.y>0&&l.x<cal.width_m&&l.y<cal.height_m);
 const special=labels.filter(l=>l.void||l.outdoor),physical=measured.walls;
 // Lightweight, orthogonal boundaries can mark a void/terrace without being masonry.
 // Furniture and annotations disconnected from the calibrated wall graph are not included.
 const candidates=page.native_graphics.strokes.filter(s=>!s.curved&&!s.dash?.length&&s.width<Math.min(measured.audit.wall_styles.external,measured.audit.wall_styles.internal)).flatMap(s=>s.segments).map(s=>({a:point(s.a),b:point(s.b)})).filter(s=>[s.a,s.b].every(p=>p.x>=-eps&&p.y>=-eps&&p.x<=cal.width_m+eps&&p.y<=cal.height_m+eps)&&Math.hypot(s.a.x-s.b.x,s.a.y-s.b.y)>eps&&(near(s.a.x,s.b.x)||near(s.a.y,s.b.y))).map(s=>({...s,axis:near(s.a.y,s.b.y)?'h':'v'}));
 if(candidates.length>1500)throw Error('Excessive lightweight floor boundary segments; source review required.');
 const attached=[],pending=[...candidates];
 for(let pass=0;pass<candidates.length&&pending.length;pass++){
  let changed=false;
  for(let i=pending.length-1;i>=0;i--){const s=pending[i];if([s.a,s.b].some(p=>[...physical,...attached].some(w=>distance(p,w.a,w.b)<eps))){attached.push(s);pending.splice(i,1);changed=true;}}
  if(!changed)break;
 }
 const closed=facesOf([...physical,...attached]);
 const boundary=[];
 for(const label of special){
  const face=unique(closed.filter(f=>contains(f.polygon,label)),'closed source '+(label.void?'void':'outdoor')+' region '+label.id);
  if(labels.some(other=>other.id!==label.id&&contains(face.polygon,other)))throw Error('A void/outdoor boundary contains unrelated room labels: '+label.id);
  for(let i=0;i<face.polygon.length;i++){const a=face.polygon[i],b=face.polygon[(i+1)%face.polygon.length];boundary.push({a,b,axis:near(a.y,b.y)?'h':'v'});}
 }
 const regions=facesOf([...physical,...boundary]).map(f=>({...f,labels:labels.filter(l=>contains(f.polygon,l))}));
 for(const label of labels)unique(regions.filter(f=>f.labels.includes(label)),'source room host '+label.id);
 if(regions.some(f=>!f.labels.length))throw Error('Unlabelled closed floor region requires review.');
 const holes=regions.filter(f=>f.labels.some(l=>l.void));
 const floors=regions.filter(f=>!holes.includes(f));
 // Source room groups may share one open face (hall / landing). Never invent a dividing wall.
 return {floors,holes:holes.map(f=>({id:f.labels[0].id,type:'void',polygon:f.polygon})),labels};
}
export function compileCentrelinePdfScenes(pages,identity){
 const plans=pages.filter(p=>centrelinePlanFloor(p.native_text_evidence));
 if(!plans.length)throw Error('No supported dimensioned vector floor plan found. A readable plan title, calibrated wall lines and opening schedules are required.');
 const names=plans.map(p=>centrelinePlanFloor(p.native_text_evidence));if(new Set(names).size!==names.length)throw Error('Multiple source plans for the same floor require revision selection.');
 const schedules=schedulePages(pages),used=new Set();
 const scenes=plans.map(page=>{
  const name=centrelinePlanFloor(page.native_text_evidence),schedule=unique(schedules.filter(s=>s.scope_id===name),'opening schedule for '+name);used.add(schedule);
  const measured=measureNativeWallFloor({...page,native_plan_text:page.native_text_evidence},schedule);
  if(measured.status!=='provisional')throw Error(`Page ${page.pageNumber}: ${measured.audit.reason}`);
  const height=unique([...new Set(lines(page).flatMap(s=>[...s.text.matchAll(/Clear height:\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)\b/gi)].map(m=>Number(m[1])*({m:1,mm:.001,cm:.01}[m[2].toLowerCase()]))))],'source wall height');
  if(!(height>=2.2&&height<=20))throw Error('Unsupported source storey height.');
  const regions=sourceRegions(page,measured),{width_m:width,height_m:depth}=measured.audit.calibration;
  const ids=new Map(measured.walls.map((w,i)=>[w.id,`pdf-${page.pageNumber}-wall-${i}`]));
  const openings=measured.openingPlacements.map(o=>{
   if(!Number.isFinite(o.sill)||o.sill<0||o.sill+o.height>height+eps)throw Error('Missing or invalid source sill/height: '+o.id);
   const host=measured.walls.find(w=>w.id===o.wallId),center=o.offset*host.length;
   if(center-o.width/2<-eps||center+o.width/2>host.length+eps)throw Error('Opening exceeds its source host: '+o.id);
   return {id:o.id,wallId:ids.get(o.wallId),type:o.kind==='window'?'window':'door',width:o.width,height:o.height,sillHeight:o.sill,offset:o.offset,sourcePage:o.page,dimensionSource:'source_dimension'};
  });
  return {...identity,source:'native-pdf-floor-plan',nativePdfGeometryVersion:'native-pdf-plan-v162',pdfGeometryAdapter:'centreline-graph-v165',sourcePage:page.pageNumber,floorName:name,sceneType:'structured',furnishingMode:'source_observed',heightSource:'source_dimension',height,width,depth,externalWallThickness:measured.externalWallThickness,wallThickness:measured.wallThickness,
   footprint:[{x:0,y:0},{x:width,y:0},{x:width,y:depth},{x:0,y:depth}],holes:regions.holes,
   walls:measured.walls.map(w=>({id:ids.get(w.id),start:w.a,end:w.b,type:w.classification,thickness:w.classification==='external'?measured.externalWallThickness:measured.wallThickness,height})),openings,
   floorPlates:regions.floors.map(f=>({polygon:f.polygon,holes:[]})),
   rooms:regions.floors.map((f,i)=>({id:f.labels.map(l=>l.id).join('+'),name:f.labels.map(l=>l.name).join(' / '),type:'unknown',polygon:f.polygon,holes:[],sourceArea:f.area})),assets:[],showRoomLabels:true,
   pdfPreview:{mode:'separate-storeys',modelCalls:0,requiresReview:true,sourceAudit:measured.audit,limitations:['Provisional calibrated centreline geometry; source review required.','Separate floor views; no assembled building, stair flights, railings or furniture generated.','Room areas use centreline zones; visual finishes are editable and are not measured clear-net BOQ areas.']}};
 });
 if(used.size!==schedules.length)throw Error('An opening schedule has no supported source floor.');
 return {...scenes[0],pdfStoreys:scenes};
}
