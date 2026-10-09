function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function objectValues(input) {
  return input && typeof input === "object" ? input : {};
}

function collectTakeoffSources(input) {
  const sources = [];
  const queue = [input];
  const seen = new Set();
  const nestedKeys = [
    "raw_result",
    "takeoff",
    "result",
    "advanced_takeoff",
    "quantities",
    "summary",
    "geometry",
  ];

  while (queue.length > 0 && sources.length < 24) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    sources.push(current);

    for (const key of nestedKeys) {
      const nested = current[key];
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }

  return sources;
}

function firstPositive(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = toNumber(source?.[key]);
      if (value > 0) return value;
    }
  }
  return 0;
}

function firstValue(sources, keys, fallback = null) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return fallback;
}

function countDetected(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (Array.isArray(value) && value.length > 0) return value.length;
      const number = toNumber(value);
      if (number > 0) return number;
    }
  }
  return 0;
}

function firstArray(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      if (Array.isArray(source?.[key]) && source[key].length > 0) return source[key];
    }
  }
  return [];
}

function getOpeningArea(opening) {
  const direct = toNumber(opening?.area ?? opening?.area_m2 ?? opening?.areaM2);
  if (direct > 0) return direct;
  const width = toNumber(opening?.width_m ?? opening?.widthM ?? opening?.width);
  const height = toNumber(opening?.height_m ?? opening?.heightM ?? opening?.height);
  return width > 0 && height > 0 ? width * height : 0;
}

function getOpeningMetrics(sources, type) {
  const singular = type === "door" ? "door" : "window";
  const plural = `${singular}s`;
  const details = firstArray(sources, [plural, `${singular}_details`, `${singular}Details`]);
  const count = details.length || countDetected(sources, [plural, `${singular}_count`, `${singular}Count`]);
  const explicitArea = firstPositive(sources, [`${singular}_area`, `${singular}Area`, `total_${singular}_area`, `total${singular[0].toUpperCase()}${singular.slice(1)}Area`]);
  const derivedArea = details.reduce((sum, opening) => sum + getOpeningArea(opening), 0);
  return { count, area: explicitArea || derivedArea };
}

function getRoomDetails(sources) {
  for (const source of sources) {
    const rooms = source?.object_details?.rooms;
    if (Array.isArray(rooms) && rooms.length > 0) return rooms;
    if (Array.isArray(source?.rooms) && source.rooms.length > 0) return source.rooms;
  }
  return [];
}

function getRoomPerimeter(sources) {
  return getRoomDetails(sources).reduce(
    (sum, room) => sum + toNumber(room?.perimeter ?? room?.perimeter_m),
    0
  );
}

function createItem({
  itemNumber,
  section,
  description,
  unit,
  quantity,
  rate,
  source,
  confidence,
  notes = "",
}) {
  return {
    itemNumber,
    section,
    description,
    unit,
    quantity: round(quantity),
    rate: round(rate),
    amount: round(toNumber(quantity) * toNumber(rate)),
    source,
    confidence: toNumber(confidence),
    notes,
  };
}

const DEFAULT_RATES = {
  floorFinish: 95,
  ceilingFinish: 25,
  wallFinish: 22,
  skirting: 18,
  door: 1200,
  window: 650,
  slabConcrete: 350,
};

