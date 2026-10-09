import fs from "node:fs/promises";
import path from "node:path";

const text = `كل مشروع بناء يبدأ برؤية.

وتحويل هذه الرؤية إلى مبنى مكتمل يتطلب تنسيق المخططات والكميات والميزانيات والفرق والمواعيد.

تعرّف على ڤنترا.

مساحة عمل متكاملة لتخطيط أعمال البناء وتقدير التكاليف وتوثيق المشروع.

ابدأ من لوحة التحكم.

أنشئ مشروعاً وأضف العميل والموقع والميزانية والتواريخ المخططة.

احتفظ بالمخططات والمستندات والتكاليف والتحديثات في متناولك.

في مركز المخططات، ارفع ملفات المشروع الأصلية.

تستخدم صور المخططات والملفات الهندسية المدعومة مسار المعالجة المناسب لكل نوع.

راجع المعلومات المستخرجة مقارنةً بالمخطط الأصلي قبل الاعتماد عليها.

استكشف معاينة تفاعلية ثلاثية الأبعاد.

دوّر المشهد، وافحص الجدران والفتحات والأثاث والتشطيبات، وصدّر صورة لعرضها على العميل.

للملفات الهندسية المدعومة، افحص البيانات الأصلية باستخدام العارض الهندسي.

تحقق دائماً من أبعاد التنفيذ بالرجوع إلى المخططات الأصلية.

انتقل إلى جدول الكميات.

راجع الكميات والوحدات، وعدّل الأوصاف، وحدّد نطاق العمل.

في قسم تقدير التكاليف، راجع تفاصيل التكلفة وعدّل الأسعار وفق عروض الموردين والمقاولين.

جهّز عرضك التجاري باستخدام إعدادات المصاريف غير المباشرة والربح والخصم والضريبة المتاحة.

أعدّ عرض السعر.

راجع البنود والإجماليات، وأضف اسم شركتك وشعارها، وقدّم عرضاً احترافياً.

اربط الكميات بخطة التنفيذ باستخدام ميزة الجدولة الجديدة من جدول الكميات.

حمّل جدول كميات المشروع وراجع أقسام الأنشطة، من التجهيز والأعمال الإنشائية إلى الكهرباء والسباكة والأنظمة الميكانيكية والتشطيبات.

اختر طريقة تنفيذ لكل نشاط.

قارن الخيارات، مثل صب الخرسانة بالمضخة أو بالطريقة اليدوية.

استخدم معدل الإنتاج المرجعي كنقطة بداية، أو أدخل معدل مقاولك عندما لا يتوفر معدل مرجعي.

حدّد عدد الفرق وساعات العمل والاستراحات ونسبة الوقت الإنتاجي.

اختر أيام العمل وأضف العطلات وفترات الانتظار اللازمة.

تحسب ڤنترا مدد الأنشطة وتواريخها المقترحة بناءً على هذه المدخلات.

راجع ترتيب الأنشطة.

تعتمد الجدولة الحالية خطة محافظة تُنفّذ فيها الأنشطة بالتتابع.

راجعها وفق متطلبات الموقع، ثم احفظ البرنامج الأساسي المشترك لفريقك.

مع تقدم العمل، حدّث قائمة المتابعة.

ضع علامة على الأنشطة المكتملة، أو سجّل نسبة إنجاز جزئية للأعمال الجارية.

يحسب ملخص الجدولة التقدم بأوزان تعتمد على الجهد التقديري للعمل.

قارن الإنجاز المسجّل بالبرنامج الأساسي.

تظهر الأنشطة المتأخرة عن الخطة والمتجاوزة لموعدها باللون الأحمر.

وتظهر الأعمال المكتملة باللون الأخضر.

حافظ على تواريخ البرنامج الأساسي ثابتة حتى تبقى التأخيرات واضحة.

في قسم الفريق والعقد، نظّم صلاحيات الوصول وسجّل مراحل الدفع المتفق عليها.

حدّد الدفعة المقدمة ونسب الدفعات المرحلية والتسوية النهائية.

يساعد تقدم البرنامج في المراجعة، لكنه لا يعتمد الدفعات تلقائياً.

استخدم قسم المهام لمتابعة المسؤوليات وحالة الأعمال.

سجّل التقارير اليومية ونظّم صور الموقع والمستندات الداعمة وراجع سجل نشاط المشروع.

تدعم أدلة الموقع تقييم فريقك؛ فالصورة وحدها لا تثبت اكتمال العمل.

ادعُ أعضاء المشروع بصلاحيات مناسبة.

يمكن للأعضاء المخوّلين تحديث البرنامج المشترك.

ويمكن للمستخدمين بصلاحية المشاهدة متابعة البرنامج دون تعديله.

استكشف الأدوات الهندسية للحسابات المساعدة وتحويل الوحدات.

أدر حسابك واشتراكك من الملف الشخصي والفوترة، وتواصل مع الدعم عند الحاجة.

شاهد التصميم.

راجع الكميات.

أعدّ الميزانية.

خطّط للعمل.

تابع التقدم.

ڤنترا.

رؤية أوضح لمشروعك الإنشائي.`;

async function main() {
  if (text.length > 4096) throw new Error("Narration is too long.");
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Node.js 20.12 or newer is required.");
  }

  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    throw new Error("Cannot load .env.local. Run from the Ventra folder.");
  }

  const key = (
    process.env.OPENAI_TTS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();

  if (!key) throw new Error("No API key found in .env.local.");

  const dir = path.resolve("ventra-voiceover-output");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `ventra-narration-arabic-${stamp}`);

  console.log("Generating Arabic narration. Please wait...");
  console.log("This makes one paid API request. No automatic retries.");

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "cedar",
        response_format: "mp3",
        input: text,
        instructions: "Read only the supplied Arabic text in clear Modern Standard Arabic for a UAE construction technology advertisement. Warm, confident, natural professional voice. Moderate pace with brief pauses. Pronounce Ventra as VEN-truh. Do not translate or add commentary, music or sound effects."
      }),
      signal: AbortSignal.timeout(600000)
    });
  } catch {
    throw new Error("Network failure or timeout. Check API usage before retrying.");
  }

  if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error("HTTP " + response.status + " | code: " + (d.error?.code || "unknown") + " | type: " + (d.error?.type || "unknown"));
    const hint = {
      400: "Speech request rejected. Check model and voice access.",
      401: "API key rejected. Check it locally.",
      403: "API project permission denied.",
      429: "API quota or rate limit reached. Check API billing."
    };
    throw new Error(`HTTP ${response.status}: ${hint[response.status] || "Speech service failed."}`);
  }

  if (!/audio\//i.test(response.headers.get("content-type") || "")) {
    throw new Error("Response was not audio. No MP3 saved.");
  }

  let audio;
  try {
    audio = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error("Audio download interrupted. Check API usage before retrying.");
  }
  if (audio.length < 1024) throw new Error("Audio response was too small.");

  await fs.writeFile(`${base}.mp3`, audio, { flag: "wx" });
  await fs.writeFile(`${base}.txt`, text, { flag: "wx" });

  console.log("SUCCESS");
  console.log(`Audio: ${base}.mp3`);
  console.log(`Transcript: ${base}.txt`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});



