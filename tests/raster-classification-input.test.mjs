import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {compactPixelClassificationInput,measuredSpanCoverage,validateSourceBandCoverage} from '../src/lib/rasterClassificationInput.mjs';
import {pixelGraphOverlay} from '../src/lib/rasterPixelGraph.mjs';
import {pixelClassificationDetailViews,runPixelGraphPipeline} from '../src/lib/rasterGraphPipeline.mjs';
const line=(id,x1,y1,x2,y2,kind='stroke',thicknessPixels=1)=>({id,start:{x:x1,y:y1},end:{x:x2,y:y2},kind,thicknessPixels,sourceIds:[id]});
const band=line('band',20,100,280,100,'solid_band',10);
test('overlapping alternatives do not inflate physical source coverage',()=>{
 assert.equal(measuredSpanCoverage(band,[line('a',20,100,180,100),line('b',100,100,200,100)]),180/260);
 assert.deepEqual(validateSourceBandCoverage({candidates:[band]}, {walls:[],nonWalls:[]}),['band']);
});
test('two source wall runs cover a band; distant, crossing and partially missing walls do not',()=>{
 const runs=[line('a',20,100,150,100),line('b',150,100,280,100)];
 assert.equal(measuredSpanCoverage(band,runs),1);
 assert.equal(measuredSpanCoverage(band,[line('off',20,125,280,125),line('cross',150,20,150,200)]),0);
 assert.ok(measuredSpanCoverage(band,[line('partial',20,100,130,100)])<.9);
});
test('thick unused source observations require explicit semantic review',()=>{
 const graph={candidates:[band,line('wall',20,100,280,100)]};
 assert.deepEqual(validateSourceBandCoverage(graph,{walls:[{candidateId:'wall'}],nonWalls:[]}),[]);
 assert.deepEqual(validateSourceBandCoverage(graph,{walls:[],nonWalls:[{candidateId:'band',reason:'furniture'}]}),[]);
});
test('compact request keeps selectable geometry and wall-band accountability without duplicated ink metadata',()=>{
 const g={candidates:[{...band,boundarySourceIds:['face1','face2'],lengthPixels:260,support:'measured_solid_band'}],gaps:[]},data=compactPixelClassificationInput(g,{doors:[]});
 assert.deepEqual(data.requiredSourceBandIds,['band']);assert.deepEqual(data.candidates[0].start,band.start);assert.equal(data.candidates[0].boundarySourceIds,undefined);assert.match(data.selectionContract,/complete=true/);
});
test('all alternative candidate IDs have a separate visible label without changing their source coordinates',async()=>{
 const candidates=[band,line('pair1_2',20,100,280,100,'face_pair',10),line('ink1_part2',100,110,280,110,'stroke_fragment')],g={imageWidth:300,imageHeight:200,candidates,gaps:[]},before=JSON.stringify(g),svg=pixelGraphOverlay(g,{layer:'alternatives'});
 assert.match(svg,/>pair1_2<\/text>/);assert.match(svg,/>ink1_part2<\/text>/);assert.doesNotMatch(svg,/>band<\/text>/);
 const buffer=await sharp({create:{width:300,height:200,channels:3,background:'white'}}).png().toBuffer(),views=await pixelClassificationDetailViews(buffer,g);
 assert.equal(views.length,1);assert.match(views[0],/^data:image\/jpeg;base64,/);assert.equal(JSON.stringify(g),before);
});
test('large input detail views remain bounded at production image size',async()=>{
 const g={imageWidth:2200,imageHeight:2200,candidates:[line('pair1',10,10,2000,2000,'face_pair')],gaps:[]},buffer=await sharp({create:{width:2200,height:2200,channels:3,background:'white'}}).png().toBuffer();
 assert.equal((await pixelClassificationDetailViews(buffer,g)).length,9);
});
test('incomplete semantic classification remains rejected without a second paid task',async()=>{
 const buffer=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100%" height="100%" fill="white"/><rect x="20" y="20" width="260" height="160" fill="none" stroke="black"/></svg>')).png().toBuffer();let calls=0;
 await assert.rejects(runPixelGraphPipeline({buffer,classify:async()=>{calls++;return{complete:false,missingFeatures:[],unresolvedCandidateIds:[]};}}),{code:'INCOMPLETE_PIXEL_CLASSIFICATION'});assert.equal(calls,1);
});
