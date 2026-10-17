import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {latestPdfReportForExport} from '../src/lib/pdfReportExport.mjs';
import {mergePdfEvidence} from '../src/lib/pdfTakeoffEvidence.mjs';
const observed=JSON.parse(readFileSync('tests/fixtures/pdf-observed-report-28.json','utf8'));
test('actual report 28 exports current page evidence instead of its stale root summary without changing saved raw evidence',async()=>{
 assert.equal(observed.wall_length,112);assert.equal(observed.raw_result.wall_length,0);
 const before=JSON.stringify(observed);
 const report=await latestPdfReportForExport({projectId:observed.project_id,visible:observed,workflow:()=>({}),readLatest:async()=>({takeoff:observed})});
 assert.equal(report.wall_length,0);assert.equal(report.floor_area,372);assert.equal(report.document_id,observed.document_id);
 assert.ok(report.pdf_analysis.measurement_completion.unmeasured_metrics.includes('internal_block_area'));
 assert.equal(report.pdf_analysis.source_measurement_status.status,'failed');
 assert.match(report.pdf_analysis.source_measurement_status.reason,/max_output_tokens/);
 assert.equal(report.raw_result,observed.raw_result);assert.equal(JSON.stringify(observed),before);
 assert.equal(report.doors,18);assert.equal(report.slab_formwork_area,0); // No invented recovery.
});
test('a failed source extraction remains incomplete even when it supplies no explicit missing metric list',()=>{
 const pages=structuredClone(observed.page_results);
 pages[0].document_measurement_review={floor_revisions:[],calculations:[],exclusions:[],notes:''};
 const r=mergePdfEvidence(pages);
 assert.equal(r.pdf_analysis.measurement_completion.status,'incomplete');
 assert.equal(r.pdf_analysis.source_measurement_status.status,'failed');
 delete pages[0].source_measurement_status;
 assert.equal(mergePdfEvidence(pages).pdf_analysis.measurement_completion.status,'provisional');
});
