function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function roundNumber(value, decimals = 3) {
  const number = toNumber(value);
  const factor = 10 ** decimals;

  return (
    Math.round(number * factor) /
    factor
  );
}

function includesKeyword(
  value,
  keywords
) {
  const text = normalizeText(value);

  return keywords.some((keyword) =>
    text.includes(
      normalizeText(keyword)
    )
  );
}

function getRawProperties(object) {
  return Array.isArray(
    object?.rawProperties
  )
    ? object.rawProperties
    : [];
}

function getSearchableText(object) {
  const rawPropertyText =
    getRawProperties(object)
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
    object?.material,
    rawPropertyText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifyObject(object) {
  const text =
    getSearchableText(object);

  const isWall =
    includesKeyword(text, [
      "wall",
      "walls",
      "curtain wall",
      "partition",
      "masonry",
    ]);

  const isDoor =
    includesKeyword(text, [
      "door",
      "doors",
      "gate",
      "shutter",
    ]);

  const isWindow =
    includesKeyword(text, [
      "window",
      "windows",
      "glazing",
      "skylight",
    ]);

  const isRoom =
    includesKeyword(text, [
      "room",
      "rooms",
      "space",
      "spaces",
      "area boundary",
    ]);

  const isSlab =
    includesKeyword(text, [
      "slab",
      "slabs",
      "structural floor",
      "floor slab",
    ]);

  const isColumn =
    includesKeyword(text, [
      "column",
      "columns",
      "pillar",
    ]);

  const isBeam =
    includesKeyword(text, [
      "beam",
      "beams",
      "girder",
    ]);

  const isFoundation =
    includesKeyword(text, [
      "foundation",
      "footing",
      "pile",
      "pile cap",
      "raft",
    ]);

  const isPipe =
    includesKeyword(text, [
      "pipe",
      "piping",
      "plumbing",
    ]);

  const isDuct =
    includesKeyword(text, [
      "duct",
      "ductwork",
      "hvac",
    ]);

  const isElectrical =
    includesKeyword(text, [
      "electrical",
      "conduit",
      "cable tray",
      "socket",
      "switch",
      "lighting fixture",
      "distribution board",
    ]);

  let objectType = "unknown";

  if (isWall) objectType = "wall";
  else if (isDoor) objectType = "door";
  else if (isWindow) {
    objectType = "window";
  } else if (isRoom) {
    objectType = "room";
  } else if (isSlab) {
    objectType = "slab";
  } else if (isColumn) {
    objectType = "column";
  } else if (isBeam) {
    objectType = "beam";
  } else if (isFoundation) {
    objectType = "foundation";
  } else if (isPipe) {
    objectType = "pipe";
  } else if (isDuct) {
    objectType = "duct";
  } else if (isElectrical) {
    objectType = "electrical";
  }

  return {
    objectType,
    isWall,
    isDoor,
    isWindow,
    isRoom,
    isSlab,
    isColumn,
    isBeam,
    isFoundation,
    isPipe,
    isDuct,
    isElectrical,
  };
}

function getPropertyNames(object) {
  return getRawProperties(object)
    .map(
      (property) =>
        property?.displayName ||
        property?.attributeName
    )
    .filter(Boolean);
}

function hasNumericValue(value) {
  return (
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}

function calculateFallbackArea(
  object
) {
  const length =
    toNumber(object?.length);

  const height =
    toNumber(object?.height);

  if (length > 0 && height > 0) {
    return roundNumber(
      length * height
    );
  }

  return 0;
}

function calculateFallbackVolume(
  object,
  area
) {
  const width =
    toNumber(object?.width);

  if (area > 0 && width > 0) {
    return roundNumber(
      area * width
    );
  }

  return 0;
}

function createDiagnosticObject(
  object
) {
  const classification =
    classifyObject(object);

  const extractedArea =
    toNumber(object?.area);

  const calculatedArea =
    extractedArea > 0
      ? 0
      : calculateFallbackArea(
          object
        );

  const finalArea =
    extractedArea > 0
      ? extractedArea
      : calculatedArea;

  const extractedVolume =
    toNumber(object?.volume);

  const calculatedVolume =
    extractedVolume > 0
      ? 0
      : calculateFallbackVolume(
          object,
          finalArea
        );

  const finalVolume =
    extractedVolume > 0
      ? extractedVolume
      : calculatedVolume;

  const propertiesFound = [];
  const missingProperties = [];

  const checks = [
    {
      name: "Length",
      value: object?.length,
    },
    {
      name: "Width",
      value: object?.width,
    },
    {
      name: "Height",
      value: object?.height,
    },
    {
      name: "Area",
      value: finalArea,
    },
    {
      name: "Volume",
      value: finalVolume,
    },
    {
      name: "Material",
      value: object?.material,
      numeric: false,
    },
    {
      name: "Level",
      value: object?.level,
      numeric: false,
    },
  ];

  checks.forEach((check) => {
    const exists =
      check.numeric === false
        ? Boolean(
            String(
              check.value ?? ""
            ).trim()
          )
        : hasNumericValue(
            check.value
          );

    if (exists) {
      propertiesFound.push(
        check.name
      );
    } else {
      missingProperties.push(
        check.name
      );
    }
  });

  return {
    dbId:
      object?.dbId ?? null,

    name:
      object?.name || null,

    category:
      object?.category || null,

    family:
      object?.family || null,

    type:
      object?.type || null,

    level:
      object?.level || null,

    material:
      object?.material || null,

    length:
      roundNumber(
        object?.length
      ),

    width:
      roundNumber(
        object?.width
      ),

    height:
      roundNumber(
        object?.height
      ),

    extractedArea:
      roundNumber(
        extractedArea
      ),

    calculatedArea:
      roundNumber(
        calculatedArea
      ),

    area:
      roundNumber(
        finalArea
      ),

    extractedVolume:
      roundNumber(
        extractedVolume
      ),

    calculatedVolume:
      roundNumber(
        calculatedVolume
      ),

    volume:
      roundNumber(
        finalVolume
      ),

    areaSource:
      extractedArea > 0
        ? "model-property"
        : calculatedArea > 0
          ? "length-x-height"
          : "missing",

    volumeSource:
      extractedVolume > 0
        ? "model-property"
        : calculatedVolume > 0
          ? "area-x-width"
          : "missing",

    propertiesFound,

    missingProperties,

    availablePropertyNames:
      getPropertyNames(object),

    classification,

    rawProperties:
      getRawProperties(object),
  };
}

function countWithValue(
  objects,
  propertyName
) {
  return objects.filter((object) =>
    hasNumericValue(
      object?.[propertyName]
    )
  ).length;
}

function countWithText(
  objects,
  propertyName
) {
  return objects.filter((object) =>
    Boolean(
      String(
        object?.[propertyName] ?? ""
      ).trim()
    )
  ).length;
}

function createTypeSummary(
  objects
) {
  return {
    total: objects.length,

    withLength:
      countWithValue(
        objects,
        "length"
      ),

    withoutLength:
      objects.length -
      countWithValue(
        objects,
        "length"
      ),

    withHeight:
      countWithValue(
        objects,
        "height"
      ),

    withoutHeight:
      objects.length -
      countWithValue(
        objects,
        "height"
      ),

    withArea:
      objects.filter(
        (object) =>
          object.area > 0
      ).length,

    withoutArea:
      objects.filter(
        (object) =>
          object.area <= 0
      ).length,

    withVolume:
      objects.filter(
        (object) =>
          object.volume > 0
      ).length,

    withoutVolume:
      objects.filter(
        (object) =>
          object.volume <= 0
      ).length,

    withMaterial:
      countWithText(
        objects,
        "material"
      ),

    withoutMaterial:
      objects.length -
      countWithText(
        objects,
        "material"
      ),

    calculatedAreas:
      objects.filter(
        (object) =>
          object.areaSource ===
          "length-x-height"
      ).length,

    missingAreas:
      objects.filter(
        (object) =>
          object.areaSource ===
          "missing"
      ).length,
  };
}

function groupByType(objects) {
  return objects.reduce(
    (groups, object) => {
      const type =
        object.classification
          .objectType;

      if (!groups[type]) {
        groups[type] = [];
      }

      groups[type].push(object);

      return groups;
    },
    {}
  );
}

function printDiagnosticReport(
  report
) {
  console.group(
    "===== VENTRA APS DIAGNOSTIC ====="
  );

  console.log(
    "Total objects:",
    report.totalObjects
  );

  console.log(
    "Total classified:",
    report.totalClassified
  );

  console.log(
    "Unknown objects:",
    report.summary.unknown?.total ||
      0
  );

  console.table(
    Object.entries(
      report.summary
    ).map(([type, values]) => ({
      type,
      total: values.total,
      withArea:
        values.withArea,
      calculatedAreas:
        values.calculatedAreas,
      withoutArea:
        values.withoutArea,
      withHeight:
        values.withHeight,
      withoutHeight:
        values.withoutHeight,
      withMaterial:
        values.withMaterial,
    }))
  );

  const wallsWithoutArea =
    report.objects.filter(
      (object) =>
        object.classification
          .isWall &&
        object.area <= 0
    );

  if (
    wallsWithoutArea.length > 0
  ) {
    console.group(
      `Walls without area: ${wallsWithoutArea.length}`
    );

    wallsWithoutArea.forEach(
      (wall) => {
        console.group(
          `Wall DBID: ${wall.dbId}`
        );

        console.log(
          "Name:",
          wall.name
        );

        console.log(
          "Type:",
          wall.type
        );

        console.log(
          "Length:",
          wall.length
        );

        console.log(
          "Height:",
          wall.height
        );

        console.log(
          "Width:",
          wall.width
        );

        console.log(
          "Missing:",
          wall.missingProperties
        );

        console.log(
          "Available properties:",
          wall.availablePropertyNames
        );

        console.log(
          "Raw properties:",
          wall.rawProperties
        );

        console.groupEnd();
      }
    );

    console.groupEnd();
  }

  console.groupEnd();
}

export function buildApsDiagnostic(
  properties = []
) {
  const safeProperties =
    Array.isArray(properties)
      ? properties
      : [];

  const diagnosticObjects =
    safeProperties.map(
      createDiagnosticObject
    );

  const grouped =
    groupByType(
      diagnosticObjects
    );

  const summary =
    Object.entries(grouped).reduce(
      (
        result,
        [type, objects]
      ) => {
        result[type] =
          createTypeSummary(
            objects
          );

        return result;
      },
      {}
    );

  const report = {
    generatedAt:
      new Date().toISOString(),

    totalObjects:
      diagnosticObjects.length,

    totalClassified:
      diagnosticObjects.filter(
        (object) =>
          object.classification
            .objectType !==
          "unknown"
      ).length,

    summary,

    objects:
      diagnosticObjects,

    wallsWithoutArea:
      diagnosticObjects.filter(
        (object) =>
          object.classification
            .isWall &&
          object.area <= 0
      ),

    wallsWithCalculatedArea:
      diagnosticObjects.filter(
        (object) =>
          object.classification
            .isWall &&
          object.areaSource ===
            "length-x-height"
      ),
  };

  printDiagnosticReport(report);

  return report;
}

export function applyDiagnosticFallbacks(
  properties = []
) {
  const report =
    buildApsDiagnostic(properties);

  return report.objects.map(
    (diagnosticObject) => ({
      ...properties.find(
        (property) =>
          property?.dbId ===
          diagnosticObject.dbId
      ),

      area:
        diagnosticObject.area,

      volume:
        diagnosticObject.volume,

      areaSource:
        diagnosticObject.areaSource,

      volumeSource:
        diagnosticObject.volumeSource,
    })
  );
}