'use client';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {FURNITURE_CATALOG,applyFurnitureEdit,previewFurnitureEdit,furnitureRotationFromDrag,furnitureSizeFromDrag} from '@/lib/furnitureEditor.mjs';
import styles from './FurnitureEditorPanel.module.css';
import ToolDrawer from './ToolDrawer';
const words={en:{title:'Furniture studio',note:'Lightweight models · walls, doors and building materials locked · no BOQ changes',camera:'Camera',add:'Place selected model',select:'Select / drag furniture',top:'Top view',help:'Choose a model, then tap the floor. Desktop: drag a model onto the floor. Green = valid; red = blocked. Switch to Camera to orbit.',choose:'Furniture in scene',rotate:'Rotate 15°',color:'Apply color',replace:'Replace with selected model',remove:'Delete',undo:'Undo',saved:'Furniture saved.',busy:'Saving…'},fa:{title:'پنل مبلمان',note:'مدل‌های سبک · دیوار، در و مصالح ساختمان قفل‌اند · بدون تغییر BOQ',camera:'دوربین',add:'جای‌گذاری مدل انتخاب‌شده',select:'انتخاب / کشیدن مبلمان',top:'نمای بالا',help:'مدل را انتخاب کن و روی کف بزن. روی کامپیوتر می‌توانی مدل را روی کف بکشی. سبز: مجاز؛ قرمز: مسدود. برای چرخش به حالت دوربین برو.',choose:'مبلمان داخل مدل',rotate:'چرخش ۱۵ درجه',color:'اعمال رنگ',replace:'تعویض با مدل انتخاب‌شده',remove:'حذف',undo:'برگشت',saved:'مبلمان ذخیره شد.',busy:'در حال ذخیره…'},ar:{title:'لوحة الأثاث',note:'نماذج خفيفة · الجدران والأبواب ومواد المبنى مقفلة · دون تغيير BOQ',camera:'الكاميرا',add:'وضع النموذج المختار',select:'اختيار / سحب الأثاث',top:'منظر علوي',help:'اختر نموذجاً ثم المس الأرضية. على الحاسوب اسحب النموذج إلى الأرضية. الأخضر مسموح والأحمر محظور. اختر الكاميرا للدوران.',choose:'أثاث المشهد',rotate:'دوران ١٥°',color:'تطبيق اللون',replace:'استبدال بالنموذج المختار',remove:'حذف',undo:'تراجع',saved:'تم حفظ الأثاث.',busy:'جارٍ الحفظ…'}};
export default function FurnitureEditorPanel({scene,getRenderer,onCommit,disabled=false}){
 const {language}=useLanguage(),lang=words[language]?language:'en',t=words[lang];
 const [open,setOpen]=useState(false),[mode,setMode]=useState('camera'),[catalogId,setCatalogId]=useState('sofa-modern'),[selected,setSelected]=useState(''),[color,setColor]=useState('#b4a28f'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[undoCount,setUndoCount]=useState(0);
 const latest=useRef(null),history=useRef([]),working=useRef(false);
 const object=scene.assets.find(a=>a.id===selected);
 const label=a=>FURNITURE_CATALOG.find(m=>m.id===a.catalogId||(!a.catalogId&&m.type===a.type))?.[lang]||a.type;
 async function save(edit,undo=false){
  const state=latest.current;if(working.current||state.disabled)return;
  working.current=true;setBusy(true);setMessage('');
  try{
   const next=undo?history.current.at(-1):applyFurnitureEdit(state.scene,edit);
   if(!next)return;
   await state.onCommit(next,state.scene);
   if(undo)history.current.pop();else{history.current.push(state.scene);if(history.current.length>20)history.current.shift();}
   setUndoCount(history.current.length);setMessage(state.t.saved);
  }catch(error){setMessage(error.message);}finally{working.current=false;setBusy(false);}
 }
 useEffect(()=>{latest.current={scene,disabled:disabled||busy,mode,catalogId,selected,onCommit,t,save};});
 useEffect(()=>{
  const renderer=getRenderer();if(!renderer)return;
  if(mode==='camera'||disabled||busy){renderer.setFurnitureTool?.(null);return;}
  const edit=(point,data,event)=>{
   const s=latest.current;
   if(s.mode==='rotate')return data?{kind:'rotate',assetId:data.id,rotation:furnitureRotationFromDrag(data.rotation,data.startX,event)}:null;
   if(s.mode==='resize')return data?{kind:'resize',assetId:data.id,size:furnitureSizeFromDrag(data.dimensions,data.startX,event)}:null;
   return s.mode==='add'?{kind:'add',catalogId:s.catalogId,point}:{kind:'move',assetId:data?.id||s.selected,point:{x:point.x+(data?.dx||0),y:point.y+(data?.dy||0)}};
  };
  renderer.setFurnitureTool?.({
   start:(id,point,event)=>{
    const s=latest.current;if(s.mode==='add')return {};
    const a=s.scene.assets.find(a=>a.id===(id||(['rotate','resize'].includes(s.mode)?s.selected:null)));if(!a)return false;
    setSelected(a.id);if(a.color)setColor(a.color);
    return {id:a.id,dx:a.xMeters-point.x,dy:a.yMeters-point.y,rotation:a.rotation||0,startX:event.clientX,dimensions:{width:a.width,depth:a.depth,height:a.height}};
   },
   preview:(point,data,event)=>{const operation=edit(point,data,event);return operation?previewFurnitureEdit(latest.current.scene,operation):null;},
   commit:(point,data,moved,event)=>{const s=latest.current;if(s.disabled)return;if(['select','rotate','resize'].includes(s.mode)&&!moved)return;const operation=edit(point,data,event);if(operation)return s.save(operation);}
  });
  return()=>renderer.setFurnitureTool?.(null);
 },[getRenderer,open,mode,disabled,busy]);
 const blocked=disabled||busy;
 return <section className={styles.panel} dir={lang==='en'?'ltr':'rtl'}>
  <div className={styles.quickTools} role="group" aria-label={t.title}>
   <button type="button" aria-pressed={mode==='camera'} onClick={()=>setMode('camera')}>{t.camera}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='select'} onClick={()=>setMode('select')}>{t.select}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='rotate'} onClick={()=>setMode('rotate')}>{lang==='fa'?'چرخش با ماوس':lang==='ar'?'الدوران بالسحب':'Rotate by dragging'}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='resize'} onClick={()=>setMode('resize')}>{lang==='fa'?'تغییر اندازه با ماوس':lang==='ar'?'تغيير الحجم بالسحب':'Resize by dragging'}</button>
  </div>
  {mode!=='camera'&&<p role="status">{lang==='fa'?'روی وسیله کلیک کن و بکش؛ رها کردن برای ذخیره.':lang==='ar'?'اضغط على الأثاث واسحب؛ أفلت للحفظ.':'Click furniture and drag; release to save.'}</p>}
  <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);setMode('camera');}}>{t.title} {open?'−':'+'}</button>
  {open&&<><p>{t.note}</p><div className={styles.tools}>
   <button type="button" disabled={blocked} aria-pressed={mode==='add'} onClick={()=>setMode('add')}>{t.add}</button>
   <button type="button" disabled={blocked} onClick={()=>getRenderer()?.setNamedView?.('top')}>{t.top}</button>
   <button type="button" disabled={blocked||!undoCount} onClick={()=>save(null,true)}>{t.undo}</button>
  </div>{mode==='resize'&&<p>{lang==='fa'?'روی وسیله کلیک کن و به راست بکش تا بزرگ‌تر، یا به چپ بکش تا کوچک‌تر شود. تناسب طول، عرض و ارتفاع حفظ می‌شود؛ با رها کردن ذخیره می‌شود.':lang==='ar'?'اسحب الأثاث يميناً للتكبير أو يساراً للتصغير؛ تبقى نسب الطول والعرض والارتفاع ثابتة. أفلت للحفظ.':'Drag furniture right to enlarge or left to shrink. Width, depth and height scale together; release to save.'}</p>}<p>{mode==='rotate'?(lang==='fa'?'روی وسیله کلیک کن و به چپ یا راست بکش؛ با رها کردن ذخیره می‌شود. Shift: گام‌های ۱۵ درجه. روی گوشی با انگشت بکش.':lang==='ar'?'اضغط على الأثاث واسحب يميناً أو يساراً؛ يتم الحفظ عند الإفلات. Shift: خطوات ١٥ درجة. على الهاتف اسحب بإصبعك.':'Drag furniture left or right to rotate; release to save. Hold Shift for 15° steps. On mobile, drag with one finger.'):mode==='resize'?'':t.help}</p><ToolDrawer title="catalog"><div className={styles.catalog}>
   {FURNITURE_CATALOG.map(m=><button key={m.id} type="button" draggable={!blocked} disabled={blocked} aria-pressed={catalogId===m.id} onDragStart={e=>{e.dataTransfer.setData('text/plain',m.id);e.dataTransfer.effectAllowed='copy';setCatalogId(m.id);setMode('add');}} onClick={()=>{setCatalogId(m.id);setMode('add');}}>
    <span className={styles.swatch} style={{background:m.color}} aria-hidden="true"/>{m[lang]}<small>{m.width} × {m.depth} m</small>
   </button>)}
  </div></ToolDrawer><ToolDrawer title="edit"><div className={styles.tools}>
   <label>{t.choose}<select disabled={blocked} value={object?selected:''} onChange={e=>{setSelected(e.target.value);const a=scene.assets.find(a=>a.id===e.target.value);if(a?.color)setColor(a.color);}}><option value="">—</option>{scene.assets.map(a=><option key={a.id} value={a.id}>{label(a)} · {scene.rooms.find(r=>r.id===a.roomId)?.name||a.roomId} · {a.id}</option>)}</select></label>
   {object&&<span dir="ltr">{object.width?.toFixed(2)} × {object.depth?.toFixed(2)} × {object.height?.toFixed(2)} m</span>}
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'rotate',assetId:selected,rotation:(object.rotation||0)+15})}>{t.rotate}</button>
   <input type="color" aria-label={t.color} value={color} onChange={e=>setColor(e.target.value)} disabled={blocked||!object}/>
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'color',assetId:selected,color})}>{t.color}</button>
   <button type="button" disabled={blocked||!object||FURNITURE_CATALOG.find(m=>m.id===catalogId)?.type!==object.type} onClick={()=>save({kind:'replace',assetId:selected,catalogId})}>{t.replace}</button>
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'remove',assetId:selected})}>{t.remove}</button>
  </div></ToolDrawer></>}
  {(busy||message)&&<p role="status">{busy?t.busy:message}</p>}
 </section>;
}
