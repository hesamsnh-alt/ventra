import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState} from '../src/lib/drawingWorkflowGate.mjs';
const center=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8');
const handler=center.slice(center.indexOf('  async function handleBuildPdf3D()'),center.indexOf('  async function handleAnalyzeDrawing('));
let seq=0;
function setup(overrides={}){
 const scene={documentId:'pdf',nativePdfGeometryVersion:'native-pdf-plan-v162',pdfStoreys:[{sourcePage:2}]};
 const s={projectId:'preview-test-'+ ++seq,selectedDocumentForPreview:{id:'pdf',file_name:'input.pdf'},language:'en',
  getFileExtension:n=>n.split('.').pop(),pdfPreviewInFlightRef:{current:false},analysisInFlightRef:{current:false},analyzing:false,generatingBoq:false,
  analysisSelectionRef:{current:null},beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState,statuses:[],calls:[],
  setPdfPreviewStatus:v=>s.statuses.push(v),setAnalyzing:v=>s.analyzing=v,clearMessages(){},setMessage(){},setErrorMessage:v=>s.error=v,
  loadModule:async name=>name.includes('pdfPlanSceneService')?{buildNativePdfScene:async()=>{s.calls.push('compile');return scene;}}:{readSchematic:()=>s.existing||null},
  downloadProjectDocument:async()=>({url:'signed-original'}),commercialFetch:async()=>({ok:true,headers:{get:()=>null},arrayBuffer:async()=>new ArrayBuffer(5)}),
  selectDrawingDocument:()=>s.calls.push('select'),saveSchematic:async()=>{s.calls.push('save');return scene;},saveActiveSource:async()=>s.calls.push('activate'),
  window:{dispatchEvent:()=>s.calls.push('event')},CustomEvent:class{},...overrides};
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
 const s=setup();await s.click();assert.deepEqual(s.calls,['compile','select','save','activate','event']);
 assert.equal(s.statuses[0].kind,'working');assert.equal(s.statuses.at(-1).kind,'success');assert.equal(s.statuses.at(-1).documentId,'pdf');
 assert.equal(s.analyzing,false);assert.equal(s.pdfPreviewInFlightRef.current,false);assert.equal(drawingWorkflowState(s.projectId).active,null);
});
test('unsupported PDF and failed persistence cannot show a success action or activate a scene',async()=>{
 for(const override of [{loadModule:async()=>({buildNativePdfScene:async()=>{throw Error('No supported dimensioned vector floor plan found.');},readSchematic:()=>null})},
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
