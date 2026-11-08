import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';import fs from'node:fs';import vm from'node:vm';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {loadComponent}=await import('./render-runtime.mjs');
const component=await loadComponent('src/app/projects/[id]/RasterTraceReview.jsx');
test('rejected semantic result still shows the locally extracted source lines',()=>{
 const html=renderToStaticMarkup(React.createElement(component.default,{imageUrl:'source.jpg',fileName:'plan.jpg',report:{accepted:false,imageWidth:600,imageHeight:500,pixelGraph:{ink:[{id:'ink1',start:{x:50,y:50},end:{x:550,y:50}}]},failure:{code:'INCOMPLETE_PIXEL_CLASSIFICATION',message:'Unclear source use'}}}));
 assert.ok(html.includes('Source pixel segments before semantic classification'));assert.ok(html.includes('source.jpg'));assert.ok(html.includes('ink1'));assert.ok(html.includes('Unclear source use'));
});
test('review distinguishes white floor holes, retained wardrobe floors and measured door swing',()=>{
 const p=(x,y)=>({x,y}),square=[p(0,0),p(1000,0),p(1000,1000),p(0,1000)],report={accepted:true,imageWidth:600,imageHeight:500,trace:{footprint:square,rooms:[{id:'bedroom',name:'Bedroom',polygon:square}],holes:[{id:'shaft',polygon:[p(500,500),p(600,500),p(600,600),p(500,600)]}],openings:[{id:'door',type:'door',wallId:'w',start:p(100,500),end:p(200,500),hingeSide:'start',swingDirection:'clockwise',swingEvidence:{status:'observed',angleDegrees:90},roomDirections:[{roomId:'bedroom',direction:'inward'}]}]},storage:[{regionId:'closet',polygon:[p(60,60),p(100,60),p(100,100),p(60,100)]}],spaceInterpretations:[{regionId:'shaft',name:'Core',interpretation:{role:'void'}},{regionId:'closet',name:'Wardrobe',interpretation:{role:'wardrobe'}}]};
 const html=renderToStaticMarkup(React.createElement(component.default,{report,imageUrl:'source.jpg',fileName:'plan.jpg'}));
 assert.ok(html.includes('Excluded void; no floor'));assert.ok(html.includes('Wardrobe; bedroom floor retained'));assert.ok(html.includes('Clockwise'));assert.ok(html.includes('Inward to'));assert.ok(html.includes('fill="#fff"'));assert.ok(html.includes('<path d="M'));
});
test('production image handler chooses measured pixel graph unless legacy mode is explicitly selected',async()=>{
 const source=fs.readFileSync('src/lib/serverRasterPreview.js','utf8'),start=source.indexOf('export async function runRasterPreview('),end=source.indexOf('\nexport async function rasterPreviewFingerprint(');let called=0;
 const context=vm.createContext({process:{env:{}},runPixelGraphPreview:async body=>{called++;return{graph:true,body}}});vm.runInContext(source.slice(start,end).replace('export async function','async function'),context);
 const result=await context.runRasterPreview({imageUrl:'test-only'});assert.equal(result.graph,true);assert.equal(called,1);
});
