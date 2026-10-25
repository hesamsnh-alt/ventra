import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import parser from '@babel/parser';
test('all 63 existing viewer, furniture and render buttons retain their original click handlers',()=>{
 for(const [file,count,hash] of [
  ['Project3DViewer.jsx',48,'e0c125a6a9ceba32f5e5eee4b4538805af4818686798f6532fdc1699eb699211'],
  ['FurnitureEditorPanel.jsx',13,'8cdbb1fb685814fef0c6d8e875cf0e4895e3e3be8f7b06d7effe6d78b1afecc1'],
  ['PlanRenderPanel.jsx',2,'57b966f2577d4157446aa5ae91e4571a286be25fe3870f70ca643e7d4119e69e'],
 ]){
  const source=readFileSync(`src/app/projects/[id]/${file}`,'utf8'),ast=parser.parse(source,{sourceType:'module',plugins:['jsx']}),buttons=[];
  function walk(node){if(!node||typeof node!=='object')return;
   if(node.type==='JSXOpeningElement'&&(node.name.name==='button'||node.attributes.some(a=>a.name?.name==='as'&&a.value?.value==='button'))){if(node.attributes.some(a=>a.name?.name==='data-model-tool'))return;const handler=node.attributes.find(a=>a.name?.name==='onClick');const text=handler?source.slice(handler.start,handler.end).replace(/\s/g,'').replace('onClick={()=>reconstruct3D()}','onClick={reconstruct3D}').replace('onClick={cameraMode}',"onClick={()=>setMode('camera')}").replace("onClick={()=>save({kind:'remove-many',assetIds:selectedIds})}","onClick={()=>save({kind:'remove',assetId:selected})}").replaceAll('isInteriorSource(active3DSource)','active3DSource==="schematic"'):'none';if(!text.includes('openDwgInterior')&&!text.includes('saveOpening')&&!text.includes("setMode('opening')"))buttons.push(text);}
   for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }walk(ast);assert.equal(buttons.length,count,file);assert.equal(createHash('sha256').update(buttons.sort().join('\n')).digest('hex'),hash,file);
 }
});
test('native drawers default closed, keep controls mounted and use the three UI languages',async()=>{
 const {createRequire}=await import('node:module'),{loadComponent}=await import('./render-runtime.mjs');const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const language=await loadComponent('src/app/components/i18n/LanguageProvider.jsx'),drawer=await loadComponent('src/app/projects/[id]/ToolDrawer.jsx');
 for(const [locale,label] of [['en','More tools'],['fa','ابزارهای بیشتر'],['ar','أدوات إضافية']]){
  const html=renderToStaticMarkup(React.createElement(language.default,{initialLanguage:locale},React.createElement(drawer.default,{title:'more'},React.createElement('button',null,'preserved control'))));
  assert.ok(html.includes(label));assert.ok(html.includes('<details'));assert.ok(html.includes('<summary>'));assert.ok(html.includes('preserved control'));assert.ok(!html.includes('<details open'));
 }
});
