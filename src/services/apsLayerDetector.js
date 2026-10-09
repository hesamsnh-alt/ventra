const CATEGORY_KEYS = [
  "walls",
  "doors",
  "windows",
  "slabs",
  "columns",
  "beams",
  "texts",
  "dimensions",
  "unknown",
];

const CATEGORY_RULES = {
  walls: [
    /(^|[^a-z])walls?([^a-z]|$)/i,
    /a[-_\s]?wall/i,
    /s[-_\s]?wall/i,
    /partition/i,
    /masonry/i,
    /blockwork/i,
    /block[\s_-]*wall/i,
    /curtain[\s_-]*wall/i,
    /brick/i,
  ],

  doors: [
    /(^|[^a-z])doors?([^a-z]|$)/i,
    /a[-_\s]?door/i,
    /gate/i,
    /shutter/i,
    /(^|[^a-z])dr([^a-z]|$)/i,
  ],

  windows: [
    /(^|[^a-z])windows?([^a-z]|$)/i,
    /a[-_\s]?window/i,
    /glazing/i,
    /glazed/i,
    /wndw/i,
    /(^|[^a-z])win([^a-z]|$)/i,
  ],

  slabs: [
    /(^|[^a-z])slab([^a-z]|$)/i,
    /structural[\s_-]*floor/i,
    /floor[\s_-]*slab/i,
    /deck/i,
  ],

  columns: [
    /(^|[^a-z])column([^a-z]|$)/i,
    /pillar/i,
    /(^|[^a-z])col([^a-z]|$)/i,
  ],

  beams: [
    /(^|[^a-z])beam([^a-z]|$)/i,
    /girder/i,
  ],

  texts: [
    /(^|[^a-z])text([^a-z]|$)/i,
    /note/i,
    /annotation/i,
    /label/i,
    /mtext/i,
  ],

  dimensions: [
    /dimension/i,
    /(^|[^a-z])dim([^a-z]|$)/i,
    /measurement/i,
  ],
};

const LAYER_PROPERTY_PATTERNS = [
  /^layer$/i,
  /^layer name$/i,
  /layer\s*name/i,
  /cad\s*layer/i,
  /presentation\s*layer/i,
  /aec\s*layer/i,
  /source\s*layer/i,
  /object\s*layer/i,
  /layer\s*id/i,
];

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function normalizeLayerName(value) {
  return cleanText(value)
    .replace(/\s+/g, " ")
    .replace(/[|:]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function normalizeProperty(property) {
  if (!property || typeof property !== "object") {
    return null;
  }

  return {
    ...property,

    displayName:
      property.displayName ??
      property.name ??
      property.attributeName ??
      property.key ??
      "",

    displayValue:
      property.displayValue ??
      property.value ??
      property.display_value ??
      property.val ??
      "",

    displayCategory:
      property.displayCategory ??
      property.category ??
      property.group ??
      "",
  };
}

function objectPropertiesToArray(properties) {
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return [];
  }

  const result = [];

  for (const [key, value] of Object.entries(properties)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        result.push({
          displayCategory: key,
          displayName: nestedKey,
          displayValue: nestedValue,
        });
      };

      continue;
    }

    result.push({
      displayName: key,
      displayValue: value,
    });
  }

  return result;
}

function getProperties(object) {
  const properties = [];

  const propertySources = [
    object?.rawProperties,
    object?.properties,
    object?.props,
    object?.attributes,
    object?.metadata,
  ];

  for (const source of propertySources) {
    if (Array.isArray(source)) {
      properties.push(...source);
      continue;
    }

    properties.push(
      ...objectPropertiesToArray(source)
    );
  }

  return properties
    .map(normalizeProperty)
    .filter(Boolean);
}

function getPropertyName(property) {
  return cleanText(
    property?.displayName ??
      property?.name ??
      property?.attributeName ??
      property?.key
  );
}

