function normalizeText(value) {

  return String(value ?? "")
    .trim()
    .toLowerCase();
}
import {
  calculateWallArea,
} from "@/lib/aps/wallHeightResolver";

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function roundNumber(value, decimals = 2) {
  const number = toNumber(value);
  const factor = 10 ** decimals;

  return Math.round(number * factor) / factor;
}

function includesKeyword(value, keywords) {
  const text = normalizeText(value);

  return keywords.some((keyword) =>
    text.includes(normalizeText(keyword))
  );
}

function getSearchableText(object) {
  const rawProperties = Array.isArray(
    object?.rawProperties
  )
    ? object.rawProperties
    : [];

  const propertyValues =
    object?.properties &&
    !Array.isArray(object.properties)
      ? Object.entries(object.properties)
          .flat()
          .join(" ")
      : "";

  const rawPropertyText = rawProperties
    .map((property) =>
      [
        property?.displayName,
        property?.displayValue,
        property?.displayCategory,
        property?.attributeName,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");

  return [
    object?.name,
    object?.category,
    object?.family,
    object?.type,
    object?.level,
    object?.layer,
    object?.material,
    propertyValues,
    rawPropertyText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifyRoomType(object) {
  const text = getSearchableText(object);

  const roomTypes = [
    {
      type: "bedroom",
      keywords: [
        "bedroom",
        "master bedroom",
        "bed room",
      ],
    },
    {
      type: "living_room",
      keywords: [
        "living room",
        "family room",
        "majlis",
        "lounge",
      ],
    },
    {
      type: "kitchen",
      keywords: [
        "kitchen",
        "pantry",
      ],
    },
    {
      type: "bathroom",
      keywords: [
        "bathroom",
        "toilet",
        "washroom",
        "wc",
      ],
    },
    {
      type: "office",
      keywords: [
        "office",
        "workspace",
        "work room",
      ],
    },
    {
      type: "corridor",
      keywords: [
        "corridor",
        "hallway",
        "passage",
      ],
    },
    {
      type: "storage",
      keywords: [
        "storage",
        "store room",
        "store",
      ],
    },
    {
      type: "parking",
      keywords: [
        "parking",
        "garage",
        "car park",
      ],
    },
    {
      type: "balcony",
      keywords: [
        "balcony",
        "terrace",
      ],
    },
  ];

  const match = roomTypes.find(({ keywords }) =>
    includesKeyword(text, keywords)
  );

  return match?.type || "unclassified";
}

function classifyWallType(object) {
  const text = getSearchableText(object);

  if (
    includesKeyword(text, [
      "curtain wall",
      "glazed wall",
      "glass wall",
    ])
  ) {
    return "curtain_wall";
  }

  if (
    includesKeyword(text, [
      "gypsum",
      "drywall",
      "partition",
    ])
  ) {
    return "gypsum_partition";
  }

  if (
    includesKeyword(text, [
      "concrete",
      "rc wall",
      "reinforced concrete",
    ])
  ) {
    return "concrete_wall";
  }

  if (
    includesKeyword(text, [
      "block",
      "masonry",
      "cmu",
      "brick",
    ])
  ) {
    return "block_wall";
  }

  return "unclassified";
}

function classifyElectricalSubtype(object) {
  // v26: classify from the strongest CAD evidence first. Broad property
  // blobs can contain words such as "switch" even for a receptacle block,
  // which previously turned every Power-layer receptacle into a switch.
  const directText =
    [
      object?.name,
      object?.displayName,
      object?.objectName,
      object?.blockName,
      object?.family,
      object?.familyName,
      object?.layer,
      object?.layerName,
      object?.category,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[_/\\|:;,-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const directHas =
    (patterns) =>
      patterns.some(
        (pattern) =>
          pattern.test(directText)
      );

  if (
    directHas([
      /\bdistribution\s*board\b/i,
      /\bpanel\s*board\b/i,
      /\bpanelboard\b/i,
      /\bconsumer\s*unit\b/i,
      /\bmdb\b/i,
      /\bsmdb\b/i,
      /\bdb\s*\d*\b/i,
    ])
  ) {
    return "distribution_board";
  }

  if (
    directHas([
      /\breceptacle\b/i,
      /\bsocket\b/i,
      /\bpower\s*outlet\b/i,
      /\belectrical\s*outlet\b/i,
      /\bpower\s*point\b/i,
      /\bplug\s*point\b/i,
      /\bgpo\b/i,
      /\bsso\b/i,
      /\btso\b/i,
      /\b13\s*a\b/i,
      /\b15\s*a\b/i,
      /\b16\s*a\b/i,
      /\b20\s*a\b/i,
      /\b32\s*a\b/i,
    ])
  ) {
    return "socket";
  }

  if (
    directHas([
      /\blight\s*switch\b/i,
      /\blighting\s*switch\b/i,
      /\bwall\s*switch\b/i,
      /\bswitch\s*point\b/i,
      /\bdimmer\b/i,
      /\bpush\s*button\b/i,
      /\b1\s*gang\b/i,
      /\b2\s*gang\b/i,
      /\b3\s*gang\b/i,
      /\b4\s*gang\b/i,
    ])
  ) {
    return "switch";
  }

  if (
    directHas([
      /\blighting\s*fixture\b/i,
      /\blight\s*fixture\b/i,
      /\bluminaire\b/i,
      /\bdown\s*light\b/i,
      /\bdownlight\b/i,
      /\bspot\s*light\b/i,
      /\bceiling\s*light\b/i,
      /\bpendant\b/i,
      /\bchandelier\b/i,
      /\bsconce\b/i,
      /\blamp\b/i,
    ])
  ) {
    return "lighting";
  }

  const text =
    getSearchableText(object)
      .toLowerCase()
      .replace(
        /[_/\\|:;,-]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const compact =
    text.replace(
      /[^a-z0-9]+/g,
      ""
    );

  const has =
    (patterns) =>
      patterns.some(
        (pattern) =>
          pattern.test(text) ||
          pattern.test(compact)
      );

  // Distribution boards / panels first because "switchboard" also contains
  // the word switch.
  if (
    has([
      /\bdistribution\s*board\b/i,
      /\bdistribution\s*panel\b/i,
      /\bpanel\s*board\b/i,
      /\bpanelboard\b/i,
      /\belectrical\s*panel\b/i,
      /\bload\s*cent(er|re)\b/i,
      /\bconsumer\s*unit\b/i,
      /\bswitch\s*board\b/i,
      /\bmdb\b/i,
      /\bsmdb\b/i,
      /\bdb\s*\d*\b/i,
      /\bdbpanel\b/i,
      /\bdboard\b/i,
      /^db\d*$/i,
    ])
  ) {
    return "distribution_board";
  }

  // Socket / receptacle / power outlets. Common CAD blocks and layers often
  // contain only rating or GPO/SSO/TSO abbreviations.
  if (
    has([
      /\bsocket\b/i,
      /\breceptacle\b/i,
      /\bpower\s*outlet\b/i,
      /\belectrical\s*outlet\b/i,
      /\bwall\s*outlet\b/i,
      /\bplug\s*point\b/i,
      /\bpower\s*point\b/i,
      /\boutlet\b/i,
      /\bgpo\b/i,
      /\bsso\b/i,
      /\btso\b/i,
      /\b13\s*a\b/i,
      /\b15\s*a\b/i,
      /\b16\s*a\b/i,
      /\b20\s*a\b/i,
      /\b32\s*a\b/i,
      /\be\s*power\b/i,
      /\be\s*powr\b/i,
      /\bpower\s*socket\b/i,
      /\bpowerpoint\b/i,
    ])
  ) {
    return "socket";
  }

  // Switches before generic lighting.
  if (
    has([
      /\blight\s*switch\b/i,
      /\blighting\s*switch\b/i,
      /\bwall\s*switch\b/i,
      /\bswitch\s*point\b/i,
      /\bdimmer\b/i,
      /\bpush\s*button\b/i,
      /\b1\s*gang\b/i,
      /\b2\s*gang\b/i,
      /\b3\s*gang\b/i,
      /\b4\s*gang\b/i,
      /\b1g\s*sw\b/i,
      /\b2g\s*sw\b/i,
      /\b3g\s*sw\b/i,
      /\be\s*switch\b/i,
      /\be\s*swch\b/i,
      /\bswitch\b/i,
      /\bswch\b/i,
    ])
  ) {
    return "switch";
  }

  // Lighting fixtures / points and common CAD abbreviations.
  if (
    has([
      /\blighting\s*fixture\b/i,
      /\blight\s*fixture\b/i,
      /\bluminaire\b/i,
      /\bdown\s*light\b/i,
      /\bdownlight\b/i,
      /\bspot\s*light\b/i,
      /\bspotlight\b/i,
      /\bceiling\s*light\b/i,
      /\bwall\s*light\b/i,
      /\bpendant\b/i,
      /\bchandelier\b/i,
      /\bsconce\b/i,
      /\blight\s*fitting\b/i,
      /\blighting\s*point\b/i,
      /\blight\s*point\b/i,
      /\blamp\b/i,
      /\bltg\b/i,
      /\blgt\b/i,
      /\blite\b/i,
      /\be\s*lite\b/i,
      /\be\s*light\b/i,
      /\bfixture\b/i,
    ])
  ) {
    return "lighting";
  }

  return "other";
}

function classifyObject(object) {
  const text = getSearchableText(object);

  return {
    isWall: includesKeyword(text, [
      "wall",
      "walls",
      "curtain wall",
      "partition",
      "masonry",
    ]),

    isDoor: includesKeyword(text, [
      "door",
      "doors",
      "gate",
      "shutter",
    ]),

    isWindow: includesKeyword(text, [
      "window",
      "windows",
      "glazing",
      "skylight",
    ]),

    isRoom: includesKeyword(text, [
      "room",
      "rooms",
      "space",
      "spaces",
      "area boundary",
    ]),

    isFloor: includesKeyword(text, [
      "floor",
      "floors",
      "floor finish",
    ]),

    isSlab: includesKeyword(text, [
      "slab",
      "slabs",
      "structural floor",
    ]),

    isCeiling: includesKeyword(text, [
      "ceiling",
      "ceilings",
      "false ceiling",
    ]),

    isColumn: includesKeyword(text, [
      "column",
      "columns",
      "pillar",
    ]),

    isBeam: includesKeyword(text, [
      "beam",
      "beams",
      "girder",
    ]),

    isFoundation: includesKeyword(text, [
      "foundation",
      "footing",
      "pile cap",
      "raft",
      "pile",
    ]),

    isStair: includesKeyword(text, [
      "stair",
      "stairs",
      "staircase",
      "step",
      "tread",
      "riser",
    ]),

    isRamp: includesKeyword(text, [
      "ramp",
      "vehicle ramp",
      "access ramp",
    ]),

    isRoof: includesKeyword(text, [
      "roof",
      "roofing",
      "canopy",
    ]),

    isPipe: includesKeyword(text, [
      "pipe",
      "piping",
      "plumbing",
      "duct pipe",
    ]),

    isDuct: includesKeyword(text, [
      "duct",
      "ductwork",
      "air duct",
      "hvac",
    ]),

    isElectrical: includesKeyword(text, [
      "electrical",
      "cable tray",
      "conduit",
      "lighting fixture",
      "receptacle",
      "socket",
      "power outlet",
      "power point",
      "switch",
      "distribution board",
    ]),
  };
}

function sumNumericProperty(
  objects,
  propertyName
) {
  return objects.reduce(
    (total, object) =>
      total +
      toNumber(object?.[propertyName]),
    0
  );
}

function calculateRectangularColumnFormworkArea(object) {
  const width = toNumber(object?.width);
  const depth = toNumber(object?.length);
  const height = toNumber(object?.height);

  if (width <= 0 || depth <= 0 || height <= 0) {
    return 0;
  }

  return 2 * (width + depth) * height;
}

function calculateRectangularBeamFormworkArea(object) {
  const span = toNumber(object?.length);
  const width = toNumber(object?.width);
  const depth = toNumber(object?.height);

  if (span <= 0 || width <= 0 || depth <= 0) {
    return 0;
  }

  // Beam formwork: soffit + two sides. Top face is excluded.
  return span * (width + 2 * depth);
}

function calculateFoundationFormworkArea(object) {
  const width = toNumber(object?.width);
  const length = toNumber(object?.length);
  const height = toNumber(object?.height);

  if (width <= 0 || length <= 0 || height <= 0) {
    return 0;
  }

  // Foundation formwork: vertical faces only.
  return 2 * (width + length) * height;
}

function sumDerivedArea(objects, calculator) {
  return objects.reduce(
    (total, object) => total + Math.max(0, toNumber(calculator(object))),
    0
  );
}

function measureCompleteDerivedArea(
  objects,
  calculator
) {
  const safeObjects =
    Array.isArray(objects)
      ? objects
      : [];

  const values =
    safeObjects.map(
      (object) =>
        Math.max(
          0,
          toNumber(
            calculator(object)
          )
        )
    );

  const measuredCount =
    values.filter(
      (value) =>
        value > 0
    ).length;

  const totalCount =
    safeObjects.length;

  return {
    area:
      totalCount > 0 &&
      measuredCount === totalCount
        ? values.reduce(
            (sum, value) =>
              sum + value,
            0
          )
        : 0,
    measuredCount,
    totalCount,
    complete:
      totalCount > 0 &&
      measuredCount === totalCount,
  };
}



function normalizePropertyKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-:/\\]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseMeasurementValue(value, kind) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value > 0 ? value : 0;
  }

  const text =
    String(value)
      .trim()
      .toLowerCase()
      .replace(/,/g, "");

  const match =
    text.match(
      /-?\d+(?:\.\d+)?/
    );

  if (!match) {
    return 0;
  }

  let number =
    Number(match[0]);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return 0;
  }

  if (kind === "length") {
    if (/\bmm\b/.test(text)) {
      number /= 1000;
    } else if (/\bcm\b/.test(text)) {
      number /= 100;
    } else if (/\bft\b|feet|foot/.test(text)) {
      number *= 0.3048;
    } else if (/\bin\b|inch/.test(text)) {
      number *= 0.0254;
    }
  }

  if (kind === "area") {
    if (/mm2|mm²/.test(text)) {
      number /= 1_000_000;
    } else if (/cm2|cm²/.test(text)) {
      number /= 10_000;
    } else if (/ft2|ft²|sq\s*ft/.test(text)) {
      number *= 0.092903;
    }
  }

  if (kind === "volume") {
    if (/mm3|mm³/.test(text)) {
      number /= 1_000_000_000;
    } else if (/cm3|cm³/.test(text)) {
      number /= 1_000_000;
    } else if (/ft3|ft³|cu\s*ft/.test(text)) {
      number *= 0.0283168;
    }
  }

  return number;
}

function findRawMeasurement(
  object,
  aliases,
  kind
) {
  const normalizedAliases =
    aliases.map(
      normalizePropertyKey
    );

  const entries = [];

  if (
    object?.properties &&
    !Array.isArray(
      object.properties
    )
  ) {
    for (
      const [
        key,
        value,
      ] of Object.entries(
        object.properties
      )
    ) {
      entries.push({
        key,
        value,
      });
    }
  }

  if (
    Array.isArray(
      object?.rawProperties
    )
  ) {
    for (
      const property of
      object.rawProperties
    ) {
      entries.push({
        key:
          property
            ?.displayName ||
          property
            ?.attributeName ||
          "",
        value:
          property
            ?.displayValue,
      });
    }
  }

  for (
    const entry of entries
  ) {
    const key =
      normalizePropertyKey(
        entry.key
      );

    if (
      normalizedAliases.some(
        (alias) =>
          key === alias ||
          key.endsWith(
            ` ${alias}`
          )
      )
    ) {
      const value =
        parseMeasurementValue(
          entry.value,
          kind
        );

      if (value > 0) {
        return value;
      }
    }
  }

  return 0;
}

function hydrateStructuralMeasurements(
  object,
  classification
) {
  if (
    !object ||
    typeof object !==
      "object"
  ) {
    return object;
  }

  const isStructural =
    Boolean(
      classification
        ?.isColumn ||
      classification
        ?.isBeam ||
      classification
        ?.isFoundation ||
      classification
        ?.isSlab
    );

  if (!isStructural) {
    return object;
  }

  const bbox =
    object?.boundingBox ||
    null;

  const bboxWidth =
    Math.abs(
      Number(
        bbox?.max?.x
      ) -
      Number(
        bbox?.min?.x
      )
    );

  const bboxDepth =
    Math.abs(
      Number(
        bbox?.max?.y
      ) -
      Number(
        bbox?.min?.y
      )
    );

  const width =
    Number(
      object?.width
    ) > 0
      ? Number(
          object.width
        )
      : findRawMeasurement(
          object,
          [
            "width",
            "b",
            "section width",
            "column width",
            "beam width",
            "footing width",
          ],
          "length"
        ) ||
        (
          Number.isFinite(
            bboxWidth
          ) &&
          bboxWidth > 0
            ? bboxWidth
            : 0
        );

  const length =
    Number(
      object?.length
    ) > 0
      ? Number(
          object.length
        )
      : findRawMeasurement(
          object,
          [
            "length",
            "depth",
            "d",
            "section depth",
            "column depth",
            "beam depth",
            "footing length",
          ],
          "length"
        ) ||
        (
          Number.isFinite(
            bboxDepth
          ) &&
          bboxDepth > 0
            ? bboxDepth
            : 0
        );

  const height =
    Number(
      object?.height
    ) > 0
      ? Number(
          object.height
        )
      : findRawMeasurement(
          object,
          [
            "height",
            "h",
            "overall height",
            "unconnected height",
            "column height",
            "beam height",
            "thickness",
          ],
          "length"
        );

  const explicitVolume =
    Number(
      object?.volume
    ) > 0
      ? Number(
          object.volume
        )
      : findRawMeasurement(
          object,
          [
            "volume",
            "net volume",
            "gross volume",
          ],
          "volume"
        );

  const derivedVolume =
    explicitVolume > 0
      ? explicitVolume
      : width > 0 &&
          length > 0 &&
          height > 0
        ? width *
          length *
          height
        : 0;

  return {
    ...object,
    width:
      width ||
      object?.width ||
      0,
    length:
      length ||
      object?.length ||
      0,
    height:
      height ||
      object?.height ||
      0,
    volume:
      derivedVolume ||
      object?.volume ||
      0,
    structuralMeasurementSource: {
      width:
        Number(
          object?.width
        ) > 0
          ? "aps_property"
          : width > 0
            ? "aps_raw_property_or_2d_bounds"
            : "unavailable",
      length:
        Number(
          object?.length
        ) > 0
          ? "aps_property"
          : length > 0
            ? "aps_raw_property_or_2d_bounds"
            : "unavailable",
      height:
        Number(
          object?.height
        ) > 0
          ? "aps_property"
          : height > 0
            ? "aps_raw_property"
            : "unavailable",
      volume:
        explicitVolume > 0
          ? "aps_property"
          : derivedVolume > 0
            ? "derived_from_complete_dimensions"
            : "unavailable",
    },
  };
}

function normalizeMeasurementsForModelUnit(object, meterFactor) {
  if (!object || typeof object !== "object") {
    return object;
  }

  const factor = Number(meterFactor);

  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
    return object;
  }

  const measurementSources =
    object.measurementSources && typeof object.measurementSources === "object"
      ? object.measurementSources
      : {};

  const next = { ...object };

  const apply = (field, power) => {
    const source = measurementSources[field];
    const value = Number(object[field]);

    if (
      Number.isFinite(value) &&
      value > 0 &&
      source &&
      source.converted === false
    ) {
      next[field] = value * factor ** power;
      next.measurementSources = {
        ...measurementSources,
        [field]: {
          ...source,
          normalizedUnit:
            power === 1 ? "m" : power === 2 ? "m2" : "m3",
          converted: true,
          conversionSource: "aps_model_unit",
          modelMeterFactor: factor,
          confidence: "high",
        },
      };
    }
  };

  apply("length", 1);
  apply("width", 1);
  apply("height", 1);
  apply("area", 2);
  apply("volume", 3);

  return next;
}

function filterByClassification(
  classified,
  classificationName
) {
  return classified
    .filter(
      ({ classification }) =>
        classification[
          classificationName
        ]
    )
    .map(({ object }) => object);
}

function countByValue(
  objects,
  valueResolver
) {
  return objects.reduce(
    (result, object) => {
      const value =
        valueResolver(object) ||
        "Unclassified";

      result[value] =
        (result[value] || 0) + 1;

      return result;
    },
    {}
  );
}

function sumByValue(
  objects,
  valueResolver,
  propertyName
) {
  return objects.reduce(
    (result, object) => {
      const value =
        valueResolver(object) ||
        "Unclassified";

      result[value] =
        roundNumber(
          toNumber(result[value]) +
            toNumber(
              object?.[propertyName]
            )
        );

      return result;
    },
    {}
  );
}


function validFiniteValue(
  value
) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(
      Number(value)
    )
  );
}

