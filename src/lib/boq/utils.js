export function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

export function round(
  value,
  precision = 2
) {
  const safePrecision =
    Number.isInteger(precision)
      ? precision
      : 2;

  const factor =
    10 ** safePrecision;

  return (
    Math.round(
      (
        toNumber(value) +
        Number.EPSILON
      ) * factor
    ) / factor
  );
}

export function normalizeKey(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();
}

function getFirstDefined(
  object,
  keys
) {
  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null
    ) {
      return object[key];
    }
  }

  return undefined;
}

export function normalizeTakeoff(
  rawTakeoff
) {
  const source =
    rawTakeoff &&
    typeof rawTakeoff === "object"
      ? rawTakeoff
      : {};

  /*
   * تمام Propertyهای دریافتی را
   * به snake_case تبدیل می‌کنیم.
   *
   * بنابراین Propertyهای جدید مثل:
   *
   * beamVolume
   * columnVolume
   * footingArea
   *
   * بدون تغییر موتور به:
   *
   * beam_volume
   * column_volume
   * footing_area
   *
   * تبدیل می‌شوند.
   */
  const normalized = {};

  for (
    const [rawKey, rawValue]
    of Object.entries(source)
  ) {
    const key =
      normalizeKey(rawKey);

    if (!key) {
      continue;
    }

    if (
      typeof rawValue === "number"
    ) {
      normalized[key] =
        toNumber(rawValue);

      continue;
    }

    if (
      typeof rawValue === "string"
    ) {
      const trimmed =
        rawValue.trim();

      const numericValue =
        Number(
          trimmed.replace(/,/g, "")
        );

      normalized[key] =
        Number.isFinite(numericValue)
          ? numericValue
          : trimmed;

      continue;
    }

    normalized[key] = rawValue;
  }

  const aliases = {
    rooms: [
      "rooms",
      "room_count",
      "roomcount",
    ],

    doors: [
      "doors",
      "door_count",
      "doorcount",
    ],

    windows: [
      "windows",
      "window_count",
      "windowcount",
    ],

    wall_length: [
      "wall_length",
      "walllength",
    ],

    wall_area: [
      "wall_area",
      "wallarea",
    ],

    floor_area: [
      "floor_area",
      "floorarea",
      "slab_area",
      "slabarea",
    ],

    ceiling_area: [
      "ceiling_area",
      "ceilingarea",
      "floor_area",
      "floorarea",
    ],

    opening_area: [
      "opening_area",
      "openingarea",
    ],

    door_area: [
      "door_area",
      "doorarea",
    ],

    window_area: [
      "window_area",
      "windowarea",
    ],
  beam_length: [
    "beam_length",
    "beamlength",
  ],

  beam_volume: [
    "beam_volume",
    "beamvolume",
  ],

  column_count: [
    "column_count",
    "columncount",
  ],

  column_volume: [
    "column_volume",
    "columnvolume",
  ],

  footing_count: [
    "footing_count",
    "footingcount",
  ],

  footing_volume: [
    "footing_volume",
    "footingvolume",
  ],

  slab_volume: [
    "slab_volume",
    "slabvolume",
  ],

  stair_count: [
    "stair_count",
    "staircount",
  ],

  stair_volume: [
    "stair_volume",
    "stairvolume",
  ],

  reinforcement_weight: [
    "reinforcement_weight",
    "reinforcementweight",
  ],

  formwork_area: [
    "formwork_area",
    "formworkarea",
  ],
    confidence: [
      "confidence",
      "confidence_score",
    ],

    notes: [
      "notes",
    ],
  };

  for (
    const [targetKey, sourceKeys]
    of Object.entries(aliases)
  ) {
    const value =
      getFirstDefined(
        normalized,
        sourceKeys
      );

    if (
      targetKey === "notes"
    ) {
      normalized[targetKey] =
        String(value || "");

      continue;
    }

    normalized[targetKey] =
      toNumber(value);
  }

  return normalized;
}

export function hasOwn(
  object,
  key
) {
  return Object.prototype
    .hasOwnProperty.call(
      object,
      key
    );
}