import {applySurfaceMaterial,surfaceKey,createSurfaceMeshMaterial,applySurfaceUVs} from './surfaceMaterials.mjs';
export const FACADE_PRESETS=[{id:'stone',en:'Stone',fa:'سنگی',material:'stone-beige'},{id:'roman',en:'Roman / classical',fa:'رومی / کلاسیک',material:'stone-ivory'},{id:'brick',en:'Brick',fa:'آجری',material:'brick-red'},{id:'wood',en:'Wood',fa:'چوبی',material:'wood-oak'}];
const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
// Sample both sides: partition walls, ambiguous outlines and courtyards are never
// inferred from distance to a centroid. Wall-local +Y is left of start → end.
export function exteriorFaces(scene){
 if(!scene.footprint?.length)return [];
 return (scene.walls||[]).flatMap(w=>{
  if(w.type==='railing'||!w.start||!w.end)return [];
  const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,L=Math.hypot(dx,dy);if(L<.05)return [];
  const nx=-dy/L,ny=dx/L,m={x:(w.start.x+w.end.x)/2,y:(w.start.y+w.end.y)/2},s=(Number(w.thickness)||.15)/2+.06;
  const occupied=sign=>{const p={x:m.x+sign*nx*s,y:m.y+sign*ny*s};return inside(p,scene.footprint)&&!(scene.holes||[]).some(h=>inside(p,h.polygon||[]));};
  const plus=occupied(1),minus=occupied(-1);if(plus===minus)return [];
  const sign=plus?-1:1;
  return [{kind:'wall',id:String(w.id),side:sign===1?'y+':'y-',sign,nx:nx*sign,ny:ny*sign,wall:w,length:L}];
 });
}
const validColor=c=>/^#[0-9a-f]{6}$/i.test(c);
export function applyFacade(scene,{preset,material,color}){
 const p=FACADE_PRESETS.find(p=>p.id===preset);if(!p||!validColor(color))throw new Error('Invalid facade style or color.');
 const faces=exteriorFaces(scene);if(!faces.length)throw new Error('No unambiguous exterior walls found. / دیوار بیرونی قابل تشخیص نیست.');
 let next=scene;for(const face of faces)next=applySurfaceMaterial(next,face,material||p.material);
 return {...next,exteriorDesign:{...scene.exteriorDesign,version:1,preset,material:material||p.material,color,targets:faces.map(({kind,id,side})=>({kind,id,side})),excludeFromTakeoff:true}};
}
export function editExteriorBox(scene,edit){
 const boxes=[...(scene.exteriorDesign?.boxes||[])];
 if(edit.kind==='remove'){if(!boxes.some(b=>b.id===edit.id))throw new Error('Box no longer exists.');}
 else if(!['add','update'].includes(edit.kind))throw new Error('Unknown box edit.');
 if(edit.kind!=='remove'){
  for(const k of ['x','y','z','width','depth','height','rotation'])if(!Number.isFinite(edit[k]))throw new Error('Enter finite dimensions and position.');
  if(['width','depth','height'].some(k=>edit[k]<.02||edit[k]>30)||Math.abs(edit.x)>10000||Math.abs(edit.y)>10000||edit.z<0||edit.z>100||!validColor(edit.color))throw new Error('Invalid box dimensions, position or color.');
  // Resolve the material through the existing catalog, not an arbitrary URL.
  if(!createMaterialIds.has(edit.material))throw new Error('Unknown box material.');
  if(edit.kind==='add'&&boxes.length>=200)throw new Error('Maximum 200 decorative boxes.');
  if(edit.kind==='update'&&!boxes.some(b=>b.id===edit.id))throw new Error('Box no longer exists.');
 }
 const b={id:edit.kind==='add'?`facade-box-${globalThis.crypto.randomUUID()}`:edit.id,...Object.fromEntries(['x','y','z','width','depth','height','rotation','color','material'].map(k=>[k,edit[k]])),excludeFromTakeoff:true};
 const next=edit.kind==='remove'?boxes.filter(b=>b.id!==edit.id):edit.kind==='add'?[...boxes,b]:boxes.map(o=>o.id===edit.id?b:o);
 return {...scene,exteriorDesign:{...scene.exteriorDesign,version:1,excludeFromTakeoff:true,boxes:next}};
}
import {SURFACE_MATERIALS} from './surfaceMaterials.mjs';
const createMaterialIds=new Set(SURFACE_MATERIALS.map(m=>m.id));
export function assertExteriorOnlyEdit(before,after){
 for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(!['exteriorDesign','surfaceFinishes'].includes(k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]))throw new Error(`Exterior design cannot change ${k}`);
 // No material reassignment of interior faces, floors or ceiling is permitted.
 const allowed=new Set(exteriorFaces(before).map(surfaceKey));
 // applySurfaceMaterial expands legacy whole-wall assignments without changing
 // their appearance. Compare effective finishes, rather than raw storage keys.
 for(const w of before.walls||[])for(const side of ['x+','x-','y+','y-','z+','z-']){
  const key=surfaceKey({kind:'wall',id:String(w.id),side}),legacy=surfaceKey({kind:'wall',id:String(w.id)});
  const value=s=>s.surfaceFinishes?.assignments?.[key]??s.surfaceFinishes?.assignments?.[legacy];
  if(!allowed.has(key)&&value(before)!==value(after))throw new Error('Interior finish is locked.');
 }
 for(const k of new Set([...Object.keys(before.surfaceFinishes?.assignments||{}),...Object.keys(after.surfaceFinishes?.assignments||{})])){
  const parts=JSON.parse(k);if(parts[0]!=='wall'&&before.surfaceFinishes?.assignments?.[k]!==after.surfaceFinishes?.assignments?.[k])throw new Error('Floor finish is locked.');
 }
}
export function buildExteriorDesignMeshes(THREE,scene){
 const design=scene.exteriorDesign;if(!design)return [];
 const meshes=[],materials=new Map();
 const box=(spec)=>{
  const key=spec.material+':'+spec.color;let mat=materials.get(key);
  if(!mat){mat=createSurfaceMeshMaterial(THREE,spec.material,undefined,{scene});if(!mat)return;mat.color?.set(spec.color);materials.set(key,mat);}
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(spec.width,spec.depth,spec.height),mat);
  mesh.position.set(spec.x-scene.width/2,spec.y-scene.depth/2,spec.z+spec.height/2);mesh.rotation.z=spec.rotation*Math.PI/180;
  applySurfaceUVs(THREE,mesh,'wall');mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={ventraType:'exterior-decoration',exteriorBoxId:spec.id,excludeFromTakeoff:true};meshes.push(mesh);
 };
 for(const b of design.boxes||[])box(b);
 if(design.preset==='roman')for(const face of exteriorFaces(scene)){
  const w=face.wall,height=Number(w.height)||scene.height||3,thickness=Number(w.thickness)||.15;
  const along={x:(w.end.x-w.start.x)/face.length,y:(w.end.y-w.start.y)/face.length};
  const emit=(t,width,z,h,depth)=>box({x:w.start.x+along.x*t+face.nx*(thickness/2+depth/2),y:w.start.y+along.y*t+face.ny*(thickness/2+depth/2),z,width,depth,height:h,rotation:Math.atan2(along.y,along.x)*180/Math.PI,material:design.material||'stone-ivory',color:design.color||'#e7e2d7'});
  const ops=(scene.openings||[]).filter(o=>String(o.wallId)===String(w.id));
  const maxTop=Math.max(0,...ops.map(o=>(Number(o.sillHeight)||0)+(Number(o.height)||2.1)));
  if(maxTop<height-.16){emit(face.length/2,face.length,height-.14,.08,.12);emit(face.length/2,face.length,height-.06,.06,.19);}
  for(const t of [.18,face.length-.18]){
   if(face.length<.8||ops.some(o=>{const p=o.wallPosition||o.position;if(!p)return true;const ot=(p.x-w.start.x)*along.x+(p.y-w.start.y)*along.y;return Math.abs(t-ot)<(o.width||1)/2+.2;}))continue;
   emit(t,.2,.12,Math.max(.02,height-.38),.09);emit(t,.32,0,.12,.15);emit(t,.32,height-.26,.1,.15);
  }
 }
 return meshes;
}
