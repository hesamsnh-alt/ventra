import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {rasterContentExtent} from '../src/lib/rasterContentExtent.mjs';
import {extractRasterPixelGraph} from '../src/lib/rasterPixelGraph.mjs';
import {discoverRasterOpenings} from '../src/lib/rasterOpeningDiscovery.mjs';
test('empty paper has no made-up content bounds',()=>assert.deepEqual(rasterContentExtent(new Uint8Array(600),30,20),{left:0,top:0,width:30,height:20,scalePixels:20,empty:true}));
test('content bounds preserve the original frame and include a faint outer edge',()=>{
 const mask=new Uint8Array(500*800);mask[50*500+20]=1;mask[200*500+420]=1;
 assert.deepEqual(rasterContentExtent(mask,500,800),{left:20,top:50,width:401,height:151,scalePixels:151,empty:false});
});
for(const padding of [0,300,1000])test(`export paper padding ${padding}px does not suppress a measured door`,async()=>{
 const b=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="100%" height="100%" fill="white"/><g stroke="black" stroke-width="1" fill="none"><path d="M50 50H550V350H50Z M50 200H260 M340 200H550 M260 200V280 M340 200A80 80 0 0 1 260 280"/></g></svg>')).extend({bottom:padding,background:'white'}).png().toBuffer();
 const g=await extractRasterPixelGraph(b),d=await discoverRasterOpenings(b,g);
 assert.equal(g.imageHeight,400+padding);assert.ok(g.contentExtent.scalePixels<=303);assert.equal(d.doors.length,1);assert.ok(Math.hypot(d.doors[0].start.x-260,d.doors[0].start.y-200)<3);
});
