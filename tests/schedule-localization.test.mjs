import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '@babel/parser';
import {TRADES,methodsFor,SOURCES,prepareBoq,generateSchedule} from '../src/lib/boqSchedule.mjs';
import {translateText} from '../src/lib/i18n/translate.mjs';
import {localizeScheduleError} from '../src/lib/scheduleLocalization.mjs';
for(const lang of ['fa','ar']){
 test(`${lang}: every trade, method and explanatory note has a translation`,()=>{
  for(const text of [...TRADES.map(t=>t.label),...TRADES.flatMap(t=>methodsFor(t.id).flatMap(m=>[m.label,m.note])),...SOURCES.map(s=>s.label)]){
   assert.notEqual(translateText(text,lang),text,text);
  }
 });
 test(`${lang}: schedule fields and controls are translated, including conditional sections`,()=>{
  const ast=parse(fs.readFileSync(new URL('../src/app/projects/[id]/ProjectTimeline.jsx',import.meta.url),'utf8'),{sourceType:'module',plugins:['jsx']});
  function walk(n){
   if(!n||typeof n!=='object')return;
   let text=n.type==='JSXText'?n.value.replace(/\s+/g,' ').trim():null;
   if(n.type==='JSXAttribute'&&['placeholder','title','aria-label'].includes(n.name?.name)&&n.value?.type==='StringLiteral')text=n.value.value;
   if(text&&/[a-z]/i.test(text)&&!/^[\d-]+(?:, [\d-]+)*$/.test(text))assert.notEqual(translateText(text,lang),text,text);
   for(const [k,v] of Object.entries(n)){if(['loc','start','end'].includes(k))continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
  }walk(ast);
 });
 test(`${lang}: interpolated labels retain project data and translate the surrounding text`,()=>{
  for(const text of ['All BOQ sections (23)','BOQ quantity (m3)','Confirmed output (m2 / crew / productive hour)','12 working days','47% planned crew-effort complete','4/9 activities done','2 excluded BOQ items','3 need attention','+ 7 calendar days release wait','34.50 m2/day','Expected 40%','5 calendar days overdue','Excluded scope (3)'])assert.notEqual(translateText(text,lang),text,text);
  const name='CLIENT-XYZ 施工';assert.ok(translateText(`After ${name}`,lang).includes(name));
  const rows=prepareBoq([{id:1,description:name,quantity:9,unit:'m2'}]);assert.equal(rows[0].name,name);
  assert.notEqual(translateText(rows[0].crewNote,lang),rows[0].crewNote);
 });
 test(`${lang}: missing productivity produces a localized error without renaming the source item`,()=>{
  const rows=prepareBoq([{id:1,description:'Blockwork TEST-204',quantity:9,unit:'m2'}]);
  let message;try{generateSchedule(rows,{start:'2026-10-12',shiftHours:8,breakHours:1,efficiency:0.85,weekdays:[1,2,3,4,5],holidays:[]});}catch(e){message=e.message;}
  assert.ok(message);const result=localizeScheduleError(message,lang);assert.ok(result.includes(rows[0].name));assert.ok(!result.includes('hourly rate'));assert.ok(!result.includes('enter a number'));
 });
}
