import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import {recoverInteriorRoomBoundaries,collectInteriorRoomLabels} from '../src/lib/dwgRoomBoundaries.mjs';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {resolveDwgCalibration} from '../src/lib/dwgCalibration.mjs';
import {splitDwgRegions} from '../src/lib/dwgFloors.mjs';
import {sourcePresentationAssets} from '../src/lib/sourceFurniture.mjs';
import {dwgInteriorScene} from '../src/lib/dwgInterior.mjs';
const evidence=JSON.parse(fs.readFileSync('tests/fixtures/dwg-two-floor-portals.json'));
const input={wallLines:evidence.lines,openingLines:[...evidence.doorLineSegments,...evidence.windowLineSegments],meterFactor:1,labels:evidence.labels};
test('actual two-floor DWG labels bind to separate portal-enclosed spaces, not overlapping floor outlines',()=>{
 const r=recoverInteriorRoomBoundaries(input);
 assert.equal(r.unmatchedLabels.length,0);
 assert.equal(r.rooms.filter(r=>r.type==='bedroom').length,3);
 assert.equal(r.rooms.filter(r=>r.type==='bathroom').length,3);
 assert.equal(r.rooms.filter(r=>r.type==='dining').length,1);
 assert.ok(r.rooms.find(r=>r.type==='kitchen').name.includes('LIVING ROOM'));
 assert.ok(r.rooms.every(r=>r.area<80));
 assert.ok(r.closures.every(l=>l.presentationBoundaryOnly));
 assert.deepEqual(input.wallLines,evidence.lines);
});
test('the actual viewer runtime builds two furnished scenes from DWG source evidence',()=>{
 const parser=createRequire(import.meta.url)('@babel/parser'),source=fs.readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 const THREE=createRequire(import.meta.url)('three-test');
 const ctx=vm.createContext({console,THREE,structuredClone,sourcePresentationAssets,resolveDwgCalibration,splitDwgRegions,recoverInteriorRoomBoundaries,collectInteriorRoomLabels});
 vm.runInContext(ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_'))).map(n=>source.slice(n.start,n.end)).join('\n'),ctx);
 const centroids=Object.fromEntries(evidence.labels.map(l=>[l.dbId,{...l.centroid,source:'aps_dbid_geometry_bounds'}]));
 ctx.getThree=()=>THREE;
 const takeoff={aps_urn:'urn',document_id:'document',geometry:{meterFactor:1,wallLineSegments:evidence.lines,doorLineSegments:evidence.doorLineSegments,windowLineSegments:evidence.windowLineSegments,objectGeometryCentroids:centroids},drawing_evidence:{records:evidence.labels.map(l=>({dbId:l.dbId,text:l.name}))},object_details:{doors:[],windows:[],rooms:[]}};
 const before=structuredClone(takeoff),runtime=ctx.buildDwgInteriorRuntime(takeoff);assert.equal(runtime.storeyFrames.length,2);
 const scenes=runtime.storeyFrames.map(storey=>dwgInteriorScene({runtime,storey,projectId:'p',documentId:'document',urn:'urn'}));
 const ground=scenes.find(s=>s.rooms.some(r=>r.name.includes('LIVING ROOM'))),upper=scenes.find(s=>s.rooms.some(r=>r.name.includes('MASTER')));
 assert.ok(ground&&upper);
 for(const type of ['sofa','tv_unit','plant','kitchen_counter','stove','range_hood','washing_machine','refrigerator','dining_table','toilet','shower','sink'])assert.ok(ground.assets.some(a=>a.type===type),`ground ${type}`);
 for(const room of upper.rooms.filter(r=>canonicalRoomType(r)==='bedroom'))assert.ok(upper.assets.some(a=>a.roomId===room.id&&a.type==='bed'),room.name);
 for(const room of upper.rooms.filter(r=>canonicalRoomType(r)==='bathroom'))for(const type of ['toilet','sink','shower'])assert.ok(upper.assets.some(a=>a.roomId===room.id&&a.type===type),`${room.name}: ${type}`);
 for(const scene of scenes){const viewer={impl:{scene:new THREE.Scene(),removeOverlayScene(){},invalidate(){}},navigation:{}};const rendered=ctx.renderStructuredSchematicScene(viewer,scene);assert.equal(rendered.assetCount,scene.assets.length);assert.ok(rendered.assetMeshCount>0);}
 assert.deepEqual(takeoff,before);
 console.log('Actual DWG test fixtures:',scenes.map(s=>({region:s.dwgRegion,rooms:s.rooms.filter(r=>!r.scopeOnly).length,assets:s.assets.length,warnings:s.designDefaults.warnings})));
});
test('CAD abbreviations and misspellings classify without changing source label text',()=>{
 for(const name of ['B/R','B / R','B.R','WC','سرویس','مرحاض'])assert.equal(canonicalRoomType({name}),'bathroom');
 assert.equal(canonicalRoomType({name:'DINNING ROOM\nHRWD FLOOR'}),'dining');assert.equal(canonicalRoomType({name:'HALL'}),'circulation');
});
test('label recovery requires a matching transformed dbId centroid',()=>{
 assert.deepEqual(collectInteriorRoomLabels([{dbId:1,text:'WC',centroid:{x:999,y:999}}],{}),[]);
 assert.equal(collectInteriorRoomLabels([{dbId:1,properties:[{displayName:'Contents',displayValue:'B/R\\PTILE FLOOR'}]}],{'1':{x:2,y:3}})[0].name,'B/R\nTILE FLOOR');
});
test('room recovery uses calibrated units and stable geometry IDs when source segments are reordered',()=>{
 const r=recoverInteriorRoomBoundaries(input);
 const scaled=l=>({...l,start:{x:l.start.x*1000,y:l.start.y*1000},end:{x:l.end.x*1000,y:l.end.y*1000}});
 const mm=recoverInteriorRoomBoundaries({...input,wallLines:input.wallLines.map(scaled),openingLines:input.openingLines.map(scaled),meterFactor:.001});
 assert.deepEqual(mm.rooms.map(r=>[r.id,r.type]).sort(),r.rooms.map(r=>[r.id,r.type]).sort());
 const reverse=recoverInteriorRoomBoundaries({...input,wallLines:[...input.wallLines].reverse(),openingLines:[...input.openingLines].reverse()});
 assert.deepEqual(reverse.rooms.map(r=>[r.id,r.type]).sort(),r.rooms.map(r=>[r.id,r.type]).sort());
});
test('unclassified gaps do not become room-separating portals without door/window evidence',()=>{
 const r=recoverInteriorRoomBoundaries({...input,openingLines:[]});assert.equal(r.closures.length,0);
});
