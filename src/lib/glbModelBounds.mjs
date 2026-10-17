import {Box3,Vector3,Matrix4,Quaternion} from 'three';
export function glbFurnitureDimensions(doc){
 const bounds=new Box3(),visiting=new Set();let count=0;
 const roots=doc.scenes?.[doc.scene||0]?.nodes||doc.nodes.map((_,i)=>i).filter(i=>!doc.nodes.some(n=>n.children?.includes(i)));
 function visit(index,parent,depth=0){
  if(depth>64||visiting.has(index)||++count>3000)throw new Error('Invalid GLB node graph.');
  const node=doc.nodes[index];if(!node)throw new Error('Invalid GLB node.');visiting.add(index);
  const position=node.translation||[0,0,0],rotation=node.rotation||[0,0,0,1],scale=node.scale||[1,1,1];
  const values=node.matrix||[...position,...rotation,...scale];if(values.some(n=>!Number.isFinite(n)))throw new Error('Invalid GLB transform.');
  const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3().fromArray(position),new Quaternion().fromArray(rotation),new Vector3().fromArray(scale));
  const world=parent.clone().multiply(local);
  if(node.mesh!==undefined)for(const primitive of doc.meshes[node.mesh]?.primitives||[]){
   const a=doc.accessors?.[primitive.attributes?.POSITION];if(!a?.min||!a?.max||a.min.length!==3||a.max.length!==3||[...a.min,...a.max].some(n=>!Number.isFinite(n)))throw new Error('GLB needs position bounds.');
   for(const x of [a.min[0],a.max[0]])for(const y of [a.min[1],a.max[1]])for(const z of [a.min[2],a.max[2]])bounds.expandByPoint(new Vector3(x,y,z).applyMatrix4(world));
  }
  for(const child of node.children||[])visit(child,world,depth+1);visiting.delete(index);
 }
 for(const root of roots)visit(root,new Matrix4());
 const size=bounds.getSize(new Vector3());if([size.x,size.y,size.z].some(n=>!Number.isFinite(n)||n<=0))throw new Error('GLB has invalid dimensions.');
 const factor=1.5/Math.max(size.x,size.y,size.z);
 return {width:Math.max(.05,size.x*factor),depth:Math.max(.05,size.z*factor),height:Math.max(.05,size.y*factor)};
}
