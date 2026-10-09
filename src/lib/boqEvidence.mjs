// A measured quantity does not establish the catalog specification or rate.
// Keep generated catalog choices provisional until the complete line is reviewed.
export function requireBoqReview(item = {}) {
  if (item.review?.confirmed === true || item.source === 'manual' || item.status === 'manual') return item;
  const quantityVerification = item.quantityVerification ||
    (item.status === 'measured' || item.status === 'measured_rate_pending' || item.measuredFromApsStructure === true || item.verification === 'verified' ? 'measured' :
      item.status === 'quantity_pending' ? 'pending' : 'estimated');
  const next = { ...item, quantityVerification, specificationVerification: 'unconfirmed', reviewRequired: true };
  if (item.status === 'measured' || item.verification === 'verified') {
    next.status = 'provisional_estimate';
    next.verification = 'provisional';
    next.includeInCommercialTotal = false;
  }
  const note = 'REVIEW REQUIRED: Confirm drawing scope, specification, quantity/unit and applicable rate. Geometry alone does not confirm the catalog description.';
  next.notes = String(item.notes || '').includes(note) ? item.notes : [item.notes, note].filter(Boolean).join(' ');
  return next;
}

export function confirmBoqReview(item, reference, checks, reviewedAt = new Date().toISOString()) {
  if (!String(reference || '').trim() || !checks?.scope || !checks?.quantity || !checks?.rate ||
      !Number.isFinite(Number(item.quantity)) || !Number.isFinite(Number(item.rate)) ||
      !(Number(item.quantity) > 0) || !(Number(item.rate) > 0)) {
    throw new Error('Confirm scope/specification, quantity/unit and rate, and enter a drawing or quotation reference. Quantity and rate must be positive.');
  }
  return { ...item, status: 'measured', verification: 'verified', includeInCommercialTotal: true,
    rateMissing: false, reviewRequired: false, specificationVerification: 'reviewed',
    review: { confirmed: true, reference: reference.trim(), reviewedAt },
    notes: `${item.notes || ''} REVIEW CONFIRMED (${reviewedAt}): ${reference.trim()}`.trim() };
}

export function invalidateBoqReview(item) {
  if (!item.review?.confirmed) return item;
  return requireBoqReview({ ...item, review: { ...item.review, confirmed: false },
    reviewRequired: true, status: 'provisional_estimate', verification: 'provisional', includeInCommercialTotal: false });
}
