import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {prepareRasterImageEvidence} from '../src/lib/rasterImageEvidence.mjs';
import {inspectRasterDoorSymbol,applyRasterDoorSymbols} from '../src/lib/rasterDoorSymbols.mjs';
async function symbol({hinge='start',side=1,rotation=0,arc=true,leaf=true}={}){
 const base=hinge==='start'?80:140,other=hinge==='start'?140:80,direction=hinge==='start'?1:-1,end={x:base,y:110+side*direction*60};
 const lines=`<path d="M20 110H80M140 110H200"/>${leaf?`<path d="M${base} 110L${end.x} ${end.y}"/>`:''}${arc?`<path d="M${other} 110A60 60 0 0 ${side>0?1:0} ${end.x} ${end.y}"/>`:''}`;
 const buffer=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="100%" height="100%" fill="white"/><g transform="rotate(${rotation} 110 110)" fill="none" stroke="black" stroke-width="1.5">${lines}</g></svg>`)).png().toBuffer();
 const a=rotation*Math.PI/180,point=(x,y)=>({x:110+(x-110)*Math.cos(a)-(y-110)*Math.sin(a),y:110+(x-110)*Math.sin(a)+(y-110)*Math.cos(a)});
 return{evidence:await prepareRasterImageEvidence(buffer),opening:{id:'door',type:'door',wallId:'wall',start:point(80,110),end:point(140,110)},point};
}
for(const hinge of ['start','end'])for(const side of [-1,1])for(const rotation of [0,90])test(`source arc identifies ${hinge} hinge and ${side>0?'clockwise':'counterclockwise'} at ${rotation} degrees`,async()=>{
 const f=await symbol({hinge,side,rotation}),out=inspectRasterDoorSymbol(f.opening,f.evidence);assert.equal(out.status,'observed',JSON.stringify(out));assert.equal(out.hingeSide,hinge);assert.equal(out.swingDirection,side>0?'clockwise':'counterclockwise');assert.ok(Math.abs(out.angleDegrees-90)<8);
});
test('a leaf without a readable arc is not assigned a guessed swing',async()=>{const f=await symbol({arc:false}),out=inspectRasterDoorSymbol(f.opening,f.evidence);assert.equal(out.status,'unresolved');assert.equal(out.swingDirection,'unknown');});
test('an arc without a readable leaf is left unresolved',async()=>{const f=await symbol({leaf:false}),out=inspectRasterDoorSymbol(f.opening,f.evidence);assert.equal(out.status,'unresolved');});
test('inward/outward is resolved per adjacent room and survives reversal of owning wall',async()=>{
 const f=await symbol(),p=(x,y)=>({x,y}),trace={footprint:[p(20,20),p(200,20),p(200,200),p(20,200)],walls:[{id:'wall',start:p(20,110),end:p(200,110)}],openings:[f.opening],rooms:[{id:'upper',polygon:[p(20,20),p(200,20),p(200,110),p(20,110)]},{id:'lower',polygon:[p(20,110),p(200,110),p(200,200),p(20,200)]}]};
 const out=applyRasterDoorSymbols(trace,f.evidence)[0];assert.equal(out.roomDirections.find(r=>r.roomId==='lower').direction,'inward');assert.equal(out.roomDirections.find(r=>r.roomId==='upper').direction,'outward');assert.equal(out.hingeSide,'start');
 trace.walls[0]={id:'wall',start:p(200,110),end:p(20,110)};const reversed=applyRasterDoorSymbols(trace,f.evidence)[0];assert.equal(reversed.hingeSide,'end');assert.equal(reversed.swingDirection,out.swingDirection);assert.deepEqual(reversed.roomDirections,out.roomDirections);
});
