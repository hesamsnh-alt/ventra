import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {createDetailedSurfaces} from '../src/lib/detailedSurfaces.mjs';
test('real wood maps replace only visual warm oak material, with correct color space and metre UVs',async()=>{
 const urls=[],source={userData:{ventraFloorFinish:'warm_oak'}},before=JSON.stringify(source),material=new T.MeshStandardMaterial();
 const s=createDetailedSurfaces(()=>{},{loadAsync:async url=>{urls.push(url);return new T.Texture();}});s.apply(source,material);await s.ready();s.apply(source,material);
 assert.equal(urls.length,3);assert.equal(material.map.colorSpace,T.SRGBColorSpace);assert.equal(material.normalMap.colorSpace,T.NoColorSpace);assert.equal(material.roughnessMap.colorSpace,T.NoColorSpace);assert.ok(Math.abs(material.map.repeat.x-1/1.7)<1e-8);assert.equal(JSON.stringify(source),before);
 const tile=new T.MeshStandardMaterial();s.apply({userData:{ventraFloorFinish:'white_ceramic'}},tile);assert.equal(tile.normalMap,null);s.dispose();
});
test('failed photographic surface download retains previous material maps',async()=>{
 const existing=new T.Texture(),m=new T.MeshStandardMaterial({map:existing});const s=createDetailedSurfaces(()=>{},{loadAsync:async()=>{throw Error('offline');}});const source={userData:{ventraFloorFinish:'warm_oak'}};s.apply(source,m);await s.ready();s.apply(source,m);assert.equal(m.map,existing);assert.equal(m.normalMap,null);s.dispose();
});
