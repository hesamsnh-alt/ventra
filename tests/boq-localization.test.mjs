import test from 'node:test';import assert from 'node:assert/strict';
import {localizeBoqText,missingBoqTranslations,validateBoqTranslations} from '../src/lib/boqLocalization.mjs';
import {buildBoqExport} from '../src/lib/boqExport.mjs';
const source=[{id:'x',itemNumber:'01',section:'Concrete Works',description:'Reinforced concrete grade C25 excluding reinforcement and formwork',unit:'m³',quantity:4.21,rate:400,status:'verified',review:{confirmed:true},quantityBasis:'Measured geometry',notes:''}];
test('Persian and Arabic BOQ display translate engineering scope, preserve exclusions and grade',()=>{
 for(const lang of ['fa','ar']){const text=localizeBoqText(source[0].description,lang);assert.notEqual(text,source[0].description);assert.ok(text.includes('C25'));assert.notEqual(localizeBoqText('Concrete Works',lang),'Concrete Works');}
 assert.equal(localizeBoqText(source[0].description,'en'),source[0].description);
});
test('localized export changes display labels only, not source records or amounts',()=>{
 const before=JSON.stringify(source),original=buildBoqExport(source,{vatPercentage:5}),fa=buildBoqExport(source,{vatPercentage:5},{language:'fa'}),ar=buildBoqExport(source,{vatPercentage:5},{language:'ar'});
 for(const output of [fa,ar]){assert.notEqual(output.headers[2],original.headers[2]);assert.notEqual(output.rows[0][2],original.rows[0][2]);assert.deepEqual(output.rows[0].slice(4,7),original.rows[0].slice(4,7));assert.deepEqual(output.sums,original.sums);assert.deepEqual(output.summary.map(r=>r[1]),original.summary.map(r=>r[1]));}
 assert.equal(JSON.stringify(source),before);
});
test('project-specific descriptions use exact original text keys and untranslated custom data stays visible',()=>{
 const custom='Project-specific partition 120mm';assert.deepEqual(missingBoqTranslations([custom,custom,'Concrete Works'],'fa'),[custom]);const map=validateBoqTranslations([custom],[{id:0,translation:'تیغه اختصاصی پروژه 120 میلی‌متر'}]);assert.equal(localizeBoqText(custom,'fa',map),map[custom]);assert.equal(localizeBoqText(custom,'en',map),custom);assert.deepEqual(missingBoqTranslations([custom],'fa',map),[]);
});
test('partial, duplicate, invalid and numerically altered translations are rejected atomically',()=>{
 for(const entries of [[],[{id:0,translation:'بتن C30 به ضخامت 120mm'}],[{id:1,translation:'بتن C25 به ضخامت 120mm'}],[{id:0,translation:'بتن C25 به ضخامت 150mm'}]])assert.throws(()=>validateBoqTranslations(['Concrete C25 120mm'],entries));
 assert.throws(()=>validateBoqTranslations(['First','Second'],[{id:0,translation:'اول'},{id:0,translation:'دوم'}]));
});
test('AI route is authenticated and metered through the existing commercial guard',async()=>{
 const fs=await import('node:fs'),source=fs.readFileSync('src/app/api/ai/boq-translation/route.js','utf8');assert.match(source,/commercialRun\(request,'boq',translate\)/);assert.match(source,/validateBoqTranslations\(texts,parsed.entries\)/);assert.ok(!source.includes('NEXT_PUBLIC_OPENAI'));
});
