import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from '@babel/parser';
import {buildRasterBoq} from '../src/lib/rasterBoqEvidence.mjs';
import {currentBoqWarnings} from '../src/lib/boqCurrentWarnings.mjs';
import {reconcileRasterMeasurements} from '../src/lib/rasterMeasurementAudit.mjs';
const saved=JSON.parse(readFileSync('tests/fixtures/raster-live-more-extraction.json'))[0].takeoff;
const fixture=JSON.parse(readFileSync('tests/fixtures/raster-split-openings-20261106.json'));
const center=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8');
const ast=parse(center,{sourceType:'module',plugins:['jsx']});
function find(node,p){if(!node||typeof node!=='object')return null;if(p(node))return node;for(const k of Object.keys(node)){if(['loc','start','end'].includes(k))continue;const v=node[k];for(const c of Array.isArray(v)?v:[v]){const r=find(c,p);if(r)return r;}}return null;}
const run=(t,prices=fixture.catalog)=>buildRasterBoq({takeoff:t,prices,projectId:'regression'});
test('actual saved QA04 ceiling paint now uses its existing explicit budget policy, while conflicting wall quantity stays withheld',()=>{
 const b=run(structuredClone(saved)),ceiling=b.items.find(i=>i.imageEvidence?.metricKey==='ceiling_paint_area');
 assert.equal(ceiling.quantity,36);assert.equal(ceiling.rate,21);assert.equal(ceiling.amount,756);
 assert.equal(ceiling.specificationVerification,'assumed');assert.equal(ceiling.includeInCommercialTotal,false);
 assert.equal(b.items.find(i=>i.measurementIssue?.metricKey==='paint_area').quantity,0);
 assert.ok(!b.warnings.some(w=>w.includes('quantity ceiling_paint_area retained')));
});
for(const text of ['Fire resistant ceiling paint','Acoustic ceiling paint','Epoxy ceiling paint'])test(`${text} cannot inherit ordinary emulsion`,()=>{
 const t=structuredClone(saved);t.page_evidence.quantities.find(q=>q.key==='ceiling_paint_area').evidence=text;
 assert.equal(run(t).items.find(i=>i.imageEvidence?.metricKey==='ceiling_paint_area').rate,0);
});
test('ambiguous and disabled policies never choose a cheap competing ceiling paint',()=>{
 const p=fixture.catalog.find(p=>p.item_code==='PNT-010');
 for(const prices of [[...fixture.catalog,{...p,item_code:'COMPETING'}],fixture.catalog.map(i=>i===p?{...p,is_active:false}:i)])
 assert.equal(run(structuredClone(saved),prices).items.find(i=>i.imageEvidence?.metricKey==='ceiling_paint_area').rate,0);
});
test('pending warnings follow selected or manually priced current rows and preserve measurement conflicts',()=>{
 const warnings=['46 m2 of floor finish remains unselected and is excluded from the priced budget. The displayed budget is incomplete.','Image quantity wood_floor_area retained as an unpriced row; confirm specification and rate.','Measurement conflict: preserve this.'];
 const items=[{measurementPlaceholder:{surface:'floor'},rate:77,rateMissing:false},{imageEvidence:{metricKey:'wood_floor_area'},rate:200,rateMissing:false}];
 assert.deepEqual(currentBoqWarnings(warnings,items),[warnings[2]]);
 items[0].rate=0;items[1].rateMissing=true;assert.deepEqual(currentBoqWarnings(warnings,items),warnings);
});
test('actual analysis service hydrates saved model response before saving and returning it; original claims remain available',async()=>{
 const source=readFileSync('src/services/takeoffService.js','utf8');
 const start=source.indexOf('    const takeoff = hydrateTakeoff({'),end=source.indexOf('  } catch (error)',start);
 assert.ok(start>0&&end>start);
 const t=structuredClone(fixture.takeoff),context={payload:{result:t},projectId:'p',document:{id:'png',file_name:'plan.png'},hydrateTakeoff:reconcileRasterMeasurements,saveTakeoffLocally:async(p,t)=>{context.saved=t;},onProgress(){},Date};
 const result=await vm.runInNewContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(result.takeoff.floor_area,46.5225);assert.equal(result.takeoff.wall_area,141.3);assert.equal(context.saved,result.takeoff);
 assert.equal(result.takeoff.raw_result,t);assert.notEqual(t.floor_area,46.5225);
});
test('APS-only callback branch activates the existing APS renderer and never reaches later AI calls, including remounts',async()=>{
 const branch=find(ast,n=>n.type==='IfStatement'&&center.slice(n.test.start,n.test.end).includes("aps_processing_mode==='geometry_only'"));assert.ok(branch);
 for(const persisted of [false,true])for(const ready of [false,true]){
  const calls=[],context={apsPreviewOnlyRef:{current:persisted?null:'doc'},extractionSource:{document_id:'doc',aps_processing_mode:persisted?'geometry_only':'analysis'},preview:{},previewSaved:ready,apsUrn:'urn',projectId:'p',
  dwgReconstructionReadiness:()=>({ready,reason:'No verified walls'}),saveActiveSource:async(p,s)=>calls.push(s),setMessage:()=>calls.push('message'),setErrorMessage:()=>calls.push('error'),onOpen3D:()=>calls.push('open'),forbidden:()=>{throw Error('AI boundary reached');}};
  await vm.runInNewContext('(async()=>{'+center.slice(branch.start,branch.end)+';forbidden();})()',context);
  assert.deepEqual(calls,ready?['aps','message','open']:['error']);
 }
});
test('saved image 3D opens only the selected document and performs no request or regeneration',async()=>{
 const f=find(ast,n=>n.type==='FunctionDeclaration'&&n.id?.name==='handleOpenSaved3D');assert.ok(f);
 for(const id of ['doc','other']){
  const calls=[],context={projectId:'p',selectedDocumentForPreview:{id:'doc'},clearMessages(){},loadModule:async()=>({readSchematic:async()=>({documentId:id})}),saveActiveSource:async()=>calls.push('activate'),window:{dispatchEvent:()=>calls.push('event')},CustomEvent:class{},onOpen3D:()=>calls.push('open'),setErrorMessage:()=>calls.push('error')};
  await vm.runInNewContext('('+center.slice(f.start,f.end).replaceAll('import(','loadModule(')+')()',context);
  assert.deepEqual(calls,id==='doc'?['activate','event','open']:['error']);
 }
});

