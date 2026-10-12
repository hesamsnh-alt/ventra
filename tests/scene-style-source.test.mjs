import test from 'node:test';import assert from 'node:assert/strict';import {applySceneStyle,rememberEngineeringTakeoff,chooseEngineeringTakeoff,engineeringUrn} from '../src/lib/sceneStyle.mjs';
const base={width:12,depth:9,rooms:[{polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2}]}],walls:[{id:'w',start:{x:0,y:0},end:{x:2,y:0}}],openings:[{type:'door',width:.9}],assets:[{type:'sofa',xMeters:2,yMeters:3,width:2,depth:.8,rotation:90,color:'#888888'}]};
test('styles visibly differ in rendered palette and asset model variant while architecture and placement stay exact',()=>{const original=JSON.stringify(base),styles=['modern','minimal','luxury','facade'].map(p=>applySceneStyle(base,p));assert.equal(new Set(styles.map(s=>s.palette.externalWall)).size,4);assert.equal(new Set(styles.map(s=>s.assets[0].color)).size,4);for(const s of styles){for(const k of ['rooms','walls','openings','width','depth'])assert.deepEqual(s[k],base[k]);for(const k of ['xMeters','yMeters','width','depth','rotation'])assert.equal(s.assets[0][k],base.assets[0][k]);}assert.equal(JSON.stringify(base),original);assert.deepEqual(applySceneStyle(base,'classic'),base);});
test('source selection prefers saved engineering geometry after image input',()=>{const engineering={aps_urn:'cad-urn',geometry:{meterFactor:.001,walls:[1,2]}};assert.deepEqual(chooseEngineeringTakeoff(base,engineering),engineering);assert.equal(engineeringUrn({raw_result:{aps_urn:'nested'}}),'nested');});
test('same DWG full extraction wins over translation placeholders and compact pointers',()=>{
 const full={aps_urn:'cad',analyzed_at:'2026-10-10',geometry:{meterFactor:.001,wallLineSegments:[{start:{x:0,y:0},end:{x:1000,y:0}}]}};
 for(const partial of [{aps_urn:'cad',analyzed_at:'2026-10-11'},{aps_urn:'cad',geometry:{meterFactor:.001},__geometryStoredInIndexedDB:true}]){
  assert.equal(chooseEngineeringTakeoff(partial,full,'cad'),full);assert.equal(chooseEngineeringTakeoff(full,partial,'cad'),full);
 }
 assert.equal(chooseEngineeringTakeoff({aps_urn:'other'},full,'cad'),full);
 assert.equal(chooseEngineeringTakeoff({aps_urn:'other'},full,'absent'),null);
 assert.equal(chooseEngineeringTakeoff({aps_urn:'other'},full).aps_urn,'other','do not silently switch to a different document');
});
test('equally complete extracts select newer analysis without merging different geometry',()=>{
 const old={aps_urn:'cad',analyzed_at:'2026-10-10',geometry:{meterFactor:1,wallLineSegments:[{}]}};
 const fresh={...old,analyzed_at:'2026-10-11',geometry:{meterFactor:.001,wallLineSegments:[{},{}]}};
 assert.equal(chooseEngineeringTakeoff(old,fresh),fresh);assert.equal(chooseEngineeringTakeoff(fresh,old),fresh);
});
