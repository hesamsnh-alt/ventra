export function sectionPrompt(command,count,t){
  switch(command){
    case 'SECTIONWALL':
    case 'SECTIONSLAB':
      return t('Select guide lines, arcs or polylines, then press Enter.','خط، قوس یا پلی‌لاین‌های راهنما را انتخاب کن و اینتر بزن.');
    case 'WINDOWELEVATION':
      return t('Select window rectangles, then press Enter.','مستطیل‌های پنجره را انتخاب کن و اینتر بزن.');
    case 'SECTIONSTAIR':
      return count?t('Pick the opposite corner at the next floor level.','گوشهٔ مقابل را روی تراز طبقهٔ بعد انتخاب کن.'):t('Pick a lower corner of the stair bay.','گوشهٔ پایین دهانهٔ پله را انتخاب کن.');
    case 'CEILINGSECTION':
      return [t('Pick the first overhead support.','تکیه‌گاه اول بالای سقف را انتخاب کن.'),
        t('Pick the opposite overhead support.','تکیه‌گاه مقابل را انتخاب کن.'),
        t('Pick the finished underside level between the supports.','تراز زیر سقف کاذب را بین تکیه‌گاه‌ها انتخاب کن.')][count];
    case 'MULTILINE':
      return t('Draw the axis points. Enter finishes the two lines. C closes them.','نقاط محور را بزن. اینتر دو خط را تمام می‌کند و C آن‌ها را می‌بندد.');
    default:
      return '';
  }
}

export default function PlanSectionControls({LengthInput,t,units,command,settings,onChange,onStart,onFinish,selectionCount}){
  const size=(key,en,fa,min)=><LengthInput key={key} label={t(en,fa)} value={settings[key]} units={units} min={min} onCommit={value=>onChange(key,value)}/>;
  const choice=(key,en,fa,options)=><label>{t(en,fa)}<select value={settings[key]} onChange={event=>onChange(key,event.target.value)}>
    {options.map(([value,en,fa])=><option key={value} value={value}>{t(en,fa)}</option>)}
  </select></label>;
  const integer=(key,en,fa,min,max)=><label>{t(en,fa)}<input type="number" min={min} max={max} value={settings[key]} onChange={event=>onChange(key,Number(event.target.value))}/></label>;
  const thickness=(key,en,fa)=> <>
    {size(key,en,fa,.01)}
    <label>{t('Standard thickness','ضخامت‌های رایج')}
      <select value="" onChange={event=>onChange(key,Number(event.target.value))}>
        <option value="" disabled>{t('Choose size','انتخاب اندازه')}</option>
        {[.05,.06,.09,.10,.12,.14,.15,.18,.20,.24,.25,.30,.36,.48].map(value=>
          <option key={value} value={value}>{Number((value/(units==='in'?.0254:.01)).toFixed(2))} {units}</option>)}
      </select>
    </label>
  </>;
  return <details open={Boolean(sectionPrompt(command,0,t))||undefined}>
    <summary>{t('Sections & elevations','برش و نما')}</summary>
    <div className="ps-tools">
      {[
        ['WW','SECTIONWALL','Wall section','ضخامت دیوار'],
        ['SSL','SECTIONSLAB','Slab section','ضخامت دال'],
        ['LTP','SECTIONSTAIR','Stair section','مقطع پله'],
        ['WDE','WINDOWELEVATION','Window elevation','نمای پنجره'],
        ['SGB','CEILINGSECTION','Suspended ceiling','سقف کاذب'],
        ['ML','MULTILINE','Parallel lines','دو خط موازی'],
      ].map(([code,name,en,fa])=><button key={code} aria-pressed={command===name} onClick={()=>onStart(code)}><kbd>{code}</kbd>{t(en,fa)}</button>)}
    </div>
    {command==='SECTIONWALL'&&thickness('wallThickness','Wall thickness','ضخامت دیوار')}
    {command==='SECTIONSLAB'&&thickness('slabThickness','Slab thickness','ضخامت دال')}
    {command==='MULTILINE'&&size('multilineWidth','Distance between lines','فاصلهٔ بین دو خط',.01)}
    {command==='SECTIONSTAIR'&&<fieldset><legend>{t('Stair section settings','تنظیمات مقطع پله')}</legend>
      {choice('stairStyle','Stair type','نوع پله',[
        ['straight','Straight','مستقیم'],['return','Return with landing','رفت‌وبرگشت با پاگرد'],['scissor','Scissor projection','قیچی در برش'],
      ])}
      {choice('firstRun','First run direction','جهت بازوی اول',[['right','Right','به راست'],['left','Left','به چپ']])}
      {integer('risers','Risers per storey','تعداد ارتفاع پله در هر طبقه',3,40)}
      {integer('stories','Storeys to repeat','تعداد طبقات تکرار',1,12)}
      {size('landing','Landing length','طول پاگرد',.15)}
      {size('waist','Flight thickness','ضخامت شمشیری',.04)}
      {size('beamWidth','Beam width','عرض تیر',.03)}
      {size('beamHeight','Beam depth','ارتفاع تیر',.04)}
    </fieldset>}
    {command==='WINDOWELEVATION'&&<fieldset><legend>{t('Window elevation settings','تنظیمات نمای پنجره')}</legend>
      {choice('windowStyle','Window type','نوع پنجره',[
        ['sliding','Sliding','کشویی'],['casement','Side-hung','لولایی'],['fixed','Fixed','ثابت'],
      ])}
      {integer('sashes','Sashes','تعداد لنگه',1,6)}
      {size('frame','Outer frame width','عرض قاب بیرونی',.008)}
      {size('sash','Sash rim width','عرض پروفیل لنگه',.008)}
      {size('transom','Top transom height (0 to omit)','ارتفاع کتیبهٔ بالا (صفر یعنی بدون کتیبه)',0)}
    </fieldset>}
    {command==='CEILINGSECTION'&&<fieldset><legend>{t('Ceiling section settings','تنظیمات برش سقف کاذب')}</legend>
      {size('board','Gypsum board thickness','ضخامت پنل گچی',.005)}
      {size('hangerSpacing','Maximum hanger spacing','حداکثر فاصلهٔ آویزها',.15)}
    </fieldset>}
    {['SECTIONWALL','SECTIONSLAB','WINDOWELEVATION'].includes(command)&&<button disabled={!selectionCount} onClick={onFinish}>
      {t('Apply to selection','اعمال به موارد انتخاب‌شده')} ({selectionCount})
    </button>}
    {command==='MULTILINE'&&<button onClick={onFinish}>{t('Finish lines','پایان دو خط')}</button>}
  </details>;
}
