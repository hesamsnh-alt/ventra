export function modelGlb(change=()=>{}){
 const positions=new Float32Array([-1,0,-.5,1,0,-.5,0,2,.5]);
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,-.5],max:[1,2,.5]}]};change(doc);
 const raw=JSON.stringify(doc),json=Buffer.from(raw+' '.repeat((4-Buffer.byteLength(raw)%4)%4)),out=Buffer.alloc(12+8+json.length+8+positions.byteLength);
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);out.writeUInt32LE(positions.byteLength,20+json.length);out.writeUInt32LE(0x004e4942,24+json.length);Buffer.from(positions.buffer).copy(out,28+json.length);return out;
}
