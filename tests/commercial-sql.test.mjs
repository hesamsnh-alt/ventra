import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.VENTRA_PGLITE_MODULE||'@electric-sql/pglite');
test('Complete installer is repeatable; commercial snapshots enforce member roles and revisions; usage is persistent and bounded',async()=>{
 const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',manager='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333',stranger='44444444-4444-4444-8444-444444444444',project='55555555-5555-4555-8555-555555555555';
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.user_id',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated;create table public.projects(id uuid primary key,user_id uuid,name text);insert into auth.users values('${owner}'),('${manager}'),('${viewer}'),('${stranger}');insert into projects values('${project}','${owner}','Test');create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 const sql=readFileSync('scripts/INSTALL-VENTRA-v44.sql','utf8');await db.exec(sql);await db.exec(sql);
 const releaseSql=readFileSync('supabase/migrations/20261011_release_failed_analysis.sql','utf8');await db.exec(releaseSql);await db.exec(releaseSql);
 await db.query("insert into ventra_project_members(project_id,user_id,role) values($1,$2,'manager'),($1,$3,'viewer')",[project,manager,viewer]);
 async function as(id){await db.exec(`reset role;set role authenticated;select set_config('request.user_id','${id}',false)`);}
 const save=(revision)=>db.query('select ventra_save_commercial($1,$2::jsonb,$3) result',[project,JSON.stringify({boq:{projectId:project,items:[]}}),revision]);
 await as(owner);assert.equal((await save(0)).rows[0].result.revision,1);await as(manager);assert.equal((await save(1)).rows[0].result.revision,2);await assert.rejects(()=>save(1),/CONFLICT/);
 await as(viewer);assert.equal((await db.query('select * from ventra_commercial_snapshots')).rows.length,1);await assert.rejects(()=>save(2),/edit access/);await as(stranger);assert.equal((await db.query('select * from ventra_commercial_snapshots')).rows.length,0);await assert.rejects(()=>save(2),/edit access/);
 await db.exec('reset role;set role service_role');const consume=id=>db.query('select ventra_consume_analysis($1,$2,$3,$4,$5,$6,$7) r',[owner,owner,project,'drawing',id,'a'.repeat(64),2]);
 assert.equal((await consume('first')).rows[0].r.accepted,true);assert.equal((await consume('first')).rows[0].r.duplicate,true);assert.equal((await consume('second')).rows[0].r.used,2);assert.equal((await consume('third')).rows[0].r.accepted,false);
 const release=hash=>db.query('select ventra_release_analysis($1,$2,$3,$4,$5,$6) r',[owner,owner,project,'drawing','first',hash]);
 assert.equal((await release('b'.repeat(64))).rows[0].r,false);
 assert.equal((await consume('third')).rows[0].r.accepted,false);
 assert.equal((await release('a'.repeat(64))).rows[0].r,true);
 assert.equal((await release('a'.repeat(64))).rows[0].r,false);
 assert.equal((await consume('third')).rows[0].r.accepted,true);
 await as(owner);await assert.rejects(()=>release('a'.repeat(64)),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>save(2),/permission denied/);await assert.rejects(()=>consume('fourth'),/permission denied/);await assert.rejects(()=>release('a'.repeat(64)),/permission denied/);await db.close();
});
