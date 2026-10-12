import test from 'node:test';
import assert from 'node:assert/strict';
import {patchDwgPresentation,dwgInteriorCameraKey,dwgFloorIndices,dwgInteriorScene,dwgInteriorMatches,savedDwgInterior,upgradeDwgInterior,rebuildDwgInterior,repairDwgInterior,updateDwgInterior,isInteriorSource} from '../src/lib/dwgInterior.mjs';
import {applyFurnitureEdit,roomAtPoint,LOCKED_ARCHITECTURE} from '../src/lib/furnitureEditor.mjs';
const fixture=(index=0,x=0)=>{
 const start={x,y:0},end={x:x+8000,y:0};
 const storey={index,sourceRegionIndex:index,lines:[{dbId:10,start,end},{start:end,end:{x:x+8000,y:6000}},{start:{x:x+8000,y:6000},end:{x,y:6000}},{start:{x,y:6000},end:start}],frame:{minX:x,maxX:x+8000,minY:0,maxY:6000,widthMeters:8,depthMeters:6}};
 const room={id:`room-${index}`,name:'Living',points:[{x:x*.001,y:0},{x:x*.001+8,y:0},{x:x*.001+8,y:6},{x:x*.001,y:6}]};
 const opening={dbId:20,type:'door',width:.9,height:2.1,storey:{index},wallStart:{x:-4,y:-3},wallEnd:{x:4,y:-3},wallPosition:{x:0,y:-3}};
 return {runtime:{meterFactor:.001,geometry:{roomPolygons:[room]},storeys:[{index,hull:[{x:-4,y:-3},{x:4,y:-3},{x:4,y:3},{x:-4,y:3}]}],doors:[opening],windows:[{...opening,dbId:21,type:'window',wallPosition:{x:2,y:-3},width:1.2,sillHeight:.9}]},storey,projectId:'project',documentId:'drawing',urn:'urn'};
};
test('each DWG region becomes a separate centered meter scene with matched doors and windows',()=>{
 const first=dwgInteriorScene(fixture()),second=dwgInteriorScene(fixture(1,20000));
 assert.deepEqual(first.walls.map(w=>[w.start,w.end]),second.walls.map(w=>[w.start,w.end]));
 assert.equal(second.dwgRegion,1);assert.equal(second.height,3.2);
 assert.equal(first.openings.length,2);assert.equal(first.openings[0].offset,.5);assert.equal(first.openings[1].offset,.75);
 assert.equal(first.openings[0].wallId,first.walls[0].id);assert.equal(first.openings[1].sillHeight,.9);
 assert.ok(first.assets.some(a=>a.type==='sofa'));assert.ok(first.assets.some(a=>a.type==='tv_unit'));
 assert.ok(first.assets.every(a=>a.excludeFromTakeoff));
});
test('unmatched openings are reported and never attached to another wall',()=>{
 const data=fixture();data.runtime.doors[0].wallStart={x:100,y:100};
 const scene=dwgInteriorScene(data);assert.equal(scene.openings.length,1);assert.deepEqual(scene.dwgReview.rejectedOpeningIds,[20]);
});
test('missing room metadata uses an explicit floor scope without invented room types or auto furniture',()=>{
 const data=fixture();data.runtime.geometry.roomPolygons=[];
 const scene=dwgInteriorScene(data);assert.equal(scene.assets.length,0);assert.equal(scene.rooms[0].scopeOnly,true);assert.equal(scene.dwgReview.missingRooms,true);
 assert.equal(scene.walls.length,4);assert.equal(scene.openings.length,2);
});
test('floor edits preserve all engineering quantities and other floor scenes',()=>{
 const first=dwgInteriorScene(fixture()),second=dwgInteriorScene(fixture(1,20000));
 const takeoff={aps_urn:'urn',floor_area:150,doors:9,geometry:{wallLineSegments:[{measured:true}],dwgPresentation:{roomUses:{r:'kitchen'}}}};
 const a=updateDwgInterior(takeoff,first),b=updateDwgInterior(a,second);
 assert.equal(b.floor_area,150);assert.equal(b.doors,9);assert.deepEqual(b.geometry.wallLineSegments,takeoff.geometry.wallLineSegments);
 assert.equal(b.geometry.dwgPresentation.interiorScenes[0],first);assert.equal(savedDwgInterior(b),second);
 assert.throws(()=>updateDwgInterior({...takeoff,aps_urn:'other'},first),/source changed/);
 assert.equal(savedDwgInterior({...b,aps_urn:'other'}),null);
});
test('manual furniture uses the same locked-architecture editor even without classified rooms',()=>{
 const data=fixture();data.runtime.geometry.roomPolygons=[];
 const scene=dwgInteriorScene(data);
 const edited=applyFurnitureEdit(scene,{kind:'add',catalogId:'plant',point:{x:3,y:3},rotation:0});
 assert.equal(edited.assets.length,1);
 for(const key of LOCKED_ARCHITECTURE)assert.deepEqual(edited[key],scene[key]);
 assert.equal(edited.source,'dwg-engineering-interior');
});

