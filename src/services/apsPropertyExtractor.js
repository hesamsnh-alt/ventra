const LENGTH_PROPERTY_NAMES = [
  "length",
  "width",
  "height",
  "unconnected height",
  "computed height",
  "base offset",
  "top offset",
  "perimeter",
  "thickness",
  "diameter",
];

const AREA_PROPERTY_NAMES = [
  "area",
  "room area",
  "floor area",
  "wall area",
  "surface area",
  "gross area",
  "net area",
];

const VOLUME_PROPERTY_NAMES = [
  "volume",
  "room volume",
  "material volume",
];

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizePropertyName(value) {
  return normalizeText(value);
}

function parseNumericValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .trim();

  const match = normalized.match(
    /-?\d+(?:\.\d+)?/
  );

  if (!match) {
    return null;
  }

  const number = Number(match[0]);

  return Number.isFinite(number)
    ? number
    : null;
}

function parseFeetAndInches(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  /*
   * Supported examples:
   * 10' 6"
   * 10 ft 6 in
   * 10 feet 6 inches
   */
  const feetMatch = text.match(
    /(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)/
  );

  const inchesMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)/
  );

  if (!feetMatch && !inchesMatch) {
    return null;
  }

  const feet = feetMatch
    ? Number(feetMatch[1])
    : 0;

  const inches = inchesMatch
    ? Number(inchesMatch[1])
    : 0;

  if (
    !Number.isFinite(feet) ||
    !Number.isFinite(inches)
  ) {
    return null;
  }

  return (
    feet * 0.3048 +
    inches * 0.0254
  );
}

