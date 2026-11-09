import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import parser from '@babel/parser';
import {chooseEngineeringTakeoff} from '../src/lib/sceneStyle.mjs';import {dwgReconstructionReadiness} from '../src/lib/dwgCalibration.mjs';
const source=fs.readFileSync('src/app/projects/[id]/Project3DViewer.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let fn;
function find(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name==='reconstruct3D')fn=n;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(find);else if(v&&typeof v==='object')find(v);}find(ast);
const full={aps_urn:'u',geometry:{meterFactor:.001,wallLineSegments:[{start:{x:0,y:0},end:{x:1000,y:0}}]}};
function harness(read,current={aps_urn:'u'}){
 const messages=[],builds=[],states=[],viewer={model:{}},ctx=vm.createContext({dwgRegion:null,viewerRef:{current:viewer},schematicScene:null,active3DSource:'aps',projectId:'p',urn:'u',activeViewIndex:0,sourceModelRef:{current:null},chooseEngineeringTakeoff,dwgReconstructionReadiness,readPersistedTakeoff:read,getFreshProjectTakeoff:()=>current,setReconstructing:v=>states.push(v),setMessage:v=>messages.push(v),setTakeoff(){},setReconstruction(){},setDesignResult(){},setDwgFurnitureCount(){},console:{log(){},error(){}},buildReconstructionOverlay:args=>{builds.push(args);return {wallCount:1,wallPieceCount:1,wallOpeningCutCount:0,doorCount:0,windowCount:0,slabCount:0,storeyCount:1};}});
 vm.runInContext(source.slice(fn.start,fn.end),ctx);return {ctx,messages,builds,states,viewer};
}
test('Reconstruct waits for full IndexedDB CAD, replacing a translation-only current value',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),h=harness(()=>pending);const run=h.ctx.reconstruct3D();assert.equal(h.builds.length,0);resolve(full);await run;
 assert.equal(h.builds.length,1);assert.equal(h.builds[0].takeoff,full);assert.deepEqual(h.states,[true,false]);
});
test('unmount or model switch during geometry load never draws into a stale viewer',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),h=harness(()=>pending);const run=h.ctx.reconstruct3D();h.viewer.model={};resolve(full);await run;assert.equal(h.builds.length,0);assert.equal(h.states.at(-1),false);
});
test('wrong DWG or missing scale remains an explicit failure, never a fake successful 3D',async()=>{
 for(const data of [{...full,aps_urn:'other'},{aps_urn:'u',geometry:{wallLineSegments:full.geometry.wallLineSegments}}]){
  const h=harness(async()=>data);await h.ctx.reconstruct3D();assert.equal(h.builds.length,0);assert.ok(h.messages.some(m=>/extract|scale/i.test(m)));
 }
});
test('storage failure preserves an already loaded valid CAD; missing geometry shows storage failure',async()=>{
 const read=async()=>{throw new Error('IndexedDB blocked');};const good=harness(read,full);await good.ctx.reconstruct3D();assert.equal(good.builds.length,1);
 const bad=harness(read);await bad.ctx.reconstruct3D();assert.equal(bad.builds.length,0);assert.ok(bad.messages.at(-1).includes('IndexedDB blocked'));
});
