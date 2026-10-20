"use client";
import {useEffect,useState} from 'react';
import styles from './DrawingAnalysisProgress.module.css';
const copy={
 fa:{running:'تحلیل در حال انجام است',completed:'تحلیل کامل شد',failed:'تحلیل متوقف شد',interrupted:'ارتباط با پردازش قطع شده است',elapsed:'زمان سپری‌شده',pending:'درصد دقیق این مرحله در دسترس نیست',weighted:'پیشرفت مراحل پردازش؛ تخمین زمان پایان نیست',keep:'درخواست ثبت شده است؛ دوباره تحلیل را نزنید. نتیجه پس از پایان اینجا نمایش داده می‌شود.',unknown:'درخواست جدیدی ارسال نشده است. وضعیت همان پردازش را بررسی کنید تا هزینه تکراری ایجاد نشود.',check:'بررسی وضعیت همان درخواست',saved:'پردازش پایان یافت؛ نتیجه در بخش مربوط نمایش داده می‌شود.',pages:'صفحه',reviews:'بخش بررسی',parts:'بخش اندازه‌گیری',prepare:'آماده‌سازی فایل',analyze:'تحلیل نقشه',review:'تطبیق و کنترل',source:'کنترل اندازه‌ها',report:'آماده‌سازی گزارش',eta:'زمان باقی‌مانده هنوز قابل‌برآورد نیست',stale:'مدتی است وضعیت جدیدی دریافت نشده؛ پردازش ممکن است همچنان ادامه داشته باشد.'},
 en:{running:'Analysis in progress',completed:'Analysis complete',failed:'Analysis stopped',interrupted:'Analysis connection interrupted',elapsed:'Elapsed',pending:'Exact progress is unavailable for this stage',weighted:'Completed workflow stages; not a finish-time prediction',keep:'Your request is registered. Do not submit it again. The result will appear here when ready.',unknown:'No new request was sent. Check the same job to avoid duplicate charges.',check:'Check existing request',saved:'Processing finished. The result is available in the relevant section.',pages:'pages',reviews:'review passes',parts:'measurement parts',prepare:'Prepare file',analyze:'Analyze drawing',review:'Cross-check',source:'Check measurements',report:'Prepare report',eta:'Remaining time is not yet predictable',stale:'No recent status update. Processing may still be running.'},
 ar:{running:'التحليل قيد التنفيذ',completed:'اكتمل التحليل',failed:'توقف التحليل',interrupted:'انقطع الاتصال بالتحليل',elapsed:'الوقت المنقضي',pending:'النسبة الدقيقة لهذه المرحلة غير متاحة',weighted:'تقدم مراحل المعالجة وليس توقعاً لوقت الانتهاء',keep:'تم تسجيل الطلب. لا تكرر التحليل. ستظهر النتيجة هنا عند الانتهاء.',unknown:'لم يُرسل طلب جديد. تحقق من الطلب نفسه لتجنب التكلفة المكررة.',check:'التحقق من الطلب الحالي',saved:'اكتملت المعالجة. النتيجة متاحة في القسم ذي الصلة.',pages:'صفحات',reviews:'مراحل مراجعة',parts:'أجزاء القياس',prepare:'إعداد الملف',analyze:'تحليل المخطط',review:'المراجعة',source:'مراجعة القياسات',report:'إعداد التقرير',eta:'وقت الانتهاء غير قابل للتقدير بعد',stale:'لم يصل تحديث حديث؛ قد تستمر المعالجة.'},
};
export default function DrawingAnalysisProgress({progress,language='en',onResume}){
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{if(progress?.status!=='running')return;const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[progress?.status]);
 if(!progress)return null;
 const t=copy[language]||copy.en,running=progress.status==='running',complete=progress.status==='completed';
 const seconds=Math.max(0,Math.floor(((running?clock:progress.finishedAt||clock)-(progress.startedAt||clock))/1000));
 const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 const stages=['prepare','analyze',...(progress.isPdf?['review','source']:[]),'report'];
 const index=complete?stages.length:['queued','checking','reading_source','preparing_image'].includes(progress.stage)?0:['cross_page_review'].includes(progress.stage)?2:progress.stage==='source_measurements'?3:['finalizing','saving'].includes(progress.stage)?stages.length-1:1;
 const measurable=Number.isFinite(progress.percent),stale=running&&clock-(progress.updatedAt||progress.startedAt||clock)>45000;
 const stageName=stages[Math.min(index,stages.length-1)];
 return <section className={styles.panel} dir={language==='fa'||language==='ar'?'rtl':'ltr'} aria-label={t.running}>
  <div className={styles.heading}><strong role="status">{t[progress.status]||t.running}</strong><span>{measurable?`${progress.percent}%`:'…'}</span></div>
  <div className={styles.file}>{progress.fileName}</div>
  <div className={styles.bar} role="progressbar" aria-label={t.weighted} aria-valuemin={0} aria-valuemax={100} aria-valuenow={measurable?progress.percent:undefined} aria-valuetext={measurable?`${progress.percent}%`:t.pending}>
   <div className={!measurable&&running?styles.moving:styles.fill} style={measurable?{width:`${progress.percent}%`}:undefined}/>
  </div>
  <p className={styles.current}>{complete?t.saved:t[stageName]}{!complete&&progress.totalPages>0?` · ${progress.pagesCompleted||0}/${progress.totalPages} ${t.pages}`:''}</p>
  {progress.stage==='cross_page_review'&&<p>{progress.reviewCompleted||0}/{progress.reviewTotal||'…'} {t.reviews}</p>}
  {progress.stage==='source_measurements'&&<p>{progress.sourceCompleted||0}/{progress.sourceTotal||'…'} {t.parts}</p>}
  <ol className={styles.timeline}>{stages.map((stage,i)=><li key={stage} className={i<index?styles.done:i===index?styles.active:styles.waiting} aria-current={i===index?'step':undefined}><span aria-hidden="true">{i<index?'✓':i+1}</span>{t[stage]}</li>)}</ol>
  <div className={styles.time}><span>{t.elapsed}: <b>{time}</b></span>{running&&<span>{t.eta}</span>}</div>
  {!complete&&<p>{progress.status==='interrupted'?t.unknown:t.keep}</p>}
  {stale&&<p className={styles.warning}>{t.stale}</p>}
  {measurable&&!complete&&<small>{t.weighted}</small>}
  {progress.status==='interrupted'&&onResume&&<button type="button" onClick={onResume}>{t.check}</button>}
 </section>;
}
