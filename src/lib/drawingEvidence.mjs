// Preserve explicit CAD text properties, never treat an arbitrary number/name
// as a schedule quantity or automatically approve a catalog specification.
export function collectDrawingText(objects = []) {
  const records = [], seen = new Set();
  let totalCharacters = 0, truncated = false;
  const isText = key => /^(text|textstring|contents?|mtext|notes?|generalnotes|annotation|textvalue|textcontents?)$/i.test(String(key).replace(/[^a-z]/gi, ''));
  function add(dbId, field, raw) {
    if (typeof raw !== 'string') return;
    const text = raw.replace(/\\P/gi, '\n').replace(/\{\\[^;{}]+;/g, '').replace(/[{}]/g, '').trim();
    if (!text || !/[\p{L}]/u.test(text)) return;
    const key = JSON.stringify([dbId, text]);
    if (seen.has(key)) return;
    if (records.length >= 500 || totalCharacters + text.length > 500000 || text.length > 6000) { truncated = true; return; }
    seen.add(key); totalCharacters += text.length;
    records.push({ dbId: dbId ?? null, field, text, source: 'aps_property_text', verification: 'unreviewed' });
  }
  function walk(value, dbId, path = '', depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (isText(value.displayName) || isText(value.attributeName)) add(dbId, value.displayName || value.attributeName, value.displayValue);
    for (const [key, child] of Object.entries(value)) {
      if (isText(key)) add(dbId, path + key, child);
      if (child && typeof child === 'object') walk(child, dbId, path + key + '.', depth + 1);
    }
  }
  for (const object of Array.isArray(objects) ? objects : []) walk(object, object?.dbId ?? object?.objectid ?? object?.id);
  return { version: 1, records, truncated, scheduleReconciled: false,
    status: records.length ? 'text_available_for_review' : 'text_unavailable',
    limitation: 'Text availability depends on APS properties. Table layout, repeated schedules and specification conflicts require review; text alone does not verify quantities.' };
}

export function getDrawingEvidence(takeoff = {}) {
  return takeoff.drawing_evidence || takeoff.advanced_takeoff?.drawing_evidence || takeoff.raw_result?.drawing_evidence || null;
}
