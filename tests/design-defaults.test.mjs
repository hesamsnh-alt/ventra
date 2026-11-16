import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDesignDefaults,DESIGN_DEFAULTS} from '../src/lib/designDefaults.mjs';
import {placementProblem} from '../src/lib/scenePromptActions.mjs';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const scene=name=>({width:12,depth:10,height:2.8,footprint:rect(0,0,12,10),rooms:[{id:'room',name,polygon:rect(0,0,12,10)}],walls:[],openings:[],assets:[]});
test('WC in three languages gets proposed shower toilet and basin even without symbols',()=>{
 for(const name of ['WC','سرویس بهداشتی','دورة المياه']){
  const s=scene(name),before=structuredClone(s),r=applyDesignDefaults(s);
  assert.deepEqual(r.assets.map(a=>a.type),['toilet','shower','sink']);
  assert.equal(r.rooms[0].floorFinish,'wet_tile');assert.equal(r.height,3.2);
  assert.deepEqual(s,before);
  assert.ok(r.assets.every(a=>a.provenance==='proposed'&&a.excludeFromTakeoff));
  assert.deepEqual(r.walls,s.walls);assert.deepEqual(r.openings,s.openings);assert.deepEqual(r.rooms[0].polygon,s.rooms[0].polygon);
 }
});
test('bedroom and living defaults are persistent, parquet floors and no duplicates',()=>{
 for(const [name,expected] of [['اتاق خواب',['bed','dressing_table']],['Living room',['sofa','tv_unit','plant']]]){
  const r=applyDesignDefaults(scene(name));assert.deepEqual(r.assets.map(a=>a.type),expected);
  assert.equal(r.rooms[0].floorFinish,'light_oak');assert.equal(applyDesignDefaults(r),r);
  for(const a of r.assets)assert.equal(placementProblem(a,r),null);
 }
});
test('kitchen includes equipment, aerial hood and dining chairs with safe footprints',()=>{
 const r=applyDesignDefaults(scene('Kitchen'));
 for(const type of ['kitchen_counter','sink','stove','range_hood','washing_machine','refrigerator','kitchen_island','chair'])assert.ok(r.assets.some(a=>a.type===type),type);
 const hood=r.assets.find(a=>a.type==='range_hood'),stove=r.assets.find(a=>a.type==='stove');
 assert.equal(hood.mountedAboveId,stove.id);assert.equal(hood.zMeters,1.95);
 assert.equal(r.assets.filter(a=>a.type==='chair').length,4);
});
test('explicit heights and materials are preserved; compact or invalid rooms warn, never expand',()=>{
 const s={...scene('Bedroom'),height:4.1,heightSource:'source_dimension'};s.rooms[0].floorFinish='wet_tile';
 const r=applyDesignDefaults(s);assert.equal(r.height,4.1);assert.equal(r.rooms[0].floorFinish,'wet_tile');
 const tiny=scene('WC');tiny.rooms[0].polygon=rect(1,1,.3,.3);
 const t=applyDesignDefaults(tiny);assert.equal(t.assets.length,0);assert.equal(t.designDefaults.warnings.length,3);assert.deepEqual(t.rooms[0].polygon,tiny.rooms[0].polygon);
 const engineering={urn:'original',wall_height:4,rooms:[{name:'WC',area:4}]};assert.equal(applyDesignDefaults(engineering),engineering);
});
test('source furniture and later user removals remain authoritative',()=>{
 const s=scene('Living');s.assets=[{id:'observed',roomId:'room',type:'sofa',width:2,depth:1,height:.8,xMeters:6,yMeters:5,rotation:0,placementSource:'source_image_observation_v1'}];
 const r=applyDesignDefaults(s);assert.deepEqual(r.assets[0],s.assets[0]);assert.equal(r.assets.filter(a=>a.type==='sofa').length,1);
 const edited={...r,assets:r.assets.filter(a=>a.type!=='plant')};assert.equal(applyDesignDefaults(edited),edited);
 assert.deepEqual(r.designDefaults.viewOriginMeters,{x:6,y:5,z:0});assert.equal(DESIGN_DEFAULTS.wallHeightMeters,3.2);
});
test('combined living kitchens recognize Persian and Arabic and center irregular footprints',()=>{
 for(const name of ['آشپزخانه و پذیرایی','مطبخ ومعيشة']){
  const s=scene(name);s.footprint=rect(1,0,10,8);
  const r=applyDesignDefaults(s);
  for(const type of ['sofa','tv_unit','plant','stove','range_hood','kitchen_island'])assert.ok(r.assets.some(a=>a.type===type),`${name}: ${type}`);
  assert.deepEqual(r.designDefaults.viewOriginMeters,{x:6,y:4,z:0});
 }
});

