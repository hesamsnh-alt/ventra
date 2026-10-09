import fs from 'node:fs';
import path from 'node:path';
import {parse} from '@babel/parser';
import translations from '../src/lib/i18n/translations.json' with {type:'json'};

// Only static JSX text and display attributes. No API prompts, logs,
// credentials, runtime project records, or interpolated values are exported.
const sources=new Map(), skipped=[];
const normalize=value=>value.replace(/\s+/g,' ').trim();
const identifiers=new Set(['Ventra','VENTRA','V','AUTODESK APS','DWG','DXF','IFC','JPG','CSV','PDF','Excel','XLSX','AI','ISO','AED','AED/m²','m','MB','UAE 2026','Iran','TRN:','dbId:','W1','W4','W8','W12','VC-2048','AL NOOR VILLA RENOVATION','AL SIRATCONTRACTING','name@company.com','KITCHEN','LIVING','LIVING + KITCHEN','BED 01','BED 02','BEDROOM 01','MEP ZONE']);
function add(value,file){
 const text=normalize(value);
 if(!/[A-Za-z]/.test(text)||/^(?:https?:|data:|@\/|ventra:)/.test(text))return;
 // Source names, sample customer names, codes, units and dates stay original.
 if(identifiers.has(text)||/^[\d,.]+\s*(?:m²|MB)$/.test(text)||/\.dwg$/i.test(text)||/^AED [\d,.]+[MK]?$/.test(text)||/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+$/.test(text))return;
 if(!sources.has(text))sources.set(text,new Set());
 sources.get(text).add(file);
}
function walk(node,file){
 if(!node||typeof node!=='object')return;
 if(node.type==='JSXElement'&&node.openingElement?.name?.name==='OriginalText')return;
 if(node.type==='JSXText')add(node.value,file);
 if(node.type==='JSXAttribute'&&['placeholder','title','alt','aria-label'].includes(node.name?.name)&&node.value?.type==='StringLiteral')add(node.value.value,file);
 for(const key in node){
  if(['loc','start','end','comments','tokens'].includes(key))continue;
  const value=node[key];if(Array.isArray(value))value.forEach(item=>walk(item,file));else if(value&&typeof value==='object')walk(value,file);
 }
}
function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);
 if(entry.isDirectory()){if(!file.includes('/api'))scan(file);}
 else if(/\.(?:js|jsx|mjs)$/.test(file)&&!file.includes('/i18n/')&&!file.includes('/api/')){
  try{walk(parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']}),file);}catch{skipped.push(file);}
 }
}}
scan('src/app');
const invalid=Object.entries(translations).filter(([,row])=>!row.fa?.trim()||!row.ar?.trim());
const pending=[...sources].filter(([text])=>!translations[text]?.fa||!translations[text]?.ar).map(([text,files])=>({text,files:[...files]})).sort((a,b)=>a.text.localeCompare(b.text));
fs.mkdirSync('docs',{recursive:true});
fs.writeFileSync('docs/translation-review-static-ui.json',JSON.stringify({scope:'Static JSX display text only. No customer data, keys, API prompts or diagnostics. Review before authorizing any external translation.',translatedEntries:Object.keys(translations).length,staticEntries:sources.size,pendingEntries:pending.length,skippedLegacyFiles:skipped,pending},null,2)+'\n');
console.log(JSON.stringify({translatedEntries:Object.keys(translations).length,staticEntries:sources.size,pendingEntries:pending.length,invalidTranslations:invalid.length,skippedLegacyFiles:skipped.length},null,2));
if(invalid.length)process.exitCode=1;
if(pending.length&&!process.argv.includes('--allow-incomplete'))process.exitCode=1;
