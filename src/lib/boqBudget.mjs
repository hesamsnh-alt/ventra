import {quotationLineAmount, currencyPercentage, currencySum} from './commercialDocument.mjs';
export const boqLineAmount = item => {
  const valid=value=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):0;
  return quotationLineAmount({quantity:valid(item?.quantity),rate:valid(item?.rate)});
};
// Budget includes provisional costs, while unresolved rows stay excluded.
export function calculateBoqBudget(sums = {}, settings = {}) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const pct = (base,value) => currencyPercentage(base,Math.max(0,number(value)));
  const subtotal = currencySum([number(sums.verified),number(sums.provisional)]);
  const overhead = pct(subtotal,settings.overheadPercentage);
  const withOverhead = currencySum([subtotal,overhead]);
  const profit = pct(withOverhead,settings.profitPercentage);
  const beforeDiscount = currencySum([withOverhead,profit]);
  const discount = pct(beforeDiscount,settings.discountPercentage);
  const taxable = quotationLineAmount({quantity:Math.max(0,beforeDiscount-discount),rate:1});
  const vat = pct(taxable,settings.vatPercentage);
  return { subtotal, overhead, profit, discount, vat, total:currencySum([taxable,vat]),
    displayed:currencySum([subtotal,number(sums.pending)]) };
}
