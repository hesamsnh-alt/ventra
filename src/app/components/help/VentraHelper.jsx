'use client';
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {HELP_TOPICS,getHelpResponse,helpCopy,helpTitle} from '@/lib/ventraHelp.mjs';
import './VentraHelper.css';
const LABELS={en:{title:'Ventra Guide',help:'Help',placeholder:'Ask about a section or an error…',send:'Send',clear:'New chat',human:'Human support',topics:'All topics',privacy:'Product guidance • no access to private project records',close:'Close help',empty:'Type your question',open:'Open section'},fa:{title:'راهنمای ونترا',help:'کمک',placeholder:'دربارهٔ یک بخش یا خطا سؤال کن…',send:'ارسال',clear:'گفت‌وگوی تازه',human:'پشتیبانی انسانی',topics:'همهٔ موضوعات',privacy:'راهنمای استفاده • بدون دسترسی به اطلاعات خصوصی پروژه',close:'بستن راهنما',empty:'سؤالت را بنویس',open:'باز کردن بخش'},ar:{title:'دليل ڤنترا',help:'مساعدة',placeholder:'اسأل عن قسم أو رسالة خطأ…',send:'إرسال',clear:'محادثة جديدة',human:'الدعم البشري',topics:'كل المواضيع',privacy:'دليل الاستخدام • لا يصل إلى بيانات المشروع الخاصة',close:'إغلاق المساعدة',empty:'اكتب سؤالك',open:'فتح القسم'}};
export default function VentraHelper({embedded=false}){
 const {language,setLanguage}=useLanguage();
 const pathname=usePathname();const [opened,setOpened]=useState(embedded),[input,setInput]=useState(''),[messages,setMessages]=useState([]),[topic,setTopic]=useState(null),[all,setAll]=useState(false);
 const scroll=useRef(null),field=useRef(null),launcher=useRef(null),disclosure=useRef(null),flight=useRef(false);
 const [mode,setMode]=useState('guide'),[busy,setBusy]=useState(false);
 function close(){if(disclosure.current)disclosure.current.open=false;setOpened(false);launcher.current?.focus();}const labels=LABELS[language];
 useEffect(()=>{if(opened)field.current?.focus();},[opened]);
 useEffect(()=>{if(opened&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[messages,opened,language]);
 useEffect(()=>{if(!opened||embedded)return;function key(e){if(e.key==='Escape')close();}window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[opened,embedded]);
 async function ask(value,id=null){
  const question=value.trim();if(!question||flight.current)return;
  const result=getHelpResponse(question,{pathname:pathname+(typeof window!=='undefined'?window.location.search:''),language,previousTopic:topic,topicId:id});
  setLanguage(result.language);setTopic(result.topic);setInput('');setAll(false);
  if(mode==='guide'||id){setMessages(rows=>[...rows,{role:'user',text:question},{role:'guide',...result}].slice(-40));return;}
  flight.current=true;setBusy(true);
  const history=messages.slice(-8).map(m=>({role:m.role==='user'?'user':'assistant',content:m.text}));
  setMessages(rows=>[...rows,{role:'user',text:question}].slice(-40));
  try{
   const {supabase}=await import('@/lib/supabase');
   const {data,error}=await supabase.auth.getSession();
   if(error||!data?.session?.access_token)throw new Error(result.language==='fa'?'برای پرسش از AI ابتدا وارد حساب شو. راهنمای آماده بدون ورود کار می‌کند.':result.language==='ar'?'سجّل الدخول لاستخدام AI. الدليل الجاهز يعمل دون تسجيل.':'Sign in to ask AI. The quick guide works without signing in.');
   const response=await fetch('/api/help/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({message:question,history,language:result.language,pathname}),signal:AbortSignal.timeout(65000)});
   const payload=await response.json();
   if(!response.ok||!payload.text)throw new Error(payload.error||'AI help is temporarily unavailable.');
   setMessages(rows=>[...rows,{role:'guide',...result,text:payload.text}].slice(-40));
  }catch(error){
   const prefix=result.language==='fa'?'پاسخ AI دریافت نشد: ':result.language==='ar'?'لم يصل رد AI: ':'AI could not respond: ';
   setMessages(rows=>[...rows,{role:'guide',language:result.language,text:prefix+(error.name==='TimeoutError'?'Request timed out.':error.message),links:[{href:'/login',label:result.language==='fa'?'ورود به حساب':'Sign in'}]},{role:'guide',...result}].slice(-40));
  }finally{flight.current=false;setBusy(false);}
 }
 if(!embedded&&pathname==='/support')return null;
 const visible=all?HELP_TOPICS:HELP_TOPICS.filter(t=>['drawings','boq','branding','schedule','billing','error'].includes(t[0]));
 const Wrapper=embedded?'div':'details';
 return <Wrapper ref={embedded?undefined:disclosure} className={embedded?'vh-embedded':'vh-floating'} onToggle={embedded?undefined:e=>setOpened(e.currentTarget.open)}>
  {!embedded&&<LocalizedElement as="summary" ref={launcher} className="vh-launcher" aria-controls="ventra-help-chat"><LocalizedElement as="span" aria-hidden="true">?</LocalizedElement>{labels.help}</LocalizedElement>}
  {<LocalizedElement as="section" className="vh-panel" id="ventra-help-chat" role={embedded?'region':'dialog'} aria-label={labels.title} dir={language==='en'?'ltr':'rtl'}>
   <LocalizedElement as="header" className="vh-head"><LocalizedElement as="div"><LocalizedElement as="strong">{labels.title}</LocalizedElement><LocalizedElement as="small">{labels.privacy}</LocalizedElement></LocalizedElement>{!embedded&&<LocalizedElement as="button" type="button" onClick={close} aria-label={labels.close}>×</LocalizedElement>}</LocalizedElement>
   <LocalizedElement as="nav" className="vh-options" aria-label="Help settings"><LocalizedElement as="select" aria-label="Response mode" value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><LocalizedElement as="option" value="guide">{language==='fa'?'راهنمای آماده':language==='ar'?'الدليل الجاهز':'Quick guide'}</LocalizedElement><LocalizedElement as="option" value="ai">{language==='fa'?'پرسش از AI':language==='ar'?'اسأل AI':'Ask AI'}</LocalizedElement></LocalizedElement><LocalizedElement as="select" aria-label="Language" value={language} onChange={e=>setLanguage(e.target.value)}><LocalizedElement as="option" value="en">English</LocalizedElement><LocalizedElement as="option" value="fa">فارسی</LocalizedElement><LocalizedElement as="option" value="ar">العربية</LocalizedElement></LocalizedElement><LocalizedElement as="button" type="button" disabled={busy} onClick={()=>{setMessages([]);setTopic(null);setInput('');field.current?.focus();}}>{labels.clear}</LocalizedElement><LocalizedLink  href="/support">{language==='en'?'Help centre':language==='fa'?'مرکز راهنما':'مركز المساعدة'}</LocalizedLink></LocalizedElement>
   <LocalizedElement as="div" className="vh-messages" ref={scroll} role="log" aria-live="polite" aria-relevant="additions text"><LocalizedElement as="div" className="vh-message vh-guide">{helpCopy(language).intro}{mode==='ai'&&<LocalizedElement as="p">{language==='fa'?'سؤال و پیام‌های اخیر برای پاسخ‌گویی به OpenAI ارسال می‌شوند. پاسخ AI را بررسی کن.':language==='ar'?'يُرسل السؤال والرسائل الأخيرة إلى OpenAI. راجع إجابات AI.':'Your question and recent messages are sent to OpenAI. Review AI answers.'}</LocalizedElement>}</LocalizedElement>{messages.map((m,i)=><LocalizedElement as="div" key={i} className={'vh-message vh-'+m.role} dir="auto"><LocalizedElement as="p">{m.text}</LocalizedElement>{m.links?.map(link=><LocalizedLink  key={link.href} href={link.href}>{LABELS[m.language||language].open}: {link.label} ↗</LocalizedLink>)}</LocalizedElement>)}{busy&&<LocalizedElement as="div" role="status" className="vh-message vh-guide">{language==='fa'?'در حال پاسخ‌گویی…':language==='ar'?'جارٍ إعداد الرد…':'Thinking…'}</LocalizedElement>}<LocalizedElement as="noscript">JavaScript is required to send messages. Please enable JavaScript and reload.</LocalizedElement></LocalizedElement>
   <LocalizedElement as="div" className="vh-topics">{visible.map(t=><LocalizedElement as="button" key={t[0]} type="button" disabled={busy} onClick={()=>ask(helpTitle(t,language),t[0])}>{helpTitle(t,language)}</LocalizedElement>)}<LocalizedElement as="button" type="button" onClick={()=>setAll(v=>!v)}>{all?'−':'+ '+labels.topics}</LocalizedElement></LocalizedElement>
   <LocalizedElement as="form" className="vh-compose" onSubmit={e=>{e.preventDefault();ask(input);}}><LocalizedElement as="label" className="vh-sr" htmlFor={embedded?'vh-question-full':'vh-question'}>{labels.empty}</LocalizedElement><LocalizedElement as="input" ref={field} id={embedded?'vh-question-full':'vh-question'} value={input} onChange={e=>setInput(e.target.value)} placeholder={labels.placeholder} maxLength={1200} autoComplete="off"/><LocalizedElement as="button" type="submit" disabled={busy||!input.trim()}>{labels.send}</LocalizedElement></LocalizedElement>
   <LocalizedElement as="footer" className="vh-bottom"><LocalizedElement as="a" href="https://wa.me/971509508266" target="_blank" rel="noopener noreferrer">{labels.human} ↗</LocalizedElement><LocalizedElement as="span">{language==='en'?'Do not paste passwords or secret keys.':language==='fa'?'رمز و کلید محرمانه وارد نکن.':'لا تُدخل كلمات المرور أو المفاتيح السرية.'}</LocalizedElement></LocalizedElement>
  </LocalizedElement>}
 </Wrapper>;
}
