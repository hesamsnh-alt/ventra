import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEstimateItem,partitionEstimateItems} from '../src/lib/estimateClassification.mjs';
test('legacy inclusion and verified flags cannot promote provisional items',()=>{
 assert.equal(classifyEstimateItem({status:'provisional_estimate',verification:'verified',includeInCommercialTotal:true}),'provisional');
 assert.equal(classifyEstimateItem({status:'measured',verification:'provisional',includeInCommercialTotal:true}),'provisional');
 assert.equal(classifyEstimateItem({includeInCommercialTotal:true}),'pending');
});
test('unresolved quantity/rate and excluded items do not count as verified',()=>{
 for(const item of [{status:'quantity_pending',verification:'verified'},{status:'measured_rate_pending',verification:'verified'},{status:'measured',rateMissing:true},{status:'measured',includeInCommercialTotal:false}])assert.equal(classifyEstimateItem(item),'pending');
 assert.equal(classifyEstimateItem({status:'manual',verification:'verified',includeInCommercialTotal:true}),'verified');
});
test('mixed imported BOQ partitions are disjoint and conserve every row',()=>{
 const rows=[{status:'measured',quantity:2,rate:50},{status:'provisional_estimate',verification:'verified',includeInCommercialTotal:true,quantity:3,rate:20},{status:'quantity_pending',quantity:1,rate:10}];
 const groups=partitionEstimateItems(rows);
 assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),{verified:1,provisional:1,pending:1});
 assert.equal(new Set(Object.values(groups).flat()).size,rows.length);
 const sum=x=>x.reduce((s,i)=>s+i.quantity*i.rate,0);
 assert.equal(sum(groups.verified),100);assert.equal(sum(groups.provisional),60);
});