function detectUnit({
  units,
  displayValue,
}) {
  const unitText = [
    units,
    displayValue,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3");

  if (
    unitText.includes("square millimeter") ||
    unitText.includes("square millimetre") ||
    unitText.includes("mm2") ||
    unitText.includes("sq mm")
  ) {
    return "square_millimeter";
  }

  if (
    unitText.includes("square centimeter") ||
    unitText.includes("square centimetre") ||
    unitText.includes("cm2") ||
    unitText.includes("sq cm")
  ) {
    return "square_centimeter";
  }

  if (
    unitText.includes("square meter") ||
    unitText.includes("square metre") ||
    unitText.includes("m2") ||
    unitText.includes("sq m")
  ) {
    return "square_meter";
  }

  if (
    unitText.includes("square foot") ||
    unitText.includes("square feet") ||
    unitText.includes("ft2") ||
    unitText.includes("sq ft") ||
    unitText.includes("sf")
  ) {
    return "square_foot";
  }

  if (
    unitText.includes("square inch") ||
    unitText.includes("in2") ||
    unitText.includes("sq in")
  ) {
    return "square_inch";
  }

  if (
    unitText.includes("cubic millimeter") ||
    unitText.includes("cubic millimetre") ||
    unitText.includes("mm3")
  ) {
    return "cubic_millimeter";
  }

  if (
    unitText.includes("cubic centimeter") ||
    unitText.includes("cubic centimetre") ||
    unitText.includes("cm3")
  ) {
    return "cubic_centimeter";
  }

  if (
    unitText.includes("cubic meter") ||
    unitText.includes("cubic metre") ||
    unitText.includes("m3")
  ) {
    return "cubic_meter";
  }

  if (
    unitText.includes("cubic foot") ||
    unitText.includes("cubic feet") ||
    unitText.includes("ft3") ||
    unitText.includes("cu ft")
  ) {
    return "cubic_foot";
  }

  if (
    unitText.includes("millimeter") ||
    unitText.includes("millimetre") ||
    /\bmm\b/.test(unitText)
  ) {
    return "millimeter";
  }

  if (
    unitText.includes("centimeter") ||
    unitText.includes("centimetre") ||
    /\bcm\b/.test(unitText)
  ) {
    return "centimeter";
  }

  if (
    unitText.includes("kilometer") ||
    unitText.includes("kilometre") ||
    /\bkm\b/.test(unitText)
  ) {
    return "kilometer";
  }

  if (
    unitText.includes("meter") ||
    unitText.includes("metre") ||
    /\bm\b/.test(unitText)
  ) {
    return "meter";
  }

  if (
    unitText.includes("feet") ||
    unitText.includes("foot") ||
    /\bft\b/.test(unitText) ||
    unitText.includes("'")
  ) {
    return "foot";
  }

  if (
    unitText.includes("inch") ||
    /\bin\b/.test(unitText) ||
    unitText.includes('"')
  ) {
    return "inch";
  }

  return "unknown";
}

function convertLengthToMeters({
  value,
  units,
  displayValue,
}) {
  const feetAndInches =
    parseFeetAndInches(displayValue);

  if (feetAndInches !== null) {
    return {
      value: feetAndInches,
      unit: "feet_inches",
      converted: true,
    };
  }

  const numericValue =
    parseNumericValue(value);

  if (numericValue === null) {
    return {
      value: null,
      unit: "unknown",
      converted: false,
    };
  }

  const detectedUnit = detectUnit({
    units,
    displayValue,
  });

  const conversionFactors = {
    millimeter: 0.001,
    centimeter: 0.01,
    meter: 1,
    kilometer: 1000,
    inch: 0.0254,
    foot: 0.3048,
  };

  const factor =
    conversionFactors[detectedUnit];

  if (!factor) {
    return {
      value: numericValue,
      unit: "unknown",
      converted: false,
    };
  }

  return {
    value: numericValue * factor,
    unit: detectedUnit,
    converted: true,
  };
}

function convertAreaToSquareMeters({
  value,
  units,
  displayValue,
}) {
  const numericValue =
    parseNumericValue(value);

  if (numericValue === null) {
    return {
      value: null,
      unit: "unknown",
      converted: false,
    };
  }

  const detectedUnit = detectUnit({
    units,
    displayValue,
  });

  const conversionFactors = {
    square_millimeter: 0.000001,
    square_centimeter: 0.0001,
    square_meter: 1,
    square_foot: 0.09290304,
    square_inch: 0.00064516,
  };

  const factor =
    conversionFactors[detectedUnit];

  if (!factor) {
    return {
      value: numericValue,
      unit: "unknown",
      converted: false,
    };
  }

  return {
    value: numericValue * factor,
    unit: detectedUnit,
    converted: true,
  };
}

function convertVolumeToCubicMeters({
  value,
  units,
  displayValue,
}) {
  const numericValue =
    parseNumericValue(value);

  if (numericValue === null) {
    return {
      value: null,
      unit: "unknown",
      converted: false,
    };
  }

  const detectedUnit = detectUnit({
    units,
    displayValue,
  });

  const conversionFactors = {
    cubic_millimeter: 0.000000001,
    cubic_centimeter: 0.000001,
    cubic_meter: 1,
    cubic_foot: 0.028316846592,
  };

  const factor =
    conversionFactors[detectedUnit];

  if (!factor) {
    return {
      value: numericValue,
      unit: "unknown",
      converted: false,
    };
  }

  return {
    value: numericValue * factor,
    unit: detectedUnit,
    converted: true,
  };
}

function isNamedProperty(
  name,
  acceptedNames
) {
  return acceptedNames.some(
    (acceptedName) =>
      name === acceptedName ||
      name.endsWith(
        ` ${acceptedName}`
      ) ||
      name.includes(
        acceptedName
      )
  );
}


function isPropertyDbUnloadError(
  error
) {
  if (
    error?.propDbWasUnloaded ===
    true
  ) {
    return true;
  }

  const value =
    String(
      error?.message ||
        error ||
        ""
    ).toLowerCase();

  return (
    value.includes(
      "propdbwasunloaded"
    ) ||
    value.includes(
      "property database was unloaded"
    ) ||
    value.includes(
      "prop db was unloaded"
    )
  );
}

function getObjectTree(viewer) {
  return new Promise(
    (resolve, reject) => {
      const model = viewer?.model;

      if (!model) {
        reject(
          new Error(
            "Autodesk model is missing."
          )
        );
        return;
      }

      model.getObjectTree(
        resolve,
        (error) => {
          if (
            isPropertyDbUnloadError(
              error
            )
          ) {
            console.debug(
              "[VENTRA PROPERTY] object tree request cancelled because model was unloaded"
            );
            resolve(null);
            return;
          }

          reject(
            new Error(
              `Could not load Autodesk object tree: ${
                error?.message ||
                error ||
                "Unknown error"
              }`
            )
          );
        }
      );
    }
  );
}

function getProperties(
  viewer,
  dbId
) {
  return new Promise((resolve) => {
    viewer.getProperties(
      dbId,
      (result) => {
        resolve(result);
      },
      (error) => {
        console.warn(
          `[VENTRA PROPERTY EXTRACTION] Could not read dbId ${dbId}`,
          error
        );

        resolve(null);
      }
    );
  });
}

function getViewerThree(viewer) {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    window.THREE ||
    globalThis.THREE ||
    window.Autodesk?.Viewing?.Private?.THREE ||
    viewer?.impl?.THREE ||
    viewer?.impl?.api?.THREE ||
    null
  );
}

