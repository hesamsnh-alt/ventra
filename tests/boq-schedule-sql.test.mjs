import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {generateSchedule,prepareBoq} from '../src/lib/boqSchedule.mjs';
const modulePath=process.env.VENTRA_PGLITE_MODULE||'@electric-sql/pglite';
test('schedule SQL: idempotence, owner/member/viewer/outsider access, progress conflict, immutable baseline', {},async()=>{
 const {PGlite}=await import(modulePath);const db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444',project='55555555-5555-4555-8555-555555555555';
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.user_id',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated;create table public.projects(id uuid primary key,user_id uuid,name text);insert into auth.users values('${owner}'),('${member}'),('${viewer}'),('${stranger}');insert into projects values('${project}','${owner}','Test');`);
 await db.exec(readFileSync('supabase/migrations/20261006_project_control.sql','utf8'));
 const migration=readFileSync('supabase/migrations/20261007_boq_schedule_plans.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.query("insert into ventra_project_members(project_id,user_id,role) values($1,$2,'supervisor'),($1,$3,'viewer')",[project,member,viewer]);
 async function as(id){await db.exec(`reset role;set role authenticated;select set_config('request.user_id','${id}',false)`);}
 const plan=generateSchedule(prepareBoq([{description:'Wall plaster',quantity:130,unit:'m2'}]).map(r=>({...r,waitDays:2})),{start:'2026-10-05',shiftHours:8,breakHours:1,efficiency:1,weekdays:[1,2,3,4,5],holidays:[]});
 const save=(previous=null)=>db.query('select ventra_save_schedule_plan($1,$2::jsonb,$3) id',[project,JSON.stringify(plan),previous]);
 await as(owner);const pid=(await save()).rows[0].id;await assert.rejects(()=>save(),/Reload/);
 await as(viewer);assert.equal((await db.query('select * from ventra_schedule_plans')).rows.length,1);await assert.rejects(()=>save(pid),/restricted/);await assert.rejects(()=>db.query('select ventra_update_schedule_progress($1,$2,100,1)',[pid,'boq-0']),/denied/);
 await as(stranger);assert.equal((await db.query('select * from ventra_schedule_plans')).rows.length,0);assert.equal((await db.query('select * from ventra_schedule_events')).rows.length,0);await assert.rejects(()=>save(pid),/restricted/);
 await as(member);await assert.rejects(()=>db.query('update ventra_schedule_plans set revision=99'),/permission denied/);
 await db.query('select ventra_update_schedule_progress($1,$2,100,1)',[pid,'boq-0']);const updated=(await db.query('select * from ventra_schedule_plans')).rows[0];assert.equal(updated.payload.activities[0].progress,100);assert.equal(updated.payload.activities[0].end_date,plan.activities[0].end_date);assert.equal(updated.revision,2);
 await assert.rejects(()=>db.query('select ventra_update_schedule_progress($1,$2,50,1)',[pid,'boq-0']),/Another user/);await assert.rejects(()=>db.query('select ventra_update_schedule_progress($1,$2,101,2)',[pid,'boq-0']),/0 to 100/);
 assert.equal((await db.query('select * from ventra_schedule_events')).rows.length,2);
 await as(owner);await save(pid);assert.equal((await db.query('select * from ventra_schedule_plans')).rows.length,2);
 await db.exec('reset role;set role anon');await assert.rejects(()=>save(pid),/permission denied/);await db.close();
});
