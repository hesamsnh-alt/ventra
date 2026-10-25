'use client';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {SURFACE_GROUPS,SURFACE_MATERIALS,SURFACE_MIME,applySurfaceMaterial,paintSurfaceSwatch,assertSurfaceOnlyEdit,surfaceMaterialAllowed} from '@/lib/surfaceMaterials.mjs';
import {bindSurfaceMaterialInputs,bindSurfaceMaterialUndo} from '@/lib/surfaceMaterialInputs.mjs';
import styles from './SurfaceMaterialPanel.module.css';

function Swatch({material,label,selected,disabled,onChoose}){
  const canvas=useRef(null);
  useEffect(()=>paintSurfaceSwatch(canvas.current,material),[material]);
  return <button type="button" className={styles.swatch} draggable={!disabled} disabled={disabled}
    aria-pressed={selected} aria-label={label} title={label}
    onClick={()=>onChoose(material.id)}
    onDragStart={e=>{if(disabled){e.preventDefault();return;}onChoose(material.id);e.dataTransfer.setData(SURFACE_MIME,material.id);e.dataTransfer.effectAllowed='copy';}}>
    <canvas ref={canvas} width={128} height={128} aria-hidden="true" />
    <span>{label}</span>
  </button>;
}

export default function SurfaceMaterialPanel({scene,getRenderer,getCanvasHost,onCommit,onModeChange,disabled=false}){
  const {language}=useLanguage(),lang=['fa','ar'].includes(language)?language:'en';
  const text=(en,fa,ar)=>lang==='fa'?fa:lang==='ar'?ar:en;
  const [group,setGroup]=useState('stone'),[selected,setSelected]=useState('stone-ivory'),[paintMode,setPaintMode]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hover,setHover]=useState(null),[lastTarget,setLastTarget]=useState(null),[undoCount,setUndoCount]=useState(0);
  const history=useRef([]),working=useRef(false),latest=useRef(null),panelRef=useRef(null);
  async function apply(target,id,undo=false){
    const state=latest.current;if(working.current||state.disabled)return;
    if(!undo&&!target){setMessage(text('Drop onto a visible floor or wall.','روی بخش قابل‌دیدن کف یا دیوار رها کن.','أفلت على أرضية أو جدار ظاهر.'));return;}
    if(!undo&&id!==null&&!surfaceMaterialAllowed(id,target)){setMessage(text('Paint and wallpaper apply to walls only.','رنگ و کاغذدیواری را روی دیوار اعمال کن.','الدهان وورق الجدران للجدران فقط.'));return;}
    working.current=true;setBusy(true);setMessage('');
    try{
      const previous=history.current.at(-1);
      if(undo&&(!previous||JSON.stringify(previous.after)!==JSON.stringify(state.scene.surfaceFinishes)))throw new Error(text('Materials changed; undo is no longer available.','متریال‌ها تغییر کرده‌اند؛ این مرحله قابل برگشت نیست.','تغيرت المواد؛ التراجع غير متاح.'));
      const next=undo?{...state.scene,surfaceFinishes:previous.before}:applySurfaceMaterial(state.scene,target,id);
      assertSurfaceOnlyEdit(state.scene,next);
      await state.onCommit(next,state.scene);
      if(undo)history.current.pop();else{
        history.current.push({before:state.scene.surfaceFinishes,after:next.surfaceFinishes});if(history.current.length>20)history.current.shift();setLastTarget(target);
      }
      setUndoCount(history.current.length);setMessage(text('Material saved.','متریال ذخیره شد.','تم حفظ المادة.'));
    }catch(error){setMessage(error.message);}finally{working.current=false;setBusy(false);}
  }
  latest.current={scene,materialId:selected,paintMode,disabled:disabled||busy,onCommit,apply,getRenderer,canUndo:undoCount>0};
  useEffect(()=>{
    const host=getCanvasHost();if(!host)return;
    const originalTabIndex=host.getAttribute('tabindex');if(originalTabIndex===null)host.tabIndex=0;
    const focus=()=>host.focus({preventScroll:true});host.addEventListener('pointerdown',focus,true);
    const unbindInputs=bindSurfaceMaterialInputs(host,{getState:()=>latest.current,getRenderer:()=>latest.current.getRenderer(),
      onApply:(target,id)=>latest.current.apply(target,id),onHover:setHover});
    const unbindUndo=bindSurfaceMaterialUndo(host,panelRef.current,()=>latest.current,()=>latest.current.apply(null,null,true));
    return ()=>{unbindInputs();unbindUndo();host.removeEventListener('pointerdown',focus,true);if(originalTabIndex===null&&host.getAttribute('tabindex')==='0')host.removeAttribute('tabindex');};
  },[scene,disabled]);
  useEffect(()=>{onModeChange(paintMode);return()=>onModeChange(false);},[paintMode,onModeChange]);
  function choose(id){setSelected(id);setPaintMode(true);getRenderer()?.setFurnitureTool?.(null);}
  const targetName=target=>!target?'':`${target.kind==='wall'?text('Wall face','وجه دیوار','وجه الجدار'):text('Floor','کف','أرضية')} · ${target.id}`;
  return <section ref={panelRef} className={styles.panel} dir={lang==='en'?'ltr':'rtl'} aria-label={text('Surface materials','متریال کف و دیوار','مواد الأرضيات والجدران')}>
    <details open><summary>{text('Floor & wall materials','متریال کف و دیوار','مواد الأرضيات والجدران')}</summary>
      <p>{text('Drag a swatch onto a floor or one wall face. Or select a swatch, then click that face.','نمونه را روی کف یا یک وجه دیوار بکش و رها کن؛ یا نمونه را انتخاب کن و روی همان وجه بزن.','اسحب العينة إلى الأرضية أو وجه الجدار، أو اخترها ثم اضغط على الوجه المطلوب.')}</p>
      <div className={styles.groups} aria-label={text('Material categories','گروه متریال','فئات المواد')}>
        {SURFACE_GROUPS.map(g=><button key={g.id} type="button" aria-pressed={group===g.id} onClick={()=>setGroup(g.id)}>{g[lang]}</button>)}
      </div>
      <div className={styles.grid}>
        {SURFACE_MATERIALS.filter(m=>m.kind===group).map(m=><Swatch key={m.id} material={m} label={m[lang]} selected={selected===m.id} disabled={disabled||busy} onChoose={choose}/>)}
      </div>
      {['paint','wallpaper'].includes(group)&&<p>{text('For walls only.','مخصوص دیوار.','للجدران فقط.')}</p>}
      <div className={styles.actions}>
        <button type="button" aria-pressed={!paintMode} onClick={()=>setPaintMode(false)}>{text('Camera','حرکت دوربین','الكاميرا')}</button>
        <button type="button" title="Ctrl+Z / Cmd+Z" disabled={disabled||busy||!undoCount} onClick={()=>apply(null,null,true)}>{text('Undo · Ctrl+Z','برگشت · Ctrl+Z','تراجع · Ctrl+Z')}</button>
        <button type="button" disabled={disabled||busy||!lastTarget} onClick={()=>apply(lastTarget,null)}>{text('Original surface','متریال اولیه سطح','المادة الأصلية')}</button>
      </div>
      <div className={styles.feedback} role="status" aria-live="polite">{busy?text('Saving…','در حال ذخیره…','جارٍ الحفظ…'):hover?targetName(hover):message|| (paintMode?text('Click a floor or wall to apply.','برای اعمال، روی کف یا دیوار بزن.','اضغط على أرضية أو جدار للتطبيق.'):text('Drag a swatch to begin.','یک نمونه را روی سطح بکش.','اسحب عينة للبدء.'))}</div>
      {lastTarget&&<small>{text('Last surface','آخرین سطح','آخر سطح')}: {targetName(lastTarget)}</small>}
    </details>
  </section>;
}
