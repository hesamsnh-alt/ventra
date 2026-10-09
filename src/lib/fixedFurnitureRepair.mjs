import {compileSourceFurniture} from './sourceFurniture.mjs';
export function repairFixedFurniture(scene,boxes){
 const review=scene?.furnishingReview,p=scene?.geometryValidation?.sourceProjection,b=p?.sourceBounds;
 if(review?.observationCoordinateMode!=='scene_meters_y_up'||!b||!(b.maxX>b.minX)||!(b.maxY>b.minY))throw new Error('This scene has no source alignment for furniture repair.');
 const original=review.observations||[],rejected=new Set((review.rejected||[]).map(x=>x.id));
 const map=q=>({x:(q.x-b.minX)/(b.maxX-b.minX)*scene.width,y:(b.maxY-q.y)/(b.maxY-b.minY)*scene.depth});
 const replacements=new Map();
 for(const box of boxes||[]){
 const old=original.find(o=>o.id===box.id);if(!old||!rejected.has(box.id)||replacements.has(box.id))continue;
 const {left:l,right:r,top:t,bottom:d,front}=box;
 if(![l,r,t,d,box.confidence].every(Number.isFinite)||l<0||t<0||r>1||d>1||l>=r||t>=d||box.confidence<.65||!['left','right','top','bottom'].includes(front))continue;
 let a,c,f;
 if(front==='right'){a={x:l,y:t};c={x:l,y:d};f={x:r,y:(t+d)/2};}
 if(front==='left'){a={x:r,y:t};c={x:r,y:d};f={x:l,y:(t+d)/2};}
 if(front==='bottom'){a={x:l,y:t};c={x:r,y:t};f={x:(l+r)/2,y:d};}
 if(front==='top'){a={x:l,y:d};c={x:r,y:d};f={x:(l+r)/2,y:t};}
 replacements.set(box.id,{...old,backLeft:map(a),backRight:map(c),frontCenter:map(f),confidence:box.confidence});
 }
 // Accepted objects have priority and cannot be displaced by repairs.
 const ordered=[...original.filter(o=>!rejected.has(o.id)),...original.filter(o=>rejected.has(o.id)).map(o=>replacements.get(o.id)||o)];
 const result=compileSourceFurniture(ordered,scene.footprint,scene.rooms,scene.walls);
 const repairedIds=result.assets.filter(a=>rejected.has(a.id)).map(a=>a.id);
 return {...scene,assets:result.assets,furnishingReview:{...review,observations:ordered,acceptedCount:result.assets.length,rejected:result.rejected,requiresReview:result.rejected.length>0,repair:{mode:'fixed_geometry',repairedIds}},geometryValidation:{...scene.geometryValidation,furnishing:{...scene.geometryValidation.furnishing,assetCount:result.assets.length,byType:result.assets.reduce((counts,a)=>(counts[a.type]=(counts[a.type]||0)+1,counts),{}),byRoom:scene.rooms.map(r=>({roomId:r.id,type:r.type,assetCount:result.assets.filter(a=>a.roomId===r.id).length,assetTypes:result.assets.filter(a=>a.roomId===r.id).map(a=>a.type)}))}}};
}
