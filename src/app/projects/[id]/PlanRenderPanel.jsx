'use client';
import {useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {commercialFetch} from '@/lib/commercialFetch';
import {readSchematic,saveSchematic} from '@/lib/schematicStorage.mjs';
import styles from './PlanRenderPanel.module.css';
const COPY={
 en:{title:'Realistic design render',intro:'Upload the original plan. Generate a furnished image with realistic materials and lighting.',file:'Original plan image',style:'Design style',modern:'Modern',minimal:'Minimal',luxury:'Luxury',notes:'Design preferences (any language)',shower:'Propose a compact shower where the sanitary room has sufficient space',generate:'Generate realistic render',busy:'Generating render…',download:'Download render',timeout:'The request timed out. Check usage before trying again.',mismatch:'The render changed the source layout and was rejected. It has not been saved.',unclear:'The layout could not be read reliably. Upload a clearer plan.',reviewFailed:'Layout comparison did not complete. No render was accepted.',old:'The previous image has no layout review. Generate a new render.',notice:'Source layout analysis and visual comparison are included. These checks can still miss errors. Concept image; furnishings may be proposed. This does not change your interactive model or BOQ. Each generation uses your analysis allowance and paid OpenAI API credit.',missing:'Select a plan image first.',large:'Choose a JPG, PNG or WebP up to 5 MB.',failed:'Could not generate the render.',saved:'Render saved on this device.',unsaved:'Render generated, but could not be saved on this device. Download it now.'},
 fa:{title:'رندر واقعی طراحی',intro:'تصویر اصلی پلان را انتخاب کن؛ رندر مبله با متریال و نور طبیعی تولید می‌شود.',file:'تصویر اصلی پلان',style:'سبک طراحی',modern:'مدرن',minimal:'مینیمال',luxury:'لوکس',notes:'خواسته‌های طراحی (فارسی یا هر زبان)',shower:'پیشنهاد دوش جمع‌وجور، اگر فضای سرویس کافی باشد',generate:'تولید رندر واقعی',busy:'در حال تولید رندر…',download:'دانلود رندر',timeout:'مهلت درخواست تمام شد؛ قبل از تلاش مجدد مصرف اعتبار را بررسی کن.',mismatch:'رندر با چیدمان پلان تطابق نداشت و رد شد؛ ذخیره نشده است.',unclear:'چیدمان نقشه با اطمینان خوانده نشد؛ تصویر واضح‌تری انتخاب کن.',reviewFailed:'مقایسه با پلان کامل نشد؛ رندری پذیرفته نشد.',old:'تصویر قبلی کنترل تطابق ندارد؛ رندر جدید تولید کن.',notice:'تحلیل چیدمان و مقایسه تصویری انجام می‌شود؛ این بررسی‌ها همچنان ممکن است خطا داشته باشند. تصویر پیشنهادی طراحی؛ بعضی تجهیزات ممکن است پیشنهادی باشند. مدل قابل‌چرخش و BOQ تغییر نمی‌کنند. هر تولید از سهمیه تحلیل و اعتبار پولی API استفاده می‌کند.',missing:'ابتدا تصویر پلان را انتخاب کن.',large:'تصویر JPG، PNG یا WebP تا ۵ مگابایت انتخاب کن.',failed:'تولید رندر انجام نشد.',saved:'رندر روی این دستگاه ذخیره شد.',unsaved:'رندر تولید شد اما روی دستگاه ذخیره نشد؛ اکنون دانلودش کن.'},
 ar:{title:'تصيير واقعي للتصميم',intro:'اختر صورة المخطط الأصلي لإنشاء صورة مؤثثة بمواد وإضاءة واقعية.',file:'صورة المخطط الأصلي',style:'أسلوب التصميم',modern:'حديث',minimal:'بسيط',luxury:'فاخر',notes:'تفضيلات التصميم بأي لغة',shower:'اقتراح دش صغير إذا كانت مساحة الحمام كافية',generate:'إنشاء التصيير الواقعي',busy:'جارٍ إنشاء الصورة…',download:'تنزيل الصورة',timeout:'انتهت مهلة الطلب. تحقق من الاستهلاك قبل المحاولة مجدداً.',mismatch:'تم رفض الصورة لأنها غير مطابقة لتوزيع المخطط، ولم تحفظ.',unclear:'تعذر قراءة توزيع المخطط بثقة. اختر صورة أوضح.',reviewFailed:'لم تكتمل المقارنة مع المخطط. لم تقبل أي صورة.',old:'الصورة السابقة لم تخضع لمراجعة التوزيع. أنشئ صورة جديدة.',notice:'يشمل تحليل التوزيع والمقارنة البصرية، وقد تفوت هذه المراجعة بعض الأخطاء. صورة تصميم مقترحة؛ قد تكون بعض التجهيزات مقترحة. لا تغير النموذج التفاعلي أو جدول الكميات. كل إنشاء يستهلك حصة التحليل ورصيد OpenAI API المدفوع.',missing:'اختر صورة المخطط أولاً.',large:'اختر صورة JPG أو PNG أو WebP حتى 5 ميغابايت.',failed:'تعذر إنشاء الصورة.',saved:'تم حفظ الصورة على هذا الجهاز.',unsaved:'تم إنشاء الصورة ولكن تعذر حفظها على الجهاز؛ نزلها الآن.'},
};
export default function PlanRenderPanel({projectId}){
 const {language}=useLanguage();const t=COPY[language]||COPY.en;
 const [imageUrl,setImageUrl]=useState(''),[style,setStyle]=useState('modern'),[notes,setNotes]=useState(''),[shower,setShower]=useState(true),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(null),selection=useRef({revision:0,cancelled:false});
 useEffect(()=>{const selectionState=selection.current;selectionState.cancelled=false;const initialRevision=selectionState.revision;let cancelled=false;readSchematic(projectId,'concept-render').then(value=>{if(!cancelled&&selectionState.revision===initialRevision&&!active.current&&value?.kind==='concept_render'){if(value.pipelineVersion===47&&value.layoutReview?.method==='ai_visual_comparison')setResult(value);else setMessage('old');}}).catch(()=>{});return()=>{cancelled=true;active.current?.abort();selectionState.cancelled=true;};},[projectId]);
 async function selectFile(event){
  const id=++selection.current.revision;const file=event.target.files?.[0];setImageUrl('');setMessage('');
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setMessage(t.large);return;}
  try{const value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});if(id===selection.current.revision&&!selection.current.cancelled)setImageUrl(value);}
  catch{if(id===selection.current.revision&&!selection.current.cancelled)setMessage(t.failed);}
 }
 async function generate(){
  if(!imageUrl){setMessage(t.missing);return;}
  if(active.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');setResult(null);let timer,didTimeout=false;
  try{
   const pending=(async()=>{const response=await commercialFetch('/api/ai/plan-render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,imageUrl,style,notes:notes+(shower?'\nPropose a compact shower in sanitary spaces only if it fits without changing walls or blocking doors.':''),requestId:crypto.randomUUID()}),signal:controller.signal});
   const payload=await response.json();if(!response.ok||!payload.success)throw Object.assign(new Error(payload.error||t.failed),{code:payload.code});return payload;})();
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{didTimeout=true;controller.abort();reject(new Error(t.timeout));},300000);});
   const payload=await Promise.race([pending,deadline]);clearTimeout(timer);
   if(payload.pipelineVersion!==47||payload.layoutReview?.method!=='ai_visual_comparison')throw Object.assign(new Error(t.reviewFailed),{code:'RENDER_REVIEW_FAILED'});
   if(controller.signal.aborted)return;
   setResult(payload);
   try{await saveSchematic(projectId,payload,{kind:'concept-render'});if(!controller.signal.aborted)setMessage(t.saved);}
   catch{if(!controller.signal.aborted)setMessage(t.unsaved);}
  }catch(error){if(!selection.current.cancelled&&(didTimeout||!controller.signal.aborted)){const key={RENDER_LAYOUT_MISMATCH:'mismatch',RENDER_PLAN_UNCLEAR:'unclear',RENDER_REVIEW_FAILED:'reviewFailed'}[error.code];setMessage(didTimeout?'timeout':key||error.message||t.failed);}}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;if(!selection.current.cancelled)setBusy(false);}}
 }
 return <section className={styles.panel} aria-busy={busy}>
  <h3>{t.title}</h3><p>{t.intro}</p>
  <div className={styles.inputs}>
   <label>{t.file}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={selectFile}/></label>
   <label>{t.style}<select value={style} disabled={busy} onChange={e=>setStyle(e.target.value)}>{['modern','minimal','luxury'].map(value=><option key={value} value={value}>{t[value]}</option>)}</select></label>
  </div>
  <label className={styles.notes}>{t.notes}<textarea value={notes} maxLength={900} disabled={busy} onChange={e=>setNotes(e.target.value)} rows={2}/></label>
  <label className={styles.check}><input type="checkbox" checked={shower} disabled={busy} onChange={e=>setShower(e.target.checked)}/>{t.shower}</label>
  <p className={styles.notice}>{t.notice}</p>
  <button type="button" disabled={busy||!imageUrl} onClick={generate}>{busy?t.busy:t.generate}</button>
  {message&&<p role="status">{t[message]||message}</p>}
  {result?.imageUrl&&<figure><Image src={result.imageUrl} alt={t.title} width={1536} height={1024} unoptimized className={styles.render}/><a href={result.imageUrl} download={`ventra-${projectId}-render.jpg`}>{t.download}</a></figure>}
 </section>;
}
