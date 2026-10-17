'use client';
import {SURFACE_MIME} from '@/lib/surfaceMaterials.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {loadPersonalLibrary,createFurnitureFromPhoto,pollPersonalModel,uploadPersonalMaterial,preparePersonalPhoto,savePersonalAssetDetails,uploadPersonalGlb} from '@/services/personalAssetService';
import {PERSONAL_FURNITURE_TYPES,personalDimensions} from '@/lib/personalAssets.mjs';
import PersonalModelPreview from './PersonalModelPreview';
import styles from './PersonalAssetLibrary.module.css';
export default function PersonalAssetLibrary({kind,projectId,onChoose,disabled=false}){
 const{language}=useLanguage(),fa=language==='fa',ar=language==='ar',text=(en,f,a)=>fa?f:ar?a:en;
 const[assets,setAssets]=useState([]),[jobs,setJobs]=useState([]),[config,setConfig]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState(null),[dimensions,setDimensions]=useState({width:1,depth:1,height:1});
 const glbPicker=useRef(null),picker=useRef(null),active=useRef(true),working=useRef(false),polling=useRef(false);
 const refresh=useCallback(async()=>{
  const result=await loadPersonalLibrary();if(!active.current)return;
  setAssets(result.assets);setJobs(result.jobs);setConfig(result.configuration);
 },[]);
 useEffect(()=>{active.current=true;refresh().catch(e=>{if(active.current)setMessage(e.message);});return()=>{active.current=false;};},[refresh]);
 useEffect(()=>{
  if(kind!=='model'||!jobs.some(j=>['submitting','pending'].includes(j.status)))return;
  const timer=setInterval(async()=>{
   if(polling.current)return;polling.current=true;
   try{for(const job of jobs.filter(j=>['submitting','pending'].includes(j.status)))await pollPersonalModel(job.id);await refresh();}
   catch(e){if(active.current)setMessage(e.message);}finally{polling.current=false;}
  },8000);
  return()=>clearInterval(timer);
 },[jobs,kind,refresh]);
 async function upload(file){
  if(!file||working.current||disabled)return;working.current=true;setBusy(true);setMessage('');
  try{
   const imageUrl=await preparePersonalPhoto(file),name=file.name.replace(/\.[^.]+$/,'').slice(0,100)||'Personal asset';
   if(kind==='model'){
    const result=await createFurnitureFromPhoto({projectId,imageUrl,name});
    if(result.job.status==='failed')throw new Error(result.job.error||'Previous generation failed; choose a revised photo. / تولید قبلی ناموفق بود؛ عکس اصلاح‌شده انتخاب کن.');
    if(active.current)setMessage(result.job.status==='ready'?text('This photo is already in your library.','این عکس قبلاً به مدل تبدیل و ذخیره شده است.','هذه الصورة موجودة في مكتبتك.'):text('Model request saved. You can leave and return.','درخواست ذخیره شد؛ می‌توانی خارج شوی و بعد برگردی.','تم حفظ الطلب؛ يمكنك العودة لاحقاً.'));
   }else{const saved=await uploadPersonalMaterial({projectId,imageUrl,name});if(active.current){setSelected(saved.asset);await onChoose(saved.asset);}if(active.current)setMessage(text('Material saved to your library.','متریال در کتابخانه ذخیره شد.','تم حفظ المادة.'));}
   await refresh();
  }catch(e){if(active.current){setMessage(e.message);await refresh().catch(()=>{});}}
  finally{working.current=false;if(active.current)setBusy(false);}
 }
 async function uploadGlb(file){
  if(!file||working.current||disabled)return;working.current=true;setBusy(true);setMessage('');
  try{await uploadPersonalGlb({file,projectId});if(active.current)setMessage(text('GLB saved. Select it and set real dimensions.','مدل ذخیره شد؛ آن را انتخاب و ابعاد واقعی را تنظیم کن.','تم حفظ النموذج؛ اضبط أبعاده.'));await refresh();}
  catch(e){if(active.current)setMessage(e.message);}finally{working.current=false;if(active.current)setBusy(false);}
 }
 function choose(row){setSelected(row);setDimensions({width:Number(row.width),depth:Number(row.depth),height:Number(row.height)});if(kind==='material')Promise.resolve().then(()=>onChoose(row)).then(()=>{if(active.current)setMessage(text('Click a visible wall face or floor to apply.','حالا برای اعمال روی وجه قابل‌دیدن دیوار یا کف کلیک کن.','اضغط على وجه الجدار أو الأرضية.'));}).catch(e=>{if(active.current)setMessage(e.message);});}
 async function useSelected(){
  if(!selected||working.current)return;working.current=true;setBusy(true);setMessage('');
  try{
   let row=selected;
   if(kind==='model'){const size=personalDimensions(dimensions);row={...row,...size};await savePersonalAssetDetails({assetId:row.id,name:row.name,furniture_type:row.furniture_type,...size});}
   await onChoose(row);
   if(active.current)setMessage(kind==='model'?text('Now click a clear floor area to place the model.','حالا روی بخش خالی کف کلیک کن تا مدل قرار بگیرد.','اضغط على الأرضية لوضع النموذج.'):text('Now click the floor or wall face.','حالا روی کف یا وجه دیوار کلیک کن.','اضغط على الأرضية أو وجه الجدار.'));
  }catch(e){if(active.current)setMessage(e.message);}finally{working.current=false;if(active.current)setBusy(false);}
 }
 const blocked=disabled||busy,visible=assets.filter(a=>a.kind===kind);
 return <section className={styles.library} dir={fa||ar?'rtl':'ltr'}>
  <strong>{kind==='model'?text('My photo-to-3D library','کتابخانه مدل از عکس من','مكتبتي من الصورة إلى ثلاثي الأبعاد'):text('My uploaded materials','متریال‌های آپلودشده من','موادي المرفوعة')}</strong>
  <p>{kind==='model'?text('Upload one furniture photo. Generation uses paid Meshy credit and saves the GLB here automatically; it is not measured from the photo.','عکس یک وسیله را آپلود کن؛ تولید با اعتبار پولی Meshy انجام و GLB خودکار اینجا ذخیره می‌شود. اندازه واقعی از عکس مشخص نیست.','ارفع صورة قطعة أثاث؛ يُحفظ GLB تلقائياً باستخدام رصيد Meshy المدفوع. الأبعاد ليست قياسات الصورة.'):text('PNG / JPG / WebP textures; no AI generation fee.','بافت PNG / JPG / WebP؛ بدون هزینه تولید هوش مصنوعی.','خامات PNG / JPG / WebP دون رسوم توليد. ')}</p>
  {kind==='model'&&config&&!config.configured&&<p role="status">{text('The operator must configure and enable Meshy first.','مدیر باید کلید Meshy را تنظیم و تولید را فعال کند.','يجب تفعيل Meshy وإعداد مفتاحه أولاً.')}</p>}
  {kind==='model'&&config&&<p>{text('Daily generation limit per account: ','سقف تولید روزانه هر حساب: ','حد التوليد اليومي: ')}{config.dailyLimit}</p>}
  {kind==='model'&&<><input ref={glbPicker} hidden type="file" accept=".glb,model/gltf-binary" onChange={e=>{const file=e.target.files?.[0];e.target.value='';uploadGlb(file);}}/><button type="button" disabled={blocked} onClick={()=>glbPicker.current?.click()}>{text('Upload ready GLB · no generation fee','آپلود مدل آماده GLB · بدون هزینه تولید','رفع GLB جاهز · دون رسوم توليد')}</button><p>{text('From an iPhone scanner or 3D editor. Up to 25 MB, embedded textures, static mesh, no Draco compression.','از اسکنر آیفون یا نرم‌افزار سه‌بعدی؛ تا ۲۵ مگابایت، مدل ایستا با بافت داخلی و بدون فشرده‌سازی Draco.','من ماسح الهاتف أو محرر 3D؛ حتى 25 MB مع خامات مدمجة ودون Draco.')}</p></>}
  <input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={e=>{const file=e.target.files?.[0];e.target.value='';upload(file);}}/>
  <button className={styles.upload} type="button" disabled={blocked||(kind==='model'&&!config?.configured)} onClick={()=>picker.current?.click()}>{busy?text('Working…','در حال پردازش…','جارٍ التنفيذ…'):kind==='model'?text('Upload photo and generate 3D','آپلود عکس و تولید مدل سه‌بعدی','رفع صورة وتوليد نموذج'):text('Upload material image','آپلود تصویر متریال','رفع صورة مادة')}</button>
  <button type="button" disabled={busy} onClick={()=>refresh().catch(e=>setMessage(e.message))}>{text('Refresh library','تازه‌سازی کتابخانه','تحديث المكتبة')}</button>
  {kind==='model'&&jobs.length>0&&<div className={styles.jobs}>{jobs.map(j=><div key={j.id}><b>{j.name}</b><progress max="100" value={j.progress||0}/><p>{j.status==='failed'?text('Model generation failed. Upload a revised photo after reviewing the issue.','تولید مدل ناموفق بود؛ پس از بررسی خطا عکس اصلاح‌شده انتخاب کن.','فشل التوليد؛ راجع المشكلة ثم ارفع صورة معدلة.'):j.status==='unknown'?text('Submission needs operator reconciliation. Do not generate again.','وضعیت ارسال نیازمند بررسی مدیر است؛ دوباره تولید نکن.','تحتاج حالة الإرسال مراجعة المشغل؛ لا تعِد التوليد.'):text('Generating model…','در حال ساخت مدل…','جارٍ توليد النموذج…')} {j.progress||0}%</p></div>)}</div>}
  <div className={styles.grid}>{visible.map(row=><button className={styles.asset} type="button" key={row.id} aria-pressed={selected?.id===row.id} onClick={()=>choose(row)} disabled={blocked} draggable={kind==='material'&&!blocked} onDragStart={e=>{if(kind!=='material'||blocked){e.preventDefault();return;}choose(row);e.dataTransfer.setData(SURFACE_MIME,'personal:'+row.id);e.dataTransfer.effectAllowed='copy';}}>{row.thumbnailUrl&&<Image unoptimized width={160} height={80} src={row.thumbnailUrl} alt={row.name}/>}<span>{row.name}</span></button>)}</div>
  {selected&&<>{kind==='model'&&<><PersonalModelPreview assetId={selected.id} projectId={projectId} label={selected.name}/><p>{text('Set real dimensions in metres before placing. Initial dimensions are only a proportion-preserving proposal.','پیش از جای‌گذاری، اندازه واقعی را برحسب متر تنظیم کن؛ اندازه اولیه فقط پیشنهادی و متناسب با شکل مدل است.','اضبط الأبعاد الحقيقية بالمتر؛ الأبعاد الأولية مقترحة فقط.')}</p><div className={styles.dimensions}>{[['width','Width','عرض','العرض'],['depth','Depth','عمق','العمق'],['height','Height','ارتفاع','الارتفاع']].map(([key,en,f,a])=><label key={key}>{text(en,f,a)}<input type="number" min=".05" max={key==='width'?6:key==='depth'?4:3} step=".01" value={dimensions[key]} onChange={e=>setDimensions(v=>({...v,[key]:e.target.value}))}/></label>)}</div><label>{text('Furniture category','نوع وسیله','نوع الأثاث')}<select value={selected.furniture_type} onChange={e=>setSelected(v=>({...v,furniture_type:e.target.value}))}>{PERSONAL_FURNITURE_TYPES.map(t=><option key={t} value={t}>{({sofa:'مبل',chair:'صندلی',bed:'تخت',dining_table:'میز غذاخوری',cabinet:'کمد یا وسیله عمومی',plant:'گیاه',desk:'میز کار',coffee_table:'میز جلو مبلی'})[t]&&fa?({sofa:'مبل',chair:'صندلی',bed:'تخت',dining_table:'میز غذاخوری',cabinet:'کمد یا وسیله عمومی',plant:'گیاه',desk:'میز کار',coffee_table:'میز جلو مبلی'})[t]:t}</option>)}</select></label></>}
   <button type="button" disabled={blocked} onClick={useSelected}>{kind==='model'?text('Place this model','جای‌گذاری این مدل','وضع هذا النموذج'):text('Use this material','استفاده از این متریال','استخدام المادة')}</button></>}
  {message&&<p className={styles.feedback} role="status">{message}</p>}
 </section>;
}
