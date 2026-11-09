import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {pixelClassificationViewLayout,pixelClassificationOverlay,pixelClassificationDetailViews} from '../src/lib/rasterClassificationViews.mjs';

function graph({width=600,height=800,count=488}={}){
 const kinds=['stroke','solid_band','face_pair','stroke_fragment'];
 const candidates=Array.from({length:count},(_,i)=>{
  const kind=kinds[i%4],x=10+(i*31)%(width-40),y=10+(i*37)%(height-40);
  return{id:'candidate'+i,kind,start:{x,y},end:{x:Math.min(width-2,x+16),y:Math.min(height-2,y+8)},sourceIds:['ink'+i]};
 });
 return{imageWidth:width,imageHeight:height,candidates,gaps:[]};
}
test('view count is bounded with 488 candidates',()=>{
 assert.ok(pixelClassificationViewLayout(graph()).length<=6);
});
test('all candidate IDs are covered in one or more evidence images',()=>{
 const g=graph(),ids=new Set(pixelClassificationViewLayout(g).flatMap(v=>v.candidateIds));
 assert.equal(ids.size,g.candidates.length);
});
test('no candidate geometry mutates during view layout',()=>{
 const g=graph(),before=JSON.stringify(g);
 pixelClassificationViewLayout(g);
 assert.equal(JSON.stringify(g),before);
});
test('views preserve original full image coordinate frame',()=>{
 const g=graph(),views=pixelClassificationViewLayout(g);
 for(const v of views){
  assert.ok(v.viewport.left>=0&&v.viewport.top>=0);
  assert.ok(v.viewport.right<=g.imageWidth&&v.viewport.bottom<=g.imageHeight);
  assert.ok(v.viewport.right>v.viewport.left&&v.viewport.bottom>v.viewport.top);
 }
});
test('portrait and landscape plans produce covered candidate views',()=>{
 for(const [width,height] of [[600,800],[800,600],[500,500]]){
  const g=graph({width,height}),views=pixelClassificationViewLayout(g);
  assert.equal(new Set(views.flatMap(v=>v.candidateIds)).size,g.candidates.length);
  assert.ok(views.length<=6);
 }
});
test('small plans do not require split detail views',()=>{
 const g=graph({count:8});
 assert.ok(pixelClassificationViewLayout(g).length<=4);
});
test('overlay contains source IDs but never replaces the image',()=>{
 const g=graph({count:20}),view=pixelClassificationViewLayout(g)[0],svg=pixelClassificationOverlay(g,view);
 assert.match(svg,/viewBox="0 0 600 800"/);
 for(const id of view.candidateIds)assert.ok(svg.includes(id));
 assert.ok(!svg.includes('<image'));
});
test('overlay escapes metadata to keep SVG valid',()=>{
 const g=graph({count:1});g.candidates[0].id='danger<&>';
 const svg=pixelClassificationOverlay(g,pixelClassificationViewLayout(g)[0]);
 assert.ok(svg.includes('danger&lt;&amp;&gt;'));
});
test('generated detail crops are valid JPEG images without any OpenAI call',async()=>{
 const g=graph({width:320,height:420,count:32});
 const source=await sharp({create:{width:320,height:420,channels:3,background:'#fff'}}).jpeg().toBuffer();
 const views=pixelClassificationViewLayout(g),images=await pixelClassificationDetailViews(source,g,views);
 assert.equal(images.length,views.length);
 for(let i=0;i<images.length;i++){
  assert.match(images[i],/^data:image\/jpeg;base64,/);
  const b=Buffer.from(images[i].slice('data:image/jpeg;base64,'.length),'base64');
  const meta=await sharp(b).metadata();
  assert.equal(meta.format,'jpeg');
  assert.equal(meta.width,views[i].viewport.right-views[i].viewport.left);
  assert.equal(meta.height,views[i].viewport.bottom-views[i].viewport.top);
 }
});
test('zero candidates creates no detailed crop request',async()=>{
 const g=graph({count:0});
 assert.deepEqual(pixelClassificationViewLayout(g),[]);
 assert.deepEqual(await pixelClassificationDetailViews(Buffer.alloc(0),g,[]),[]);
});
test('invalid source pixel frame is rejected before image work',()=>{
 assert.throws(()=>pixelClassificationViewLayout({imageWidth:0,imageHeight:200,candidates:[]}),/Invalid pixel graph frame/);
});
