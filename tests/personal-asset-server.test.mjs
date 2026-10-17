import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';import sharp from 'sharp';import {modelGlb} from './fixtures/personal-model-glb.mjs';
fs.mkdirSync('tmp',{recursive:true});
await build({entryPoints:['src/lib/serverPersonalAssets.js'],bundle:true,platform:'node',format:'esm',outfile:'tmp/personal-asset-server-tests.mjs',packages:'external',plugins:[{name:'isolated-auth',setup(b){
 b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));
 b.onResolve({filter:/serverBilling$/},()=>({path:'billing',namespace:'mock'}));b.onResolve({filter:/serverCommercial$/},()=>({path:'commercial',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='billing'?`export async function account(request){const id=request.headers.get('x-user');if(!id)throw Object.assign(new Error('Sign in'),{status:401});return{id};}`:a.path==='commercial'?`export const commercialAdmin=()=>globalThis.__assetTest.db;export async function commercialContext(request,projectId,user){if(!globalThis.__assetTest.tables.projects.some(p=>p.id===projectId&&p.user_id===user.id))throw Object.assign(new Error('Denied'),{status:403});return {db:commercialAdmin()};}`:'',loader:'js'}));
}}]});
const server=await import('../tmp/personal-asset-server-tests.mjs');
const user='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',projectId='20000000-0000-4000-8000-000000000001';
const request=(who=user)=>new Request('https://ventra.test/api/personal-assets',{headers:who?{'x-user':who}:{}});
let imageUrl;imageUrl='data:image/jpeg;base64,'+(await sharp({create:{width:64,height:64,channels:3,background:'#888888'}}).jpeg().toBuffer()).toString('base64');
function setup(){
 const tables={projects:[{id:projectId,user_id:user}],ventra_personal_assets:[],ventra_model_jobs:[],ventra_project_asset_links:[],ventra_project_members:[]},files=new Map();let posts=0,gets=0,task='PENDING',throwPost=false,glb=modelGlb(),failSave=false;
 function from(name){let mode='select',value,filters=[],single=false,limit=Infinity,sort;
 const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(k){sort=k;return q;},limit(n){limit=n;return q;},maybeSingle(){single=true;return q;},insert(v){mode='insert';value=v;return q;},upsert(v){mode='upsert';value=v;return q;},update(v){mode='update';value=v;return q;},then(resolve,reject){try{
 if(name==='ventra_personal_assets'&&failSave&&mode==='upsert')return resolve({error:{message:'offline'}});
 let rows=tables[name].filter(r=>filters.every(f=>f(r)));
 if(mode==='insert'){rows=[{created_at:new Date().toISOString(),...value}];tables[name].push(...rows);}
 if(mode==='upsert'){const match=tables[name].find(r=>value.id?r.id===value.id:r.project_id===value.project_id&&r.asset_id===value.asset_id);if(match){Object.assign(match,value);rows=[match];}else{rows=[{created_at:new Date().toISOString(),...value}];tables[name].push(...rows);}}
 if(mode==='update')rows.forEach(r=>Object.assign(r,value));if(sort)rows=rows.sort((a,b)=>String(b[sort]).localeCompare(String(a[sort])));rows=rows.slice(0,limit);resolve({data:single?rows[0]||null:rows,error:null});
 }catch(e){reject(e);}}};return q;
 }
 const storage={createSignedUploadUrl:async path=>({data:{signedUrl:'https://storage.test/upload/'+path}}),download:async path=>files.has(path)?{data:new Blob([files.get(path)])}:{error:{message:'missing'}},upload:async(path,bytes,options)=>{if(!options.upsert&&files.has(path))return{error:{message:'exists'}};files.set(path,bytes);return{data:{path}};},createSignedUrl:async path=>({data:{signedUrl:'https://storage.test/'+path}}),remove:async paths=>{paths.forEach(p=>files.delete(p));return{data:[]};}};
 const db={from,storage:{getBucket:async()=>({data:{public:false}}),from:()=>storage},rpc:async(name,p)=>{
 const old=tables.ventra_model_jobs.find(j=>j.user_id===p.p_user&&j.image_hash===p.p_hash);if(old)return{data:{created:false,job:{...old}}};
 if(tables.ventra_model_jobs.filter(j=>j.user_id===p.p_user).length>=p.p_limit||tables.ventra_model_jobs.some(j=>j.user_id===p.p_user&&['submitting','pending','unknown'].includes(j.status)))return{error:{code:'P0001',message:'Daily or pending job limit reached'}};
 const job={id:crypto.randomUUID(),user_id:p.p_user,project_id:p.p_project,image_hash:p.p_hash,name:p.p_name,furniture_type:p.p_type,width:p.p_width,depth:p.p_depth,height:p.p_height,status:'submitting',created_at:new Date().toISOString(),progress:0};tables.ventra_model_jobs.push(job);return{data:{created:true,job:{...job}}};}};
 const original=globalThis.fetch;globalThis.fetch=async(url,o)=>{
 if(String(url).startsWith('https://api.meshy.ai')){if(o.method==='POST'){posts++;if(throwPost)throw Error('network');return Response.json({result:'provider-test'});}gets++;return Response.json({status:task,progress:25,model_urls:{glb:'https://assets.meshy.ai/model.glb'},consumed_credits:30});}
 if(String(url)==='https://assets.meshy.ai/model.glb')return new Response(glb);throw Error('No external fetch is allowed in this test.');
 };
 globalThis.__assetTest={db,tables};process.env.MESHY_API_KEY='test-only-not-a-real-key';process.env.MESHY_GENERATION_ENABLED='true';
 return {tables,files,get posts(){return posts;},get gets(){return gets;},set task(v){task=v;},set throwPost(v){throwPost=v;},set failSave(v){failSave=v;},set glb(v){glb=v;},restore(){globalThis.fetch=original;delete globalThis.__assetTest;delete process.env.MESHY_API_KEY;delete process.env.MESHY_GENERATION_ENABLED;}};
}
const body=()=>({projectId,imageUrl,name:'Photo chair',furniture_type:'chair'});
test('photo POST → resumable polling → GLB in private library; duplicate photos never create another provider task',async()=>{
 const h=setup();try{
 const first=await server.startFurnitureModel(request(),body()),again=await server.startFurnitureModel(request(),body());assert.equal(first.job.id,again.job.id);assert.equal(h.posts,1);assert.equal(h.tables.ventra_model_jobs.length,1);
 assert.equal((await server.pollFurnitureModel(request(),first.job.id)).job.progress,25);h.task='SUCCEEDED';const done=await server.pollFurnitureModel(request(),first.job.id);assert.equal(done.job.status,'ready');assert.equal(h.posts,1);assert.equal(done.asset.width,1.5);assert.equal(done.asset.depth,.75);
 assert.ok(h.files.has(user+'/'+first.job.id+'/model.glb'));const library=await server.libraryList(request());assert.equal(library.assets.length,1);assert.ok(!JSON.stringify(h.tables).includes('https://assets.meshy.ai'));
 const gets=h.gets;await server.pollFurnitureModel(request(),first.job.id);assert.equal(h.gets,gets);assert.equal(h.posts,1);
 }finally{h.restore();}
});
test('authentication and asset ownership block foreign reads, polling, edits and project linking',async()=>{
 const h=setup();try{
 await assert.rejects(server.startFurnitureModel(request(null),body()),{status:401});assert.equal(h.posts,0);
 const first=await server.startFurnitureModel(request(),body());await assert.rejects(server.pollFurnitureModel(request(foreign),first.job.id),{status:404});
 h.task='SUCCEEDED';const {asset}=await server.pollFurnitureModel(request(),first.job.id);assert.equal((await server.libraryList(request(foreign))).assets.length,0);
 await assert.rejects(server.libraryAsset(request(foreign),asset.id,projectId),{status:403});await assert.rejects(server.editLibraryAsset(request(foreign),{assetId:asset.id,name:'Foreign'}),{status:404});
 await assert.rejects(server.linkLibraryAsset(request(foreign),{assetId:asset.id,projectId}),{status:403});
 await server.linkLibraryAsset(request(),{assetId:asset.id,projectId});h.tables.ventra_project_members.push({project_id:projectId,user_id:foreign,role:'viewer'});
 assert.ok((await server.libraryAsset(request(foreign),asset.id,projectId)).url);await assert.rejects(server.linkLibraryAsset(request(foreign),{assetId:asset.id,projectId}),{status:403});
 }finally{h.restore();}
});
test('uncertain paid POST is recorded and never replayed by a duplicate upload or refresh',async()=>{
 const h=setup();try{h.throwPost=true;await assert.rejects(server.startFurnitureModel(request(),body()),{code:'MODEL_SUBMISSION_UNKNOWN'});assert.equal(h.tables.ventra_model_jobs[0].status,'unknown');const same=await server.startFurnitureModel(request(),body());assert.equal(same.job.status,'unknown');await server.libraryList(request());assert.equal(h.posts,1);}finally{h.restore();}
});
test('a completed provider model survives a storage failure; polling again only retries delivery, never generation',async()=>{
 const h=setup();try{const first=await server.startFurnitureModel(request(),body());h.task='SUCCEEDED';h.failSave=true;await assert.rejects(server.pollFurnitureModel(request(),first.job.id));assert.equal(h.tables.ventra_model_jobs[0].status,'pending');h.failSave=false;assert.equal((await server.pollFurnitureModel(request(),first.job.id)).job.status,'ready');assert.equal(h.posts,1);}finally{h.restore();}
});
test('invalid uploads and disabled generation stop before a paid provider call; materials use no model credits',async()=>{
 const h=setup();try{delete process.env.MESHY_GENERATION_ENABLED;await assert.rejects(server.startFurnitureModel(request(),body()),{code:'MODEL_NOT_CONFIGURED'});assert.equal(h.posts,0);process.env.MESHY_GENERATION_ENABLED='true';await assert.rejects(server.startFurnitureModel(request(),{...body(),imageUrl:'https://private.test/image.png'}),{status:400});
 const saved=await server.uploadLibraryMaterial(request(),body());assert.equal(saved.asset.kind,'material');assert.equal(h.posts,0);assert.equal(h.tables.ventra_model_jobs.length,0);assert.ok(h.files.has(user+'/'+saved.asset.id+'/texture.png'));
 }finally{h.restore();}
});
test('unsafe generated GLB is not published or accepted as a normal model',async()=>{
 const h=setup();try{const first=await server.startFurnitureModel(request(),body());h.task='SUCCEEDED';h.glb=modelGlb(d=>d.images=[{uri:'https://evil.test/a.png'}]);await assert.rejects(server.pollFurnitureModel(request(),first.job.id),{status:422});assert.equal(h.tables.ventra_personal_assets.length,0);assert.equal(h.tables.ventra_model_jobs[0].status,'failed');assert.equal(h.posts,1);}finally{h.restore();}
});

