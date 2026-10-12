import {translateText} from './i18n/translate.mjs';
export const boqTranslationKey=text=>String(text??'').replace(/\s+/g,' ').trim();
export function localizeBoqText(text,language='en',translations={}){
 if(typeof text!=='string'||language==='en')return text;
 return translations[boqTranslationKey(text)]||translateText(text,language);
}
export function missingBoqTranslations(texts,language,translations={}){
 if(language==='en')return [];
 return [...new Set(texts.filter(t=>typeof t==='string'&&/[a-z]/i.test(t)&&t.trim()).map(boqTranslationKey))].filter(t=>localizeBoqText(t,language,translations)===t);
}
// Untrusted descriptions are translated as data, never instructions. Validate
// the entire response before publishing a single translated description.
export function validateBoqTranslations(texts,entries){
 if(!Array.isArray(entries)||entries.length!==texts.length)throw new Error('Incomplete BOQ translation.');
 const result={},seen=new Set();
 for(const e of entries){
  if(!Number.isInteger(e.id)||e.id<0||e.id>=texts.length||seen.has(e.id)||typeof e.translation!=='string'||!e.translation.trim()||e.translation.length>4000)throw new Error('Invalid BOQ translation.');
  const source=texts[e.id],numbers=s=>(s.match(/\d+(?:[.,]\d+)*/g)||[]).sort();
  const codes=source.match(/\b[A-Z]+[-/]?\d+[A-Z0-9-]*\b/g)||[];
  if(codes.some(code=>!e.translation.includes(code)))throw new Error('BOQ translation changed material codes.');
  if(JSON.stringify(numbers(source))!==JSON.stringify(numbers(e.translation)))throw new Error('BOQ translation changed numeric specifications.');
  seen.add(e.id);result[boqTranslationKey(source)]=e.translation.trim();
 }
 return result;
}
