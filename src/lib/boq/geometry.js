import {
  hasOwn,
  normalizeKey,
  toNumber,
} from "./utils";

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function buildGeometryCandidates(
  rule
) {
  const geometryType =
    normalizeKey(
      rule?.geometry_type
    );

  const geometryProperty =
    normalizeKey(
      rule?.geometry_property
    );

  const candidates = [];

  /*
   * مثال:
   *
   * geometry_type = wall
   * geometry_property = area
   *
   * نتیجه:
   *
   * wall_area
   */
  if (
    geometryType &&
    geometryProperty
  ) {
    candidates.push(
      `${geometryType}_${geometryProperty}`
    );
  }

  /*
   * اگر خود Property کامل باشد:
   *
   * beam_volume
   * footing_area
   * column_count
   */
  if (geometryProperty) {
    candidates.push(
      geometryProperty
    );
  }

  /*
   * اگر فقط Geometry Type کامل باشد:
   *
   * geometry_type = wall_area
   */
  if (geometryType) {
    candidates.push(
      geometryType
    );
  }

  /*
   * سازگاری با ساختار قبلی دیتابیس
   */
  if (
    geometryType === "wall" &&
    geometryProperty === "area"
  ) {
    candidates.push(
      "wall_area"
    );
  }

  if (
    geometryType === "wall" &&
    geometryProperty === "length"
  ) {
    candidates.push(
      "wall_length"
    );
  }

  if (
    geometryType === "door"
  ) {
    candidates.push(
      geometryProperty === "area"
        ? "door_area"
        : "doors",
      "door_count"
    );
  }

  if (
    geometryType === "window"
  ) {
    candidates.push(
      geometryProperty === "area"
        ? "window_area"
        : "windows",
      "window_count"
    );
  }

  if (
    geometryType === "floor"
  ) {
    candidates.push(
      "floor_area"
    );
  }

  if (
    geometryType === "slab"
  ) {
    candidates.push(
      geometryProperty === "volume"
        ? "slab_volume"
        : "slab_area",
      "floor_area"
    );
  }

  if (
    geometryType === "ceiling"
  ) {
    candidates.push(
      "ceiling_area"
    );
  }

  if (
    geometryType === "opening"
  ) {
    candidates.push(
      "opening_area"
    );
  }

  return unique(candidates);
}

export function resolveGeometry(
  rule,
  takeoff
) {
  const candidates =
    buildGeometryCandidates(
      rule
    );

  for (const key of candidates) {
    if (
      hasOwn(takeoff, key)
    ) {
      return {
        found: true,
        key,
        value: toNumber(
          takeoff[key]
        ),
      };
    }
  }

  return {
    found: false,
    key:
      candidates[0] || null,
    value: 0,
  };
}

export function getGeometryValue(
  rule,
  takeoff
) {
  return resolveGeometry(
    rule,
    takeoff
  ).value;
}