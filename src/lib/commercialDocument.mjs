export const emptyBranding = { companyName: "", address: "", contact: "", taxNumber: "", logo: "", letterhead: "" };
export function quotationTotals(items, vatPct) {
  const percentage = Number(vatPct);
  if (vatPct === "" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error("VAT must be between 0 and 100.");
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  for (const item of items) {
    const quantity = Number(item.quantity), rate = Number(item.rate);
    if (item.quantity === "" || item.rate === "" || !Number.isFinite(quantity) || !Number.isFinite(rate) || quantity < 0 || rate < 0) throw new Error("Quantity and rate must be finite non-negative numbers.");
    subtotal += round(quantity * rate);
  }
  subtotal = round(subtotal);
  const vat = round(subtotal * percentage / 100);
  const total = round(subtotal + vat);
  if (![subtotal, vat, total].every(Number.isFinite)) throw new Error("Quotation amount is too large.");
  return { subtotal, vat, total };
}
export function brandingHtml(branding) {
  const escape = (value) => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const image = (value, width) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value || "") ? `<img src="${value}" width="${width}" />` : "";
  return `<header>${image(branding.letterhead, 700)}${image(branding.logo, 110)}<h2>${escape(branding.companyName)}</h2><p>${escape(branding.address)}</p><p>${escape(branding.contact)}</p><p>${escape(branding.taxNumber)}</p></header>`;
}
