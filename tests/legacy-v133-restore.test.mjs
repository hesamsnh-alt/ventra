import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertVerifiedPreview,assertLegacyVisualPreview,LEGACY_VISUAL_PREVIEW_VERSION,VERIFIED_PREVIEW_VERSION} from '../src/lib/verifiedPreview.mjs';

const good=()=>({
 routeVersion:LEGACY_VISUAL_PREVIEW_VERSION,
 diagnostics:{build:LEGACY_VISUAL_PREVIEW_VERSION,accepted:true},
 scene:{
   width:8,depth:6,height:3.2,
   geometryValidation:{mode:'visual_interactive_preview',version:LEGACY_VISUAL_PREVIEW_VERSION},
   footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],
   rooms:[{id:'living',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],
   walls:[{start:{x:0,y:0},end:{x:8,y:0}},{start:{x:8,y:0},end:{x:8,y:6}},{start:{x:8,y:6},end:{x:0,y:6}},{start:{x:0,y:6},end:{x:0,y:0}}],
   openings:[],holes:[]
 }
});
test('old v133 visual scene is explicitly accepted without claiming pixel verification',()=>{
 const p=good();
 assert.equal(assertLegacyVisualPreview(p),p.scene);
 assert.equal(assertVerifiedPreview(p),p.scene);
 assert.equal(p.scene.geometryValidation.mode,'visual_interactive_preview');
 assert.equal(p.scene.rasterGeometryVersion,undefined);
});
for(const [name,change] of [
 ['no matching route',p=>p.routeVersion='unrecognized-preview'],
 ['wrong diagnostics version',p=>p.diagnostics.build='v134'],
 ['failed generation',p=>p.diagnostics.accepted=false],
 ['missing visual mode',p=>p.scene.geometryValidation.mode='source_verified'],
 ['missing visual version',p=>delete p.scene.geometryValidation.version],
 ['missing scene',p=>delete p.scene],
 ['bad metric size',p=>p.scene.width=-1],
 ['missing footprint',p=>delete p.scene.footprint],
 ['empty footprint',p=>p.scene.footprint=[]],
 ['missing room array',p=>delete p.scene.rooms],
 ['no rooms',p=>p.scene.rooms=[]],
 ['too few walls',p=>p.scene.walls=[]],
 ['missing openings',p=>delete p.scene.openings],
 ['missing shaft holes',p=>delete p.scene.holes],
 ['invalid polygon coordinate',p=>p.scene.footprint[0].x=NaN],
 ['invalid wall endpoint',p=>p.scene.walls[0].end.y=Infinity],
 ['zero-length wall',p=>p.scene.walls[0].end={x:0,y:0}],
]){
 test('v133 fail-closed: '+name,()=>{
   const p=good();change(p);
   assert.throws(()=>assertVerifiedPreview(p),{code:'PREVIEW_CONTRACT_MISMATCH'});
 });
}
test('a v134 result never enters the relaxed visual validator',()=>{
 const p=good();p.routeVersion=VERIFIED_PREVIEW_VERSION;
 assert.throws(()=>assertVerifiedPreview(p),{code:'PREVIEW_CONTRACT_MISMATCH'});
});
test('JPG 3D background and direct routes use v133 and matching v133 fingerprint',()=>{
 const preview=fs.readFileSync(new URL('../src/lib/serverPreviewAnalysis.js',import.meta.url),'utf8');
 const direct=fs.readFileSync(new URL('../src/app/api/ai/design-3d/route.js',import.meta.url),'utf8');
 const worker=fs.readFileSync(new URL('../netlify/worker/preview-background.mjs',import.meta.url),'utf8');
 assert.match(preview,/const task = runPreview\(body\)/);
 assert.match(preview,/return \{hash:createHash\('sha256'\).*version:VERSION\}/s);
 assert.match(preview,/export async function runLegacyInteractivePreview\(body\)\{return runPreview\(body\);\}/);
 assert.match(direct,/return runLegacyInteractivePreview\(body\);/);
 assert.match(worker,/runPreviewRequest\(request\)/);
 assert.match(preview,/if\(body\?\.mode === "repair_furniture"\) return runFurnitureRepair\(body\)/);
});
