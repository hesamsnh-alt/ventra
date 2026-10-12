import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPrintedDimensionAlignment,mapPrintedDimensionPoint} from '../src/lib/printedDimensionAlignment.mjs';
import {prepareObservedOpeningWalls} from '../src/lib/sourceOpeningWalls.mjs';
import {compileSourceFurniture} from '../src/lib/sourceFurniture.mjs';
import {applySourceFurnitureReview} from '../src/lib/sourceFurnitureReview.mjs';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {repairOverlappingWalls} from '../src/lib/wallOverlapRepair.mjs';
import {filterOpenPlanPartitions} from '../src/lib/openPlanPartitions.mjs';
import {outdoorBoundaries,observedDoorOrientation} from '../src/lib/schematicBoundaries.mjs';
import {schematicGeometryAudit} from '../src/lib/schematicGeometryAudit.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('fixtures/printed-dimension-source.json',import.meta.url)));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('consistent printed dimensions correct the shared grid exactly without changing the overall extent',()=>{
 const before=JSON.stringify(fixture),alignment=createPrintedDimensionAlignment(fixture.rooms,12,8,fixture.footprint);
 assert.equal(alignment.applied,true);
 for(const room of fixture.rooms){
  const points=room.polygon.map(p=>mapPrintedDimensionPoint(p,alignment));
  close(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),room.printedWidthMeters);
  close(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)),room.printedDepthMeters);
 }
 assert.deepEqual(mapPrintedDimensionPoint({x:12,y:8},alignment),{x:12,y:8});assert.equal(JSON.stringify(fixture),before);
});
test('conflicting, absent or rotated dimensions do not force a new layout',()=>{
 const rooms=structuredClone(fixture.rooms);rooms[1].printedWidthMeters=4.02;
 const result=createPrintedDimensionAlignment(rooms,12,8,fixture.footprint);assert.equal(result.x.applied,false);
 const unknown=fixture.rooms.map(r=>({...r,printedWidthMeters:0,printedDepthMeters:0}));
 assert.equal(createPrintedDimensionAlignment(unknown,12,8,fixture.footprint).applied,false);
 const diagonal=[{x:0,y:0},{x:1,y:1},{x:0,y:2},{x:-1,y:1}];
 assert.equal(createPrintedDimensionAlignment([{polygon:diagonal}],12,8,diagonal).applied,false);
});
test('actual route aligns architecture and both furniture passes with the same map, retaining all openings',()=>{
 const source=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');
 const c=vm.createContext({process:{env:{}},createPrintedDimensionAlignment,mapPrintedDimensionPoint,prepareObservedOpeningWalls,canonicalRoomType,compileSourceFurniture,repairOverlappingWalls,filterOpenPlanPartitions,outdoorBoundaries,observedDoorOrientation});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.normalize=normalizeScene;',c);
 const point=p=>({x:p.x/12,y:1-p.y/8});
 const furniture=fixture.furniture.map(o=>({...o,backLeft:point(o.backLeft),backRight:point(o.backRight),frontCenter:point(o.frontCenter)}));
 const scene=c.normalize({coordinateMode:'image_normalized',widthMeters:12,depthMeters:8,footprint:fixture.footprint.map(point),rooms:fixture.rooms.map(r=>({...r,polygon:r.polygon.map(point)})),partitions:fixture.walls.filter(w=>w.provenance==='observed').map(w=>({...w,start:point(w.start),end:point(w.end)})),relationships:fixture.relationships,openings:fixture.observations.map(o=>({...o,center:point(o.center),heightMeters:0,sillHeightMeters:0})),furniture},{width:1800,height:1200});
 const report=schematicGeometryAudit(scene);
 assert.equal(report.doorCount,8);assert.equal(report.windowCount,4);assert.equal(report.issues.length,0);
 for(const opening of scene.openings){assert.equal(opening.height,opening.type==='door'?2.1:1.25);assert.equal(opening.heightSource,'visual_default_not_measured');if(opening.type==='window')assert.equal(opening.sillHeight,.9);}
 for(const room of scene.rooms){const expected=room.printedWidthMeters*room.printedDepthMeters;close(report.rooms.find(r=>r.id===room.id).area,expected);}
 assert.equal(scene.assets.length,13);
 const reviewed=applySourceFurnitureReview(scene,furniture);assert.equal(reviewed.assets.length,13);
 for(const a of scene.assets){const b=reviewed.assets.find(b=>b.id===a.id);for(const key of ['xMeters','yMeters','width','depth'])close(a[key],b[key]);}
 for(const key of ['rooms','walls','openings','footprint'])assert.strictEqual(reviewed[key],scene[key]);
});
