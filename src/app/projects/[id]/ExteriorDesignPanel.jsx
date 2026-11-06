'use client';
import {useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {FACADE_PRESETS,applyFacade,editExteriorBox,exteriorFaces} from '@/lib/exteriorDesign.mjs';
import {SURFACE_MATERIALS} from '@/lib/surfaceMaterials.mjs';
import styles from './FurnitureEditorPanel.module.css';
const defaults={x:0,y:0,z:0,width:1,depth:.2,height:1,rotation:0,color:'#ffffff',material:'stone-ivory'};
export default function ExteriorDesignPanel({scene,onCommit,disabled=false}){
 const {language}=useLanguage(),fa=language==='fa',t=(en,faText)=>fa?faText:en;
 const [preset,setPreset]=useState(scene.exteriorDesign?.preset||'stone'),[material,setMaterial]=useState(scene.exteriorDesign?.material||'stone-beige'),[color,setColor]=useState(scene.exteriorDesign?.color||'#ffffff');
 const [draft,setDraft]=useState(defaults),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[undoCount,setUndoCount]=useState(0);
 const history=useRef([]),working=useRef(false),blocked=disabled||busy;
 const boxes=scene.exteriorDesign?.boxes||[],faces=exteriorFaces(scene);
 const field=(k,v)=>setDraft(d=>({...d,[k]:v}));
 async function save(next,undo=false){
  if(blocked||working.current)return;working.current=true;setBusy(true);setMessage('');
  try{
   const previous=history.current.at(-1);
   if(undo&&(!previous||JSON.stringify(previous.afterDesign)!==JSON.stringify(scene.exteriorDesign)||JSON.stringify(previous.afterFinish)!==JSON.stringify(scene.surfaceFinishes)))throw new Error(t('Design changed after this edit; undo is unavailable.','نما بعد از این مرحله تغییر کرده؛ برگشت این مرحله مجاز نیست.'));
   const result=undo?{...scene,exteriorDesign:previous.design,surfaceFinishes:previous.finish}:next();
   await onCommit(result,scene);
   if(undo)history.current.pop();else{history.current.push({design:scene.exteriorDesign,finish:scene.surfaceFinishes,afterDesign:result.exteriorDesign,afterFinish:result.surfaceFinishes});if(history.current.length>20)history.current.shift();}
   setUndoCount(history.current.length);setMessage(t('Exterior design saved.','طرح نما ذخیره شد.'));
  }catch(e){setMessage(e.message);}finally{working.current=false;setBusy(false);}
 }
 return <details className={styles.panel} dir={fa?'rtl':'ltr'}><summary>{t('Exterior facade & manual boxes','طراحی نمای خارجی و باکس دستی')}</summary>
  <p>{t('Exterior faces only. Decorative proposals are separate from BOQ. Coordinates are in plan metres; Z is height above the floor.','فقط سطح بیرونی دیوارها. تغییرات تزئینی وارد BOQ نمی‌شوند. مختصات بر حسب مترِ نقشه است؛ Z ارتفاع از کف است.')}</p>
  <div className={styles.tools}>
   <label>{t('Style','سبک')}<select disabled={blocked} value={preset} onChange={e=>{const p=FACADE_PRESETS.find(p=>p.id===e.target.value);setPreset(p.id);setMaterial(p.material);setColor('#ffffff');}}>{FACADE_PRESETS.map(p=><option key={p.id} value={p.id}>{fa?p.fa:p.en}</option>)}</select></label>
   <label>{t('Facade material','متریال نما')}<select disabled={blocked} value={material} onChange={e=>setMaterial(e.target.value)}>{SURFACE_MATERIALS.filter(m=>['stone','brick','wood','paint','cement'].includes(m.kind)).map(m=><option key={m.id} value={m.id}>{m[language]||m.en||m.id}</option>)}</select></label>
   <label>{t('Color tint (white = original)','رنگ ترکیبی (سفید = رنگ اصلی)')}<input type="color" value={color} disabled={blocked} onChange={e=>setColor(e.target.value)}/></label>
   <button type="button" disabled={blocked||!faces.length} onClick={()=>save(()=>applyFacade(scene,{preset,material,color}))}>{t('Apply to exterior walls','اعمال روی دیوارهای بیرونی')} ({faces.length})</button>
  </div>
  {!faces.length&&<p>{t('An editable building outline is needed to identify exterior faces.','برای تشخیص دیوار بیرونی، محدودهٔ معتبر ساختمان در مدل لازم است.')}</p>}
  <p>{t('Roman style adds decorative pilasters and cornices where openings permit.','سبک رومی، در محل‌های آزاد از بازشو، ستون‌نما و ابزار تاج اضافه می‌کند.')}</p>
  <fieldset disabled={blocked}><legend>{t('Manual decorative box','باکس تزئینی دستی')}</legend><div className={styles.tools}>
   <label>{t('Existing box','باکس موجود')}<select value={selected} onChange={e=>{setSelected(e.target.value);setDraft(boxes.find(b=>b.id===e.target.value)||defaults);}}><option value="">{t('New box','باکس جدید')}</option>{boxes.map((b,i)=><option key={b.id} value={b.id}>{t('Box','باکس')} {i+1}</option>)}</select></label>
   {['x','y','z','width','depth','height','rotation'].map(k=><label key={k}>{({x:'X (m)',y:'Y (m)',z:t('Z / floor height (m)','Z / ارتفاع از کف'),width:t('Width (m)','عرض (متر)'),depth:t('Depth (m)','عمق (متر)'),height:t('Height (m)','ارتفاع (متر)'),rotation:t('Rotation (°)','چرخش (درجه)')})[k]}<input type="number" value={draft[k]} min={['width','depth','height'].includes(k)?.02:k==='z'?0:undefined} max={['width','depth','height'].includes(k)?30:undefined} step={k==='rotation'?5:.05} onChange={e=>field(k,e.target.value===''?'':Number(e.target.value))}/></label>)}
   <label>{t('Box material','متریال باکس')}<select value={draft.material} onChange={e=>field('material',e.target.value)}>{SURFACE_MATERIALS.map(m=><option key={m.id} value={m.id}>{m[language]||m.en||m.id}</option>)}</select></label>
   <label>{t('Box color tint','رنگ باکس')}<input type="color" value={draft.color} onChange={e=>field('color',e.target.value)}/></label>
   <button type="button" onClick={()=>save(()=>editExteriorBox(scene,{...draft,kind:'add'}))}>{t('Add box','افزودن باکس')}</button>
   <button type="button" disabled={!selected} onClick={()=>save(()=>editExteriorBox(scene,{...draft,id:selected,kind:'update'}))}>{t('Save selected box','ذخیره باکس انتخاب‌شده')}</button>
   <button type="button" disabled={!selected} onClick={()=>save(()=>{const next=editExteriorBox(scene,{kind:'remove',id:selected});return next;})}>{t('Delete selected box','حذف باکس انتخاب‌شده')}</button>
  </div></fieldset>
  <button type="button" disabled={blocked||!undoCount} onClick={()=>save(null,true)}>{t('Undo exterior edit','برگشت تغییر نما')}</button>
  {(busy||message)&&<p role="status">{busy?t('Saving…','در حال ذخیره…'):message}</p>}
 </details>;
}
