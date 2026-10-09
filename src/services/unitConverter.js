export function normalizeLength(value, unit) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  switch ((unit || "").toLowerCase()) {
    case "mm":
    case "millimeter":
    case "millimeters":
      return number / 1000;

    case "cm":
      return number / 100;

    case "m":
    case "meter":
    case "meters":
      return number;

    case "ft":
    case "foot":
    case "feet":
      return number * 0.3048;

    case "in":
    case "inch":
    case "inches":
      return number * 0.0254;

    default:
      return number;
  }
}

export function normalizeArea(value, unit) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  switch ((unit || "").toLowerCase()) {
    case "mm²":
    case "mm2":
      return number / 1000000;

    case "cm²":
    case "cm2":
      return number / 10000;

    case "m²":
    case "m2":
      return number;

    case "ft²":
    case "ft2":
      return number * 0.092903;

    default:
      return number;
  }
}