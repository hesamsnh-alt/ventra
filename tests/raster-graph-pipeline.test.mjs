import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {runPixelGraphPipeline} from '../src/lib/rasterGraphPipeline.mjs';
import {assertVerifiedPreview} from '../src/lib/verifiedPreview.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
async function fixture({wardrobe=false,voidCore=false,bad=false,omit=false}={}){
 const buffer=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="white"/><g stroke="black" fill="none" stroke-width="1"><rect x="50" y="50" width="500" height="400"/><path d="M300 50V450"/></g></svg>')).jpeg().toBuffer();
 let calls=0;const diagnostics={};
 const classify=async task=>{
  calls++;
  if(task.stage==='classify_source_lines'){
   const walls=task.data.candidates.filter(c=>c.kind==='stroke').map(c=>({candidateId:c.id,type:Math.abs(c.start.x-300)<3&&Math.abs(c.end.x-300)<3?'internal':'external'}));
   if(bad)walls[0].candidateId='fabricated-by-model';
   return{title:'Two-space source',complete:true,confidence:.8,walls,nonWalls:[],unresolvedCandidateIds:[],openings:[],missingFeatures:[],inventory:{enclosedSpaceNames:['Bedroom','Other'],doorCount:0,windowCount:0}};
  }
  const regions=task.data.regions.map((r,i)=>({regionId:r.id,name:i?'Other':'Bedroom',type:'bedroom',context:'bedroom',pattern:'none',details:'present',explicitUse:'room',parentRegionId:null}));
  if(wardrobe)Object.assign(regions[1],{name:'Wardrobe',pattern:'cross',details:'none',explicitUse:'unknown',parentRegionId:regions[0].regionId});
  if(voidCore)Object.assign(regions[1],{name:'Entrance core',context:'entrance',pattern:'solid_fill',details:'none',explicitUse:'unknown'});
  if(omit)regions.pop();
  const a=task.data.anchors.reduce((a,b)=>distance(a,{x:50,y:50})<distance(b,{x:50,y:50})?a:b),b=task.data.anchors.reduce((a,b)=>distance(a,{x:550,y:50})<distance(b,{x:550,y:50})?a:b);
  return{title:'Pixel-grounded apartment',confidence:.8,wallHeightMeters:null,regions,measurements:[{text:'5 m',startAnchorId:a.id,endAnchorId:b.id,meters:5}]};
 };
 return{buffer,diagnostics,classify,get calls(){return calls}};
}
test('real image bytes go through local lines, two ID-only semantic tasks, pixel checks and scene compiler',async()=>{
 const f=await fixture(),out=await runPixelGraphPipeline(f);assert.equal(f.calls,2);assertVerifiedPreview(out);assert.equal(out.scene.rooms.length,2);assert.equal(out.scene.geometryValidation.coordinateAuthority,'source_pixel_graph');assert.ok(Math.abs(out.scene.width-5)<.03);assert.equal(out.scene.holes.length,0);
});
test('actual pipeline excludes a marked entrance core from floor and keeps its walls',async()=>{
 const f=await fixture({voidCore:true}),out=await runPixelGraphPipeline(f);assertVerifiedPreview(out);assert.equal(out.scene.holes.length,1);assert.equal(out.scene.rooms.length,1);assert.ok(out.scene.walls.some(w=>w.type==='internal'));
});
test('actual pipeline keeps wardrobe floor and removes its furniture divider from architecture',async()=>{
 const f=await fixture({wardrobe:true}),out=await runPixelGraphPipeline(f);assertVerifiedPreview(out);assert.equal(out.scene.holes.length,0);assert.equal(out.scene.rooms.length,1);assert.equal(out.scene.sourceStorageRegions[0].role,'wardrobe');assert.equal(out.scene.walls.filter(w=>w.type==='internal').length,0);assert.equal(out.scene.assets[0].type,'wardrobe');assert.equal(out.scene.assets[0].roomId,out.scene.rooms[0].id);assert.equal(out.scene.assets[0].placementSource,'source_pixel_graph');assert.ok(out.scene.assets[0].width*out.scene.assets[0].depth>9.9);
});
test('invented source ID stops after one semantic call and cannot produce a scene',async()=>{
 const f=await fixture({bad:true});await assert.rejects(runPixelGraphPipeline(f),{code:'INVALID_PIXEL_SELECTION'});assert.equal(f.calls,1);assert.equal(f.diagnostics.accepted,false);
});
test('missing semantic room blocks success rather than deleting a room to pass validation',async()=>{
 const f=await fixture({omit:true});await assert.rejects(runPixelGraphPipeline(f),{code:'INCOMPLETE_REGION_CLASSIFICATION'});assert.equal(f.calls,2);assert.equal(f.diagnostics.accepted,false);
});
test('blank source never reaches a paid classifier',async()=>{
 const buffer=await sharp({create:{width:600,height:500,channels:3,background:'#fff'}}).jpeg().toBuffer();let calls=0;await assert.rejects(runPixelGraphPipeline({buffer,classify:async()=>{calls++;}}),{code:'NO_PIXEL_STRUCTURE'});assert.equal(calls,0);
});
test('a coloured crossed wardrobe is interpreted inside a bedroom without architectural walls or a floor hole',async()=>{
 const buffer=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="white"/><g stroke="black" fill="none" stroke-width="1"><rect x="50" y="50" width="500" height="400"/><path d="M300 50V450"/></g><g stroke="#009944" fill="none" stroke-width="2"><rect x="100" y="100" width="100" height="100"/><path d="M100 100L200 200M100 200L200 100"/></g></svg>')).jpeg().toBuffer();
 const out=await runPixelGraphPipeline({buffer,classify:async task=>{
  if(task.stage==='classify_source_lines'){
   const walls=task.data.candidates.filter(c=>c.kind==='stroke'&&!c.colorEvidence).map(c=>({candidateId:c.id,type:Math.abs(c.start.x-300)<3&&Math.abs(c.end.x-300)<3?'internal':'external'}));
   return{complete:true,walls,nonWalls:task.data.candidates.filter(c=>!walls.some(w=>w.candidateId===c.id)).map(c=>({candidateId:c.id,reason:c.colorEvidence&&c.kind==='stroke'?'furniture':'alternative_face'})),unresolvedCandidateIds:[],openings:[],inventory:{enclosedSpaceNames:['Bedroom','Room'],doorCount:0,windowCount:0},missingFeatures:[]};
  }
  assert.equal(task.data.symbolEnclosures.length,1);
  const parent=task.data.regions.find(r=>Math.min(...r.polygon.map(p=>p.x))<100&&Math.max(...r.polygon.map(p=>p.x))>200&&Math.max(...r.polygon.map(p=>p.x))<400);
  const closest=p=>task.data.anchors.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b);
  return{title:'Bedroom with source wardrobe',confidence:.8,wallHeightMeters:null,regions:task.data.regions.map(r=>({regionId:r.id,name:r.id===parent.id?'Bedroom':'ROOM',sourceText:r.id===parent.id?'Bedroom':'ROOM',fixtures:[],type:'bedroom',context:'bedroom',pattern:'none',details:'present',explicitUse:'room',parentRegionId:null})),symbols:[{enclosureId:task.data.symbolEnclosures[0].id,parentRegionId:parent.id,sourceText:'',pattern:'cross',details:'none',explicitUse:'unknown'}],measurements:[{text:'5m',meters:5,startAnchorId:closest({x:50,y:50}).id,endAnchorId:closest({x:550,y:50}).id}]};
 }});
 assertVerifiedPreview(out);assert.equal(out.scene.holes.length,0);assert.equal(out.scene.assets.length,1);assert.equal(out.scene.assets[0].type,'wardrobe');assert.equal(out.scene.rooms.length,2);assert.ok(Math.abs(out.scene.assets[0].width*out.scene.assets[0].depth-1)<.04);
});
