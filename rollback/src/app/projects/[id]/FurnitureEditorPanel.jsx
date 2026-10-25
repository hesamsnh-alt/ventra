'use client';
import {createPortal} from 'react-dom';
import {copyFurnitureSnapshot,applyFurnitureBatch,previewFurnitureBatch,toggleFurnitureSelection,keyboardFurnitureAction} from '@/lib/furnitureBatch.mjs';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {FURNITURE_CATALOG,applyFurnitureEdit,previewFurnitureEdit,furnitureRotationFromDrag,furnitureSizeFromDrag} from '@/lib/furnitureEditor.mjs';
import {applyWallEdit,previewWallEdit,nearestEditableWall,snapWallPoint} from '@/lib/manualWalls.mjs';
import {OPENING_CATALOG,applyOpeningEdit,previewOpeningEdit} from '@/lib/manualOpenings.mjs';
import styles from './FurnitureEditorPanel.module.css';
import ToolDrawer from './ToolDrawer';
const words={en:{title:'Furniture studio',note:'Lightweight models · Furniture edits preserve architecture; walls have a separate editor · no BOQ changes',camera:'Camera',add:'Place selected model',select:'Select / drag furniture',top:'Top view',help:'Choose a model, then tap the floor. Desktop: drag a model onto the floor. Green = valid; red = blocked. Switch to Camera to orbit.',choose:'Furniture in scene',rotate:'Rotate 15°',color:'Apply color',replace:'Replace with selected model',remove:'Delete',undo:'Undo',saved:'Furniture saved.',busy:'Saving…'},fa:{title:'پنل مبلمان',note:'مدل‌های سبک · ویرایش مبلمان جدا از ابزار دیوار است · بدون تغییر BOQ',camera:'دوربین',add:'جای‌گذاری مدل انتخاب‌شده',select:'انتخاب / کشیدن مبلمان',top:'نمای بالا',help:'مدل را انتخاب کن و روی کف بزن. روی کامپیوتر می‌توانی مدل را روی کف بکشی. سبز: مجاز؛ قرمز: مسدود. برای چرخش به حالت دوربین برو.',choose:'مبلمان داخل مدل',rotate:'چرخش ۱۵ درجه',color:'اعمال رنگ',replace:'تعویض با مدل انتخاب‌شده',remove:'حذف',undo:'برگشت',saved:'مبلمان ذخیره شد.',busy:'در حال ذخیره…'},ar:{title:'لوحة الأثاث',note:'نماذج خفيفة · تعديل الأثاث منفصل عن محرر الجدران · دون تغيير BOQ',camera:'الكاميرا',add:'وضع النموذج المختار',select:'اختيار / سحب الأثاث',top:'منظر علوي',help:'اختر نموذجاً ثم المس الأرضية. على الحاسوب اسحب النموذج إلى الأرضية. الأخضر مسموح والأحمر محظور. اختر الكاميرا للدوران.',choose:'أثاث المشهد',rotate:'دوران ١٥°',color:'تطبيق اللون',replace:'استبدال بالنموذج المختار',remove:'حذف',undo:'تراجع',saved:'تم حفظ الأثاث.',busy:'جارٍ الحفظ…'}};
export default function FurnitureEditorPanel({scene,getRenderer,onCommit,onCommitOpenings,onCommitWalls,getCanvasHost,onCameraMode,wallsTransparent,onToggleWalls,disabled=false}){
 const {language}=useLanguage(),lang=words[language]?language:'en',t=words[lang];
 const [open,setOpen]=useState(false),[mode,setMode]=useState('camera'),[catalogId,setCatalogId]=useState('sofa-modern'),[selected,setSelected]=useState(''),[color,setColor]=useState('#b4a28f'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[undoCount,setUndoCount]=useState(0);
 const [selectedIds,setSelectedIds]=useState([]),[multiSelect,setMultiSelect]=useState(false),[host,setHost]=useState(null);
 const panelRef=useRef(null),clipboard=useRef([]);
 const [freePlacement,setFreePlacement]=useState(false),[openingModel,setOpeningModel]=useState('manual-door'),[wallId,setWallId]=useState(''),[openingWidth,setOpeningWidth]=useState(.9),[openingHeight,setOpeningHeight]=useState(2.1),[sill,setSill]=useState(0),[offset,setOffset]=useState(50),[replaceOpenings,setReplaceOpenings]=useState(false),[selectedOpening,setSelectedOpening]=useState(''),[openingUndoCount,setOpeningUndoCount]=useState(0);
 const wallStart=useRef(null),wallHistory=useRef([]);const [wallUndoCount,setWallUndoCount]=useState(0),[wallThickness,setWallThickness]=useState(.12);
 const latest=useRef(null),history=useRef([]),openingHistory=useRef([]),working=useRef(false);
 const text=(en,fa,ar)=>lang==='fa'?fa:lang==='ar'?ar:en;
 const openingConfig={catalogId:openingModel,wallId:wallId||undefined,width:openingWidth,height:openingHeight,sillHeight:sill,offset:offset/100,replaceOverlapping:replaceOpenings};
 async function saveOpening(edit,undo=false){
  const state=latest.current;if(working.current||state.disabled||!state.onCommitOpenings)return;
  working.current=true;setBusy(true);setMessage('');
  try{
   const next=applyOpeningEdit(state.scene,undo?{kind:'restore',openings:openingHistory.current.at(-1)}:edit);
   await state.onCommitOpenings(next,state.scene);
   if(undo)openingHistory.current.pop();else{openingHistory.current.push(state.scene.openings);if(openingHistory.current.length>20)openingHistory.current.shift();}
   setOpeningUndoCount(openingHistory.current.length);setMessage(text('Opening saved as a design proposal.','بازشو به عنوان طرح پیشنهادی ذخیره شد.','تم حفظ الفتحة كمقترح تصميم.'));
  }catch(error){setMessage(error.message);}finally{working.current=false;setBusy(false);}
 }
 async function saveWall(edit,undo=false){
  const state=latest.current;if(working.current||state.disabled||!state.onCommitWalls)return;
  working.current=true;setBusy(true);setMessage('');
  try{
   const previous=wallHistory.current.at(-1);
   if(undo&&(!previous||JSON.stringify(previous.afterWalls)!==JSON.stringify(state.scene.walls)||JSON.stringify(previous.afterOpenings)!==JSON.stringify(state.scene.openings)))throw new Error(text('Walls or openings changed after this edit; undo is unavailable.','دیوار یا بازشو بعد از این تغییر ویرایش شده؛ برگشت این مرحله مجاز نیست.','تغيرت الجدران أو الفتحات بعد التعديل؛ التراجع غير متاح.'));
   const next=applyWallEdit(state.scene,undo?{kind:'restore',walls:previous?.walls,openings:previous?.openings}:edit);
   await state.onCommitWalls(next,state.scene);
   if(undo)wallHistory.current.pop();else{wallHistory.current.push({walls:state.scene.walls,openings:state.scene.openings,afterWalls:next.walls,afterOpenings:next.openings});if(wallHistory.current.length>20)wallHistory.current.shift();}
   setWallUndoCount(wallHistory.current.length);wallStart.current=null;
   setMessage(text('Wall proposal saved.','تغییر دیوار ذخیره شد.','تم حفظ تعديل الجدار.'));
  }catch(error){setMessage(error.message);}finally{working.current=false;setBusy(false);}
 }
 function wallMode(value){wallStart.current=null;setMode(value);getRenderer()?.setNamedView?.('top');}
 const object=scene.assets.find(a=>a.id===selected);
 const label=a=>FURNITURE_CATALOG.find(m=>m.id===a.catalogId||(!a.catalogId&&m.type===a.type))?.[lang]||a.type;
 async function save(edit,undo=false){
  const state=latest.current;if(working.current||state.disabled)return;
  working.current=true;setBusy(true);setMessage('');
  try{
   const next=undo?history.current.at(-1):['remove-many','copy-many'].includes(edit.kind)?applyFurnitureBatch(state.scene,{...edit,freePlacement:state.freePlacement}):applyFurnitureEdit(state.scene,{...edit,freePlacement:state.freePlacement});
   if(!next)return;
   await state.onCommit(next,state.scene);
   if(undo)history.current.pop();else{history.current.push(state.scene);if(history.current.length>20)history.current.shift();}
   setUndoCount(history.current.length);setMessage(state.t.saved);
   const remaining=(next.furnitureEditor?.copiedIds?.length?next.furnitureEditor.copiedIds:state.selectedIds).filter(id=>next.assets.some(a=>a.id===id));setSelectedIds(remaining);setSelected(remaining[0]||'');if(edit?.kind==='copy-many')setMode('select');
  }catch(error){setMessage(error.message);}finally{working.current=false;setBusy(false);}
 }
 useEffect(()=>{latest.current={scene,disabled:disabled||busy,mode,catalogId,selected,selectedIds,multiSelect,onCommit,onCommitOpenings,onCommitWalls,wallThickness,openingConfig,freePlacement,t,save,saveOpening,saveWall};});
 useEffect(()=>{
  const renderer=getRenderer();if(!renderer)return;
  renderer.setWallEditMode?.(mode==='wall-add'&&!disabled&&!busy);
  if(mode==='camera'||disabled||busy){renderer.setFurnitureTool?.(null);return;}
  const edit=(point,data,event)=>{
   const s=latest.current;
   if(s.mode==='rotate')return data?{kind:'rotate',assetId:data.id,rotation:furnitureRotationFromDrag(data.rotation,data.startX,event)}:null;
   if(s.mode==='resize')return data?{kind:'resize',assetId:data.id,size:furnitureSizeFromDrag(data.dimensions,data.startX,event)}:null;
   return s.mode==='add'?{kind:'add',catalogId:s.catalogId,point}:{kind:'move',assetId:data?.id||s.selected,point:{x:point.x+(data?.dx||0),y:point.y+(data?.dy||0)}};
  };
  renderer.setFurnitureTool?.({
   start:(id,point,event)=>{
    const s=latest.current;if(s.mode==='wall-add')return {wallDragStart:snapWallPoint(s.scene,point)};if(['add','opening','copy','wall-add','wall-remove'].includes(s.mode))return {};
    const a=s.scene.assets.find(a=>a.id===(id||(['rotate','resize'].includes(s.mode)?s.selected:null)));if(!a){if(s.mode==='select'&&!s.multiSelect&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){setSelectedIds([]);setSelected('');}return false;}
    const extend=s.mode==='select'&&(s.multiSelect||event.ctrlKey||event.metaKey||event.shiftKey);const ids=toggleFurnitureSelection(s.selectedIds,a.id,extend);setSelectedIds(ids);setSelected(ids[0]||'');if(a.color)setColor(a.color);if(extend)return false;
    return {id:a.id,dx:a.xMeters-point.x,dy:a.yMeters-point.y,rotation:a.rotation||0,startX:event.clientX,dimensions:{width:a.width,depth:a.depth,height:a.height}};
   },
   preview:(point,data,event)=>{const state=latest.current;if(state.mode==='wall-remove')return null;if(state.mode==='wall-add'){const start=wallStart.current||data?.wallDragStart;if(start&&Math.hypot(point.x-start.x,point.y-start.y)<.1)return {candidate:{id:'wall-point',xMeters:start.x,yMeters:start.y,width:.15,depth:.15,rotation:0},valid:true};const result=start?previewWallEdit(state.scene,{kind:'add',start,end:point,thickness:state.wallThickness}):{candidate:{id:'wall-point',xMeters:snapWallPoint(state.scene,point).x,yMeters:snapWallPoint(state.scene,point).y,width:.15,depth:.15,rotation:0},valid:true};if(result.error)setMessage(result.error);else setMessage('');return result;}const operation=edit(point,data,event);const result=state.mode==='copy'?previewFurnitureBatch(state.scene,{kind:'copy-many',snapshot:clipboard.current,point,freePlacement:state.freePlacement}):state.mode==='opening'?previewOpeningEdit(state.scene,{...state.openingConfig,point}):operation?previewFurnitureEdit(state.scene,{...operation,freePlacement:state.freePlacement}):null;if(result?.error)setMessage(result.error);else setMessage('');return result;},
   commit:(point,data,moved,event)=>{const s=latest.current;if(s.disabled)return;if(s.mode==='wall-remove')return s.saveWall({kind:'remove',wallId:getRenderer()?.pickWall?.(event)||nearestEditableWall(s.scene,point)});if(s.mode==='wall-add'){if(!wallStart.current&&moved&&data?.wallDragStart)return s.saveWall({kind:'add',start:data.wallDragStart,end:point,thickness:s.wallThickness});if(!wallStart.current){wallStart.current=snapWallPoint(s.scene,point);setMessage(text('Choose the end of the wall.','انتهای دیوار را انتخاب کن.','اختر نهاية الجدار.'));return;}return s.saveWall({kind:'add',start:wallStart.current,end:point,thickness:s.wallThickness});}if(s.mode==='copy')return s.save({kind:'copy-many',snapshot:clipboard.current,point});if(s.mode==='opening')return s.saveOpening({kind:'add',...s.openingConfig,point});if(['select','rotate','resize'].includes(s.mode)&&!moved)return;const operation=edit(point,data,event);if(operation)return s.save(operation);}
  });
  return()=>{renderer.setFurnitureTool?.(null);renderer.setWallEditMode?.(false);};
 },[getRenderer,open,mode,disabled,busy]);
 function beginCopy(){const state=latest.current;if(state.disabled)return;try{clipboard.current=copyFurnitureSnapshot(state.scene,state.selectedIds);setMode('copy');setMessage(text('Click the floor to place the copy.','روی کف بزن تا کپی قرار بگیرد.','اضغط على الأرضية لوضع النسخة.'));}catch(e){setMessage(e.message);}}
 function cameraMode(){setMode('camera');getRenderer()?.setControlMode?.('orbit');onCameraMode?.();}
 useEffect(()=>{setHost(getCanvasHost?.()||null);});
 useEffect(()=>{const renderer=getRenderer();renderer?.setSelectedAssetIds?.(selectedIds);return()=>renderer?.setSelectedAssetIds?.([]);},[getRenderer,selectedIds,scene]);
 useEffect(()=>{
  const handler=event=>{const state=latest.current;if(!state||state.disabled)return;
   const inScope=!!(panelRef.current?.contains(event.target)||host?.contains(event.target));const action=keyboardFurnitureAction(event,inScope,state.selectedIds.length>0,clipboard.current.length>0);if(!action)return;event.preventDefault();
   if(action==='remove')state.save({kind:'remove-many',assetIds:state.selectedIds});
   else if(action==='copy')beginCopy();else if(action==='paste'){setMode('copy');setMessage(text('Click the floor to place the copy.','روی کف بزن تا کپی قرار بگیرد.','اضغط على الأرضية لوضع النسخة.'));}
   else{wallStart.current=null;setMode('camera');setSelectedIds([]);setSelected('');getRenderer()?.clearFurniturePreview?.();}
  };document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);
 },[host,lang]);
 const blocked=disabled||busy;
 const renderCatalogItem=m=>(<button key={m.id} type="button" draggable={!blocked} disabled={blocked} aria-pressed={catalogId===m.id} onDragStart={e=>{e.dataTransfer.setData('text/plain',m.id);e.dataTransfer.effectAllowed='copy';setCatalogId(m.id);setMode('add');}} onClick={()=>{setCatalogId(m.id);setMode('add');}}>
    <span className={styles.swatch} style={{background:m.color}} aria-hidden="true"/>{m[lang]}<small>{m.width} × {m.depth} m</small>
   </button>);
 return <section ref={panelRef} className={styles.panel} dir={lang==='en'?'ltr':'rtl'}>
  <div className={styles.quickTools} role="group" aria-label={t.title}>
   <button type="button" aria-pressed={mode==='camera'} onClick={cameraMode}>{t.camera}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='select'} onClick={()=>setMode('select')}>{t.select}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='rotate'} onClick={()=>setMode('rotate')}>{lang==='fa'?'چرخش با ماوس':lang==='ar'?'الدوران بالسحب':'Rotate by dragging'}</button>
   <button type="button" disabled={blocked} aria-pressed={mode==='resize'} onClick={()=>setMode('resize')}>{lang==='fa'?'تغییر اندازه با ماوس':lang==='ar'?'تغيير الحجم بالسحب':'Resize by dragging'}</button>
  </div>
  {mode!=='camera'&&<p role="status">{mode==='wall-add'?text('Drag from one yellow endpoint to another, or click two points. Endpoints snap automatically.','از یک نقطه زرد بکش و روی نقطه دیگر رها کن، یا دو نقطه را کلیک کن. نقطه‌ها خودکار به سر دیوار می‌چسبند.','اسحب بين نقطتين صفراوين أو اضغط نقطتين. يتم الالتقاط تلقائياً.'):mode==='wall-remove'?text('Click the wall to remove it.','روی دیوار موردنظر کلیک کن تا حذف شود.','اضغط على الجدار لحذفه.'):mode==='opening'?text('Click near the target wall.','نزدیک دیوار هدف کلیک کن.','اضغط قرب الجدار المستهدف.'):lang==='fa'?'روی وسیله کلیک کن و بکش؛ رها کردن برای ذخیره.':lang==='ar'?'اضغط على الأثاث واسحب؛ أفلت للحفظ.':'Click furniture and drag; release to save.'}</p>}
  <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);setMode('camera');}}>{t.title} {open?'−':'+'}</button>
  {open&&<><p>{text('Furniture does not change walls or BOQ. Doors and windows have a separate manual design tool below.','مبلمان، دیوار و BOQ را تغییر نمی‌دهد. ابزار افزودن دستی در و پنجره پایین همین پنل است.','الأثاث لا يغير الجدران أو BOQ. أداة الأبواب والنوافذ اليدوية أدناه.')}</p>{scene.source==='dwg-engineering-interior'&&<label><input type="checkbox" disabled={blocked} checked={freePlacement} onChange={e=>setFreePlacement(e.target.checked)}/>{text('Ignore uncertain DWG wall lines for manual furniture','نادیده گرفتن خطوط دیوار نامطمئن برای چیدمان دستی','تجاهل خطوط جدران DWG غير المؤكدة للأثاث اليدوي')}</label>}{freePlacement&&<p role="status">{text('Wall and doorway clearance is unverified in this mode. Check the placement against your plan.','در این حالت فاصله از دیوار و مسیر در تأیید نمی‌شود؛ جای وسیله را با نقشه کنترل کن.','في هذا الوضع لا يتم التحقق من الجدران ومسار الأبواب؛ راجع موضع الأثاث مع المخطط.')}</p>}<div className={styles.tools}>
   <button type="button" disabled={blocked} aria-pressed={mode==='add'} onClick={()=>setMode('add')}>{t.add}</button>
   <button type="button" disabled={blocked} onClick={()=>getRenderer()?.setNamedView?.('top')}>{t.top}</button>
   <button type="button" disabled={blocked||!undoCount} onClick={()=>save(null,true)}>{t.undo}</button>
  </div>{mode==='resize'&&<p>{lang==='fa'?'روی وسیله کلیک کن و به راست بکش تا بزرگ‌تر، یا به چپ بکش تا کوچک‌تر شود. تناسب طول، عرض و ارتفاع حفظ می‌شود؛ با رها کردن ذخیره می‌شود.':lang==='ar'?'اسحب الأثاث يميناً للتكبير أو يساراً للتصغير؛ تبقى نسب الطول والعرض والارتفاع ثابتة. أفلت للحفظ.':'Drag furniture right to enlarge or left to shrink. Width, depth and height scale together; release to save.'}</p>}<p>{mode==='rotate'?(lang==='fa'?'روی وسیله کلیک کن و به چپ یا راست بکش؛ با رها کردن ذخیره می‌شود. Shift: گام‌های ۱۵ درجه. روی گوشی با انگشت بکش.':lang==='ar'?'اضغط على الأثاث واسحب يميناً أو يساراً؛ يتم الحفظ عند الإفلات. Shift: خطوات ١٥ درجة. على الهاتف اسحب بإصبعك.':'Drag furniture left or right to rotate; release to save. Hold Shift for 15° steps. On mobile, drag with one finger.'):mode==='resize'?'':t.help}</p><ToolDrawer title="catalog"><div className={styles.catalog}>
   {FURNITURE_CATALOG.filter(m=>m.type!=='plant').map(renderCatalogItem)}
  </div><ToolDrawer title="plants"><div className={styles.catalog}>{FURNITURE_CATALOG.filter(m=>m.type==='plant').map(renderCatalogItem)}</div></ToolDrawer></ToolDrawer><ToolDrawer title="edit"><div className={styles.tools}>
   <label>{t.choose}<select disabled={blocked} value={object?selected:''} onChange={e=>{setSelected(e.target.value);setSelectedIds(e.target.value?[e.target.value]:[]);const a=scene.assets.find(a=>a.id===e.target.value);if(a?.color)setColor(a.color);}}><option value="">—</option>{scene.assets.map(a=><option key={a.id} value={a.id}>{label(a)} · {scene.rooms.find(r=>r.id===a.roomId)?.name||a.roomId} · {a.id}</option>)}</select></label>
   {object&&<span dir="ltr">{object.width?.toFixed(2)} × {object.depth?.toFixed(2)} × {object.height?.toFixed(2)} m</span>}
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'rotate',assetId:selected,rotation:(object.rotation||0)+15})}>{t.rotate}</button>
   <input type="color" aria-label={t.color} value={color} onChange={e=>setColor(e.target.value)} disabled={blocked||!object}/>
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'color',assetId:selected,color})}>{t.color}</button>
   <button type="button" disabled={blocked||!object||FURNITURE_CATALOG.find(m=>m.id===catalogId)?.type!==object.type} onClick={()=>save({kind:'replace',assetId:selected,catalogId})}>{t.replace}</button>
   <button type="button" disabled={blocked||!object} onClick={()=>save({kind:'remove-many',assetIds:selectedIds})}>{t.remove}</button>
  </div></ToolDrawer></>}
  {open&&onCommitOpenings&&<ToolDrawer title={text('Doors & windows','در و پنجره','الأبواب والنوافذ')}><div className={styles.tools}>
   <p>{text('Click near a wall to cut a real opening. Or choose a wall number and position below. These are proposed edits, excluded from BOQ.','برای ساخت بازشوی واقعی نزدیک دیوار کلیک کن، یا شماره دیوار و موقعیت را مشخص کن. این تغییر پیشنهادی وارد BOQ نمی‌شود.','اضغط قرب الجدار لإنشاء فتحة، أو اختر رقم الجدار وموقعها. تعديلات مقترحة لا تدخل BOQ.')}</p>
   <label>{text('Model','مدل','النموذج')}<select disabled={blocked} value={openingModel} onChange={e=>{const m=OPENING_CATALOG.find(m=>m.id===e.target.value);setOpeningModel(m.id);setOpeningWidth(m.width);setOpeningHeight(m.height);setSill(m.sillHeight);setMode('opening');}}>{OPENING_CATALOG.map(m=><option key={m.id} value={m.id}>{m[lang]}</option>)}</select></label>
   <label>{text('Target wall','دیوار هدف','الجدار المستهدف')}<select disabled={blocked} value={wallId} onChange={e=>setWallId(e.target.value)}><option value="">{text('Nearest wall on click','نزدیک‌ترین دیوار به کلیک','أقرب جدار للنقرة')}</option>{scene.walls.filter(w=>w.type!=='railing').map((w,i)=><option key={w.id} value={w.id}>{i+1} · {w.start.x.toFixed(1)},{w.start.y.toFixed(1)} → {w.end.x.toFixed(1)},{w.end.y.toFixed(1)} m</option>)}</select></label>
   <label>{text('Width (m)','عرض (متر)','العرض (متر)')}<input type="number" min=".3" max="4" step=".05" value={openingWidth} disabled={blocked} onChange={e=>setOpeningWidth(Number(e.target.value))}/></label>
   <label>{text('Height (m)','ارتفاع (متر)','الارتفاع (متر)')}<input type="number" min=".3" max="3.15" step=".05" value={openingHeight} disabled={blocked} onChange={e=>setOpeningHeight(Number(e.target.value))}/></label>
   {OPENING_CATALOG.find(m=>m.id===openingModel)?.type==='window'&&<label>{text('Sill height (m)','ارتفاع زیر پنجره (متر)','ارتفاع عتبة النافذة (متر)')}<input type="number" min="0" max="3" step=".05" value={sill} disabled={blocked} onChange={e=>setSill(Number(e.target.value))}/></label>}
   <label>{text('Position along chosen wall (%)','موقعیت روی دیوار انتخاب‌شده (%)','الموقع على الجدار المختار (%)')}<input type="number" min="0" max="100" step="1" disabled={blocked} value={offset} onChange={e=>setOffset(Number(e.target.value))}/></label>
   <label><input type="checkbox" disabled={blocked} checked={replaceOpenings} onChange={e=>setReplaceOpenings(e.target.checked)}/>{text('Replace overlapping openings in this preview','جایگزینی بازشوهای متداخل در این پیش‌نمایش','استبدال الفتحات المتداخلة في المعاينة')}</label>
   <button type="button" disabled={blocked} aria-pressed={mode==='opening'} onClick={()=>{setMode('opening');getRenderer()?.setNamedView?.('top');}}>{text('Place opening with mouse / touch','گذاشتن بازشو با ماوس / لمس','وضع فتحة بالماوس / اللمس')}</button>
   <button type="button" disabled={blocked||!wallId} onClick={()=>saveOpening({kind:'add',...openingConfig})}>{text('Add to chosen wall','افزودن روی دیوار انتخاب‌شده','إضافة إلى الجدار المختار')}</button>
   <label>{text('Existing opening','بازشوی موجود','الفتحة الحالية')}<select disabled={blocked} value={selectedOpening} onChange={e=>setSelectedOpening(e.target.value)}><option value="">—</option>{scene.openings.filter(o=>!o.cutOnly).map((o,i)=><option key={o.id} value={o.id}>{i+1} · {o.type} · {o.width?.toFixed(2)} m</option>)}</select></label>
   <button type="button" disabled={blocked||!selectedOpening} onClick={()=>saveOpening({kind:'remove',openingId:selectedOpening})}>{text('Remove selected opening','حذف بازشوی انتخاب‌شده','حذف الفتحة المختارة')}</button>
   <button type="button" disabled={blocked||!openingUndoCount} onClick={()=>saveOpening(null,true)}>{text('Undo opening edit','برگشت تغییر بازشو','التراجع عن تعديل الفتحة')}</button>
  </div></ToolDrawer>}
  {onCommitWalls&&<details className={styles.panel}>
   <summary>{text('Wall editor','ویرایش دیوار','محرر الجدران')}</summary>
   <p>{text('Design proposal only; BOQ quantities and room classifications are unchanged. Removing a wall also removes its doors and windows. Undo restores them.','تغییر طرح پیشنهادی است؛ BOQ و طبقه‌بندی اتاق‌ها تغییر نمی‌کنند. حذف دیوار، در و پنجره متصل به آن را هم حذف می‌کند؛ برگشت آن‌ها را برمی‌گرداند.','مقترح تصميم فقط؛ كميات BOQ وتصنيف الغرف لا تتغير. حذف الجدار يحذف أبوابه ونوافذه؛ التراجع يعيدها.')}</p>
   <label>{text('Thickness (m)','ضخامت (متر)','السماكة (متر)')}<input type="number" min=".05" max=".5" step=".01" value={wallThickness} disabled={blocked} onChange={e=>setWallThickness(Number(e.target.value))}/></label>
   <button data-model-tool="wall-add" type="button" disabled={blocked} aria-pressed={mode==='wall-add'} onClick={()=>wallMode('wall-add')}>{text('Add wall: two points','افزودن دیوار: دو نقطه','إضافة جدار: نقطتان')}</button>
   <button data-model-tool="wall-remove" type="button" disabled={blocked} aria-pressed={mode==='wall-remove'} onClick={()=>wallMode('wall-remove')}>{text('Delete wall: click','حذف دیوار: کلیک','حذف الجدار: اضغط')}</button>
   <button data-model-tool="wall-undo" type="button" disabled={blocked||!wallUndoCount} onClick={()=>saveWall(null,true)}>{text('Undo wall edit','برگشت تغییر دیوار','التراجع عن تعديل الجدار')}</button>
  </details>}
  {host&&createPortal(<div className={styles.onModelTools} dir={lang==='en'?'ltr':'rtl'} aria-label={t.title}>
   <button data-model-tool="camera" type="button" aria-pressed={mode==='camera'} onClick={cameraMode}>{text('Camera / orbit','حرکت دوربین','تحريك الكاميرا')}</button>
   <button data-model-tool="select" type="button" disabled={blocked} aria-pressed={mode==='select'} onClick={()=>setMode('select')}>{text('Select','انتخاب','اختيار')}</button>
   <button data-model-tool="multiple" type="button" disabled={blocked} aria-pressed={multiSelect} onClick={()=>{setMultiSelect(!multiSelect);setMode('select');}}>{text('Multiple','چندانتخابی','اختيار متعدد')}</button>
   <button data-model-tool="copy" type="button" disabled={blocked||!selectedIds.length} onClick={beginCopy}>{text('Copy','کپی','نسخ')}</button>
   <button data-model-tool="delete" type="button" disabled={blocked||!selectedIds.length} onClick={()=>save({kind:'remove-many',assetIds:selectedIds})}>{text('Delete','حذف','حذف')}</button>
   {!!selectedIds.length&&<span>{text('Selected','انتخاب‌شده','المحدد')}: {selectedIds.length}</span>}
  
   {onCommitWalls&&<details><summary>{text('Edit walls','ویرایش دیوار','تعديل الجدران')}</summary>
    <button data-model-tool="wall-add" type="button" disabled={blocked} onClick={()=>wallMode('wall-add')}>{text('Add wall','افزودن دیوار','إضافة جدار')}</button>
    <button data-model-tool="wall-remove" type="button" disabled={blocked} onClick={()=>wallMode('wall-remove')}>{text('Delete wall','حذف دیوار','حذف الجدار')}</button>
    <button data-model-tool="wall-undo" type="button" disabled={blocked||!wallUndoCount} onClick={()=>saveWall(null,true)}>{text('Undo wall','برگشت دیوار','التراجع عن الجدار')}</button>
   </details>}
   {onToggleWalls&&<button data-model-tool="walls" type="button" disabled={blocked} aria-pressed={!!wallsTransparent} onClick={onToggleWalls}>{wallsTransparent?text('Solid walls','دیوار مات','جدران مصمتة'):text('See-through walls','دیوار شفاف','جدران شفافة')}</button>}
</div>,host)}
  {mode==='copy'&&<p role="status">{text('Click a clear floor area for the copy; Escape cancels.','برای کپی روی فضای آزاد کف بزن؛ Escape لغو می‌کند.','اضغط على مساحة فارغة للنسخ؛ Escape للإلغاء.')}</p>}
  {mode==='select'&&<p>{text('Ctrl / Shift click selects multiple objects. On mobile enable Multiple. Delete removes the selection; Ctrl+C then click places a copy. Ctrl+V repeats.','Ctrl یا Shift را نگه دار و روی چند وسیله بزن. روی گوشی چندانتخابی را فعال کن. Delete حذف می‌کند؛ Ctrl+C و کلیک روی کف کپی می‌کند. Ctrl+V کپی را تکرار می‌کند.','اضغط مع Ctrl أو Shift لاختيار عدة قطع. على الهاتف فعّل الاختيار المتعدد. Delete للحذف؛ Ctrl+C ثم اضغط الأرضية للنسخ وCtrl+V للتكرار.')}</p>}
  {(busy||message)&&<p role="status">{busy?t.busy:message}</p>}
 </section>;
}
