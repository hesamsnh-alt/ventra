import test from 'node:test';
import assert from 'node:assert/strict';
import {generateReviewedRender} from '../src/lib/planRenderReview.mjs';
const body={imageUrl:'data:image/jpeg;base64,YQ==',style:'modern',notes:'تراس باز بماند'};
const space=(id,purpose)=>({id,label:purpose,purpose,position:'at the source end',boundary:'within the source walls',adjacentIds:[],openings:'drawn door',visibleFurniture:'as drawn'});
const layout={readable:true,uncertainties:[],footprint:'source footprint',entrance:'source doorway',spaces:[space('bed1','bedroom'),space('bed2','bedroom'),space('outdoor','بالکن'),space('utility','laundry')]};
const review={footprint:'match',partitions:'match',entranceAndOpenings:'match',noExtraSpaces:'match',spaces:layout.spaces.map(({id})=>({id,presence:'match',positionAndAdjacency:'match',details:'checked against original'})),issues:[]};
function runtime(source=layout,judgment=review){
 const calls=[];return {calls,options:{image:{},reviewModel:'review-model',model:'render-model',signal:new AbortController().signal,
  create:async(payload,options)=>{calls.push(payload);assert.equal(options.maxRetries,0);return {status:'completed',output_text:JSON.stringify(calls.length===1?source:judgment)};},
  edit:async payload=>{calls.push('image');assert.ok(payload.prompt.includes('bed2'));assert.ok(payload.prompt.includes('بالکن'));assert.ok(payload.prompt.includes(body.notes));return {data:[{b64_json:'Yg=='}]};}}};
}
test('Full pipeline extracts source layout before rendering and compares both images before acceptance',async()=>{
 const r=runtime(),result=await generateReviewedRender(body,r.options);
 assert.equal(r.calls.length,3);assert.equal(r.calls[0].input[0].content[1].image_url,body.imageUrl);
 assert.equal(r.calls[1],'image');assert.equal(r.calls[2].input[0].content[1].image_url,body.imageUrl);
 assert.equal(r.calls[2].input[0].content[2].image_url,result.imageUrl);
 assert.equal(result.pipelineVersion,47);assert.equal(result.layoutReview.method,'ai_visual_comparison');
});
test('Unclear or invalid source stops before any image generation',async()=>{
 for(const source of [{...layout,readable:false},{...layout,uncertainties:['wall unclear']},{...layout,spaces:[]},{...layout,spaces:[space('a','room'),space('a','room')]},{...layout,spaces:[{...space('a','room'),adjacentIds:['invented']}]}]){
  const r=runtime(source);await assert.rejects(generateReviewedRender(body,r.options),error=>error.code==='RENDER_PLAN_UNCLEAR');assert.equal(r.calls.length,1);
 }
});
test('Missing bedroom, relocated balcony, extra space and uncertain partitions all reject without retry',async()=>{
 const variants=[{...review,spaces:review.spaces.slice(1)},{...review,spaces:review.spaces.map(s=>s.id==='outdoor'?{...s,positionAndAdjacency:'mismatch'}:s)},{...review,noExtraSpaces:'mismatch'},{...review,partitions:'uncertain'},{...review,issues:['Laundry is missing']},{...review,spaces:review.spaces.map(s=>s.id==='bed2'?{...s,presence:'mismatch'}:s)}];
 for(const judgment of variants){const r=runtime(layout,judgment);await assert.rejects(generateReviewedRender(body,r.options),error=>error.code==='RENDER_LAYOUT_MISMATCH'&&error.status===422);assert.equal(r.calls.length,3);}
});
test('Incomplete, refused or malformed reviewer cannot silently accept an image',async()=>{
 for(const response of [{status:'incomplete',output_text:JSON.stringify(layout)},{status:'completed',output_text:''},{status:'completed',output_text:'{}'}]){
  let edits=0;await assert.rejects(generateReviewedRender(body,{create:async()=>response,edit:async()=>{edits++;},reviewModel:'review'}),error=>error.code==='RENDER_REVIEW_FAILED');assert.equal(edits,0);
 }
});
test('A reviewer outage after generation does not fall back to unreviewed success',async()=>{
 const r=runtime();const create=r.options.create;r.options.create=async(...args)=>{if(r.calls.length===2)throw new Error('review unavailable');return create(...args);};
 await assert.rejects(generateReviewedRender(body,r.options),/review unavailable/);assert.equal(r.calls.length,2);
});
