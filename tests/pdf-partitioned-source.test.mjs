import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizePdfScope,mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
import {nativeOpeningEvidence} from '../src/lib/pdfNativeSchedules.mjs';
import {isPdfCreditBalanceError} from '../src/lib/pdfAnalysisErrors.mjs';
import {pdfAnalysisCacheKey} from '../src/services/pdfAnalysisCache.mjs';
const facts=JSON.parse(readFileSync('tests/fixtures/pdf-source-measurements.json','utf8'));
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-23.json','utf8'));
function reply(request){
 if(request.text.format.name==='source_finish_rules')return {rules:{...facts.rules,wall_height:{value:3.2,pages:[6],evidence:'Source wall height'}},ceilings:facts.floors.map(f=>({scope_id:f.scope_id,complete:f.ceilings_complete,spaces:f.ceiling_spaces})),exclusions:[],notes:''};
 const f=facts.floors.find(f=>request.input[0].content[0].text.includes('Extract ONLY floor '+normalizePdfScope(f.scope_id)+'.'));
 return {scope_id:normalizePdfScope(f.scope_id),walls_complete:f.walls_complete,wall_inventory_evidence:f.wall_inventory_evidence,source_pages:f.source_pages,
  walls:f.walls.map(w=>({id:w.id,classification:w.classification,length_m:w.length.value,height_m:w.height.value,pages:w.length.pages,length_basis:w.length_basis,evidence:w.length.evidence})),
  openings:f.openings.map(o=>({id:o.id,wall_id:o.wall_id,kind:o.kind,width_m:o.width.value,height_m:o.height.value,sill_m:o.sill.value,pages:o.width.pages,evidence:o.width.evidence})),
  wet_rooms_complete:f.wet_rooms_complete,wet_rooms:f.wet_rooms.map(w=>({id:w.id,boundary_complete:w.boundary_complete,lengths_m:w.boundary_lengths.map(s=>s.value),opening_ids:w.opening_ids,pages:w.boundary_lengths[0].pages,evidence:w.boundary_lengths[0].evidence})),exclusions:[],notes:''};
}
function service(onResponse){const calls=[],packets=[];let uploads=0,deletes=0;
 const client={files:{create:async()=>{uploads++;return {id:'part'};},delete:async()=>deletes++},responses:{create:async(p,o)=>{calls.push(p);assert.equal(o.maxRetries,0);assert.equal(p.model,'gpt-5');assert.equal(p.reasoning.effort,'minimal');return onResponse?onResponse(p):{status:'completed',output_text:JSON.stringify(reply(p)),usage:{input_tokens:20,output_tokens:100,total_tokens:120}};}}};
 const c={pdfAnalysisCacheKey,normalizePdfScope,nativeOpeningEvidence,isPdfCreditBalanceError,Uint8Array,File,process:{env:{}},console:{log(){},warn(){}},getOpenAIClient:()=>client,parseTakeoffResponse:r=>JSON.parse(r.output_text)};
 vm.createContext(c);vm.runInContext(readFileSync('src/services/pdfPartitionedSourceService.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=reviewPartitionedPdfSource;this.legacyContract=(id,pages,schema,budget)=>pdfAnalysisCacheKey(new Uint8Array(),{version:VERSION,id,pages,schema,prompt:buildPdfSourcePartPrompt.toString(),budget});',c);
 return {legacyContract:c.legacyContract,run:args=>c.run({pdf:{},pages:structuredClone(observed.page_results),extractPagePacket:async(_,indexes)=>{packets.push(Array.from(indexes));return new Uint8Array([1]);},...args}),calls,packets,get uploads(){return uploads;},get deletes(){return deletes;}};
}
test('two-floor extraction uses rules plus separate floor packets within one 16000-token output budget and checkpoints each part',async()=>{
 const s=service(),saved=[];const r=await s.run({onCheckpoint:async checkpoint=>saved.push(structuredClone(checkpoint))});
 assert.equal(r.status,'completed');assert.equal(s.calls.length,3);assert.equal(s.calls.reduce((n,c)=>n+c.max_output_tokens,0),16000);
 assert.deepEqual(s.packets,[[5],[0,3,5],[1,4,5]]);assert.equal(saved.length,4);assert.equal(saved[0].status,'running');assert.equal(saved[1].status,'partial');assert.equal(s.uploads,3);assert.equal(s.deletes,3);
 const p=structuredClone(observed.page_results);p[0].document_measurement_review.measurement_basis=r.basis;p[0].source_measurement_status={status:r.status,source_pages:r.source_pages};
 const merged=mergePdfEvidence(p);assert.ok(Math.abs(merged.paint_area-858.38)<1e-7);assert.equal(merged.gypsum_ceiling_area,312);
 const replay=service();await replay.run({cached:r});assert.equal(replay.calls.length,0);assert.equal(replay.uploads,0);assert.equal(replay.packets.length,0);
});
test('mixed-floor opening schedules remain available to each scoped floor request',async()=>{
 const pages=structuredClone(observed.page_results);
 pages.push({pageNumber:40,page_evidence:{kind:'opening_schedule',scope_id:null,quantities:[]}});
 pages.push({pageNumber:41,page_evidence:{kind:'opening_schedule',scope_id:'project',quantities:[]}});
 const s=service();await s.run({pages});
 assert.ok(!s.packets[0].includes(39));
 for(const packet of s.packets.slice(1))assert.ok(packet.includes(39)&&packet.includes(40));
});
test('a token-limited floor preserves independent ceilings and successful floors, and no saved part is repeated',async()=>{
 const s=service(p=>p.input[0].content[0].text.includes('Extract ONLY floor floor:1.')?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:20,output_tokens:6000,total_tokens:6020}}:{status:'completed',output_text:JSON.stringify(reply(p))});
 const r=await s.run({});assert.equal(r.status,'partial');assert.equal(r.groups['floor:floor:1'].status,'failed');assert.equal(r.parts.find(p=>p.id==='floor:floor:1').usage.output_tokens,6000);
 const p=structuredClone(observed.page_results);p[0].document_measurement_review.measurement_basis=r.basis;p[0].source_measurement_status={status:r.status,source_pages:r.source_pages};
 const merged=mergePdfEvidence(p);assert.equal(merged.gypsum_ceiling_area,312);assert.equal(merged.ceiling_paint_area,360);assert.equal(merged.internal_block_area,0);assert.equal(merged.pdf_analysis.measurement_completion.status,'incomplete');
 const next=service();const retained=await next.run({cached:r});assert.equal(retained.status,'partial');assert.equal(next.calls.length,0);
});
test('a restart after the rules checkpoint runs only the two missing floor requests',async()=>{
 const first=service();let checkpoint;await assert.rejects(first.run({onCheckpoint:async r=>{if(r.status==='running')return;checkpoint=structuredClone(r);throw Error('server interruption');}}),/server interruption/);assert.equal(first.calls.length,1);
 const restarted=service();const done=await restarted.run({cached:checkpoint});assert.equal(done.status,'completed');assert.equal(restarted.calls.length,2);assert.ok(restarted.calls.every(p=>p.text.format.name==='source_floor_inventory'));
});
test('exhausted credits stop unsent parts and remain stopped across repeated continuation',async()=>{
 const s=service(()=>{throw Object.assign(Error('no credits remaining'),{code:'credit_balance_exhausted'});});const r=await s.run({});assert.equal(r.status,'failed');assert.equal(s.calls.length,1);
 const next=service();await next.run({cached:r});assert.equal(next.calls.length,0);
});
test('an excessive floor set makes no request instead of silently increasing the shared source budget',async()=>{
 const s=service(),sample=observed.page_results[0];const pages=Array.from({length:7},(_,i)=>({...structuredClone(sample),pageNumber:i+1,page_evidence:{...sample.page_evidence,scope_id:'floor:'+i}}));
 const r=await s.run({pages});assert.equal(r.status,'pending');assert.equal(s.calls.length,0);
});

