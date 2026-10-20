import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBoqScope,normalizeBoqScope,boqItemTrade,detectDrawingDiscipline,activeBoqTrades,measuredRooms} from '../src/lib/boqScope.mjs';
import {mergeScopeBase,captureDefaultEdits,readBoqScope,writeBoqScope} from '../src/lib/boqScopeStore.mjs';
import {priceScopeDefaults,removeIncludedDefaultComponents} from '../src/lib/boqScopeRates.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
const row=(key,quantity=10,extra={})=>({id:key,description:key,unit:'m²',quantity,rate:20,verification:'verified',status:'measured',pdfEvidence:{metricKey:key},...extra});
const room=(name,quantity=12)=>({name,quantity,unit:'m2'});
const takeoff={floor_area:48,wall_area:100,page_results:[{pageNumber:1,page_evidence:{kind:'floor_plan',scope_id:'floor:0'},detected_items:[room('Bedroom'),room('Bathroom'),room('Kitchen'),room('Living room')]}]};
const cfg=extra=>normalizeBoqScope({enabled:true,preset:'fitout',...extra});
test('disabled default leaves legacy rows, rates and totals identical',()=>{
 const items=[row('ceramic_floor_area'),row('beam_volume',6,{unit:'m³'})];
 assert.deepEqual(applyBoqScope(items,takeoff,{}).items,items);
 assert.deepEqual(buildBoqExport(applyBoqScope(items,takeoff,{}).items),buildBoqExport(items));
});
test('fit-out excludes earthworks and structure; enabling a trade restores source quantity/rate',()=>{
 const items=[row('excavation_volume'),row('beam_volume'),row('paint_area')];
 const r=applyBoqScope(items,{},cfg({defaultsEnabled:false}));
 assert.deepEqual(r.items.map(i=>i.id),['paint_area']);assert.equal(r.excluded.length,2);
 const restored=applyBoqScope(items,{},cfg({trades:['structure'],defaultsEnabled:false}));
 assert.equal(restored.items[0].quantity,10);assert.equal(restored.items[0].rate,20);
});
test('only electrical overrides full project scope; plumbing and default bathroom are absent',()=>{
 const r=applyBoqScope([row('light_count'),row('toilet_count'),row('foundation_volume')],takeoff,cfg({preset:'full',onlyDrawingDiscipline:true,discipline:'electrical'}));
 assert.deepEqual(r.report.activeTrades,['electrical']);assert.equal(r.items.length,1);assert.equal(r.items[0].id,'light_count');
});
test('mixed or unknown single-discipline selection stops without inference',()=>{
 for(const discipline of ['mixed','unknown'])assert.throws(()=>activeBoqTrades(cfg({onlyDrawingDiscipline:true,discipline})),/Confirm/);
});
test('discipline suggestions include plumbing, structure and mixed; no architectural prerequisite',()=>{
 assert.equal(detectDrawingDiscipline({},'Electrical lighting plan.pdf').discipline,'electrical');
 assert.equal(detectDrawingDiscipline({},'پلان تیرریزی.pdf').discipline,'structure');
 assert.equal(detectDrawingDiscipline({},'نقشه لوله کشی فاضلاب.pdf').discipline,'plumbing');
 assert.equal(detectDrawingDiscipline({},'plumbing electrical.pdf').discipline,'mixed');
});
test('source opening is counted only as documented; unmarked gaps never become doors',()=>{
 const r=applyBoqScope([row('door_count',3,{unit:'nos'})],takeoff,cfg());
 assert.equal(r.items.filter(i=>i.pdfEvidence?.metricKey==='door_count').length,1);
 assert.ok(!r.items.some(i=>i.scopeDefault?.metric==='door_count'));
});
test('simple dimensioned plan completes editable fixtures, finish, cabinets, lights without routes or structure',()=>{
 const r=applyBoqScope([],takeoff,cfg());
 const q=key=>r.items.find(i=>i.scopeDefault?.metric===key)?.quantity;
 assert.equal(q('toilet_count'),1);assert.equal(q('basin_count'),1);assert.equal(q('shower_count'),1);assert.equal(q('kitchen_sink_count'),1);
 assert.equal(q('kitchen_cabinet_length'),3);assert.equal(q('light_count'),4);assert.equal(q('wet_floor_waterproofing_area'),12);assert.equal(q('ceramic_floor_area'),48);
 assert.equal(q('wet_wall_waterproofing_area'),undefined);assert.equal(q('water_pipe_length'),undefined);assert.equal(q('foundation_volume'),undefined);
 assert.ok(r.items.every(i=>i.verification==='pending'&&i.quantityLocked===false));assert.ok(r.report.gaps.some(g=>g.trade==='plumbing'));
});
test('WC only excludes shower, retained room identities deduplicate repeated floor sheets',()=>{
 const p={pageNumber:2,page_evidence:{kind:'floor_plan',scope_id:'floor:0'},detected_items:[room('WC')]};
 assert.equal(measuredRooms({page_results:[p,p]}).length,1);
 assert.ok(!applyBoqScope([],{page_results:[p,p]},cfg()).items.some(i=>i.scopeDefault.metric==='shower_count'));
});
test('documented fixtures and custom finish ledgers prevent default duplicates',()=>{
 const items=[row('native:sink',2,{unit:'nos',description:'SK1 kitchen sink complete',pdfEvidence:{metricKey:'native:sink',operation:{family:'fixture',sourceDescription:'Kitchen sink complete'}}}),row('FL-A',48,{description:'Custom terrazzo',pdfEvidence:{metricKey:'finish:FL-A',operation:{family:'floor',sourceDescription:'Terrazzo floor'}}})];
 const r=applyBoqScope(items,takeoff,cfg());
 assert.ok(!r.items.some(i=>i.scopeDefault?.metric==='kitchen_sink_count'));
 assert.ok(!r.items.some(i=>['ceramic_floor_area','unallocated_floor_finish_area'].includes(i.scopeDefault?.metric)));
 assert.equal(r.items.find(i=>i.id==='FL-A').quantity,48);
});
test('no unsupported wall/ceiling/roof quantity invented from floor area',()=>{
 const r=applyBoqScope([],{floor_area:30},cfg());
 assert.ok(!r.items.some(i=>['plaster_area','paint_area','roof_waterproofing_area','wet_floor_waterproofing_area'].includes(i.scopeDefault.metric)));
});
test('manual edits persist across scope switches; deleted measured lines stay removed',()=>{
 const base=[row('paint_area'),row('beam_volume'),row('door_count')];
 const merged=mergeScopeBase(base,[{...base[0],rate:41},row('manual-extra',2,{source:'manual'})],['paint_area','door_count']);
 assert.deepEqual(merged.map(i=>i.id),['paint_area','beam_volume','manual-extra']);assert.equal(merged[0].rate,41);
});
test('default setting changes recompute quantities while explicit manual overrides persist',()=>{
 const initial=applyBoqScope([],takeoff,cfg());
 const lights=initial.items.find(i=>i.scopeDefault?.metric==='light_count');
 const edits=captureDefaultEdits(initial.items.map(i=>i.id===lights.id?{...i,rate:55}:i));
 const changed=applyBoqScope([],takeoff,cfg({lightsPerRoom:3}),{defaultEdits:edits});
 assert.equal(changed.items.find(i=>i.id===lights.id).quantity,12);assert.equal(changed.items.find(i=>i.id===lights.id).rate,55);
 const manual=captureDefaultEdits([{...lights,quantity:9}]);
 assert.equal(applyBoqScope([],takeoff,cfg({lightsPerRoom:3}),{defaultEdits:manual}).items.find(i=>i.id===lights.id).quantity,9);
});
test('new material never reuses old default material rate',()=>{
 const a=applyBoqScope([],takeoff,cfg({floorFinish:'ceramic'})).items.find(i=>i.scopeDefault.metric==='ceramic_floor_area');
 const edits=captureDefaultEdits([{...a,rate:100}]);
 const b=applyBoqScope([],takeoff,cfg({floorFinish:'porcelain'}),{defaultEdits:edits}).items.find(i=>i.scopeDefault.metric==='ceramic_floor_area');
 assert.equal(b.rate,0);assert.notEqual(a.id,b.id);
});
test('unclassified rows retained for classification and never silently added to total',()=>{
 const r=applyBoqScope([row('CUSTOM-XYZ',4,{description:'Unrecognised thing'})],{},cfg({defaultsEnabled:false}));
 assert.equal(r.items.length,0);assert.equal(r.excluded[0].scopeExclusion,'classification_required');assert.ok(r.report.gaps.some(g=>g.trade==='unclassified'));
 assert.equal(boqItemTrade({...r.excluded[0],boqTrade:'plumbing'}),'plumbing');
});
test('export carries selected scope and missing document warnings without changing legacy headers',()=>{
 const r=applyBoqScope([row('paint_area')],{},cfg({defaultsEnabled:false}));
 const e=buildBoqExport(r.items);assert.ok(e.summary.some(([label])=>label==='Selected BOQ scope'));
 assert.ok(e.summary.some(([label])=>label.includes('NOT FULLY MEASURED / electrical')));
 assert.equal(e.headers.length,13);
});
test('scope settings recover from shared BOQ JSON without a schema change',()=>{
 const data=new Map([['ventra:project-boq:p',JSON.stringify({boqScope:{config:cfg({preset:'renovation'})}})]]);
 const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 assert.equal(readBoqScope(storage,'p').preset,'renovation');writeBoqScope(storage,'p',cfg({preset:'fitout'}));assert.equal(readBoqScope(storage,'p').preset,'fitout');
});
test('unique matching own catalog rate only; no averaging or ambiguous selection',()=>{
 const r=applyBoqScope([],takeoff,cfg());const catalog=[{itemCode:'L1',description:'Lighting point installation',unit:'nos',rate:70}];
 const priced=priceScopeDefaults(r.items,catalog);assert.equal(priced.find(i=>i.scopeDefault.metric==='light_count').rate,70);
 const ambiguous=priceScopeDefaults(r.items,[...catalog,{...catalog[0],itemCode:'L2',rate:100}]);assert.equal(ambiguous.find(i=>i.scopeDefault.metric==='light_count').rate,0);
 const wrongUnit=priceScopeDefaults(r.items,[{...catalog[0],unit:'m'}]);assert.equal(wrongUnit.find(i=>i.scopeDefault.metric==='light_count').rate,0);
});
test('existing measured rates remain unchanged by assumption price binding',()=>{
 const i=row('light_count',30,{unit:'nos',rate:777});assert.deepEqual(priceScopeDefaults([i],[{itemCode:'L1',description:'Lighting point installation',unit:'nos',rate:70}]),[i]);
});
test('fittings included in fixture package prevent separate assumed mixer cost',()=>{
 const rows=applyBoqScope([],takeoff,cfg()).items;
 const priced=priceScopeDefaults(rows,[{itemCode:'B1',description:'Wash basin complete including mixer and fittings',unit:'nos',rate:400}]);
 const clean=removeIncludedDefaultComponents(priced);assert.ok(!clean.some(i=>i.scopeDefault.metric==='basin_tap_count'));
});
test('renovation flags missing existing/demolition plan; never guesses demolition area',()=>{
 const r=applyBoqScope([],takeoff,cfg({preset:'renovation'}));assert.ok(r.report.gaps.some(g=>g.trade==='demolition'));assert.ok(!r.items.some(i=>i.boqTrade==='demolition'));
});
test('two untagged bedrooms on one plan are two spaces; repeated sheet is not four',()=>{
 const p={pageNumber:1,page_evidence:{kind:'floor_plan',scope_id:'floor:0'},detected_items:[room('Bedroom',12),room('Bedroom',14)]};
 assert.equal(measuredRooms({page_results:[p,{...p,pageNumber:2}]}).length,2);
});
test('semantic quantity key beats incidental wall or floor material text',()=>{
 assert.equal(boqItemTrade(row('plaster_area',10,{description:'Cement plaster to block wall'})),'finishes');
 assert.equal(boqItemTrade(row('window_area',5,{description:'Window with concrete sill'})),'openings');
});
test('ceiling finish uses recorded ceiling only and screed stays an editable assumption',()=>{
 const r=applyBoqScope([],{floor_area:30,ceiling_area:25},cfg({ceilingFinish:'gypsum'}));
 assert.equal(r.items.find(i=>i.scopeDefault.metric==='gypsum_ceiling_area').quantity,25);
 assert.equal(r.items.find(i=>i.scopeDefault.metric==='screed_area').quantity,30);
 const existing=row('floor-screed',30,{description:'Floor screed 50 mm'});
 assert.ok(!applyBoqScope([existing],{floor_area:30},cfg()).items.some(i=>i.scopeDefault?.metric==='screed_area'));
});
test('deleting an assumed operation survives scope reapplication',()=>{
 const initial=applyBoqScope([],takeoff,cfg());const removed=initial.items.find(i=>i.scopeDefault.metric==='light_count');
 const edits=captureDefaultEdits(initial.items.filter(i=>i.id!==removed.id),{},initial.items.map(i=>i.id));
 assert.ok(!applyBoqScope([],takeoff,cfg(),{defaultEdits:edits}).items.some(i=>i.id===removed.id));
});
