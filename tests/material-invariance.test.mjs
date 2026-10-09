import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {applySceneStyle} from '../src/lib/sceneStyle.mjs';
const scene=JSON.parse(readFileSync(new URL('fixtures/source-20260926-193231.json',import.meta.url),'utf8'));
test('Every style preserves all source walls, openings, rooms, footprint and measured asset placement',()=>{
 const before=JSON.stringify(scene);
 for(const preset of ['classic','modern','minimal','luxury','facade']){const styled=applySceneStyle(scene,preset);
  for(const key of ['walls','openings','rooms','footprint','width','depth','height'])assert.deepEqual(styled[key],scene[key],preset+':'+key);
  for(const [i,asset]of scene.assets.entries())for(const key of ['id','type','roomId','xMeters','yMeters','width','depth','height','rotation'])assert.deepEqual(styled.assets[i][key],asset[key],preset+':'+asset.id+':'+key);
 }
 assert.equal(JSON.stringify(scene),before);
});
test('Modern, minimal and luxury styles have distinct palettes and classic returns source appearance',()=>{
 const styled=['modern','minimal','luxury'].map(s=>applySceneStyle(scene,s));
 assert.equal(new Set(styled.map(s=>s.palette.floor)).size,3);assert.equal(new Set(styled.map(s=>s.palette.upholstery)).size,3);
 assert.deepEqual(applySceneStyle(scene,'classic'),scene);
});
