import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createRequire} from 'node:module';
import {createSurfaceRelief,physicalSurfaceKind,surfaceHeight,previewPixelRatio} from '../src/lib/interiorRenderQuality.mjs';
import {physicalMaterialSettings} from '../src/lib/physicalPreview.mjs';
import {createDetailedSurfaces} from '../src/lib/detailedSurfaces.mjs';
const L=createRequire(import.meta.url)('three-test');
test('surface appearance distinguishes matte paint, masonry and nonmetallic polished stone',()=>{
 const settings=id=>physicalMaterialSettings({shininess:110,userData:{ventraSurfaceMaterial:id}});
 assert.ok(settings('paint-white').roughness>.8);
 assert.ok(settings('stone-ivory').roughness<settings('cement-grey').roughness);
 for(const id of ['stone-ivory','wood-oak','paint-white','brick-red'])assert.equal(settings(id).metalness,0);
 assert.equal(physicalSurfaceKind({userData:{ventraSurfaceMaterial:'personal:some-photo'}}),null);
});
test('separate height field recesses mortar and repeats without seams',()=>{
 assert.ok(surfaceHeight('brick',.12,.06)>surfaceHeight('brick',0,.06));
 for(const kind of ['brick','stone','wood','paint','cement','sand','wallpaper'])for(const t of [.03,.12,.37,.76]){
  assert.ok(Math.abs(surfaceHeight(kind,0,t)-surfaceHeight(kind,1,t))<1e-10,kind);
  assert.ok(Math.abs(surfaceHeight(kind,t,0)-surfaceHeight(kind,t,1))<1e-10,kind);
 }
});
test('relief shares resources, follows metre UV scale, and releases orphan textures',()=>{
 const source=new L.Texture({width:512,height:512});source.repeat.set(.5,.25);source.offset.set(.2,.1);
 const old={map:source,userData:{ventraSurfaceMaterial:'brick-red'}},next=new T.MeshStandardMaterial(),other=new T.MeshStandardMaterial();
 const snapshot=JSON.stringify(old.userData),manager=createSurfaceRelief(4);manager.begin();manager.apply(old,next);manager.apply(old,other);manager.end();
 assert.equal(next.bumpMap,other.bumpMap);assert.notEqual(next.bumpMap,source);assert.deepEqual(next.bumpMap.repeat.toArray(),[.5,.25]);
 assert.deepEqual(next.bumpMap.offset.toArray(),[.2,.1]);assert.equal(next.bumpMap.colorSpace,T.NoColorSpace);assert.equal(next.bumpMap.flipY,true);assert.equal(JSON.stringify(old.userData),snapshot);
 source.repeat.set(4,2);manager.begin();manager.apply(old,next);manager.end();assert.deepEqual(next.bumpMap.repeat.toArray(),[4,2]);
 let disposed=0;next.bumpMap.addEventListener('dispose',()=>disposed++);manager.begin();manager.end();assert.equal(disposed,1);manager.dispose();assert.equal(disposed,1);
 const photo=new T.MeshStandardMaterial();manager.apply({map:source,userData:{ventraSurfaceMaterial:'personal:photo'}},photo);assert.equal(photo.bumpMap,null);
});
test('large fullscreen viewports keep render resolution within a fixed pixel budget',()=>{
 for(const [w,h,mobile]of [[3840,2160,false],[1920,1080,false],[1170,2532,true],[400,800,true]]){
  const ratio=previewPixelRatio(w,h,3,mobile);assert.ok(w*h*ratio*ratio<=(mobile?1200000:2800000)+1);
 }
 assert.equal(previewPixelRatio(800,600,1,false),1);
});
test('loaded oak PBR color persists across repeated legacy bridge refreshes',async()=>{
 const resources=[],manager=createDetailedSurfaces(()=>{}, {loadAsync:async()=>{const t=new T.Texture();resources.push(t);return t;}});
 const old={userData:{ventraFloorFinish:'warm_oak'}},next=new T.MeshStandardMaterial();
 manager.apply(old,next);await manager.ready();manager.apply(old,next);const detailed=next.map;
 next.map=new T.Texture();manager.apply(old,next);assert.equal(next.map,detailed);assert.equal(next.normalMap,resources[1]);manager.dispose();
});
