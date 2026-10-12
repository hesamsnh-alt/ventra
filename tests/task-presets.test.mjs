import test from 'node:test';import assert from 'node:assert/strict';
import {TASK_ROLES,TASK_PRESETS,TASK_GROUPS,taskPresetDraft} from '../src/lib/taskPresets.mjs';
import {translateText} from '../src/lib/i18n/translate.mjs';
test('all templates reference real roles and supported priorities; IDs are unique',()=>{
 assert.equal(new Set(TASK_PRESETS.map(p=>p.id)).size,TASK_PRESETS.length);assert.equal(new Set(TASK_ROLES.map(p=>p.id)).size,TASK_ROLES.length);
 for(const p of TASK_PRESETS){assert.ok(TASK_GROUPS.includes(p.group));assert.ok(TASK_ROLES.some(r=>r.id===p.role));assert.ok(['Low','Medium','High'].includes(p.priority));}
});
for(const lang of ['en','fa','ar'])test(`${lang}: template selects readable task, responsible role and priority, all within database limits`,()=>{
 for(const p of TASK_PRESETS){const draft=taskPresetDraft(p.id,lang);assert.equal(draft.title,translateText(p.title,lang));assert.ok(draft.title.length<=200);assert.ok(draft.assignee.length<=100);assert.equal(draft.priority,p.priority);if(lang!=='en'){assert.notEqual(draft.title,p.title);assert.notEqual(draft.assignee,TASK_ROLES.find(r=>r.id===p.role).label);}}
 for(const text of [...TASK_ROLES.map(r=>r.label),...TASK_GROUPS])if(lang!=='en')assert.notEqual(translateText(text,lang),text);
});
test('draft is independently editable and never mutates defaults',()=>{
 const before=JSON.stringify(TASK_PRESETS);const first=taskPresetDraft('rebar','fa');first.title='بازرسی ستون محور A';first.assignee='مهندس احمدی';first.priority='Low';assert.notEqual(taskPresetDraft('rebar','fa').title,first.title);assert.equal(JSON.stringify(TASK_PRESETS),before);assert.equal(taskPresetDraft('manual','fa'),null);
});
// Exercise the actual submit handler to ensure manual edits are saved, rather
// than a preset ID or a retranslated title.
test('task form saves the final edited draft once, and does not save while busy',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm'),parser=await import('@babel/parser'),source=fs.readFileSync('src/app/projects/[id]/ProjectTasks.jsx','utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let fn;function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name==='add')fn=n;for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(ast);
 const draft={title:'Manual/custom task',assignee:'Engineer Ali',priority:'High'},calls=[];
 const context=vm.createContext({draft,projectId:'p',saving:false,canEdit:true,createTask:async(p,d)=>{calls.push({p,d});return{data:{id:'saved',...d}};},setSaving:v=>{context.saving=v;},setError(){},setTasks(){},setOpen(){},setDraft(){},setPresetId(){},setRoleId(){},emptyDraft:()=>({})});vm.runInContext(source.slice(fn.start,fn.end),context);await context.add({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].d,draft);context.saving=true;await context.add({preventDefault(){}});assert.equal(calls.length,1);
});
