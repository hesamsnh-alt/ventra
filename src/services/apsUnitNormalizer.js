function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0;
  }

  if (typeof value === "string") {
    const cleanedValue = value
      .replace(/,/g, "")
      .trim();

    const parsedValue =
      Number.parseFloat(cleanedValue);

    return Number.isFinite(parsedValue)
      ? parsedValue
      : 0;
  }

  return 0;
}

function normalizeUnitText(unit) {
  return String(unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3");
}

function findUnitFromObject(object, type) {
  const possibleUnits =
    type === "length"
      ? [
          object?.lengthUnit,
          object?.unit,
          object?.units,
          object?.measurementUnit,
        ]
      : [
          object?.areaUnit,
          object?.unit,
          object?.units,
          object?.measurementUnit,
        ];

  const directUnit =
    possibleUnits.find(Boolean);

  if (directUnit) {
    return directUnit;
  }

  const rawProperties = Array.isArray(
    object?.rawProperties
  )
    ? object.rawProperties
    : [];

  const keywords =
    type === "length"
      ? ["length", "perimeter", "height"]
      : ["area", "surface"];

  const matchingProperty =
    rawProperties.find((property) => {
      const name = String(
        property?.displayName ??
          property?.attributeName ??
          ""
      ).toLowerCase();

      return keywords.some((keyword) =>
        name.includes(keyword)
      );
    });

  return (
    matchingProperty?.unit ??
    matchingProperty?.displayUnit ??
    matchingProperty?.units ??
    null
  );
}

export function normalizeLengthToMeters(
  value,
  unit,
  options = {}
) {
  const numericValue =
    toFiniteNumber(value);

  if (numericValue === 0) {
    return {
      value: 0,
      unit: "m",
      originalValue: numericValue,
      originalUnit: unit || null,
      source: "missing",
      confidence: 0,
      needsReview: true,
    };
  }

  const normalizedUnit =
    normalizeUnitText(unit);

  const conversions = {
    mm: 0.001,
    millimeter: 0.001,
    millimeters: 0.001,

    cm: 0.01,
    centimeter: 0.01,
    centimeters: 0.01,

    m: 1,
    meter: 1,
    meters: 1,
    metre: 1,
    metres: 1,

    ft: 0.3048,
    foot: 0.3048,
    feet: 0.3048,

    in: 0.0254,
    inch: 0.0254,
    inches: 0.0254,
  };

  if (
    normalizedUnit &&
    conversions[normalizedUnit]
  ) {
    return {
      value:
        numericValue *
        conversions[normalizedUnit],

      unit: "m",
      originalValue: numericValue,
      originalUnit: unit,
      source: "unit_metadata",
      confidence: 100,
      needsReview: false,
    };
  }

  /*
   * Autodesk/DWG frequently returns drawing
   * lengths in millimetres without a useful unit.
   *
   * This is only a fallback heuristic.
   */
  if (
    options.allowHeuristic !== false &&
    Math.abs(numericValue) >= 1000
  ) {
    return {
      value: numericValue / 1000,
      unit: "m",
      originalValue: numericValue,
      originalUnit: null,
      source: "millimeter_heuristic",
      confidence: 70,
      needsReview: true,
    };
  }

  return {
    value: numericValue,
    unit: "m",
    originalValue: numericValue,
    originalUnit: unit || null,
    source: "assumed_meter",
    confidence: 50,
    needsReview: true,
  };
}

export function normalizeAreaToSquareMeters(
  value,
  unit,
  options = {}
) {
  const numericValue =
    toFiniteNumber(value);

  if (numericValue === 0) {
    return {
      value: 0,
      unit: "m²",
      originalValue: numericValue,
      originalUnit: unit || null,
      source: "missing",
      confidence: 0,
      needsReview: true,
    };
  }

  const normalizedUnit =
    normalizeUnitText(unit);

  const conversions = {
    mm2: 0.000001,
    squaremillimeter: 0.000001,
    squaremillimeters: 0.000001,

    cm2: 0.0001,
    squarecentimeter: 0.0001,
    squarecentimeters: 0.0001,

    m2: 1,
    squaremeter: 1,
    squaremeters: 1,
    squaremetre: 1,
    squaremetres: 1,

    ft2: 0.09290304,
    sqft: 0.09290304,
    squarefoot: 0.09290304,
    squarefeet: 0.09290304,

    in2: 0.00064516,
    squareinch: 0.00064516,
    squareinches: 0.00064516,
  };

  if (
    normalizedUnit &&
    conversions[normalizedUnit]
  ) {
    return {
      value:
        numericValue *
        conversions[normalizedUnit],

      unit: "m²",
      originalValue: numericValue,
      originalUnit: unit,
      source: "unit_metadata",
      confidence: 100,
      needsReview: false,
    };
  }

  /*
   * Some DWG/APS pipelines return a value such
   * as 129000 for an expected 129 m².
   *
   * That is not true mm² conversion. It usually
   * means the upstream extractor applied only
   * one millimetre scale factor.
   */
  if (
    options.allowLegacyScaleFallback !==
      false &&
    Math.abs(numericValue) >= 10000
  ) {
    return {
      value: numericValue / 1000,
      unit: "m²",
      originalValue: numericValue,
      originalUnit: null,
      source: "legacy_aps_scale_fallback",
      confidence: 60,
      needsReview: true,
    };
  }

  return {
    value: numericValue,
    unit: "m²",
    originalValue: numericValue,
    originalUnit: unit || null,
    source: "assumed_square_meter",
    confidence: 50,
    needsReview: true,
  };
}

export function normalizeObjectLength(
  object,
  propertyName = "length"
) {
  return normalizeLengthToMeters(
    object?.[propertyName],
    findUnitFromObject(
      object,
      "length"
    )
  );
}

export function normalizeObjectArea(
  object,
  propertyName = "area"
) {
  return normalizeAreaToSquareMeters(
    object?.[propertyName],
    findUnitFromObject(
      object,
      "area"
    )
  );
}

export function roundQuantity(
  value,
  decimals = 2
) {
  const numericValue =
    toFiniteNumber(value);

  const factor =
    10 ** decimals;

  return (
    Math.round(
      (numericValue +
        Number.EPSILON) *
        factor
    ) / factor
  );
}