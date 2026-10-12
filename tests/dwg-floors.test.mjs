import test from 'node:test';import assert from 'node:assert/strict';
import {splitDwgRegions,dwgRoomScene} from '../src/lib/dwgFloors.mjs';
const rectangle=(x,y,w=8,h=6)=>[[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]].map(([x,y,a,b])=>({start:{x,y},end:{x:a,y:b}}));
test('three separated plans each retain their own source walls in metres or millimetres',()=>{
 const lines=[...rectangle(0,0),...rectangle(20,0),...rectangle(40,0)];
 const groups=splitDwgRegions(lines,1);assert.equal(groups.length,3);assert.equal(new Set(groups.flatMap(g=>g.lines)).size,12);
 const mm=lines.map(l=>({start:{x:l.start.x*1000,y:l.start.y*1000},end:{x:l.end.x*1000,y:l.end.y*1000}}));assert.equal(splitDwgRegions(mm,.001).length,3);
 assert.throws(()=>splitDwgRegions(lines,null),/scale/);
});
test('a connecting wall prevents false midpoint-based floor splitting',()=>{
 assert.equal(splitDwgRegions([...rectangle(0,0),...rectangle(20,0),{start:{x:0,y:3},end:{x:28,y:3}}],1).length,1);
});
const make=(name='نشیمن',uses={})=>dwgRoomScene({geometry:{roomPolygons:[{id:'r',name,points:[{x:20,y:10},{x:28,y:10},{x:28,y:16},{x:20,y:16}]},{id:'other',name:'WC',points:[{x:40,y:10},{x:48,y:10},{x:48,y:16},{x:40,y:16}]}]},frame:{minX:20000,maxX:28000,minY:10000,maxY:16000,widthMeters:8,depthMeters:6},factor:.001,roomUses:uses});
test('metric room polygons are not scaled twice; only selected region rooms receive furniture',()=>{
 const scene=make();assert.equal(scene.rooms.length,1);assert.deepEqual(scene.rooms[0].polygon[0],{x:0,y:0});assert.ok(scene.assets.some(a=>a.type==='sofa'));assert.ok(scene.assets.every(a=>a.roomId==='r'&&a.excludeFromTakeoff));
});
test('unknown room needs confirmed use, three language bathroom uses get fixtures',()=>{
 assert.equal(make('Room 1').assets.length,0);
 for(const name of ['WC','سرویس','حمام']){const s=make(name);for(const type of ['toilet','shower','sink'])assert.ok(s.assets.some(a=>a.type===type),name+':'+type);}
 assert.ok(make('Room 1',{r:'bedroom'}).assets.some(a=>a.type==='bed'));
});
test('room crossing two drawing bounds is excluded, source geometry remains untouched',()=>{
 const geometry={roomPolygons:[{id:'r',name:'Living',points:[{x:0,y:0},{x:30,y:0},{x:30,y:6},{x:0,y:6}]}]};const before=JSON.stringify(geometry);
 const s=dwgRoomScene({geometry,frame:{minX:0,maxX:8,minY:0,maxY:6,widthMeters:8,depthMeters:6},factor:1});assert.equal(s.rooms.length,0);assert.equal(JSON.stringify(geometry),before);
});

test('actual r71 overlay renders separate furnished storeys without modifying architecture',async()=>{
 const [{readFileSync},{createRequire},vm,parser]=await Promise.all([import('node:fs'),import('node:module'),import('node:vm'),import('@babel/parser')]);
 const THREE=createRequire(import.meta.url)('three-test'),source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||(n.type==='VariableDeclaration'&&n.declarations.some(d=>['VENTRA_SCHEMATIC_ASSET_DEFAULTS','VENTRA_SCHEMATIC_TEXTURE_CACHE'].includes(d.id.name))));
 let render;
 function find(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name==='renderDwgFurniture')render=n;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(find);else if(v&&typeof v==='object')find(v);}find(ast);
 const meshes=[],scene=new THREE.Scene(),viewer={impl:{overlayScenes:{},removeOverlayScene(){},createOverlayScene(name){this.overlayScenes[name]={scene};},addOverlay(name,mesh){meshes.push(mesh);scene.add(mesh);},invalidate(){}}};
 const context=vm.createContext({THREE,console,structuredClone,dwgRoomScene,getThree:()=>THREE,VENTRA_DESIGN_OVERLAY:'design',setDwgFurnitureCount(){},setMessage(){}});
 vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n')+'\n'+source.slice(render.start,render.end),context);
 // getThree normally reads the APS browser global; stub only SDK access.
 context.getThree=()=>THREE;
 const polygons=[0,20].map((x,i)=>({id:`r${i}`,name:'WC',points:[{x,y:0},{x:x+8,y:0},{x:x+8,y:6},{x,y:6}]}));
 const frames=[0,20].map((x,index)=>({index,frame:{minX:x,maxX:x+8,minY:0,maxY:6,widthMeters:8,depthMeters:6}}));
 const result={_runtime:{geometry:{roomPolygons:polygons},meterFactor:1,storeyHeightMeters:3.45,storeyFrames:frames,storeys:frames.map(f=>({index:f.index,wallPieces:[]})),doors:[]}};
 const original=JSON.stringify(result),visual=context.renderDwgFurniture(viewer,result,{});
 assert.equal(visual.count,6);assert.equal(JSON.stringify(result),original);assert.ok(meshes.length>6);
 for(const mesh of meshes){assert.ok([mesh.position.x,mesh.position.y,mesh.position.z].every(Number.isFinite));}
 const first=meshes.filter(m=>m.userData.roomId==='r0'),second=meshes.filter(m=>m.userData.roomId==='r1');
 assert.equal(first.length,second.length);assert.ok(first.length>0);
 for(let i=0;i<first.length;i++)assert.ok(Math.abs(second[i].position.z-first[i].position.z-3.45)<1e-7);
});
