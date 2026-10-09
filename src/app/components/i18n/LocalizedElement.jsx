'use client';
import {Children,createElement} from 'react';
import {useLanguage} from './LanguageProvider';
import {translateText} from '@/lib/i18n/translate.mjs';
// Only UI labels are translated. Form values, identifiers and source records stay intact.
export function OriginalText({children}){return children;}
export default function LocalizedElement({as,children,...props}){
 const {language}=useLanguage();const next={...props};
 for(const key of ['title','placeholder','alt','aria-label'])if(typeof next[key]==='string')next[key]=translateText(next[key],language);
 const originals=Children.toArray(children);
 if(as==='option'&&next.value===undefined&&originals.every(v=>typeof v==='string'||typeof v==='number'))next.value=originals.join('');
 const content=['pre','code','textarea','script','style'].includes(as)?children:originals.map(child=>typeof child==='string'?translateText(child,language):child);
 if(as==='input'&&['email','url','number'].includes(next.type))next.dir='ltr';
 // Protected tags may be self-closing (controlled textarea) or have a scalar
 // child. Only the translated Children array is guaranteed to have a length.
 const rendered=Array.isArray(content)&&content.length===0?undefined:content;
 return createElement(as,next,rendered);
}
