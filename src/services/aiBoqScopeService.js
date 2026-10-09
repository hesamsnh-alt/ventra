import "server-only";

import { createResponse } from "@/services/openaiClient";

const MODEL =
  process.env.OPENAI_BOQ_MODEL ||
  process.env.OPENAI_DRAWING_MODEL ||
  "gpt-5";

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function compactRoom(room) {
  const bbox =
    room?.regionBBox &&
    typeof room.regionBBox ===
      "object" &&
    Number.isFinite(
      Number(
        room.regionBBox.x
      )
    ) &&
    Number.isFinite(
      Number(
        room.regionBBox.y
      )
    ) &&
    Number.isFinite(
      Number(
        room.regionBBox.width
      )
    ) &&
    Number.isFinite(
      Number(
        room.regionBBox.height
      )
    ) &&
    Number(
      room.regionBBox.width
    ) > 0 &&
    Number(
      room.regionBBox.height
    ) > 0
      ? {
          x:
            Number(
              room.regionBBox.x
            ),
          y:
            Number(
              room.regionBBox.y
            ),
          width:
            Number(
              room.regionBBox.width
            ),
          height:
            Number(
              room.regionBBox.height
            ),
        }
      : null;

  const rawCentroidX =
    room?.centroid?.x;
  const rawCentroidY =
    room?.centroid?.y;

  const directX =
    rawCentroidX !== null &&
    rawCentroidX !== undefined &&
    rawCentroidX !== "" &&
    Number.isFinite(
      Number(rawCentroidX)
    )
      ? Number(rawCentroidX)
      : null;

  const directY =
    rawCentroidY !== null &&
    rawCentroidY !== undefined &&
    rawCentroidY !== "" &&
    Number.isFinite(
      Number(rawCentroidY)
    )
      ? Number(rawCentroidY)
      : null;

  const centroid =
    directX !== null &&
    directY !== null
      ? {
          x: directX,
          y: directY,
          coordinateSystem:
            room?.centroid
              ?.coordinateSystem ||
            "viewer_sheet_normalized",
          source:
            room?.centroid?.source ||
            "semantic_room",
        }
      : bbox
        ? {
            x:
              bbox.x +
              bbox.width / 2,
            y:
              bbox.y +
              bbox.height / 2,
            coordinateSystem:
              "viewer_sheet_normalized",
            source:
              "region_bbox_center",
          }
        : null;

  return {
    name:
      String(
        room?.name ||
        room?.label ||
        "Room"
      ),
    type:
      String(
        room?.roomType ||
        room?.detectedType ||
        room?.type ||
        "room"
      ),
    area:
      Number(room?.area) ||
      0,
    perimeter:
      Number(
        room?.perimeter
      ) || 0,
    confidence:
      Number(
        room
          ?.roomTypeConfidence
      ) ||
      Number(
        room?.confidence
      ) ||
      0,
    centroid,
    regionBBox:
      bbox,
    planId:
      room?.planId ||
      null,
    planTitle:
      room?.planTitle ||
      null,
    spatialSource:
      room?.source ||
      null,
    geometrySource:
      room?.geometrySource ||
      null,
    geometryPolygonId:
      room?.geometryPolygonId ||
      null,
    areaEstimated:
      room?.areaEstimated ===
      true,
    perimeterEstimated:
      room
        ?.perimeterEstimated ===
      true,
  };
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
}

const scopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scopes", "catalog_search_terms"],
  properties: {
    scopes: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "room_type",
          "trade",
          "work",
          "quantity_basis",
          "reason",
        ],
        properties: {
          room_type: { type: "string" },
          trade: { type: "string" },
          work: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review",
            ],
          },
          reason: { type: "string" },
        },
      },
    },
    catalog_search_terms: {
      type: "array",
      maxItems: 100,
      items: { type: "string" },
    },
  },
};

const matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "item_code",
          "quantity_basis",
          "room_type",
          "reason",
        ],
        properties: {
          item_code: { type: "string" },
          quantity_basis: {
            type: "string",
            enum: [
              "floor_area",
              "ceiling_area",
              "net_wall_area",
              "door_count",
              "window_count",
              "electrical_items",
              "room_count",
              "room_type_count",
              "room_type_floor_area",
              "room_type_perimeter",
              "manual_review",
            ],
          },
          room_type: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

function responseJson(response) {
  const text =
    response?.output_text ||
    response?.output
      ?.flatMap((item) => item?.content || [])
      ?.find((item) => item?.type === "output_text")
      ?.text;

  if (!text) {
    throw new Error("AI BOQ scope engine returned no JSON.");
  }

  return JSON.parse(text);
}

export function getSemanticRooms(rawTakeoff) {
  const rooms =
    rawTakeoff?.object_details?.rooms;

  return Array.isArray(rooms)
    ? rooms.map(compactRoom)
    : [];
}

export function hydrateSemanticRoomQuantities(
  rooms,
  takeoff
) {
  const list =
    Array.isArray(rooms)
      ? rooms.map(
          (room) => {
            const rawX =
              room?.centroid?.x;
            const rawY =
              room?.centroid?.y;

            const x =
              rawX !== null &&
              rawX !== undefined &&
              rawX !== "" &&
              Number.isFinite(
                Number(rawX)
              )
                ? Number(rawX)
                : null;

            const y =
              rawY !== null &&
              rawY !== undefined &&
              rawY !== "" &&
              Number.isFinite(
                Number(rawY)
              )
                ? Number(rawY)
                : null;

            return {
              ...room,
              centroid:
                x !== null &&
                y !== null
                  ? {
                      ...room.centroid,
                      x,
                      y,
                    }
                  : null,
            };
          }
        )
      : [];

  const floorArea =
    Number(takeoff?.floor_area) || 0;

  if (
    list.length === 0 ||
    floorArea <= 0
  ) {
    return {
      rooms: list,
      applied: false,
      source: "unavailable",
    };
  }

  const alreadyMeasured =
    list.every(
      (room) =>
        Number(room?.area) > 0
    );

  if (alreadyMeasured) {
    return {
      rooms: list,
      applied: false,
      source: "existing_room_quantities",
    };
  }

  const hasCentroids =
    list.every(
      (room) =>
        Number.isFinite(
          Number(
            room?.centroid?.x
          )
        ) &&
        Number.isFinite(
          Number(
            room?.centroid?.y
          )
        )
    );

  if (!hasCentroids) {
    // Conservative last fallback: equal distribution of the authoritative
    // Autodesk floor area. This is explicitly marked estimated.
    const equalArea =
      floorArea / list.length;

    return {
      rooms: list.map((room) => ({
        ...room,
        area:
          Number(
            equalArea.toFixed(2)
          ),
        perimeter:
          Number(
            (
              4 *
              Math.sqrt(equalArea)
            ).toFixed(2)
          ),
        areaEstimated: true,
        perimeterEstimated: true,
        quantitySource:
          "equal_distribution_of_autodesk_floor_area",
      })),
      applied: true,
      source:
        "equal_distribution_of_autodesk_floor_area",
    };
  }

  // Voronoi-style distribution from semantic room-label centroids.
  // The total is never invented: it is normalized to Autodesk floor_area.
  const gridSize = 140;
  const counts =
    new Array(list.length).fill(0);

  for (
    let gy = 0;
    gy < gridSize;
    gy += 1
  ) {
    const y =
      (gy + 0.5) /
      gridSize;

    for (
      let gx = 0;
      gx < gridSize;
      gx += 1
    ) {
      const x =
        (gx + 0.5) /
        gridSize;

      let bestIndex = 0;
      let bestDistance =
        Infinity;

      for (
        let index = 0;
        index < list.length;
        index += 1
      ) {
        const dx =
          x -
          Number(
            list[index].centroid.x
          );

        const dy =
          y -
          Number(
            list[index].centroid.y
          );

        const distance =
          dx * dx +
          dy * dy;

        if (
          distance <
          bestDistance
        ) {
          bestDistance =
            distance;
          bestIndex =
            index;
        }
      }

      counts[bestIndex] += 1;
    }
  }

  const totalCells =
    gridSize * gridSize;

  let assigned = 0;

  const hydrated =
    list.map(
      (room, index) => {
        let area;

        if (
          index ===
          list.length - 1
        ) {
          area =
            floorArea -
            assigned;
        } else {
          area =
            floorArea *
            (
              counts[index] /
              totalCells
            );

          assigned += area;
        }

        area =
          Math.max(
            0,
            area
          );

        return {
          ...room,
          area:
            Number(
              area.toFixed(2)
            ),
          perimeter:
            Number(
              (
                4 *
                Math.sqrt(area)
              ).toFixed(2)
            ),
          areaEstimated: true,
          perimeterEstimated: true,
          quantitySource:
            "semantic_centroid_voronoi_scaled_to_autodesk_floor_area",
        };
      }
    );

  return {
    rooms: hydrated,
    applied: true,
    source:
      "semantic_centroid_voronoi_scaled_to_autodesk_floor_area",
  };
}


export async function inferConstructionScopes({
  rooms,
  takeoff,
}) {
  if (!rooms.length) {
    return {
      scopes: [],
      catalog_search_terms: [],
    };
  }

  const response = await createResponse({
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are Ventra's construction scope planner. Read semantic room labels detected from the drawing and decide which normal construction work scopes apply to each room type. Do not invent dimensions, quantities, room names, or products. Do not price anything. Examples: a kitchen can require suitable floor finish, wall finish/backsplash, ceiling finish, plumbing fixtures/points, cabinetry and electrical work; a bathroom can require waterproofing, floor/wall finishes, sanitary/plumbing, ceiling, exhaust and electrical work; bedrooms/living rooms typically require plaster/paint/ceiling/floor/skirting/electrical as applicable. Treat these as reasoning examples, not hard-coded rules. quantity_basis must describe how a downstream deterministic quantity engine could measure the work. Use manual_review when the drawing/takeoff does not contain enough measurable evidence.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              detected_rooms: rooms,
              measured_takeoff: {
                rooms: takeoff.rooms,
                floor_area: takeoff.floor_area,
                ceiling_area: takeoff.ceiling_area,
                wall_area: takeoff.wall_area,
                wall_length: takeoff.wall_length,
                opening_area: takeoff.opening_area,
                doors: takeoff.doors,
                windows: takeoff.windows,
                electrical_items: takeoff.electrical_items,
              },
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_room_scope_plan",
        strict: true,
        schema: scopeSchema,
      },
    },
  });

  return responseJson(response);
}

