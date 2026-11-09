import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {apsManifestGeometry} from '../src/lib/apsViewables.mjs';
import {drawingSourceBinding} from '../src/lib/pdfPlanScene.mjs';
import {isSelectedApsDrawing} from '../src/lib/drawingSelection.mjs';
import {engineeringForDrawing} from '../src/lib/engineeringRestore.mjs';
import {dwgReconstructionReadiness} from '../src/lib/dwgCalibration.mjs';

const center=readFileSync('src/app/projects/[id]/ProjectDrawingCenter.jsx','utf8');
const helpers=center.slice(center.indexOf('  function hasNativeCad3D('),center.indexOf('  async function handleAnalyzeDrawing('));
function setup(extension,{local,current,cloud,switchOnRead=false}={}){
 const drawing={id:'selected',file_name:`plan.${extension}`};
 const calls=[],selection={current:{projectId:'project',documentId:drawing.id}};
 const scope={
  projectId:'project',language:'en',analysisSelectionRef:selection,takeoffResultRef:{current},
  apsManifestGeometry,dwgReconstructionReadiness,engineeringForDrawing,isSelectedApsDrawing,
  readPersistedTakeoff:async(_project,kind,{documentId})=>{
   assert.equal(kind,'engineering');assert.equal(documentId,drawing.id);calls.push('read');
   if(switchOnRead)selection.current={projectId:'project',documentId:'other'};
   return local;
  },
  loadModule:async()=>({restoreCloud3DState:async(_project,kind,documentId)=>{
   assert.equal(kind,'engineering');assert.equal(documentId,drawing.id);calls.push('restore');return {engineering:cloud};
  }}),
  persistTakeoff:async(_project,record,{kind})=>{assert.equal(record.document_id,drawing.id);assert.equal(kind,'engineering');calls.push('save');},
  saveActiveSource:async(_project,source)=>calls.push(source),setTakeoffResult:record=>calls.push(record.aps_urn),
  setMessage(){},onOpen3D:()=>calls.push('open'),
 };
 const handler=vm.runInNewContext(helpers.replaceAll('import(','loadModule(')+';resumeSavedCad3D',scope);
 return {calls,run:()=>handler(drawing,extension)};
}
const translation={source:'autodesk-aps',document_id:'selected',aps_urn:'translated-urn',aps_status:'ready'};
const geometry={...translation,model_unit:'m',geometry:{wallLineSegments:[{start:{x:0,y:0},end:{x:4,y:0}}]}};

for(const extension of ['dwg','dxf'])test(`${extension} opens saved calibrated geometry and resumes an existing translation for extraction`,async()=>{
 const ready=setup(extension,{local:geometry});assert.equal(await ready.run(),true);
 assert.deepEqual(ready.calls,['read','save','aps','open']);
 const pending=setup(extension,{cloud:translation});assert.equal(await pending.run(),true);
 assert.deepEqual(pending.calls,['read','restore','save','translated-urn']);
});

for(const extension of ['ifc','rvt'])test(`${extension} opens a native 3D view without a 2D wall calibration`,async()=>{
 const record={...translation,manifest:{derivatives:[{children:[{type:'geometry',role:'3d'}]}]}};
 assert.equal(dwgReconstructionReadiness(record).ready,false);
 const saved=setup(extension,{cloud:record});assert.equal(await saved.run(),true);
 assert.deepEqual(saved.calls,['read','restore','save','aps','open']);
 assert.equal(drawingSourceBinding({selectedDocumentId:'selected',selectedDocumentName:`plan.${extension}`,engineering:record}).source,'aps');
});

test('an unrelated model leaves translation to the existing build path',async()=>{
 const s=setup('dxf',{local:{...geometry,document_id:'other'},cloud:{...translation,document_id:'other'}});
 assert.equal(await s.run(),false);assert.deepEqual(s.calls,['read','restore']);
});

test('switching files during recovery does not open or save a stale CAD model',async()=>{
 const s=setup('dxf',{local:geometry,switchOnRead:true});
 await assert.rejects(s.run(),/Selected drawing changed/);assert.deepEqual(s.calls,['read']);
});
