'use client';
import {useEffect,useState,useRef} from 'react';
import {BOQ_TRADES,BOQ_PRESETS,normalizeBoqScope,detectDrawingDiscipline,activeBoqTrades} from '@/lib/boqScope.mjs';
import {readBoqScope,writeBoqScope} from '@/lib/boqScopeStore.mjs';
import {drawingUploadHref} from '@/lib/boqScopeManual.mjs';
import styles from './BoqScopePanel.module.css';
export const scopeLabels={
 fa:{metalwork:'فلزکاری و نرده',external:'محوطه‌سازی و کارهای خارجی',unclassified:'نیازمند دسته‌بندی',title:'محدوده محاسبه BOQ',full:'ساخت کامل',fitout:'نازک‌کاری و تجهیز داخلی',renovation:'بازسازی',earthworks:'خاکبرداری و خاکریزی',structure:'سازه و فونداسیون',masonry:'دیوارچینی',finishes:'نازک‌کاری و عایق فضاهای خیس',openings:'درب و پنجره',plumbing:'لوله‌کشی و تجهیزات بهداشتی',hvac:'تهویه و مکانیک',electrical:'برق و روشنایی',furniture:'کابینت، نجاری و مبلمان',roofing:'بام و شیب‌بندی',demolition:'تخریب و جمع‌آوری',architecture:'معماری',mixed:'ترکیبی',unknown:'نیازمند تعیین',enable:'فعال‌کردن محدوده و پیش‌فرض‌ها',only:'فقط اقلام رشته این نقشه وارد BOQ شوند',type:'رشته نقشه (تشخیص پیشنهادی، قابل اصلاح)',defaults:'تکمیل اقلام جاافتاده با پیش‌فرض قابل ویرایش',save:'ذخیره انتخاب محدوده',apply:'اعمال روی BOQ ذخیره‌شده، بدون تحلیل AI',height:'ارتفاع فرضی دیوار (متر)',lights:'تعداد فرضی روشنایی هر فضا',cabinet:'طول فرضی کابینت هر آشپزخانه (متر)',upstand:'برگشت عایق سرویس (متر)',floor:'کف پیش‌فرض برای سطح فاقد پوشش مشخص',wall:'پوشش پیش‌فرض دیوار',notes:'توضیحات مشتری (برای ثبت و بررسی؛ انتخاب‌های بالا مبنای محاسبه‌اند)',notice:'این انتخاب فقط محدوده BOQ را تغییر می‌دهد. مقادیر مستند حفظ می‌شوند. تغییر محدوده هیچ درخواست تحلیل پولی ارسال نمی‌کند.',saved:'انتخاب ذخیره شد؛ محدوده اعمال‌شده در خلاصه BOQ نمایش داده می‌شود.',missing:'مدارک و اقلام نیازمند تکمیل',out:'ردیف خارج از محدوده نگه داشته شده',assumed:'ردیف با مقدار فرضی',excluded:'مقدار نامعلوم یا نرخ ناموجود در جمع لحاظ نشده؛ صفر به معنی رایگان بودن نیست.',manual:'افزودن مقدار دستی',upload:'بارگذاری نقشه تکمیلی در Drawings',restore:'بازگشت به BOQ پیش از فعال‌سازی محدوده',assign:'تعیین رشته ردیف‌های ناشناخته',select:'انتخاب کنید',ceramic:'سرامیک',porcelain:'پرسلان',stone:'سنگ',wood:'چوب',cement:'سیمان',paint:'رنگ',tile:'کاشی',plaster:'فقط پلاستر',ceiling:'پوشش پیش‌فرض سقف',gypsum:'سقف کاذب گچی و رنگ',screed:'زیرسازی تسطیح کف ۵۰ میلی‌متری، در صورت نبود ردیف موجود',none:'بدون پیش‌فرض'},
 en:{metalwork:'Metalwork and railings',external:'Landscaping and external works',unclassified:'Needs classification',title:'BOQ scope',full:'Full construction',fitout:'Interior fit-out',renovation:'Renovation',earthworks:'Earthworks',structure:'Structure and foundations',masonry:'Masonry',finishes:'Finishes and wet-area waterproofing',openings:'Doors and windows',plumbing:'Plumbing and sanitary fixtures',hvac:'HVAC and mechanical',electrical:'Electrical and lighting',furniture:'Cabinets, joinery and furniture',roofing:'Roof and falls',demolition:'Demolition and strip-out',architecture:'Architecture',mixed:'Mixed',unknown:'Needs confirmation',enable:'Enable scope and defaults',only:'Include only this drawing discipline in BOQ',type:'Drawing discipline (editable suggestion)',defaults:'Complete missing operations using editable assumptions',save:'Save scope selection',apply:'Apply to saved BOQ without AI analysis',height:'Assumed wall height (m)',lights:'Assumed lighting points per room',cabinet:'Assumed cabinet run per kitchen (m)',upstand:'Wet-area waterproofing upstand (m)',floor:'Default finish for unallocated floor area',wall:'Default wall finish',notes:'Customer notes (retained for review; structured selections above drive calculation)',notice:'Scope changes BOQ selection only. Documented quantities remain intact. Changing scope makes no paid analysis request.',saved:'Selection saved. Apply it in BOQ, or generate a new BOQ.',missing:'Missing evidence and incomplete work',out:'rows retained outside scope',assumed:'assumed-quantity rows',excluded:'Unknown quantities and missing rates are excluded from the total. Zero does not mean free.',manual:'Add manual quantity',upload:'Upload supporting drawings in Drawings',restore:'Restore BOQ before scope activation',assign:'Classify unrecognised rows',select:'Select',ceramic:'Ceramic',porcelain:'Porcelain',stone:'Stone',wood:'Wood',cement:'Cement',paint:'Paint',tile:'Tile',plaster:'Plaster only',ceiling:'Default ceiling finish',gypsum:'Gypsum ceiling and paint',screed:'50 mm levelling screed where not already recorded',none:'No default'}
};
const scopeRequiredFa={metalwork:'جزئیات اندازه‌دار نرده و فلزکاری، ارتفاع، طول و مشخصات',external:'پلان محوطه‌سازی با مساحت‌ها، ترازها و مشخصات پوشش',earthworks:'تراز زمین، محدوده و عمق خاکبرداری و نقشه فونداسیون',structure:'نقشه سازه، مقاطع اعضا و جزئیات میلگرد یا اسکلت فلزی',masonry:'پلان اندازه‌دار دیوارها، ضخامت، ارتفاع و بازشوها',finishes:'مساحت فضاها و دیوارها، ارتفاع و مشخصات پوشش',openings:'علائم خوانای درب و پنجره، ابعاد و جدول بازشوها',plumbing:'پلان لوله‌کشی، مسیرها، قطرها، تجهیزات و اتصالات',hvac:'پلان تهویه، ابعاد کانال و لوله، مسیر و ظرفیت تجهیزات',electrical:'پلان برق، مسیر و سایز کابل و لوله و مدارها',furniture:'نقشه اندازه‌دار کابینت، نجاری و مبلمان',roofing:'ترازها، شیب، کف‌شورها، ضخامت لایه‌ها و جزئیات عایق بام',demolition:'نقشه وضع موجود و پیشنهادی یا محدوده مشخص حفظ و تخریب',unclassified:'تعیین رشته ردیف‌های ناشناخته برای ورود به محاسبه'};
export default function BoqScopePanel({projectId,language='en',takeoff,fileName='',report:currentReport,onApply,onRestore,disabled=false,unclassified=[],onClassify,onAddManual}){
 const l=scopeLabels[language]||scopeLabels.en;
 const [manual,setManual]=useState(null),[manualBusy,setManualBusy]=useState(false),[manualError,setManualError]=useState('');
 const manualRef=useRef(null);
 useEffect(()=>{if(manual){manualRef.current?.scrollIntoView({behavior:'smooth',block:'center'});manualRef.current?.querySelector('input')?.focus();}},[!!manual]);
 useEffect(()=>{setManual(null);setManualError('');},[projectId]);
 function openManual(trade){setManual({trade,description:'',quantity:'',rate:'',unit:'m²',basis:''});setManualError('');}
 async function submitManual(event){event.preventDefault();if(manualBusy||disabled)return;setManualBusy(true);setManualError('');try{await onAddManual({...manual,rate:manual.rate===''?0:manual.rate});setManual(null);setMessage(language==='fa'?'ردیف دستی ذخیره و به جدول BOQ اضافه شد.':'Manual item saved to the BOQ table.');}catch(e){setManualError(e.message);}finally{setManualBusy(false);}}

 const [config,setConfig]=useState(()=>normalizeBoqScope()),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [savedReport,setSavedReport]=useState(null);
 const report=currentReport||savedReport;
 const detected=detectDrawingDiscipline(fileName&&takeoff?.document_name&&fileName!==takeoff.document_name?{}:takeoff||{},fileName);
 useEffect(()=>{
  const load=()=>{try{const saved=JSON.parse(localStorage.getItem(`ventra:project-boq:${projectId}`)||'null');setSavedReport(saved?.boqScope?.report||null);}catch{setSavedReport(null);}};
  setLoaded(false);setConfig(readBoqScope(localStorage,projectId));load();setLoaded(true);setMessage('');
  const reload=e=>{if(e.detail?.projectId===projectId||e.key===`ventra:project-boq:${projectId}`)load();};
  window.addEventListener('ventra:boq-updated',reload);window.addEventListener('storage',reload);
  return ()=>{window.removeEventListener('ventra:boq-updated',reload);window.removeEventListener('storage',reload);};
 },[projectId]);
 const change=(key,value)=>{setConfig(c=>({...c,[key]:value}));setMessage('');setError('');};
 const selected=normalizeBoqScope(config);
 let active=[];try{active=activeBoqTrades(selected);}catch{}
 async function save(apply=false){try{
  const next=normalizeBoqScope(config);if(next.enabled)activeBoqTrades(next);
  if(apply&&onApply)await onApply(next);
  writeBoqScope(localStorage,projectId,next);window.dispatchEvent(new CustomEvent('ventra:scope-updated',{detail:{projectId}}));
  setMessage(l.saved);setError('');
 }catch(e){setError(e.message);}}
 return <aside className={styles.panel} dir={language==='fa'||language==='ar'?'rtl':'ltr'}>
  <h3>{l.title}</h3>
  <div className="commercial-no-print">
   <label className={styles.check}><input type="checkbox" checked={config.enabled} disabled={!loaded||disabled} onChange={e=>change('enabled',e.target.checked)}/>{l.enable}</label>
   <fieldset disabled={!loaded||disabled||!config.enabled}>
    <div className={styles.presets}>{Object.keys(BOQ_PRESETS).map(p=><label key={p}><input type="radio" name={'scope-'+projectId} checked={config.preset===p} onChange={()=>setConfig(c=>({...c,preset:p,trades:[...BOQ_PRESETS[p]]}))}/>{l[p]}</label>)}</div>
    <label>{l.type}<select value={config.discipline==='unknown'?detected.discipline:config.discipline} onChange={e=>change('discipline',e.target.value)}>{['unknown','architecture','structure','plumbing','hvac','electrical','roofing','mixed'].map(t=><option key={t} value={t}>{l[t]}</option>)}</select></label>
    <label className={styles.check}><input type="checkbox" checked={config.onlyDrawingDiscipline} onChange={e=>setConfig(c=>({...c,onlyDrawingDiscipline:e.target.checked,discipline:c.discipline==='unknown'?detected.discipline:c.discipline}))}/>{l.only}</label>
    <div className={styles.trades}>{BOQ_TRADES.map(t=><label key={t}><input type="checkbox" checked={active.includes(t)} disabled={config.onlyDrawingDiscipline} onChange={e=>change('trades',e.target.checked?[...config.trades,t]:config.trades.filter(x=>x!==t))}/>{l[t]}</label>)}</div>
    <label className={styles.check}><input type="checkbox" checked={config.defaultsEnabled} onChange={e=>change('defaultsEnabled',e.target.checked)}/>{l.defaults}</label>
    {config.defaultsEnabled&&<div className={styles.fields}>
     {[['wallHeight','height',2,8,.1],['lightsPerRoom','lights',1,20,1],['cabinetLength','cabinet',0,30,.1],['waterproofUpstand','upstand',0,1,.01]].map(([key,label,min,max,step])=><label key={key}>{l[label]}<input type="number" min={min} max={max} step={step} value={config[key]} onChange={e=>change(key,e.target.value)}/></label>)}
     <label>{l.floor}<select value={config.floorFinish} onChange={e=>change('floorFinish',e.target.value)}>{['ceramic','porcelain','stone','wood','cement'].map(v=><option key={v} value={v}>{l[v]}</option>)}</select></label>
     <label>{l.wall}<select value={config.wallFinish} onChange={e=>change('wallFinish',e.target.value)}>{['paint','plaster','tile','none'].map(v=><option key={v} value={v}>{l[v]}</option>)}</select></label>
     <label>{l.ceiling}<select value={config.ceilingFinish} onChange={e=>change('ceilingFinish',e.target.value)}>{['paint','gypsum','none'].map(v=><option key={v} value={v}>{l[v]}</option>)}</select></label>
     <label className={styles.check}><input type="checkbox" checked={config.screedEnabled} onChange={e=>change('screedEnabled',e.target.checked)}/>{l.screed}</label>
    </div>}
    <label>{l.notes}<textarea maxLength={4000} value={config.specifications} onChange={e=>change('specifications',e.target.value)}/></label>
   </fieldset>
   <p>{l.notice}</p>
   <div className={styles.actions}><button type="button" disabled={!loaded||disabled} onClick={()=>save(!!onApply)}>{onApply?l.apply:l.save}</button>{onRestore&&<button type="button" disabled={disabled} onClick={async()=>{try{await onRestore();const next=writeBoqScope(localStorage,projectId,{...config,enabled:false});setConfig(next);setError('');}catch(e){setError(e.message);}}}>{l.restore}</button>}</div>
   {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </div>
  {report&&<section aria-label={l.missing}>
   {report.sourceDocumentName&&<p>{language==='fa'?'مرجع گزارش محدوده: ':'Scope report source: '}{report.sourceDocumentName}</p>}
   <strong>{report.activeTrades.map(t=>l[t]||t).join(' · ')}</strong>
   <p>{report.assumedRows} {l.assumed} · {report.excludedRows} {l.out}</p>
   <p>{l.excluded}</p>{report.unpricedAssumptions>0&&<p role="alert">{language==='fa'?`${report.unpricedAssumptions} ردیف فرضی هنوز نرخ قطعی انتخاب‌شده ندارد؛ از کتابخانه قیمت انتخاب یا نرخ دستی وارد کنید.`:`${report.unpricedAssumptions} assumed rows need a matching catalog selection or manual rate.`}</p>}
   {report.specifications&&<p>{report.specifications}</p>}
   {report.gaps.length>0&&<><h4>{l.missing}</h4><div className={styles.table}><table><thead><tr><th>{l.title}</th><th>{l.missing}</th></tr></thead><tbody>{report.gaps.map(g=><tr key={g.trade}><td>{l[g.trade]||g.trade}</td><td>{language==='fa'?(scopeRequiredFa[g.trade]||g.required):g.required}<br/>{language==='fa'?'نقشه تکمیلی بارگذاری کنید یا مقدار را دستی وارد کنید. بخش نامعلوم در جمع لحاظ نشده است.':g.action}{onAddManual&&BOQ_TRADES.includes(g.trade)&&<button type="button" disabled={disabled} onClick={()=>openManual(g.trade)}>{l.manual}</button>}</td></tr>)}</tbody></table></div><p className="commercial-no-print"><a className={styles.uploadLink} href={drawingUploadHref(projectId)}>{l.upload} ↗</a></p></>}
  </section>}
  {manual&&<form ref={manualRef} className={`${styles.manualForm} commercial-no-print`} onSubmit={submitManual} aria-label={l.manual}>
   <h4>{l.manual} — {l[manual.trade]}</h4>
   <fieldset disabled={manualBusy||disabled}>
    <label>{language==='fa'?'شرح عملیات':'Description'}<input required maxLength={1000} value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})}/></label>
    <div className={styles.fields}>
     <label>{language==='fa'?'مقدار':'Quantity'}<input required type="number" min="0.0001" step="any" value={manual.quantity} onChange={e=>setManual({...manual,quantity:e.target.value})}/></label>
     <label>{language==='fa'?'واحد':'Unit'}<select value={manual.unit} onChange={e=>setManual({...manual,unit:e.target.value})}>{['m²','m³','m','nos','kg','ton','lot','item'].map(u=><option key={u}>{u}</option>)}</select></label>
     <label>{language==='fa'?'نرخ واحد (درهم)؛ خالی یعنی نیازمند قیمت':'Unit rate (AED); blank means unpriced'}<input type="number" min="0" step="any" value={manual.rate} onChange={e=>setManual({...manual,rate:e.target.value})}/></label>
    </div>
    <label>{language==='fa'?'مبنای مقدار و توضیحات':'Quantity basis / notes'}<textarea maxLength={2000} value={manual.basis} onChange={e=>setManual({...manual,basis:e.target.value})}/></label>
    <p>{language==='fa'?'این ردیف دستی است و تأیید خودکار متره محسوب نمی‌شود.':'This is a manual line, not automatically verified takeoff.'}</p>
    <div className={styles.actions}><button type="submit">{language==='fa'?'ذخیره و افزودن به BOQ':'Save and add to BOQ'}</button><button type="button" onClick={()=>setManual(null)}>{language==='fa'?'انصراف':'Cancel'}</button></div>
   </fieldset>{manualError&&<p role="alert">{manualError}</p>}
  </form>}
  {unclassified.length>0&&onClassify&&<details className="commercial-no-print"><summary>{l.assign} ({unclassified.length})</summary>{unclassified.map(i=><label key={i.id}>{i.description}<select value="" disabled={disabled} onChange={async e=>{const trade=e.target.value;try{await onClassify(i.id,trade);setError('');setMessage((language==='fa'?'دسته‌بندی ذخیره شد: ':'Classification saved: ')+(l[trade]||trade)+(report&&!report.activeTrades.includes(trade)?(language==='fa'?'؛ برای ورود به جمع، تیک این رشته را در محدوده فعال کنید.':'; enable this trade in scope to include it in the total.') :''));}catch(err){setError(err.message);}}}><option value="">{l.select}</option>{BOQ_TRADES.map(t=><option key={t} value={t}>{l[t]}</option>)}</select></label>)}</details>}
 </aside>;
}
