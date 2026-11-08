import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {extractRasterPixelGraph} from '../src/lib/rasterPixelGraph.mjs';
import {prepareRasterImageEvidence} from '../src/lib/rasterImageEvidence.mjs';
import {inspectRasterDoorSymbol} from '../src/lib/rasterDoorSymbols.mjs';
const image=async(body,background='#fff')=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="100%" height="100%" fill="${background}"/>${body}</svg>`)).jpeg({quality:90}).toBuffer();
for(const [stroke,background] of [['#d2d2d2','#fff'],['#f0f0f0','#fff'],['#c8c8c8','#dedede']])test(`faint ${stroke} source walls on ${background} survive extraction and pixel validation`,async()=>{
 const b=await image(`<rect x="80" y="80" width="440" height="240" fill="none" stroke="${stroke}" stroke-width="2"/>`,background),g=await extractRasterPixelGraph(b),e=await prepareRasterImageEvidence(b);
 for(const [a,z]of [[{x:80,y:80},{x:520,y:80}],[{x:520,y:80},{x:520,y:320}],[{x:80,y:320},{x:520,y:320}],[{x:80,y:80},{x:80,y:320}]])assert.ok(g.ink.some(s=>Math.hypot(s.start.x-a.x,s.start.y-a.y)<6&&Math.hypot(s.end.x-z.x,s.end.y-z.y)<6),JSON.stringify(g.ink));
 assert.equal(e.mask[80*600+200],1);assert.equal(e.mask[200*600+300],0);
});
test('smooth shaded paper and low-amplitude scanning noise produce no wall candidates',async()=>{
 const width=600,height=400,data=Buffer.alloc(width*height*3);let seed=17;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){seed=(1664525*seed+1013904223)>>>0;const v=Math.round(225+25*x/(width-1))+(seed%5)-2;for(let c=0;c<3;c++)data[(y*width+x)*3+c]=v;}
 const b=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),g=await extractRasterPixelGraph(b);assert.equal(g.candidates.length,0);
});
test('a faint source leaf and arc retain hinge and opening direction',async()=>{
 const b=await image('<path d="M20 110H80M140 110H220M80 110V170M140 110A60 60 0 0 1 80 170" fill="none" stroke="#dedede" stroke-width="2"/>'),e=await prepareRasterImageEvidence(b),out=inspectRasterDoorSymbol({type:'door',start:{x:80,y:110},end:{x:140,y:110}},e);
 assert.equal(out.status,'observed');assert.equal(out.hingeSide,'start');assert.equal(out.swingDirection,'clockwise');
});
test('a uniform gray fill is not treated as a door leaf and arc',async()=>{
 const b=await image('<rect x="70" y="100" width="140" height="100" fill="#aaa"/>'),e=await prepareRasterImageEvidence(b),out=inspectRasterDoorSymbol({type:'door',start:{x:80,y:110},end:{x:140,y:110}},e);assert.equal(out.status,'unresolved');
});