function resolveObjectCentroid(
  object
) {
  const cx =
    object?.centroid?.x;
  const cy =
    object?.centroid?.y;
  const cz =
    object?.centroid?.z;

  if (
    validFiniteValue(cx) &&
    validFiniteValue(cy)
  ) {
    return {
      x: Number(cx),
      y: Number(cy),
      z:
        validFiniteValue(cz)
          ? Number(cz)
          : null,
      coordinateSystem:
        "aps_model_world",
      source:
        "aps_object_centroid",
    };
  }

  const box =
    object?.boundingBox ||
    object?.bbox ||
    null;

  if (!box) {
    return null;
  }

  // Common Autodesk/Forge shape:
  // { min:{x,y,z}, max:{x,y,z} }
  const minX =
    box?.min?.x;
  const minY =
    box?.min?.y;
  const minZ =
    box?.min?.z;
  const maxX =
    box?.max?.x;
  const maxY =
    box?.max?.y;
  const maxZ =
    box?.max?.z;

  if (
    validFiniteValue(minX) &&
    validFiniteValue(minY) &&
    validFiniteValue(maxX) &&
    validFiniteValue(maxY)
  ) {
    return {
      x:
        (
          Number(minX) +
          Number(maxX)
        ) / 2,
      y:
        (
          Number(minY) +
          Number(maxY)
        ) / 2,
      z:
        validFiniteValue(minZ) &&
        validFiniteValue(maxZ)
          ? (
              Number(minZ) +
              Number(maxZ)
            ) / 2
          : null,
      coordinateSystem:
        "aps_model_world",
      source:
        "aps_bounding_box_center",
    };
  }

  // Flat shape:
  // { minX,minY,minZ,maxX,maxY,maxZ }
  if (
    validFiniteValue(
      box?.minX
    ) &&
    validFiniteValue(
      box?.minY
    ) &&
    validFiniteValue(
      box?.maxX
    ) &&
    validFiniteValue(
      box?.maxY
    )
  ) {
    return {
      x:
        (
          Number(box.minX) +
          Number(box.maxX)
        ) / 2,
      y:
        (
          Number(box.minY) +
          Number(box.maxY)
        ) / 2,
      z:
        validFiniteValue(
          box?.minZ
        ) &&
        validFiniteValue(
          box?.maxZ
        )
          ? (
              Number(box.minZ) +
              Number(box.maxZ)
            ) / 2
          : null,
      coordinateSystem:
        "aps_model_world",
      source:
        "aps_bounding_box_center",
    };
  }

  // Origin + dimensions shape:
  // { x,y,z,width,height,depth }
  if (
    validFiniteValue(
      box?.x
    ) &&
    validFiniteValue(
      box?.y
    ) &&
    validFiniteValue(
      box?.width
    ) &&
    validFiniteValue(
      box?.height
    )
  ) {
    return {
      x:
        Number(box.x) +
        Number(box.width) /
          2,
      y:
        Number(box.y) +
        Number(box.height) /
          2,
      z:
        validFiniteValue(
          box?.z
        ) &&
        validFiniteValue(
          box?.depth
        )
          ? Number(box.z) +
            Number(box.depth) /
              2
          : null,
      coordinateSystem:
        "aps_model_world",
      source:
        "aps_bounding_box_center",
    };
  }

  return null;
}

