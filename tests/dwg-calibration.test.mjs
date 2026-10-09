import test from 'node:test';import assert from 'node:assert/strict';
import {resolveDwgCalibration,dwgReconstructionReadiness} from '../src/lib/dwgCalibration.mjs';
const walls=[{dbId:1,start:{x:0,y:0},end:{x:1000,y:0}}];
test('translation-only record waits; missing or invalid scale never defaults to metres',()=>{
 for(const x of [undefined,null,0,-1,'garbage'])assert.equal(dwgReconstructionReadiness({aps_urn:'u',geometry:{meterFactor:x,wallLineSegments:walls}},'u').ready,false);
 assert.equal(dwgReconstructionReadiness({aps_urn:'u',extraction_status:'translation-complete'},'u').ready,false);
});
test('persisted geometry becoming calibrated starts readiness without changing units',()=>{
 const pending={aps_urn:'u',geometry:{wallLineSegments:walls}};
 assert.equal(dwgReconstructionReadiness(pending,'u').ready,false);
 const complete={...pending,geometry:{...pending.geometry,meterFactor:.001}};
 const check=dwgReconstructionReadiness(complete,'u');assert.equal(check.ready,true);assert.equal(check.meterFactor,.001);assert.equal(pending.geometry.meterFactor,undefined);
});
test('unit metadata, nested stored factor and measured ratio recover existing scale',()=>{
 assert.equal(resolveDwgCalibration({model_unit:'mm'}).meterFactor,.001);
 assert.equal(resolveDwgCalibration({advanced_takeoff:{geometry:{meterFactor:.01}}}).meterFactor,.01);
 assert.equal(resolveDwgCalibration({geometry:{totalLengthMeters:12,totalCurveLength:12000}}).meterFactor,.001);
 assert.equal(resolveDwgCalibration({model_unit:'unknown'}).meterFactor,null);
});
test('calibration alone, unrelated lines or wrong source do not reconstruct',()=>{
 assert.equal(dwgReconstructionReadiness({aps_urn:'u',geometry:{meterFactor:1}},'u').ready,false);
 assert.equal(dwgReconstructionReadiness({aps_urn:'u',geometry:{meterFactor:1,lineSegments:walls},object_details:{walls:[{dbId:9}]}},'u').ready,false);
 assert.equal(dwgReconstructionReadiness({aps_urn:'other',geometry:{meterFactor:1,wallLineSegments:walls}},'u').ready,false);
 assert.equal(dwgReconstructionReadiness({aps_urn:'u',geometry:{meterFactor:1,lineSegments:walls},object_details:{walls:[{dbId:1}]}},'u').ready,true);
});
