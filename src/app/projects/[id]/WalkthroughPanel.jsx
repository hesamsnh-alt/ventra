'use client';
import {createPortal} from 'react-dom';
import {createViewportFullscreen} from '@/lib/viewportFullscreen.mjs';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import styles from './WalkthroughPanel.module.css';
export default function WalkthroughPanel({projectId,scene,getRenderer,getViewport,onActiveChange,disabled=false}){
 const{language}=useLanguage(),fa=language==='fa',ar=language==='ar',text=(en,f,a)=>fa?f:ar?a:en;
 const[fullHost,setFullHost]=useState(null),screen=useRef(null),viewport=useRef(getViewport);viewport.current=getViewport;
 const[active,setActive]=useState(false),[error,setError]=useState('');const session=useRef(null),change=useRef(onActiveChange);change.current=onActiveChange;
 useEffect(()=>{let live=true;setFullHost(null);screen.current=createViewportFullscreen({getHost:()=>viewport.current?.(),className:styles.fullscreenHost,onChange:host=>{if(live)setFullHost(host);if(!host)session.current?.stopWalkthrough?.();}});return()=>{live=false;screen.current.dispose();};},[projectId,scene]);
 useEffect(()=>{setActive(false);const exit=e=>{if(e.detail?.projectId===projectId){setActive(false);session.current=null;change.current(false);screen.current?.exit();}};window.addEventListener('ventra:walkthrough-exit',exit);return()=>{window.removeEventListener('ventra:walkthrough-exit',exit);session.current?.stopWalkthrough?.();session.current=null;change.current(false);};},[projectId,scene]);
 function toggle(){setError('');if(active){session.current?.stopWalkthrough?.();return;}try{const renderer=getRenderer();if(!renderer?.startWalkthrough)throw Error(text('Open an interior floor model first.','ابتدا مدل داخلی یک طبقه را باز کن.','افتح نموذج طابق داخلي أولاً.'));renderer.startWalkthrough();session.current=renderer;setActive(true);change.current(true);}catch(e){setError(e.message);}}
 const axis=(f,r)=>session.current?.setWalkAxis?.(f,r);
 const hold=(f,r)=>({onPointerDown:e=>{e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}axis(f,r);},onPointerUp:()=>axis(0,0),onPointerCancel:()=>axis(0,0),onLostPointerCapture:()=>axis(0,0),onBlur:()=>axis(0,0),onKeyDown:e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();axis(f,r);}},onKeyUp:()=>axis(0,0)});
 const panel=<section data-ventra-walk-controls={projectId} className={[styles.panel,fullHost?styles.overlay:''].join(' ')} dir={fa||ar?'rtl':'ltr'} aria-label={text('Walk inside project','گشت داخل پروژه','جولة داخل المشروع')}>
 <button type="button" disabled={disabled&&!fullHost} onClick={async()=>{setError('');try{if(fullHost)screen.current?.exit();else await screen.current?.enter();}catch(e){setError(e.message);}}}>{fullHost?text('Exit fullscreen · Esc','Exit · خروج از تمام‌صفحه','خروج من ملء الشاشة'):text('Fullscreen','تمام‌صفحه','ملء الشاشة')}</button>
 <button type="button" disabled={disabled&&!active} aria-pressed={active} onClick={toggle}>{active?text('Exit walkthrough','خروج از گشت','إنهاء الجولة'):text('Walk inside project','گشت داخل پروژه','جولة داخل المشروع')}</button>
 {active&&<><p>{text('Drag the scene to look. W/A/S/D to move; arrows to move/turn. Escape exits. Eye height 1.60 m.','برای نگاه‌کردن، تصویر را بکش. حرکت با W/A/S/D؛ جهت‌ها برای حرکت و چرخش. خروج با Esc. ارتفاع دید ۱٫۶ متر.','اسحب للنظر. تحرك باستخدام W/A/S/D؛ الأسهم للحركة والدوران. Esc للخروج. ارتفاع العين ١٫٦ متر.')}</p>
 <div className={styles.pad} dir="ltr"><button type="button" aria-label="Forward / جلو" {...hold(1,0)}>↑</button><div><button type="button" aria-label="Move left / حرکت چپ" {...hold(0,-1)}>←</button><button type="button" aria-label="Backward / عقب" {...hold(-1,0)}>↓</button><button type="button" aria-label="Move right / حرکت راست" {...hold(0,1)}>→</button></div><div><button type="button" onClick={()=>session.current?.turnWalk?.(-Math.PI/8)}>↶ {text('Look left','نگاه چپ','يسار')}</button><button type="button" onClick={()=>session.current?.turnWalk?.(Math.PI/8)}>{text('Look right','نگاه راست','يمين')} ↷</button></div></div>
 <small>{text('Single-floor preview; stairs and VR headset mode are not included. Movement follows available geometry, not verified site measurements.','گشت همین طبقه؛ پله و هدست VR در این مرحله فعال نیستند. حرکت بر اساس هندسه موجود است و تأیید اندازه‌های واقعی پروژه نیست.','جولة بطابق واحد؛ السلالم وVR غير مفعّلين. الحركة حسب الهندسة المتاحة.')}</small></>}
 {error&&<p role="alert">{error}</p>}
 </section>;
 return fullHost?createPortal(panel,fullHost):panel;
}
