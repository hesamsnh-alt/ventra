import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPromptActions,preparePromptScene,promptActionSchema} from '../src/lib/scenePromptActions.mjs';
import {planScenePrompt} from '../src/lib/scenePromptPlanner.mjs';
const scene=()=>({width:8,depth:6,height:2.8,palette:{wall:'#eeeeee'},footprint:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],rooms:[{id:'k',name:'آشپزخانه',type:'kitchen',polygon:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}]}],walls:[],openings:[],holes:[],assets:[]});
const plan=actions=>({status:'apply',message:'انجام شد',actions});
const add=(type,x=2,y=2)=>({action:'add',type,roomId:'k',xMeters:x,yMeters:y,rotation:0});
for(const type of ['washing_machine','refrigerator','freezer','floor_lamp','dressing_table','plant'])test(`add ${type} without changing architecture`,()=>{
 const input=scene(),copy=structuredClone(input),r=applyPromptActions(input,plan([add(type)]));
 assert.equal(r.scene.assets[0].type,type);assert.equal(r.scene.assets[0].roomId,'k');assert.deepEqual(input,copy);
 for(const key of ['rooms','walls','openings','footprint','height'])assert.deepEqual(r.scene[key],input[key]);
});
test('table and four chairs added atomically with proper facing and clear footprints',()=>{
 const r=applyPromptActions(scene(),plan([add('dining_table',4,3),{...add('chair',4,2),rotation:0},{...add('chair',4,4),rotation:180},{...add('chair',2.7,3),rotation:270},{...add('chair',5.3,3),rotation:90}]));
 assert.equal(r.scene.assets.length,5);
 assert.equal(r.scene.assets.filter(a=>a.type==='chair').length,4);
});
test('move/color/remove existing appliance uses ID and preserves unrelated furniture',()=>{
 const input=scene();input.assets=[{id:'washer',type:'washing_machine',roomId:'k',xMeters:1,yMeters:1,width:.65,depth:.65,height:.88,rotation:0},{id:'plant',type:'plant',roomId:'k',xMeters:7,yMeters:5,width:.4,depth:.4,height:.9,rotation:0}];
 const r=applyPromptActions(input,plan([{action:'update',assetId:'washer',xMeters:3,yMeters:2,color:'#112233'}]));
 assert.equal(r.scene.assets.length,2);assert.equal(r.scene.assets[0].color,'#112233');assert.deepEqual(r.scene.assets[1],input.assets[1]);
 assert.equal(applyPromptActions(r.scene,plan([{action:'remove',assetId:'washer'}])).scene.assets.length,1);
});
test('collision rejects the entire batch without partially saving a valid first action',()=>{
 const input=scene(),copy=structuredClone(input);
 assert.throws(()=>applyPromptActions(input,plan([add('washing_machine'),add('refrigerator')])),/overlaps/);assert.deepEqual(input,copy);
});
test('walls, holes, unknown rooms, NaN, huge objects and unsupported actions fail',()=>{
 const s=scene();s.walls=[{id:'w',start:{x:2,y:0},end:{x:2,y:6},thickness:.12}];
 assert.throws(()=>applyPromptActions(s,plan([add('washing_machine')])),/wall/);
 s.walls=[];s.holes=[{polygon:[{x:1,y:1},{x:3,y:1},{x:3,y:3},{x:1,y:3}]}];
 assert.throws(()=>applyPromptActions(s,plan([add('plant')])),/shaft/);
 for(const op of [{...add('plant'),roomId:'no-room'},{...add('plant'),xMeters:NaN},{...add('plant'),width:100},{action:'wall'}])assert.throws(()=>applyPromptActions(scene(),plan([op])));
});
test('door access must remain clear',()=>{
 const s=scene();s.walls=[{id:'w',start:{x:0,y:0},end:{x:8,y:0}}];s.openings=[{type:'door',wallId:'w',offset:.5,width:1}];
 assert.throws(()=>applyPromptActions(s,plan([add('washing_machine',4,.7)])),/door/);
});
test('clarify and unsupported never produce a success scene',()=>{
 for(const status of ['clarify','unsupported'])assert.throws(()=>applyPromptActions(scene(),{status,message:'Choose a bedroom',actions:[]}),/Choose/);
 assert.throws(()=>applyPromptActions(scene(),plan([])),/No executable/);
});
test('IDs are stable for legacy furniture; unknown target and duplicate IDs rejected',()=>{
 const s=scene();s.assets=[{type:'plant',x:.3,y:.4}];assert.equal(preparePromptScene(s).assets[0].id,'asset-0');
 assert.throws(()=>applyPromptActions(scene(),plan([{action:'remove',assetId:'missing'}])),/Unknown/);
 s.assets=[{id:'same'},{id:'same'}];assert.throws(()=>preparePromptScene(s),/Duplicate/);
});
test('planner sends multilingual context and retries one geometrically invalid plan',async()=>{
 let count=0;const s=scene();const r=await planScenePrompt({scene:s,prompt:'put washing machin in kitchen',model:'test',requestAI:async(payload)=>{
  count++;assert.equal(payload.text.format.strict,true);assert.deepEqual(payload.text.format.schema,promptActionSchema);
  assert.ok(payload.input[1].content.includes('آشپزخانه'));
  if(count===2)assert.ok(payload.input[1].content.includes('previousValidation'));
  return {output_text:JSON.stringify(plan([add('washing_machine',count===1?-2:2)]))};
 }});assert.equal(count,2);assert.equal(r.scene.assets[0].type,'washing_machine');
});
test('provider failure, incomplete response and refusal keep input intact',async()=>{
 const s=scene(),copy=structuredClone(s);
 for(const requestAI of [async()=>{throw new Error('quota');},async()=>({status:'incomplete'}),async()=>({output_text:JSON.stringify({status:'unsupported',message:'No custom mesh renderer',actions:[]})})])await assert.rejects(planScenePrompt({scene:s,prompt:'test',requestAI}));
 assert.deepEqual(s,copy);
});
test('final-batch validation allows swapping two objects and keeps custom colors with a style request',()=>{
 const input=scene();input.assets=[{id:'a',type:'plant',roomId:'k',xMeters:2,yMeters:2,width:.45,depth:.45,height:.9,rotation:0},{id:'b',type:'plant',roomId:'k',xMeters:6,yMeters:4,width:.45,depth:.45,height:.9,rotation:0}];
 const r=applyPromptActions(input,plan([{action:'style',value:'luxury'},{action:'update',assetId:'a',xMeters:6,yMeters:4,color:'#ff0000'},{action:'update',assetId:'b',xMeters:2,yMeters:2},{action:'palette',key:'wall',color:'#ffffff'}]));
 assert.equal(r.scene.assets[0].xMeters,6);assert.equal(r.scene.assets[1].xMeters,2);
 assert.deepEqual(r.appearance.colors,[{id:'a',color:'#ff0000'}]);assert.equal(r.appearance.palette.wall,'#ffffff');
});
