export const OUTDOOR_GROUND_ID='outdoor-ground';

export function outdoorGround(scene){
  if(!Number.isFinite(scene?.width)||!Number.isFinite(scene?.depth)||scene.width<=0||scene.depth<=0)return null;
  const clearance=4;
  const {width,depth}=scene;
  const polygon=[{x:-clearance,y:-clearance},{x:width+clearance,y:-clearance},
    {x:width+clearance,y:depth+clearance},{x:-clearance,y:depth+clearance}];
  const fallback=[{x:0,y:0},{x:width,y:0},{x:width,y:depth},{x:0,y:depth}];
  const footprint=scene.footprint?.length>=3?scene.footprint:fallback;
  return {id:OUTDOOR_GROUND_ID,polygon,footprint};
}
