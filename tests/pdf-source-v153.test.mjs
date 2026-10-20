import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {completeDrawingResult} from '../src/lib/drawingJobIdentity.mjs';
const full=()=>({total_pages:13,page_results:Array.from({length:13},(_,i)=>({pageNumber:i+1})),pdf_analysis:{document_review_status:{status:'completed'}}});
test('complete page/base review cannot publish a failed, pending or partial source-detail review',()=>{
 for(const status of ['failed','pending','partial']){const r=full();r.pdf_analysis.source_measurement_status={status};assert.equal(completeDrawingResult(r),false);}
 for(const status of ['completed','not_required']){const r=full();r.pdf_analysis.source_measurement_status={status};assert.equal(completeDrawingResult(r),true);}
 assert.equal(completeDrawingResult(full()),true);
});
test('source detail truncation returns 409 with the failed parts and no successful BOQ payload',async()=>{
 const result=full();result.pdf_analysis.source_measurement_status={status:'failed',reason:'Source parts incomplete',parts:[{id:'rules',status:'failed',reason:'max_output_tokens'},{id:'floor:floor:0',status:'completed'}]};
 const ctx={reportDrawingProgress:async()=>{},completeDrawingResult,NextResponse:{json:(body,init)=>Response.json(body,init)},analyzeDrawing:async()=>result,commercialRun:async(request,kind,handler)=>handler(request),console:{log(){},error(){}}};
 vm.createContext(ctx);vm.runInContext(readFileSync('src/lib/serverDrawingAnalysis.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+'\nthis.run=runDrawingRequest;',ctx);
 const r=await ctx.run({json:async()=>({fileUrl:'https://source.invalid/test.pdf',fileName:'test.pdf'})}),p=await r.json();
 assert.equal(r.status,409);assert.equal(p.success,false);assert.equal(p.result,undefined);assert.match(p.error,/Source detail review failed/);assert.match(p.error,/rules: max_output_tokens/);assert.doesNotMatch(p.error,/floor:floor:0/);
});