function getObjectSpatialBounds(viewer, tree, dbId) {
  const fragmentList =
    viewer?.model?.getFragmentList?.();

  const Three =
    getViewerThree(viewer);

  if (
    !fragmentList ||
    !tree ||
    !Three?.Box3 ||
    !Three?.Vector3
  ) {
    return null;
  }

  const combined = new Three.Box3();
  let hasBounds = false;

  tree.enumNodeFragments(
    dbId,
    (fragId) => {
      const fragmentBox = new Three.Box3();
      fragmentList.getWorldBounds(fragId, fragmentBox);

      if (
        Number.isFinite(fragmentBox.min?.x) &&
        Number.isFinite(fragmentBox.min?.y) &&
        Number.isFinite(fragmentBox.max?.x) &&
        Number.isFinite(fragmentBox.max?.y)
      ) {
        combined.union(fragmentBox);
        hasBounds = true;
      }
    },
    true
  );

  if (!hasBounds) {
    return null;
  }

  const center = combined.getCenter(new Three.Vector3());

  return {
    min: { x: combined.min.x, y: combined.min.y, z: combined.min.z },
    max: { x: combined.max.x, y: combined.max.y, z: combined.max.z },
    centroid: { x: center.x, y: center.y, z: center.z },
  };
}

function collectDbIds(tree) {
  const dbIds = [];

  tree.enumNodeChildren(
    tree.getRootId(),
    function walk(dbId) {
      dbIds.push(dbId);

      tree.enumNodeChildren(
        dbId,
        walk,
        false
      );
    },
    true
  );

  return [...new Set(dbIds)];
}

function assignMeasurement({
  object,
  field,
  result,
  property,
}) {
  if (
    result.value === null ||
    result.value === undefined
  ) {
    return;
  }

  object[field] = result.value;

  object.measurementSources[field] = {
    propertyName:
      property?.displayName || "",

    displayValue:
      property?.displayValue ?? null,

    sourceUnits:
      property?.units || null,

    detectedUnit:
      result.unit,

    normalizedUnit:
      field === "area"
        ? "m2"
        : field === "volume"
          ? "m3"
          : "m",

    converted:
      result.converted,

    confidence:
      result.converted
        ? "high"
        : "medium",
  };
}

function createNormalizedObject(
  dbId,
  props
) {
  const object = {
    dbId,

    name:
      props?.name || "",

    category: "",
    family: "",
    type: "",
    level: "",
    layer: "",

    length: null,
    width: null,
    height: null,
    area: null,
    volume: null,

    material: "",

    properties: {},
    rawProperties: [],

    measurementSources: {},
  };

  const properties =
    Array.isArray(
      props?.properties
    )
      ? props.properties
      : [];

  properties.forEach(
    (property) => {
      const displayName =
        property?.displayName || "";

      const displayValue =
        property?.displayValue ??
        null;

      const name =
        normalizePropertyName(
          displayName
        );

      const units =
        property?.units || null;

      object.properties[
        displayName
      ] = displayValue;

      object.rawProperties.push({
        displayName,
        displayValue,

        displayCategory:
          property?.displayCategory ||
          "",

        attributeName:
          property?.attributeName ||
          "",

        units,

        type:
          property?.type ?? null,
      });

      if (
        name === "category" ||
        name.includes("category")
      ) {
        object.category =
          String(
            displayValue || ""
          );
      }

      if (
        name === "family" ||
        name.includes("family name")
      ) {
        object.family =
          String(
            displayValue || ""
          );
      }

      if (
        name === "layer" ||
        name === "layer name"
      ) {
        object.layer =
          String(
            displayValue || ""
          );
      }

      if (
        name === "type" ||
        name === "type name" ||
        name.includes(
          "family and type"
        )
      ) {
        object.type =
          String(
            displayValue || ""
          );
      }

      if (
        name === "level" ||
        name.includes(
          "base level"
        ) ||
        name.includes(
          "reference level"
        ) ||
        name.includes(
          "schedule level"
        )
      ) {
        object.level =
          String(
            displayValue || ""
          );
      }

      if (
        isNamedProperty(
          name,
          LENGTH_PROPERTY_NAMES
        )
      ) {
        const result =
          convertLengthToMeters({
            value: displayValue,
            units,
            displayValue,
          });

        if (
          name === "length" ||
          name.endsWith(" length")
        ) {
          assignMeasurement({
            object,
            field: "length",
            result,
            property,
          });
        }

        if (
          name === "width" ||
          name.endsWith(" width")
        ) {
          assignMeasurement({
            object,
            field: "width",
            result,
            property,
          });
        }

        if (
          name === "height" ||
          name.endsWith(" height") ||
          name.includes(
            "unconnected height"
          ) ||
          name.includes(
            "computed height"
          )
        ) {
          assignMeasurement({
            object,
            field: "height",
            result,
            property,
          });
        }
      }

      if (
        isNamedProperty(
          name,
          AREA_PROPERTY_NAMES
        )
      ) {
        const result =
          convertAreaToSquareMeters({
            value: displayValue,
            units,
            displayValue,
          });

        assignMeasurement({
          object,
          field: "area",
          result,
          property,
        });
      }

      if (
        isNamedProperty(
          name,
          VOLUME_PROPERTY_NAMES
        )
      ) {
        const result =
          convertVolumeToCubicMeters({
            value: displayValue,
            units,
            displayValue,
          });

        assignMeasurement({
          object,
          field: "volume",
          result,
          property,
        });
      }

      if (
        name.includes("material")
      ) {
        object.material =
          String(
            displayValue || ""
          );
      }
    }
  );

  return object;
}

