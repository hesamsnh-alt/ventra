import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {compactPixelClassificationInput,measuredSpanCoverage,validateSourceBandCoverage} from '../src/lib/rasterClassificationInput.mjs';
import {pixelGraphOverlay,assemblePixelTopology} from '../src/lib/rasterPixelGraph.mjs';
import {pixelClassificationDetailViews,runPixelGraphPipeline} from '../src/lib/rasterGraphPipeline.mjs';
import {pixelClassificationViewLayout,validatePixelClassification} from '../src/lib/rasterGraphPipeline.mjs';
import {pixelCandidateLabelAnchor} from '../src/lib/rasterPixelGraph.mjs';
import fs from 'node:fs';
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
 assert.equal(views.length,3);assert.match(views[0],/^data:image\/jpeg;base64,/);assert.equal(JSON.stringify(g),before);
});
test('the real failed selection remains rejected with its actual unresolved reasons and source bands',()=>{
 const {graph,selection}=JSON.parse(fs.readFileSync(new URL('./fixtures/pixel-classification-rejection-v140.json',import.meta.url)));
 assert.throws(()=>validatePixelClassification(graph,selection),error=>{
  assert.equal(error.code,'INCOMPLETE_PIXEL_CLASSIFICATION');assert.equal(error.details.complete,false);
  assert.deepEqual(error.details.missingFeatures,selection.missingFeatures);assert.equal(error.details.candidateCount,330);
  assert.deepEqual(error.details.uncoveredBands,[]);return true;
 });
});
test('every real candidate has a visible ID in a bounded, separate evidence layer without moving geometry',()=>{
 const {graph}=JSON.parse(fs.readFileSync(new URL('./fixtures/pixel-classification-rejection-v140.json',import.meta.url))),before=JSON.stringify(graph),views=pixelClassificationViewLayout(graph),visible=new Set();
 assert.ok(views.length<=9);
 for(const view of views){
  const ids=new Set(view.candidateIds),candidates=graph.candidates.filter(c=>ids.has(c.id));
  assert.ok(candidates.every(c=>c.kind===view.kind||['stroke_fragment','observed_wall_fragment'].includes(c.kind)&&['stroke_fragment','observed_wall_fragment'].includes(view.kind)));
  const svg=pixelGraphOverlay({...graph,candidates,gaps:[]},{layer:'all',viewport:view.viewport});
  for(const c of candidates){
   const anchor=pixelCandidateLabelAnchor(c,view.viewport);if(!anchor)continue;
   assert.ok(svg.includes(`>${c.id}</text>`));visible.add(c.id);
   assert.ok(anchor.x>=view.viewport.left-.01&&anchor.x<=view.viewport.right+.01&&anchor.y>=view.viewport.top-.01&&anchor.y<=view.viewport.bottom+.01);
  }
 }
 assert.equal(visible.size,graph.candidates.length);assert.equal(JSON.stringify(graph),before);
 const data=compactPixelClassificationInput(graph,{doors:[]});
 assert.ok(data.candidates.find(c=>c.id==='solid_band12').sourceIds.includes('ink109'));
 // The live response selected both of these. The old compact input omitted
 // the band's sourceIds, hiding the relation that the compiler later rejects.
 assert.ok(data.measuredWallAlternatives.find(g=>g.candidateId==='solid_band1').overlappingAlternativeIds.includes('pair103_109'));
 const selected={walls:[{candidateId:'solid_band1',type:'internal'},{candidateId:'pair103_109',type:'internal'}],openings:[]};
 assert.throws(()=>assemblePixelTopology(graph,selected),{code:'OVERLAPPING_PIXEL_SELECTION'});
});
test('a long source wall crossing a crop keeps its label inside that crop; distant lines do not leak in',()=>{
 const viewport={left:0,top:0,right:300,bottom:200},wall=line('long',20,100,2000,100);
 assert.deepEqual(pixelCandidateLabelAnchor(wall,viewport),{x:160,y:100});
 const svg=pixelGraphOverlay({imageWidth:2200,imageHeight:400,candidates:[wall,line('far',900,250,1000,250)],gaps:[]},{layer:'all',viewport});
 assert.match(svg,/>long<\/text>/);assert.doesNotMatch(svg,/>far<\/text>/);
 const [,x,y]=svg.match(/<text x="([^"]+)" y="([^"]+)"/);assert.ok(+x<300&&+y<200);
});
test('large input detail views remain bounded at production image size',async()=>{
 const g={imageWidth:2200,imageHeight:2200,candidates:[line('pair1',10,10,2000,2000,'face_pair')],gaps:[]},buffer=await sharp({create:{width:2200,height:2200,channels:3,background:'white'}}).png().toBuffer();
 assert.equal((await pixelClassificationDetailViews(buffer,g)).length,9);
});
test('incomplete semantic classification remains rejected without a second paid task',async()=>{
 const buffer=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="100%" height="100%" fill="white"/><rect x="20" y="20" width="260" height="160" fill="none" stroke="black"/></svg>')).png().toBuffer();let calls=0;
 await assert.rejects(runPixelGraphPipeline({buffer,classify:async()=>{calls++;return{complete:false,missingFeatures:[],unresolvedCandidateIds:[]};}}),{code:'INCOMPLETE_PIXEL_CLASSIFICATION'});assert.equal(calls,1);
});
