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
 for(const type of ['kitchen_counter','sink','stove','range_hood','washing_machine','refrigerator','dining_table','chair'])assert.ok(r.assets.some(a=>a.type===type),type);
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
  for(const type of ['sofa','tv_unit','plant','stove','range_hood','dining_table'])assert.ok(r.assets.some(a=>a.type===type),`${name}: ${type}`);
  assert.deepEqual(r.designDefaults.viewOriginMeters,{x:6,y:4,z:0});
 }
});
