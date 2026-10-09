import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOpenPlanPartitions, repairOpenPlanScene } from '../src/lib/openPlanPartitions.mjs';
const rect = (id,type,x0,y0,x1,y1) => ({ id,type,polygon:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}] });
const wall = {id:'room_edge_zone_1',type:'internal',start:{x:0,y:2},end:{x:4,y:2}};
const rooms = [rect('a','living',0,0,4,4),rect('b','kitchen_dining',0,0,4,2)];
test('overlapping zones remove synthetic interior divider independent of room order',()=> {
  for (const ordered of [rooms,[...rooms].reverse()]) assert.equal(filterOpenPlanPartitions([wall],ordered).removed,1);
});
test('observed walls, external walls and opening-bearing boundaries survive',()=> {
  for(const protectedWall of [{...wall,id:'source_partition'}, {...wall,type:'external'}, {...wall,provenance:'observed'}]) {
    assert.equal(filterOpenPlanPartitions([protectedWall],rooms).removed,0);
  }
  for(const opening of [{wallId:wall.id,type:'door'},{wallId:wall.id,type:'window'},{center:{x:2,y:2},type:'door'}]) {
    assert.equal(filterOpenPlanPartitions([wall],rooms,[],[opening]).removed,0);
  }
});
test('explicit physical relationship and intersecting enclosed room prevent removal',()=> {
  assert.equal(filterOpenPlanPartitions([wall],rooms,[{roomAId:'a',roomBId:'b',relation:'wall',confidence:1}]).removed,0);
  assert.equal(filterOpenPlanPartitions([wall],[...rooms,rect('c','bathroom',1,1,3,3)]).removed,0);
});
test('explicit open relation supports adjacent zones without semantic assumptions',()=> {
  const adjacent=[rect('a','office',0,0,4,2),rect('b','office',0,2,4,4)];
  assert.equal(filterOpenPlanPartitions([wall],adjacent).removed,0);
  assert.equal(filterOpenPlanPartitions([wall],adjacent,[{roomAId:'a',roomBId:'b',relation:'open',confidence:1}]).removed,1);
});
test('repair is immutable and idempotent and keeps exterior zone edge',()=> {
  const exterior={...wall,id:'room_edge_zone_2',start:{x:0,y:0},end:{x:4,y:0}};
  const scene={sceneType:'floorplan_interactive_preview',walls:[wall,exterior],rooms,openings:[]};
  const repaired=repairOpenPlanScene(scene);
  assert.deepEqual(repaired.walls,[exterior]);
  assert.equal(scene.walls.length,2);
  assert.equal(repairOpenPlanScene(repaired),repaired);
});
