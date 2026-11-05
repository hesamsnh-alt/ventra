import {quotationLineAmount,currencySum,currencyPercentage} from '../../../lib/commercialDocument.mjs';
const round = (value, decimals = 2) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(decimals));
};

export function calculateRowTotal(quantity, unitRate) {
  return quotationLineAmount({quantity:Math.max(0,Number(quantity)||0),rate:Math.max(0,Number(unitRate)||0)});
}

export function calculateRow(row) {
  const quantity = Number(row.quantity ?? 0);
  const unitRate = Number(row.unitRate ?? 0);

  return {
    ...row,
    quantity,
    unitRate,
    total: calculateRowTotal(quantity, unitRate),
  };
}

export function calculateSubtotal(rows = []) {
  return currencySum(rows.map(row=>row.quantity===undefined&&row.unitRate===undefined
    ? Math.max(0,Number(row.total)||0):calculateRowTotal(row.quantity,row.unitRate)));
}

export function calculateVAT(subtotal, vatRate = 5) {
  return currencyPercentage(subtotal,vatRate);
}

export function calculateGrandTotal(rows = [], vatRate = 5) {
  const subtotal = calculateSubtotal(rows);
  const vat = calculateVAT(subtotal, vatRate);

  return {
    subtotal,
    vat,
    grandTotal: currencySum([subtotal,vat]),
  };
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function formatQuantity(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(Number(value ?? 0));
}
