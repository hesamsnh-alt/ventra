import {
  normalizeKey,
  toNumber,
} from "./utils";

import {
  hasFormula,
} from "./formulas";

import {
  resolveGeometry,
} from "./geometry";

export function validateRule({
  rule,
  priceItem,
  takeoff,
}) {
  const errors = [];
  const warnings = [];

  if (!rule) {
    errors.push(
      "Rule is missing."
    );

    return {
      valid: false,
      errors,
      warnings,
    };
  }

  if (!rule.item_code) {
    errors.push(
      "Rule item_code is missing."
    );
  }

  if (!priceItem) {
    errors.push(
      `Missing price item: ${
        rule.item_code || "Unknown"
      }`
    );
  }

  const formulaType =
    String(
      rule.formula_type ||
        "multiply"
    ).toLowerCase();

  if (
    !hasFormula(formulaType)
  ) {
    errors.push(
      `Unsupported formula: ${formulaType}`
    );
  }

  const geometryProperty =
    normalizeKey(
      rule.geometry_property
    );

  const geometryType =
    normalizeKey(
      rule.geometry_type
    );

  if (
    formulaType !== "manual" &&
    !geometryProperty &&
    !geometryType
  ) {
    errors.push(
      "geometry_property or geometry_type is required."
    );
  }

  const geometry =
    resolveGeometry(
      rule,
      takeoff
    );

  if (
    formulaType !== "manual" &&
    !geometry.found
  ) {
    warnings.push(
      `Geometry not found for ${
        rule.item_code
      }. Expected: ${
        geometry.key || "unknown"
      }`
    );
  }

  if (
    rule.multiplier !== null &&
    rule.multiplier !== undefined &&
    !Number.isFinite(
      Number(rule.multiplier)
    )
  ) {
    errors.push(
      "Multiplier must be numeric."
    );
  }

  if (
    priceItem &&
    !priceItem.unit
  ) {
    warnings.push(
      `Unit is missing for ${
        priceItem.item_code
      }.`
    );
  }

  if (
    priceItem
  ) {
    const availableRate =
      toNumber(
        priceItem.standard_rate
      ) ||
      toNumber(
        priceItem.material_rate
      ) +
        toNumber(
          priceItem.labor_rate
        ) +
        toNumber(
          priceItem.equipment_rate
        ) +
        toNumber(
          priceItem.transport_rate
        );

    if (
      availableRate <= 0
    ) {
      warnings.push(
        `No valid rate found for ${priceItem.item_code}.`
      );
    }
  }

  return {
    valid:
      errors.length === 0,
    errors,
    warnings,
    geometry,
  };
}