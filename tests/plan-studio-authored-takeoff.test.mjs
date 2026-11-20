import test from 'node:test';
import assert from 'node:assert/strict';
import {editorState,submit} from '../src/lib/planStudio/controller.mjs';
import {measureAuthoredPlan} from '../src/lib/planStudio/authoredTakeoff.mjs';
import {buildRasterBoq,rasterOperationEvidence} from '../src/lib/rasterBoqEvidence.mjs';

for(const [name,commands,rooms,area,length,doors,windows] of [
 ['studio',['ML','0,0','600,0','600,400','0,400','C'],1,22.04,20,0,0],
 ['L shape',['ML','0,0','800,0','800,400','400,400','400,800','0,800','C','AD','300,0','WINDOW','800,200'],1,44.84,32,1,1],
 ['partitioned apartment',['ML','0,0','1000,0','1000,800','0,800','C','ML','600,0','600,800','','AD','300,0','AD','600,400','WINDOW','1000,400'],2,74.88,44,2,1],
])test(name+' uses original geometry for the raster BOQ',()=>{
 const {doc}=commands.reduce((state,command)=>submit(state,command),editorState());
 const measured=measureAuthoredPlan(doc);
 assert.ok(measured);
 assert.deepEqual([measured.rooms,measured.floor_area,measured.wall_length,measured.wall_height,measured.doors,measured.windows],[rooms,area,length,3,doors,windows]);
 assert.equal(rasterOperationEvidence(measured).adapter.scheduled_quantities.floor_area,area);
 const boq=buildRasterBoq({takeoff:measured,projectId:"qa",projectName:"QA"});
 assert.equal(boq.items.find(item=>item.measurementPlaceholder?.surface==="floor")?.quantity,area);
});
