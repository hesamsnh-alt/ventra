import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFurnitureEdit} from '../src/lib/furnitureEditor.mjs';
import {OUTDOOR_GROUND_ID} from '../src/lib/outdoorGround.mjs';
import {applySurfaceMaterial,assertSurfaceOnlyEdit,surfaceKey} from '../src/lib/surfaceMaterials.mjs';

test('outdoor furniture and finishes save without altering the plan or allowing wall overlap',()=>{
 const footprint=[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}];
 const scene={width:8,depth:6,footprint,rooms:[{id:'room',polygon:footprint}],walls:[],assets:[]};
 const add=(point)=>applyFurnitureEdit(scene,{kind:'add',catalogId:'chair',point,allowOutdoor:true});
 const placed=add({x:-1,y:2});
 assert.equal(placed.assets[0].roomId,OUTDOOR_GROUND_ID);
 assert.equal(placed.assets[0].excludeFromTakeoff,true);
 assert.throws(()=>add({x:-.1,y:2}),/overlaps building/);
 assert.throws(()=>add({x:-5,y:2}),/Choose a room/);
 const target={kind:'outdoor-ground',id:OUTDOOR_GROUND_ID};
 const paved=applySurfaceMaterial(placed,target,'stone-beige');
 assertSurfaceOnlyEdit(placed,paved);
 assert.equal(paved.surfaceFinishes.assignments[surfaceKey(target)],'stone-beige');
 assert.deepEqual(paved.footprint,footprint);
});