test('generic wood floor uses an explicitly configured existing policy; specialized wood does not inherit it',()=>{
 const wood={item_code:'VNT-SCOPE-WOOD-FLOOR',description:'Standard engineered wood/parquet floor supplied and installed',unit:'m2',standard_rate:160,is_active:true,source_reference:JSON.stringify({kind:'pricing_default',fallback_only:true,enabled:true,metric:'wood_floor_area',specification:{floor_system:'engineered_wood'},label:'Standard engineered wood/parquet floor supplied and installed',rate_basis:'Published starting supply/install reference 160 AED/m2; treated as an indicative budget allowance',conditions:'Excludes subfloor levelling, removal, skirting, adhesives, profiles and special patterns; these require separate scope.'})};
 const b=run(structuredClone(saved),[...fixture.catalog,wood]),floor=b.items.find(i=>i.imageEvidence?.metricKey==='wood_floor_area');
 assert.equal(floor.quantity,12);assert.equal(floor.rate,160);assert.equal(floor.amount,1920);assert.equal(floor.specificationVerification,'assumed');
 const t=structuredClone(saved);t.page_evidence.quantities.find(q=>q.key==='wood_floor_area').evidence='Solid oak wood flooring';
 assert.equal(run(t,[...fixture.catalog,wood]).items.find(i=>i.imageEvidence?.metricKey==='wood_floor_area').rate,0);
});