test('a new bedroom vanity places the mirror face inward',()=>{
 const result=applyDesignDefaults(scene('Bedroom'));
 const vanity=result.assets.find(a=>a.type==='dressing_table');
 assert.ok(vanity.yMeters<.5);
 assert.ok(Math.cos(vanity.rotation*Math.PI/180)>.99);
});

test('a full kitchen uses three supported rows, a centered sink, a washer under a worktop and stools around the island',()=>{
 const model=applyDesignDefaults(scene('Kitchen'));
 const assets=model.assets,base=assets.filter(a=>a.variant==='kitchen-base');
 assert.equal(base.length,3);
 assert.equal(new Set(base.map(a=>a.rotation)).size,3);
 for(const run of base)assert.ok(assets.some(a=>a.variant==='kitchen-upper'&&a.layoutAnchorId===run.id&&a.zMeters>run.height));
 const sink=assets.find(a=>a.type==='sink'),host=base.find(a=>a.id===sink.layoutAnchorId);
 assert.ok(sink.embeddedInCounter);assert.equal(sink.xMeters,host.xMeters);assert.equal(sink.yMeters,host.yMeters);
 const stove=assets.find(a=>a.type==='stove'),hood=assets.find(a=>a.type==='range_hood');
 assert.equal(hood.mountedAboveId,stove.id);assert.equal(hood.xMeters,stove.xMeters);assert.equal(hood.yMeters,stove.yMeters);
 const washer=assets.find(a=>a.type==='washing_machine'),top=assets.find(a=>a.worktopOnly);
 assert.ok(washer.underCounter);assert.equal(top.layoutAnchorId,washer.id);assert.equal(top.zMeters,washer.height);assert.equal(top.xMeters,washer.xMeters);assert.equal(top.yMeters,washer.yMeters);
 const island=assets.find(a=>a.type==='kitchen_island'),stools=assets.filter(a=>a.variant==='bar-stool');
 assert.ok(stools.length>=2&&stools.every(a=>a.groupId===island.id));
 assert.equal(placementProblem({...island,width:island.width+2.14,depth:island.depth+2.14},{...model,assets:assets.filter(a=>a.groupId!==island.id)}),null);
});

test('compact open kitchens use only supported rows and never force an island or a freestanding sink',()=>{
 const input=scene('Kitchen');input.rooms[0].polygon=rect(0,0,4.2,2.35);
 input.walls=[{id:'back',start:{x:0,y:0},end:{x:4.2,y:0},thickness:.2}];
 const designed=applyDesignDefaults(input);
 assert.equal(designed.assets.filter(a=>a.variant==='kitchen-base').length,1);
 assert.ok(designed.assets.filter(a=>a.type==='sink').every(a=>a.embeddedInCounter));
 assert.ok(!designed.assets.some(a=>a.type==='kitchen_island'));assert.deepEqual(designed.walls,input.walls);
});

test('existing kitchens can upgrade while preserving source fixtures and prior deliberate deletions',()=>{
 const input=scene('Kitchen'),design=applyDesignDefaults(input);
 const old={...input,designDefaults:{version:'room-design-defaults-v64',addedAssetIds:['default_room_washing_machine_2']},assets:[
  {...design.assets.find(a=>a.type==='sink'),id:'observed_sink',placementSource:'source_image_observation_v1'},
 ]};
 const upgraded=applyDesignDefaults(old);
 assert.deepEqual(upgraded.assets[0],old.assets[0]);
 assert.ok(!upgraded.assets.some(a=>a.type==='washing_machine'));
 assert.equal(applyDesignDefaults(upgraded),upgraded);
});
