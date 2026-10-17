import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {mergePdfEvidence,pdfScheduledRule} from '../src/lib/pdfTakeoffEvidence.mjs';
import {recoverPdfRoomInventory} from '../src/lib/pdfRoomInventory.mjs';
const fixture=JSON.parse(readFileSync('tests/fixtures/pdf-scoped-room-report.json','utf8'));
test('observed PDF evidence: repeated named subsets never increase opening or cabinet totals',()=>{
 const r=mergePdfEvidence(fixture.pages);assert.equal(r.doors,19);assert.equal(r.windows,15);assert.equal(r.window_area,39.06);assert.equal(r.kitchen_cabinet_length,5);
 assert.equal(r.pdf_analysis.overlapping_scope_claims.length,4);
 assert.equal(pdfScheduledRule(r,'Aluminium glazed window','m2').quantity,39.06);
 assert.equal(r.column_volume,10.3545);assert.equal(r.beam_volume,14.8125); // Roof beams are a separate physical level.
});
test('complete tagged room inventory recovers omitted finishes and walkable terrace, without changing ceilings',()=>{
 const before=JSON.stringify(fixture);const r=mergePdfEvidence(fixture.pages);
 assert.equal(r.wood_floor_area,178);assert.equal(r.ceramic_floor_area,154);assert.equal(r.epoxy_floor_area,28);assert.equal(r.terrace_floor_area,12);
 assert.equal(r.floor_area,372);assert.equal(r.ceiling_area,360);
 assert.equal(JSON.stringify(fixture),before);assert.deepEqual(mergePdfEvidence(r.page_results).scheduled_quantities,r.scheduled_quantities);
});
test('actual server normalization reconciles saved older PDF evidence without another API call',()=>{
 const source=readFileSync('src/lib/serverBoqAnalysis.js','utf8'),start=source.indexOf('function normalizeTakeoff('),end=source.indexOf('\nfunction ',start+10);
 const normalize=vm.runInNewContext('('+source.slice(start,end)+')',{mergePdfEvidence,toNumber:n=>Number(n)||0,round:(n,d=2)=>Math.round(n*10**d)/10**d});
 const r=normalize({pdf_analysis:{version:105},page_results:fixture.pages,scheduled_quantities:{window_area:44.82},windows:19,window_area:44.82});
 assert.equal(r.pdf_analysis.version,108);assert.equal(r.window_area,39.06);assert.equal(r.windows,15);assert.equal(r.scheduled_quantities.kitchen_cabinet_length,5);
});
test('room labels rather than explanatory subtraction determine void and terrace classification',()=>{
 const p=fixture.pages[1],r=recoverPdfRoomInventory(p).page;
 assert.equal(r.floor_area,180);assert.equal(r.page_evidence.quantities.find(q=>q.key==='ceramic_floor_area').value,46);
});
test('partial or duplicate room inventory cannot invent finish coverage',()=>{
 const p=structuredClone(fixture.pages[1]);p.detected_items=p.detected_items.filter(i=>i.name!=='F08 Bedroom 4 (L)');
 const result=recoverPdfRoomInventory(p);assert.equal(result.page,p);assert.ok(result.warnings.length);
 const duplicate=structuredClone(fixture.pages[1]);duplicate.detected_items.push(duplicate.detected_items[0]);
 assert.equal(recoverPdfRoomInventory(duplicate).page,duplicate);
});
test('two genuinely distinct floor quantities are added even if they have identical values',()=>{
 const p=structuredClone(fixture.pages.slice(0,2));
 for(const page of p){page.detected_items=[];page.page_evidence.quantities=[{key:'window_area',scope_id:page.page_evidence.scope_id,value:12,unit:'m2',evidence:'Complete floor window schedule'}];}
 assert.equal(mergePdfEvidence(p).window_area,24);
});
