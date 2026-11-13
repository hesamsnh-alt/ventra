import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {extractRasterPixelGraph,assemblePixelTopology} from '../src/lib/rasterPixelGraph.mjs';
import {discoverRasterOpenings,sourceDoorGapCandidates} from '../src/lib/rasterOpeningDiscovery.mjs';
import {runPixelGraphPipeline} from '../src/lib/rasterGraphPipeline.mjs';
const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
async function fixture({radius=60,rotation=0,side=1,leaf=true,arc=true,stroke='#111',corner=false}={}){
 const hinge={x:270,y:240},end={x:hinge.x+radius,y:hinge.y},tip={x:hinge.x,y:hinge.y+side*radius};
 const body=`<rect x="100" y="100" width="400" height="300"/>${corner?'<path d="M270 100V240"/>':'<path d="M100 240H270"/>'}<path d="M${end.x} 240H500"/>${leaf?`<path d="M270 240L${tip.x} ${tip.y}"/>`:''}${arc?`<path d="M${end.x} 240A${radius} ${radius} 0 0 ${side>0?1:0} ${tip.x} ${tip.y}"/>`:''}`;
 const b=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="white"/><g transform="rotate(${rotation} 300 250)" fill="none" stroke="${stroke}" stroke-width="1.5">${body}</g></svg>`)).jpeg({quality:92}).toBuffer(),graph=await extractRasterPixelGraph(b),found=await discoverRasterOpenings(b,graph),a=rotation*Math.PI/180,transform=p=>({x:300+(p.x-300)*Math.cos(a)-(p.y-250)*Math.sin(a),y:250+(p.x-300)*Math.sin(a)+(p.y-250)*Math.cos(a)});
 return{buffer:b,graph,found,hinge:transform(hinge),end:transform(end)};
}
for(const settings of [{},{radius:24},{radius:36,rotation:90},{radius:80,rotation:17},{rotation:-23,side:-1},{corner:true},{stroke:'#d2d2d2'}])test(`automatically finds a source door without supplied endpoints ${JSON.stringify(settings)}`,async()=>{
 const f=await fixture(settings);assert.equal(f.found.doors.length,1,JSON.stringify(f.found));const door=f.found.doors[0];assert.ok(d(door.start,f.hinge)<5,JSON.stringify(door));assert.ok(d(door.end,f.end)<6);assert.equal(door.swingDirection,settings.side===-1?'counterclockwise':'clockwise');
 const gaps=sourceDoorGapCandidates(f.graph,f.found);assert.equal(gaps.length,1);assert.ok(gaps[0].endpointHosts.start.length||gaps[0].endpointHosts.end.length);
});
for(const settings of [{arc:false},{leaf:false},{leaf:false,arc:false}])test(`unreadable symbol cannot invent a door ${JSON.stringify(settings)}`,async()=>{const f=await fixture(settings);assert.equal(f.found.doors.length,0);});
test('blank paper yields no automatic door',async()=>{const b=await sharp({create:{width:400,height:300,channels:3,background:'white'}}).png().toBuffer(),graph=await extractRasterPixelGraph(b);assert.equal((await discoverRasterOpenings(b,graph)).doors.length,0);});
for(const rotation of [0,90])test(`crossed storage and room-label glyphs are not doors at ${rotation} degrees`,async()=>{
 const b=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="white"/><g transform="rotate(${rotation} 300 250)" stroke="#111" stroke-width="1.5" fill="none"><rect x="100" y="100" width="400" height="300"/><rect x="350" y="280" width="70" height="84"/><path d="M350 280L420 364M420 280L350 364"/></g><text x="150" y="200" transform="rotate(${rotation} 300 250)" font-family="sans-serif" font-size="28">LIVING ROOM</text></svg>`)).jpeg({quality:92}).toBuffer(),graph=await extractRasterPixelGraph(b),out=await discoverRasterOpenings(b,graph);assert.equal(out.doors.length,0,JSON.stringify(out.doors));
});
test('short thick jambs survive even when shorter than long-line voting threshold',async()=>{
 const b=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="100%" height="100%" fill="white"/><path d="M50 100H250M310 100H324M390 100H550" stroke="black" stroke-width="10"/></svg>')).png().toBuffer(),g=await extractRasterPixelGraph(b);assert.ok(g.candidates.some(s=>s.kind==='solid_band'&&s.start.x>300&&s.end.x<330&&Math.abs(s.start.y-100)<2),JSON.stringify(g.ink));
});
test('a door at one wall end does not erase the surrounding closed room face',()=>{
 const p=(x,y)=>({x,y}),candidates=[{id:'top',start:p(0,0),end:p(400,0)},{id:'right',start:p(400,0),end:p(400,300)},{id:'bottom',start:p(0,300),end:p(400,300)},{id:'left',start:p(0,0),end:p(0,300)},{id:'branch',start:p(0,150),end:p(100,150)}].map(s=>({...s,sourceIds:[s.id]})),graph={imageWidth:500,imageHeight:400,ink:candidates,candidates,gaps:[{id:'door',start:p(100,150),end:p(160,150),support:'observed_arc_and_leaf',endpointHosts:{start:['branch'],end:[]},sourceDoor:{hingeSide:'end',swingDirection:'clockwise'}}]},selection={walls:candidates.map(c=>({candidateId:c.id,type:'internal'})),openings:[{gapId:'door',type:'door'}]},t=assemblePixelTopology(graph,selection);assert.equal(t.regions.length,1);assert.equal(t.regions[0].areaPixels,120000);assert.equal(t.openings.length,1);assert.ok(t.lines.some(l=>l.id==='door'));assert.ok(t.edges.some(e=>e.sourceId==='door'));
 assert.throws(()=>assemblePixelTopology(graph,{...selection,openings:[{gapId:'door',type:'window'}]}),{code:'INVALID_PIXEL_OPENING'});
});
test('automatic opening discovery reaches the strict 3D compiler with source geometry and a mocked semantic classifier',async()=>{
 const f=await fixture(),out=await runPixelGraphPipeline({buffer:f.buffer,classify:async task=>{
  if(task.stage==='classify_source_lines'){
   assert.equal(task.data.sourceDoors.length,1);
   const walls=task.data.candidates.filter(c=>c.kind==='stroke'&&[100,400].some(y=>Math.abs(c.start.y-y)<2&&Math.abs(c.end.y-y)<2)||c.kind==='stroke'&&[100,500].some(x=>Math.abs(c.start.x-x)<2&&Math.abs(c.end.x-x)<2)||c.kind==='stroke'&&Math.abs(c.start.y-240)<2&&Math.abs(c.end.y-240)<2).map(c=>({candidateId:c.id,type:Math.abs(c.start.y-240)<2?'internal':'external'}));
   return{complete:true,walls,nonWalls:task.data.candidates.filter(c=>!walls.some(w=>w.candidateId===c.id)).map(c=>({candidateId:c.id,reason:'alternative_face'})),unresolvedCandidateIds:[],missingFeatures:[],inventory:{enclosedSpaceNames:['ROOM','ROOM'],doorCount:1,windowCount:0},openings:[{gapId:task.data.sourceDoors[0].id,type:'door'}]};
  }
  const closest=p=>task.data.anchors.reduce((a,b)=>d(a,p)<d(b,p)?a:b);
  return{title:'Automatic symbol discovery',confidence:.8,wallHeightMeters:null,regions:task.data.regions.map(r=>({regionId:r.id,name:'ROOM',sourceText:'ROOM',fixtures:[],type:'room',context:'unassigned',pattern:'none',details:'none',explicitUse:'room',parentRegionId:null})),symbols:[],measurements:[{text:'4 m',meters:4,startAnchorId:closest({x:100,y:100}).id,endAnchorId:closest({x:500,y:100}).id}]};
 }});
 assert.equal(out.scene.rooms.length,2);assert.equal(out.scene.openings.length,1);assert.equal(out.scene.openings[0].type,'door');assert.equal(out.scene.openings[0].swing,'clockwise');assert.equal(out.scene.openings[0].swingEvidence.status,'observed');
});
test('a semantic response cannot silently drop locally observed source doors',async()=>{
 const f=await fixture();let calls=0;
 await assert.rejects(runPixelGraphPipeline({buffer:f.buffer,classify:async task=>{calls++;return{complete:true,walls:[],nonWalls:task.data.candidates.map(c=>({candidateId:c.id,reason:'noise'})),unresolvedCandidateIds:[],missingFeatures:[],openings:[],inventory:{enclosedSpaceNames:[],doorCount:0,windowCount:0}};}}),{code:'INCOMPLETE_OPENING_INVENTORY'});
 assert.equal(calls,1);
});
