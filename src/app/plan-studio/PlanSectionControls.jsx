import {GRID_COMMANDS} from '@/lib/planStudio/sections.mjs';

export function sectionPrompt(command,count,t){
  switch(command){
    case 'GRIDCOLUMNS':
    case 'GRIDLABELS':
      return count?t('Pick the opposite corner around the axes.','گوشهٔ مقابل کادرِ آکس‌ها را بزن.'):
        t('Pick a corner around the axes, or press Enter to apply to preselected lines.','گوشهٔ کادر آکس‌ها را بزن یا برای اعمال به خطوط انتخاب‌شده اینتر بزن.');
    case 'PERIMETERDIMENSIONS':
      return t('Click a closed polyline, or press Enter to dimension preselected outlines.','روی پلی‌لاین بسته بزن یا برای اندازه‌گذاری دورخط‌های انتخاب‌شده اینتر بزن.');
    case 'PLANSECTIONCUT':
      return [
        t('Pick the first endpoint of the cut across the plan.','ابتدای خط برش روی پلان را بزن.'),
        t('Pick the other endpoint of the cut.','انتهای خط برش را بزن.'),
        t('Pick the side to look toward.','سمتی را که به آن نگاه می‌کنی انتخاب کن.'),
        t('Place the section at its datum outside the plan.','تراز مبنای مقطع را بیرون پلان درج کن.'),
      ][count];
    case 'SECTIONWALL':
    case 'SECTIONSLAB':
      return t('Select guide lines, arcs or polylines, then press Enter.','خط، قوس یا پلی‌لاین‌های راهنما را انتخاب کن و اینتر بزن.');
    case 'WINDOWELEVATION':
      return t('Select window rectangles, then press Enter.','مستطیل‌های پنجره را انتخاب کن و اینتر بزن.');
    case 'SECTIONSTAIR':
      return count?t('Pick the opposite corner at the next floor level.','گوشهٔ مقابل را روی تراز طبقهٔ بعد انتخاب کن.'):t('Pick a lower corner of the stair bay.','گوشهٔ پایین دهانهٔ پله را انتخاب کن.');
    case 'STEPSSECTION':
      return [
        t('Pick just before the first tread line of one flight.','در امتداد یک بازو، کمی قبل از خط اول پله بزن.'),
        t('Pick just after the last tread line of that flight.','در همان امتداد، کمی بعد از آخرین خط پله بزن.'),
        t('Place the first riser of the section at its starting level.','جای اولین پله را در تراز شروع مقطع بزن.'),
      ][count];
    case 'RAILINGELEVATION':
      return count?t('Pick the other end of the railing baseline.','سر دیگر خط مبنای نرده را بزن.'):t('Pick one end of the railing baseline.','یک سر خط مبنای نرده را بزن.');
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
        ['ZZBZ','GRIDCOLUMNS','Columns at grid crossings','ستون‌گذاری تقاطع آکس‌ها'],
        ['AZH','GRIDLABELS','Grid labels and dimensions','شماره و اندازهٔ آکس‌ها'],
        ['LM','PLANSECTIONCUT','Section from plan','برش از پلان'],
        ['DPL','PERIMETERDIMENSIONS','Dimension outline','اندازه‌گذاری دورخط'],
        ['WW','SECTIONWALL','Wall section','ضخامت دیوار'],
        ['SSL','SECTIONSLAB','Slab section','ضخامت دال'],
        ['LTP','SECTIONSTAIR','Stair section','مقطع پله'],
        ['LXTB','STEPSSECTION','Section from treads','مقطع از خطوط پله'],
        ['LG','RAILINGELEVATION','Railing elevation','نمای نرده'],
        ['WDE','WINDOWELEVATION','Window elevation','نمای پنجره'],
        ['SGB','CEILINGSECTION','Suspended ceiling','سقف کاذب'],
        ['ML','MULTILINE','Parallel lines','دو خط موازی'],
      ].map(([code,name,en,fa])=><button key={code} aria-pressed={command===name} onClick={()=>onStart(code)}><kbd>{code}</kbd>{t(en,fa)}</button>)}
    </div>
    {command==='GRIDCOLUMNS'&&<fieldset><legend>{t('Column symbol dimensions','ابعاد علامت ستون')}</legend>
      {size('gridColumnWidth','Width','عرض',.05)}
      {size('gridColumnDepth','Depth','عمق',.05)}
    </fieldset>}
    {command==='GRIDLABELS'&&<fieldset><legend>{t('Axis annotation','اندازه و علامت آکس')}</legend>
      {size('gridLabelOffset','Dimension offset','فاصلهٔ خط اندازه',.1)}
      {size('gridBubbleRadius','Bubble radius','شعاع دایرهٔ آکس',.04)}
    </fieldset>}
    {command==='PLANSECTIONCUT'&&<fieldset><legend>{t('Plan section settings','تنظیمات برش از پلان')}</legend>
      {size('cutDepth','Projection depth (0 for cut only)','عمق نمایش پشت برش (صفر برای خود برش)',0)}
      <label>{t('Section label','عنوان برش')}<input maxLength={4} dir="ltr" value={settings.cutLabel}
        onChange={event=>onChange('cutLabel',event.target.value.toUpperCase())}/></label>
    </fieldset>}
    {command==='PERIMETERDIMENSIONS'&&size('perimeterDimOffset','Dimension offset','فاصلهٔ خط اندازه',.05)}
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
    {command==='STEPSSECTION'&&<fieldset><legend>{t('Section from treads','مقطع از خطوط پله')}</legend>
      {choice('stepRiseMode','Height input','روش تعیین ارتفاع',[['step','Per riser','هر پله'],['total','Total flight rise','ارتفاع کل بازو']])}
      {settings.stepRiseMode==='total'?size('stepTotal','Total flight rise','ارتفاع کل بازو',.02):size('stepRise','Height per riser','ارتفاع هر پله',.01)}
      {choice('stepDirection','Elevation change','تغییر تراز',[['up','Ascending','بالارونده'],['down','Descending','پایین‌رونده']])}
      {choice('stepRun','Direction in section','جهت در مقطع',[['right','Right','به راست'],['left','Left','به چپ']])}
      {size('stepStartLanding','Start landing','طول پاگرد ابتدا',0)}
      {size('stepEndLanding','End landing','طول پاگرد انتها',0)}
      {size('stepWaist','Waist depth (0 for outline only)','ضخامت شمشیری (صفر برای خط مقطع)',0)}
      {settings.stepWaist>0&&choice('stepHatch','Hatch','هاشور',[['concrete','Concrete','بتن'],['none','None','بدون هاشور']])}
    </fieldset>}
    {command==='RAILINGELEVATION'&&<fieldset><legend>{t('Railing settings','تنظیمات نرده')}</legend>
      {size('railHeight','Total height','ارتفاع کل',.15)}
      {size('handrailSize','Handrail thickness','ضخامت دست‌انداز',.005)}
      {size('handrailExtension','Handrail extension at each end','بیرون‌زدگی دست‌انداز در هر سر',0)}
      {size('railTopGap','Gap below handrail','فاصلهٔ زیر دست‌انداز',0)}
      {size('railBottomGap','Gap below lower rail','فاصلهٔ زیر ریل پایین',0)}
      {size('railBar','Bar thickness','ضخامت میله',.005)}
      {size('railSpacing','Maximum bar spacing','حداکثر فاصلهٔ محور میله‌ها',.005)}
      {size('railPost','Post thickness','ضخامت پایه',.005)}
      {size('railPostSpacing','Maximum post spacing','حداکثر فاصلهٔ محور پایه‌ها',.01)}
      {choice('railEndPosts','Posts at both ends','پایه در ابتدا و انتها',[['yes','Yes','بله'],['no','No','خیر']])}
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
    {[...GRID_COMMANDS,'PERIMETERDIMENSIONS','SECTIONWALL','SECTIONSLAB','WINDOWELEVATION'].includes(command)&&<button disabled={!selectionCount} onClick={onFinish}>
      {t('Apply to selection','اعمال به موارد انتخاب‌شده')} ({selectionCount})
    </button>}
    {command==='MULTILINE'&&<button onClick={onFinish}>{t('Finish lines','پایان دو خط')}</button>}
  </details>;
}
