import {
  round,
  toNumber,
} from "./utils";

function getMultiplier(rule) {
  const multiplier =
    toNumber(
      rule?.multiplier
    );

  return multiplier || 1;
}

function getOpeningMultiplier(
  rule
) {
  const multiplier =
    toNumber(
      rule?.opening_multiplier
    );

  return multiplier || 1;
}

function getOpeningArea(
  takeoff
) {
  const explicitOpeningArea =
    toNumber(
      takeoff?.opening_area
    );

  if (
    explicitOpeningArea > 0
  ) {
    return explicitOpeningArea;
  }

  return (
    toNumber(
      takeoff?.door_area
    ) +
    toNumber(
      takeoff?.window_area
    )
  );
}

function calculateDirect({
  baseValue,
  rule,
}) {
  return (
    toNumber(baseValue) *
    getMultiplier(rule)
  );
}

function calculateWallNetArea({
  takeoff,
  rule,
}) {
  const wallArea =
    toNumber(
      takeoff?.wall_area
    );

  const openingArea =
    getOpeningArea(
      takeoff
    );

  const openingMultiplier =
    getOpeningMultiplier(
      rule
    );

  return (
    Math.max(
      0,
      wallArea -
        openingArea *
          openingMultiplier
    ) *
    getMultiplier(rule)
  );
}

function calculateWallBothSides(
  context
) {
  /*
   * multiplier معمولاً در دیتابیس 2 است.
   * بنابراین رفتار قبلی حفظ می‌شود.
   */
  return calculateWallNetArea(
    context
  );
}

function calculatePerimeter({
  takeoff,
  baseValue,
  rule,
}) {
  const perimeter =
    toNumber(
      takeoff?.wall_length
    ) ||
    toNumber(baseValue);

  return (
    perimeter *
    getMultiplier(rule)
  );
}

function calculateOpeningDeduction({
  baseValue,
  takeoff,
  rule,
}) {
  const openingArea =
    getOpeningArea(
      takeoff
    );

  return (
    Math.max(
      0,
      toNumber(baseValue) -
        openingArea *
          getOpeningMultiplier(
            rule
          )
    ) *
    getMultiplier(rule)
  );
}

function calculatePercentage({
  baseValue,
  rule,
}) {
  const percentage =
    toNumber(
      rule?.multiplier
    );

  return (
    toNumber(baseValue) *
    (percentage / 100)
  );
}

function calculateManual() {
  return 0;
}

export const FormulaRegistry = {
  direct: calculateDirect,

  count: calculateDirect,

  multiply: calculateDirect,

  area: calculateDirect,

  length: calculateDirect,

  volume: calculateDirect,

  wall_net_area:
    calculateWallNetArea,

  wall_both_sides:
    calculateWallBothSides,

  perimeter:
    calculatePerimeter,

  opening_deduction:
    calculateOpeningDeduction,

  percentage:
    calculatePercentage,

  manual:
    calculateManual,
};

export function hasFormula(
  formulaType
) {
  const key =
    String(
      formulaType || "multiply"
    ).toLowerCase();

  return (
    typeof FormulaRegistry[key] ===
    "function"
  );
}

export function calculateQuantity({
  rule,
  takeoff,
  baseValue,
}) {
  const formulaType =
    String(
      rule?.formula_type ||
        "multiply"
    ).toLowerCase();

  const formula =
    FormulaRegistry[formulaType];

  if (
    typeof formula !==
    "function"
  ) {
    return {
      quantity: 0,
      error:
        `Unknown formula: ${formulaType}`,
    };
  }

  let quantity =
    formula({
      rule,
      takeoff,
      baseValue,
    });

  quantity =
    toNumber(quantity);

  const minimumQuantity =
    toNumber(
      rule?.minimum_quantity
    );

  if (
    quantity > 0 &&
    minimumQuantity > 0 &&
    quantity < minimumQuantity
  ) {
    quantity =
      minimumQuantity;
  }

  const precision =
    Number.isInteger(
      rule?.rounding_precision
    )
      ? rule.rounding_precision
      : 2;

  return {
    quantity: round(
      quantity,
      precision
    ),
    error: null,
  };
}