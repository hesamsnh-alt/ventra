import {createPrintedDimensionAlignment,mapPrintedDimensionPoint} from '../src/lib/printedDimensionAlignment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {prepareObservedOpeningWalls} from '../src/lib/sourceOpeningWalls.mjs';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {compileSourceFurniture} from '../src/lib/sourceFurniture.mjs';
import {repairOverlappingWalls} from '../src/lib/wallOverlapRepair.mjs';
import {filterOpenPlanPartitions} from '../src/lib/openPlanPartitions.mjs';
import {outdoorBoundaries,observedDoorOrientation} from '../src/lib/schematicBoundaries.mjs';
import {schematicGeometryAudit} from '../src/lib/schematicGeometryAudit.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('fixtures/segmented-source-openings.json',import.meta.url)));
const rectangle=(id,x0,y0,x1,y1)=>({id,polygon:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]});
test('an observed gap gets support; a relationship alone never creates a door or wall',()=>{
 const rooms=[rectangle('a',0,0,4,3),rectangle('b',0,3,4,4)];
 const walls=[{id:'left',type:'internal',start:{x:0,y:3},end:{x:1.5,y:3}},{id:'right',type:'internal',start:{x:2.5,y:3},end:{x:4,y:3}}];
 const observations=[{id:'d',type:'door',center:{x:2,y:3},widthMeters:1,wallAxis:'horizontal'}],before=JSON.stringify({walls,rooms,observations});
 const result=prepareObservedOpeningWalls(walls,rooms,observations);
 assert.equal(result.added.length,1);assert.equal(result.added[0].openingId,'d');
 assert.equal(prepareObservedOpeningWalls(walls,rooms,[]).added.length,0);
 assert.equal(JSON.stringify({walls,rooms,observations}),before);
 const open=[{roomAId:'a',roomBId:'b',relation:'open',confidence:.99}];
 assert.equal(prepareObservedOpeningWalls(walls,rooms,observations,open).added.length,0);
 assert.equal(prepareObservedOpeningWalls(walls,rooms,[{...observations[0],center:{x:2,y:1}}]).added.length,0);
 assert.equal(prepareObservedOpeningWalls(walls,rooms,[{...observations[0],widthMeters:5}]).added.length,0);
});
test('binding is independent of drawing language and rotation, including reversed edges',()=>{
 const rooms=[rectangle('حمام',0,0,4,3),rectangle('راهرو',0,3,4,4)];
 const rotate=p=>({x:-p.y+7,y:p.x+2});
 const r=prepareObservedOpeningWalls([],rooms.map(r=>({...r,polygon:r.polygon.map(rotate).reverse()})),[{id:'d',type:'door',center:rotate({x:2,y:3}),widthMeters:.8,wallAxis:'vertical'}]);
 assert.equal(r.added.length,1);assert.equal(r.walls[0].start.x,4);assert.equal(r.walls[0].end.x,4);
});
test('actual route retains all eight source doors and four windows without moving their centers',()=>{
 const source=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');
 const c=vm.createContext({createPrintedDimensionAlignment,mapPrintedDimensionPoint,process:{env:{}},prepareObservedOpeningWalls,canonicalRoomType,compileSourceFurniture,repairOverlappingWalls,filterOpenPlanPartitions,outdoorBoundaries,observedDoorOrientation});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.normalize=normalizeScene;',c);
 const point=p=>({x:p.x/fixture.width,y:1-p.y/fixture.depth});
 const scene=c.normalize({coordinateMode:'image_normalized',widthMeters:fixture.width,depthMeters:fixture.depth,footprint:fixture.footprint.map(point),rooms:fixture.rooms.map(r=>({...r,polygon:r.polygon.map(point)})),partitions:fixture.walls.map(w=>({...w,start:point(w.start),end:point(w.end)})),relationships:fixture.relationships,openings:fixture.observations.map(o=>({...o,center:point(o.center)})),furniture:[]},{width:1800,height:1200});
 const audit=schematicGeometryAudit(scene);
 assert.equal(audit.doorCount,8);assert.equal(audit.windowCount,4);assert.equal(audit.issues.length,0,JSON.stringify(audit.issues));
 for(const observation of fixture.observations){
  const o=audit.openings.find(o=>o.id===observation.id);assert.ok(o,observation.id);assert.equal(o.width,observation.widthMeters);
  assert.ok(Math.abs((o.start.x+o.end.x)/2-observation.center.x)<.02,`${o.id}: x`);
  assert.ok(Math.abs((o.start.y+o.end.y)/2-observation.center.y)<.02,`${o.id}: y`);
  // A second collinear wall must not cover the opening after overlap repair.
  const parent=scene.walls.find(w=>w.id===o.wallId),dx=parent.end.x-parent.start.x,dy=parent.end.y-parent.start.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  for(const w of scene.walls.filter(w=>w.id!==parent.id)){
   const cross=p=>Math.abs((p.x-parent.start.x)*uy-(p.y-parent.start.y)*ux);
   if(cross(w.start)>.04||cross(w.end)>.04)continue;
   const t=p=>(p.x-parent.start.x)*ux+(p.y-parent.start.y)*uy;
   const overlap=Math.min(Math.max(t(w.start),t(w.end)),t(o.end))-Math.max(Math.min(t(w.start),t(w.end)),t(o.start));
   assert.ok(overlap<.02,`${o.id} covered by ${w.id}`);
  }
 }
 assert.equal(scene.geometryValidation.openings.syntheticCount,0);
 assert.equal(scene.geometryValidation.openings.observations.length,12);
});
