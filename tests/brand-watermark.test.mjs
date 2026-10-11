import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {drawVentraWatermark,watermarkJpegCapture} from '../src/lib/brandWatermark.mjs';
test('brand mark remains inside portrait landscape and small exports',()=>{
 for(const [w,h] of [[1600,900],[900,1600],[320,180],[64,64]]){
  const words=[];const ctx=new Proxy({fillText:t=>words.push(t)},{get:(o,k)=>o[k]??(()=>{})});
  const b=drawVentraWatermark(ctx,w,h);
  assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=w&&b.y+b.height<=h);
  assert.deepEqual(words,['VENTRA','AI ARCHITECTURE']);
 }
});
test('all 3D capture formats and concept downloads use branded exports',()=>{
 const viewer=fs.readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
 assert.match(viewer,/return watermarkJpegCapture\(await captureUnbranded3DJpeg\(\)\)/);
 const panel=fs.readFileSync(new URL('../src/app/projects/[id]/PlanRenderPanel.jsx',import.meta.url),'utf8');
 assert.match(panel,/downloadBrandedImage\(result.imageUrl/);assert.doesNotMatch(panel,/href=\{result.imageUrl\} download/);
});
test('export adds a branded footer outside the source image and encodes JPEG',async()=>{
 const oldDocument=globalThis.document,oldImage=globalThis.Image,rects=[];
 const context=new Proxy({fillRect:(...v)=>rects.push(v)},{get:(o,k)=>o[k]??(()=>{})});
 const canvas={getContext:()=>context,toBlob:(cb,type)=>cb(new Blob(['jpeg-test'],{type}))};
 globalThis.document={createElement:()=>canvas};
 globalThis.Image=class{naturalWidth=900;naturalHeight=500;set src(v){this.url=v;queueMicrotask(()=>this.onload());}};
 try{
  const result=await watermarkJpegCapture({blob:new Blob(['source'])});
  assert.equal(result.width,900);assert.equal(result.height,586);assert.equal(result.blob.type,'image/jpeg');
  assert.deepEqual(rects[0],[0,500,900,86]);
 }finally{globalThis.document=oldDocument;globalThis.Image=oldImage;}
});
test('failed image decode rejects export instead of returning an unbranded image',async()=>{
 const oldImage=globalThis.Image;
 globalThis.Image=class{set src(v){this.url=v;queueMicrotask(()=>this.onerror());}};
 try{await assert.rejects(watermarkJpegCapture({blob:new Blob(['bad'])}),/branded image/);}
 finally{globalThis.Image=oldImage;}
});
