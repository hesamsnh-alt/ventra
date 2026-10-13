import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import parser from '@babel/parser';import THREE from 'three-test';
const src=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8'),ast=parser.parse(src,{sourceType:'module',plugins:['jsx']});const c=vm.createContext({THREE});vm.runInContext(ast.program.body.filter(n=>n.type==='FunctionDeclaration').map(n=>src.slice(n.start,n.end)).join('\n'),c);
test('railing has clear panels, rounded handrail, mounting plates and clamps within original height',()=>{
 const wall={id:'rail',start:{x:0,y:0},end:{x:4,y:0},height:1.1},before=JSON.stringify(wall);
 const meshes=c.ventraBuildBalconyRailing({THREE,wall,start:wall.start,end:wall.end,height:1.1});
 const parts=new Set(meshes.map(m=>m.userData.railingPart));for(const name of ['glass','handrail','post','base_plate','bolt','glass_clamp'])assert.ok(parts.has(name));
 const bounds=new THREE.Box3();for(const m of meshes){m.updateMatrixWorld(true);bounds.union(new THREE.Box3().setFromObject(m));}assert.ok(bounds.min.z>=-1e-6);assert.ok(bounds.max.z<=1.100001);
 assert.ok(meshes.filter(m=>m.userData.railingPart==='glass').every(m=>!m.castShadow&&m.material.userData.ventraMaterial==='railing_glass'));
 assert.equal(JSON.stringify(wall),before);
});
test('shared corner receives one post and mounting plate instead of duplicate coincident geometry',()=>{
 const keys=new Set(),a=c.ventraBuildBalconyRailing({THREE,wall:{id:'a'},start:{x:0,y:0},end:{x:2,y:0},height:1.1,postKeys:keys}),b=c.ventraBuildBalconyRailing({THREE,wall:{id:'b'},start:{x:2,y:0},end:{x:2,y:2},height:1.1,postKeys:keys});
 assert.equal([...a,...b].filter(m=>m.userData.railingPart==='post'&&m.position.x===2&&m.position.y===0).length,1);
});
