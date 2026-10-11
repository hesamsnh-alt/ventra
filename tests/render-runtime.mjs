import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import * as translations from '../src/lib/i18n/translate.mjs';
const require=createRequire(import.meta.url);const modules=new Map();
async function compile(file){if(modules.has(file))return modules.get(file);
 const {transform,loadBindings}=require('next/dist/build/swc');await loadBindings();const source=readFileSync(file,'utf8');
 const compiled=await transform(source,{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const sandbox={exports:{},require:id=>{if(id==='@/lib/i18n/translate.mjs')return translations;
  if(id==='./LanguageProvider'||id==='@/app/components/i18n/LanguageProvider')return modules.get('src/app/components/i18n/LanguageProvider.jsx');
  if(id==='@/app/components/i18n/LocalizedElement')return modules.get('src/app/components/i18n/LocalizedElement.jsx');
  if(id.endsWith('.css'))return {};return require(id);}};
 vm.createContext(sandbox);vm.runInContext(compiled.code,sandbox);modules.set(file,sandbox.exports);return sandbox.exports;
}
export async function loadComponent(file){await compile('src/app/components/i18n/LanguageProvider.jsx');await compile('src/app/components/i18n/LocalizedElement.jsx');return compile(file);}
