import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {FURNITURE_FINISHES,applyFurnitureFinish,createFurnitureFinishMaterial} from '../src/lib/furnitureFinishes.mjs';
import {applyFurnitureEdit} from '../src/lib/furnitureEditor.mjs';
test('independent furniture finishes apply, persist color edits and reset without changing geometry or quantities',()=>{
 const original={width:10,depth:8,height:3,assets:[{id:'s',type:'sofa',color:'#ffffff',width:2,depth:1,height:1,xMeters:3,yMeters:3,rotation:0,roomId:'r'},{id:'other',type:'chair',xMeters:8,yMeters:6,rotation:0,width:.5,depth:.5,height:1,roomId:'r'}],rooms:[{id:'r',polygon:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}]}],walls:[{id:'w'}],boq:{area:42},openings:[],surfaceFinishes:{assignments:{}}};const snapshot=structuredClone(original);
 let s=applyFurnitureEdit(original,{kind:'material',assetId:'s',materialId:'wood-oak',target:'body'});
 s=applyFurnitureEdit(s,{kind:'material',assetId:'s',materialId:'fabric-linen',target:'upholstery'});
 assert.equal(s.assets[0].furnitureFinishes.body.id,'wood-oak');assert.equal(s.assets[0].furnitureFinishes.upholstery.id,'fabric-linen');
 s=applyFurnitureEdit(s,{kind:'color',assetId:'s',color:'#334455'});assert.equal(s.assets[0].furnitureFinishes.body.color,'#334455');
 s=applyFurnitureEdit(s,{kind:'material',assetId:'s',materialId:null,target:'body'});assert.equal(s.assets[0].furnitureFinishes.body,undefined);assert.ok(s.assets[0].furnitureFinishes.upholstery);
 s=applyFurnitureEdit(s,{kind:'material',assetId:'s',materialId:null,target:'upholstery'});assert.equal(s.assets[0].furnitureFinishes,undefined);
 for(const key of ['rooms','walls','openings','boq','surfaceFinishes'])assert.deepEqual(s[key],original[key]);assert.deepEqual(s.assets[1],original.assets[1]);assert.equal(s.assets[0].width,2);assert.deepEqual(original,snapshot);
 assert.throws(()=>applyFurnitureFinish(original,'s','bad'));assert.throws(()=>applyFurnitureFinish(original,'other','wood-oak','wrong'));
});
test('all furniture patterns have distinct maps and correct physical material properties',()=>{
 const hashes=new Set();for(const preset of FURNITURE_FINISHES){const m=createFurnitureFinishMaterial(T,{id:preset.id});assert.ok(m.map.isDataTexture&&m.bumpMap.isDataTexture);assert.notEqual(m.map,m.bumpMap);assert.equal(m.userData.furniturePbr.metalness,preset.metalness);hashes.add(Buffer.from(m.map.image.data).toString('base64')+m.color.getHexString());m.map.dispose();m.bumpMap.dispose();m.dispose();}assert.equal(hashes.size,FURNITURE_FINISHES.length);
});