function createObjectSummary(
  objects,
  type
) {
  return objects.map((object) => ({
    dbId: object?.dbId ?? null,
    name: object?.name || null,
    category:
      object?.category || null,
    family: object?.family || null,
    type: object?.type || null,
    level: object?.level || null,
    material:
      object?.material || null,
    layer:
      object?.layer ||
      object?.layerName ||
      null,
    detectedType: type,
    electricalSubtype:
      type === "electrical"
        ? classifyElectricalSubtype(
            object
          )
        : null,
    length: roundNumber(
      object?.length
    ),
    width: roundNumber(
      object?.width
    ),
    height: roundNumber(
      object?.height
    ),
    area: roundNumber(
      object?.area
    ),
    volume: roundNumber(
      object?.volume
    ),
    centroid:
      resolveObjectCentroid(
        object
      ),
    boundingBox:
      object?.boundingBox ||
      null,
  }));
}

function resolveOpeningObjectArea(object) {
  const explicitArea =
    toNumber(object?.area);

  if (explicitArea > 0) {
    return explicitArea;
  }

  const width =
    toNumber(object?.width);

  const height =
    toNumber(object?.height);

  if (
    width > 0 &&
    height > 0
  ) {
    return width * height;
  }

  return 0;
}

function calculateCompleteMeasuredOpeningArea(
  objects,
  authoritativeCount
) {
  const expectedCount =
    Math.max(
      0,
      toNumber(authoritativeCount)
    );

  if (
    expectedCount <= 0 ||
    !Array.isArray(objects) ||
    objects.length !== expectedCount
  ) {
    return {
      area: 0,
      measuredCount: 0,
      expectedCount,
      complete: false,
      source: "unavailable",
    };
  }

  const measuredAreas =
    objects.map(
      resolveOpeningObjectArea
    );

  const measuredCount =
    measuredAreas.filter(
      (area) => area > 0
    ).length;

  if (
    measuredCount !== expectedCount
  ) {
    return {
      area: 0,
      measuredCount,
      expectedCount,
      complete: false,
      source: "partial_model_dimensions",
    };
  }

  return {
    area: roundNumber(
      measuredAreas.reduce(
        (sum, area) =>
          sum + area,
        0
      )
    ),
    measuredCount,
    expectedCount,
    complete: true,
    source:
      "aps_model_opening_dimensions",
  };
}

