'use client';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {readSchematic,readActiveSource} from '@/lib/schematicStorage.mjs';
import {readPersistedTakeoff} from '@/lib/takeoffStorage.mjs';
import {engineeringUrn} from '@/lib/sceneStyle.mjs';
import {writeCloud3DState} from '@/lib/cloud3DState.mjs';
const words={
 en:{title:'Cloud synchronization',save:'Save this device’s 3D to cloud',reload:'Reload from cloud',notice:'Save on the device that has the correct model. Then reload on your phone. Saving replaces shared 3D data.',busy:'Saving…',saved:'3D saved to cloud. Open the same account and project on your phone.',failed:'Cloud save failed. The local model is still available.',empty:'There is no model on this device to save.'},
 fa:{title:'همگام‌سازی ابری',save:'ذخیرهٔ مدل این دستگاه در فضای ابری',reload:'بارگذاری مجدد از فضای ابری',notice:'روی دستگاهی که مدل صحیح را دارد ذخیره کنید، سپس روی گوشی بارگذاری مجدد را بزنید. ذخیره، مدل مشترک پروژه را جایگزین می‌کند.',busy:'در حال ذخیره…',saved:'مدل در فضای ابری ذخیره شد. روی گوشی وارد همان حساب و پروژه شوید.',failed:'ذخیرهٔ ابری ناموفق بود. مدل محلی همچنان موجود است.',empty:'روی این دستگاه مدلی برای ذخیره وجود ندارد.'},
 ar:{title:'المزامنة السحابية',save:'حفظ نموذج هذا الجهاز في السحابة',reload:'إعادة التحميل من السحابة',notice:'احفظ على الجهاز الذي يحتوي النموذج الصحيح، ثم أعد التحميل على الهاتف. الحفظ يستبدل نموذج المشروع المشترك.',busy:'جارٍ الحفظ…',saved:'تم حفظ النموذج في السحابة. افتح الحساب والمشروع نفسيهما على الهاتف.',failed:'فشل الحفظ السحابي. لا يزال النموذج المحلي متاحاً.',empty:'لا يوجد نموذج على هذا الجهاز للحفظ.'},
};
export default function CloudSyncPanel({projectId}){
 const {language}=useLanguage(),text=words[language]||words.en;
 const [busy,setBusy]=useState(false),[state,setState]=useState(''),[details,setDetails]=useState('');
 useEffect(()=>{
  const failed=e=>{if(e.detail?.projectId===projectId){setState('failed');setDetails(e.detail.message||'');}};
  window.addEventListener('ventra:3d-cloud-error',failed);
  return()=>window.removeEventListener('ventra:3d-cloud-error',failed);
 },[projectId]);
 async function save(){
  if(busy)return;
  setBusy(true);setState('');setDetails('');
  try{
   const [scene,engineering,render,source]=await Promise.all([readSchematic(projectId),readPersistedTakeoff(projectId,'engineering'),readSchematic(projectId,'concept-render'),readActiveSource(projectId)]);
   const entries=[];
   if(scene)entries.push(['schematic',scene]);
   if(engineeringUrn(engineering))entries.push(['engineering',engineering]);
   if(!entries.length){setState('empty');return;}
   if(render)entries.push(['render',render]);
   // Publish the selected source only after all model writes succeed.
   if(source)entries.push(['selection',{source}]);
   for(const [kind,value] of entries){const result=await writeCloud3DState(projectId,kind,value);if(!result.saved)throw new Error(result.error||text.failed);}
   setState('saved');
  }catch(error){setState('failed');setDetails(error.message);}
  finally{setBusy(false);}
 }
 return <details className="ventra-tool-drawer">
  <summary>{text.title}</summary>
  <div className="ventra-drawer-content">
   <p>{text.notice}</p>
   <button type="button" disabled={busy} onClick={save}>{busy?text.busy:text.save}</button>
   <button type="button" disabled={busy} onClick={()=>window.location.reload()}>{text.reload}</button>
   {state&&<p role="status">{text[state]}{state==='failed'&&details?` ${details}`:''}</p>}
  </div>
 </details>;
}
