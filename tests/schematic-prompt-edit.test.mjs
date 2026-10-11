import test from 'node:test';
import assert from 'node:assert/strict';
import {editDiningPrompt} from '../src/lib/schematicPromptEdit.mjs';
const scene=()=>({width:6,depth:6,rooms:[{id:'k',polygon:[{x:0,y:0},{x:6,y:0},{x:6,y:6},{x:0,y:6}]}],walls:[],openings:[],assets:[{id:'counter',type:'kitchen_counter',roomId:'k',xMeters:3,yMeters:.5,width:2,depth:.6,rotation:180}]});
for(const prompt of ['put the dining table front of cabinet','میز ناهارخوری را جلوی کابینت بگذار','ضع طاولة الطعام أمام الخزانة'])test(prompt,()=>{
 const input=scene(),copy=structuredClone(input),next=editDiningPrompt(input,prompt);
 const table=next.assets.find(a=>a.type==='dining_table');
 assert.ok(table.yMeters>1.5);assert.equal(table.roomId,'k');assert.deepEqual(input,copy);
 assert.deepEqual(next.rooms,input.rooms);assert.deepEqual(next.walls,input.walls);assert.deepEqual(next.openings,input.openings);
 assert.equal(editDiningPrompt(next,prompt).assets.filter(a=>a.type==='dining_table').length,1);
});
test('insufficient space and ambiguous cabinets leave input unchanged',()=>{
 const input=scene();input.assets.push({...input.assets[0],id:'second'});
 assert.throws(()=>editDiningPrompt(input,'put dining table front of cabinet'),/ambiguous/);
 input.assets.pop();input.rooms[0].polygon=[{x:0,y:0},{x:6,y:0},{x:6,y:1},{x:0,y:1}];
 assert.throws(()=>editDiningPrompt(input,'put dining table front of cabinet'),/No clear space/);
 assert.equal(input.assets.length,1);
});
test('unrelated requests do not pretend to edit the scene',()=>assert.equal(editDiningPrompt(scene(),'change the roof'),null));
test('searches beside a blocked centre rather than reporting no space',()=>{
 const input=scene();input.assets.push({type:'chair',roomId:'k',xMeters:3,yMeters:2,width:.4,depth:.4});
 const table=editDiningPrompt(input,'put dining table front of cabinet').assets.find(a=>a.type==='dining_table');
 assert.ok(Math.abs(table.xMeters-3)>.1||table.yMeters>2.5);
});
test('can use an adjoining open dining zone without altering room polygons',()=>{
 const input=scene();input.rooms[0].polygon=[{x:0,y:0},{x:6,y:0},{x:6,y:1},{x:0,y:1}];
 input.rooms.push({id:'d',type:'dining',polygon:[{x:0,y:1},{x:6,y:1},{x:6,y:6},{x:0,y:6}]});
 assert.equal(editDiningPrompt(input,'put dining table front of cabinet').assets.at(-1).roomId,'d');
 input.walls.push({id:'partition',start:{x:0,y:1},end:{x:6,y:1},thickness:.12});
 assert.throws(()=>editDiningPrompt(input,'put dining table front of cabinet'),e=>e.code==='PROMPT_PLACEMENT_REJECTED');
});