export function buildTakeoffFromAps({
  geometry,
  objects,
  properties,
  layers,
}) {
  const safeGeometry =
    geometry || {};

  const safeObjects =
    Array.isArray(objects)
      ? objects
      : [];

  const rawProperties =
    Array.isArray(properties) &&
    properties.length > 0
      ? properties
      : safeObjects;

  const safeProperties = rawProperties.map((object) =>
    normalizeMeasurementsForModelUnit(
      object,
      safeGeometry.meterFactor
    )
  );

  const classified =
    safeProperties.map(
      (object) => {
        const classification =
          classifyObject(
            object
          );

        return {
          object:
            hydrateStructuralMeasurements(
              object,
              classification
            ),
          classification,
        };
      }
    );

  const walls =
    filterByClassification(
      classified,
      "isWall"
    );

  const doors =
    filterByClassification(
      classified,
      "isDoor"
    );

  const windows =
    filterByClassification(
      classified,
      "isWindow"
    );

  const rooms =
    filterByClassification(
      classified,
      "isRoom"
    );

  const floors =
    filterByClassification(
      classified,
      "isFloor"
    );

  const slabs =
    filterByClassification(
      classified,
      "isSlab"
    );

  const ceilings =
    filterByClassification(
      classified,
      "isCeiling"
    );

  const columns =
    filterByClassification(
      classified,
      "isColumn"
    );

  const beams =
    filterByClassification(
      classified,
      "isBeam"
    );

  const foundations =
    filterByClassification(
      classified,
      "isFoundation"
    );

  const stairs =
    filterByClassification(
      classified,
      "isStair"
    );

  const ramps =
    filterByClassification(
      classified,
      "isRamp"
    );

  const roofs =
    filterByClassification(
      classified,
      "isRoof"
    );

  const pipes =
    filterByClassification(
      classified,
      "isPipe"
    );

  const ducts =
    filterByClassification(
      classified,
      "isDuct"
    );

  const electricalItems =
    filterByClassification(
      classified,
      "isElectrical"
    );

  const electricalSubtypeGroups =
    electricalItems.reduce(
      (groups, object) => {
        const subtype =
          classifyElectricalSubtype(
            object
          );

        groups[subtype].push(object);
        return groups;
      },
      {
        lighting: [],
        socket: [],
        switch: [],
        distribution_board: [],
        other: [],
      }
    );

  const lightingPoints =
    electricalSubtypeGroups.lighting;

  const socketPoints =
    electricalSubtypeGroups.socket;

  const switchItems =
    electricalSubtypeGroups.switch;

  const distributionBoards =
    electricalSubtypeGroups
      .distribution_board;

  const otherElectrical =
    electricalSubtypeGroups.other;

  const resolvedElectricalCentroids =
    electricalItems.map(
      (item) =>
        resolveObjectCentroid(
          item
        )
    );

  const electricalCentroidKeys =
    resolvedElectricalCentroids
      .filter(Boolean)
      .map(
        (point) =>
          `${Number(
            point.x
          ).toFixed(6)}:${Number(
            point.y
          ).toFixed(6)}`
      );

  console.log(
    "[VENTRA APS ELECTRICAL CENTROIDS v14]",
    {
      total:
        electricalItems.length,
      valid:
        resolvedElectricalCentroids.filter(
          Boolean
        ).length,
      distinct:
        new Set(
          electricalCentroidKeys
        ).size,
      fromObjectCentroid:
        resolvedElectricalCentroids.filter(
          (point) =>
            point?.source ===
              "aps_object_centroid"
        ).length,
      fromBoundingBox:
        resolvedElectricalCentroids.filter(
          (point) =>
            point?.source ===
              "aps_bounding_box_center"
        ).length,
      missing:
        resolvedElectricalCentroids.filter(
          (point) =>
            !point
        ).length,
      sample:
        electricalItems
          .slice(0, 8)
          .map(
            (item) => ({
              dbId:
                item?.dbId ??
                null,
              name:
                item?.name ||
                null,
              centroid:
                resolveObjectCentroid(
                  item
                ),
              boundingBox:
                item?.boundingBox ||
                item?.bbox ||
                null,
            })
          ),
    }
  );

  console.log(
    "[VENTRA APS ELECTRICAL SUBTYPES v26]",
    {
      total:
        electricalItems.length,
      lighting:
        lightingPoints.length,
      socket:
        socketPoints.length,
      switch:
        switchItems.length,
      distribution_board:
        distributionBoards.length,
      other:
        otherElectrical.length,
      sample:
        electricalItems
          .slice(0, 12)
          .map(
            (item) => ({
              dbId:
                item?.dbId ??
                null,
              name:
                item?.name ||
                null,
              category:
                item?.category ||
                null,
              family:
                item?.family ||
                null,
              type:
                item?.type ||
                null,
              layer:
                item?.layer ||
                item?.layerName ||
                null,
              subtype:
                classifyElectricalSubtype(
                  item
                ),
            })
          ),
    }
  );

  const extractedWallLength =
    sumNumericProperty(
      walls,
      "length"
    );

  // Use only geometry that was positively classified as WALLS.
  // totalLengthMeters also contains doors/windows/other engineering curves and
  // must never be used as wall length.
  const geometryWallLength =
    toNumber(safeGeometry.wallLengthMeters) > 0
      ? toNumber(safeGeometry.wallLengthMeters)
      : 0;

  const geometryScaleAuthoritative =
    geometryWallLength > 0 &&
    (
      safeGeometry.unitCalibrationSource ===
        "geometry_plausibility_calibration" ||
      safeGeometry.wallLengthSource ===
        "aps_wall_centerline_geometry"
    );

  const calibrated2DGeometryAuthoritative =
    safeGeometry.unitCalibrationSource ===
      "geometry_plausibility_calibration" &&
    toNumber(
      safeGeometry.meterFactor
    ) > 0;

  const wallLength =
    geometryScaleAuthoritative
      ? geometryWallLength
      : extractedWallLength > 0
        ? extractedWallLength
        : geometryWallLength;

 const calculatedWalls =
  walls.map((wall) => {
    if (
      Number(wall.area) > 0
    ) {
      return {
        ...wall,

        resolvedArea:
          Number(wall.area),

        resolvedHeight:
          Number(wall.height) || null,

        heightSource:
          "model",

        confidence: 100,
      };
    }

    const result =
      calculateWallArea(
        wall,
        {
          defaultHeight: 3,
        }
      );

    return {
      ...wall,

      resolvedArea:
        result.area,

      resolvedHeight:
        result.height,

      heightSource:
        result.source,

      confidence:
        result.confidence,
    };
  });

const calculatedWallArea =
  calculatedWalls.reduce(
    (total, wall) =>
      total +
      (Number(
        wall.resolvedArea
      ) || 0),
    0
  );

const defaultWallHeight = 3;

const wallArea =
  geometryScaleAuthoritative
    ? wallLength > 0
      ? wallLength *
        defaultWallHeight
      : 0
    : calculatedWallArea > 0
      ? calculatedWallArea
      : wallLength > 0
        ? wallLength *
          defaultWallHeight
        : 0;

const wallHeightSource =
  geometryScaleAuthoritative &&
  wallLength > 0
    ? "project_default_from_calibrated_geometry"
    : calculatedWallArea > 0
      ? "model_objects"
      : wallLength > 0
        ? "project_default"
        : "unavailable";

  const wallVolume =
    sumNumericProperty(
      walls,
      "volume"
    );

  const modelRoomArea =
    sumNumericProperty(
      rooms,
      "area"
    );

  const geometryRoomPolygons = Array.isArray(
    safeGeometry.roomPolygons
  )
    ? safeGeometry.roomPolygons
    : [];

  const validGeometryRooms = geometryRoomPolygons.filter((polygon) => {
    const area = toNumber(polygon?.area);
    const perimeter = toNumber(polygon?.perimeter);

    return area > 0 && perimeter > 0;
  });

  const geometryRoomArea = validGeometryRooms.reduce(
    (total, polygon) => total + toNumber(polygon?.area),
    0
  );

  const roomArea = geometryRoomArea;

  const detectedRoomCount = validGeometryRooms.length;

  const floorArea =
    sumNumericProperty(
      floors,
      "area"
    );

  const slabArea =
    sumNumericProperty(
      slabs,
      "area"
    );

  const slabVolume =
    sumNumericProperty(
      slabs,
      "volume"
    );

  const ceilingArea =
    sumNumericProperty(
      ceilings,
      "area"
    );

  const columnVolume =
    sumNumericProperty(
      columns,
      "volume"
    );

  const beamVolume =
    sumNumericProperty(
      beams,
      "volume"
    );

  const foundationVolume =
    sumNumericProperty(
      foundations,
      "volume"
    );

  // BOQ-only derived formwork quantities. These use already-normalized APS
  // object dimensions and never modify geometry detection. If dimensions are
  // incomplete, the affected quantity stays zero instead of being estimated.
  console.log(
    "[VENTRA STRUCTURAL DIMENSIONS v31]",
    {
      columns:
        columns.length,
      columnsWithCompleteDimensions:
        columns.filter(
          (item) =>
            Number(item?.width) > 0 &&
            Number(item?.length) > 0 &&
            Number(item?.height) > 0
        ).length,
      beams:
        beams.length,
      beamsWithCompleteDimensions:
        beams.filter(
          (item) =>
            Number(item?.width) > 0 &&
            Number(item?.length) > 0 &&
            Number(item?.height) > 0
        ).length,
      foundations:
        foundations.length,
      foundationsWithCompleteDimensions:
        foundations.filter(
          (item) =>
            Number(item?.width) > 0 &&
            Number(item?.length) > 0 &&
            Number(item?.height) > 0
        ).length,
      slabs:
        slabs.length,
      slabsWithVolume:
        slabs.filter(
          (item) =>
            Number(item?.volume) > 0
        ).length,
      sampleColumns:
        columns
          .slice(0, 5)
          .map(
            (item) => ({
              dbId:
                item?.dbId ??
                null,
              name:
                item?.name ||
                null,
              width:
                item?.width ||
                0,
              length:
                item?.length ||
                0,
              height:
                item?.height ||
                0,
              volume:
                item?.volume ||
                0,
              source:
                item?.structuralMeasurementSource ||
                null,
            })
          ),
    }
  );

  const columnFormworkMeasurement =
    measureCompleteDerivedArea(
      columns,
      calculateRectangularColumnFormworkArea
    );

  const beamFormworkMeasurement =
    measureCompleteDerivedArea(
      beams,
      calculateRectangularBeamFormworkArea
    );

  const foundationFormworkMeasurement =
    measureCompleteDerivedArea(
      foundations,
      calculateFoundationFormworkArea
    );

  const columnFormworkArea =
    columnFormworkMeasurement.area;

  const beamFormworkArea =
    beamFormworkMeasurement.area;

  const foundationFormworkArea =
    foundationFormworkMeasurement.area;

  const slabFormworkMeasurement = {
    area:
      slabArea > 0
        ? slabArea
        : 0,
    measuredCount:
      slabArea > 0
        ? slabs.length
        : 0,
    totalCount:
      slabs.length,
    complete:
      slabArea > 0 &&
      slabs.length > 0,
  };

  const slabFormworkArea =
    slabFormworkMeasurement.area;

  const roofArea =
    sumNumericProperty(
      roofs,
      "area"
    );

  const pipeLength =
    sumNumericProperty(
      pipes,
      "length"
    );

  const ductLength =
    sumNumericProperty(
      ducts,
      "length"
    );

  const geometryFloorArea = toNumber(
    safeGeometry.floorArea
  );

  const finalFloorArea =
    calibrated2DGeometryAuthoritative &&
    geometryFloorArea > 0
      ? geometryFloorArea
      : floorArea > 0
        ? floorArea
        : geometryFloorArea > 0
          ? geometryFloorArea
          : 0;

  const floorAreaSource =
    calibrated2DGeometryAuthoritative &&
    geometryFloorArea > 0
      ? safeGeometry.floorAreaSource ||
        "calibrated_geometry_exterior_footprint"
      : floorArea > 0
        ? "model_floor_properties"
        : geometryFloorArea > 0
          ? safeGeometry.floorAreaSource ||
            "geometry_exterior_footprint"
          : "unavailable";

  const finalCeilingArea =
    ceilingArea > 0
      ? ceilingArea
      : roomArea;

  const levels =
    countByValue(
      safeProperties,
      (object) => object?.level
    );

  const materials =
    countByValue(
      safeProperties,
      (object) =>
        object?.material
    );

  const wallTypes =
    countByValue(
      walls,
      classifyWallType
    );

  const wallAreaByType =
    sumByValue(
      walls,
      classifyWallType,
      "area"
    );

  const roomTypes =
    detectedRoomCount > 0
      ? { Unclassified: detectedRoomCount }
      : {};

  const roomAreaByType =
    roomArea > 0
      ? { Unclassified: roundNumber(roomArea) }
      : {};

  const resolvedWallObjects =
    Number.isFinite(
      Number(
        safeGeometry.wallObjectCount
      )
    ) &&
    Number(
      safeGeometry.wallObjectCount
    ) > 0
      ? Number(
          safeGeometry.wallObjectCount
        )
      : walls.length;

  /*
   * Opening-count authority:
   * an explicit APS geometry zero is a real measurement, not a missing value.
   * Fall back to classified model objects only when the geometry field is absent.
   */
  const hasGeometryDoorCount =
    safeGeometry.doorCount !== null &&
    safeGeometry.doorCount !== undefined &&
    safeGeometry.doorCount !== "" &&
    Number.isFinite(Number(safeGeometry.doorCount));

  const hasGeometryWindowCount =
    safeGeometry.windowCount !== null &&
    safeGeometry.windowCount !== undefined &&
    safeGeometry.windowCount !== "" &&
    Number.isFinite(Number(safeGeometry.windowCount));

  const resolvedDoorCount =
    hasGeometryDoorCount
      ? Math.max(0, Number(safeGeometry.doorCount))
      : doors.length;

  const resolvedWindowCount =
    hasGeometryWindowCount
      ? Math.max(0, Number(safeGeometry.windowCount))
      : windows.length;

  const doorCountSource =
    hasGeometryDoorCount
      ? "aps_geometry"
      : doors.length > 0
        ? "aps_model_classification"
        : "unavailable";

  const windowCountSource =
    hasGeometryWindowCount
      ? "aps_geometry"
      : windows.length > 0
        ? "aps_model_classification"
        : "unavailable";

  const measuredDoorOpening =
    calculateCompleteMeasuredOpeningArea(
      doors,
      resolvedDoorCount
    );

  const measuredWindowOpening =
    calculateCompleteMeasuredOpeningArea(
      windows,
      resolvedWindowCount
    );

  const measuredDoorArea =
    measuredDoorOpening.complete
      ? measuredDoorOpening.area
      : 0;

  const measuredWindowArea =
    measuredWindowOpening.complete
      ? measuredWindowOpening.area
      : 0;

  const measuredOpeningArea =
    measuredDoorOpening.complete &&
    measuredWindowOpening.complete
      ? roundNumber(
          measuredDoorArea +
            measuredWindowArea
        )
      : 0;

  const hasDetailedQuantities =
    wallArea > 0 ||
    finalFloorArea > 0 ||
    slabArea > 0 ||
    finalCeilingArea > 0 ||
    wallVolume > 0 ||
    columnVolume > 0 ||
    beamVolume > 0 ||
    detectedRoomCount > 0;

  const detectedCategories = [
    resolvedWallObjects,
    resolvedDoorCount,
    resolvedWindowCount,
    detectedRoomCount,
    floors.length,
    slabs.length,
    ceilings.length,
    columns.length,
    beams.length,
    foundations.length,
    stairs.length,
    ramps.length,
    roofs.length,
    pipes.length,
    ducts.length,
    electricalItems.length,
  ].filter(
    (count) => count > 0
  ).length;

  const confidence =
    hasDetailedQuantities &&
    detectedCategories >= 6
      ? 95
      : hasDetailedQuantities
        ? 88
        : geometryWallLength > 0
          ? 68
          : 40;

  return {
    rooms: detectedRoomCount,
    doors:
      resolvedDoorCount,
    windows:
      resolvedWindowCount,

    door_count_source:
      doorCountSource,

    window_count_source:
      windowCountSource,

    door_area:
      measuredDoorArea,

    window_area:
      measuredWindowArea,

    opening_area:
      measuredOpeningArea,

    door_area_source:
      measuredDoorOpening.source,

    window_area_source:
      measuredWindowOpening.source,

    opening_area_source:
      measuredOpeningArea > 0
        ? "aps_model_opening_dimensions"
        : "unavailable",

    opening_dimensions_complete:
      measuredDoorOpening.complete &&
      measuredWindowOpening.complete,

    opening_measurement_coverage: {
      doors: {
        measured:
          measuredDoorOpening.measuredCount,
        expected:
          measuredDoorOpening.expectedCount,
      },
      windows: {
        measured:
          measuredWindowOpening.measuredCount,
        expected:
          measuredWindowOpening.expectedCount,
      },
    },

    walls:
      resolvedWallObjects,
    floors: floors.length,
    slabs: slabs.length,
    ceilings: ceilings.length,
    columns: columns.length,
    beams: beams.length,
    foundations:
      foundations.length,
    stairs: stairs.length,
    ramps: ramps.length,
    roofs: roofs.length,

    pipes: pipes.length,
    ducts: ducts.length,
    electrical_items:
      electricalItems.length,

    lighting_points:
      lightingPoints.length,

    socket_points:
      socketPoints.length,

    switches:
      switchItems.length,

    distribution_boards:
      distributionBoards.length,

    other_electrical:
      otherElectrical.length,

    electrical_subtype_total:
      lightingPoints.length +
      socketPoints.length +
      switchItems.length +
      distributionBoards.length +
      otherElectrical.length,

    wall_length:
      roundNumber(wallLength),

    wall_length_source:
      geometryScaleAuthoritative
        ? "calibrated_wall_geometry"
        : extractedWallLength > 0
          ? "model_object_properties"
          : geometryWallLength > 0
            ? "wall_geometry"
            : "unavailable",

    geometry_metric_authority:
      calibrated2DGeometryAuthoritative
        ? "calibrated_2d_geometry"
        : geometryScaleAuthoritative
          ? "wall_geometry"
          : "model_properties",

    wall_area:
      roundNumber(wallArea),
wall_height:
  wallArea > 0 && wallLength > 0
    ? roundNumber(
        wallArea / wallLength
      )
    : 0,

wall_height_source:
  wallHeightSource,

wall_area_estimated:
  wallLength > 0 &&
  (geometryScaleAuthoritative || calculatedWallArea <= 0),
    wall_volume:
      roundNumber(wallVolume),

    room_area:
      roundNumber(roomArea),

    floor_area:
      roundNumber(finalFloorArea),

    floor_area_source:
      floorAreaSource,

    floor_area_polygon_count:
      toNumber(safeGeometry.floorAreaPolygonCount),

    floor_area_confidence:
      geometryFloorArea > 0
        ? toNumber(safeGeometry.floorAreaConfidence)
        : finalFloorArea > 0
          ? 95
          : 0,

    slab_area:
      roundNumber(slabArea),

    slab_volume:
      roundNumber(slabVolume),

    ceiling_area:
      roundNumber(finalCeilingArea),

    column_volume:
      roundNumber(columnVolume),

    beam_volume:
      roundNumber(beamVolume),

    foundation_volume:
      roundNumber(
        foundationVolume
      ),

    column_formwork_area:
      roundNumber(columnFormworkArea),

    beam_formwork_area:
      roundNumber(beamFormworkArea),

    foundation_formwork_area:
      roundNumber(foundationFormworkArea),

    slab_formwork_area:
      roundNumber(slabFormworkArea),

    structural_measurement_status: {
      columns: {
        volumeMeasured:
          columnVolume > 0,
        formworkComplete:
          columnFormworkMeasurement.complete,
        measuredObjects:
          columnFormworkMeasurement.measuredCount,
        totalObjects:
          columnFormworkMeasurement.totalCount,
      },
      beams: {
        volumeMeasured:
          beamVolume > 0,
        formworkComplete:
          beamFormworkMeasurement.complete,
        measuredObjects:
          beamFormworkMeasurement.measuredCount,
        totalObjects:
          beamFormworkMeasurement.totalCount,
      },
      foundations: {
        volumeMeasured:
          foundationVolume > 0,
        formworkComplete:
          foundationFormworkMeasurement.complete,
        measuredObjects:
          foundationFormworkMeasurement.measuredCount,
        totalObjects:
          foundationFormworkMeasurement.totalCount,
      },
      slabs: {
        volumeMeasured:
          slabVolume > 0,
        formworkComplete:
          slabFormworkMeasurement.complete,
        measuredObjects:
          slabFormworkMeasurement.measuredCount,
        totalObjects:
          slabFormworkMeasurement.totalCount,
      },
    },

    roof_area:
      roundNumber(roofArea),

    pipe_length:
      roundNumber(pipeLength),

    duct_length:
      roundNumber(ductLength),

    confidence,

    model_unit:
      safeGeometry.unit ||
      "model units",

    meter_factor:
      Number.isFinite(
        Number(
          safeGeometry.meterFactor
        )
      )
        ? Number(
            safeGeometry.meterFactor
          )
        : null,

    levels,

    materials,

    classifications: {
      wall_types: wallTypes,
      wall_area_by_type:
        wallAreaByType,
      room_types: roomTypes,
      room_area_by_type:
        roomAreaByType,
    },

  object_details: {
  walls:
    calculatedWalls.map(
      (wall) => ({
    dbId: wall.dbId,

    name: wall.name,

    category:
      wall.category,

    family:
      wall.family,

    type: wall.type,

    level:
      wall.level,

    material:
      wall.material,

    detectedType:
      "wall",

    length:
      wall.length,

    width:
      wall.width,

    height:
      wall.resolvedHeight,

    area:
      wall.resolvedArea,

    volume:
      wall.volume,

    heightSource:
      wall.heightSource,

    confidence:
      wall.confidence,
  })
),
        

      doors:
        createObjectSummary(
          doors,
          "door"
        ),

      windows:
        createObjectSummary(
          windows,
          "window"
        ),

      rooms:
        validGeometryRooms.map((polygon, index) => ({
          dbId: null,
          name: polygon?.name || `Room ${index + 1}`,
          category: "Geometry Room",
          family: null,
          type: null,
          level: null,
          material: null,
          detectedType: "room",
          roomType: "unclassified",
          length: 0,
          width: 0,
          height: 0,
          area: roundNumber(polygon?.area),
          perimeter: roundNumber(polygon?.perimeter),
          centroid: polygon?.centroid || null,
          volume: 0,
          source: "geometry_closed_face",
          geometryPolygonId: polygon?.id || `room-${index + 1}`,
        })),

      slabs:
        createObjectSummary(
          slabs,
          "slab"
        ),

      columns:
        createObjectSummary(
          columns,
          "column"
        ),

      beams:
        createObjectSummary(
          beams,
          "beam"
        ),

      foundations:
        createObjectSummary(
          foundations,
          "foundation"
        ),

      stairs:
        createObjectSummary(
          stairs,
          "stair"
        ),

      ramps:
        createObjectSummary(
          ramps,
          "ramp"
        ),

      mep: [
        ...createObjectSummary(
          pipes,
          "pipe"
        ),
        ...createObjectSummary(
          ducts,
          "duct"
        ),
        ...createObjectSummary(
          electricalItems,
          "electrical"
        ).map(
          (summary, index) => ({
            ...summary,
            electricalSubtype:
              classifyElectricalSubtype(
                electricalItems[index]
              ),
            electricalEvidence: {
              name:
                electricalItems[index]
                  ?.name ||
                null,
              category:
                electricalItems[index]
                  ?.category ||
                null,
              family:
                electricalItems[index]
                  ?.family ||
                null,
              type:
                electricalItems[index]
                  ?.type ||
                null,
              layer:
                electricalItems[index]
                  ?.layer ||
                electricalItems[index]
                  ?.layerName ||
                null,
            },
          })
        ),
      ],
    },
notes:
  calculatedWallArea > 0
    ? "Wall area calculated from Autodesk model object properties."
    : wallLength > 0
      ? `Wall area estimated from ${roundNumber(
          wallLength
        )} m wall length × ${defaultWallHeight} m default wall height.`
      : hasDetailedQuantities
        ? "Advanced Autodesk APS takeoff completed with architectural, structural and MEP classification."
        : "Autodesk geometry was extracted, but the model does not contain enough measurable object properties.",
    statistics: {
      totalObjects:
        safeObjects.length,

      extractedProperties:
        safeProperties.length,

      detectedCategories,

      detectedWalls:
        resolvedWallObjects,

      detectedDoors:
        resolvedDoorCount,

      detectedWindows:
        resolvedWindowCount,

      detectedRooms:
        detectedRoomCount,

      detectedFloors:
        floors.length,

      detectedSlabs:
        slabs.length,

      detectedCeilings:
        ceilings.length,

      detectedColumns:
        columns.length,

      detectedBeams:
        beams.length,

      detectedFoundations:
        foundations.length,

      detectedStairs:
        stairs.length,

      detectedRamps:
        ramps.length,

      detectedRoofs:
        roofs.length,

      detectedPipes:
        pipes.length,

      detectedDucts:
        ducts.length,

      detectedElectricalItems:
        electricalItems.length,

      detectedLightingPoints:
        lightingPoints.length,

      detectedSocketPoints:
        socketPoints.length,

      detectedSwitches:
        switchItems.length,

      detectedDistributionBoards:
        distributionBoards.length,

      detectedOtherElectrical:
        otherElectrical.length,

      electricalObjectsWithCentroid:
        electricalItems.filter(
          (item) =>
            Number.isFinite(
              Number(
                item?.centroid?.x
              )
            ) &&
            Number.isFinite(
              Number(
                item?.centroid?.y
              )
            )
        ).length,

      detectedLayers:
        toNumber(
          layers?.totalLayers
        ),
    },
  };
}
