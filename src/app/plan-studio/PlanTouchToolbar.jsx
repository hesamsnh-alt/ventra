'use client';
export default function PlanTouchToolbar({fa,command,pointCount,pan,tools,onCommand,onPan,onFinish,onClose,onUndo,onCancel,onZoom,onFit,onKeyboard,keyboardShown,canUndo}){
 const text=(en,ps)=>fa?ps:en,closing=['LINE','WALL','PLINE','FLOOR','PIPE'].includes(command);
 return <div className="ps-touch-toolbar" aria-label={text('Touch drawing tools','ابزارهای رسم لمسی')}>
  <div className="ps-touch-primary">
   {[['L','LINE','Line','خط'],['W','WALL','Wall','دیوار'],['PL','PLINE','Polyline','پلی‌لاین'],['FLOOR','FLOOR','Floor','کف']].map(([code,c,en,ps])=><button type="button" key={code} aria-pressed={!pan&&command===c} onClick={()=>onCommand(code)}><b>{code}</b>{text(en,ps)}</button>)}
   <button type="button" aria-pressed={pan} onClick={onPan}>{text('Hand / pan','حرکت صفحه')}</button>
   <details className="ps-touch-more"><summary>{text('More tools','ابزارها')}</summary><div>{tools.map(([code,en,ps])=><button type="button" key={code} onClick={e=>{onCommand(code);e.currentTarget.closest('details').open=false;}}><kbd>{code}</kbd> {text(en,ps)}</button>)}</div></details>
  </div>
  <div className="ps-touch-actions">
   <button type="button" onClick={onFinish}>{text('Done / Enter','تأیید / پایان')}</button>
   <button type="button" disabled={!closing||pointCount<3} onClick={onClose}>{text('Close line','بستن خط')}</button>
   <button type="button" disabled={!canUndo} onClick={onUndo}>{text('Undo','برگشت')}</button>
   <button type="button" onClick={onCancel}>{text('Cancel','لغو')}</button>
   <button type="button" aria-label={text('Zoom in','بزرگ‌نمایی')} onClick={()=>onZoom(.8)}>＋</button>
   <button type="button" aria-label={text('Zoom out','کوچک‌نمایی')} onClick={()=>onZoom(1.25)}>−</button>
   <button type="button" onClick={onFit}>{text('Fit plan','نمای کامل')}</button>
   <button type="button" aria-pressed={keyboardShown} onClick={onKeyboard}>{text('Command','فرمان')}</button>
  </div>
 </div>;
}