test('converted DWG uses the actual structured Three renderer with doors, windows and furniture meshes',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm'),{createRequire}=await import('node:module');
 const require=createRequire(import.meta.url),parser=require('@babel/parser'),THREE=require('three-test');
 const source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_')));
 const {sourcePresentationAssets}=await import('../src/lib/sourceFurniture.mjs');
 const context=vm.createContext({THREE,console,structuredClone,sourcePresentationAssets});
 vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),context);
 context.getThree=()=>THREE;
 const scene=new THREE.Scene();
 const viewer={impl:{scene,removeOverlayScene(){},invalidate(){}},navigation:{}};
 const data=dwgInteriorScene(fixture());
 const result=context.renderStructuredSchematicScene(viewer,data);
 assert.equal(result.structured,true);assert.equal(result.openingCount,2);assert.ok(result.assetMeshCount>0);assert.equal(result.height,3.2);
 assert.ok(result.wallPieceCount>=4);assert.equal(scene.children.length,1);
});
test('DWG interior shares the JPG renderer without changing the engineering source identity',()=>{
 assert.equal(isInteriorSource('dwg-interior'),true);assert.equal(isInteriorSource('schematic'),true);assert.equal(isInteriorSource('aps'),false);
 const data=fixture(0);data.storey.sourceRegionIndex=4;
 assert.equal(dwgInteriorScene(data).dwgRegion,4);
});
test('DWG furniture editing checks its engineering document independently of the last JPG selection',()=>{
 const scene=dwgInteriorScene(fixture());
 assert.equal(dwgInteriorMatches(scene,{aps_urn:'urn',document_id:'drawing'}),true);
 assert.equal(dwgInteriorMatches(scene,{aps_urn:'different',document_id:'drawing'}),false);
 assert.equal(dwgInteriorMatches(scene,{aps_urn:'urn',document_id:'new-drawing'}),false);
});
test('interior selection persists without replacing the independent JPG scene',async()=>{
 const {saveActiveSource,readActiveSource,saveSchematic,readSchematic}=await import('../src/lib/schematicStorage.mjs');
 const map=new Map(),records={put:async(k,v)=>map.set(k,v),putMany:async entries=>entries.forEach(([k,v])=>map.set(k,v)),get:async k=>map.get(k)};
 const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const image={width:8,depth:6,rooms:[],walls:[],assets:[],documentId:'image'};
 await saveSchematic('isolated-test',image,{records,storage,syncCloud:false});
 await saveActiveSource('isolated-test','dwg-interior',{records,storage,syncCloud:false});
 assert.equal(await readActiveSource('isolated-test',{records,storage}),'dwg-interior');
 assert.equal((await readSchematic('isolated-test','schematic3d',{records,storage})).documentId,'image');
});
test('partially extracted rooms no longer lock uncovered floor areas or create ambiguous room selections',()=>{
 const data=fixture();data.runtime.geometry.roomPolygons[0].name='Room';
 data.runtime.geometry.roomPolygons[0].points=[{x:0,y:0},{x:3,y:0},{x:3,y:6},{x:0,y:6}];
 const scene=dwgInteriorScene(data);
 assert.equal(roomAtPoint(scene,{x:2,y:3}).id,'room-0');
 assert.equal(roomAtPoint(scene,{x:6,y:3}).scopeOnly,true);
 const edited=applyFurnitureEdit(scene,{kind:'add',catalogId:'plant',point:{x:6,y:3},rotation:0});
 assert.equal(edited.assets.length,1);assert.ok(edited.rooms.find(r=>r.id===edited.assets[0].roomId).scopeOnly);
 const colliding={...scene,walls:[...scene.walls,{start:{x:6,y:0},end:{x:6,y:6},thickness:.15}]};
 assert.throws(()=>applyFurnitureEdit(colliding,{kind:'add',catalogId:'plant',point:{x:6,y:3}}),/wall/);
});
test('verified polygon IDs connect stored WC/kitchen/bedroom semantics to DWG default furniture',()=>{
 for(const [type,expected] of [['bathroom',['toilet','sink','shower']],['bedroom',['bed','dressing_table']],['kitchen',['kitchen_counter','stove','range_hood','washing_machine','dining_table']]]){
  const data=fixture();data.runtime.geometry.roomPolygons[0].name='Room';
  const input=dwgInteriorScene(data);
  const scene=upgradeDwgInterior(input,{object_details:{rooms:[{name:type,roomType:type,geometryPolygonId:'room-0'}]}});
  for(const asset of expected)assert.ok(scene.assets.some(a=>a.type===asset),`${type}: ${asset}`);
  assert.deepEqual(scene.walls,input.walls);assert.deepEqual(scene.openings,input.openings);
 }
});
test('unmatched or conflicting semantic evidence cannot assign furnishings to a random room',()=>{
 const data=fixture();data.runtime.geometry.roomPolygons[0].name='Room';
 const input=dwgInteriorScene(data);
 for(const rooms of [[{name:'WC',roomType:'bathroom',geometryPolygonId:'other'}],[{name:'WC',geometryPolygonId:'room-0'},{name:'Kitchen',geometryPolygonId:'room-0'}]]){
  assert.equal(upgradeDwgInterior(input,{object_details:{rooms}}).assets.length,0);
 }
});
test('DWG interior entry expands a single-region engineering view to all floors while preserving earlier furniture',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm'),{createRequire}=await import('node:module');
 const parser=createRequire(import.meta.url)('@babel/parser'),source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let fn;
 function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&node.id?.name==='openDwgInterior')fn=node;for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(ast);
 const a=fixture(),b=fixture(1,20000),full={...a.runtime,regionCount:2,storeyFrames:[a.storey,b.storey],storeys:[...a.runtime.storeys,...b.runtime.storeys],geometry:{roomPolygons:[...a.runtime.geometry.roomPolygons,...b.runtime.geometry.roomPolygons]},doors:[...a.runtime.doors,...b.runtime.doors],windows:[...a.runtime.windows,...b.runtime.windows]};
 const original=dwgInteriorScene(a);original.assets[0].color='#123456';
 let stored=updateDwgInterior({aps_urn:'urn',document_id:'drawing',geometry:full.geometry},original),shown,expanded=0;
 const context=vm.createContext({projectId:'project',urn:'urn',dwgRoomUses:{},reconstruction:{_runtime:{...full,storeyFrames:[a.storey]}},dwgFurnitureBusyRef:{current:false},viewerRef:{current:{}},schematicBaseSceneRef:{current:null},engineeringUrn:t=>t.aps_urn,
  dwgInteriorScene,rebuildDwgInterior,repairDwgInterior,updateDwgInterior,upgradeDwgInterior,readPersistedTakeoff:async()=>stored,persistTakeoff:async(id,t)=>{stored=t;},
  buildDwgInteriorRuntime:()=>{expanded++;return full;},persistSchematicScene:async scene=>{stored=updateDwgInterior(stored,scene);},saveActiveSource:async()=>{},setSchematicScene:scene=>{shown=scene;},setDwgFurnitureBusy(){},setActive3DSource(){},setInteriorView(){},setMessage:message=>{assert.ok(!message.includes('first'),message);}
 });
 vm.runInContext(source.slice(fn.start,fn.end),context);await context.openDwgInterior(1);
 assert.equal(expanded,1);assert.deepEqual(Object.keys(stored.geometry.dwgPresentation.interiorScenes),['0','1']);assert.equal(shown.dwgRegion,1);
 assert.equal(stored.geometry.dwgPresentation.interiorScenes[0].assets[0].color,'#123456');
});
test('manual DWG furniture uses the whole floor even when extracted room faces overlap or split the object',()=>{
 const scene=dwgInteriorScene(fixture());scene.assets=[];
 scene.rooms.unshift({id:'partial',type:'unknown',polygon:[{x:2,y:1},{x:3.1,y:1},{x:3.1,y:5},{x:2,y:5}]});
 const edited=applyFurnitureEdit(scene,{kind:'add',catalogId:'sofa-modern',point:{x:3,y:3}});
 assert.equal(edited.assets.length,1);assert.ok(edited.rooms.find(r=>r.id===edited.assets[0].roomId).scopeOnly);
 assert.throws(()=>applyFurnitureEdit(scene,{kind:'add',catalogId:'sofa-modern',point:{x:.3,y:3}}),/outside|wall/);
});
test('overlapping door and window bindings are flagged instead of rendered on top of each other',()=>{
 const data=fixture();data.runtime.windows[0].wallPosition={x:0,y:-3};
 const scene=dwgInteriorScene(data);
 assert.equal(scene.openings.length,0);assert.equal(scene.dwgReview.openingConflicts.length,2);
 assert.ok(scene.dwgReview.openingConflicts.every(r=>r.reason==='overlapping_opening_binding'));
 const old={...scene,openings:[{id:'door',wallId:scene.walls[0].id,type:'door',offset:.5,width:.9,height:2.1},{id:'window',wallId:scene.walls[0].id,type:'window',offset:.5,width:1.2,height:1.2,sillHeight:.9}]};
 assert.equal(upgradeDwgInterior(old).openings.length,0);
});
test('regenerating stored DWG architecture preserves manually edited furniture and confirmed room uses',()=>{
 const data=fixture(),old=dwgInteriorScene(data);
 old.rooms[0]={...old.rooms[0],roomUseSource:'user_confirmed',semanticType:'bedroom',type:'bedroom'};
 const manual={id:'my-plant',roomId:old.rooms[0].id,type:'plant',xMeters:6,yMeters:4,width:.4,depth:.4,height:1,rotation:75,color:'#123456',placementSource:'manual_furniture_editor'};
 old.assets=[manual];old.walls[0].end.x=42;
 const next=rebuildDwgInterior(old,data);
 assert.equal(next.walls[0].end.x,8);assert.deepEqual(next.assets.find(a=>a.id===manual.id),manual);
 assert.equal(next.rooms[0].roomUseSource,'user_confirmed');assert.equal(next.rooms[0].semanticType,'bedroom');
 assert.ok(next.assets.some(a=>a.type==='bed'));
});

