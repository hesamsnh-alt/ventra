import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync('supabase/migrations/20261018102427_material_selection_boards.sql','utf8'),project='55555555-5555-4555-8555-555555555555';
test('selection schema isolates all client roles and accepts immutable reviews atomically with stale-version protection',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.projects(id uuid primary key);insert into projects values('${project}');`);await db.exec(sql);await db.exec(sql);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const table of ['ventra_selection_boards','ventra_selection_shares']){await assert.rejects(()=>db.query('select * from '+table),/permission denied/);}await assert.rejects(()=>db.query("select ventra_decide_selection('x','approved','Client')"),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');const draft={title:'Test',rows:[]},snap={draft,amounts:{total:517000}};
 await db.query('insert into ventra_selection_boards(project_id,document) values($1,$2)',[project,{draft,baseline:null}]);
 const insert=async(hash,revision=1,extra={})=>{await db.query('insert into ventra_selection_shares(project_id,board_revision,token_hash,snapshot,expires_at,revoked) values($1,$2,$3,$4,$5,$6)',[project,revision,hash,snap,extra.expiry||new Date(Date.now()+86400000),extra.revoked||false]);};
 const decide=async(hash,decision='approved',name='Client')=>(await db.query('select ventra_decide_selection($1,$2,$3) as result',[hash,decision,name])).rows[0].result;
 await insert('a'.repeat(64));assert.equal((await decide('a'.repeat(64))).decision,'approved');let board=(await db.query('select * from ventra_selection_boards')).rows[0];assert.equal(board.revision,2);assert.equal(board.document.baseline.amounts.total,517000);assert.equal(board.document.approval.name,'Client');
 assert.equal((await decide('a'.repeat(64))).decision,'approved');assert.equal((await db.query('select revision from ventra_selection_boards')).rows[0].revision,2);assert.equal((await decide('a'.repeat(64),'rejected')).error,'decided');
 await insert('b'.repeat(64),1);assert.equal((await decide('b'.repeat(64))).error,'stale');assert.equal((await db.query("select decision from ventra_selection_shares where token_hash=$1",['b'.repeat(64)])).rows[0].decision,'pending');
 await insert('c'.repeat(64),2,{revoked:true});assert.equal((await decide('c'.repeat(64))).error,'unavailable');await insert('d'.repeat(64),2,{expiry:new Date(Date.now()-1000)});assert.equal((await decide('d'.repeat(64))).error,'unavailable');
 await insert('e'.repeat(64),2);assert.equal((await decide('e'.repeat(64),'rejected')).decision,'rejected');assert.equal((await db.query('select revision from ventra_selection_boards')).rows[0].revision,2);assert.equal((await decide('e'.repeat(64),'approved')).error,'decided');
 await insert('f'.repeat(64),2);await db.query('update ventra_selection_boards set revision=3 where project_id=$1',[project]);assert.equal((await decide('f'.repeat(64))).error,'stale');
 assert.equal((await decide('1'.repeat(64))).error,'unavailable');assert.equal((await decide('a'.repeat(64),'bad')).error,'invalid');
 await db.exec('reset role');const def=(await db.query("select prosecdef,proconfig from pg_proc where proname='ventra_decide_selection'")).rows[0];assert.equal(def.prosecdef,false);assert.ok(def.proconfig.includes('search_path=""'));
 }finally{await db.close();}
});
