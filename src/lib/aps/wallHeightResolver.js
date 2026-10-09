function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function findProperty(
  object,
  keywords
) {
  const properties = Array.isArray(
    object?.rawProperties
  )
    ? object.rawProperties
    : [];

  for (const property of properties) {
    const name = normalize(
      property?.displayName
    );

    if (
      keywords.some((keyword) =>
        name.includes(
          normalize(keyword)
        )
      )
    ) {
      const value = toNumber(
        property?.displayValue
      );

      if (value !== null && value > 0) {
        return value;
      }
    }
  }

  return null;
}

function getBoundingBoxHeight(
  object
) {
  const bbox =
    object?.boundingBox;

  if (!bbox) {
    return null;
  }

  if (
    bbox.max &&
    bbox.min
  ) {
    const height =
      Number(bbox.max.z) -
      Number(bbox.min.z);

    if (
      Number.isFinite(height) &&
      height > 0
    ) {
      return height;
    }
  }

  return null;
}

export function resolveWallHeight(
  wall,
  options = {}
) {
  const defaultHeight =
    Number(
      options.defaultHeight ??
        3
    );

  /*
   * 1
   * Height extracted previously
   */

  if (
    toNumber(wall?.height) >
    0
  ) {
    return {
      height: Number(
        wall.height
      ),

      source: "model",

      confidence: 100,
    };
  }

  /*
   * 2
   * Unconnected Height
   */

  const unconnected =
    findProperty(wall, [
      "Unconnected Height",
    ]);

  if (unconnected) {
    return {
      height: unconnected,

      source:
        "unconnected_height",

      confidence: 98,
    };
  }

  /*
   * 3
   * Computed Height
   */

  const computed =
    findProperty(wall, [
      "Computed Height",
      "Height",
    ]);

  if (computed) {
    return {
      height: computed,

      source:
        "computed_height",

      confidence: 95,
    };
  }

  /*
   * 4
   * Bounding Box
   */

  const bboxHeight =
    getBoundingBoxHeight(
      wall
    );

  if (bboxHeight) {
    return {
      height: bboxHeight,

      source:
        "bounding_box",

      confidence: 90,
    };
  }

  /*
   * 5
   * Project Default
   */

  return {
    height: defaultHeight,

    source:
      "project_default",

    confidence: 70,
  };
}

export function calculateWallArea(
  wall,
  options = {}
) {
  const length =
    Number(wall?.length) || 0;

  const resolvedHeight =
    resolveWallHeight(
      wall,
      options
    );

  const area =
    length *
    resolvedHeight.height;

  return {
    area,

    height:
      resolvedHeight.height,

    source:
      resolvedHeight.source,

    confidence:
      resolvedHeight.confidence,
  };
}