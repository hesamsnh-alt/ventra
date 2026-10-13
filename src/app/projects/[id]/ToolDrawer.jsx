'use client';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
const labels={
 more:{en:'More tools',fa:'ابزارهای بیشتر',ar:'أدوات إضافية'},
 styles:{en:'Styles',fa:'سبک‌های طراحی',ar:'أنماط التصميم'},
 camera:{en:'Camera & views',fa:'دوربین و نماها',ar:'الكاميرا والمناظر'},
 navigation:{en:'Pan & zoom',fa:'حرکت و زوم',ar:'التحريك والتقريب'},
 export:{en:'Export & reports',fa:'خروجی و گزارش‌ها',ar:'التصدير والتقارير'},
 render:{en:'Realistic render',fa:'رندر واقعی',ar:'التصيير الواقعي'},
 prompt:{en:'Design with a prompt',fa:'طراحی با پرامپت',ar:'التصميم بالوصف'},
 info:{en:'Model details',fa:'جزئیات مدل',ar:'تفاصيل النموذج'},
 plants:{en:'Indoor plants & trees',fa:'گیاهان و درختچه‌های آپارتمانی',ar:'نباتات وشجيرات داخلية'},
 catalog:{en:'Furniture catalog',fa:'کاتالوگ مبلمان',ar:'كتالوج الأثاث'},
 edit:{en:'Selected furniture settings',fa:'تنظیمات مبلمان انتخاب‌شده',ar:'إعدادات الأثاث المختار'},
 inspector:{en:'Object inspector',fa:'اطلاعات اجزای مدل',ar:'معلومات عناصر النموذج'},
};
export default function ToolDrawer({title,children,className='',onClose}){
 const {language}=useLanguage();
 return <details className={`ventra-tool-drawer ${className}`} onToggle={e=>{if(!e.currentTarget.open)onClose?.();}}>
  <summary><span>{labels[title]?.[language]||labels[title]?.en||title}</span><span className="ventra-drawer-chevron" aria-hidden="true">⌄</span></summary>
  <div className="ventra-drawer-content">{children}</div>
 </details>;
}
