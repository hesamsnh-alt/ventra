export const emptyBranding = { companyName: "", address: "", contact: "", taxNumber: "", logo: "", letterhead: "" };
// Round decimal currency half-up in integer fils. Binary floating-point
// multiplication can turn 10.075 into 10.074999..., losing a fils per row.
function decimal(value, message) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(message);
  }
  const [mantissa, exponent = '0'] = Number(value).toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  let digits = BigInt((whole + fraction).replace(/^\+/, ''));
  let scale = fraction.length - Number(exponent);
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return { digits, scale };
}
function roundedDivision(value, divisor) {
  return (value + divisor / 2n) / divisor;
}
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
function moneyFromCents(cents) {
  if (cents > MAX_CENTS) throw new Error("Quotation amount is too large.");
  return Number(cents) / 100;
}
function lineCents(item) {
  const message = "Quantity and rate must be finite non-negative numbers.";
  const quantity = decimal(item?.quantity, message), rate = decimal(item?.rate, message);
  const cents = roundedDivision(quantity.digits * rate.digits * 100n, 10n ** BigInt(quantity.scale + rate.scale));
  moneyFromCents(cents);
  return cents;
}
export function quotationLineAmount(item) {
  return moneyFromCents(lineCents(item));
}
export function currencyPercentage(amount, percentage) {
  const cents = lineCents({quantity: amount, rate: 1});
  const pct = decimal(percentage, 'Percentage must be finite and non-negative.');
  return moneyFromCents(roundedDivision(cents * pct.digits, 100n * 10n ** BigInt(pct.scale)));
}
export function currencySum(values) {
  return moneyFromCents(values.reduce((sum, value) => sum + lineCents({quantity:value, rate:1}), 0n));
}
export function quotationTotals(items, vatPct) {
  const message = "VAT must be between 0 and 100.";
  const percentage = decimal(vatPct, message);
  if (Number(vatPct) > 100) throw new Error(message);
  if (!Array.isArray(items)) throw new Error("Quotation items must be a list.");
  const subtotal = items.reduce((total, item) => total + lineCents(item), 0n);
  const vat = roundedDivision(subtotal * percentage.digits, 100n * 10n ** BigInt(percentage.scale));
  return { subtotal: moneyFromCents(subtotal), vat: moneyFromCents(vat), total: moneyFromCents(subtotal + vat) };
}
export function brandingHtml(branding) {
  const escape = (value) => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const image = (value, width) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value || "") ? `<img src="${value}" width="${width}" />` : "";
  return `<header>${image(branding.letterhead, 700)}${image(branding.logo, 110)}<h2>${escape(branding.companyName)}</h2><p>${escape(branding.address)}</p><p>${escape(branding.contact)}</p><p>${escape(branding.taxNumber)}</p></header>`;
}