test('v153 migrates only old unfinished source contracts and preserves old completed parts',async()=>{
 const first=service(),cached=await first.run({});
 for(const [id,group] of Object.entries(cached.groups)){
  const call=first.calls.find(p=>id==='rules'?p.text.format.name==='source_finish_rules':p.input[0].content[0].text.includes('Extract ONLY floor '+id.slice(6)+'.'));
  assert.ok(call,id);group.contract=first.legacyContract(id,group.source_pages,call.text.format.schema,call.max_output_tokens);
 }
 const failedId='floor:floor:0';cached.groups[failedId].status='failed';cached.groups[failedId].reason='max_output_tokens';delete cached.groups[failedId].result;
 const next=service(),result=await next.run({cached});
 assert.equal(result.status,'completed');assert.equal(next.calls.length,1);assert.match(next.calls[0].input[0].content[0].text,/Extract ONLY floor floor:0/);
 assert.equal(next.calls[0].max_output_tokens,6000);assert.equal(result.groups.rules.contract,cached.groups.rules.contract);
 const replay=service();await replay.run({cached:result});assert.equal(replay.calls.length,0);
 const stopped=structuredClone(cached);stopped.groups[failedId].creditUnavailable=true;
 const blocked=service();await blocked.run({cached:stopped});assert.equal(blocked.calls.length,0);
});
