// Legacy Autodesk THREE.Line raycast reads the deprecated linePrecision getter
// on every pick. Filter before raycasting, not after receiving intersections.
export function raycastVisibleMeshes(raycaster,root,THREE){
  const meshes=[];
  root.traverse(object=>{
    if(!(object.isMesh||object.type==='Mesh'||(THREE?.Mesh&&object instanceof THREE.Mesh)))return;
    for(let node=object;node;node=node.parent)if(node.visible===false)return;
    meshes.push(object);
  });
  return raycaster.intersectObjects(meshes,false);
}