function getPropertyValue(property) {
  return cleanText(
    property?.displayValue ??
      property?.value ??
      property?.display_value ??
      property?.val
  );
}

function isLayerProperty(name) {
  const normalizedName = cleanText(name);

  if (!normalizedName) {
    return false;
  }

  return LAYER_PROPERTY_PATTERNS.some((pattern) =>
    pattern.test(normalizedName)
  );
}

function getObjectSearchableText(object) {
  const propertyText = getProperties(object)
    .map((property) =>
      [
        getPropertyName(property),
        getPropertyValue(property),
        property?.displayCategory,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");

  return [
    object?.name,
    object?.displayName,
    object?.objectName,
    object?.category,
    object?.categoryName,
    object?.family,
    object?.familyName,
    object?.type,
    object?.typeName,
    object?.className,
    object?.layer,
    object?.layerName,
    object?.layer_name,
    propertyText,
  ]
    .filter(Boolean)
    .join(" ");
}

export function getObjectLayerName(object) {
  const directCandidates = [
    object?.layer,
    object?.layerName,
    object?.layer_name,
    object?.cadLayer,
    object?.cad_layer,
    object?.sourceLayer,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeLayerName(candidate);

    if (normalized) {
      return normalized;
    }
  }

  for (const property of getProperties(object)) {
    const propertyName = getPropertyName(property);

    if (!isLayerProperty(propertyName)) {
      continue;
    }

    const propertyValue = normalizeLayerName(
      getPropertyValue(property)
    );

    if (propertyValue) {
      return propertyValue;
    }
  }

  return "";
}

export function classifyLayerName(value) {
  const normalized = normalizeLayerName(value);

  if (!normalized) {
    return "unknown";
  }

  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    if (rules.some((rule) => rule.test(normalized))) {
      return category;
    }
  }

  return "unknown";
}

function classifyObject(object) {
  return classifyLayerName(
    getObjectSearchableText(object)
  );
}

function createCategoryObject(initialValueFactory) {
  return CATEGORY_KEYS.reduce((result, key) => {
    result[key] = initialValueFactory();
    return result;
  }, {});
}

function normalizeInput(input) {
  if (Array.isArray(input)) {
    return {
      objects: input,
      model: null,
    };
  }

  return {
    objects: Array.isArray(input?.objects)
      ? input.objects
      : [],

    model: input?.model ?? null,
  };
}

function hasUsableProperties(object) {
  return getProperties(object).length > 0;
}

async function getBulkProperties(model, dbIds) {
  return new Promise((resolve) => {
    model.getBulkProperties(
      dbIds,
      {},
      (result) => {
        resolve(
          Array.isArray(result)
            ? result
            : []
        );
      },
      (error) => {
        console.warn(
          "[VENTRA APS BULK PROPERTIES FAILED]",
          error
        );

        resolve([]);
      }
    );
  });
}

async function enrichMissingProperties(model, objects) {
  if (
    !model ||
    typeof model.getBulkProperties !== "function"
  ) {
    return objects;
  }

  const missingObjects = objects.filter(
    (object) => !hasUsableProperties(object)
  );

  const dbIds = missingObjects
    .map((object) => Number(object?.dbId))
    .filter(Number.isFinite);

  if (dbIds.length === 0) {
    return objects;
  }

  const bulkProperties = await getBulkProperties(
    model,
    dbIds
  );

  const propertiesById = new Map(
    bulkProperties.map((item) => [
      Number(item?.dbId),
      item,
    ])
  );

  return objects.map((object) => {
    const enrichedObject = propertiesById.get(
      Number(object?.dbId)
    );

    if (!enrichedObject) {
      return object;
    }

    const enrichedProperties =
      enrichedObject.properties ?? [];

    return {
      ...object,

      name:
        object?.name ??
        enrichedObject?.name ??
        "",

      properties:
        hasUsableProperties(object)
          ? object.properties
          : enrichedProperties,

      rawProperties:
        Array.isArray(object?.rawProperties) &&
        object.rawProperties.length > 0
          ? object.rawProperties
          : enrichedProperties,
    };
  });
}

function buildEffectiveStatistics({
  layerStatistics,
  objectCounts,
}) {
  const effective = createCategoryObject(() => 0);

  for (const key of CATEGORY_KEYS) {
    effective[key] =
      layerStatistics[key] > 0
        ? layerStatistics[key]
        : objectCounts[key];
  }

  return effective;
}

export async function detectLayers(input = []) {
  const normalizedInput = normalizeInput(input);

  const objects = await enrichMissingProperties(
    normalizedInput.model,
    normalizedInput.objects
  );

  const layers = createCategoryObject(() => []);
  const objectCounts = createCategoryObject(() => 0);

  const classificationSources = {
    layer: 0,
    objectMetadata: 0,
    unknown: 0,
  };

  const layerMap = new Map();

  let objectsWithoutLayer = 0;

  for (const object of objects) {
    const layerName = getObjectLayerName(object);

    let category = "unknown";

    if (layerName) {
      category = classifyLayerName(layerName);
      classificationSources.layer += 1;
    } else {
      objectsWithoutLayer += 1;
      category = classifyObject(object);

      if (category === "unknown") {
        classificationSources.unknown += 1;
      } else {
        classificationSources.objectMetadata += 1;
      }
    }

    objectCounts[category] += 1;

    if (!layerName) {
      continue;
    }

    const key = layerName.toLowerCase();

    if (!layerMap.has(key)) {
      layerMap.set(key, {
        name: layerName,
        category,
        objectCount: 0,
      });
    }

    layerMap.get(key).objectCount += 1;
  }

  const detectedLayers = Array.from(
    layerMap.values()
  ).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const layer of detectedLayers) {
    layers[layer.category].push(layer.name);
  }

  const actualLayerStatistics =
    createCategoryObject(() => 0);

  for (const key of CATEGORY_KEYS) {
    actualLayerStatistics[key] =
      layers[key].length;
  }

  const effectiveStatistics =
    buildEffectiveStatistics({
      layerStatistics: actualLayerStatistics,
      objectCounts,
    });

  const classifiedObjectCount = CATEGORY_KEYS
    .filter((key) => key !== "unknown")
    .reduce(
      (total, key) =>
        total + objectCounts[key],
      0
    );

  const classifiedLayerCount =
    detectedLayers.filter(
      (layer) =>
        layer.category !== "unknown"
    ).length;

  const inferredCategoryCount = CATEGORY_KEYS
    .filter(
      (key) =>
        key !== "unknown" &&
        objectCounts[key] > 0
    )
    .length;

  let status = "ready-no-classification";

  if (detectedLayers.length > 0) {
    status = "ready";
  } else if (classifiedObjectCount > 0) {
    status = "ready-object-classification";
  } else if (objects.length > 0) {
    status = "ready-unclassified";
  }

  const result = {
    status,

    totalLayers:
      detectedLayers.length,

    effectiveTotalLayers:
      detectedLayers.length > 0
        ? detectedLayers.length
        : inferredCategoryCount,

    classifiedLayers:
      classifiedLayerCount,

    unknownLayers:
      actualLayerStatistics.unknown,

    objectsAnalyzed:
      objects.length,

    classifiedObjects:
      classifiedObjectCount,

    unknownObjects:
      objectCounts.unknown,

    objectsWithoutLayer,

    classificationSources,

    /*
     * برای سازگاری با UI فعلی،
     * statistics از Layer واقعی استفاده می‌کند
     * و اگر Layer موجود نبود از تشخیص آبجکت fallback می‌گیرد.
     */
    statistics:
      effectiveStatistics,

    actualLayerStatistics,

    inferredStatistics:
      objectCounts,

    objectCounts,

    layers,

    detectedLayers,
  };

  console.log(
    "[VENTRA LAYER DETECTION COMPLETE]",
    result
  );

  return result;
}

export default detectLayers;
