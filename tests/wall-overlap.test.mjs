import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {repairOverlappingWalls} from '../src/lib/wallOverlapRepair.mjs';
const wall=(id,a,b,y=0)=>({id,start:{x:a,y},end:{x:b,y},type:'internal'});
const opening=(wallId,offset=.5)=>({id:wallId+'-door',wallId,offset,width:.8,type:'door',hinge:'start',swing:'clockwise'});
test('duplicate solid wall cannot seal an existing doorway; input immutable and repeat stable',()=>{
 const a=wall('a',0,4),b=wall('b',4,0);const doors=[opening('a')];
 const r=repairOverlappingWalls([a,b],doors);
 assert.deepEqual(r.walls,[a]);assert.deepEqual(r.openings,doors);
 assert.equal(b.start.x,4);assert.equal(repairOverlappingWalls(r.walls,r.openings).changed,false);
});
test('partial duplicate retains uncovered length and remaps reversed opening',()=>{
 const a=wall('a',0,4),b=wall('b',6,0);
 const r=repairOverlappingWalls([a,b],[opening('a',.25),opening('b',.5)]);
 assert.equal(r.walls.length,2);assert.equal(r.walls[1].end.x,4);
 assert.equal(r.openings[1].wallId,'a');assert.equal(r.openings[1].offset,.75);
 assert.equal(r.openings[1].hinge,'end');assert.equal(r.openings[1].swing,'counterclockwise');
});
test('separate parallel and perpendicular walls remain untouched',()=>{
 const a=wall('a',0,4),b=wall('b',0,4,.12),c={id:'c',start:{x:2,y:-2},end:{x:2,y:2}};
 assert.equal(repairOverlappingWalls([a,b,c],[opening('a')]).changed,false);
});
test('opening across residual boundary prevents unsafe normalization',()=>{
 const a=wall('a',0,3),b=wall('b',0,6);
 assert.equal(repairOverlappingWalls([a,b],[opening('a',.4),opening('b',.5)]).changed,false);
});
test('uploaded scene keeps all openings attached and removes duplicate entrance coverage',()=>{
 const s=JSON.parse(readFileSync(new URL('fixtures/source-20260926-122354.json',import.meta.url)));
 const r=repairOverlappingWalls(s.walls,s.openings);
 assert.ok(r.changed);assert.equal(r.openings.length,s.openings.length);
 for(let i=0;i<s.openings.length;i++){
  const old=s.openings[i],next=r.openings[i];
  const a=s.walls.find(w=>w.id===old.wallId),b=r.walls.find(w=>w.id===next.wallId);
  assert.ok(b,old.id);assert.equal(next.width,old.width);
  const center=(w,o)=>({x:w.start.x+(w.end.x-w.start.x)*o.offset,y:w.start.y+(w.end.y-w.start.y)*o.offset});
  const p=center(a,old),q=center(b,next);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<=.040001);
 }
 assert.ok(!r.walls.some(w=>w.id==='p-entrance-left'));
 assert.equal(repairOverlappingWalls(r.walls,r.openings).changed,false);
});