async function mapWithConcurrency({
  items,
  concurrency,
  mapper,
}) {
  const results =
    new Array(items.length);

  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;

      results[index] =
        await mapper(
          items[index],
          index
        );
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        concurrency,
        items.length
      ),
    },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

export async function extractModelProperties(
  viewer
) {
  if (!viewer) {
    throw new Error(
      "Autodesk Viewer instance is missing."
    );
  }

  const tree =
    await getObjectTree(viewer);

  if (!tree) {
    return [];
  }

  const dbIds =
    collectDbIds(tree);

  console.log(
    "[VENTRA PROPERTY EXTRACTION DBIDS]",
    dbIds.length
  );

  if (dbIds.length === 0) {
    return [];
  }

  /*
   * درخواست هم‌زمان هزاران Property می‌تواند
   * Viewer را کند یا حتی مرورگر را قفل کند.
   */
  const propertyResults =
    await mapWithConcurrency({
      items: dbIds,
      concurrency: 20,

      mapper: async (dbId) => {
        const props =
          await getProperties(
            viewer,
            dbId
          );

        if (!props) {
          return null;
        }

        const object = createNormalizedObject(
          dbId,
          props
        );

        const spatialBounds = getObjectSpatialBounds(
          viewer,
          tree,
          dbId
        );

        if (spatialBounds) {
          object.boundingBox = {
            min: spatialBounds.min,
            max: spatialBounds.max,
          };
          object.centroid = spatialBounds.centroid;
        }

        return object;
      },
    });

  const results =
    propertyResults.filter(Boolean);

  const measurementStatistics =
    results.reduce(
      (statistics, object) => {
        if (object.length !== null) {
          statistics.lengths += 1;
        }

        if (object.area !== null) {
          statistics.areas += 1;
        }

        if (object.height !== null) {
          statistics.heights += 1;
        }

        if (object.volume !== null) {
          statistics.volumes += 1;
        }

        const sources =
          Object.values(
            object.measurementSources
          );

        sources.forEach((source) => {
          if (source.converted) {
            statistics.converted += 1;
          } else {
            statistics.unconfirmedUnits += 1;
          }
        });

        return statistics;
      },
      {
        lengths: 0,
        areas: 0,
        heights: 0,
        volumes: 0,
        converted: 0,
        unconfirmedUnits: 0,
      }
    );

  console.log(
    "[VENTRA PROPERTY EXTRACTION COMPLETE]",
    {
      requested: dbIds.length,

      extracted:
        results.length,

      failed:
        dbIds.length -
        results.length,

      measurements:
        measurementStatistics,

      spatialBounds: {
        objectsWithCentroid:
          results.filter(
            (object) =>
              Number.isFinite(
                Number(
                  object?.centroid?.x
                )
              ) &&
              Number.isFinite(
                Number(
                  object?.centroid?.y
                )
              )
          ).length,
        objectsWithBoundingBox:
          results.filter(
            (object) =>
              Boolean(
                object?.boundingBox
              )
          ).length,
        threeAvailable:
          Boolean(
            getViewerThree(viewer)
              ?.Box3
          ),
      },
    }
  );

  return results;
}