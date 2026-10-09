export const BOQ_UNITS = [
  {
    id: "no",
    name: "Number",
    symbol: "No",
    category: "Count",
  },
  {
    id: "item",
    name: "Item",
    symbol: "Item",
    category: "Count",
  },
  {
    id: "set",
    name: "Set",
    symbol: "Set",
    category: "Count",
  },
  {
    id: "lot",
    name: "Lot",
    symbol: "Lot",
    category: "Count",
  },
  {
    id: "m",
    name: "Linear Meter",
    symbol: "m",
    category: "Length",
  },
  {
    id: "lm",
    name: "Linear Meter",
    symbol: "LM",
    category: "Length",
  },
  {
    id: "m2",
    name: "Square Meter",
    symbol: "m²",
    category: "Area",
  },
  {
    id: "m3",
    name: "Cubic Meter",
    symbol: "m³",
    category: "Volume",
  },
  {
    id: "kg",
    name: "Kilogram",
    symbol: "kg",
    category: "Weight",
  },
  {
    id: "ton",
    name: "Ton",
    symbol: "Ton",
    category: "Weight",
  },
  {
    id: "l",
    name: "Litre",
    symbol: "L",
    category: "Volume",
  },
  {
    id: "hr",
    name: "Hour",
    symbol: "Hr",
    category: "Time",
  },
  {
    id: "day",
    name: "Day",
    symbol: "Day",
    category: "Time",
  },
];

export const DEFAULT_UNIT = "item";

export function getUnit(id) {
  return (
    BOQ_UNITS.find((unit) => unit.id === id) ??
    BOQ_UNITS.find((unit) => unit.id === DEFAULT_UNIT)
  );
}

export function isAreaUnit(id) {
  return id === "m2";
}

export function isVolumeUnit(id) {
  return id === "m3";
}

export function isLengthUnit(id) {
  return id === "m" || id === "lm";
}

export function isWeightUnit(id) {
  return id === "kg" || id === "ton";
}