export function buildLocalBoq({
  takeoff: inputTakeoff,
  projectName = "Untitled Project",
  vatPercentage = 5,
}) {
  const sources = collectTakeoffSources(objectValues(inputTakeoff));
  const items = [];
  const warnings = [];
  let assumptions = [];

  const confidence = firstPositive(sources, ["confidence", "floor_area_confidence"]) || 60;
  const floorArea = firstPositive(sources, [
    "floor_area",
    "floorArea",
    "room_area",
    "roomArea",
    "total_floor_area",
    "totalFloorArea",
  ]);
  const ceilingArea = firstPositive(sources, ["ceiling_area", "ceilingArea"]) || floorArea;
  const wallArea = firstPositive(sources, ["wall_area", "wallArea", "total_wall_area", "totalWallArea"]);
  const wallLength = firstPositive(sources, ["wall_length", "wallLength", "total_wall_length", "totalWallLength"]);
  const roomPerimeter = getRoomPerimeter(sources);
  const doorMetrics = getOpeningMetrics(sources, "door");
  const windowMetrics = getOpeningMetrics(sources, "window");
  const doors = doorMetrics.count;
  const windows = windowMetrics.count;
  const totalOpeningArea = doorMetrics.area + windowMetrics.area;
  const netWallArea = wallArea > 0 && totalOpeningArea > 0
    ? Math.max(0, wallArea - totalOpeningArea)
    : wallArea;
  assumptions = [
    "Rates are editable starter budget rates in AED and must be reviewed before quotation or contract use.",
    totalOpeningArea > 0
      ? `Wall finishes use net wall area after deducting ${round(totalOpeningArea)} m² of measured openings.`
      : "Wall finishes use gross wall area because opening dimensions are unavailable.",
  ];
  const slabVolume = firstPositive(sources, ["slab_volume", "slabVolume"]);
  const skirtingLength = Math.max(0, roomPerimeter || wallLength || 0);
  const floorSource = firstValue(sources, ["floor_area_source", "floorAreaSource"], "quantity_takeoff");
  const wallAreaEstimated = Boolean(firstValue(sources, ["wall_area_estimated", "wallAreaEstimated"], false));

  if (floorArea > 0) {
    items.push(createItem({
      itemNumber: "08.01",
      section: "Finishes",
      description: "Floor finish allowance",
      unit: "m²",
      quantity: floorArea,
      rate: DEFAULT_RATES.floorFinish,
      source: floorSource,
      confidence,
      notes: "Replace the allowance description and rate with the selected floor material.",
    }));
  }

  if (ceilingArea > 0) {
    items.push(createItem({
      itemNumber: "08.02",
      section: "Finishes",
      description: "Ceiling finish / paint allowance",
      unit: "m²",
      quantity: ceilingArea,
      rate: DEFAULT_RATES.ceilingFinish,
      source: ceilingArea !== floorArea ? "quantity_takeoff" : "derived_from_floor_area",
      confidence: ceilingArea !== floorArea ? confidence : Math.min(confidence, 70),
    }));
  }

  if (wallArea > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Internal cement sand plaster to walls",
      unit: "m²",
      quantity: netWallArea,
      rate: 27,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable.",
    }));
    items.push(createItem({
      itemNumber: "09.01",
      section: "Painting",
      description: "Internal wall emulsion paint including primer and finishing coats",
      unit: "m²",
      quantity: netWallArea,
      rate: DEFAULT_RATES.wallFinish,
      source: wallAreaEstimated ? "estimated_from_wall_length" : "quantity_takeoff",
      confidence: wallAreaEstimated ? Math.min(confidence, 68) : confidence,
      notes: totalOpeningArea > 0 ? "Opening areas deducted." : "Gross wall area used; opening dimensions unavailable.",
    }));
  } else if (wallLength > 0) {
    warnings.push("Wall area is unavailable, so wall paint was not added. Confirm wall height and regenerate the takeoff.");
  }

  if (skirtingLength > 0) {
    items.push(createItem({
      itemNumber: "08.03",
      section: "Finishes",
      description: "Skirting allowance",
      unit: "m",
      quantity: skirtingLength,
      rate: DEFAULT_RATES.skirting,
      source: roomPerimeter > 0 ? "room_perimeter" : "wall_length",
      confidence: roomPerimeter > 0 ? confidence : Math.min(confidence, 70),
      notes: "Door widths have not been deducted because opening widths are not available.",
    }));
  }

  if (doors > 0) {
    items.push(createItem({
      itemNumber: "07.01",
      section: "Doors & Windows",
      description: "Door set allowance",
      unit: "nos",
      quantity: doors,
      rate: DEFAULT_RATES.door,
      source: "quantity_takeoff",
      confidence,
    }));
  }

  if (windows > 0 || windowMetrics.area > 0) {
    const measuredByArea = windowMetrics.area > 0;
    items.push(createItem({
      itemNumber: "07.02",
      section: "Doors & Windows",
      description: measuredByArea
        ? "Aluminium framed glazed windows measured by area"
        : "Aluminium framed glazed window set allowance",
      unit: measuredByArea ? "m²" : "nos",
      quantity: measuredByArea ? windowMetrics.area : windows,
      rate: measuredByArea ? 750 : DEFAULT_RATES.window,
      source: measuredByArea ? "measured_opening_area" : "quantity_takeoff_count",
      confidence,
      notes: measuredByArea ? "Quantity is total detected window area." : "Dimensions unavailable; priced per detected window.",
    }));
  }

  if (slabVolume > 0) {
    items.push(createItem({
      itemNumber: "03.01",
      section: "Concrete",
      description: "Concrete slab allowance",
      unit: "m³",
      quantity: slabVolume,
      rate: DEFAULT_RATES.slabConcrete,
      source: "quantity_takeoff",
      confidence,
    }));
  }

  if (items.length === 0) {
    warnings.push("No measurable floor, wall, opening, or slab quantities were found in the latest takeoff.");
  }

  const subtotal = round(items.reduce((sum, item) => sum + item.amount, 0));
  const vat = round(subtotal * (toNumber(vatPercentage) / 100));

  return {
    projectName,
    currency: "AED",
    vatPercentage: toNumber(vatPercentage),
    items,
    warnings,
    assumptions,
    summary: { subtotal, vat, grandTotal: round(subtotal + vat) },
    generatedBy: "Ventra deterministic BOQ fallback",
    generatedAt: new Date().toISOString(),
  };
}
