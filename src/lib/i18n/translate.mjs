import translations from './translations.json' with {type:'json'};
export const LANGUAGES=Object.freeze(['en','fa','ar']);
export const languageDirection=language=>language==='en'?'ltr':'rtl';
export const normalizeLanguage=language=>LANGUAGES.includes(language)?language:'en';
const normalized=s=>s.replace(/\s+/g,' ').trim();
const entries=new Map(Object.entries(translations).map(([key,row])=>[normalized(key),row]));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(translations).filter(([key])=>/\[\[\d+\]\]/.test(key)).map(([key,row])=>{
 const ids=[];let from=0,source='';for(const match of key.matchAll(/\[\[(\d+)\]\]/g)){source+=escape(key.slice(from,match.index))+'([\\s\\S]*?)';ids.push(match[1]);from=match.index+match[0].length;}source+=escape(key.slice(from));
 return {regex:new RegExp('^'+source+'$'),row,ids,weight:key.replace(/\[\[\d+\]\]/g,'').length};
}).filter(p=>p.weight>=4).sort((a,b)=>b.weight-a.weight);
export function translateText(value,language='en'){
 if(typeof value!=='string'||language==='en')return value;
 const text=normalized(value);if(!text)return value;
 const row=entries.get(text);let translated=row?.[language];
 if(!translated)for(const p of patterns){const match=text.match(p.regex);if(!match)continue;const replacements=new Map(p.ids.map((id,i)=>[id,match[i+1]]));translated=p.row[language].replace(/\[\[(\d+)\]\]/g,(_,id)=>replacements.get(id)??'');break;}
 if(!translated)return value;
 const before=value.match(/^\s*/)?.[0]||'',after=value.match(/\s*$/)?.[0]||'';
 return before+translated+after;
}
