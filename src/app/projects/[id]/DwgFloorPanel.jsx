'use client';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
const copy={
 en:{title:'DWG floors and furniture',reload:'Load saved geometry and reconstruct',drawings:'Open Drawings and confirm scale',note:'Separate drawing regions are candidates, not verified floor order. Select the region matching your floor plan.',region:'Drawing region',all:'All regions',uses:'Assign room uses',original:'From drawing',furnish:'Furnish and save',proposed:'Proposed furniture; excluded from BOQ',help:'Complete geometry extraction and calibration in Drawings, then use Reconstruct 3D.',types:['Living','Kitchen','Bedroom','WC and shower','Dining','Terrace']},
 fa:{title:'طبقات DWG و مبلمان',reload:'بارگذاری هندسهٔ ذخیره‌شده و بازسازی',drawings:'باز کردن Drawings و تأیید مقیاس',note:'محدوده‌های جدا، ترتیب تأییدشدهٔ طبقات نیستند. محدودهٔ مطابق پلان طبقه را انتخاب کنید.',region:'محدودهٔ نقشه',all:'همهٔ محدوده‌ها',uses:'تعیین نوع اتاق‌ها',original:'از نقشه',furnish:'چیدمان و ذخیرهٔ مبلمان',proposed:'مبلمان پیشنهادی؛ خارج از محاسبات BOQ',help:'در Drawings استخراج هندسه و مقیاس را تکمیل کنید، سپس Reconstruct 3D را بزنید.',types:['نشیمن','آشپزخانه','اتاق خواب','سرویس و دوش','ناهارخوری','تراس']},
 ar:{title:'طوابق DWG والأثاث',reload:'تحميل الهندسة المحفوظة وإعادة البناء',drawings:'فتح Drawings وتأكيد المقياس',note:'المناطق المنفصلة لا تثبت ترتيب الطوابق. اختر المنطقة المطابقة لمخطط الطابق.',region:'منطقة المخطط',all:'جميع المناطق',uses:'تحديد استخدام الغرف',original:'من المخطط',furnish:'تأثيث وحفظ',proposed:'أثاث مقترح؛ خارج حساب الكميات',help:'أكمل استخراج الهندسة ومعايرة المقياس في Drawings ثم اضغط Reconstruct 3D.',types:['معيشة','مطبخ','غرفة نوم','حمام ودش','طعام','شرفة']}
};
export default function DwgFloorPanel({reconstruction,region,roomUses,count,busy,projectId,onReload,onRegion,onRoomUse,onFurnish}){
 const {language}=useLanguage(),c=copy[language]||copy.en;
 return <div className="ventra-model-message ventra-dwg-floor-panel"><p>{c.title}</p><p>{c.note}</p>{reconstruction?<>
  <label>{c.region} <select value={region??'all'} disabled={busy} onChange={e=>onRegion(e.target.value==='all'?null:Number(e.target.value))}>
   <option value="all">{c.all}</option>{Array.from({length:reconstruction._runtime?.regionCount||1},(_,i)=><option key={i} value={i}>{i+1}</option>)}
  </select></label>
  <details><summary>{c.uses}</summary>{(reconstruction._runtime?.geometry?.roomPolygons||[]).map((room,i)=>{const id=String(room.id||`room-${i+1}`);return <label key={id} style={{display:'block'}}>{room.name||id} <select value={roomUses[id]||''} disabled={busy} onChange={e=>onRoomUse(id,e.target.value)}>
   <option value="">{c.original}</option>{['living','kitchen','bedroom','bathroom','dining','terrace'].map((type,index)=><option key={type} value={type}>{c.types[index]}</option>)}
  </select></label>;})}</details>
  <button type="button" onClick={onFurnish} disabled={busy}>{c.furnish}</button><p>{count} · {c.proposed}</p>
 </>:<><p>{c.help}</p><button type="button" disabled={busy} onClick={onReload}>{c.reload}</button> <a href={`/projects/${encodeURIComponent(projectId)}?tab=drawings`}>{c.drawings}</a></>}</div>;
}
