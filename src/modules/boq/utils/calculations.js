const round = (value, decimals = 2) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(decimals));
};

export function calculateRowTotal(quantity, unitRate) {
  return round(quantity * unitRate);
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
  return round(
    rows.reduce((sum, row) => sum + Number(row.total || 0), 0)
  );
}

export function calculateVAT(subtotal, vatRate = 5) {
  return round((subtotal * vatRate) / 100);
}

export function calculateGrandTotal(rows = [], vatRate = 5) {
  const subtotal = calculateSubtotal(rows);
  const vat = calculateVAT(subtotal, vatRate);

  return {
    subtotal,
    vat,
    grandTotal: round(subtotal + vat),
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