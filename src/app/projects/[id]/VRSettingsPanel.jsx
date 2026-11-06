'use client';
import {useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {DEFAULT_VR_SETTINGS,resolveVRSettings} from '@/lib/vrSettings.mjs';
import styles from './WalkthroughPanel.module.css';
export default function VRSettingsPanel({scene,value,onChange,disabled=false}){
 const{language}=useLanguage(),fa=language==='fa',ar=language==='ar',text=(en,f,a)=>fa?f:ar?a:en;
 const[draft,setDraft]=useState(null),[error,setError]=useState('');
 const polygons=scene.footprint?[scene.footprint]:(scene.rooms||[]).map(r=>r.polygon||[]),all=polygons.flat(),xs=all.map(p=>p.x),ys=all.map(p=>p.y);
 const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(.1,Math.max(...xs)-minX),height=Math.max(.1,Math.max(...ys)-minY);
 const pts=p=>p.map(v=>`${(v.x-minX)/width*1000},${(v.y-minY)/height*600}`).join(' '),boundary=draft??value.boundary;
 function update(patch){setError('');try{const next={...value,...patch};resolveVRSettings(scene,next);onChange(next);}catch(e){setError(e.message);}}
 return <details className={styles.vrSettings}><summary>{text('VR settings & navigation boundary','تنظیمات VR و مرز گشت','إعدادات VR وحدود الجولة')}</summary>
  <label>{text('Headset profile','پروفایل هدست','ملف النظارة')}<select value={value.profile} disabled={disabled} onChange={e=>update({profile:e.target.value})}><option value="quest2">Meta Quest 2 · {text('Performance','سبک‌تر','أداء')}</option><option value="quest3">Meta Quest 3 · {text('Quality','کیفیت بالاتر','جودة')}</option></select></label>
  <label><input type="checkbox" checked={value.movement} disabled={disabled} onChange={e=>update({movement:e.target.checked})}/>{text('Joystick movement','حرکت با جوی‌استیک','التحرك بعصا التحكم')}</label>
  <label>{text('Speed (m/s)','سرعت حرکت (متر بر ثانیه)','السرعة (م/ث)')}<input type="range" min=".2" max="1.5" step=".1" disabled={disabled||!value.movement} value={value.speed} onChange={e=>update({speed:Number(e.target.value)})}/><output>{value.speed.toFixed(1)}</output></label>
  <label>{text('Snap turn','چرخش مرحله‌ای','دوران متدرج')}<select disabled={disabled} value={value.snapDegrees} onChange={e=>update({snapDegrees:Number(e.target.value)})}>{[15,30,45,90].map(n=><option key={n} value={n}>{n}°</option>)}</select></label>
  <label><input type="checkbox" checked={value.showBoundary} disabled={disabled} onChange={e=>update({showBoundary:e.target.checked})}/>{text('Show floor boundary in headset','نمایش مرز روی کف داخل هدست','عرض الحدود على الأرضية داخل النظارة')}</label>
  <p>{text('Draw a virtual walking region on the floor plan: click at least 3 corners in order, then Apply boundary. Joystick movement stops at the boundary, walls and obstacles.','برای تعیین محدودهٔ مجازی، حداقل ۳ گوشه را به‌ترتیب روی پلان بزن؛ سپس «اعمال مرز» را انتخاب کن. حرکت جوی‌استیک در مرز، دیوار و موانع متوقف می‌شود.','اضغط ٣ زوايا على الأقل بالترتيب ثم طبّق الحدود. تتوقف حركة العصا عند الحدود والجدران والعوائق.')}</p>
  <svg role="img" aria-label={text('Floor plan boundary editor','ویرایش مرز روی پلان','محرر حدود المخطط')} viewBox="0 0 1000 600" className={styles.boundaryMap} onClick={e=>{if(disabled||draft===null)return;const r=e.currentTarget.getBoundingClientRect();if(!r.width||!r.height)return;setDraft(p=>p.length>=32?p:[...p,{x:minX+(e.clientX-r.left)/r.width*width,y:minY+(e.clientY-r.top)/r.height*height}]);}}>
   {polygons.map((p,i)=><polygon key={i} points={pts(p)} fill="#293649" stroke="#aab4c3" strokeWidth="4"/>)}
   {(scene.holes||[]).map((h,i)=><polygon key={'h'+i} points={pts(h.polygon||h)} fill="#10151e" stroke="#ff886c" strokeWidth="4"/>)}
   {(scene.walls||[]).filter(w=>w.start&&w.end).map((w,i)=><polyline key={'w'+i} points={pts([w.start,w.end])} fill="none" stroke="#929dac" strokeWidth="5"/>)}
   {boundary?.length>0&&<><polygon points={pts(boundary)} fill="#40caba33" stroke="#50ead2" strokeWidth="5"/>{boundary.map((p,i)=><circle key={i} cx={(p.x-minX)/width*1000} cy={(p.y-minY)/height*600} r="8" fill="#ffe157"/>)}</>}
  </svg>
  <div className={styles.vrActions}>
   <button type="button" disabled={disabled} onClick={()=>{setError('');setDraft([]);}}>{text('Draw boundary','رسم مرز','رسم الحدود')}</button>
   {draft!==null&&<><button type="button" disabled={disabled||!draft.length} onClick={()=>setDraft(p=>p.slice(0,-1))}>{text('Undo point','حذف نقطهٔ آخر','حذف آخر نقطة')}</button><button type="button" disabled={disabled||draft.length<3} onClick={()=>{try{const next={...value,boundary:draft};resolveVRSettings(scene,next);onChange(next);setDraft(null);setError('');}catch(e){setError(e.message);}}}>{text('Apply boundary','اعمال مرز','تطبيق الحدود')}</button><button type="button" disabled={disabled} onClick={()=>setDraft(null)}>{text('Cancel drawing','لغو رسم','إلغاء الرسم')}</button></>}
   <button type="button" disabled={disabled} onClick={()=>{setDraft(null);update({boundary:null});}}>{text('Use whole floor','کل محدودهٔ طبقه','كامل الطابق')}</button>
   <button type="button" disabled={disabled} onClick={()=>{setDraft(null);onChange({...DEFAULT_VR_SETTINGS});setError('');}}>{text('Reset VR settings','تنظیمات اولیهٔ VR','إعادة ضبط VR')}</button>
  </div>
  <p role="status">{draft!==null?text(`Drawing: ${draft.length} points · not applied` ,`در حال رسم: ${draft.length} نقطه · هنوز اعمال نشده`,`رسم: ${draft.length} نقطة · لم تُطبّق`):value.boundary?text(`Custom boundary: ${value.boundary.length} points`, `مرز سفارشی: ${value.boundary.length} نقطه`,`حدود مخصصة: ${value.boundary.length} نقطة`):text('Boundary: entire floor','مرز: کل طبقه','الحدود: كامل الطابق')}</p>
  <small>{text('Settings stay in this browser for this drawing. Headset floor calibration controls eye height. Virtual boundaries cannot restrict real physical movement; configure your headset’s real safety boundary separately.','تنظیمات برای این نقشه در همین مرورگر حفظ می‌شوند. ارتفاع چشم از کالیبراسیون کف هدست گرفته می‌شود. مرز مجازی جلوی حرکت بدنی واقعی را نمی‌گیرد؛ مرز ایمنی واقعی را جداگانه در هدست تنظیم کن.','تُحفظ الإعدادات لهذا الرسم في المتصفح. يحدد معايرة أرضية النظارة ارتفاع العين. الحدود الافتراضية لا تمنع الحركة الفعلية؛ اضبط حدود الأمان الحقيقية من النظارة.')}</small>
  {error&&<p role="alert">{error}</p>}
 </details>;
}
