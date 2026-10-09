import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {translateText,languageDirection,normalizeLanguage} from '../src/lib/i18n/translate.mjs';import {loadComponent} from './render-runtime.mjs';
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('Persian and Arabic use RTL; unknown locale falls back to English',()=>{assert.equal(languageDirection('fa'),'rtl');assert.equal(languageDirection('ar'),'rtl');assert.equal(languageDirection('en'),'ltr');assert.equal(normalizeLanguage('bad'),'en');assert.equal(translateText('Dashboard','fa'),'داشبورد');assert.equal(translateText('Dashboard','ar'),'لوحة التحكم');});
test('Translated select labels retain original workflow values and form data stays intact',async()=>{
 const {default:Provider}=await loadComponent('src/app/components/i18n/LanguageProvider.jsx'),{default:Element,OriginalText}=await loadComponent('src/app/components/i18n/LocalizedElement.jsx');
 const html=renderToStaticMarkup(React.createElement(Provider,{initialLanguage:'fa'},React.createElement(Element,{as:'div'},React.createElement(Element,{as:'select',defaultValue:'Pending'},React.createElement(Element,{as:'option'},'Pending')),React.createElement(Element,{as:'input',defaultValue:'Dashboard',placeholder:'Project Name'}),React.createElement(Element,{as:'p'},React.createElement(OriginalText,null,'Dashboard')))));
 assert.ok(html.includes('value="Pending"'));assert.ok(html.includes('در انتظار'));assert.ok(html.includes('value="Dashboard"'));assert.ok(html.includes('placeholder="نام پروژه"'));assert.ok(html.includes('<p>Dashboard</p>'));
});
test('Self-closing controlled textareas in 3D prompts and quotations do not crash in any language',async()=>{
 const {default:Provider}=await loadComponent('src/app/components/i18n/LanguageProvider.jsx'),{default:Element}=await loadComponent('src/app/components/i18n/LocalizedElement.jsx');
 for(const initialLanguage of ['en','fa','ar']){
  const html=renderToStaticMarkup(React.createElement(Provider,{initialLanguage},React.createElement(Element,{as:'section'},React.createElement(Element,{as:'textarea',value:'Dashboard',onChange:()=>{},placeholder:'Project Name'}),React.createElement(Element,{as:'textarea',defaultValue:'Payment Terms'}),React.createElement(Element,{as:'textarea',value:'',onChange:()=>{}}))));
  assert.ok(html.includes('>Dashboard</textarea>'));assert.ok(html.includes('>Payment Terms</textarea>'));assert.ok(html.includes('<textarea></textarea>'));
 }
});
test('Protected native tags accept absent, null, numeric and element children',async()=>{
 const {default:Element}=await loadComponent('src/app/components/i18n/LocalizedElement.jsx');
 for(const as of ['pre','code','script','style']){
  const values=['script','style'].includes(as)?[undefined,null,'Dashboard']:[undefined,null,0,'Dashboard',React.createElement('code',null,'Dashboard'),false];
  for(const children of values){
   assert.doesNotThrow(()=>renderToStaticMarkup(React.createElement(Element,{as},children)));
  }
 }
 assert.ok(renderToStaticMarkup(React.createElement(Element,{as:'code'},0)).includes('<code>0</code>'));
 assert.ok(renderToStaticMarkup(React.createElement(Element,{as:'input',defaultValue:'Dashboard'})).includes('value="Dashboard"'));
});
