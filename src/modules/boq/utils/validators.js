export function isNumber(value) {
  return Number.isFinite(Number(value));
}

export function isPositiveNumber(value) {
  return isNumber(value) && Number(value) >= 0;
}

export function validateRow(row) {
  const errors = {};

  if (!row.description || row.description.trim() === "") {
    errors.description = "Description is required.";
  }

  if (!isPositiveNumber(row.quantity)) {
    errors.quantity = "Quantity must be a valid number.";
  }

  if (!isPositiveNumber(row.unitRate)) {
    errors.unitRate = "Unit Rate must be a valid number.";
  }

  if (!row.unit || row.unit.trim() === "") {
    errors.unit = "Unit is required.";
  }

  if (!row.section || row.section.trim() === "") {
    errors.section = "Section is required.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateRows(rows = []) {
  const rowErrors = {};

  rows.forEach((row, index) => {
    const result = validateRow(row);

    if (!result.valid) {
      rowErrors[index] = result.errors;
    }
  });

  return {
    valid: Object.keys(rowErrors).length === 0,
    errors: rowErrors,
  };
}