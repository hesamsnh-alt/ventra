// Commercial inclusion alone is not evidence of quantity verification.
// Explicit unresolved/provisional flags take precedence over legacy verified flags.
export function classifyEstimateItem(item = {}) {
  if(item.source==='manual'&&(!(Number(item.quantity)>0)||!(Number(item.rate)>0)||/^New BOQ item$/i.test(String(item.description||'').trim())))return 'pending';
  if (item.rateMissing === true || ['quantity_pending', 'measured_rate_pending'].includes(item.status) || item.verification === 'pending') return 'pending';
  if (item.reviewRequired === true || item.status === 'provisional_estimate' || item.verification === 'provisional') return 'provisional';
  if (item.includeInCommercialTotal === false) return 'pending';
  if (item.verification === 'verified' || ['measured', 'manual'].includes(item.status)) return 'verified';
  return 'pending';
}
export function partitionEstimateItems(items = []) {
  const groups = { verified: [], provisional: [], pending: [] };
  for (const item of items) groups[classifyEstimateItem(item)].push(item);
  return groups;
}
