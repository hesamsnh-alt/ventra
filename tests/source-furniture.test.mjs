import {createPrintedDimensionAlignment,mapPrintedDimensionPoint} from '../src/lib/printedDimensionAlignment.mjs';
import {prepareObservedOpeningWalls} from '../src/lib/sourceOpeningWalls.mjs';
import {outdoorBoundaries,observedDoorOrientation} from '../src/lib/schematicBoundaries.mjs';
import {canonicalRoomType} from "../src/lib/roomSemantics.mjs";
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {compileSourceFurniture} from '../src/lib/sourceFurniture.mjs';
const footprint=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],rooms=[{id:'a'}];
const item=(type='sofa',extra={})=>({id:`${type}-1`,groupId:'',roomId:'a',type,backLeft:{x:1,y:2},backRight:{x:3,y:2},frontCenter:{x:2,y:3},confidence:.9,embeddedInCounter:false,...extra});
test('observed rectangles retain centre and orientation; fixtures face their access side',()=>{const s=item();const copy=JSON.stringify(s);const r=compileSourceFurniture([s,item('tv_unit',{backLeft:{x:5,y:2},backRight:{x:7,y:2},frontCenter:{x:6,y:3}})],footprint,rooms);assert.equal(r.assets[0].xMeters,2);assert.equal(r.assets[0].yMeters,2.5);assert.equal(r.assets[0].rotation,0);assert.equal(r.assets[1].rotation,180);assert.equal(JSON.stringify(s),copy);});
test('L-shaped groups remain separate legs and source dining/rug are retained',()=>{const r=compileSourceFurniture([item('sofa',{groupId:'L'}),item('sofa',{id:'leg2',groupId:'L',backLeft:{x:3,y:3},backRight:{x:3,y:5},frontCenter:{x:2,y:4}}),item('dining_table',{backLeft:{x:5,y:2},backRight:{x:7,y:2},frontCenter:{x:6,y:3}}),item('rug')],footprint,rooms);assert.equal(r.assets.length,4);assert.equal(r.assets.filter(a=>a.groupId==='L').length,2);});
test('uncertain and outside furniture is rejected with a reason, never replaced by guesses',()=>{const r=compileSourceFurniture([item('bed',{confidence:.3}),item('bed',{frontCenter:{x:2,y:20}})],footprint,rooms);assert.equal(r.assets.length,0);assert.equal(r.rejected.length,2);assert.equal(compileSourceFurniture([],footprint,rooms).assets.length,0);});
test('route preserves unlabeled/same-name rooms and requests source furniture; viewer bypasses repositioning',()=>{const s=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');assert.doesNotMatch(s,/seenRoomNames|explicitlyLabeled|Do not output furniture/);assert.match(s,/compileSourceFurniture/);const v=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');assert.match(v,/if \(scene.furnishingMode === "source_observed"\) return sourcePresentationAssets\(scene\)/);});

test('solid overlaps are reported while a source sink may be embedded in a counter',()=>{assert.equal(compileSourceFurniture([item(),item('bed')],footprint,rooms).rejected[0].reason,'overlapping_furniture');assert.equal(compileSourceFurniture([item('kitchen_counter'),item('sink',{embeddedInCounter:true})],footprint,rooms).assets.length,2);assert.equal(compileSourceFurniture([item()],footprint,rooms,[{start:{x:2,y:0},end:{x:2,y:5}}]).rejected[0].reason,'intersects_wall');});
import vm from 'node:vm';
import {repairOverlappingWalls} from '../src/lib/wallOverlapRepair.mjs';
import {filterOpenPlanPartitions} from '../src/lib/openPlanPartitions.mjs';
test('actual route projects observations once, preserves same-name unlabeled rooms and marks source mode',()=>{const src=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');const c=vm.createContext({createPrintedDimensionAlignment,mapPrintedDimensionPoint,prepareObservedOpeningWalls,canonicalRoomType,process:{env:{}},compileSourceFurniture,repairOverlappingWalls,filterOpenPlanPartitions,outdoorBoundaries,observedDoorOrientation});vm.runInContext(src.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.normalize=normalizeScene;',c);const poly=(a,b)=>[{x:a,y:0},{x:b,y:0},{x:b,y:1},{x:a,y:1}];const r=c.normalize({title:'test',coordinateMode:'image_normalized',widthMeters:10,depthMeters:10,footprint:poly(0,1),rooms:[{id:'a',name:'Room',type:'living',labelVisible:false,polygon:poly(0,.5)},{id:'b',name:'Room',type:'living',labelVisible:false,polygon:poly(.5,1)}],relationships:[],partitions:[],openings:[],furniture:[{...item(),backLeft:{x:.4,y:.2},backRight:{x:.2,y:.2},frontCenter:{x:.3,y:.3}}]},{width:1000,height:1000});assert.equal(r.rooms.length,2);assert.equal(r.furnishingMode,'source_observed');const observed=r.assets.find(a=>a.placementSource==='source_image_observation_v1');assert.ok(observed);assert.equal(observed.width,2);assert.equal(observed.yMeters,7.5);assert.equal(r.geometryValidation.furnishing.collisionAware,true);assert.equal(r.geometryValidation.furnishing.doorClearanceAware,false);});

test('reversed back endpoints retain identical placement and facing for every orientation',()=>{
 for(const type of ['bed','sofa','dining_table','tv_unit','kitchen_counter'])for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5,.7]){
 const rotate=p=>({x:5+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:5+p.x*Math.sin(angle)+p.y*Math.cos(angle)});
 const o=item(type,{backLeft:rotate({x:-1,y:0}),backRight:rotate({x:1,y:0}),frontCenter:rotate({x:0,y:1})});
 const reversed={...o,backLeft:o.backRight,backRight:o.backLeft};
 const a=compileSourceFurniture([o],footprint,rooms).assets[0],b=compileSourceFurniture([reversed],footprint,rooms).assets[0];
 assert.ok(a&&b);for(const key of ['xMeters','yMeters','width','depth'])assert.ok(Math.abs(a[key]-b[key])<1e-9);
 assert.ok(Math.abs(Math.sin((a.rotation-b.rotation)*Math.PI/180))<1e-9);
 assert.ok(Math.cos((a.rotation-b.rotation)*Math.PI/180)>.999999);
 }
});
test('sideways front point is still rejected',()=>{assert.equal(compileSourceFurniture([item('bed',{frontCenter:{x:4,y:3}})],footprint,rooms).rejected[0].reason,'invalid_front_axis');});

test('uploaded scene restores six tucked chairs without changing geometry or observations',()=>{
 const s=JSON.parse(fs.readFileSync(new URL('fixtures/source-20260929-110028.json',import.meta.url),'utf8'));const before=JSON.stringify(s);
 const result=compileSourceFurniture(s.furnishingReview.observations,s.footprint,s.rooms,s.walls);
 assert.equal(result.assets.filter(a=>a.type==='chair').length,6);
 assert.equal(result.assets.length,21);
 assert.equal(result.rejected.find(a=>a.id==='bed-1').reason,'invalid_front_axis');
 assert.equal(JSON.stringify(s),before);
 const chairs=s.furnishingReview.observations.filter(a=>a.id.startsWith('chair-')&&a.id!=='chair-7');const table=s.furnishingReview.observations.find(a=>a.type==='dining_table');
 assert.equal(compileSourceFurniture([...chairs,table],s.footprint,s.rooms,s.walls).assets.length,7);
});
test('chair deep inside a table remains rejected',()=>{
 assert.equal(compileSourceFurniture([item('dining_table'),item('chair')],footprint,rooms).assets.length,1);
});
