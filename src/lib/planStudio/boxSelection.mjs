import {at,segments,curveIntersections,param,bounds,inside,EPS} from './geometry.mjs';
import {dimensionGeometry} from './render2d.mjs';
import {hatchContains} from './hatchBoundary.mjs';
function geometry(e,doc){
 let curves=segments(e),points=[],fill=null;
 if(e.role==='wall'&&e.type==='line'&&e.thickness){const length=Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y),nx=-(e.b.y-e.a.y)/length*e.thickness/2,ny=(e.b.x-e.a.x)/length*e.thickness/2,ring=[{x:e.a.x+nx,y:e.a.y+ny},{x:e.b.x+nx,y:e.b.y+ny},{x:e.b.x-nx,y:e.b.y-ny},{x:e.a.x-nx,y:e.a.y-ny}];curves=segments({type:'polyline',points:ring,closed:true});fill=p=>inside(p,ring);}
 if(e.role==='wall'&&e.type==='arc'&&e.thickness){const outer={...e,radius:e.radius+e.thickness/2},inner={...e,radius:e.radius-e.thickness/2};curves=[outer,inner,{type:'line',a:at(outer,0),b:at(inner,0)},{type:'line',a:at(outer,1),b:at(inner,1)}];fill=p=>{const radius=Math.hypot(p.x-e.center.x,p.y-e.center.y);return radius>=inner.radius&&radius<=outer.radius&&param(e,p)<=1+EPS;};}
 if(e.type==='opening'){const wall=doc.entities.find(w=>w.id===e.wall);if(wall){const center=at(wall,e.offset),angle=Math.atan2(wall.b.y-wall.a.y,wall.b.x-wall.a.x),ring=[[-e.width/2,0],[e.width/2,0],[e.width/2,e.kind==='window'?wall.thickness:e.width],[-e.width/2,e.kind==='window'?wall.thickness:e.width]].map(([x,y])=>({x:center.x+x*Math.cos(angle)-y*Math.sin(angle),y:center.y+x*Math.sin(angle)+y*Math.cos(angle)}));curves=segments({type:'polyline',points:ring,closed:true});fill=p=>inside(p,ring);}}
 if(e.type==='dimension'){const g=dimensionGeometry(e);curves=[{type:'line',a:e.a,b:g.a},{type:'line',a:e.b,b:g.b},{type:'line',a:g.a,b:g.b}];}
 if(['asset','plate','text'].includes(e.type)){
  if(e.type==='text'){const b=bounds([e]);points=[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}];}
  else{const angle=(e.rotation||0)*Math.PI/180;points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:e.center.x+x*e.width/2*Math.cos(angle)-y*e.depth/2*Math.sin(angle),y:e.center.y+x*e.width/2*Math.sin(angle)+y*e.depth/2*Math.cos(angle)}));}
  curves=segments({type:'polyline',points,closed:true});if(e.type!=='text'){const ring=points.slice();fill=p=>inside(p,ring);}
 }
 if(e.type==='light')curves=[{type:'circle',center:e.center,radius:.12,start:0,sweep:Math.PI*2}];
 for(const c of curves){points.push(at(c,0),at(c,1));if(['circle','arc'].includes(c.type))for(let i=0;i<4;i++){const p={x:c.center.x+c.radius*Math.cos(i*Math.PI/2),y:c.center.y+c.radius*Math.sin(i*Math.PI/2)};if(c.type==='circle'||param(c,p)<=1+EPS)points.push(p);}}
 if(e.hatch)fill=p=>hatchContains(e,p);
 return{curves,points,fill};
}
export function boxSelection(doc,a,b,{crossing=false}={}){
 if(![a?.x,a?.y,b?.x,b?.y].every(Number.isFinite))throw Error('Invalid selection box.');
 const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y),contains=p=>p.x>=minX-EPS&&p.x<=maxX+EPS&&p.y>=minY-EPS&&p.y<=maxY+EPS,corners=[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}],edges=segments({type:'polyline',points:corners,closed:true});
 return doc.entities.filter(e=>doc.layers.find(l=>l.id===e.layer)?.visible!==false).filter(e=>{
  const g=geometry(e,doc);if(!g.points.length)return false;
  if(!crossing)return g.points.every(contains);
  return g.points.some(contains)||g.curves.some(c=>edges.some(edge=>curveIntersections(c,edge).length))||!!g.fill&&corners.some(g.fill);
 }).map(e=>e.id);
}
export function applyBoxSelection(state,box,{append=false}={}){
 const picked=boxSelection(state.doc,box.a,box.b,{crossing:box.crossing});
 return{...state,selection:append?[...new Set([...state.selection,...picked])]:picked};
}
