// Budget includes provisional costs, while unresolved rows stay excluded.
export function calculateBoqBudget(sums = {}, settings = {}) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const pct = value => Math.max(0, number(value)) / 100;
  const subtotal = number(sums.verified) + number(sums.provisional);
  const overhead = subtotal * pct(settings.overheadPercentage);
  const profit = (subtotal + overhead) * pct(settings.profitPercentage);
  const discount = (subtotal + overhead + profit) * pct(settings.discountPercentage);
  const taxable = Math.max(0, subtotal + overhead + profit - discount);
  const vat = taxable * pct(settings.vatPercentage);
  return { subtotal, overhead, profit, discount, vat, total: taxable + vat,
    displayed: subtotal + number(sums.pending) };
}
