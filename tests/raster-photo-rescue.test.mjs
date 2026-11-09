import test from 'node:test';
import assert from 'node:assert/strict';
import {photographedInkMasks} from '../src/lib/rasterPixelGraph.mjs';

const canvas=(width,height,toneValue=155)=>{
  const tone=new Uint8Array(width*height).fill(toneValue);
  const chroma=new Uint8Array(width*height);
  return{tone,chroma,width,height};
};
const paint=(c,x0,y0,x1,y1,toneValue,chromaValue=0)=>{
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const i=y*c.width+x;c.tone[i]=toneValue;c.chroma[i]=chromaValue;
  }
};
const count=array=>array.reduce((sum,value)=>sum+value,0);

test('photographed raster: uniform dark paper/shadow is not a physical wall',()=>{
  for(const shade of [55,90,130,175,230]){
    const c=canvas(96,80,shade);
    const mask=photographedInkMasks(...[c.tone,c.chroma,c.width,c.height]);
    assert.equal(count(mask.dark)+count(mask.colored),0,'a smooth constant background must not become geometry');
  }
});

test('photographed raster: narrow black and colored physical strokes survive local contrast',()=>{
  const c=canvas(120,100,180);
  paint(c,12,30,108,33,18);
  paint(c,60,45,63,92,20,85);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(mask.dark[31*c.width+55],1);
  assert.equal(mask.colored[64*c.width+61],1);
  assert.equal(mask.dark[10*c.width+55],0);
  assert.equal(mask.colored[10*c.width+61],0);
});

test('photographed raster: coordinate frame and masks remain source sized',()=>{
  const c=canvas(61,49,220);
  paint(c,10,22,51,25,10);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(mask.dark.length,c.width*c.height);
  assert.equal(mask.colored.length,c.width*c.height);
  assert.equal(mask.dark[23*c.width+30],1);
});
