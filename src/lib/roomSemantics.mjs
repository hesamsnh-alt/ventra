// Preserve source names; normalize only the use classifier.
export function canonicalRoomType(room) {
  const name = String(room?.name || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  const text = `${name} ${room?.type || ''}`.toLowerCase();
  // An explicit outdoor label outranks a generic/inferred indoor use.
  if (/(balcony|terrace|patio|تراس|بالکن|ایوان|شرفة|شرفه|بلكونة|بلکونة)/.test(text)) return 'balcony';
  if (/(bath|toilet|\bwc\b|shower|washroom|powder|سرویس|حمام|توالت|دستشویی|دستشوئی|دورة\s*المیاه|مرحاض)/.test(text)) return 'bathroom';
  if (/(store|storage|closet|utility|pantry|انبار|مخزن)/.test(text)) return 'storage';
  const kitchen = /(kitchen|آشپزخانه|اشپزخانه|مطبخ)/.test(text);
  const dining = /(dining|ناهار|غذاخوری|طعام)/.test(text);
  if (kitchen && dining) return 'kitchen_dining';
  if (kitchen) return 'kitchen';
  if (/(living|lounge|family|majlis|پذیرایی|پذیرائی|نشیمن|مجلس|معیشة|معیشه)/.test(text)) return 'living';
  if (dining) return 'dining';
  if (/(bed|bedroom|master|guest room|kids room|children|خواب|غرفة\s*نوم|غرفه\s*نوم)/.test(text)) return 'bedroom';
  if (/(office|study|work|دفتر|مطالعه|مکتب)/.test(text)) return 'office';
  if (/(circulation|corridor|hallway|راهرو|ممر)/.test(text)) return 'circulation';
  return 'room';
}
