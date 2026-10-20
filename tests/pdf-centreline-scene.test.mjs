import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {PDFDocument,PDFName} from 'pdf-lib';
import {buildNativePdfScene} from '../src/services/pdfPlanSceneService.mjs';
import {compileNativePdfScenes,selectPdfStorey} from '../src/lib/pdfPlanScene.mjs';
import {extractNativePdfText,readNativePdfContent} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {createWalkWorld,walkPositionAllowed} from '../src/lib/walkthrough.mjs';
import {applyDesignDefaults} from '../src/lib/designDefaults.mjs';
const bytes=new Uint8Array(readFileSync(new URL('./fixtures/pdf-native-opening-input.pdf',import.meta.url)));
const identity={projectId:'centreline-project',documentId:'villa-original',documentName:'any-name.pdf'};
const scene=await buildNativePdfScene({bytes,...identity});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0))/2;
const pdf=await PDFDocument.load(bytes);
const pages=()=>pdf.getPages().map((_,i)=>({pageNumber:i+1,native_text_evidence:extractNativePdfText(pdf,i,{allowRotated:true}),native_graphics:extractNativePdfGraphics(pdf,i)}));
test('actual eight-page PDF builds two distinct measured floors, all physical walls and all 34 source openings',()=>{
 assert.deepEqual(scene.pdfStoreys.map(f=>[f.sourcePage,f.floorName,f.width,f.depth,f.height,f.walls.length,f.openings.length]),[[1,'GROUND',16,12,3.2,12,17],[2,'FIRST',16,12,3.2,15,17]]);
 assert.equal(scene.pdfStoreys.flatMap(f=>f.openings).filter(o=>o.type==='window').length,15);
 assert.equal(scene.pdfStoreys.flatMap(f=>f.openings).filter(o=>o.type==='door').length,19);
 for(const floor of scene.pdfStoreys){assert.equal(floor.pdfPreview.modelCalls,0);assert.equal(floor.assets.length,0);assert.deepEqual(applyDesignDefaults(floor).walls,floor.walls);near(floor.externalWallThickness,.2);near(floor.wallThickness,.12);
  for(const o of floor.openings){const w=floor.walls.find(w=>w.id===o.wallId);assert.ok(w);assert.ok(o.offset>0&&o.offset<1);near(o.width,floor.pdfPreview.sourceAudit.opening_bindings.find(b=>b.id===o.id).gap_width_m);}
 }
});
test('upper void is a real floor omission, terrace is retained and open hall/landing never acquires an invented wall',()=>{
 const [gf,ff]=scene.pdfStoreys;near(gf.floorPlates.reduce((s,p)=>s+area(p.polygon),0),192);near(ff.floorPlates.reduce((s,p)=>s+area(p.polygon),0),180);
 assert.equal(gf.holes.length,0);assert.equal(ff.holes.length,1);near(area(ff.holes[0].polygon),12);
 near(ff.rooms.find(r=>r.id==='F07').sourceArea,12);near(ff.rooms.find(r=>r.id==='F04+F05').sourceArea,28);
 assert.ok(!ff.walls.some(w=>nearBool(w.start.x,9)&&nearBool(w.end.x,9)&&Math.min(w.start.y,w.end.y)<4));
 assert.equal(walkPositionAllowed(createWalkWorld(ff),{x:11.5,y:2}),false);
 assert.equal(walkPositionAllowed(createWalkWorld(ff),{x:14.5,y:2}),true);
 const up=selectPdfStorey(scene,2);assert.equal(up.floorName,'FIRST');assert.equal(up.documentId,identity.documentId);
});
function nearBool(a,b){return Math.abs(a-b)<1e-5;}
test('source tag, host dimensions and floor scope changes are rejected without any fallback model',()=>{
 const changes=[p=>p[0].native_text_evidence.spans.find(s=>s.text==='GD01').text='UNKNOWN',
  p=>p[3].native_text_evidence.spans.find(s=>s.text==='Ground floor').text='Roof',
  p=>p[0].native_text_evidence.spans.find(s=>s.text.includes('16.00 x 12.00 envelope')).text='Other envelope',
  p=>p[1].native_graphics.strokes=p[1].native_graphics.strokes.filter(s=>!s.segments.some(l=>nearBool(l.a.x,568)&&nearBool(l.b.x,568))),
  p=>p[0].native_text_evidence.spans.find(s=>s.text==='Clear height: 3.20 m').text='Clear height: unknown'];
 for(const change of changes){const p=pages();change(p);assert.throws(()=>compileNativePdfScenes(p,identity));}
});
test('renaming and uniform PDF scaling/translation preserve metric geometry',async()=>{
 const transformed=await PDFDocument.load(bytes);
 for(const i of [0,1]){const stream=transformed.context.flateStream('q 1.3 0 0 1.3 37 51 cm\n'+readNativePdfContent(transformed,i)+'\nQ');transformed.getPage(i).node.set(PDFName.of('Contents'),transformed.context.register(stream));}
 const changed=await buildNativePdfScene({bytes:await transformed.save(),...identity,documentName:'new-filename.pdf'});
 for(let i=0;i<2;i++){assert.deepEqual(changed.pdfStoreys[i].walls,scene.pdfStoreys[i].walls);near(changed.pdfStoreys[i].rooms.reduce((s,r)=>s+r.sourceArea,0),scene.pdfStoreys[i].rooms.reduce((s,r)=>s+r.sourceArea,0));}
});
test('actual legacy Three renderer constructs every source opening and triangulates the real floor area',async()=>{
 const require=createRequire(import.meta.url),THREE=require('three-test'),parser=require('@babel/parser');
 const source=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
 const declarations=parser.parse(source,{sourceType:'module',plugins:['jsx']}).program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_')));
 const {decorateSurfaceMesh,surfaceMaterialList}=await import('../src/lib/surfaceMaterials.mjs');
 const {configureFloorDepth}=await import('../src/lib/floorDepthLayers.mjs');const {sourcePresentationAssets}=await import('../src/lib/sourceFurniture.mjs');
 const ctx=vm.createContext({THREE,console:{log(){},warn(){},error(){}},structuredClone,decorateSurfaceMesh,surfaceMaterialList,configureFloorDepth,sourcePresentationAssets});
 vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),ctx);ctx.getThree=()=>THREE;
 for(const floor of scene.pdfStoreys){const target=new THREE.Scene(),viewer={impl:{scene:target,removeOverlayScene(){},invalidate(){}},navigation:{}};
  const result=ctx.renderStructuredSchematicScene(viewer,floor);assert.equal(result.structured,true);assert.equal(result.openingCount,17);near(result.height,3.2);assert.equal(result.assetMeshCount,0);
  let total=0;for(const plate of floor.floorPlates){const {mesh}=ctx.ventraBuildTracedRasterFloor({THREE,polygon:plate.polygon,holes:[],material:new THREE.MeshBasicMaterial()});let sum=0;for(const f of mesh.geometry.faces){const v=mesh.geometry.vertices;sum+=area([v[f.a],v[f.b],v[f.c]]);}near(sum,area(plate.polygon));total+=sum;mesh.geometry.dispose();}near(total,floor.sourcePage===1?192:180);
 }
});
test('an independently drawn plan with different geometry and tags is converted from its PDF data',async()=>{
 const {degrees}=await import('pdf-lib');const doc=await PDFDocument.create(),p=doc.addPage([700,700]);
 const x=100,y=100,k=30;
 const text=(value,px,py,size=10,rotate=0)=>p.drawText(value,{x:px,y:py,size,rotate:degrees(rotate)});
 text('AX9 / GROUND FLOOR',40,650);text('10 x 8 envelope',40,630);text('All dimensions in metres | Drawing datum: wall centrelines',40,610);
 text('External: 200 mm',450,550);text('Internal: 100 mm',450,530);text('Clear height: 2.90 m',450,510);
 const wall=(a,b,c,d,t)=>p.drawLine({start:{x:x+a*k,y:y+b*k},end:{x:x+c*k,y:y+d*k},thickness:t});
 wall(0,0,1,0,4);wall(3,0,10,0,4);wall(10,0,10,8,4);wall(10,8,0,8,4);wall(0,8,0,0,4);wall(5,0,5,8,2);
 text('10',x+5*k,y-20);text('8',x-20,y+4*k,10,90);
 text('AD01',x+1.6*k,y+.2*k);text('R1 Office',x+2*k,y+4*k);text('R2 Store',x+7*k,y+4*k);
 const table=doc.addPage([700,700]);table.drawText('Ground floor',{x:40,y:650,size:10});table.drawText('All dimensions in metres',{x:40,y:630,size:10});
 const cols=[['ID',40],['Type',120],['Width',240],['Height',320],['Sill',400],['Host wall',480]];
 for(const [v,px] of cols)table.drawText(v,{x:px,y:590,size:10});
 for(const [i,v] of ['AD01','door','2.00','2.10','0','EXT-A'].entries())table.drawText(v,{x:cols[i][1],y:570,size:10});
 const result=await buildNativePdfScene({bytes:await doc.save(),...identity,documentName:'independent-project.pdf'});
 assert.equal(result.pdfStoreys.length,1);near(result.width,10);near(result.depth,8);near(result.height,2.9);assert.equal(result.walls.length,5);assert.equal(result.rooms.length,2);assert.equal(result.openings[0].id,'AD01');near(result.openings[0].offset,.2);near(result.rooms.reduce((n,r)=>n+r.sourceArea,0),80);
});
