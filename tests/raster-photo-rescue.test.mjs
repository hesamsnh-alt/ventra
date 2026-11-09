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

for(const shade of [55,90,130,175,230]){
  test(`photographed raster: uniform paper shade ${shade} is not a wall`,()=>{
    const c=canvas(96,80,shade);
    const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
    assert.equal(count(mask.dark)+count(mask.colored),0,'a smooth constant background must not become geometry');
  });
}

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

test('photographed raster: clean white paper has no candidates',()=>{
  const c=canvas(80,80,255);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(count(mask.dark)+count(mask.colored),0);
});

test('photographed raster: gradual illumination does not become a wall',()=>{
  const c=canvas(120,100,170);
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)c.tone[y*c.width+x]=115+Math.round(40*x/(c.width-1));
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(count(mask.dark)+count(mask.colored),0);
});

test('photographed raster: a faint but local straight wall survives a gray page',()=>{
  const c=canvas(120,100,225);
  paint(c,12,48,108,51,173);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(mask.dark[49*c.width+65],1);
});

test('photographed raster: a thin rectangle keeps all four sides',()=>{
  const c=canvas(120,100,240);
  paint(c,20,20,100,23,15);
  paint(c,20,77,100,80,15);
  paint(c,20,20,23,80,15);
  paint(c,97,20,100,80,15);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  for(const [x,y] of [[40,21],[40,78],[21,50],[98,50]])assert.equal(mask.dark[y*c.width+x],1);
  assert.equal(mask.dark[50*c.width+50],0);
});

test('photographed raster: colored source lines do not silently become black lines',()=>{
  const c=canvas(120,100,230);
  paint(c,10,40,110,44,35,80);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(mask.colored[41*c.width+55],1);
  assert.equal(mask.dark[41*c.width+55],0);
});

test('photographed raster: isolated bright background remains empty near dark ink',()=>{
  const c=canvas(120,100,245);
  paint(c,20,47,100,50,15);
  const mask=photographedInkMasks(c.tone,c.chroma,c.width,c.height);
  assert.equal(mask.dark[10*c.width+10],0);
  assert.equal(mask.dark[90*c.width+110],0);
});
