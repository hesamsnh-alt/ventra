'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import {normalizeLanguage,languageDirection} from '@/lib/i18n/translate.mjs';
const LanguageContext=createContext({language:'en',setLanguage:()=>{}});
export const useLanguage=()=>useContext(LanguageContext);
const LABELS={en:'Language',fa:'زبان',ar:'اللغة'};
export default function LanguageProvider({children,initialLanguage="en"}){
 const [language,setCurrent]=useState(normalizeLanguage(initialLanguage));
 function setLanguage(value){const next=normalizeLanguage(value);setCurrent(next);try{localStorage.setItem('ventra:language',next);}catch{}document.cookie=`ventra-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;}
 // The server cookie supplies the initial locale; storage events synchronize other tabs.
 useEffect(()=>{
  const sync=e=>{if(e.key==='ventra:language')setCurrent(normalizeLanguage(e.newValue));};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[]);
 useEffect(()=>{document.documentElement.lang=language;document.documentElement.dir=languageDirection(language);},[language]);
 return <LanguageContext.Provider value={{language,setLanguage}}><div className="ventra-language-switch" aria-label={LABELS[language]}><label htmlFor="ventra-language">{LABELS[language]}</label><select id="ventra-language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="fa">فارسی</option><option value="ar">العربية</option></select></div>{children}</LanguageContext.Provider>;
}
