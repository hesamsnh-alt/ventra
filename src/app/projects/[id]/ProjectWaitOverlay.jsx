'use client';
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import {drawingWorkflowState, subscribeDrawingWorkflow} from '@/lib/drawingWorkflowGate.mjs';
import {readDrawingProgress, subscribeDrawingProgress} from '@/lib/drawingProgressSession.mjs';
import styles from './ProjectWaitOverlay.module.css';

const copy = {
  en: {loading:'Loading project…', analysis:'Analyzing drawing…', boq:'Preparing BOQ…', preview:'Preparing preview…', wait:'Please wait. Your current request is running.', show:'Show workspace', prepare:'Preparing file…', review:'Cross-checking pages…', source:'Checking measurements…', report:'Preparing report…'},
  fa: {loading:'در حال بارگذاری پروژه…', analysis:'در حال تحلیل نقشه…', boq:'در حال آماده‌سازی متره…', preview:'در حال آماده‌سازی پیش‌نمایش…', wait:'لطفاً صبر کنید؛ درخواست فعلی در حال انجام است.', show:'نمایش محیط پروژه', prepare:'در حال آماده‌سازی فایل…', review:'در حال تطبیق صفحات…', source:'در حال بررسی اندازه‌ها…', report:'در حال آماده‌سازی گزارش…'},
  ar: {loading:'جارٍ تحميل المشروع…', analysis:'جارٍ تحليل المخطط…', boq:'جارٍ إعداد جدول الكميات…', preview:'جارٍ إعداد المعاينة…', wait:'يرجى الانتظار، طلبك الحالي قيد التنفيذ.', show:'عرض مساحة العمل', prepare:'جارٍ إعداد الملف…', review:'جارٍ مراجعة الصفحات…', source:'جارٍ التحقق من القياسات…', report:'جارٍ إعداد التقرير…'},
};

// Observes existing work only: no requests, progress estimates or storage writes.
export default function ProjectWaitOverlay({projectId, loading = false}) {
  const {language} = useLanguage();
  const workflow = useSyncExternalStore(
    useCallback(listener => subscribeDrawingWorkflow(projectId, listener), [projectId]),
    useCallback(() => drawingWorkflowState(projectId), [projectId]),
    () => null,
  );
  const progress = useSyncExternalStore(
    useCallback(listener => subscribeDrawingProgress(projectId, listener), [projectId]),
    useCallback(() => readDrawingProgress(projectId), [projectId]),
    () => null,
  );
  const operation = loading ? 'loading' : workflow?.active;
  const interrupted = operation === 'analysis' && ['interrupted','failed'].includes(progress?.status);
  const active = !!operation && !interrupted;
  if (!active) return null;
  const t = copy[language] || copy.en;
  const stage = progress?.stage;
  const stageLabel = operation !== 'analysis' ? null
    : ['queued','checking','reading_source','preparing_image'].includes(stage) ? 'prepare'
    : stage === 'cross_page_review' ? 'review'
    : stage === 'source_measurements' ? 'source'
    : ['finalizing','saving'].includes(stage) ? 'report' : null;
  return <WaitingLayer key={`${projectId}:${operation}`} language={language} text={t[stageLabel || operation] || t.analysis} copy={t} />;
}

function WaitingLayer({language, text, copy}) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!visible || dismissed) return null;
  return createPortal(
    <div className={styles.overlay} dir={language === 'en' ? 'ltr' : 'rtl'}>
      <div className={styles.content}>
        <span className={styles.spinner} aria-hidden="true" />
        <p role="status" aria-live="polite">{text}</p>
        <small>{copy.wait}</small>
        <button type="button" onClick={() => setDismissed(true)}>{copy.show}</button>
      </div>
    </div>, document.body,
  );
}
