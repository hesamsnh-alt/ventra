import { classifyEstimateItem } from './estimateClassification.mjs';
import { calculateBoqBudget } from './boqBudget.mjs';

export const BOQ_EXPORT_HEADERS = ['Item No.', 'Section', 'Description', 'Unit', 'Quantity', 'Rate (AED)', 'Amount (AED)', 'Quantity status', 'Included in tender subtotal', 'Source', 'Quantity basis', 'Rate source', 'Notes'];

// Export the same commercial selection as the BOQ screen, while accounting
// separately for every displayed row. Inclusion is not proof of scope completeness.
export function buildBoqExport(items = [], commercial = {}) {
  const sums = { verified: 0, provisional: 0, pending: 0 };
  const rows = items.map(item => {
    const status = classifyEstimateItem(item);
    const amount = Number(item.quantity) * Number(item.rate);
    const finiteAmount = Number.isFinite(amount) ? amount : 0;
    sums[status] += finiteAmount;
    return [item.itemNumber, item.section, item.description, item.unit,
      item.quantity, item.rate, Number.isFinite(amount) ? amount.toFixed(2) : '',
      {verified:'Verified / reviewed', provisional:'Provisional estimate', pending:'Unresolved / excluded'}[status],
      status === 'verified' ? 'Yes' : 'No', item.source || '', item.quantityBasis || '', item.rateSource || '', item.notes || ''];
  });
  const money = value => Number(value || 0).toFixed(2);
  const budget = calculateBoqBudget(sums, commercial);
  const summary = [
    ['Verified / reviewed subtotal - tender basis', money(sums.verified)],
    ['Provisional subtotal - excluded from tender', money(sums.provisional)],
    ['Unresolved / excluded line amounts - excluded from tender', money(sums.pending)],
    ['All displayed line amounts - before markups, not tender subtotal', money(sums.verified + sums.provisional + sums.pending)],
    ['BOQ budget subtotal - including provisional, excluding unresolved', money(budget.subtotal)],
    [`Budget overhead ${commercial.overheadPercentage || 0}%`, money(budget.overhead)],
    [`Budget profit ${commercial.profitPercentage || 0}%`, money(budget.profit)],
    [`Budget discount ${commercial.discountPercentage || 0}%`, money(-budget.discount)],
    [`Budget VAT ${commercial.vatPercentage || 0}%`, money(budget.vat)],
    ['BOQ budget total - including provisional and selected markups', money(budget.total)],
    [`Overhead ${commercial.overheadPercentage || 0}% - tender basis`, money(commercial.overhead)],
    [`Profit ${commercial.profitPercentage || 0}% - tender basis`, money(commercial.profit)],
    [`Discount ${commercial.discountPercentage || 0}% - tender basis`, money(-Number(commercial.discount || 0))],
    [`VAT ${commercial.vatPercentage || 0}% - tender basis`, money(commercial.vat)],
    ['Tender price - verified / reviewed rows with selected markups', money(commercial.total)],
  ];
  return { headers: BOQ_EXPORT_HEADERS, rows, summary, sums,
    note: 'Provisional and unresolved rows are excluded from the tender subtotal. All displayed line amounts are a reconciliation total, not a complete project estimate. Scope completeness and rates require review. Estimate uses its separately selected basis and markups.' };
}
