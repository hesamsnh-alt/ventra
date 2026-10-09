// Furniture-only display adaptation. Never edits walls, openings, room polygons or storage.
const inside=(p,poly=[])=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
const type=a=>String(a.type||'').toLowerCase();
const xy=(a,s)=>({x:Number.isFinite(a.xMeters)?a.xMeters:Number(a.x??.5)*s.width,y:Number.isFinite(a.yMeters)?a.yMeters:Number(a.y??.5)*s.depth});
const shape=(a,s,pad=0)=>{const p=xy(a,s),t=(Number(a.rotation)||0)*Math.PI/180;return {...p,u:{x:Math.cos(t),y:Math.sin(t)},v:{x:-Math.sin(t),y:Math.cos(t)},hx:(Number(a.width)||.8)/2+pad,hy:(Number(a.depth)||.8)/2+pad};};
const points=b=>[-1,0,1].flatMap(x=>[-1,0,1].map(y=>({x:b.x+x*b.hx*b.u.x+y*b.hy*b.v.x,y:b.y+x*b.hx*b.u.y+y*b.hy*b.v.y})));
const dot=(a,b)=>a.x*b.x+a.y*b.y;
export function furnitureOverlaps(a,b,s,gap=0){const x=shape(a,s,gap/2),y=shape(b,s,gap/2),d={x:y.x-x.x,y:y.y-x.y};return [x.u,x.v,y.u,y.v].every(n=>Math.abs(dot(d,n))<x.hx*Math.abs(dot(x.u,n))+x.hy*Math.abs(dot(x.v,n))+y.hx*Math.abs(dot(y.u,n))+y.hy*Math.abs(dot(y.v,n))-1e-6);}
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
// Segment against an expanded oriented furniture rectangle.
function crossesWall(a,w,s){const b=shape(a,s,(Number(w.thickness)||Number(w.type==='external'?s.externalWallThickness:s.wallThickness)||.12)/2+.025);const local=p=>({x:dot({x:p.x-b.x,y:p.y-b.y},b.u),y:dot({x:p.x-b.x,y:p.y-b.y},b.v)});const p=local(w.start),q=local(w.end);let lo=0,hi=1;for(const [key,h] of [['x',b.hx],['y',b.hy]]){const d=q[key]-p[key];if(Math.abs(d)<1e-9){if(Math.abs(p[key])>h)return false;}else{let l=(-h-p[key])/d,r=(h-p[key])/d;if(l>r)[l,r]=[r,l];lo=Math.max(lo,l);hi=Math.min(hi,r);if(lo>hi)return false;}}return true;}
function acceptable(a,room,s,assets,skip,ignoreRug=true){const samples=points(shape(a,s,.08));if(!samples.every(p=>inside(p,room.polygon)))return false;
 const otherZones=(s.rooms||[]).filter(r=>r.id!==room.id&&(r.semanticType||r.type)!=='living');
 if(samples.some(p=>otherZones.some(r=>inside(p,r.polygon))))return false;
 if((s.walls||[]).some(w=>crossesWall(a,w,s)))return false;
 if((s.openings||[]).some(o=>{if(o.type!=='door')return false;const w=s.walls.find(w=>w.id===o.wallId);if(!w)return false;const p={x:w.start.x+(w.end.x-w.start.x)*o.offset,y:w.start.y+(w.end.y-w.start.y)*o.offset};return points(shape(a,s)).some(q=>Math.hypot(q.x-p.x,q.y-p.y)<Math.max(.9,Number(o.width)||.8)+.12);}))return false;
 return !assets.some((b,j)=>!skip.has(j)&&!(ignoreRug&&type(b)==='rug')&&furnitureOverlaps(a,b,s,.18));
}
export function arrangeLivingFurniture(scene,original=scene.assets||[]){const assets=original.map(a=>({...a}));
 // Repair storage/appliances incorrectly assigned to overlapping service zones.
 for(let i=0;i<assets.length;i++){
  const a=assets[i];if(!['wardrobe','refrigerator'].includes(type(a)))continue;
  const room=(scene.rooms||[]).find(r=>r.id===a.roomId);if(!room||acceptable(a,room,scene,assets,new Set([i])))continue;
  const originalPoint=xy(a,scene),options=[];
  for(const w of scene.walls||[]){const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy),half=(Number(a.width)||.8)/2;if(len<half*2+.3)continue;
   for(let d=half+.15;d<len-half-.15;d+=.2)for(const sign of [-1,1]){const nx=-dy/len*sign,ny=dx/len*sign,thickness=(Number(w.thickness)||Number(w.type==='external'?scene.externalWallThickness:scene.wallThickness)||.12)/2,off=(Number(a.depth)||.6)/2+thickness+.08;
    const candidate={...a,xMeters:w.start.x+dx*d/len+nx*off,yMeters:w.start.y+dy*d/len+ny*off,rotation:Math.atan2(nx,-ny)*180/Math.PI,wallSupported:true,againstWallId:w.id};
    if((scene.openings||[]).some(o=>o.wallId===w.id&&Math.abs(o.offset*len-d)<half+(Number(o.width)||.9)/2+.15))continue;
    if(acceptable(candidate,room,scene,assets,new Set([i])))options.push({candidate,score:Math.hypot(candidate.xMeters-originalPoint.x,candidate.yMeters-originalPoint.y)});
   }
  }
  options.sort((a,b)=>a.score-b.score);if(options.length)assets[i]=options[0].candidate;
 }
 for(const room of scene.rooms||[]){if((room.semanticType||room.type)!=='living')continue;
  const indexes=t=>assets.map((a,i)=>a.roomId===room.id&&type(a)===t?i:-1).filter(i=>i>=0);
  const sofa=assets[indexes('sofa')[0]];if(!sofa)continue;
  const p=xy(sofa,scene),t=(Number(sofa.rotation)||0)*Math.PI/180,front={x:-Math.sin(t),y:Math.cos(t)};
  const movable=new Set([...indexes('coffee_table'),...indexes('armchair'),...indexes('tv_unit'),...indexes('rug')]);
  // Coffee table follows the actual sofa, not the centroid of overlapping zones.
  for(const i of indexes('coffee_table')){const a=assets[i];for(const offset of [1.35,1.55,1.15,1.8]){const candidate={...a,xMeters:p.x+front.x*offset,yMeters:p.y+front.y*offset,rotation:sofa.rotation||0};if(acceptable(candidate,room,scene,assets,movable)){assets[i]=candidate;break;}}movable.delete(i);}
  const table=assets[indexes('coffee_table')[0]],anchor=table?xy(table,scene):{x:p.x+front.x*1.5,y:p.y+front.y*1.5};
  // TV requires a real supporting wall. Sample wall spans and avoid doors/windows.
  for(const i of indexes('tv_unit')){const a=assets[i],candidates=[];
   for(const w of scene.walls||[]){const dx=w.end.x-w.start.x,dy=w.end.y-w.start.y,len=Math.hypot(dx,dy);if(len<1.3)continue;
    const half=(Number(a.width)||1.35)/2,thick=(Number(w.thickness)||Number(w.type==='external'?scene.externalWallThickness:scene.wallThickness)||.12)/2;
    for(let d=half+.15;d<len-half-.15;d+=.2)for(const sign of [-1,1]){const nx=-dy/len*sign,ny=dx/len*sign,off=(Number(a.depth)||.28)/2+thick+.08;
     const x=w.start.x+dx*d/len+nx*off,y=w.start.y+dy*d/len+ny*off;
     const candidate={...a,xMeters:x,yMeters:y,rotation:Math.atan2(nx,-ny)*180/Math.PI,againstWallId:w.id,wallSupported:true};
     if(nx*(p.x-x)+ny*(p.y-y)<.3)continue;
     if((scene.openings||[]).some(o=>o.wallId===w.id&&Math.abs(o.offset*len-d)<half+(Number(o.width)||.9)/2+.15))continue;
     if(!acceptable(candidate,room,scene,assets,movable))continue;
     const sofaDistance=Math.hypot(x-p.x,y-p.y);if(sofaDistance>5)continue;
     candidates.push({candidate,score:Math.hypot(x-anchor.x,y-anchor.y)+Math.abs(sofaDistance-2.8)*.3});
    }
   }
   candidates.sort((a,b)=>a.score-b.score);if(candidates.length)assets[i]=candidates[0].candidate;
   else if(!acceptable(a,room,scene,assets,movable))assets[i]={...a,_presentationOmit:true};
   movable.delete(i);
  }
  // Move existing misplaced armchairs; never create an additional one.
  for(const i of indexes('armchair')){const a=assets[i];let found=null;
   for(const [dx,dy] of [[1.25,0],[-1.25,0],[0,1.25],[0,-1.25],[1.3,.65],[-1.3,.65]]){const x=anchor.x+dx,y=anchor.y+dy,candidate={...a,xMeters:x,yMeters:y,rotation:Math.atan2(dx,-dy)*180/Math.PI,wallSupported:false};if(acceptable(candidate,room,scene,assets,new Set([i]))){found=candidate;break;}}
   assets[i]=found||{...a,_presentationOmit:true};
  }
  // Match rug to seating, not a stale zone centroid. Floor-coverings may overlap furniture.
  for(const i of indexes('rug')){const a=assets[i],candidate={...a,xMeters:anchor.x,yMeters:anchor.y,rotation:sofa.rotation||0};const samples=points(shape(candidate,scene));if(samples.every(p=>inside(p,room.polygon))&&!samples.some(p=>(scene.rooms||[]).some(r=>r.id!==room.id&&(r.semanticType||r.type)!=='living'&&inside(p,r.polygon)))&&!(scene.walls||[]).some(w=>crossesWall(candidate,w,scene)))assets[i]=candidate;}
 }
 return assets.filter(a=>!a._presentationOmit);
}
