'use client';

import {useEffect,useState} from 'react';
import {selectedDrawingSync} from '@/lib/schematicStorage.mjs';

export default function CommercialDrawingGuard({projectId,children}) {
  const [state,setState]=useState(null);
  useEffect(()=>{
    function check(){
      const selected=selectedDrawingSync(projectId);
      let boq;
      try{boq=JSON.parse(window.localStorage.getItem(`ventra:project-boq:${projectId}`)||'null');}catch{}
      const source=boq?.boqSource?.documentId||boq?.takeoff?.document_id;
      setState({projectId,blocked:Boolean(selected && source!==selected)});
    }
    check();
    for(const event of ['storage','ventra:boq-updated','ventra:3d-source-updated'])window.addEventListener(event,check);
    return ()=>{
      for(const event of ['storage','ventra:boq-updated','ventra:3d-source-updated'])window.removeEventListener(event,check);
    };
  },[projectId]);
  if(state?.projectId!==projectId)return null;
  if(state.blocked)return <p role="status">برای نقشهٔ انتخاب‌شده BOQ معتبر ذخیره نشده است. در بخش نقشه‌ها، تحلیل و BOQ همین فایل را تکمیل کنید. پیش‌نویس قبلی با انتخاب نقشهٔ مرجع خودش در دسترس است.<br/>The selected drawing has no matching saved BOQ. Analyze this drawing and generate its BOQ, or reselect the source drawing to view the earlier draft.</p>;
  return children;
}