export function shortlistPriceCatalog(
  prices,
  searchTerms,
  limit = 500
) {
  const terms = uniqueStrings(searchTerms)
    .flatMap((value) => {
      const normalized = normalizeText(value);
      const words = normalized
        .split(/[^a-z0-9]+/i)
        .filter((word) => word.length >= 4);
      return [normalized, ...words];
    })
    .filter((term) => term.length >= 3);

  if (!terms.length) {
    return [];
  }

  const scored = prices
    .map((item) => {
      const haystack = normalizeText(
        [
          item.item_code,
          item.description,
          item.category,
          item.sub_category,
          item.unit,
        ].join(" ")
      );

      let score = 0;

      for (const term of terms) {
        if (haystack.includes(term)) {
          score +=
            term.includes(" ")
              ? 4
              : 1;
        }
      }

      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, limit)
    .map(({ item }) => ({
      item_code: item.item_code,
      description: item.description,
      category: item.category,
      sub_category: item.sub_category,
      unit: item.unit,
    }));
}

export async function matchScopesToCatalog({
  scopes,
  candidates,
}) {
  if (!scopes.length || !candidates.length) {
    return { matches: [] };
  }

  const response = await createResponse({
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Match Ventra construction scopes to the supplied UAE price catalog. You may ONLY return item_code values that exist in catalog_candidates. Match by actual construction meaning and compatible unit/quantity basis. Never invent an item code. Do not match an m2 scope to an item/lm/m3 price unless the basis is genuinely compatible. Prefer no match over a wrong match. Avoid duplicate item codes unless they apply to genuinely different room-specific measured quantities.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              scopes,
              catalog_candidates: candidates,
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ventra_scope_catalog_matches",
        strict: true,
        schema: matchSchema,
      },
    },
  });

  return responseJson(response);
}

