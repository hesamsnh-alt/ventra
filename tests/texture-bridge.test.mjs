import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import*as Modern from'three';import{syncTextureSource,textureSourceStamp,markTextureResourceReady}from'../src/lib/textureBridge.mjs';
const require=createRequire(import.meta.url),Legacy=require('three-test');
test('actual r71 async canvas update reaches modern renderer once; unchanged frames do not re-upload',()=>{
 const canvas={width:256,height:256},old=new Legacy.Texture(canvas),next=new Modern.Texture(canvas);assert.equal(old.version,undefined);next.userData.ventraSourceVersion=textureSourceStamp(old);const version=next.version;
 assert.equal(syncTextureSource(next,old),false);old.repeat.set(.25,.75);canvas.width=1024;markTextureResourceReady(old);assert.equal(old.version,undefined);assert.equal(syncTextureSource(next,old),true);assert.equal(next.version,version+1);assert.equal(next.image.width,1024);assert.equal(next.repeat.y,.75);assert.equal(syncTextureSource(next,old),false);assert.equal(next.version,version+1);
});
test('modern texture versions and replacement image sources remain supported',()=>{const old=new Modern.Texture({width:8}),next=new Modern.Texture(old.image);assert.ok(syncTextureSource(next,old));old.needsUpdate=true;assert.ok(syncTextureSource(next,old));assert.equal(syncTextureSource(next,old),false);old.image={width:16};assert.ok(syncTextureSource(next,old));assert.equal(next.image.width,16);});

test('raw textile pixels remain an uploadable DataTexture in the modern renderer',async()=>{
 const {bridgeTextureSource}=await import('../src/lib/textureBridge.mjs');
 const old=new Legacy.DataTexture(new Uint8Array([128,128,128,255]),1,1,Legacy.RGBAFormat);old.flipY=false;old.generateMipmaps=true;old.minFilter=Legacy.LinearMipMapLinearFilter;
 const next=bridgeTextureSource(Modern,old);assert.equal(next.isDataTexture,true);assert.equal(next.image.data,old.image.data);assert.equal(next.flipY,false);assert.equal(next.generateMipmaps,true);
 const canvas={width:8,height:8},regular=bridgeTextureSource(Modern,new Legacy.Texture(canvas));assert.equal(regular.isDataTexture,undefined);assert.equal(regular.image,canvas);
});