test('older empty furnished previews receive JPG defaults once without changing architecture or manual assets',()=>{
 for(const name of ['Living','نشیمن','معيشة','Bedroom','اتاق خواب','غرفة نوم','WC','سرویس','مرحاض','Kitchen','آشپزخانه','مطبخ']){
  const input=fixture();input.runtime.geometry.roomPolygons[0].name=name;
  const scene=dwgInteriorScene(input);scene.assets=[];delete scene.dwgReview.defaultsVersion;
  const manual={id:'manual',roomId:'room-0',type:'plant',width:.2,depth:.2,height:.5,xMeters:7,yMeters:5,rotation:15,placementSource:'manual_furniture_editor'};
  scene.assets.push(manual);
  const repaired=upgradeDwgInterior(scene);
  assert.ok(repaired.assets.length>1,name);
  assert.deepEqual(repaired.walls,scene.walls);assert.deepEqual(repaired.openings,scene.openings);
  assert.deepEqual(repaired.assets.find(a=>a.id==='manual'),manual);
  assert.equal(upgradeDwgInterior(repaired),repaired);
 }
});
test('saved engineering room uses apply defaults to the matching polygon only',()=>{
 const scene=dwgInteriorScene(fixture());scene.rooms[0].name='Room';scene.rooms[0].type='unknown';scene.assets=[];
 const repaired=upgradeDwgInterior(scene,{geometry:{dwgPresentation:{roomUses:{'room-0':'bathroom'}}}});
 for(const type of ['toilet','shower','sink'])assert.ok(repaired.assets.some(a=>a.type===type),type);
 assert.equal(repaired.rooms[0].floorFinish,'wet_tile');
});
test('repair restores source openings to unchanged walls but respects intentional manual opening removal',()=>{
 const input=fixture(),scene=dwgInteriorScene(input),takeoff={aps_urn:'urn',document_id:'drawing'};
 scene.openings=[];
 const repaired=repairDwgInterior(scene,input,takeoff);
 assert.equal(repaired.openings.length,2);assert.deepEqual(repaired.walls,scene.walls);
 assert.equal(repairDwgInterior({...scene,manualOpeningEditor:{version:1}},input,takeoff).openings.length,0);
 const changed=structuredClone(scene);changed.walls[0].start.x=2;
 assert.equal(repairDwgInterior(changed,input,takeoff).openings.length,0);
});
test('furnishing metadata preserves both floor previews and camera memory is floor specific',()=>{
 const first=dwgInteriorScene(fixture()),second=dwgInteriorScene(fixture(1,20000));
 const takeoff=updateDwgInterior(updateDwgInterior({aps_urn:'urn',document_id:'drawing'},first),second);
 const next=patchDwgPresentation(takeoff,{furnished:true,roomUses:{}});
 assert.deepEqual(next.geometry.dwgPresentation.interiorScenes,takeoff.geometry.dwgPresentation.interiorScenes);
 assert.deepEqual(dwgFloorIndices(next),[0,1]);
 assert.notEqual(dwgInteriorCameraKey('p',first),dwgInteriorCameraKey('p',second));
 assert.equal(dwgInteriorCameraKey('p',first),dwgInteriorCameraKey('p',{...first,assets:[]}));
});
