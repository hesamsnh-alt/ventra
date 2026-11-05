import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import parser from '@babel/parser';
const source=readFileSync(new URL('../src/app/projects/[id]/ProjectDrawingCenter.jsx',import.meta.url),'utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const nodes=new Map();
function scan(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='FunctionDeclaration'&&['getFileExtension','validateFile'].includes(node.id?.name))nodes.set(node.id.name,node);
  if(node.type==='VariableDeclaration'&&node.declarations.some(d=>['MAX_FILE_SIZE','ACCEPTED_EXTENSIONS'].includes(d.id.name)))nodes.set(node.declarations[0].id.name,node);
  for(const [key,v] of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')scan(v);}
}
scan(ast);
const validate=new Function([...nodes.values()].map(n=>source.slice(n.start,n.end)).join('\n')+';return validateFile;')();
for(const ext of ['pdf','dwg','dxf','ifc','rvt','jpg','jpeg','png','webp']){
  test('accepts supported nonempty customer plan '+ext,()=>{
    assert.equal(validate({name:'نقشه منزل.'+ext.toUpperCase(),size:100}),null);
  });
}
test('rejects missing, unsupported, empty and oversized plans before upload',()=>{
  for(const file of [null,{name:'plan.exe',size:100},{name:'plan.pdf',size:0},{name:'plan.pdf',size:-1},{name:'plan.pdf',size:NaN},{name:'plan.pdf',size:100*1024*1024+1}])assert.ok(validate(file));
  assert.equal(validate({name:'plan.pdf',size:100*1024*1024}),null);
});
const service=readFileSync(new URL('../src/services/documentService.js',import.meta.url),'utf8');
const serviceAst=parser.parse(service,{sourceType:'module'});
const node=serviceAst.program.body.find(n=>n.declaration?.id?.name==='uploadProjectDocument').declaration;
function uploader({signedIn=true,uploadFails=false,databaseFails=false}={}){
  const operations=[];
  const supabase={auth:{getUser:async()=>{operations.push('auth');return {data:{user:signedIn?{id:'qa-owner'}:null},error:null};}},
    storage:{from:()=>({upload:async(path)=>{operations.push(['upload',path]);return uploadFails?{error:new Error('Storage unavailable')}:{data:{path}};},remove:async paths=>{operations.push(['cleanup',paths]);return {};}})},
    from:()=>({insert:payload=>({select:()=>({single:async()=>{operations.push(['record',payload]);return databaseFails?{error:new Error('Record write failed')}:{data:{id:'qa-document',...payload}};}})})})};
  const upload=new Function('supabase','BUCKET_NAME','crypto','console',service.slice(node.start,node.end)+';return uploadProjectDocument;')(supabase,'project-files',webcrypto,{error(){}});
  return {upload,operations};
}
const file={name:'نقشه .PDF',size:200,type:'application/pdf'};
test('upload saves the source and document without launching analysis',async()=>{
  const h=uploader(),r=await h.upload({projectId:'qa-project',file});
  assert.equal(r.error,null);assert.equal(r.document.status,'uploaded');assert.equal(r.document.file_name,file.name);
  assert.ok(r.document.file_path.startsWith('qa-owner/qa-project/'));assert.ok(r.document.file_path.endsWith('.pdf'));
  assert.deepEqual(h.operations.map(x=>Array.isArray(x)?x[0]:x),['auth','upload','record']);
});
test('empty source is rejected by the shared upload service without contacting auth or storage',async()=>{
  const h=uploader(),r=await h.upload({projectId:'qa-project',file:{...file,size:0}});
  assert.ok(r.error);assert.equal(r.document,null);assert.equal(h.operations.length,0);
});
test('signed-out customer receives an error without an uploaded orphan',async()=>{
  const h=uploader({signedIn:false}),r=await h.upload({projectId:'qa-project',file});
  assert.match(r.error.message,/logged in/);assert.deepEqual(h.operations,['auth']);
});
test('storage failure does not create a document record',async()=>{
  const h=uploader({uploadFails:true}),r=await h.upload({projectId:'qa-project',file});
  assert.ok(r.error);assert.ok(!h.operations.some(x=>Array.isArray(x)&&x[0]==='record'));
});
test('failed document save cleans up only the new uploaded object',async()=>{
  const h=uploader({databaseFails:true}),r=await h.upload({projectId:'qa-project',file});
  assert.ok(r.error);assert.equal(r.document,null);
  const uploaded=h.operations.find(x=>x[0]==='upload')[1],cleanup=h.operations.find(x=>x[0]==='cleanup')[1];
  assert.deepEqual(cleanup,[uploaded]);
});
