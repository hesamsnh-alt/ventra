import {compileCentrelinePdfScenes} from './pdfCentrelineScene.mjs';
import {measureNativeClearPlan} from './pdfNativeClearPlan.mjs';
import {readNativeInstanceTables} from './pdfNativeCoordinatedQuantities.mjs';

export const PDF_SCENE_VERSION='native-pdf-plan-v162';
const text=p=>p.native_text_evidence?.status==='readable'?p.native_text_evidence.spans.map(s=>s.text).join(' '):'';
const unique=(a,label)=>{if(a.length!==1)throw Error('Missing or ambiguous '+label);return a[0];};
const on=(p,w)=>Math.abs((w.b.x-w.a.x)*(p.y-w.a.y)-(w.b.y-w.a.y)*(p.x-w.a.x))<.0002&&p.x>=Math.min(w.a.x,w.b.x)-.0002&&p.x<=Math.max(w.a.x,w.b.x)+.0002&&p.y>=Math.min(w.a.y,w.b.y)-.0002&&p.y<=Math.max(w.a.y,w.b.y)+.0002;
const rect=b=>[{x:b.x0,y:b.y0},{x:b.x1,y:b.y0},{x:b.x1,y:b.y1},{x:b.x0,y:b.y1}];
// Pure compiler: source coordinates, printed scale, wall graph, height notes,
// and unique scheduled openings. No estimates, catalog rows or AI polygons.
export function compileNativePdfScenes(pages,{projectId,documentId,documentName}){
 if(!projectId||!documentId)throw Error('A project and original PDF identity are required.');
 const plans=pages.filter(p=>/FLOOR\s*\/\s*ARCHITECTURAL PLAN/i.test(text(p)));
 if(!plans.length)return compileCentrelinePdfScenes(pages,{projectId,documentId,documentName});
 const instances=readNativeInstanceTables(pages),consumed=new Set(),all=pages.map(text).join(' ');
 const scenes=plans.map(page=>{
  const plan=measureNativeClearPlan({...page,native_plan_text:page.native_text_evidence},pages);
  if(plan.status!=='checked')throw Error(`Page ${page.pageNumber}: ${plan.audit.reason}`);
  const name=unique([...text(page).matchAll(/\b(GROUND|FIRST|SECOND|THIRD|BASEMENT|ROOF) FLOOR\s*\/\s*ARCHITECTURAL PLAN/gi)],'floor name')[1].toUpperCase();
  const heights=[...all.matchAll(new RegExp(`\\b${name} external and internal walls\\s+(\\d+(?:\\.\\d+)?) m above`,'gi'))].map(m=>Number(m[1]));
  const height=unique([...new Set(heights)],'source storey wall height');
  if(!(height>=2.2&&height<=20))throw Error('Unsupported source wall height.');
  const xs=plan.footprint.map(p=>p.x),ys=plan.footprint.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys);
  const point=p=>({x:p.x-minX,y:p.y-minY});
  const wallIds=new Map(plan.walls.map((w,i)=>[w,`pdf-${page.pageNumber}-wall-${i}`]));
  const tags=new Set(plan.rooms.map(r=>r.tag));
  const local=instances.filter(o=>o.spaces.some(s=>tags.has(s)));
  const openingIds=new Set(local.map(o=>o.id));
  const printed=page.native_text_evidence.spans.map(s=>s.text.trim()).filter(s=>/^[A-Z]+-[DW]\d+$/.test(s));
  if(printed.some(id=>!openingIds.has(id)))throw Error('A printed opening has no unique coordinated schedule entry.');
  const openings=local.map(o=>{
   if(consumed.has(o.id))throw Error('An opening is shared by multiple floor plans.');consumed.add(o.id);
   const host=unique(plan.walls.filter(w=>on(o.a,w)&&on(o.b,w)),'opening wall host: '+o.id);
   if(o.height+o.sill>height+.0002)throw Error('Opening exceeds its source storey wall: '+o.id);
   const middle={x:(o.a.x+o.b.x)/2,y:(o.a.y+o.b.y)/2},dx=host.b.x-host.a.x,dy=host.b.y-host.a.y;
   return {id:o.id,wallId:wallIds.get(host),type:o.kind,width:o.width,height:o.height,sillHeight:o.sill,offset:((middle.x-host.a.x)*dx+(middle.y-host.a.y)*dy)/(dx*dx+dy*dy),sourcePage:o.page,dimensionSource:'source_dimension'};
  });
  // Reject overlapping physical openings, rather than trimming their widths.
  for(const wall of plan.walls){const spans=openings.filter(o=>o.wallId===wallIds.get(wall)).map(o=>[o.offset*wall.length-o.width/2,o.offset*wall.length+o.width/2]).sort((a,b)=>a[0]-b[0]);for(let i=1;i<spans.length;i++)if(spans[i][0]<spans[i-1][1]-.0002)throw Error('Overlapping source openings.');}
  const holes=plan.rooms.flatMap(r=>[...(r.void?[{id:r.tag,type:'void',polygon:r.polygon.map(point)}]:[]),...r.deductions.map((d,i)=>({id:`${r.tag}-stair-${i}`,type:'stair',polygon:rect(d).map(point)}))]);
  return {projectId,documentId,documentName,source:'native-pdf-floor-plan',nativePdfGeometryVersion:PDF_SCENE_VERSION,sourcePage:page.pageNumber,floorName:name,sceneType:'structured',furnishingMode:'source_observed',heightSource:'source_dimension',height,width:Math.max(...xs)-minX,depth:Math.max(...ys)-minY,externalWallThickness:plan.externalWallThickness,wallThickness:plan.wallThickness,footprint:plan.footprint.map(point),holes,
   floorPlates:plan.rooms.filter(r=>!r.void).map(r=>({polygon:r.polygon.map(point),holes:r.deductions.map(d=>rect(d).map(point))})),
   walls:plan.walls.map(w=>({id:wallIds.get(w),start:point(w.a),end:point(w.b),type:w.classification,thickness:w.classification==='external'?plan.externalWallThickness:w.classification==='glass'?.01:plan.wallThickness,height})),
   rooms:plan.rooms.filter(r=>!r.void).map(r=>({id:r.tag,name:[r.tag,r.caption].filter(Boolean).join(' '),type:'unknown',polygon:rect(r.clear).map(point),holes:r.deductions.map(d=>({polygon:rect(d).map(point)})),sourceArea:r.area})),openings,assets:[],showRoomLabels:true,
   pdfPreview:{mode:'separate-storeys',modelCalls:0,requiresReview:true,limitations:['Separate floor views; no assembled building or designed stair mesh.','Finishes and furniture are editable visual choices, not measured specifications.']}};
 });
 if(consumed.size!==instances.length)throw Error('Some scheduled openings have no supported floor host.');
 return {...scenes[0],pdfStoreys:scenes};
}
export function selectPdfStorey(scene,page){
 if(scene?.nativePdfGeometryVersion!==PDF_SCENE_VERSION||!Array.isArray(scene.pdfStoreys))throw Error('No PDF floor collection.');
 const {pdfStoreys,...current}=scene;
 const updated=pdfStoreys.map(s=>s.sourcePage===current.sourcePage?current:s);
 const selected=unique(updated.filter(s=>s.sourcePage===Number(page)),'selected PDF floor');
 return {...selected,pdfStoreys:updated};
}

// Source selection may never turn another drawing's engineering model into
// this drawing's preview. Switching back to CAD is an explicit document switch.
export function drawingSourceBinding({selectedDocumentId,engineering,source='aps',scene}){
 const mismatch=!!selectedDocumentId&&engineering?.document_id!==selectedDocumentId;
 const validScene=scene&&(!selectedDocumentId||scene.documentId===selectedDocumentId)?scene:null;
 return {source:mismatch&&(source==='aps'||source==='dwg-interior')?'schematic':source,scene:validScene,engineeringAllowed:!mismatch};
}
