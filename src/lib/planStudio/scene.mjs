import * as T from 'three';
import {FURNITURE_CATALOG} from '../furnitureEditor.mjs';
import {buildSchematicAssetMeshes} from './furnitureMeshes.mjs';
import {visibleEntities,styleFor,id,validateDocument} from './document.mjs';
import {segments,dist,at,bounds} from './geometry.mjs';
import {plateHoles,hatchPattern} from './render2d.mjs';
export function addPlanFurniture(doc,catalogId,center,scale=1){
 const m=FURNITURE_CATALOG.find(m=>m.id===catalogId);if(!m||!Number.isFinite(scale)||scale<.1||scale>5)throw Error('Invalid catalog model or scale.');const group=id(),pieces=m.layout?m.layout.map(p=>({model:FURNITURE_CATALOG.find(m=>m.id===p.catalogId),x:p.x*scale,y:p.y*scale,rotation:p.rotation})): [{model:m,x:0,y:0,rotation:0},...(m.chairs?[[-m.width/2-.3,0,-90],[m.width/2+.3,0,90],[0,-m.depth/2-.32,0],[0,m.depth/2+.32,180]].map(([x,y,rotation])=>({model:FURNITURE_CATALOG.find(m=>m.id==='chair'),x:x*scale,y:y*scale,rotation})):[])],entities=pieces.map(({model:m,x,y,rotation})=>({id:id(),type:'asset',catalogId:m.id,layer:'furniture',center:{x:center.x+x,y:center.y+y},width:m.width*scale,depth:m.depth*scale,height:m.height*scale,rotation,z:['picture_frame','wall_tv'].includes(m.type)?1.1:0,color:'bylayer',modelColor:m.color,setId:group}));return validateDocument({...doc,entities:[...doc.entities,...entities]});
}
function shapeFromPoints(points){const s=new T.Shape();points.forEach((p,i)=>i?s.lineTo(p.x,p.y):s.moveTo(p.x,p.y));s.closePath();return s;}
function material(color,metal=false){return new T.MeshStandardMaterial({color,roughness:metal?.35:.76,metalness:metal?.75:0,side:T.DoubleSide});}
function floorMaterial(e){const m=material(e.surfaceColor||'#b5a694');if(!e.hatch||e.hatch==='solid'||typeof document==='undefined')return m;
 const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');if(!ctx)return m;ctx.fillStyle='#f5f3ee';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#99958b';ctx.lineWidth=2;ctx.beginPath();
 const line=(x,y,a,b)=>{ctx.moveTo(x*128,y*128);ctx.lineTo(a*128,b*128);};
 if(e.hatch==='interlock'){line(0,0,.6,0);line(.6,0,.6,.3);line(.6,.3,1,.3);line(0,.5,.3,.5);line(.3,.5,.3,1);line(.6,.3,.6,.7);line(.6,.7,1,.7);line(.3,.5,.6,.5);}
 else if(e.hatch==='brick'){line(0,0,1,0);line(0,.5,1,.5);line(.5,0,.5,.5);line(0,.5,0,1);}
 else if(['sand','concrete'].includes(e.hatch)){for(const[x,y]of [[.2,.3],[.7,.8],[.5,.15]]){ctx.moveTo(x*128,y*128);ctx.arc(x*128,y*128,3,0,Math.PI*2);}}
 else{line(-1,0,1,2);line(0,-1,2,1);if(e.hatch==='cross')line(0,1,1,0);if(e.hatch==='steel')line(-.85,0,1.15,2);}
 ctx.stroke();const map=new T.CanvasTexture(c);map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(1/(e.hatchScale||.2),1/(e.hatchScale||.2));map.colorSpace=T.SRGBColorSpace;m.map=map;return m;}
