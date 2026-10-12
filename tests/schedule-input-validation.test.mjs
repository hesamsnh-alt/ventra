import test from 'node:test';import assert from 'node:assert/strict';
import {prepareBoq,methodDays,generateSchedule,validateScheduleUnit,unitOf} from '../src/lib/boqSchedule.mjs';
import {translateText} from '../src/lib/i18n/translate.mjs';
const calendar={start:'2026-10-12',shiftHours:8,breakHours:1,efficiency:0.85,weekdays:[1,2,3,4,5],holidays:[]};
const base=()=>({...prepareBoq([{description:'Excavation',quantity:100,unit:'m3'}])[0],rate:10,crews:2,waitDays:0});
test('screenshot: a lump-sum site setup cannot be compared as excavator output',()=>{
 const source={description:'Mobilization and demobilization of site facilities',quantity:1,unit:'lump_sum'};
 const record=prepareBoq([source])[0];assert.equal(record.trade,'prelim');assert.equal(record.method,'site');assert.equal(record.unit,'ls');assert.equal(source.unit,'lump_sum');
 assert.throws(()=>methodDays(1,0.000001,3,calendar,{trade:'excavation',unit:'lump_sum'}),/Excavation requires m³/);
 assert.throws(()=>generateSchedule([{...record,trade:'excavation',method:'excavator',rate:0.000001,crews:3,waitDays:5}],calendar),/Excavation requires m³/);
});
test('huge durations are blocked in both method comparison and schedule generation',()=>{
 assert.throws(()=>methodDays(1,0.000001,3,calendar,{trade:'excavation',unit:'m3'}),/ten years/);
 assert.throws(()=>generateSchedule([{...base(),quantity:1,rate:0.000001,crews:3}],calendar),/ten years/);
});
test('valid excavation uses measured volume, verified capacity and complete crews',()=>{
 assert.equal(methodDays(100,10,2,calendar,{trade:'excavation',unit:'m³'}),1);
 const p=generateSchedule([base()],calendar);assert.equal(p.activities[0].workingDays,1);assert.equal(p.activities[0].dailyCapacity,119);
});
test('changing trade invalidates its previous method and rejects fractional teams',()=>{
 assert.throws(()=>generateSchedule([{...base(),method:'site'}],calendar),/execution method/);
 assert.throws(()=>methodDays(100,10,1.5,calendar,{trade:'excavation',unit:'m3'}),/whole numbers/);
});
test('lump sum remains available for genuinely reviewed site setup work',()=>{
 assert.equal(unitOf('LUMP SUM'),'ls');validateScheduleUnit('prelim','lump_sum');
 const row={...prepareBoq([{description:'تجهیز کارگاه',quantity:1,unit:'lump_sum'}])[0],rate:1/11.9,waitDays:0};
 assert.equal(generateSchedule([row],calendar).activities[0].workingDays,2);
});
test('unit and duration errors are understandable in both supported RTL languages',()=>{
 for(const lang of ['fa','ar'])for(const text of ['Excavation requires m³; this row uses ls. Review the BOQ quantity and trade.','Backfill requires m³; this row uses item. Review the BOQ quantity and trade.','Duration exceeds ten years; review quantity, unit and hourly output.','Choose an execution method for the selected trade.'])assert.notEqual(translateText(text,lang),text);
});
