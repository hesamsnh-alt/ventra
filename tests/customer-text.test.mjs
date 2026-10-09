import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {parse} from '@babel/parser';import {createRequire} from 'node:module';import {loadComponent} from './render-runtime.mjs';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('Actual task cells preserve customer text matching UI labels while translating workflow labels',async()=>{
 const file='src/app/projects/[id]/ProjectTasks.jsx',source=readFileSync(file,'utf8'),tree=parse(source,{sourceType:'module',plugins:['jsx']}),cells=[];
 function walk(node){if(!node||typeof node!=='object')return;
  if(node.type==='JSXElement'&&node.openingElement.name.name==='LocalizedElement'&&node.openingElement.attributes.some(a=>a.name?.name==='as'&&a.value?.value==='td')){
   const jsx=source.slice(node.start,node.end);if(!jsx.includes('as="select"')&&/t\.(title|assignee|priority)/.test(jsx))cells.push(jsx);
  }
  for(const [key,value] of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
 }walk(tree);assert.equal(cells.length,3);
 const {default:Provider}=await loadComponent('src/app/components/i18n/LanguageProvider.jsx'),{default:LocalizedElement,OriginalText}=await loadComponent('src/app/components/i18n/LocalizedElement.jsx');
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();
 const compiled=await transform(`exports.Row=({t})=><tr>${cells.join('')}</tr>`,{filename:'actual-task-cells.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const sandbox={exports:{},require,LocalizedElement,OriginalText};vm.createContext(sandbox);vm.runInContext(compiled.code,sandbox);
 for(const language of ['en','fa','ar']){
  const render=t=>renderToStaticMarkup(React.createElement(Provider,{initialLanguage:language},React.createElement(sandbox.exports.Row,{t})));
  const html=render({title:'Dashboard',assignee:'Profile',priority:'Low'});
  assert.ok(html.includes('<td>Dashboard</td>'));assert.ok(html.includes('<td>Profile</td>'));
  if(language!=='en')assert.ok(!html.includes('<td>Low</td>'));
  assert.ok(!render({title:'Dashboard',assignee:'',priority:'Low'}).includes('<td></td>'));
 }
});
