import {FURNITURE_CATALOG} from '../furnitureEditor.mjs';

const types=new Map(FURNITURE_CATALOG.map(model=>[model.id,model.type]));
const box=(left,bottom,right,top)=>({points:[[left,bottom],[right,bottom],[right,top],[left,top]],closed:true});
const path=(...points)=>({points,closed:false});
function oval(x,y,w,h){
 return {closed:true,points:Array.from({length:20},(_,i)=>{
  const angle=i*Math.PI/10;
  return [x+Math.cos(angle)*w/2,y+Math.sin(angle)*h/2];
 })};
}
const symbols={
 bed:[box(-.47,-.12,.47,.47),box(-.42,-.43,-.04,-.18),box(.04,-.43,.42,-.18)],
 sofa:[box(-.47,-.42,.47,-.23),box(-.47,-.23,-.34,.4),box(.34,-.23,.47,.4),box(-.34,-.23,.34,.4),path([0,-.23],[0,.4])],
 chair:[box(-.4,-.37,.4,.38),path([-.43,-.33],[-.43,-.13],[.43,-.13],[.43,-.33])],
 kitchen_counter:[path([0,-.47],[0,.47]),path([-.23,-.3],[-.23,.3]),path([.23,-.3],[.23,.3])],
 wardrobe:[path([0,-.48],[0,.48]),path([-.15,-.43],[-.06,-.43]),path([.06,-.43],[.15,-.43])],
 toilet:[box(-.41,-.44,.41,-.22),oval(0,.12,.68,.62),oval(0,.12,.43,.4)],
 sink:[oval(0,.06,.73,.68),oval(0,.06,.5,.45),path([0,-.46],[0,-.3])],
 bathtub:[oval(0,0,.88,.8),oval(-.03,0,.69,.59)],
 stove:[...[-.22,.22].flatMap(x=>[-.22,.22].map(y=>oval(x,y,.26,.26)))],
 refrigerator:[path([-.48,-.29],[.48,-.29]),path([.11,-.43],[.36,-.43])],
 tv_unit:[box(-.45,-.16,.45,.12)],
};

export function planAssetSymbol(entity){
 const type=types.get(entity.catalogId);
 const details=symbols[type]||[path([-.46,-.46],[.46,.46])];
 const angle=(entity.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 return [box(-.5,-.5,.5,.5),...details].map(symbol=>({...symbol,type:'polyline',points:symbol.points.map(([x,y])=>({
  x:entity.center.x+x*entity.width*c-y*entity.depth*s,
  y:entity.center.y+x*entity.width*s+y*entity.depth*c,
 }))}));
}