function countRoomsByType(rooms, roomType) {
  const target = normalizeText(roomType);

  return rooms.filter(
    (room) =>
      normalizeText(room.type) === target
  ).length;
}

function sumRoomMetric(rooms, roomType, field) {
  const target = normalizeText(roomType);

  return rooms.reduce((sum, room) => {
    if (normalizeText(room.type) !== target) {
      return sum;
    }

    return sum + (Number(room[field]) || 0);
  }, 0);
}

export function resolveAiQuantity({
  match,
  rooms,
  takeoff,
}) {
  const basis =
    match.quantity_basis;

  const roomType =
    normalizeText(
      match.room_type
    );

  const isRoomSpecific =
    Boolean(roomType) &&
    ![
      "all",
      "all_rooms",
      "building",
      "general",
      "project",
      "whole_building",
      "whole project",
    ].includes(roomType);

  const roomTypeCount =
    isRoomSpecific
      ? countRoomsByType(
          rooms,
          roomType
        )
      : 0;

  const roomTypeFloorArea =
    isRoomSpecific
      ? sumRoomMetric(
          rooms,
          roomType,
          "area"
        )
      : 0;

  const roomTypePerimeter =
    isRoomSpecific
      ? sumRoomMetric(
          rooms,
          roomType,
          "perimeter"
        )
      : 0;

  const totalRoomPerimeter =
    rooms.reduce(
      (sum, room) =>
        sum +
        (Number(
          room?.perimeter
        ) || 0),
      0
    );

  const buildingNetWallArea =
    Math.max(
      0,
      (Number(
        takeoff.wall_area
      ) || 0) -
        (Number(
          takeoff.opening_area
        ) || 0)
    );

  // ROOM-SPECIFIC:
  // Use room-local measured/estimated data where it exists.
  // When allocating wall area, distribute the authoritative building
  // net wall area by the room's share of total semantic-room perimeter.
  // No wall height or extra total area is invented.
  if (isRoomSpecific) {
    switch (basis) {
      case "room_type_count":
      case "room_count":
        return roomTypeCount;

      case "room_type_floor_area":
      case "floor_area":
      case "ceiling_area":
        return roomTypeFloorArea;

      case "room_type_perimeter":
        return roomTypePerimeter;

      case "net_wall_area":
        if (
          roomTypePerimeter > 0 &&
          totalRoomPerimeter > 0 &&
          buildingNetWallArea > 0
        ) {
          return (
            buildingNetWallArea *
            (
              roomTypePerimeter /
              totalRoomPerimeter
            )
          );
        }

        return 0;

      case "door_count":
      case "window_count":
      case "electrical_items":
      case "manual_review":
      default:
        return 0;
    }
  }

  // BUILDING-WIDE:
  switch (basis) {
    case "floor_area":
      return Number(
        takeoff.floor_area
      ) || 0;

    case "ceiling_area":
      return Number(
        takeoff.ceiling_area
      ) || 0;

    case "net_wall_area":
      return buildingNetWallArea;

    case "door_count":
      return Number(
        takeoff.doors
      ) || 0;

    case "window_count":
      return Number(
        takeoff.windows
      ) || 0;

    case "electrical_items":
      return Number(
        takeoff.electrical_items
      ) || 0;

    case "room_count":
      return (
        Number(
          takeoff.rooms
        ) ||
        rooms.length ||
        0
      );

    case "room_type_count":
    case "room_type_floor_area":
    case "room_type_perimeter":
    case "manual_review":
    default:
      return 0;
  }
}
