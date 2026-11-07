import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {prepareRasterVisionBuffer,traceInOriginalImage}from '../src/lib/rasterImagePreparation.mjs';
const png=svg=>sharp(Buffer.from(svg)).png().toBuffer();
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('white canvas is cropped around all ink including pale dimensions outside the building',async()=>{
 const input=await png('<svg width="1800" height="1400"><rect width="100%" height="100%" fill="white"/><rect x="300" y="100" width="1000" height="300" stroke="black" stroke-width="5" fill="none"/><path d="M100 600H1600" stroke="#eeeeee"/></svg>'),before=Buffer.from(input),r=await prepareRasterVisionBuffer(input),c=r.sourceFrame.crop;
 assert.deepEqual(input,before);assert.ok(r.height<650);assert.ok(c.left<100&&c.left+c.width>1600&&c.top+c.height>600);assert.ok(c.width>1400);assert.equal(r.sourceFrame.width,1800);assert.equal(r.sourceFrame.height,1400);assert.equal((await sharp(r.buffer).metadata()).width,r.width);
});
test('blank images and drawings reaching the image edges are never cropped',async()=>{for(const content of ['', '<rect x="0" y="0" width="799" height="599" fill="none" stroke="black"/>']){const r=await prepareRasterVisionBuffer(await png(`<svg width="800" height="600"><rect width="100%" height="100%" fill="white"/>${content}</svg>`));assert.deepEqual(r.sourceFrame.crop,{left:0,top:0,width:800,height:600});}});
test('crop and resize preserve original overlay locations for every geometry collection without changing metres',()=>{
 const p={x:250,y:750},span={start:p,end:{x:1000,y:0},meters:12},t={footprint:[p],holes:[{polygon:[p]}],rooms:[{polygon:[p]}],walls:[span],openings:[span],measurements:[span]},before=JSON.stringify(t),frame={width:2000,height:1000,crop:{left:200,top:100,width:1600,height:600},preparedWidth:1100,preparedHeight:413},r=traceInOriginalImage(t,frame);
 for(const v of [r.footprint[0],r.rooms[0].polygon[0],r.holes[0].polygon[0],r.walls[0].start,r.openings[0].start,r.measurements[0].start]){close(v.x,300);close(v.y,550);}assert.equal(r.measurements[0].meters,12);assert.equal(JSON.stringify(t),before);assert.equal(traceInOriginalImage(t,null),t);
});
test('rotated images use the oriented source frame and an explicit bounded output size',async()=>{const source=await sharp(await png('<svg width="300" height="600"><rect width="100%" height="100%" fill="black"/></svg>')).jpeg().withMetadata({orientation:6}).toBuffer(),r=await prepareRasterVisionBuffer(source,{maxDimension:200});assert.equal(r.sourceFrame.width,600);assert.equal(r.sourceFrame.height,300);assert.equal(r.width,200);assert.equal(r.height,100);});