function addMesh(group,geometry,mat){const m=new T.Mesh(geometry,mat);m.castShadow=m.receiveShadow=true;group.add(m);return m;}
export function planWallGeometry(e,openings=[]){
 const length=dist(e.a,e.b),shape=new T.Shape();shape.moveTo(0,0);let cursor=0;
 for(const o of openings.filter(o=>o.z<.01).sort((a,b)=>a.offset-b.offset)){
  const x=o.offset*length,l=x-o.width/2,r=x+o.width/2;shape.lineTo(l,0);if(o.kind==='arched'){const radius=o.width/2,spring=o.height-radius;shape.lineTo(l,spring);for(let n=1;n<=24;n++){const a=Math.PI-n*Math.PI/24;shape.lineTo(x+Math.cos(a)*radius,spring+Math.sin(a)*radius);}}else{shape.lineTo(l,o.height);shape.lineTo(r,o.height);}shape.lineTo(r,0);cursor=r;
 }
 shape.lineTo(length,0);shape.lineTo(length,e.height);shape.lineTo(0,e.height);shape.closePath();
 for(const o of openings.filter(o=>o.z>=.01)){const x=o.offset*length,l=x-o.width/2,r=x+o.width/2,p=new T.Path();p.moveTo(l,o.z);p.lineTo(l,o.z+o.height);p.lineTo(r,o.z+o.height);p.lineTo(r,o.z);p.closePath();shape.holes.push(p);}
 return new T.ExtrudeGeometry(shape,{depth:e.thickness,bevelEnabled:false,curveSegments:24});
}
export function createPlanScene(doc){
 const root=new T.Group(),entities=visibleEntities(doc),b=bounds(entities),matCache=new Map();const mat=(color,metal=false)=>{const k=color+metal;if(!matCache.has(k))matCache.set(k,material(color,metal));return matCache.get(k);};
 for(const e of entities){const group=new T.Group();group.userData={planEntityId:e.id};root.add(group);const color=styleFor(doc,e).color;
  if(e.role==='floor'&&e.type==='polyline'&&e.closed){const mesh=addMesh(group,new T.ExtrudeGeometry(shapeFromPoints(e.points),{depth:e.height||.12,bevelEnabled:false}),floorMaterial(e));mesh.position.z=(e.z||0)-(e.height||.12);}
  if(e.role==='wall'&&e.type==='line'){
   const mesh=addMesh(group,planWallGeometry(e,entities.filter(o=>o.type==='opening'&&o.wall===e.id)),mat(e.surfaceColor||'#d9d3c5'));mesh.rotation.x=Math.PI/2;mesh.position.y=e.thickness/2;group.position.set(e.a.x,e.a.y,e.z||0);group.rotation.z=Math.atan2(e.b.y-e.a.y,e.b.x-e.a.x);
  }else if(e.role==='wall'&&e.type==='arc'){
   const count=Math.max(16,Math.ceil(Math.abs(e.sweep)*e.radius/.12)),p=[];for(let n=0;n<=count;n++){const a=e.start+e.sweep*n/count;p.push({x:e.center.x+(e.radius+e.thickness/2)*Math.cos(a),y:e.center.y+(e.radius+e.thickness/2)*Math.sin(a)});}for(let n=count;n>=0;n--){const a=e.start+e.sweep*n/count;p.push({x:e.center.x+(e.radius-e.thickness/2)*Math.cos(a),y:e.center.y+(e.radius-e.thickness/2)*Math.sin(a)});}addMesh(group,new T.ExtrudeGeometry(shapeFromPoints(p),{depth:e.height,bevelEnabled:false}),mat(e.surfaceColor||'#d9d3c5')).position.z=e.z||0;
  }
  if(e.role==='pipe'){const curves=segments(e);for(const s of curves){const count=s.type==='line'?2:48,points=Array.from({length:count},(_,i)=>{const p=at(s,i/(count-1));return new T.Vector3(p.x,p.y,e.z||0);}),path=new T.CurvePath();points.slice(1).forEach((p,i)=>path.add(new T.LineCurve3(points[i],p)));addMesh(group,new T.TubeGeometry(path,Math.max(2,points.length*2),e.diameter/2,10,false),mat(e.surfaceColor||color,true));}}
  if(e.type==='plate'){
   const shape=shapeFromPoints([{x:-e.width/2,y:-e.depth/2},{x:e.width/2,y:-e.depth/2},{x:e.width/2,y:e.depth/2},{x:-e.width/2,y:e.depth/2}]);for(const p of plateHoles(e)){const h=new T.Path();h.absarc(p.x,p.y,e.boltDiameter/2,0,Math.PI*2,true);shape.holes.push(h);const bolt=addMesh(group,new T.CylinderGeometry(e.boltDiameter*.36,e.boltDiameter*.36,e.thickness*4,12),mat('#89939f',true));bolt.rotation.x=Math.PI/2;bolt.position.set(p.x,p.y,e.thickness*1.2);}
   addMesh(group,new T.ExtrudeGeometry(shape,{depth:e.thickness,bevelEnabled:false,curveSegments:24}),mat(e.surfaceColor||'#68788c',true));group.position.set(e.center.x,e.center.y,e.z||0);group.rotation.z=(e.rotation||0)*Math.PI/180;
  }
  if(e.type==='asset'){
   const m=FURNITURE_CATALOG.find(m=>m.id===e.catalogId);if(m){const asset={...m,...e,type:m.type,xMeters:e.center.x,yMeters:e.center.y,zMeters:e.z||0,color:e.modelColor||m.color,furnitureFinishes:e.furnitureFinishes};for(const mesh of buildSchematicAssetMeshes({THREE:T,asset,palette:{},roomWidth:0,roomDepth:0}))group.add(mesh);}
  }
  if(e.type==='light'){const light=new T.PointLight(e.color,e.intensity*8,12,2);light.position.set(e.center.x,e.center.y,e.z||2.7);group.add(light);const bulb=addMesh(group,new T.SphereGeometry(.07,12,8),new T.MeshBasicMaterial({color:e.color}));bulb.position.copy(light.position);}
 }
 return root;
}
export function disposePlanScene(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());}
