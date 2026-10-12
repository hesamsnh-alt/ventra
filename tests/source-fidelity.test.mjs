import {createPrintedDimensionAlignment,mapPrintedDimensionPoint} from '../src/lib/printedDimensionAlignment.mjs';
import {prepareObservedOpeningWalls} from '../src/lib/sourceOpeningWalls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applySourceFurnitureReview} from '../src/lib/sourceFurnitureReview.mjs';
import {compileSourceFurniture} from '../src/lib/sourceFurniture.mjs';
import {canonicalRoomType} from '../src/lib/roomSemantics.mjs';
import {outdoorBoundaries,observedDoorOrientation} from '../src/lib/schematicBoundaries.mjs';
import {repairOverlappingWalls} from '../src/lib/wallOverlapRepair.mjs';
import {filterOpenPlanPartitions} from '../src/lib/openPlanPartitions.mjs';
const poly=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
const observation=(id,type,a,b,f,roomId='r')=>({id,type,groupId:type==='sofa'?'L':'',roomId,backLeft:a,backRight:b,frontCenter:f,confidence:.95,embeddedInCounter:false});
const furniture=[observation('leg1','sofa',{x:.1,y:.2},{x:.3,y:.2},{x:.2,y:.3}),observation('leg2','sofa',{x:.1,y:.3},{x:.1,y:.5},{x:.2,y:.4}),observation('bed','bed',{x:.5,y:.1},{x:.7,y:.1},{x:.6,y:.3}),observation('washer','washing_machine',{x:.8,y:.8},{x:.86,y:.8},{x:.83,y:.86},'wash')];
const scene=()=>({width:10,depth:10,footprint:poly,walls:[],openings:[],rooms:[{id:'r',type:'living',polygon:poly},{id:'wash',name:'رخت‌شوی‌خانه',polygon:[{x:7,y:0},{x:10,y:0},{x:10,y:3},{x:7,y:3}]}],geometryValidation:{sourceProjection:{sourceBounds:{minX:0,minY:0,maxX:1,maxY:1}},furnishing:{}},furnishingReview:{}});
test('furniture review retains touching L legs, bed headboard direction and washer without altering architecture',()=>{
 const input=scene(),before=JSON.stringify(input),result=applySourceFurnitureReview(input,furniture);
 assert.equal(JSON.stringify(input),before);for(const key of ['rooms','walls','openings','footprint'])assert.strictEqual(result[key],input[key]);
 assert.equal(result.assets.length,4);assert.equal(result.assets.filter(a=>a.groupId==='L').length,2);
 const bed=result.assets.find(a=>a.type==='bed');assert.equal(bed.xMeters,6);assert.equal(bed.yMeters,8);assert.ok(Math.cos(bed.rotation*Math.PI/180)<-.999);
 assert.equal(result.assets.find(a=>a.type==='washing_machine').roomId,'wash');assert.deepEqual(result.furnishingReview.missing,[]);
});
test('unconfirmed laundry appliance is reported rather than invented',()=>{const s=scene();const r=applySourceFurnitureReview(s,furniture.slice(0,3));assert.equal(r.assets.some(a=>a.type==='washing_machine'),false);assert.equal(r.furnishingReview.missing[0].type,'washing_machine');assert.equal(r.furnishingReview.requiresReview,true);});
test('oriented furniture outside its assigned room and missing confidence are rejected',()=>{
 const s=scene();const wrong=observation('wrong','washing_machine',{x:1,y:7},{x:2,y:7},{x:1.5,y:8},'wash');
 assert.equal(compileSourceFurniture([wrong],poly,s.rooms).rejected[0].reason,'outside_assigned_room');
 const unknown={...wrong,roomId:'r',confidence:undefined};assert.equal(compileSourceFurniture([unknown],poly,s.rooms).rejected[0].reason,'uncertain_observation');
});
test('actual route keeps adjacent L legs and does not replace an invalid source bed with a default',()=>{
 const src=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');
 const context=vm.createContext({createPrintedDimensionAlignment,mapPrintedDimensionPoint,prepareObservedOpeningWalls,process:{env:{}},canonicalRoomType,compileSourceFurniture,repairOverlappingWalls,filterOpenPlanPartitions,outdoorBoundaries,observedDoorOrientation});
 vm.runInContext(src.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.normalize=normalizeScene;',context);
 const normalized=poly.map(p=>({x:p.x/10,y:p.y/10}));
 const r=context.normalize({coordinateMode:'image_normalized',widthMeters:10,depthMeters:10,footprint:normalized,rooms:[{id:'r',name:'نشیمن',type:'living',polygon:normalized}],partitions:[],relationships:[],openings:[],furniture:[...furniture.slice(0,2),{...furniture[2],confidence:.2}]},{width:1000,height:1000});
 assert.equal(r.assets.filter(a=>a.type==='sofa').length,2);assert.equal(r.assets.some(a=>a.type==='bed'),false);assert.equal(r.assets.some(a=>a.placementSource==='ventra_validated_completion_v1'),false);
});

test('connectivity never invents bedroom doors and multiple observed access doors survive',()=>{
 const src=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');
 const context=vm.createContext({createPrintedDimensionAlignment,mapPrintedDimensionPoint,prepareObservedOpeningWalls,process:{env:{}},canonicalRoomType,compileSourceFurniture,repairOverlappingWalls,filterOpenPlanPartitions,outdoorBoundaries,observedDoorOrientation});
 vm.runInContext(src.replace(/^import .*;\n/gm,'').split('function parseJson')[0]+'\nthis.required=ensureRequiredDoors;this.access=normalizeEnclosedRoomDoors;',context);
 const walls=[{id:'w',type:'internal',start:{x:0,y:2},end:{x:4,y:2}}],rooms=[{id:'bed',type:'bedroom',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:0,y:2}]},{id:'corridor',type:'corridor',polygon:[{x:0,y:2},{x:4,y:2},{x:4,y:3},{x:0,y:3}]}],relationships=[{roomAId:'bed',roomBId:'corridor',relation:'door',confidence:.99}];
 assert.equal(context.required([],walls,rooms,relationships).openings.length,0);
 assert.equal(context.access([],walls,rooms,relationships,rooms[0].polygon).openings.length,0);
 const doors=[{id:'d1',type:'door',wallId:'w',offset:.2,width:.7},{id:'d2',type:'door',wallId:'w',offset:.7,width:.7}];
 assert.deepEqual(Array.from(context.access(doors,walls,rooms,relationships,rooms[0].polygon).openings,d=>d.id),['d1','d2']);
});
