// Render-only separation. The source room polygons, floor level and quantities
// remain unchanged. The base plate must never compete with the room finish.
export function configureFloorDepth(mesh,layer){
  if(!mesh)return;
  if(!['base','finish'].includes(layer))throw new Error('Unknown floor render layer.');
  const sourceZ=mesh.userData?.ventraFloorDepth?.sourceZ??mesh.position.z;
  const offset=layer==='base'?-.025:0;
  mesh.position.z=sourceZ+offset;
  mesh.userData={...mesh.userData,ventraFloorDepth:{layer,sourceZ,renderOffsetMeters:offset}};
  for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    if(!material)continue;
    material.polygonOffset=true;
    material.polygonOffsetFactor=layer==='base'?4:-1;
    material.polygonOffsetUnits=layer==='base'?4:-1;
    material.needsUpdate=true;
  }
}
