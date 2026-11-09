import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState} from '../src/lib/drawingWorkflowGate.mjs';
import {PDF_SCENE_VERSION} from '../src/lib/pdfPlanScene.mjs';
const center=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8');
const handler=center.slice(center.indexOf('  async function handleBuildPdf3D()'),center.indexOf('  async function handleAnalyzeDrawing('));
let seq=0;
function setup(overrides={}){
 const scene={documentId:'pdf',nativePdfGeometryVersion:PDF_SCENE_VERSION,pdfStoreys:[{sourcePage:2}]};
 const s={projectId:'preview-test-'+ ++seq,selectedDocumentForPreview:{id:'pdf',file_name:'input.pdf'},language:'en',
  getFileExtension:n=>n.split('.').pop(),pdfPreviewInFlightRef:{current:false},analysisInFlightRef:{current:false},analyzing:false,generatingBoq:false,
  analysisSelectionRef:{current:null},beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,PDF_SCENE_VERSION,scene,statuses:[],calls:[],
  setPdfPreviewStatus:v=>s.statuses.push(v),setAnalyzing:v=>s.analyzing=v,clearMessages(){},setMessage(){},setErrorMessage:v=>s.error=v,
  loadModule:async name=>{
   if(name.includes('pdfPlanSceneService'))return {buildNativePdfScene:async()=>{s.calls.push('compile');return scene;}};
   if(name.includes('cloud3DState'))return {restoreCloud3DState:async(id,kind,documentId)=>{
    assert.deepEqual([id,kind,documentId],[s.projectId,'schematic','pdf']);s.calls.push('restore');
    if(s.cloudError)throw s.cloudError;
    return {schematic:s.cloud};
   }};
   return {readSchematic:()=>s.existing||null};
  },
  downloadProjectDocument:async()=>{s.calls.push('download');return {url:'signed-original'};},commercialFetch:async()=>({ok:true,headers:{get:()=>null},arrayBuffer:async()=>new ArrayBuffer(5)}),
  selectDrawingDocument:()=>s.calls.push('select'),saveSchematic:async(_id,record,options)=>{s.calls.push('save');s.saveOptions=options;return record;},saveActiveSource:async()=>s.calls.push('activate'),
  window:{dispatchEvent:()=>s.calls.push('event')},CustomEvent:class{},onOpen3D:()=>s.calls.push('open'),...overrides};
 s.analysisSelectionRef.current={projectId:s.projectId,documentId:'pdf'};
 vm.createContext(s);
 // Dynamic modules are injected at the browser boundary; execute the production handler unchanged otherwise.
 vm.runInContext(handler.replaceAll('import(','loadModule(')+'\nthis.click=handleBuildPdf3D;',s);
 return s;
}
test('every missing-source and busy guard reports inline feedback, without downloading',async()=>{
 for(const override of [{selectedDocumentForPreview:null},{analyzing:true},{generatingBoq:true},{analysisInFlightRef:{current:true}},{pdfPreviewInFlightRef:{current:true}}]){
  const s=setup(override);await s.click();assert.equal(s.statuses.length,1);assert.notEqual(s.statuses[0].kind,'success');assert.deepEqual(s.calls,[]);
 }
});
test('a real active analysis is explained and never unlocked by the PDF button',async()=>{
 const s=setup(),token=beginDrawingWorkflow(s.projectId,'analysis');await s.click();
 assert.match(s.statuses.at(-1).text,/analysis/);assert.equal(drawingWorkflowState(s.projectId).active,'analysis');assert.deepEqual(s.calls,[]);
 finishDrawingWorkflow(s.projectId,token,true);
});
test('workflow rejection gives feedback instead of silently returning',async()=>{
 const s=setup({beginDrawingWorkflow:()=>null});await s.click();assert.match(s.statuses.at(-1).text,/workflow/);assert.deepEqual(s.calls,[]);
});
test('successful native build saves and activates the PDF before offering Open 3D',async()=>{
 const s=setup();await s.click();assert.deepEqual(s.calls,['restore','download','compile','select','save','activate','event','open']);
 assert.equal(s.statuses[0].kind,'working');assert.equal(s.statuses.at(-1).kind,'success');assert.equal(s.statuses.at(-1).documentId,'pdf');
 assert.equal(s.analyzing,false);assert.equal(s.pdfPreviewInFlightRef.current,false);assert.equal(drawingWorkflowState(s.projectId).active,null);
});
test('a saved model for the selected PDF opens without rebuilding or replacing cloud edits',async()=>{
 const local=setup();local.existing=local.scene;await local.click();
 assert.deepEqual(local.calls,['select','activate','event','open']);
 const cloud=setup();cloud.cloud={...cloud.scene,assets:[{id:'retained-edit'}]};await cloud.click();
 assert.deepEqual(cloud.calls,['restore','select','save','activate','event','open']);assert.equal(cloud.saveOptions.syncCloud,false);
 const other=setup();other.cloud={...other.scene,documentId:'other-pdf'};await other.click();
 assert.ok(other.calls.includes('compile'));
});
test('an unavailable cloud snapshot does not block direct PDF reconstruction',async()=>{
 const s=setup({cloudError:Error('Cloud unavailable')});await s.click();
 assert.deepEqual(s.calls,['restore','download','compile','select','save','activate','event','open']);
});
test('unsupported PDF and failed persistence cannot show a success action or activate a scene',async()=>{
 for(const override of [{loadModule:async()=>({buildNativePdfScene:async()=>{throw Error('No supported dimensioned vector floor plan found.');},readSchematic:()=>null,restoreCloud3DState:async()=>({})})},
  {saveSchematic:async()=>{throw Error('Storage failed');}}]){
  const s=setup(override);await s.click();assert.equal(s.statuses.at(-1).kind,'error');assert.ok(s.error);assert.ok(!s.calls.includes('activate'));assert.ok(!s.calls.includes('event'));
  assert.equal(s.analyzing,false);assert.equal(drawingWorkflowState(s.projectId).active,null);
 }
});
test('button is operable with local status and navigation that preserves an optional parent callback',()=>{
 assert.match(center,/onClick=\{handleBuildPdf3D\}/);assert.match(center,/onClick=\{onOpen3D\}/);
 assert.match(center,/pdfPreviewStatus\.kind==='error'\?'alert':'status'/);
 assert.match(center,/Open the 3D Model tab at the top of this page/);
 assert.match(center,/pdfPreviewStatus.kind==='success'&&onOpen3D/);
});
