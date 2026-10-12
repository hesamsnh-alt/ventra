import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {auditDwgOpenings} from '../src/lib/dwgOpeningAudit.mjs';
const parser=createRequire(import.meta.url)('@babel/parser'),source=readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const functions=ast.program.body.filter(n=>n.type==='FunctionDeclaration');
const context=vm.createContext({console});vm.runInContext(functions.map(n=>source.slice(n.start,n.end)).join('\n'),context);
const bind=(lines,centroid,width=.9)=>context.snapOpeningObjectToWall({object:{dbId:1,centroid,width,height:2.1},type:'door',meterFactor:1,storeyFrames:[{index:0,frame:{centerX:0,centerY:0},lines}]});
test('a nearby short wall cannot push a door onto a longer wall further away',()=>{
 const result=bind([{start:{x:-.2,y:0},end:{x:.2,y:0}},{start:{x:-2,y:.8},end:{x:2,y:.8}}],{x:0,y:.1});
 assert.equal(result.valid,false);assert.equal(result.reason,'opening_does_not_fit_nearest_wall');
});
test('opening binding rejects distant projections instead of moving an opening through a room',()=>{
 assert.equal(bind([{start:{x:-2,y:0},end:{x:2,y:0}}],{x:0,y:.8}).valid,false);
 const result=bind([{start:{x:-2,y:0},end:{x:2,y:0}}],{x:0,y:.1});
 assert.equal(result.valid,true);assert.equal(result.wallPosition.x,0);assert.equal(result.wallPosition.y,0);assert.equal(result.width,.9);
});
test('parallel CAD wall faces cannot hide physically overlapping door/window spans',()=>{
 const walls=[{id:'a',start:{x:0,y:0},end:{x:8,y:0}},{id:'b',start:{x:0,y:.15},end:{x:8,y:.15}}];
 const openings=[{id:'d',wallId:'a',type:'door',offset:.5,width:.9,height:2.1},{id:'w',wallId:'b',type:'window',offset:.5,width:1.2,height:1.2,sillHeight:.9}];
 assert.equal(auditDwgOpenings(openings,walls).openings.length,0);
 // A high transom, above the door, is a valid distinct opening.
 openings[1].sillHeight=2.3;openings[1].height=.6;
 assert.equal(auditDwgOpenings(openings,walls).openings.length,2);
});
test('opening floor assignment requires one containing drawing region, not the nearest floor centre',()=>{
 const large={index:0,frame:{minX:0,maxX:20,minY:0,maxY:20,centerX:10,centerY:10}},small={index:1,frame:{minX:21,maxX:25,minY:0,maxY:4,centerX:23,centerY:2}};
 assert.equal(context.chooseStoreyForPoint({x:19,y:2},[large,small],1).index,0);
 assert.equal(context.chooseStoreyForPoint({x:20.5,y:2},[large,small],1),null);
 assert.equal(context.chooseStoreyForPoint({x:100,y:100},[large,small],1),null);
});
