import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {physicalGeometry,physicalMaterialSettings,PHYSICAL_PREVIEW_LIGHTING} from '../src/lib/physicalPreview.mjs';
const old=createRequire(import.meta.url)('three-test');
test('physical bridge preserves legacy coordinates, normals, UVs and material groups',()=>{const g=new old.BoxGeometry(2,3,4);g.applyMatrix(new old.Matrix4().makeTranslation(7,8,9));const before=JSON.stringify(g.vertices);const next=physicalGeometry(g);assert.equal(next.attributes.position.count,g.faces.length*3);assert.equal(next.attributes.uv.count,g.faces.length*3);assert.equal(next.boundingBox.min.x,6);assert.equal(next.boundingBox.max.z,11);assert.equal(JSON.stringify(g.vertices),before);assert.ok(next.groups.length);next.dispose();});
test('physical materials distinguish textiles and reflective metals',()=>{assert.ok(physicalMaterialSettings({shininess:3}).roughness>physicalMaterialSettings({shininess:110}).roughness);assert.equal(physicalMaterialSettings({shininess:3}).metalness,0);assert.equal(physicalMaterialSettings({shininess:110}).metalness,.72);});

test('balanced lighting preserves highlight headroom instead of increasing white exposure',()=>{
 assert.ok(PHYSICAL_PREVIEW_LIGHTING.exposure<1);assert.ok(PHYSICAL_PREVIEW_LIGHTING.key<2);assert.ok(PHYSICAL_PREVIEW_LIGHTING.environment<.5);assert.ok(PHYSICAL_PREVIEW_LIGHTING.fill<PHYSICAL_PREVIEW_LIGHTING.key);
});
