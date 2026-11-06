import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {readFileSync} from 'node:fs';import {createDetailedTextiles} from '../src/lib/detailedTextiles.mjs';
test('actual carpet photo loads once, refreshes, preserves edits and releases GPU texture',async()=>{
 let loads=0,refresh=0,released=0;const photo=new T.Texture();photo.addEventListener('dispose',()=>released++);
 const loader={loadAsync:async url=>{assert.equal(url,'/realistic-assets/textiles/persian-vase-carpet.jpg');loads++;return photo;}},controller=createDetailedTextiles(()=>refresh++,loader);
 const old={userData:{ventraTextile:'rug',textileVariant:'persian',textileColor:'#8d343b'}},copy=JSON.stringify(old),a=new T.MeshPhysicalMaterial(),b=new T.MeshPhysicalMaterial();
 controller.apply(old,a);controller.apply(old,b);await controller.ready();controller.apply(old,a);controller.apply(old,b);
 assert.equal(loads,1);assert.equal(refresh,1);assert.equal(a.map,photo);assert.equal(b.map,photo);assert.equal(a.roughness,.96);assert.equal(a.color.getHexString(),'ffffff');assert.equal(JSON.stringify(old),copy);
 controller.apply({...old,userData:{...old.userData,textileColor:'#445599'}},a);assert.notEqual(a.color.getHexString(),'ffffff');controller.dispose();assert.equal(released,1);
});
test('failed texture leaves woven fallback and does not retry each frame; late completion releases its image',async()=>{
 let count=0;const c=createDetailedTextiles(()=>{}, {loadAsync:async()=>{count++;throw Error('offline');}}),old={userData:{ventraTextile:'rug',textileVariant:'persian'}},mat=new T.MeshPhysicalMaterial(),fallback=new T.Texture();mat.map=fallback;
 c.apply(old,mat);await c.ready();c.apply(old,mat);assert.equal(count,1);assert.equal(mat.map,fallback);c.dispose();
 let resolve,released=0;const photo=new T.Texture();photo.addEventListener('dispose',()=>released++);const late=createDetailedTextiles(()=>{throw Error('Disposed preview must not refresh');},{loadAsync:()=>new Promise(r=>resolve=r)});late.apply(old,mat);late.dispose();resolve(photo);await late.ready();assert.equal(released,1);
});
test('local photograph has explicit public-domain provenance and is bounded for download',()=>{
 const p=new URL('../public/realistic-assets/textiles/persian-vase-carpet.jpg',import.meta.url),bytes=readFileSync(p);assert.equal(bytes[0],255);assert.equal(bytes[1],216);assert.ok(bytes.length<400000);
 const license=readFileSync(new URL('../public/realistic-assets/textiles/LICENSE.md',import.meta.url),'utf8');assert.match(license,/452187/);assert.match(license,/isPublicDomain: true/);
});
test('additional Iranian photo rugs load independently once and retain their native colors',async()=>{
 const {PERSIAN_RUG_PHOTOS}=await import('../src/lib/detailedTextiles.mjs'),loads=[],photos=[];
 const c=createDetailedTextiles(()=>{}, {loadAsync:async url=>{loads.push(url);const t=new T.Texture();photos.push(t);return t;}});
 for(const [variant,p] of Object.entries(PERSIAN_RUG_PHOTOS)){const old={userData:{ventraTextile:'rug',textileVariant:variant,textileColor:p.color}},mat=new T.MeshPhysicalMaterial();c.apply(old,mat);await c.ready();c.apply(old,mat);assert.equal(mat.color.getHexString(),'ffffff');const bytes=readFileSync(new URL('../public/realistic-assets/textiles/'+p.file,import.meta.url));assert.ok(bytes.length<400000);}
 assert.equal(new Set(loads).size,4);let disposed=0;photos.forEach(p=>p.addEventListener('dispose',()=>disposed++));c.dispose();assert.equal(disposed,4);
});
