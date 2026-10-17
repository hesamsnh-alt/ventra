import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {readPdfSourceSpecifications,pdfSpecificationConflicts} from '../src/lib/pdfSourceSpecifications.mjs';
import {pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
import {planPdfCatalogBindings} from '../src/lib/pdfBoqCoverage.mjs';
import {measureNativeWallFloor} from '../src/lib/pdfNativeWallGeometry.mjs';
import {buildNativePdfSourceBasis} from '../src/lib/pdfNativeSourceBasis.mjs';
import {runOfflinePdfCatalog} from '../tools/check-pdf-rate-catalog.mjs';
const require=createRequire(import.meta.url);let pdfLib;try{pdfLib=require('pdf-lib');}catch{pdfLib=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/pdf-lib');}
const text=vm.createContext({...pdfLib,TextDecoder});
vm.runInContext(readFileSync('src/services/pdfNativeTextService.mjs','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.read=extractNativePdfText;',text);
const specPage=(lines,page=3,scope='project')=>({pageNumber:page,page_evidence:{kind:'specification',scope_id:scope},native_text_evidence:{status:'readable',spans:lines.map((text,i)=>({text,x:30,y:740-20*i,height:10}))}});
const units={external_block_area:'m2',internal_block_area:'m2',column_volume:'m3',beam_volume:'m3',foundation_volume:'m3',water_pipe_length:'m',waste_pipe_length:'m',ac_count:'nr'};
function takeoff(lines,quantities){return {...quantities,floor_area:80,rooms:2,scheduled_quantities:{...quantities},page_results:[],
 pdf_analysis:{quantity_evidence:Object.fromEntries(Object.entries(quantities).map(([key,value])=>[key,[{key,value,unit:units[key],scope_id:'project',pages:[1,2],evidence:`Independently defined source measurement for ${key}: ${value} ${units[key]}`}]])),specification_facts:readPdfSourceSpecifications({page_results:[specPage(lines)]})}};}
const catalog=[['B175','175mm concrete blockwork','m2',63],['B100','100mm concrete blockwork','m2',45],['C25','C25 RC concrete including placing','m3',410],['C30','C30 RC concrete including placing','m3',460],
 ['P20','PPR water supply pipe 20mm','m',20],['P25','PPR water supply pipe 25mm','m',25],['P32','PPR water supply pipe 32mm','m',32],
 ['W50','UPVC waste pipe 50mm','m',30],['W110','UPVC waste pipe 110mm','m',65],['AC15','Wall mounted split air conditioning unit 1.5 ton','nos',3300],['AC2','Wall mounted split air conditioning unit 2 ton','nos',4200]].map(([item_code,description,unit,standard_rate])=>({item_code,description,unit,standard_rate,section_code:'REAL-CATALOG-TEST',is_active:true}));
const projectA=()=>takeoff(['External walls: 175 mm; Internal partitions: 100 mm','Foundations: C25 reinforced concrete','Columns and beams: C30 concrete','Water supply pipes: PPR DN25','Waste pipes: UPVC DN110','Split AC units: 2 TR'],
 {external_block_area:48*3.4-12,internal_block_area:31*3.4-8,foundation_volume:11*.9*.9*.35,column_volume:12*.25*.25*3.4,beam_volume:37*.2*.3,water_pipe_length:55,waste_pipe_length:39,ac_count:6});
const projectB=()=>takeoff(['External walls: 10 cm; Internal partitions: 0.175 m','Foundations: C30 reinforced concrete','Columns and beams: C25 concrete','Water supply pipes: PPR DN20','Waste pipes: UPVC DN50','Split AC units: 1.5 TR'],
 {external_block_area:51*2.8-13,internal_block_area:26*2.8-10,foundation_volume:4*1.1*1.1*.4,column_volume:8*.3*.4*2.8,beam_volume:19*.25*.2,water_pipe_length:31,waste_pipe_length:22,ac_count:4});
test('two independent source PDFs provide different actual specification facts through the native reader',async()=>{
 for(const [factory,expected] of [[projectA,175],[projectB,100]]){
  const t=factory(),doc=await pdfLib.PDFDocument.create(),page=doc.addPage([620,800]),font=await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  let y=740;for(const fact of t.pdf_analysis.specification_facts){page.drawText(fact.quote,{x:30,y,size:10,font});y-=20;}
  const pdf=await pdfLib.PDFDocument.load(await doc.save()),native=text.read(pdf,0);
  assert.equal(native.status,'readable');const facts=readPdfSourceSpecifications({page_results:[{pageNumber:1,page_evidence:{kind:'specification',scope_id:'project'},native_text_evidence:native}]});
  assert.ok(facts.some(f=>f.metric==='external_block_area'&&f.value===expected));assert.ok(facts.some(f=>f.property==='concrete_grade'));
 }
});
test('the normal server catalog route prices two different projects from source specifications, with no CSV or model call',async()=>{
 const original=structuredClone(catalog);
 for(const [factory,externalCode,pipeCode,acCode,gradeColumn] of [[projectA,'B175','P25','AC2','C30'],[projectB,'B100','P20','AC15','C25']]){
  const t=factory(),before=structuredClone(t),r=await runOfflinePdfCatalog(t,catalog),items=r.boq.items;
  assert.equal(r.modelCalls,0);assert.equal(r.databaseWrites,0);assert.equal(r.boq.summary.provisionalItems,7);
  const ext=items.find(i=>i.itemCode===externalCode);assert.equal(ext.quantity,t.external_block_area);assert.equal(ext.pdfEvidence.metricKey,'external_block_area');
  assert.equal(items.find(i=>i.itemCode===pipeCode).quantity,t.water_pipe_length);assert.equal(items.find(i=>i.itemCode===acCode).quantity,t.ac_count);
  const concrete=items.find(i=>i.itemCode===gradeColumn);assert.ok(Math.abs(concrete.quantity-t.column_volume-t.beam_volume)<1e-9);
  assert.deepEqual(concrete.pdfEvidence.metricKeys,['column_volume','beam_volume']);assert.ok(concrete.notes.includes('Source specification'));
  assert.equal(items.filter(i=>i.quantity>0&&i.pdfEvidence?.metricKeys?.includes('column_volume')).length,1);
  assert.equal(r.boq.summary.verifiedSubtotal,0);assert.deepEqual(t,before);
 }
 assert.deepEqual(catalog,original);
});
test('wall class follows the drawing thickness, including reversal, rather than fixed 200/120 values',()=>{
 const a=projectA(),b=projectB();
 assert.equal(pdfScheduledRule(a,'175 mm concrete block wall','m2').metricKey,'external_block_area');
 assert.equal(pdfScheduledRule(b,'175 mm concrete block wall','m2').metricKey,'internal_block_area');
 assert.equal(pdfScheduledRule(a,'200 mm blockwork','m2'),null);assert.equal(pdfScheduledRule(a,'External 100mm blockwork','m2'),null);
 const none=takeoff([],{external_block_area:91,internal_block_area:37});assert.equal(pdfScheduledRule(none,'200mm blockwork','m2'),null);
});
test('equal thicknesses, mixed grades/capacities and source material/diameter mismatches are withheld',()=>{
 const t=projectA();t.pdf_analysis.specification_facts=readPdfSourceSpecifications({page_results:[specPage(['External: 100 mm; Internal: 100 mm','Columns C30 concrete','Columns C25 concrete','Water supply pipes PPR DN25','Split AC units 1.5 TR','Split AC units 2 TR'])]});
 assert.equal(pdfScheduledRule(t,'100mm concrete blockwork','m2'),null);assert.equal(pdfScheduledRule(t,'External 100mm blockwork','m2').quantity,t.external_block_area);
 assert.equal(pdfScheduledRule(t,'C30 concrete for columns','m3'),null);assert.equal(pdfScheduledRule(t,'Split AC unit 2 ton','nr'),null);
 assert.equal(pdfScheduledRule(t,'UPVC water pipe 25mm','m'),null);assert.equal(pdfScheduledRule(t,'PPR water pipe 20mm','m'),null);
 assert.ok(pdfSpecificationConflicts(t.pdf_analysis.specification_facts).some(c=>c.metric==='column_volume'));
});
test('one floor specification cannot be applied to a whole-project total unless all selected floors are covered',()=>{
 const t=projectA();t.pdf_analysis.selected_floor_pages=[{page:1,scope:'floor:0'},{page:2,scope:'floor:1'}];
 t.pdf_analysis.specification_facts=readPdfSourceSpecifications({page_results:[specPage(['Columns C30 concrete'],3,'floor:0')]});
 assert.equal(pdfScheduledRule(t,'C30 concrete for columns','m3'),null);
 t.pdf_analysis.specification_facts=readPdfSourceSpecifications({page_results:[specPage(['Columns C30 concrete'],3,'floor:0'),specPage(['Columns C30 concrete'],4,'floor:1')]});
 assert.equal(pdfScheduledRule(t,'C30 concrete for columns','m3').quantity,t.column_volume);
 t.pdf_analysis.specification_facts=readPdfSourceSpecifications({page_results:[specPage(['GF columns C30 concrete'])]});
 assert.equal(pdfScheduledRule(t,'C30 concrete for columns','m3'),null);
});
test('native source facts take precedence over stale or forged summary specifications',()=>{
 const t=projectA(),forged={...t.pdf_analysis.specification_facts.find(f=>f.metric==='column_volume'),value:'C25'};
 t.pdf_analysis.specification_facts=[forged];assert.equal(pdfScheduledRule(t,'C25 concrete for columns','m3'),null);
 t.page_results=[specPage(['Columns C40 concrete'])];assert.equal(pdfScheduledRule(t,'C30 concrete for columns','m3'),null);
 assert.equal(pdfScheduledRule(t,'C40 concrete for columns','m3').quantity,t.column_volume);
 t.page_results[0].native_text_evidence.status='unsupported';assert.equal(pdfScheduledRule(t,'C25 concrete for columns','m3'),null);
});
test('duplicate commercial variants are still ambiguous even when the drawing specification is known',()=>{
 const t=projectA(),a=catalog.find(i=>i.item_code==='P25');
 const p=planPdfCatalogBindings(t,[a,{...a,item_code:'ALTERNATIVE',standard_rate:999}]);assert.equal(p.bindings.size,0);assert.ok(p.warnings.length);
 assert.equal(pdfScheduledRule(t,'C30 concrete for columns 300mm','m3'),null);
});
test('known specifications without a matching price remain measured and explain the actual catalog gap',async()=>{
 const t=projectA();t.pdf_analysis.specification_facts=readPdfSourceSpecifications({page_results:[specPage(['Columns: C35 concrete'])]});
 const result=await runOfflinePdfCatalog(t,catalog),row=result.boq.items.find(i=>i.pdfEvidence?.metricKey==='column_volume');
 assert.equal(row.quantity,t.column_volume);assert.equal(row.rate,0);assert.equal(row.completion.code,'source_specification_without_catalog_match');
 assert.equal(row.completion.source_specifications[0].value,'C35');assert.ok(row.notes.includes('concrete_grade=C35'));
 assert.ok(!row.completion.required_information.some(s=>s.startsWith('Concrete grade')));
});
test('native wall and wet-finish rule heights convert explicitly printed mm and cm to metres',()=>{
 const page=specPage(['WALLS: clear height 2800 mm','WET ROOMS: tile height 240 cm; Wall waterproofing height 1800 mm']);
 const basis=buildNativePdfSourceBasis([page],s=>s).basis;
 assert.ok(Math.abs(basis.rules.wall_height.value-2.8)<1e-9);assert.equal(basis.rules.wet_tile_height.value,2.4);assert.equal(basis.rules.wet_waterproof_height.value,1.8);
 assert.ok(basis.rules.wall_height.evidence.includes('2800 mm'));
});
function warehouse(unit='mm',external=150,internal=200){
 const factor={mm:1000,cm:100,m:1}[unit]||1,x0=100,y0=200,scale=20;
 const segment=(a,b)=>({a:{x:x0+a[0]*scale,y:y0+a[1]*scale},b:{x:x0+b[0]*scale,y:y0+b[1]*scale}});
 const span=(text,x,y,angle=0)=>({text,x,y,height:3,angle});
 const page={pageNumber:1,native_plan_text:{status:'readable',spans:[span(`${10*factor} x ${8*factor} envelope. All dimensions are ${unit}. Datum: wall centrelines. External: ${external} mm; Internal: ${internal} mm.`,100,400),
 span(String(10*factor),200,190),span(String(8*factor),90,280,Math.PI/2),span('W101 Store',130,260),span('W102 Workshop',240,260)]},native_graphics:{status:'readable',strokes:[
 {width:external/100,color:[0],dash:[],curved:false,segments:[segment([0,0],[10,0]),segment([10,0],[10,8]),segment([10,8],[0,8]),segment([0,8],[0,0])]},
 {width:internal/100,color:[0],dash:[],curved:false,segments:[segment([4,0],[4,8])]}]}};
 return measureNativeWallFloor(page,{status:'read',rows:[]});
}
test('independent 10x8 warehouse geometry works in mm, cm and m with internal walls thicker than external walls',()=>{
 for(const unit of ['mm','cm','m']){
  const r=warehouse(unit);assert.equal(r.status,'provisional',r.audit.reason);assert.equal(r.walls.filter(w=>w.classification==='external').reduce((n,w)=>n+w.length,0),36);
  assert.equal(r.walls.filter(w=>w.classification==='internal').reduce((n,w)=>n+w.length,0),8);assert.deepEqual(r.faces.map(f=>f.area).sort((a,b)=>a-b),[32,48]);
 }
 assert.equal(warehouse('mm',175,250).status,'provisional');assert.equal(warehouse('feet').status,'pending');assert.equal(warehouse('mm',150,150).status,'pending');
});