test('ready GLB import skips Meshy, validates file, persists proportions and deduplicates finalization',async()=>{
 const h=setup();try{delete process.env.MESHY_API_KEY;delete process.env.MESHY_GENERATION_ENABLED;
 const begun=await server.beginLibraryGlbUpload(request(),{projectId,size:modelGlb().length});assert.ok(begun.uploadUrl.includes(user+'/'+begun.assetId+'/model.glb'));
 h.files.set(user+'/'+begun.assetId+'/model.glb',modelGlb());const body={projectId,assetId:begun.assetId,name:'iPhone scan',furniture_type:'cabinet'};
 const result=await server.finishLibraryGlbUpload(request(),body);assert.equal(result.asset.kind,'model');assert.equal(result.asset.name,'iPhone scan');assert.equal(result.asset.width,1.5);assert.equal((await server.finishLibraryGlbUpload(request(),body)).asset.id,result.asset.id);assert.equal(h.tables.ventra_personal_assets.length,1);assert.equal(h.posts,0);
 }finally{h.restore();}
});
test('GLB import blocks foreign projects/assets, oversized or malformed files before publication',async()=>{
 const h=setup();try{
 await assert.rejects(server.beginLibraryGlbUpload(request(foreign),{projectId,size:100}),{status:403});await assert.rejects(server.beginLibraryGlbUpload(request(),{projectId,size:26*1024*1024}),{status:413});
 const begun=await server.beginLibraryGlbUpload(request(),{projectId,size:100});const path=user+'/'+begun.assetId+'/model.glb';h.files.set(path,new Uint8Array(100));await assert.rejects(server.finishLibraryGlbUpload(request(),{projectId,assetId:begun.assetId}),{status:422});assert.equal(h.files.has(path),false);assert.equal(h.tables.ventra_personal_assets.length,0);assert.equal(h.posts,0);
 }finally{h.restore();}
});
