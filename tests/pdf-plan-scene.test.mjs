import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {PDFDocument} from 'pdf-lib';
import {buildNativePdfScene} from '../src/services/pdfPlanSceneService.mjs';
import {compileNativePdfScenes,selectPdfStorey,drawingSourceBinding} from '../src/lib/pdfPlanScene.mjs';
import {extractNativePdfText} from '../src/services/pdfNativeTextService.mjs';
import {extractNativePdfGraphics} from '../src/services/pdfNativeGraphicsService.mjs';
import {applyDesignDefaults} from '../src/lib/designDefaults.mjs';
import {createWalkWorld,walkPositionAllowed,walkSpawn} from '../src/lib/walkthrough.mjs';
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState} from '../src/lib/drawingWorkflowGate.mjs';
const bytes=new Uint8Array(readFileSync(new URL('./fixtures/pdf-complex-dimensioned-input.pdf',import.meta.url)));
const identity={projectId:'native-preview-project',documentId:'current-pdf',documentName:'source.pdf'};
const scene=await buildNativePdfScene({bytes,...identity});
const area=poly=>Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p.x*q.y-q.x*p.y;},0))/2;
const near=(a,b)=>assert.ok(Math.abs(a-b)<.0001,`${a} != ${b}`);
test('original 13-page PDF builds both source storeys without a saved AI report',()=>{
 assert.equal(scene.pdfStoreys.length,2);assert.equal(scene.documentId,identity.documentId);
 assert.deepEqual(scene.pdfStoreys.map(f=>[f.sourcePage,f.height,f.rooms.length,f.walls.length,f.openings.length]),[[2,4,12,25,30],[3,3.6,11,25,26]]);
 assert.equal(scene.pdfStoreys.flatMap(f=>f.openings).filter(o=>o.type==='window').length,28);
 near(scene.pdfStoreys.flatMap(f=>f.rooms).reduce((n,r)=>n+r.sourceArea,0),1214.835625);
 for(const f of scene.pdfStoreys){assert.equal(f.pdfPreview.modelCalls,0);assert.equal(f.assets.length,0);assert.deepEqual(applyDesignDefaults(f).walls,f.walls);assert.equal(f.width,32);assert.equal(f.depth,23);for(const o of f.openings)assert.ok(f.walls.some(w=>w.id===o.wallId));}
});
test('switching floor preserves that floor edits, identity and independent baseline geometry',()=>{
 const edited=structuredClone(scene);edited.surfaceMaterials={'wall:test':{materialId:'paint'}};edited.assets=[{id:'user-chair'}];
 const upper=selectPdfStorey(edited,3);assert.equal(upper.floorName,'FIRST');assert.equal(upper.surfaceMaterials,undefined);assert.equal(upper.assets.length,0);
 upper.surfaceMaterials={'floor:F02':{materialId:'wood'}};
 const lower=selectPdfStorey(upper,2);assert.deepEqual(lower.surfaceMaterials,edited.surfaceMaterials);assert.equal(lower.assets[0].id,'user-chair');
 assert.deepEqual(selectPdfStorey(lower,3).surfaceMaterials,upper.surfaceMaterials);
 assert.ok(lower.pdfStoreys.every(s=>!s.pdfStoreys));assert.equal(scene.assets.length,0);assert.throws(()=>selectPdfStorey(scene,99));
});
test('old CAD and old schematic cannot be shown for a different selected PDF',()=>{
 const old={document_id:'old-cad',aps_urn:'old-urn'};
 const result=drawingSourceBinding({selectedDocumentId:'current-pdf',engineering:old,source:'aps',scene:{documentId:'old-image'}});
 assert.equal(result.source,'schematic');assert.equal(result.engineeringAllowed,false);assert.equal(result.scene,null);
 assert.equal(drawingSourceBinding({selectedDocumentId:'current-pdf',engineering:old,source:'aps',scene}).scene,scene);
 assert.equal(drawingSourceBinding({selectedDocumentId:'old-cad',engineering:old}).engineeringAllowed,true);
 assert.equal(drawingSourceBinding({engineering:old}).engineeringAllowed,true);
});
test('walking cannot cross the first-floor void or either floor stair opening',()=>{
 for(const s of scene.pdfStoreys){const world=createWalkWorld(s);assert.equal(walkPositionAllowed(world,{x:26,y:3}),false);assert.equal(walkPositionAllowed(world,walkSpawn(world)),true);if(s.floorName==='FIRST')assert.equal(walkPositionAllowed(world,{x:4,y:4}),false);}
});
test('actual legacy renderer floor triangulation cuts stair holes and leaves the upper void empty',()=>{
 const viewer=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
 const start=viewer.indexOf('function ventraBuildTracedRasterFloor('),end=viewer.indexOf('\nfunction renderStructuredSchematicScene',start);
 const build=vm.runInNewContext(viewer.slice(start,end)+';ventraBuildTracedRasterFloor');
 const THREE=createRequire(import.meta.url)('three-test');
 for(const s of scene.pdfStoreys){let total=0;for(const plate of s.floorPlates){const {mesh}=build({THREE,polygon:plate.polygon,holes:plate.holes,material:new THREE.MeshBasicMaterial()});let measured=0;for(const face of mesh.geometry.faces){const p=mesh.geometry.vertices[face.a],q=mesh.geometry.vertices[face.b],r=mesh.geometry.vertices[face.c];measured+=area([p,q,r]);}near(measured,area(plate.polygon)-plate.holes.reduce((n,h)=>n+area(h),0));total+=measured;mesh.geometry.dispose();}near(total,s.floorName==='GROUND'?670:606);}
});
const pdf=await PDFDocument.load(bytes);
const pages=pdf.getPages().map((_,i)=>({pageNumber:i+1,native_text_evidence:extractNativePdfText(pdf,i,{allowRotated:true}),native_graphics:extractNativePdfGraphics(pdf,i)}));
test('changed printed scale cannot silently create a wrong-size model',()=>{
 const altered=structuredClone(pages);const span=altered[1].native_text_evidence.spans.find(s=>/Scale 1:100/.test(s.text));assert.ok(span);span.text=span.text.replace('1:100','1:200');
 assert.throws(()=>compileNativePdfScenes(altered,identity),/scale|weight/i);
});
test('missing schedule or unhosted opening stops the whole scene before publication',()=>{
 assert.throws(()=>compileNativePdfScenes(pages.filter(p=>p.pageNumber!==8),identity),/schedule/i);
 const altered=structuredClone(pages);const span=altered[6].native_text_evidence.spans.find(s=>/^\([\d., -]+\) to \([\d., -]+\)$/.test(s.text));assert.ok(span);span.text='(90,90) to (91.8,90)';
 assert.throws(()=>compileNativePdfScenes(altered,identity),/opening|host/i);
});
test('unsupported PDF does not fall back to invented geometry',async()=>{
 const blank=await PDFDocument.create();blank.addPage();await assert.rejects(buildNativePdfScene({bytes:await blank.save(),...identity}),/No supported/);
});
test('preview locks concurrent analysis but does not turn a preview failure into a BOQ failure',()=>{
 const id='preview-lock-test',a=beginDrawingWorkflow(id,'analysis');finishDrawingWorkflow(id,a,false);
 const p=beginDrawingWorkflow(id,'preview');assert.ok(p);assert.equal(beginDrawingWorkflow(id,'analysis'),null);finishDrawingWorkflow(id,p,false);assert.equal(drawingWorkflowState(id).analysisFailed,true);
});
test('full structured Three renderer uses native heights, glass walls and exact opening counts',async()=>{
 const parser=createRequire(import.meta.url)('@babel/parser'),THREE=createRequire(import.meta.url)('three-test');
 const source=readFileSync(new URL('../src/app/projects/[id]/Project3DViewer.jsx',import.meta.url),'utf8');
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 const declarations=ast.program.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name?.startsWith('VENTRA_')));
 const {decorateSurfaceMesh,surfaceMaterialList}=await import('../src/lib/surfaceMaterials.mjs');
 const {configureFloorDepth}=await import('../src/lib/floorDepthLayers.mjs');
 const {sourcePresentationAssets}=await import('../src/lib/sourceFurniture.mjs');
 const context=vm.createContext({THREE,console:{log(){},warn(){},error(){}},structuredClone,decorateSurfaceMesh,surfaceMaterialList,configureFloorDepth,sourcePresentationAssets});
 vm.runInContext(declarations.map(n=>source.slice(n.start,n.end)).join('\n'),context);context.getThree=()=>THREE;
 for(const data of scene.pdfStoreys){const target=new THREE.Scene(),viewer={impl:{scene:target,removeOverlayScene(){},invalidate(){}},navigation:{}};
  const result=context.renderStructuredSchematicScene(viewer,data);assert.equal(result.structured,true);assert.equal(result.openingCount,data.openings.length);assert.equal(result.height,data.height);assert.equal(result.assetMeshCount,0);
  const glass=[];target.traverse(m=>{if(m.userData?.wallKind==='glass')glass.push(m);});assert.ok(glass.length);assert.ok(glass.every(m=>m.material.transparent));
 }
});
