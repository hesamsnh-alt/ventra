import {planPdfCatalogRules, resolvePdfCatalogRate, retainUnboundPdfQuantities} from '@/lib/pdfBoqCoverage.mjs';
import {annotatePdfBoqCompletion} from '@/lib/pdfBoqCompletion.mjs';
import {mergePdfEvidence} from '@/lib/pdfTakeoffEvidence.mjs';
import { classifyEstimateItem } from '@/lib/estimateClassification.mjs';
import {applyDwgScheduleToBoq} from "@/lib/dwgSchedule.mjs";
import {getDrawingEvidence} from "@/lib/drawingEvidence.mjs";
import { requireBoqReview } from "@/lib/boqEvidence.mjs";
import {commercialRun} from '@/lib/serverCommercial';
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildLocalBoq } from "@/services/localBoqBuilder";
import {
  getSemanticRooms,
  hydrateSemanticRoomQuantities,
  inferConstructionScopes,
  shortlistPriceCatalog,
  matchScopesToCatalog,
  resolveAiQuantity,
} from "@/services/aiBoqScopeService";


function createServerSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local."
    );
  }

  return createClient(url, key, {
    db: {
      schema: "public",
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;

  return (
    Math.round(
      (toNumber(value) + Number.EPSILON) *
        factor
    ) / factor
  );
}

function normalizeCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeTakeoff(rawTakeoff) {
  const takeoff = rawTakeoff?.pdf_analysis && rawTakeoff?.page_results?.length
    ? {...rawTakeoff,...mergePdfEvidence(rawTakeoff.page_results,rawTakeoff.failed_pages||[],rawTakeoff.total_pages)}
    : rawTakeoff || {};

  const doors = toNumber(
    takeoff.doors ??
      takeoff.door_count ??
      takeoff.doorCount
  );

  const windows = toNumber(
    takeoff.windows ??
      takeoff.window_count ??
      takeoff.windowCount
  );

  const measuredDoorArea = toNumber(
    takeoff.door_area ??
      takeoff.doorArea
  );

  const measuredWindowArea = toNumber(
    takeoff.window_area ??
      takeoff.windowArea
  );

  const measuredOpeningArea = toNumber(
    takeoff.opening_area ??
      takeoff.openingArea
  );

  // When APS/schedules provide authoritative counts but no opening
  // dimensions, use explicit estimating assumptions instead of silently
  // treating gross wall area as net finish area.
  // Door: 0.90 m × 2.10 m = 1.89 m²
  // Window: 1.20 m × 1.20 m = 1.44 m²
  const estimatedDoorArea =
    measuredDoorArea > 0
      ? measuredDoorArea
      : !takeoff.pdf_analysis && doors > 0
        ? doors * 1.89
        : 0;

  const estimatedWindowArea =
    measuredWindowArea > 0
      ? measuredWindowArea
      : !takeoff.pdf_analysis && windows > 0
        ? windows * 1.44
        : 0;

  const resolvedOpeningArea =
    measuredOpeningArea > 0
      ? measuredOpeningArea
      : estimatedDoorArea +
        estimatedWindowArea;

  return {
    pdf_analysis:takeoff.pdf_analysis||(/pdf/i.test(takeoff.document_type||'')||/\.pdf$/i.test(takeoff.document_name||'')?{version:0,requiresReanalysis:true,quantity_evidence:{}}:null),
    scheduled_quantities:takeoff.scheduled_quantities||{},
    page_results:takeoff.pdf_analysis&&Array.isArray(takeoff.page_results)?takeoff.page_results:[],
    rooms: toNumber(
      takeoff.rooms ??
        takeoff.room_count ??
        takeoff.roomCount
    ),

    doors,

    windows,

    walls: toNumber(takeoff.walls),
    floors: toNumber(takeoff.floors),
    slabs: toNumber(takeoff.slabs),
    ceilings: toNumber(takeoff.ceilings),
    columns: toNumber(takeoff.columns),
    beams: toNumber(takeoff.beams),
    foundations: toNumber(takeoff.foundations),
    stairs: toNumber(takeoff.stairs),
    ramps: toNumber(takeoff.ramps),
    roofs: toNumber(takeoff.roofs),
    pipes: toNumber(takeoff.pipes),
    ducts: toNumber(takeoff.ducts),
    electrical_items: toNumber(
      takeoff.electrical_items ??
        takeoff.electricalItems
    ),
    lighting_points: toNumber(takeoff.lighting_points ?? takeoff.lightingPoints),
    socket_points: toNumber(takeoff.socket_points ?? takeoff.socketPoints),
    switches: toNumber(takeoff.switches),
    distribution_boards: toNumber(takeoff.distribution_boards ?? takeoff.distributionBoards),
    other_electrical: toNumber(takeoff.other_electrical ?? takeoff.otherElectrical),

    wall_length: toNumber(
      takeoff.wall_length ??
        takeoff.wallLength
    ),

    wall_area: toNumber(
      takeoff.wall_area ??
        takeoff.wallArea
    ),

    wall_volume: toNumber(
      takeoff.wall_volume ??
        takeoff.wallVolume
    ),

    room_area: toNumber(
      takeoff.room_area ??
        takeoff.roomArea
    ),

    floor_area: toNumber(
      takeoff.floor_area ??
        takeoff.floorArea ??
        takeoff.slab_area ??
        takeoff.slabArea
    ),

    wet_floor_area: toNumber(takeoff.wet_floor_area ?? takeoff.wetFloorArea),
    wet_room_perimeter: toNumber(takeoff.wet_room_perimeter ?? takeoff.wetRoomPerimeter),
    bathroom_floor_area: toNumber(takeoff.bathroom_floor_area ?? takeoff.bathroomFloorArea),
    bathroom_perimeter: toNumber(takeoff.bathroom_perimeter ?? takeoff.bathroomPerimeter),
    toilet_floor_area: toNumber(takeoff.toilet_floor_area ?? takeoff.toiletFloorArea),
    toilet_perimeter: toNumber(takeoff.toilet_perimeter ?? takeoff.toiletPerimeter),
    kitchen_floor_area: toNumber(takeoff.kitchen_floor_area ?? takeoff.kitchenFloorArea),
    kitchen_perimeter: toNumber(takeoff.kitchen_perimeter ?? takeoff.kitchenPerimeter),
    laundry_floor_area: toNumber(takeoff.laundry_floor_area ?? takeoff.laundryFloorArea),
    laundry_perimeter: toNumber(takeoff.laundry_perimeter ?? takeoff.laundryPerimeter),
    balcony_floor_area: toNumber(takeoff.balcony_floor_area ?? takeoff.balconyFloorArea),
    balcony_perimeter: toNumber(takeoff.balcony_perimeter ?? takeoff.balconyPerimeter),

    slab_area: toNumber(
      takeoff.slab_area ??
        takeoff.slabArea
    ),

    slab_volume: toNumber(
      takeoff.slab_volume ??
        takeoff.slabVolume
    ),

    ceiling_area: toNumber(
      takeoff.ceiling_area ??
        takeoff.ceilingArea ??
        takeoff.floor_area ??
        takeoff.floorArea
    ),

    column_volume: toNumber(
      takeoff.column_volume ??
        takeoff.columnVolume
    ),

    beam_volume: toNumber(
      takeoff.beam_volume ??
        takeoff.beamVolume
    ),

    foundation_volume: toNumber(
      takeoff.foundation_volume ??
        takeoff.foundationVolume
    ),

    column_formwork_area:
      toNumber(
        takeoff.column_formwork_area ??
        takeoff.columnFormworkArea
      ),

    beam_formwork_area:
      toNumber(
        takeoff.beam_formwork_area ??
        takeoff.beamFormworkArea
      ),

    foundation_formwork_area:
      toNumber(
        takeoff.foundation_formwork_area ??
        takeoff.foundationFormworkArea
      ),

    slab_formwork_area:
      toNumber(
        takeoff.slab_formwork_area ??
        takeoff.slabFormworkArea
      ),

    structural_measurement_status:
      takeoff.structural_measurement_status &&
      typeof takeoff.structural_measurement_status === "object"
        ? takeoff.structural_measurement_status
        : null,

    roof_area: toNumber(
      takeoff.roof_area ??
        takeoff.roofArea
    ),

    pipe_length: toNumber(
      takeoff.pipe_length ??
        takeoff.pipeLength
    ),

    duct_length: toNumber(
      takeoff.duct_length ??
        takeoff.ductLength
    ),

    opening_area: round(
      resolvedOpeningArea,
      2
    ),

    door_area: round(
      estimatedDoorArea,
      2
    ),

    window_area: round(
      measuredWindowArea,
      2
    ),

    opening_area_estimated:
      measuredOpeningArea <= 0 &&
      (measuredDoorArea <= 0 ||
        measuredWindowArea <= 0) &&
      resolvedOpeningArea > 0,

    opening_area_source:
      measuredOpeningArea > 0
        ? "takeoff_measured"
        : resolvedOpeningArea > 0
          ? "verified_counts_with_standard_dimensions"
          : "unavailable",

    confidence: toNumber(
      takeoff.confidence
    ),

    notes: String(
      takeoff.notes || ""
    ),
  };
}

function getGeometryValue(
  rule,
  takeoff
) {
  const geometryType = String(
    rule.geometry_type || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const property = String(
    rule.geometry_property || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    geometryType === "room" &&
    ["", "count", "room_count", "rooms"].includes(property)
  ) {
    return takeoff.rooms;
  }

  if (
    geometryType === "door" &&
    ["", "count", "door_count", "doors"].includes(property)
  ) {
    return takeoff.doors;
  }

  if (
    geometryType === "window" &&
    ["", "count", "window_count", "windows"].includes(property)
  ) {
    return takeoff.windows;
  }

  if (
    geometryType === "wall" &&
    ["area", "wall_area"].includes(property)
  ) {
    return takeoff.wall_area;
  }

  if (
    geometryType === "wall" &&
    ["length", "wall_length", "perimeter"].includes(property)
  ) {
    return takeoff.wall_length;
  }

  if (
    ["floor", "slab"].includes(geometryType) &&
    ["", "area", "floor_area", "slab_area"].includes(property)
  ) {
    return takeoff.floor_area;
  }

  if (
    geometryType === "ceiling" &&
    ["", "area", "ceiling_area"].includes(property)
  ) {
    return takeoff.ceiling_area;
  }

  if (
    property === "room_count" ||
    property === "rooms"
  ) {
    return takeoff.rooms;
  }

  if (
    property === "door_count" ||
    property === "doors"
  ) {
    return takeoff.doors;
  }

  if (
    property === "window_count" ||
    property === "windows"
  ) {
    return takeoff.windows;
  }

  if (
    property === "window_area"
  ) {
    return (
      takeoff.window_area || 0
    );
  }

  if (
    property === "door_area"
  ) {
    return (
      takeoff.door_area ||
      takeoff.doors
    );
  }

  if (
    property === "floor_area" ||
    property === "slab_area"
  ) {
    return takeoff.floor_area;
  }

  if (
    property === "ceiling_area"
  ) {
    return takeoff.ceiling_area;
  }

  if (
    property === "opening_area"
  ) {
    return takeoff.opening_area;
  }

  const countByGeometryType = {
    wall: takeoff.walls,
    floor: takeoff.floors,
    slab: takeoff.slabs,
    ceiling: takeoff.ceilings,
    column: takeoff.columns,
    beam: takeoff.beams,
    foundation: takeoff.foundations,
    stair: takeoff.stairs,
    ramp: takeoff.ramps,
    roof: takeoff.roofs,
    pipe: takeoff.pipes,
    duct: takeoff.ducts,
    electrical: takeoff.electrical_items,
  };

  if (
    Object.prototype.hasOwnProperty.call(
      countByGeometryType,
      geometryType
    ) &&
    ["", "count", `${geometryType}_count`, `${geometryType}s`].includes(property)
  ) {
    return toNumber(
      countByGeometryType[geometryType]
    );
  }

  if (geometryType === "wall" && property === "volume") {
    return takeoff.wall_volume;
  }

  if (geometryType === "slab") {
    if (["area", "slab_area"].includes(property)) {
      return takeoff.slab_area || takeoff.floor_area;
    }
    if (["volume", "slab_volume"].includes(property)) {
      return takeoff.slab_volume;
    }
  }

  if (geometryType === "column" && ["volume", "column_volume"].includes(property)) {
    return takeoff.column_volume;
  }

  if (geometryType === "beam" && ["volume", "beam_volume"].includes(property)) {
    return takeoff.beam_volume;
  }

  if (geometryType === "foundation" && ["volume", "foundation_volume"].includes(property)) {
    return takeoff.foundation_volume;
  }

  if (geometryType === "roof" && ["area", "roof_area"].includes(property)) {
    return takeoff.roof_area;
  }

  if (geometryType === "pipe" && ["length", "pipe_length"].includes(property)) {
    return takeoff.pipe_length;
  }

  if (geometryType === "duct" && ["length", "duct_length"].includes(property)) {
    return takeoff.duct_length;
  }

  if (
    geometryType === "electrical" &&
    ["", "count", "electrical_count", "electrical_items"].includes(property)
  ) {
    return takeoff.electrical_items;
  }

  if (
    property &&
    Object.prototype.hasOwnProperty.call(
      takeoff,
      property
    )
  ) {
    return toNumber(
      takeoff[property]
    );
  }

  return 0;
}

function calculateQuantity(
  rule,
  takeoff
) {
  const itemCode =
    normalizeCode(
      rule?.item_code
    );

  const measuredElectrical = {
    "ELE-001":
      toNumber(
        takeoff?.lighting_points
      ),
    "ELE-002":
      toNumber(
        takeoff?.socket_points
      ),
    "ELE-003":
      toNumber(
        takeoff?.switches
      ),
    "ELE-004":
      toNumber(
        takeoff?.distribution_boards
      ),
  };

  if (
    Object.prototype.hasOwnProperty.call(
      measuredElectrical,
      itemCode
    )
  ) {
    const measuredQuantity =
      measuredElectrical[
        itemCode
      ];

    console.log(
      "[VENTRA ELECTRICAL BOQ v26.1]",
      {
        item:
          itemCode,
        measuredQuantity,
        source:
          "takeoff_electrical_subtype_count",
      }
    );

    return round(
      measuredQuantity,
      Number.isInteger(
        rule.rounding_precision
      )
        ? rule.rounding_precision
        : 2
    );
  }

  const formulaType = String(
    rule.formula_type || "multiply"
  ).toLowerCase();

  const multiplier =
    toNumber(rule.multiplier) || 1;

  const openingMultiplier =
    toNumber(
      rule.opening_multiplier
    ) || 1;

  const baseValue =
    getGeometryValue(
      rule,
      takeoff
    );

  let quantity = 0;

  switch (formulaType) {
    case "direct":
    case "count":
    case "multiply":
      quantity =
        baseValue * multiplier;
      break;

    case "wall_net_area": {
      const openingArea =
        takeoff.opening_area ||
        takeoff.door_area +
          takeoff.window_area;

      quantity =
        Math.max(
          0,
          takeoff.wall_area -
            openingArea *
              openingMultiplier
        ) * multiplier;

      break;
    }

    case "wall_both_sides": {
      const openingArea =
        takeoff.opening_area ||
        takeoff.door_area +
          takeoff.window_area;

      quantity =
        Math.max(
          0,
          takeoff.wall_area -
            openingArea *
              openingMultiplier
        ) * multiplier;

      break;
    }

    case "perimeter":
      quantity =
        takeoff.wall_length *
        multiplier;
      break;

    case "manual":
    default:
      quantity = 0;
      break;
  }

  const minimumQuantity =
    toNumber(
      rule.minimum_quantity
    );

  if (
    quantity > 0 &&
    quantity < minimumQuantity
  ) {
    quantity = minimumQuantity;
  }

  return round(
    quantity,
    Number.isInteger(
      rule.rounding_precision
    )
      ? rule.rounding_precision
      : 2
  );
}

function directRateCandidates(
  priceItem
) {
  const componentRate =
    toNumber(
      priceItem?.material_rate
    ) +
    toNumber(
      priceItem?.labor_rate
    ) +
    toNumber(
      priceItem?.equipment_rate
    ) +
    toNumber(
      priceItem?.transport_rate
    );

  return {
    economy:
      toNumber(
        priceItem?.economy_rate
      ),
    standard:
      toNumber(
        priceItem?.standard_rate
      ),
    premium:
      toNumber(
        priceItem?.premium_rate
      ),
    component:
      componentRate,
  };
}

function chooseDirectRate(
  priceItem,
  priceLevel
) {
  const rates =
    directRateCandidates(
      priceItem
    );

  const level =
    String(
      priceLevel ||
      "standard"
    ).toLowerCase();

  const preferredOrder =
    level === "economy"
      ? [
          ["economy", rates.economy],
          ["standard", rates.standard],
          ["premium", rates.premium],
          ["component", rates.component],
        ]
      : level === "premium"
        ? [
            ["premium", rates.premium],
            ["standard", rates.standard],
            ["economy", rates.economy],
            ["component", rates.component],
          ]
        : [
            ["standard", rates.standard],
            ["economy", rates.economy],
            ["premium", rates.premium],
            ["component", rates.component],
          ];

  for (const [source, value] of preferredOrder) {
    if (
      Number(value) > 0
    ) {
      return {
        rate:
          Number(value),
        source:
          source === level
            ? `direct_${source}_rate`
            : `fallback_${source}_rate`,
      };
    }
  }

  return {
    rate: 0,
    source:
      "missing_direct_rate",
  };
}

function normalizeRateUnit(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\s+/g, "");
}

function median(
  values
) {
  const sorted =
    values
      .filter(
        (value) =>
          Number.isFinite(
            Number(value)
          ) &&
          Number(value) > 0
      )
      .map(Number)
      .sort(
        (a, b) =>
          a - b
      );

  if (
    sorted.length === 0
  ) {
    return 0;
  }

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      sorted[
        middle - 1
      ] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function resolveRate(
  priceItem,
  priceLevel,
  allPriceItems
) {
  const direct =
    chooseDirectRate(
      priceItem,
      priceLevel
    );

  if (
    direct.rate > 0
  ) {
    return {
      ...direct,
      peerCount: 0,
      missingRate: false,
    };
  }

  const unit =
    normalizeRateUnit(
      priceItem?.unit
    );

  const category =
    String(
      priceItem?.category || ""
    )
      .trim()
      .toLowerCase();

  const subCategory =
    String(
      priceItem?.sub_category || ""
    )
      .trim()
      .toLowerCase();

  const sectionCode =
    String(
      priceItem?.section_code || ""
    )
      .trim()
      .toLowerCase();

  const description =
    String(
      priceItem?.description || ""
    )
      .trim()
      .toLowerCase();

  const candidates =
    (Array.isArray(
      allPriceItems
    )
      ? allPriceItems
      : []
    )
      .filter(
        (item) =>
          item &&
          item !== priceItem &&
          normalizeRateUnit(
            item.unit
          ) === unit
      )
      .map((item) => {
        let score = 0;

        const itemCategory =
          String(
            item.category || ""
          )
            .trim()
            .toLowerCase();

        const itemSubCategory =
          String(
            item.sub_category || ""
          )
            .trim()
            .toLowerCase();

        const itemSectionCode =
          String(
            item.section_code || ""
          )
            .trim()
            .toLowerCase();

        if (
          category &&
          itemCategory ===
            category
        ) {
          score += 4;
        }

        if (
          subCategory &&
          itemSubCategory ===
            subCategory
        ) {
          score += 5;
        }

        if (
          sectionCode &&
          itemSectionCode ===
            sectionCode
        ) {
          score += 3;
        }

        const itemDescription =
          String(
            item.description || ""
          ).toLowerCase();

        const keywords =
          description
            .split(
              /[^a-z0-9]+/
            )
            .filter(
              (word) =>
                word.length >= 4
            );

        const overlap =
          keywords.filter(
            (word) =>
              itemDescription.includes(
                word
              )
          ).length;

        score += Math.min(
          overlap,
          4
        );

        const directPeer =
          chooseDirectRate(
            item,
            priceLevel
          );

        return {
          item,
          score,
          rate:
            directPeer.rate,
        };
      })
      .filter(
        (candidate) =>
          candidate.rate > 0 &&
          candidate.score >= 4
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  if (
    candidates.length > 0
  ) {
    const bestScore =
      candidates[0].score;

    const closePeers =
      candidates
        .filter(
          (candidate) =>
            candidate.score >=
            Math.max(
              4,
              bestScore - 2
            )
        )
        .slice(
          0,
          15
        );

    const peerMedian =
      median(
        closePeers.map(
          (candidate) =>
            candidate.rate
        )
      );

    if (
      peerMedian > 0
    ) {
      return {
        rate:
          peerMedian,
        source:
          "peer_database_median_rate",
        peerCount:
          closePeers.length,
        missingRate: false,
      };
    }
  }

  const pricedPeers =
    (Array.isArray(
      allPriceItems
    )
      ? allPriceItems
      : []
    )
      .filter(
        (item) =>
          item &&
          item !== priceItem &&
          normalizeRateUnit(
            item.unit
          ) === unit
      )
      .map((item) => ({
        rate:
          chooseDirectRate(
            item,
            priceLevel
          ).rate,
        category:
          String(
            item.category || ""
          )
            .trim()
            .toLowerCase(),
        subCategory:
          String(
            item.sub_category || ""
          )
            .trim()
            .toLowerCase(),
        sectionCode:
          String(
            item.section_code || ""
          )
            .trim()
            .toLowerCase(),
      }))
      .filter(
        (peer) =>
          peer.rate > 0
      );

  // Targeted database-only fallback for skirting/base items.
  // TIL-007 currently has no direct rate in the catalog, so resolve it from
  // genuinely comparable linear skirting/base items before using broader
  // section/unit medians.
  if (
    String(
      priceItem?.item_code || ""
    ).trim().toUpperCase() ===
      "TIL-007" ||
    /(tile skirting|skirting|wall base|base trim)/.test(
      description
    )
  ) {
    const skirtingPeers =
      pricedPeers.filter(
        (peer) => {
          const peerDescription =
            String(
              peer?.item?.description || ""
            ).toLowerCase();

          return (
            /(tile skirting|skirting|wall base|base trim)/.test(
              peerDescription
            ) &&
            Number(
              peer.rate
            ) > 0
          );
        }
      );

    const skirtingMedian =
      median(
        skirtingPeers.map(
          (peer) =>
            peer.rate
        )
      );

    if (
      skirtingMedian > 0
    ) {
      return {
        rate:
          skirtingMedian,
        source:
          "skirting_database_median_rate",
        peerCount:
          skirtingPeers.length,
        missingRate: false,
      };
    }

    const sectionLinearPeers =
      pricedPeers.filter(
        (peer) =>
          sectionCode &&
          peer.sectionCode ===
            sectionCode
      );

    const sectionLinearMedian =
      median(
        sectionLinearPeers.map(
          (peer) =>
            peer.rate
        )
      );

    if (
      sectionLinearMedian > 0
    ) {
      return {
        rate:
          sectionLinearMedian,
        source:
          "skirting_section_linear_median_rate",
        peerCount:
          sectionLinearPeers.length,
        missingRate: false,
      };
    }
  }

  // Final targeted fallback for TIL-007 only.
  // If the catalog has no linear skirting rate, derive it from a real priced
  // floor-tile item in the same Ventra database rather than borrowing an
  // unrelated linear item. Assumption: 100 mm high tile skirting plus
  // cutting/waste/installation allowance ~= 15% of the floor-tile m2 rate
  // per linear metre. This remains explicitly estimated/derived.
  if (
    String(
      priceItem?.item_code || ""
    ).trim().toUpperCase() ===
      "TIL-007"
  ) {
    const databaseItems =
      Array.isArray(
        allPriceItems
      )
        ? allPriceItems
        : [];

    const floorTileReference =
      databaseItems.find(
        (item) =>
          String(
            item?.item_code || ""
          ).trim().toUpperCase() ===
            "FIN-003" &&
          chooseDirectRate(
            item,
            priceLevel
          ).rate > 0
      ) ||
      databaseItems.find(
        (item) => {
          const desc =
            String(
              item?.description || ""
            ).toLowerCase();

          const peerUnit =
            normalizeRateUnit(
              item?.unit
            );

          return (
            ["m2", "sqm", "sq.m"].includes(
              peerUnit
            ) &&
            /(ceramic|porcelain).*(floor|tile)|floor.*tile/.test(
              desc
            ) &&
            chooseDirectRate(
              item,
              priceLevel
            ).rate > 0
          );
        }
      );

    if (floorTileReference) {
      const floorTileRate =
        chooseDirectRate(
          floorTileReference,
          priceLevel
        ).rate;

      const derivedRate =
        floorTileRate * 0.15;

      if (
        derivedRate > 0
      ) {
        return {
          rate:
            derivedRate,
          source:
            "derived_tile_skirting_from_floor_tile_rate",
          peerCount: 1,
          missingRate: false,
        };
      }
    }
  }

  const fallbackGroups = [
    {
      source:
        "section_subcategory_unit_median_rate",
      peers:
        pricedPeers.filter(
          (peer) =>
            sectionCode &&
            peer.sectionCode ===
              sectionCode &&
            subCategory &&
            peer.subCategory ===
              subCategory
        ),
    },
    {
      source:
        "section_category_unit_median_rate",
      peers:
        pricedPeers.filter(
          (peer) =>
            sectionCode &&
            peer.sectionCode ===
              sectionCode &&
            category &&
            peer.category ===
              category
        ),
    },
    {
      source:
        "section_unit_median_rate",
      peers:
        pricedPeers.filter(
          (peer) =>
            sectionCode &&
            peer.sectionCode ===
              sectionCode
        ),
    },
    {
      source:
        "category_unit_median_rate",
      peers:
        pricedPeers.filter(
          (peer) =>
            category &&
            peer.category ===
              category
        ),
    },
    {
      source:
        "unit_database_median_rate",
      peers:
        pricedPeers,
    },
  ];

  for (const group of fallbackGroups) {
    const values =
      group.peers
        .map(
          (peer) =>
            peer.rate
        )
        .filter(
          (rate) =>
            Number(rate) > 0
        );

    const groupMedian =
      median(values);

    if (
      groupMedian > 0
    ) {
      return {
        rate:
          groupMedian,
        source:
          group.source,
        peerCount:
          values.length,
        missingRate: false,
      };
    }
  }

  return {
    rate: 0,
    source:
      "rate_missing_in_database",
    peerCount: 0,
    missingRate: true,
  };
}

async function fetchAllActivePriceItems(
  supabase
) {
  const pageSize = 1000;
  const allItems = [];

  for (
    let from = 0;
    ;
    from += pageSize
  ) {
    const { data, error } =
      await supabase
        .from("price_items")
        .select("*")
        .eq("is_active", true)
        .order("item_code", {
          ascending: true,
        })
        .range(
          from,
          from + pageSize - 1
        );

    if (error) {
      return {
        data: null,
        error,
      };
    }

    const page = data || [];
    allItems.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return {
    data: allItems,
    error: null,
  };
}

function getMeasuredRuleFamily(
  rule,
  priceItem
) {
  const description =
    String(
      priceItem?.description || ""
    ).toLowerCase();

  const geometry =
    String(
      rule?.geometry_type || ""
    ).toLowerCase();

  const property =
    String(
      rule?.geometry_property || ""
    ).toLowerCase();

  if (
    geometry === "wall" &&
    property === "area" &&
    /block\s*wall|blockwork|block work|masonry/.test(
      description
    )
  ) {
    return "wall_blockwork";
  }

  return null;
}

function shouldSuppressDatabaseAutoRule(
  rule,
  priceItem,
  claimedFamilies
) {
  const ruleName =
    String(
      rule?.rule_name || ""
    );

  const description =
    String(
      priceItem?.description || ""
    ).toLowerCase();

  const isDatabaseAuto =
    ruleName.startsWith(
      "DB Auto:"
    );

  if (!isDatabaseAuto) {
    return false;
  }

  // Location-specific wall finishes must not consume the entire building
  // net wall area until room/external wall allocation exists.
  if (
    String(
      rule?.geometry_type || ""
    ).toLowerCase() === "wall" &&
    String(
      rule?.geometry_property || ""
    ).toLowerCase() === "area" &&
    /(external|weather resistant|weather-resistant|wall tile|wall tiling|backsplash|wet area)/.test(
      description
    )
  ) {
    return true;
  }

  const family =
    getMeasuredRuleFamily(
      rule,
      priceItem
    );

  if (
    family &&
    claimedFamilies.has(
      family
    )
  ) {
    return true;
  }

  return false;
}


function getSafeQuantityBasis(
  match,
  priceItem
) {
  const original =
    String(
      match?.quantity_basis ||
      "manual_review"
    );

  if (
    original !==
    "manual_review"
  ) {
    return original;
  }

  const roomType =
    String(
      match?.room_type || ""
    ).toLowerCase();

  const description =
    String(
      priceItem?.description || ""
    ).toLowerCase();

  const unit =
    String(
      priceItem?.unit || ""
    )
      .trim()
      .toLowerCase()
      .replace(/²/g, "2")
      .replace(/\s+/g, "");

  const isAreaUnit =
    [
      "m2",
      "sqm",
      "sq.m",
    ].includes(unit);

  const isWetRoom =
    [
      "bathroom",
      "toilet",
      "powder_room",
      "laundry",
      "kitchen",
      "pantry",
    ].includes(roomType);

  const isFloorWaterproofing =
    /(waterproof|water proof|membrane)/.test(
      description
    ) &&
    !/(wall|vertical|upstand|roof)/.test(
      description
    );

  if (
    isWetRoom &&
    isAreaUnit &&
    isFloorWaterproofing
  ) {
    return "room_type_floor_area";
  }

  return original;
}



function estimatePendingRuleQuantity(
  rule,
  priceItem,
  takeoff
) {
  const geometry =
    String(
      rule?.geometry_type || ""
    ).toLowerCase();

  const description =
    String(
      priceItem?.description || ""
    ).toLowerCase();

  const unit =
    String(
      priceItem?.unit || ""
    )
      .trim()
      .toLowerCase()
      .replace(/²/g, "2")
      .replace(/\s+/g, "");

  const floorArea =
    Number(
      takeoff?.floor_area
    ) || 0;

  const wallLength =
    Number(
      takeoff?.wall_length
    ) || 0;

  const wallArea =
    Number(
      takeoff?.wall_area
    ) || 0;

  const columns =
    Number(
      takeoff?.columns
    ) || 0;

  const stairs =
    Number(
      takeoff?.stairs
    ) || 0;

  const electricalItems =
    Number(
      takeoff?.electrical_items
    ) || 0;

  const roomCount =
    Number(
      takeoff?.rooms
    ) || 0;

  const bathrooms =
    Number(
      takeoff?.classifications
        ?.room_types
        ?.bathroom
    ) || 0;

  const kitchens =
    Number(
      takeoff?.classifications
        ?.room_types
        ?.kitchen
    ) || 0;

  const wetRooms =
    bathrooms +
    kitchens +
    (
      Number(
        takeoff?.classifications
          ?.room_types
          ?.laundry
      ) || 0
    );

  // Hard rule: only estimate from already measured project-scale quantities.
  // These are allowances, not fabricated exact takeoff values.
  if (
    geometry ===
      "preliminaries" &&
    ["item", "ls", "l.s", "sum"].includes(
      unit
    )
  ) {
    return {
      quantity: 1,
      source:
        "project_allowance",
      confidence: 55,
    };
  }

  if (
    geometry === "earthwork"
  ) {
    if (
      /(excavat|soil removal|cut)/.test(
        description
      ) &&
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.6,
        source:
          "floor_area_based_earthwork_allowance",
        confidence: 45,
      };
    }

    if (
      /(backfill|fill)/.test(
        description
      ) &&
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.3,
        source:
          "floor_area_based_backfill_allowance",
        confidence: 45,
      };
    }
  }

  if (
    geometry === "foundation"
  ) {
    if (
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.22,
        source:
          "floor_area_based_foundation_allowance",
        confidence: 42,
      };
    }

    if (
      ["m2", "sqm", "sq.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.85,
        source:
          "floor_area_based_foundation_formwork_allowance",
        confidence: 42,
      };
    }
  }

  if (
    geometry === "column"
  ) {
    if (
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      columns > 0
    ) {
      return {
        quantity:
          columns * 0.32,
        source:
          "column_count_allowance",
        confidence: 48,
      };
    }

    if (
      ["m2", "sqm", "sq.m"].includes(
        unit
      ) &&
      columns > 0
    ) {
      return {
        quantity:
          columns * 3.6,
        source:
          "column_count_formwork_allowance",
        confidence: 46,
      };
    }
  }

  if (
    geometry === "beam"
  ) {
    if (
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      wallLength > 0
    ) {
      return {
        quantity:
          wallLength * 0.045,
        source:
          "wall_length_beam_allowance",
        confidence: 40,
      };
    }

    if (
      ["m2", "sqm", "sq.m"].includes(
        unit
      ) &&
      wallLength > 0
    ) {
      return {
        quantity:
          wallLength * 0.55,
        source:
          "wall_length_beam_formwork_allowance",
        confidence: 40,
      };
    }
  }

  if (
    geometry === "slab"
  ) {
    if (
      ["m3", "cum", "cu.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.16,
        source:
          "floor_area_slab_concrete_allowance",
        confidence: 50,
      };
    }

    if (
      ["m2", "sqm", "sq.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea,
        source:
          "floor_area_slab_formwork_allowance",
        confidence: 60,
      };
    }
  }

  if (
    geometry === "plumbing"
  ) {
    if (
      ["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
        unit
      )
    ) {
      if (
        /(wc|toilet|water closet)/.test(
          description
        ) &&
        bathrooms > 0
      ) {
        return {
          quantity: bathrooms,
          source:
            "bathroom_count_fixture_allowance",
          confidence: 60,
        };
      }

      if (
        /(basin|wash basin|lavatory)/.test(
          description
        ) &&
        bathrooms > 0
      ) {
        return {
          quantity: bathrooms,
          source:
            "bathroom_count_fixture_allowance",
          confidence: 60,
        };
      }

      if (
        /(shower)/.test(
          description
        ) &&
        bathrooms > 0
      ) {
        return {
          quantity: bathrooms,
          source:
            "bathroom_count_fixture_allowance",
          confidence: 55,
        };
      }

      if (
        /(sink)/.test(
          description
        ) &&
        kitchens > 0
      ) {
        return {
          quantity: kitchens,
          source:
            "kitchen_count_fixture_allowance",
          confidence: 60,
        };
      }

      if (
        /(floor drain|drain)/.test(
          description
        ) &&
        wetRooms > 0
      ) {
        return {
          quantity: wetRooms,
          source:
            "wet_room_count_drain_allowance",
          confidence: 55,
        };
      }
    }

    if (
      ["m", "lm", "linear.m", "lin.m"].includes(
        unit
      ) &&
      wetRooms > 0
    ) {
      return {
        quantity:
          wetRooms * 8,
        source:
          "wet_room_pipe_length_allowance",
        confidence: 38,
      };
    }
  }

  if (
    geometry === "electrical"
  ) {
    if (
      ["no", "nos", "nr", "item", "each", "ea", "unit", "point"].includes(
        unit
      ) &&
      electricalItems > 0
    ) {
      if (
        /(lighting point|light point|downlight|led)/.test(
          description
        )
      ) {
        return {
          quantity:
            Math.round(
              electricalItems * 0.4
            ),
          source:
            "electrical_total_split_allowance",
          confidence: 35,
        };
      }

      if (
        /(socket|power outlet|13a)/.test(
          description
        )
      ) {
        return {
          quantity:
            Math.round(
              electricalItems * 0.35
            ),
          source:
            "electrical_total_split_allowance",
          confidence: 35,
        };
      }

      if (
        /(switch)/.test(
          description
        )
      ) {
        return {
          quantity:
            Math.round(
              electricalItems * 0.2
            ),
          source:
            "electrical_total_split_allowance",
          confidence: 35,
        };
      }

      if (
        /(distribution board|db panel|consumer unit)/.test(
          description
        )
      ) {
        return {
          quantity: 1,
          source:
            "single_db_allowance",
          confidence: 40,
        };
      }
    }
  }

  if (
    geometry === "hvac"
  ) {
    if (
      ["no", "nos", "nr", "item", "each", "ea", "unit", "set"].includes(
        unit
      ) &&
      roomCount > 0
    ) {
      if (
        /(split|ac unit|air conditioning unit|indoor unit|fan coil)/.test(
          description
        )
      ) {
        return {
          quantity:
            Math.max(
              1,
              Math.round(
                roomCount * 0.55
              )
            ),
          source:
            "room_count_hvac_allowance",
          confidence: 35,
        };
      }
    }

    if (
      ["m", "lm", "linear.m", "lin.m"].includes(
        unit
      ) &&
      roomCount > 0
    ) {
      return {
        quantity:
          roomCount * 3.5,
        source:
          "room_count_duct_allowance",
        confidence: 30,
      };
    }
  }

  if (
    geometry === "fire"
  ) {
    if (
      ["no", "nos", "nr", "item", "each", "ea", "unit"].includes(
        unit
      )
    ) {
      if (
        /(smoke detector|heat detector|detector)/.test(
          description
        ) &&
        roomCount > 0
      ) {
        return {
          quantity:
            Math.max(
              1,
              roomCount
            ),
          source:
            "room_count_fire_detector_allowance",
          confidence: 35,
        };
      }

      if (
        /(extinguisher)/.test(
          description
        )
      ) {
        return {
          quantity:
            Math.max(
              2,
              Math.ceil(
                roomCount / 6
              )
            ),
          source:
            "room_count_fire_extinguisher_allowance",
          confidence: 35,
        };
      }
    }
  }

  if (
    geometry === "external"
  ) {
    if (
      ["m2", "sqm", "sq.m"].includes(
        unit
      ) &&
      floorArea > 0
    ) {
      return {
        quantity:
          floorArea * 0.35,
        source:
          "floor_area_external_works_allowance",
        confidence: 30,
      };
    }

    if (
      ["m", "lm", "linear.m", "lin.m"].includes(
        unit
      ) &&
      wallLength > 0
    ) {
      return {
        quantity:
          wallLength * 0.4,
        source:
          "wall_length_external_works_allowance",
        confidence: 30,
      };
    }
  }

  if (
    geometry === "handover" ||
    geometry === "commissioning"
  ) {
    if (
      ["item", "ls", "l.s", "sum"].includes(
        unit
      )
    ) {
      return {
        quantity: 1,
        source:
          "project_allowance",
        confidence: 55,
      };
    }
  }

  return {
    quantity: 0,
    source:
      "unavailable",
    confidence: 0,
  };
}


function estimateRemainingPendingQuantity(
  rule,
  priceItem,
  takeoff
) {
  const code =
    String(
      rule?.item_code || ""
    ).trim().toUpperCase();

  const geometry =
    String(
      rule?.geometry_type || ""
    ).toLowerCase();

  const description =
    String(
      priceItem?.description || ""
    ).toLowerCase();

  const unit =
    String(
      priceItem?.unit || ""
    )
      .trim()
      .toLowerCase()
      .replace(/²/g, "2")
      .replace(/³/g, "3")
      .replace(/\s+/g, "");

  const floorArea =
    Number(takeoff?.floor_area) || 0;

  const ceilingArea =
    Number(takeoff?.ceiling_area) ||
    floorArea;

  const wallLength =
    Number(takeoff?.wall_length) || 0;

  const wallArea =
    Number(takeoff?.wall_area) || 0;

  const slabVolume =
    Number(takeoff?.slab_volume) || 0;
  const columnVolume =
    Number(takeoff?.column_volume) || 0;
  const beamVolume =
    Number(takeoff?.beam_volume) || 0;
  const foundationVolume =
    Number(takeoff?.foundation_volume) || 0;

  const columnFormworkArea =
    Number(takeoff?.column_formwork_area) || 0;
  const beamFormworkArea =
    Number(takeoff?.beam_formwork_area) || 0;
  const foundationFormworkArea =
    Number(takeoff?.foundation_formwork_area) || 0;
  const slabFormworkArea =
    Number(takeoff?.slab_formwork_area) || 0;

  const structuralStatus =
    takeoff?.structural_measurement_status || {};

  const roomCount =
    Number(takeoff?.rooms) || 0;

  const doors =
    Number(takeoff?.doors) || 0;

  const windows =
    Number(takeoff?.windows) || 0;

  const bathrooms =
    Number(
      takeoff?.classifications
        ?.room_types
        ?.bathroom
    ) || 3;

  const kitchens =
    Number(
      takeoff?.classifications
        ?.room_types
        ?.kitchen
    ) || 1;

  const laundries =
    Number(
      takeoff?.classifications
        ?.room_types
        ?.laundry
    ) || 1;

  const wetRooms =
    Math.max(
      1,
      bathrooms +
      kitchens +
      laundries
    );

  const isCountUnit =
    [
      "no","nos","nr","item","each","ea",
      "unit","set","point","ls","l.s","sum"
    ].includes(unit);

  const isAreaUnit =
    [
      "m2","sqm","sq.m"
    ].includes(unit);

  const isLengthUnit =
    [
      "m","lm","lin.m","linear.m","linearm"
    ].includes(unit);

  const isVolumeUnit =
    [
      "m3","cum","cu.m"
    ].includes(unit);

  // ------------------------------------------------------------
  // v33: semantic structural rule bridge for legacy DB rules that are still
  // tagged geometry_type="general". Only bind when the price description
  // itself proves the structural family and the unit matches the measured
  // quantity. This prevents 4.21 m3 of column concrete from leaking into
  // footing/slab/general concrete rows.
  // ------------------------------------------------------------
  const saysConcrete =
    /\b(concrete|r\.?c\.?c\.?|reinforced\s+concrete)\b/i.test(
      description
    );

  const saysColumn =
    /\b(column|columns|column\s+concrete|rcc\s+column)\b/i.test(
      description
    );

  const saysBeam =
    /\b(beam|beams|beam\s+concrete|rcc\s+beam)\b/i.test(
      description
    );

  const saysSlab =
    /\b(slab|slabs|slab\s+concrete|rcc\s+slab)\b/i.test(
      description
    );

  const saysFoundation =
    /\b(foundation|footing|footings|raft|pile\s*cap|foundation\s+concrete)\b/i.test(
      description
    );

  const saysFormwork =
    /\b(formwork|shuttering|form\s*work)\b/i.test(
      description
    );

  if (
    geometry === "general" &&
    isVolumeUnit &&
    saysConcrete &&
    saysColumn &&
    columnVolume > 0 &&
    structuralStatus?.columns?.volumeMeasured === true
  ) {
    return {
      quantity: columnVolume,
      source:
        "aps_measured_column_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column",
    };
  }

  if (
    geometry === "general" &&
    isAreaUnit &&
    saysColumn &&
    saysFormwork &&
    columnFormworkArea > 0 &&
    structuralStatus?.columns?.formworkComplete === true
  ) {
    return {
      quantity: columnFormworkArea,
      source:
        "aps_measured_column_formwork_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "column",
    };
  }

  if (
    geometry === "general" &&
    isVolumeUnit &&
    saysConcrete &&
    saysBeam &&
    beamVolume > 0 &&
    structuralStatus?.beams?.volumeMeasured === true
  ) {
    return {
      quantity: beamVolume,
      source:
        "aps_measured_beam_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "beam",
    };
  }

  if (
    geometry === "general" &&
    isVolumeUnit &&
    saysConcrete &&
    saysSlab &&
    slabVolume > 0 &&
    structuralStatus?.slabs?.volumeMeasured === true
  ) {
    return {
      quantity: slabVolume,
      source:
        "aps_measured_slab_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "slab",
    };
  }

  if (
    geometry === "general" &&
    isVolumeUnit &&
    saysConcrete &&
    saysFoundation &&
    foundationVolume > 0 &&
    structuralStatus?.foundations?.volumeMeasured === true
  ) {
    return {
      quantity: foundationVolume,
      source:
        "aps_measured_foundation_volume_semantic_rule_bridge",
      confidence: 94,
      measured: true,
      mappedGeometry: "foundation",
    };
  }

  // ------------------------------------------------------------
  // v30: measured structural quantities have priority over allowances.
  // Formwork is accepted only when every classified APS object has complete
  // dimensions. Volumes require actual APS/model volume data.
  // ------------------------------------------------------------
  if (geometry === "foundation") {
    if (
      isVolumeUnit &&
      foundationVolume > 0 &&
      structuralStatus?.foundations?.volumeMeasured === true
    ) {
      return {
        quantity: foundationVolume,
        source: "aps_measured_foundation_volume",
        confidence: 95,
        measured: true,
      };
    }

    if (
      isAreaUnit &&
      foundationFormworkArea > 0 &&
      structuralStatus?.foundations?.formworkComplete === true
    ) {
      return {
        quantity: foundationFormworkArea,
        source: "aps_measured_foundation_formwork",
        confidence: 95,
        measured: true,
      };
    }
  }

  if (geometry === "column") {
    if (
      isVolumeUnit &&
      columnVolume > 0 &&
      structuralStatus?.columns?.volumeMeasured === true
    ) {
      return {
        quantity: columnVolume,
        source: "aps_measured_column_volume",
        confidence: 95,
        measured: true,
      };
    }

    if (
      isAreaUnit &&
      columnFormworkArea > 0 &&
      structuralStatus?.columns?.formworkComplete === true
    ) {
      return {
        quantity: columnFormworkArea,
        source: "aps_measured_column_formwork",
        confidence: 95,
        measured: true,
      };
    }
  }

  if (geometry === "beam") {
    if (
      isVolumeUnit &&
      beamVolume > 0 &&
      structuralStatus?.beams?.volumeMeasured === true
    ) {
      return {
        quantity: beamVolume,
        source: "aps_measured_beam_volume",
        confidence: 95,
        measured: true,
      };
    }

    if (
      isAreaUnit &&
      beamFormworkArea > 0 &&
      structuralStatus?.beams?.formworkComplete === true
    ) {
      return {
        quantity: beamFormworkArea,
        source: "aps_measured_beam_formwork",
        confidence: 95,
        measured: true,
      };
    }
  }

  if (geometry === "slab") {
    if (
      isVolumeUnit &&
      slabVolume > 0 &&
      structuralStatus?.slabs?.volumeMeasured === true
    ) {
      return {
        quantity: slabVolume,
        source: "aps_measured_slab_volume",
        confidence: 95,
        measured: true,
      };
    }

    if (
      isAreaUnit &&
      slabFormworkArea > 0 &&
      structuralStatus?.slabs?.formworkComplete === true
    ) {
      return {
        quantity: slabFormworkArea,
        source: "aps_measured_slab_formwork",
        confidence: 95,
        measured: true,
      };
    }
  }

  // ------------------------------------------------------------
  // Exact remaining Ventra catalog mappings.
  // ------------------------------------------------------------

  const exact = {
    "MAS-004": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              floorArea * 0.12,
              1
            )
          : isCountUnit
            ? 1
            : Math.max(
                wallLength * 0.12,
                1
              ),
      source:
        "masonry_misc_allowance",
      confidence: 28,
    }),

    "HVC-001": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              Math.ceil(
                roomCount * 0.5
              )
            )
          : isLengthUnit
            ? Math.max(
                roomCount * 3.5,
                1
              )
            : isAreaUnit
              ? Math.max(
                  floorArea * 0.2,
                  1
                )
              : 1,
      source:
        "hvac_room_count_allowance",
      confidence: 32,
    }),

    "HVC-002": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              Math.ceil(
                roomCount * 0.5
              )
            )
          : isLengthUnit
            ? Math.max(
                roomCount * 3,
                1
              )
            : isAreaUnit
              ? Math.max(
                  wallArea * 0.08,
                  1
                )
              : 1,
      source:
        "hvac_distribution_allowance",
      confidence: 30,
    }),

    "HVC-003": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              Math.ceil(
                roomCount * 0.35
              )
            )
          : isLengthUnit
            ? Math.max(
                roomCount * 2.5,
                1
              )
            : 1,
      source:
        "hvac_accessory_allowance",
      confidence: 28,
    }),

    "HVC-004": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              ceilingArea * 0.25,
              1
            )
          : isCountUnit
            ? Math.max(
                1,
                Math.ceil(
                  roomCount * 0.25
                )
              )
            : 1,
      source:
        "hvac_ceiling_scope_allowance",
      confidence: 28,
    }),

    "WAT-001": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              floorArea,
              1
            )
          : isLengthUnit
            ? Math.max(
                wallLength,
                1
              )
            : 1,
      source:
        "roof_waterproofing_floor_area_allowance",
      confidence: 35,
    }),

    "WAT-002": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              floorArea * 0.18,
              1
            )
          : isLengthUnit
            ? Math.max(
                wetRooms * 6,
                1
              )
            : 1,
      source:
        "wet_area_waterproofing_allowance",
      confidence: 35,
    }),

    "PLB-001": () => ({
      quantity:
        isCountUnit
          ? bathrooms
          : isLengthUnit
            ? wetRooms * 8
            : 1,
      source:
        "bathroom_plumbing_allowance",
      confidence: 48,
    }),

    "PLB-002": () => ({
      quantity:
        isCountUnit
          ? bathrooms
          : isLengthUnit
            ? wetRooms * 7
            : 1,
      source:
        "bathroom_plumbing_allowance",
      confidence: 48,
    }),

    "PLB-003": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              kitchens,
              1
            )
          : isLengthUnit
            ? wetRooms * 6
            : 1,
      source:
        "kitchen_plumbing_allowance",
      confidence: 48,
    }),

    "PLB-004": () => ({
      quantity:
        isCountUnit
          ? wetRooms
          : isLengthUnit
            ? wetRooms * 8
            : 1,
      source:
        "wet_room_drainage_allowance",
      confidence: 45,
    }),

    "PLB-005": () => ({
      quantity:
        isCountUnit
          ? bathrooms
          : isLengthUnit
            ? wetRooms * 5
            : 1,
      source:
        "bathroom_fixture_allowance",
      confidence: 50,
    }),

    "PLB-006": () => ({
      quantity:
        isCountUnit
          ? bathrooms
          : isLengthUnit
            ? wetRooms * 5
            : 1,
      source:
        "bathroom_fixture_allowance",
      confidence: 50,
    }),

    "FIR-002": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              roomCount
            )
          : isLengthUnit
            ? Math.max(
                roomCount * 2,
                1
              )
            : 1,
      source:
        "fire_detection_room_allowance",
      confidence: 30,
    }),

    "FIR-003": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              Math.ceil(
                roomCount / 4
              )
            )
          : isLengthUnit
            ? Math.max(
                roomCount * 2,
                1
              )
            : 1,
      source:
        "fire_system_allowance",
      confidence: 28,
    }),

    "LAN-001": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              floorArea * 0.25,
              1
            )
          : isVolumeUnit
            ? Math.max(
                floorArea * 0.08,
                1
              )
            : isCountUnit
              ? 1
              : Math.max(
                  wallLength * 0.2,
                  1
                ),
      source:
        "landscape_area_allowance",
      confidence: 25,
    }),

    "LAN-002": () => ({
      quantity:
        isAreaUnit
          ? Math.max(
              floorArea * 0.18,
              1
            )
          : isCountUnit
            ? 1
            : Math.max(
                wallLength * 0.15,
                1
              ),
      source:
        "landscape_hardscape_allowance",
      confidence: 25,
    }),

    "LAN-003": () => ({
      quantity:
        isCountUnit
          ? Math.max(
              1,
              Math.ceil(
                floorArea / 60
              )
            )
          : isAreaUnit
            ? Math.max(
                floorArea * 0.12,
                1
              )
            : Math.max(
                wallLength * 0.1,
                1
              ),
      source:
        "landscape_misc_allowance",
      confidence: 22,
    }),
  };

  if (exact[code]) {
    return exact[code]();
  }

  // ------------------------------------------------------------
  // Generic final fallback for any remaining MANUAL catalog rule.
  // This is intentionally low-confidence but prevents a valid scope
  // from contributing a fake AED 0 simply because detailed takeoff
  // is not available yet.
  // ------------------------------------------------------------

  if (isCountUnit) {
    if (
      /(door|window)/.test(
        description
      )
    ) {
      return {
        quantity:
          /(door)/.test(description)
            ? Math.max(doors, 1)
            : Math.max(windows, 1),
        source:
          "opening_count_final_allowance",
        confidence: 25,
      };
    }

    return {
      quantity: 1,
      source:
        "single_item_final_allowance",
      confidence: 18,
    };
  }

  if (isAreaUnit) {
    if (
      geometry === "roof"
    ) {
      return {
        quantity:
          Math.max(
            floorArea,
            1
          ),
        source:
          "floor_area_final_allowance",
        confidence: 22,
      };
    }

    if (
      geometry === "ceiling"
    ) {
      return {
        quantity:
          Math.max(
            ceilingArea,
            1
          ),
        source:
          "ceiling_area_final_allowance",
        confidence: 25,
      };
    }

    if (
      geometry === "wall"
    ) {
      return {
        quantity:
          Math.max(
            wallArea * 0.1,
            1
          ),
        source:
          "wall_area_final_allowance",
        confidence: 18,
      };
    }

    return {
      quantity:
        Math.max(
          floorArea * 0.25,
          1
        ),
      source:
        "floor_area_fraction_final_allowance",
      confidence: 18,
    };
  }

  if (isLengthUnit) {
    return {
      quantity:
        Math.max(
          wallLength * 0.25,
          1
        ),
      source:
        "wall_length_final_allowance",
      confidence: 18,
    };
  }

  if (isVolumeUnit) {
    return {
      quantity:
        Math.max(
          floorArea * 0.08,
          1
        ),
      source:
        "floor_area_volume_final_allowance",
      confidence: 18,
    };
  }

  // Unknown unit: keep it priced as one allowance item instead of AED 0.
  return {
    quantity: 1,
    source:
      "unknown_unit_single_allowance",
    confidence: 12,
  };
}



const ROOM_LOCAL_MEP_FIX_VERSION =
  "2026-08-15-room-local-mep-v2";

function normalizeSpatialPoints(
  items
) {
  const valid =
    (Array.isArray(items)
      ? items
      : []
    ).filter(
      (item) => {
        const x =
          item?.centroid?.x;
        const y =
          item?.centroid?.y;

        return (
          x !== null &&
          x !== undefined &&
          x !== "" &&
          y !== null &&
          y !== undefined &&
          y !== "" &&
          Number.isFinite(
            Number(x)
          ) &&
          Number.isFinite(
            Number(y)
          )
        );
      }
    );

  if (!valid.length) {
    return [];
  }

  const xs =
    valid.map(
      (item) =>
        Number(item.centroid.x)
    );
  const ys =
    valid.map(
      (item) =>
        Number(item.centroid.y)
    );

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width =
    Math.max(
      maxX - minX,
      1e-9
    );
  const height =
    Math.max(
      maxY - minY,
      1e-9
    );

  return valid.map(
    (item) => ({
      item,
      x:
        (
          Number(item.centroid.x) -
          minX
        ) / width,
      y:
        (
          Number(item.centroid.y) -
          minY
        ) / height,
    })
  );
}

function pointInsideRoomRegion(
  point,
  room
) {
  const box =
    room?.regionBBox;

  if (
    !box ||
    !Number.isFinite(
      Number(box.x)
    ) ||
    !Number.isFinite(
      Number(box.y)
    ) ||
    !Number.isFinite(
      Number(box.width)
    ) ||
    !Number.isFinite(
      Number(box.height)
    ) ||
    Number(box.width) <= 0 ||
    Number(box.height) <= 0
  ) {
    return false;
  }

  const padding = 0.03;

  return (
    point.x >=
      Number(box.x) -
        padding &&
    point.x <=
      Number(box.x) +
        Number(box.width) +
        padding &&
    point.y >=
      Number(box.y) -
        padding &&
    point.y <=
      Number(box.y) +
        Number(box.height) +
        padding
  );
}


function collectElectricalObjectEvidence(
  item
) {
  const values = [];

  const pushValue =
    (value) => {
      if (
        typeof value === "string" &&
        value.trim()
      ) {
        values.push(
          value.trim()
        );
      }
    };

  const visit =
    (
      value,
      depth = 0
    ) => {
      if (
        depth > 3 ||
        value == null
      ) {
        return;
      }

      if (
        typeof value ===
        "string"
      ) {
        pushValue(value);
        return;
      }

      if (
        Array.isArray(value)
      ) {
        for (
          const child of
            value.slice(0, 80)
        ) {
          visit(
            child,
            depth + 1
          );
        }

        return;
      }

      if (
        typeof value ===
        "object"
      ) {
        for (
          const [
            key,
            child,
          ] of Object.entries(
            value
          ).slice(0, 120)
        ) {
          if (
            [
              "centroid",
              "boundingBox",
              "bbox",
            ].includes(key)
          ) {
            continue;
          }

          pushValue(key);
          visit(
            child,
            depth + 1
          );
        }
      }
    };

  for (
    const key of [
      "name",
      "displayName",
      "objectName",
      "category",
      "family",
      "familyName",
      "type",
      "typeName",
      "layer",
      "layerName",
      "classification",
      "description",
      "symbol",
      "blockName",
      "properties",
      "rawProperties",
    ]
  ) {
    visit(
      item?.[key],
      0
    );
  }

  return values
    .join(" ")
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
}

function classifyElectricalSubtypeFromAps(
  item
) {
  const existing =
    String(
      item
        ?.electricalSubtype ||
      ""
    )
      .toLowerCase()
      .trim();

  if (
    [
      "lighting",
      "socket",
      "switch",
      "distribution_board",
    ].includes(existing)
  ) {
    return existing;
  }

  const text =
    collectElectricalObjectEvidence(
      item
    );

  if (!text) {
    return "other";
  }

  const hasAny =
    (patterns) =>
      patterns.some(
        (pattern) =>
          pattern.test(text)
      );

  if (
    hasAny([
      /\bdistribution\s*board\b/i,
      /\bpanel\s*board\b/i,
      /\bpanelboard\b/i,
      /\bswitch\s*board\b/i,
      /\bconsumer\s*unit\b/i,
      /\bmain\s*distribution\b/i,
      /\bsub\s*main\s*distribution\b/i,
      /\bmdb\b/i,
      /\bsmdb\b/i,
      /\bdb\s*\d*\b/i,
    ])
  ) {
    return "distribution_board";
  }

  if (
    hasAny([
      /\bsocket\b/i,
      /\breceptacle\b/i,
      /\bpower\s*outlet\b/i,
      /\boutlet\s*point\b/i,
      /\bpower\s*point\b/i,
      /\bgpo\b/i,
      /\b13a\b/i,
      /\b15a\b/i,
      /\b20a\b/i,
      /\be[\s-]*powr\b/i,
      /\be[\s-]*power\b/i,
    ])
  ) {
    return "socket";
  }

  if (
    hasAny([
      /\blight\s*switch\b/i,
      /\bswitch\s*point\b/i,
      /\bdimmer\b/i,
      /\bpush\s*button\b/i,
      /\b\d+\s*gang\s*switch\b/i,
      /\b1g\s*switch\b/i,
      /\b2g\s*switch\b/i,
      /\b3g\s*switch\b/i,
      /\be[\s-]*swch\b/i,
      /\be[\s-]*switch\b/i,
    ])
  ) {
    return "switch";
  }

  if (
    hasAny([
      /\blighting\b/i,
      /\bluminaire\b/i,
      /\bdown\s*light\b/i,
      /\bdownlight\b/i,
      /\bspot\s*light\b/i,
      /\bspotlight\b/i,
      /\bceiling\s*light\b/i,
      /\bwall\s*light\b/i,
      /\bpendant\s*light\b/i,
      /\bchandelier\b/i,
      /\bsconce\b/i,
      /\blamp\b/i,
      /\blight\s*fitting\b/i,
      /\blight\s*fixture\b/i,
      /\be[\s-]*lite\b/i,
      /\be[\s-]*light\b/i,
    ])
  ) {
    return "lighting";
  }

  return "other";
}

function summarizeElectricalSubtypes(
  electrical
) {
  const counts = {
    lighting: 0,
    socket: 0,
    switch: 0,
    distribution_board: 0,
    other: 0,
  };

  for (
    const item of
      electrical || []
  ) {
    const subtype =
      classifyElectricalSubtypeFromAps(
        item
      );

    if (
      Object.prototype.hasOwnProperty.call(
        counts,
        subtype
      )
    ) {
      counts[subtype] += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function buildWorldRoomLocalMepCounts(
  takeoff,
  semanticRooms
) {
  const mep =
    Array.isArray(
      takeoff?.object_details?.mep
    )
      ? takeoff.object_details.mep
      : [];

  const electrical =
    mep.filter(
      (item) =>
        item?.detectedType ===
          "electrical" &&
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
    );

  const rooms =
    (Array.isArray(
      semanticRooms
    )
      ? semanticRooms
      : []
    ).filter(
      (room) =>
        Number.isFinite(
          Number(
            room?.apsWorldCentroid?.x
          )
        ) &&
        Number.isFinite(
          Number(
            room?.apsWorldCentroid?.y
          )
        )
    );

  const base = {
    valid: false,
    mapper:
      "aps_world_to_aps_world",
    worldRoomCount:
      rooms.length,
    totalCount:
      electrical.length,
    electricalSubtypeCounts:
      summarizeElectricalSubtypes(
        electrical
      ),
    byRoomType: {},
    assignedCount: 0,
  };

  if (
    electrical.length === 0 ||
    rooms.length === 0
  ) {
    return {
      ...base,
      reason:
        rooms.length === 0
          ? "aps_world_room_centroids_unavailable"
          : "aps_world_electrical_centroids_unavailable",
    };
  }

  const xs = [
    ...electrical.map(
      (item) =>
        Number(
          item.centroid.x
        )
    ),
    ...rooms.map(
      (room) =>
        Number(
          room.apsWorldCentroid.x
        )
    ),
  ];

  const ys = [
    ...electrical.map(
      (item) =>
        Number(
          item.centroid.y
        )
    ),
    ...rooms.map(
      (room) =>
        Number(
          room.apsWorldCentroid.y
        )
    ),
  ];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width =
    Math.max(
      maxX - minX,
      1e-9
    );

  const height =
    Math.max(
      maxY - minY,
      1e-9
    );

  const normalizedRooms =
    rooms.map(
      (room) => ({
        room,
        x:
          (
            Number(
              room.apsWorldCentroid.x
            ) -
            minX
          ) /
          width,
        y:
          (
            Number(
              room.apsWorldCentroid.y
            ) -
            minY
          ) /
          height,
      })
    );

  const rawAssignments =
    electrical.map(
      (item) => {
        const point = {
          x:
            (
              Number(
                item.centroid.x
              ) -
              minX
            ) /
            width,
          y:
            (
              Number(
                item.centroid.y
              ) -
              minY
            ) /
            height,
        };

        const ranked =
          normalizedRooms
            .map(
              (candidate) => ({
                ...candidate,
                distance:
                  Math.hypot(
                    point.x -
                      candidate.x,
                    point.y -
                      candidate.y
                  ),
              })
            )
            .sort(
              (a, b) =>
                a.distance -
                b.distance
            );

        const nearest =
          ranked[0] ||
          null;

        const second =
          ranked[1] ||
          null;

        return {
          item,
          room:
            nearest?.room ||
            null,
          distance:
            nearest?.distance ??
            Infinity,
          separation:
            nearest &&
            second
              ? second.distance -
                nearest.distance
              : 1,
        };
      }
    );

  const finiteDistances =
    rawAssignments
      .map(
        (entry) =>
          entry.distance
      )
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  const medianDistance =
    finiteDistances.length
      ? finiteDistances[
          Math.floor(
            finiteDistances.length /
            2
          )
        ]
      : Infinity;

  const adaptiveLimit =
    Number.isFinite(
      medianDistance
    )
      ? Math.max(
          0.04,
          Math.min(
            0.18,
            medianDistance * 3
          )
        )
      : 0.1;

  const accepted =
    rawAssignments.filter(
      (entry) =>
        entry.room &&
        entry.distance <=
          adaptiveLimit
    );

  const coverage =
    electrical.length
      ? accepted.length /
        electrical.length
      : 0;

  if (coverage < 0.6) {
    return {
      ...base,
      reason:
        "aps_world_room_assignment_low_coverage",
      assignedCount:
        accepted.length,
      coverage:
        Number(
          coverage.toFixed(4)
        ),
      medianDistance:
        Number.isFinite(
          medianDistance
        )
          ? Number(
              medianDistance.toFixed(
                4
              )
            )
          : null,
      adaptiveLimit:
        Number(
          adaptiveLimit.toFixed(
            4
          )
        ),
    };
  }

  const byRoomType = {};

  for (
    const assignment of
      accepted
  ) {
    const roomType =
      String(
        assignment.room?.type ||
        assignment.room?.roomType ||
        "room"
      );

    if (!byRoomType[roomType]) {
      byRoomType[
        roomType
      ] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0,
      };
    }

    const bucket =
      byRoomType[
        roomType
      ];

    bucket.electrical_items +=
      1;

    const subtype =
      classifyElectricalSubtypeFromAps(
        assignment.item
      );

    if (
      subtype === "lighting"
    ) {
      bucket.lighting_points +=
        1;
    } else if (
      subtype === "socket"
    ) {
      bucket.socket_points +=
        1;
    } else if (
      subtype === "switch"
    ) {
      bucket.switches +=
        1;
    } else if (
      subtype ===
        "distribution_board"
    ) {
      bucket.distribution_boards +=
        1;
    } else {
      bucket.other_electrical +=
        1;
    }
  }

  return {
    valid: true,
    mapper:
      "aps_world_to_aps_world",
    reason:
      "aps_world_electrical_to_matched_aps_room",
    byRoomType,
    assignedCount:
      accepted.length,
    totalCount:
      electrical.length,
    worldRoomCount:
      rooms.length,
    coverage:
      Number(
        coverage.toFixed(4)
      ),
    medianDistance:
      Number(
        medianDistance.toFixed(
          4
        )
      ),
    adaptiveLimit:
      Number(
        adaptiveLimit.toFixed(
          4
        )
      ),
  };
}

function normalizeRoomRegions(
  semanticRooms
) {
  const rooms =
    (Array.isArray(
      semanticRooms
    )
      ? semanticRooms
      : []
    ).filter(
      (room) =>
        room?.regionBBox &&
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
    );

  if (!rooms.length) {
    return [];
  }

  const rawBoxes =
    rooms.map(
      (room) => ({
        room,
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
      })
    );

  const alreadyNormalized =
    rawBoxes.every(
      (box) =>
        box.x >= -0.05 &&
        box.y >= -0.05 &&
        box.x + box.width <=
          1.05 &&
        box.y + box.height <=
          1.05
    );

  if (alreadyNormalized) {
    return rawBoxes.map(
      (box) => ({
        ...box.room,
        regionBBox: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
        centroid: {
          ...box.room.centroid,
          x:
            Number.isFinite(
              Number(
                box.room
                  ?.centroid?.x
              )
            )
              ? Number(
                  box.room
                    .centroid.x
                )
              : box.x +
                box.width / 2,
          y:
            Number.isFinite(
              Number(
                box.room
                  ?.centroid?.y
              )
            )
              ? Number(
                  box.room
                    .centroid.y
                )
              : box.y +
                box.height / 2,
        },
      })
    );
  }

  const minX =
    Math.min(
      ...rawBoxes.map(
        (box) =>
          box.x
      )
    );
  const minY =
    Math.min(
      ...rawBoxes.map(
        (box) =>
          box.y
      )
    );
  const maxX =
    Math.max(
      ...rawBoxes.map(
        (box) =>
          box.x +
          box.width
      )
    );
  const maxY =
    Math.max(
      ...rawBoxes.map(
        (box) =>
          box.y +
          box.height
      )
    );

  const width =
    Math.max(
      maxX - minX,
      1e-9
    );
  const height =
    Math.max(
      maxY - minY,
      1e-9
    );

  return rawBoxes.map(
    (box) => {
      const x =
        (box.x - minX) /
        width;
      const y =
        (box.y - minY) /
        height;
      const w =
        box.width /
        width;
      const h =
        box.height /
        height;

      return {
        ...box.room,
        regionBBox: {
          x,
          y,
          width: w,
          height: h,
        },
        centroid: {
          ...box.room.centroid,
          x:
            x +
            w / 2,
          y:
            y +
            h / 2,
        },
      };
    }
  );
}


function buildRoomCentroidElectricalCounts(
  takeoff,
  semanticRooms
) {
  const mep =
    Array.isArray(
      takeoff?.object_details?.mep
    )
      ? takeoff.object_details.mep
      : [];

  const electrical =
    mep.filter(
      (item) =>
        item?.detectedType ===
          "electrical" &&
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
    );

  const rooms =
    (Array.isArray(
      semanticRooms
    )
      ? semanticRooms
      : []
    ).filter(
      (room) => {
        const x =
          room?.centroid?.x;
        const y =
          room?.centroid?.y;

        return (
          x !== null &&
          x !== undefined &&
          y !== null &&
          y !== undefined &&
          Number.isFinite(
            Number(x)
          ) &&
          Number.isFinite(
            Number(y)
          )
        );
      }
    );

  const base = {
    valid: false,
    mapper:
      "aps_world_normalized_to_room_centroid_v11",
    roomCount:
      rooms.length,
    totalCount:
      electrical.length,
    electricalSubtypeCounts:
      summarizeElectricalSubtypes(
        electrical
      ),
    byRoomType: {},
    assignedCount: 0,
  };

  if (
    electrical.length === 0 ||
    rooms.length < 4
  ) {
    return {
      ...base,
      reason:
        electrical.length === 0
          ? "electrical_centroids_unavailable"
          : "semantic_room_centroids_insufficient",
    };
  }

  const normalizedElectrical =
    normalizeSpatialPoints(
      electrical
    );

  const roomXs =
    rooms.map(
      (room) =>
        Number(
          room.centroid.x
        )
    );

  const roomYs =
    rooms.map(
      (room) =>
        Number(
          room.centroid.y
        )
    );

  const minRoomX =
    Math.min(...roomXs);
  const maxRoomX =
    Math.max(...roomXs);
  const minRoomY =
    Math.min(...roomYs);
  const maxRoomY =
    Math.max(...roomYs);

  const roomWidth =
    Math.max(
      maxRoomX - minRoomX,
      1e-9
    );
  const roomHeight =
    Math.max(
      maxRoomY - minRoomY,
      1e-9
    );

  const roomCentroids =
    rooms.map(
      (room) => ({
        room,
        x:
          (
            Number(
              room.centroid.x
            ) -
            minRoomX
          ) /
          roomWidth,
        y:
          (
            Number(
              room.centroid.y
            ) -
            minRoomY
          ) /
          roomHeight,
      })
    );

  const transforms = [
    (point) => ({
      x: point.x,
      y: point.y,
    }),
    (point) => ({
      x: point.x,
      y: 1 - point.y,
    }),
    (point) => ({
      x: 1 - point.x,
      y: point.y,
    }),
    (point) => ({
      x: 1 - point.x,
      y: 1 - point.y,
    }),
    (point) => ({
      x: point.y,
      y: point.x,
    }),
    (point) => ({
      x: point.y,
      y: 1 - point.x,
    }),
    (point) => ({
      x: 1 - point.y,
      y: point.x,
    }),
    (point) => ({
      x: 1 - point.y,
      y: 1 - point.x,
    }),
  ];

  const solutions =
    transforms.map(
      (
        transform,
        transformIndex
      ) => {
        const assignments =
          normalizedElectrical.map(
            (entry) => {
              const point =
                transform(entry);

              const ranked =
                roomCentroids
                  .map(
                    (candidate) => ({
                      ...candidate,
                      distance:
                        Math.hypot(
                          point.x -
                            candidate.x,
                          point.y -
                            candidate.y
                        ),
                    })
                  )
                  .sort(
                    (a, b) =>
                      a.distance -
                      b.distance
                  );

              const nearest =
                ranked[0] ||
                null;

              const second =
                ranked[1] ||
                null;

              if (!nearest) {
                return {
                  entry,
                  room: null,
                  distance:
                    Infinity,
                  margin: 0,
                };
              }

              return {
                entry,
                room:
                  nearest.room,
                distance:
                  nearest.distance,
                margin:
                  second
                    ? second.distance -
                      nearest.distance
                    : 1,
              };
            }
          );

        const distances =
          assignments
            .map(
              (item) =>
                item.distance
            )
            .filter(
              Number.isFinite
            )
            .sort(
              (a, b) =>
                a - b
            );

        const medianDistance =
          distances.length
            ? distances[
                Math.floor(
                  distances.length /
                  2
                )
              ]
            : Infinity;

        const p80Distance =
          distances.length
            ? distances[
                Math.min(
                  distances.length - 1,
                  Math.floor(
                    distances.length *
                    0.8
                  )
                )
              ]
            : Infinity;

        const roomUseCounts =
          new Map();

        for (
          const assignment of
            assignments
        ) {
          const key =
            String(
              assignment.room?.name ||
              assignment.room?.type ||
              "room"
            );

          roomUseCounts.set(
            key,
            (
              roomUseCounts.get(
                key
              ) || 0
            ) + 1
          );
        }

        const usedRooms =
          roomUseCounts.size;

        const maxRoomShare =
          electrical.length
            ? Math.max(
                ...roomUseCounts.values()
              ) /
              electrical.length
            : 1;

        const distinctRoomTypes =
          new Set(
            assignments.map(
              (assignment) =>
                String(
                  assignment.room?.type ||
                  assignment.room?.roomType ||
                  "room"
                )
            )
          ).size;

        const averageMargin =
          assignments.length
            ? assignments.reduce(
                (sum, item) =>
                  sum +
                  Math.max(
                    0,
                    Number(
                      item.margin
                    ) || 0
                  ),
                0
              ) /
              assignments.length
            : 0;

        const score =
          (
            Number.isFinite(
              medianDistance
            )
              ? 1 -
                Math.min(
                  medianDistance,
                  1
                )
              : 0
          ) *
            4 +
          (
            Number.isFinite(
              p80Distance
            )
              ? 1 -
                Math.min(
                  p80Distance,
                  1
                )
              : 0
          ) *
            2 +
          Math.min(
            usedRooms,
            10
          ) *
            0.12 +
          Math.min(
            distinctRoomTypes,
            8
          ) *
            0.08 +
          Math.min(
            averageMargin,
            0.25
          ) *
            2 -
          Math.max(
            0,
            maxRoomShare -
              0.35
          ) *
            4;

        return {
          transformIndex,
          assignments,
          medianDistance,
          p80Distance,
          usedRooms,
          distinctRoomTypes,
          maxRoomShare,
          averageMargin,
          score,
        };
      }
    );

  solutions.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    solutions[0];

  if (!best) {
    return {
      ...base,
      reason:
        "room_centroid_transform_unavailable",
    };
  }

  const adaptiveLimit =
    Math.max(
      0.07,
      Math.min(
        0.2,
        (
          Number.isFinite(
            best.medianDistance
          )
            ? best.medianDistance
            : 0.1
        ) *
          2.25
      )
    );

  const accepted =
    best.assignments.filter(
      (assignment) =>
        assignment.room &&
        assignment.distance <=
          adaptiveLimit
    );

  const coverage =
    electrical.length
      ? accepted.length /
        electrical.length
      : 0;

  const acceptedRoomUse =
    new Map();

  for (
    const assignment of
      accepted
  ) {
    const key =
      String(
        assignment.room?.name ||
        assignment.room?.type ||
        "room"
      );

    acceptedRoomUse.set(
      key,
      (
        acceptedRoomUse.get(
          key
        ) || 0
      ) + 1
    );
  }

  const acceptedMaxRoomShare =
    accepted.length
      ? Math.max(
          ...acceptedRoomUse.values()
        ) /
        accepted.length
      : 1;

  const reliable =
    coverage >= 0.7 &&
    best.usedRooms >= 4 &&
    best.distinctRoomTypes >= 3 &&
    best.medianDistance <=
      0.16 &&
    best.p80Distance <=
      0.27 &&
    acceptedMaxRoomShare <=
      0.42;

  if (!reliable) {
    return {
      ...base,
      reason:
        "room_centroid_spatial_match_low_confidence",
      assignedCount:
        accepted.length,
      coverage:
        Number(
          coverage.toFixed(
            4
          )
        ),
      medianDistance:
        Number.isFinite(
          best.medianDistance
        )
          ? Number(
              best.medianDistance.toFixed(
                4
              )
            )
          : null,
      p80Distance:
        Number.isFinite(
          best.p80Distance
        )
          ? Number(
              best.p80Distance.toFixed(
                4
              )
            )
          : null,
      adaptiveLimit:
        Number(
          adaptiveLimit.toFixed(
            4
          )
        ),
      usedRooms:
        best.usedRooms,
      distinctRoomTypes:
        best.distinctRoomTypes,
      maxRoomShare:
        Number(
          acceptedMaxRoomShare.toFixed(
            4
          )
        ),
      transformIndex:
        best.transformIndex,
    };
  }

  const byRoomType = {};

  for (
    const assignment of
      accepted
  ) {
    const roomType =
      String(
        assignment.room?.type ||
        assignment.room?.roomType ||
        "room"
      );

    if (
      !byRoomType[
        roomType
      ]
    ) {
      byRoomType[
        roomType
      ] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0,
      };
    }

    const bucket =
      byRoomType[
        roomType
      ];

    bucket.electrical_items +=
      1;

    const subtype =
      classifyElectricalSubtypeFromAps(
        assignment.entry.item
      );

    if (
      subtype === "lighting"
    ) {
      bucket.lighting_points +=
        1;
    } else if (
      subtype === "socket"
    ) {
      bucket.socket_points +=
        1;
    } else if (
      subtype === "switch"
    ) {
      bucket.switches +=
        1;
    } else if (
      subtype ===
        "distribution_board"
    ) {
      bucket.distribution_boards +=
        1;
    } else {
      bucket.other_electrical +=
        1;
    }
  }

  return {
    ...base,
    valid: true,
    reason:
      "aps_electrical_to_semantic_room_centroid_v11",
    byRoomType,
    assignedCount:
      accepted.length,
    totalCount:
      electrical.length,
    coverage:
      Number(
        coverage.toFixed(
          4
        )
      ),
    medianDistance:
      Number(
        best.medianDistance.toFixed(
          4
        )
      ),
    p80Distance:
      Number(
        best.p80Distance.toFixed(
          4
        )
      ),
    adaptiveLimit:
      Number(
        adaptiveLimit.toFixed(
          4
        )
      ),
    usedRooms:
      best.usedRooms,
    distinctRoomTypes:
      best.distinctRoomTypes,
    maxRoomShare:
      Number(
        acceptedMaxRoomShare.toFixed(
          4
        )
      ),
    transformIndex:
      best.transformIndex,
  };
}

function buildRoomLocalMepCounts(
  takeoff,
  semanticRooms
) {
  const mep =
    Array.isArray(
      takeoff?.object_details
        ?.mep
    )
      ? takeoff.object_details.mep
      : [];

  const electrical =
    mep.filter(
      (item) =>
        item?.detectedType ===
          "electrical" &&
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
    );

  const rooms =
    normalizeRoomRegions(
      semanticRooms
    );

  const baseResult = {
    fixVersion:
      "2026-08-17-electrical-subtype-v9",
    mapper:
      "aps_world_normalized_to_ai_room_bbox",
    electricalObjects:
      mep.filter(
        (item) =>
          item?.detectedType ===
            "electrical"
      ).length,
    electricalObjectsWithCentroid:
      electrical.length,
    electricalSubtypeCounts:
      summarizeElectricalSubtypes(
        electrical
      ),
    semanticRooms:
      rooms.length,
  };

  if (
    electrical.length === 0 ||
    rooms.length === 0
  ) {
    return {
      ...baseResult,
      valid: false,
      reason:
        electrical.length === 0
          ? "aps_electrical_centroids_missing_reanalyze_required"
          : "semantic_room_regions_missing",
      byRoomType: {},
      assignedCount: 0,
      totalCount:
        electrical.length,
    };
  }

  const normalizedElectrical =
    normalizeSpatialPoints(
      electrical
    );

  const transforms = [
    (point) => ({
      x: point.x,
      y: point.y,
    }),
    (point) => ({
      x: point.x,
      y: 1 - point.y,
    }),
    (point) => ({
      x: 1 - point.x,
      y: point.y,
    }),
    (point) => ({
      x: 1 - point.x,
      y: 1 - point.y,
    }),
    (point) => ({
      x: point.y,
      y: point.x,
    }),
    (point) => ({
      x: point.y,
      y: 1 - point.x,
    }),
    (point) => ({
      x: 1 - point.y,
      y: point.x,
    }),
    (point) => ({
      x: 1 - point.y,
      y: 1 - point.x,
    }),
  ];

  const distanceToRegion =
    (point, room) => {
      const box =
        room.regionBBox;

      const dx =
        point.x <
        box.x
          ? box.x -
            point.x
          : point.x >
              box.x +
                box.width
            ? point.x -
              (
                box.x +
                box.width
              )
            : 0;

      const dy =
        point.y <
        box.y
          ? box.y -
            point.y
          : point.y >
              box.y +
                box.height
            ? point.y -
              (
                box.y +
                box.height
              )
            : 0;

      return Math.hypot(
        dx,
        dy
      );
    };

  const roomCenterDistance =
    (point, room) =>
      Math.hypot(
        point.x -
          (
            room.regionBBox.x +
            room.regionBBox.width /
              2
          ),
        point.y -
          (
            room.regionBBox.y +
            room.regionBBox.height /
              2
          )
      );

  const solutions =
    transforms.map(
      (
        transform,
        transformIndex
      ) => {
        const assignments =
          normalizedElectrical.map(
            (entry) => {
              const point =
                transform(entry);

              const ranked =
                rooms
                  .map(
                    (room) => ({
                      room,
                      regionDistance:
                        distanceToRegion(
                          point,
                          room
                        ),
                      centerDistance:
                        roomCenterDistance(
                          point,
                          room
                        ),
                    })
                  )
                  .sort(
                    (a, b) =>
                      a.regionDistance -
                        b.regionDistance ||
                      a.centerDistance -
                        b.centerDistance
                  );

              const best =
                ranked[0] ||
                null;

              const second =
                ranked[1] ||
                null;

              if (!best) {
                return {
                  entry,
                  room: null,
                  insideRegion:
                    false,
                  regionDistance:
                    Infinity,
                  separation:
                    0,
                };
              }

              const insideRegion =
                best.regionDistance ===
                0;

              // Small tolerance only. This is deliberately conservative:
              // no "nearest room no matter what" behaviour.
              const accepted =
                insideRegion ||
                best.regionDistance <=
                  0.055;

              const separation =
                second
                  ? second.regionDistance -
                    best.regionDistance
                  : 1;

              return {
                entry,
                room:
                  accepted
                    ? best.room
                    : null,
                insideRegion,
                regionDistance:
                  best.regionDistance,
                centerDistance:
                  best.centerDistance,
                separation,
              };
            }
          );

        const assigned =
          assignments.filter(
            (item) =>
              item.room
          );

        const inside =
          assigned.filter(
            (item) =>
              item.insideRegion
          ).length;

        const coverage =
          electrical.length
            ? assigned.length /
              electrical.length
            : 0;

        const regionCoverage =
          electrical.length
            ? inside /
              electrical.length
            : 0;

        const averageRegionDistance =
          assigned.length
            ? assigned.reduce(
                (sum, item) =>
                  sum +
                  item.regionDistance,
                0
              ) /
              assigned.length
            : Infinity;

        const roomTypesUsed =
          new Set(
            assigned.map(
              (item) =>
                String(
                  item.room
                    ?.type ||
                  item.room
                    ?.roomType ||
                  "room"
                )
            )
          ).size;

        return {
          transformIndex,
          assignments,
          coverage,
          regionCoverage,
          averageRegionDistance,
          roomTypesUsed,
          score:
            regionCoverage * 8 +
            coverage * 3 +
            Math.min(
              roomTypesUsed,
              8
            ) *
              0.12 -
            Math.min(
              averageRegionDistance,
              1
            ) *
              2,
        };
      }
    );

  solutions.sort(
    (a, b) =>
      b.score -
      a.score
  );

  const best =
    solutions[0];

  const reliable =
    Boolean(
      best &&
      best.coverage >= 0.6 &&
      best.regionCoverage >=
        0.35 &&
      best.roomTypesUsed >= 2
    );

  if (!reliable) {
    return {
      ...baseResult,
      valid: false,
      reason:
        "room_region_spatial_match_low_confidence",
      byRoomType: {},
      assignedCount:
        best
          ? best.assignments.filter(
              (item) =>
                item.room
            ).length
          : 0,
      totalCount:
        electrical.length,
      coverage:
        Number(
          (
            best?.coverage ||
            0
          ).toFixed(4)
        ),
      regionCoverage:
        Number(
          (
            best?.regionCoverage ||
            0
          ).toFixed(4)
        ),
      averageRegionDistance:
        Number.isFinite(
          best?.averageRegionDistance
        )
          ? Number(
              best.averageRegionDistance.toFixed(
                4
              )
            )
          : null,
      roomTypesUsed:
        best?.roomTypesUsed ||
        0,
      transformIndex:
        best?.transformIndex ??
        null,
    };
  }

  const byRoomType = {};

  for (
    const assignment of
      best.assignments
  ) {
    if (!assignment.room) {
      continue;
    }

    const roomType =
      String(
        assignment.room.type ||
        assignment.room.roomType ||
        "room"
      );

    if (
      !byRoomType[
        roomType
      ]
    ) {
      byRoomType[
        roomType
      ] = {
        electrical_items: 0,
        lighting_points: 0,
        socket_points: 0,
        switches: 0,
        distribution_boards: 0,
        other_electrical: 0,
      };
    }

    const bucket =
      byRoomType[
        roomType
      ];

    bucket.electrical_items +=
      1;

    const subtype =
      classifyElectricalSubtypeFromAps(
        assignment.entry.item
      );

    if (
      subtype === "lighting"
    ) {
      bucket.lighting_points +=
        1;
    } else if (
      subtype === "socket"
    ) {
      bucket.socket_points +=
        1;
    } else if (
      subtype === "switch"
    ) {
      bucket.switches +=
        1;
    } else if (
      subtype ===
        "distribution_board"
    ) {
      bucket.distribution_boards +=
        1;
    } else {
      bucket.other_electrical +=
        1;
    }
  }

  return {
    ...baseResult,
    valid: true,
    reason:
      "aps_electrical_centroid_to_verified_ai_room_bbox",
    byRoomType,
    assignedCount:
      best.assignments.filter(
        (item) =>
          item.room
      ).length,
    totalCount:
      electrical.length,
    coverage:
      Number(
        best.coverage.toFixed(
          4
        )
      ),
    regionCoverage:
      Number(
        best.regionCoverage.toFixed(
          4
        )
      ),
    averageRegionDistance:
      Number(
        best.averageRegionDistance.toFixed(
          4
        )
      ),
    roomTypesUsed:
      best.roomTypesUsed,
    transformIndex:
      best.transformIndex,
  };
}

function resolveRoomLocalElectricalQuantity(
  match,
  roomLocalMep
) {
  if (
    !roomLocalMep?.valid
  ) {
    return 0;
  }

  const roomType =
    String(
      match?.room_type || ""
    );

  const bucket =
    roomLocalMep.byRoomType[
      roomType
    ];

  if (!bucket) {
    return 0;
  }

  const code =
    String(
      match?.item_code || ""
    ).toUpperCase();

  if (code === "ELE-001") {
    return (
      bucket.lighting_points ||
      0
    );
  }

  if (code === "ELE-002") {
    return (
      bucket.socket_points ||
      0
    );
  }

  if (code === "ELE-003") {
    return (
      bucket.switches ||
      0
    );
  }

  if (code === "ELE-004") {
    return (
      bucket.distribution_boards ||
      0
    );
  }

  if (code === "ELE-005") {
    return (
      bucket.lighting_points ||
      0
    );
  }

  return (
    bucket.electrical_items ||
    0
  );
}


function buildDeterministicRoomElectricalMatches(
  roomLocalMep,
  pricesByCode
) {
  if (
    !roomLocalMep?.valid ||
    !roomLocalMep?.byRoomType ||
    !(pricesByCode instanceof Map)
  ) {
    return [];
  }

  const matches = [];

  const definitions = [
    {
      itemCode: "ELE-001",
      bucketKey:
        "lighting_points",
      label:
        "APS measured room lighting points",
    },
    {
      itemCode: "ELE-002",
      bucketKey:
        "socket_points",
      label:
        "APS measured room socket points",
    },
    {
      itemCode: "ELE-003",
      bucketKey:
        "switches",
      label:
        "APS measured room switches",
    },
    {
      itemCode: "ELE-004",
      bucketKey:
        "distribution_boards",
      label:
        "APS measured room distribution boards",
    },
  ];

  for (
    const [
      roomType,
      bucket,
    ] of Object.entries(
      roomLocalMep.byRoomType
    )
  ) {
    for (
      const definition of
        definitions
    ) {
      const quantity =
        Number(
          bucket?.[
            definition.bucketKey
          ]
        ) || 0;

      if (quantity <= 0) {
        continue;
      }

      const code =
        normalizeCode(
          definition.itemCode
        );

      if (
        !pricesByCode.has(code)
      ) {
        console.warn(
          "[VENTRA ROOM ELECTRICAL] catalog item missing",
          {
            item_code:
              definition.itemCode,
            room_type:
              roomType,
            measuredQuantity:
              quantity,
          }
        );

        continue;
      }

      matches.push({
        item_code:
          definition.itemCode,
        quantity_basis:
          "electrical_items",
        room_type:
          roomType,
        reason:
          `${definition.label}; injected deterministically because Autodesk APS measured this subtype in the matched room.`,
        deterministicRoomElectrical:
          true,
      });
    }
  }

  return matches;
}


async function handleCommercialRequest(request) {
  try {
    const body =
      await request.json();

    const projectId =
      body?.projectId || null;

    const projectName =
      body?.projectName ||
      "Untitled Project";

    const priceLevel =
      body?.priceLevel ||
      "standard";

    const vatPercentage = Math.max(
      0,
      toNumber(
        body?.vatPercentage ?? 5
      )
    );

    const rawTakeoff =
      body?.takeoff || {};

    // Reject interrupted extraction before catalog reads or row generation.
    // A provisional quantity can be reviewed; an unprocessed drawing set is
    // not a valid basis for replacing the project's BOQ with a smaller total.
    if(rawTakeoff.pdf_analysis){
      const total=Number(rawTakeoff.total_pages||rawTakeoff.pdf_analysis.total_pages||0);
      const analyzed=Array.isArray(rawTakeoff.page_results)?new Set(rawTakeoff.page_results.map(p=>p.pageNumber)).size:Number(rawTakeoff.analyzed_pages||0);
      const review=rawTakeoff.pdf_analysis.document_review_status?.status;
      if(rawTakeoff.pdf_analysis.summaryOnly || rawTakeoff.failed_pages?.length || rawTakeoff.pdf_analysis.failed_pages?.length ||
        total>0&&analyzed<total || ['failed','pending'].includes(review)){
        return NextResponse.json({success:false,code:'PDF_ANALYSIS_INCOMPLETE',error:
          `BOQ generation stopped: PDF page extraction or document review is incomplete (${analyzed}/${total||'?'} pages; review: ${review||'unavailable'}). The saved BOQ was not replaced. Recover complete source evidence before generating again.`},{status:409});
      }
    }

    const takeoff =
      normalizeTakeoff(
        rawTakeoff
      );

    const rawSemanticRooms =
      getSemanticRooms(rawTakeoff);

    const hydratedRoomResult =
      hydrateSemanticRoomQuantities(
        rawSemanticRooms,
        takeoff
      );

    const semanticRooms =
      hydratedRoomResult.rooms;

    const rawElectricalForSpatial =
      Array.isArray(
        rawTakeoff
          ?.object_details
          ?.mep
      )
        ? rawTakeoff.object_details.mep.filter(
            (item) =>
              item?.detectedType ===
                "electrical"
          )
        : [];

    const validElectricalForSpatial =
      rawElectricalForSpatial.filter(
        (item) => {
          const x =
            item?.centroid?.x;
          const y =
            item?.centroid?.y;

          return (
            x !== null &&
            x !== undefined &&
            x !== "" &&
            y !== null &&
            y !== undefined &&
            y !== "" &&
            Number.isFinite(
              Number(x)
            ) &&
            Number.isFinite(
              Number(y)
            )
          );
        }
      );

    console.log(
      "[VENTRA ELECTRICAL SPATIAL INPUT v14]",
      {
        total:
          rawElectricalForSpatial.length,
        withValidCentroid:
          validElectricalForSpatial.length,
        distinctCentroids:
          new Set(
            validElectricalForSpatial.map(
              (item) =>
                `${Number(
                  item.centroid.x
                ).toFixed(6)}:${Number(
                  item.centroid.y
                ).toFixed(6)}`
            )
          ).size,
        centroidSources:
          validElectricalForSpatial.reduce(
            (result, item) => {
              const source =
                item?.centroid?.source ||
                "unknown";

              result[source] =
                (
                  result[source] ||
                  0
                ) + 1;

              return result;
            },
            {}
          ),
      }
    );

    const worldRoomLocalMep =
      buildWorldRoomLocalMepCounts(
        rawTakeoff,
        semanticRooms
      );

    const roomCentroidDiagnostic =
      buildRoomCentroidElectricalCounts(
        rawTakeoff,
        semanticRooms
      );

    const imageRoomLocalDiagnostic =
      buildRoomLocalMepCounts(
        rawTakeoff,
        semanticRooms
      );

    const roomLocalMep =
      worldRoomLocalMep.valid
        ? {
            ...worldRoomLocalMep,
            fixVersion:
              "2026-08-17-electrical-centroid-root-v14",
          }
        : roomCentroidDiagnostic.valid
          ? {
              ...roomCentroidDiagnostic,
              fixVersion:
                "2026-08-17-electrical-centroid-root-v14",
              mapper:
                "verified_room_centroid_fallback",
              worldDiagnostic:
                worldRoomLocalMep,
              roomRegionDiagnostic:
                imageRoomLocalDiagnostic,
            }
          : imageRoomLocalDiagnostic.valid
            ? {
                ...imageRoomLocalDiagnostic,
                fixVersion:
                  "2026-08-17-electrical-centroid-root-v14",
                mapper:
                  "verified_ai_room_bbox_fallback",
                worldDiagnostic:
                  worldRoomLocalMep,
                roomCentroidDiagnostic,
              }
            : {
                valid: false,
                mapper:
                  "room_local_unavailable",
                fixVersion:
                  "2026-08-17-electrical-centroid-root-v14",
                reason:
                  `${worldRoomLocalMep.reason}; ${roomCentroidDiagnostic.reason}; ${imageRoomLocalDiagnostic.reason}`,
                byRoomType: {},
                assignedCount: 0,
                totalCount:
                  worldRoomLocalMep.totalCount ||
                  roomCentroidDiagnostic.totalCount ||
                  imageRoomLocalDiagnostic.totalCount ||
                  0,
                worldRoomCount:
                  worldRoomLocalMep.worldRoomCount ||
                  0,
                coverage:
                  roomCentroidDiagnostic.coverage ??
                  imageRoomLocalDiagnostic.coverage ??
                  worldRoomLocalMep.coverage ??
                  0,
                worldDiagnostic:
                  worldRoomLocalMep,
                roomCentroidDiagnostic,
                roomRegionDiagnostic:
                  imageRoomLocalDiagnostic,
              };

    console.log(
      "[VENTRA ROOM SPATIAL INPUT v12]",
      {
        semanticRoomCount:
          semanticRooms.length,
        roomsWithCentroid:
          semanticRooms.filter(
            (room) => {
              const x =
                room?.centroid?.x;
              const y =
                room?.centroid?.y;

              return (
                x !== null &&
                x !== undefined &&
                y !== null &&
                y !== undefined &&
                Number.isFinite(
                  Number(x)
                ) &&
                Number.isFinite(
                  Number(y)
                )
              );
            }
          ).length,
        distinctRoomCentroids:
          new Set(
            semanticRooms
              .filter(
                (room) =>
                  room?.centroid &&
                  room.centroid.x !==
                    null &&
                  room.centroid.x !==
                    undefined &&
                  room.centroid.y !==
                    null &&
                  room.centroid.y !==
                    undefined
              )
              .map(
                (room) =>
                  `${Number(
                    room.centroid.x
                  ).toFixed(6)}:${Number(
                    room.centroid.y
                  ).toFixed(6)}`
              )
          ).size,
        roomsWithRegionBBox:
          semanticRooms.filter(
            (room) =>
              room?.regionBBox &&
              Number(
                room.regionBBox.width
              ) > 0 &&
              Number(
                room.regionBBox.height
              ) > 0
          ).length,
        plans:
          [...new Set(
            semanticRooms
              .map(
                (room) =>
                  room?.planId
              )
              .filter(Boolean)
          )],
        sample:
          semanticRooms
            .slice(0, 4)
            .map(
              (room) => ({
                name:
                  room?.name,
                type:
                  room?.type,
                planId:
                  room?.planId ||
                  null,
                centroid:
                  room?.centroid ||
                  null,
                regionBBox:
                  room?.regionBBox ||
                  null,
              })
            ),
      }
    );

    console.log(
      "[VENTRA ROOM LOCAL MEP]",
      roomLocalMep
    );

    console.log(
      "[VENTRA ELECTRICAL SUBTYPE CLASSIFIER]",
      {
        total:
          Array.isArray(
            rawTakeoff
              ?.object_details
              ?.mep
          )
            ? rawTakeoff.object_details.mep.filter(
                (item) =>
                  item?.detectedType ===
                    "electrical"
              ).length
            : 0,
        counts:
          summarizeElectricalSubtypes(
            Array.isArray(
              rawTakeoff
                ?.object_details
                ?.mep
            )
              ? rawTakeoff.object_details.mep.filter(
                  (item) =>
                    item?.detectedType ===
                      "electrical"
                )
              : []
          ),
      }
    );

    console.log("[VENTRA AI BOQ SCOPE] input", {
      semanticRoomCount: semanticRooms.length,
      roomQuantityHydration:
        hydratedRoomResult.source,
      roomsWithArea:
        semanticRooms.filter(
          (room) =>
            Number(room?.area) > 0
        ).length,
      roomAreaTotal:
        Number(
          semanticRooms.reduce(
            (sum, room) =>
              sum +
              (Number(room?.area) || 0),
            0
          ).toFixed(2)
        ),
      rawRoomCount: toNumber(rawTakeoff.rooms),
      hasObjectDetails: Boolean(rawTakeoff.object_details),
      objectRoomCount: Array.isArray(rawTakeoff?.object_details?.rooms)
        ? rawTakeoff.object_details.rooms.length
        : 0,
    });
console.log("========== TAKEOFF ==========");
console.log(takeoff);
console.log("=============================");
    const supabase =
      createServerSupabase();

    const [
      rulesResult,
      pricesResult,
      sectionsResult,
    ] = await Promise.all([
      supabase

        .from("boq_rules")
        .select("*")
        .eq("is_active", true)
        .order("priority", {
          ascending: true,
        }),

      fetchAllActivePriceItems(
        supabase
      ),

      supabase
        .from("boq_sections")
        .select(
          "section_code, section_name, sort_order"
        )
        .eq("is_active", true),
    ]);
    console.log("[BOQ DEBUG]", {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  rulesCount: rulesResult.data?.length || 0,
  pricesCount: pricesResult.data?.length || 0,
  sectionsCount: sectionsResult.data?.length || 0,
  rulesError: rulesResult.error?.message || null,
  pricesError: pricesResult.error?.message || null,
  sectionsError: sectionsResult.error?.message || null,
  takeoff,
});

    if (rulesResult.error) {
      throw rulesResult.error;
    }

    if (pricesResult.error) {
      throw pricesResult.error;
    }

    if (sectionsResult.error) {
      throw sectionsResult.error;
    }

    const rules = rulesResult.data || [];
    const prices = pricesResult.data || [];

    if (prices.length === 0 || (!takeoff.pdf_analysis && rules.length === 0)) {
      const fallbackBoq = takeoff.pdf_analysis ? {items:[],warnings:[]} : buildLocalBoq({
        takeoff,
        projectName,
        vatPercentage,
      });

      const fallbackDwg = takeoff.pdf_analysis ? {items:[],warnings:[]} : applyDwgScheduleToBoq(fallbackBoq?.items || [], getDrawingEvidence(rawTakeoff) || {}, []);
      const fallbackPdf = retainUnboundPdfQuantities(fallbackDwg.items, takeoff);
      const fallbackPdfCompletion=annotatePdfBoqCompletion(fallbackPdf.items.map(requireBoqReview),takeoff,prices,priceLevel);
      const fallbackItems = fallbackPdfCompletion.items;
      fallbackItems.forEach((item,index)=>{item.itemNumber=String(index+1).padStart(2,'0');});
      const fallbackSubtotal = fallbackItems.reduce((sum, item) => sum + (classifyEstimateItem(item) === 'pending' ? 0 : Number(item.amount) || 0), 0);
      const fallbackVat = fallbackSubtotal * Number(vatPercentage || 0) / 100;

      if (fallbackItems.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              "BOQ database is empty and the fallback builder found no measurable quantities.",
            debug: {
              rules: rules.length,
              prices: prices.length,
              wallArea: takeoff.wall_area,
              wallLength: takeoff.wall_length,
              floorArea: takeoff.floor_area,
              rooms: takeoff.rooms,
              doors: takeoff.doors,
              windows: takeoff.windows,
            },
          },
          { status: 422 }
        );
      }

      return NextResponse.json({
        success: true,
        boq: {
          ...fallbackBoq,
          items: fallbackItems,
          pdfCompletion:fallbackPdfCompletion.summary,
          summary: {subtotal: fallbackSubtotal, vat: fallbackVat, grandTotal: fallbackSubtotal + fallbackVat},
          projectId,
          priceLevel,
          warnings: [
            `Ventra UAE BOQ database is not populated (rules: ${rules.length}, prices: ${prices.length}).`,
            takeoff.pdf_analysis ? "PDF quantities retained without rates. No allowance pricing was used." : "Starter allowance rates are being used. Review/edit rates before quotation or contract use.",
            ...fallbackPdf.warnings,
            ...fallbackDwg.warnings,
            ...(Array.isArray(fallbackBoq.warnings)
              ? fallbackBoq.warnings
              : []),
          ],
          assumptions: [
            ...(Array.isArray(fallbackBoq.assumptions)
              ? fallbackBoq.assumptions
              : []),
            "This BOQ used Ventra's deterministic local fallback because the database rule/price tables were empty.",
          ],
        },
      });
    }

    const pricesByCode =
      new Map(
        (pricesResult.data || []).map(
          (item) => [
            normalizeCode(item.item_code),
            item,
          ]
        )
      );

    const sectionsByCode =
      new Map(
        (
          sectionsResult.data || []
        ).map((section) => [
          section.section_code,
          section,
        ])
      );

    const warnings = [...(takeoff.pdf_analysis?.conflicts || [])];
    const items = [];
    const claimedMeasuredFamilies =
      new Set();

    const ventraBoqMode =
      String(
        process.env.VENTRA_BOQ_MODE ||
        "commercial_safe"
      ).trim().toLowerCase();

    const allowEstimatedQuantities =
      ventraBoqMode ===
      "development_estimates";

    // v29: commercial_safe may derive provisional quantities from measured
    // project evidence, but they NEVER enter the verified commercial subtotal.
    const allowProvisionalDerivation =
      ventraBoqMode ===
        "commercial_safe" ||
      allowEstimatedQuantities;

    console.log(
      "[VENTRA BOQ HARDENING v29]",
      {
        mode: ventraBoqMode,
        allowEstimatedQuantities,
        allowProvisionalDerivation,
        policy:
          allowEstimatedQuantities
            ? "development_estimates_enabled"
            : allowProvisionalDerivation
              ? "measured_plus_provisional_derived_scope"
              : "measured_only",
      }
    );

    const pdfCatalogPlan = takeoff.pdf_analysis ? planPdfCatalogRules(takeoff,rules,prices) : null;
    if(pdfCatalogPlan)warnings.push(...pdfCatalogPlan.warnings);
    const pdfConsumedCodes = new Set();

    for (
      const rule of
      pdfCatalogPlan?.rules || rulesResult.data || []
    ) {
      const priceItem =
        pricesByCode.get(
          normalizeCode(rule.item_code)
        );

      if (!priceItem) {
        warnings.push(
          `Missing price item: ${rule.item_code}`
        );

        continue;
      }

      if (
        !takeoff.pdf_analysis && shouldSuppressDatabaseAutoRule(
          rule,
          priceItem,
          claimedMeasuredFamilies
        )
      ) {
        console.log(
          "[VENTRA RULE SAFETY] suppressed",
          {
            item:
              rule.item_code,
            description:
              priceItem.description,
            reason:
              "conflicting_or_location_specific_database_auto_rule",
          }
        );

        continue;
      }

      let quantity =
        calculateQuantity(
          rule,
          takeoff
        );

      let quantityEstimate = null;
      const pdfCode=normalizeCode(priceItem.item_code);
      if(takeoff.pdf_analysis && pdfConsumedCodes.has(pdfCode))continue;
      if(takeoff.pdf_analysis)pdfConsumedCodes.add(pdfCode);
      const pdfQuantity=pdfCatalogPlan?.bindings.get(pdfCode)||null;
      if(takeoff.pdf_analysis){
        // No generic floor multipliers or one-item fallbacks for PDF evidence.
        // Unsupported mappings remain pending, not invented measured scope.
        quantity=pdfQuantity?.quantity??0;quantityEstimate=pdfQuantity;
      }

      if (
        !takeoff.pdf_analysis &&
        allowProvisionalDerivation &&
        quantity <= 0 &&
        String(
          rule.formula_type || ""
        ).toLowerCase() ===
          "manual"
      ) {
        // v32: resolve verified APS structural measurements BEFORE
        // provisional/manual allowances. In v31 the legacy allowance resolver
        // returned first (e.g. CON-006 = 16 * 3.6 = 57.6 m2), so the measured
        // structural resolver was never reached.
        quantityEstimate =
          estimateRemainingPendingQuantity(
            rule,
            priceItem,
            takeoff
          );

        if (
          Number(
            quantityEstimate.quantity
          ) <= 0 ||
          (
            quantityEstimate.measured !==
              true &&
            [
              "foundation",
              "column",
              "beam",
              "slab",
            ].includes(
              String(
                rule.geometry_type || ""
              ).toLowerCase()
            )
          )
        ) {
          const fallbackEstimate =
            estimatePendingRuleQuantity(
              rule,
              priceItem,
              takeoff
            );

          // Never replace a verified APS measurement with an allowance.
          if (
            quantityEstimate.measured !==
              true &&
            Number(
              fallbackEstimate.quantity
            ) > 0
          ) {
            quantityEstimate =
              fallbackEstimate;
          }
        }

        if (
          Number(
            quantityEstimate.quantity
          ) > 0
        ) {
          quantity =
            round(
              Number(
                quantityEstimate.quantity
              ),
              Number.isInteger(
                rule.rounding_precision
              )
                ? rule.rounding_precision
                : 2
            );
        }
      }

      console.log({
        item:
          rule.item_code,
        geometry:
          rule.geometry_type,
        property:
          rule.geometry_property,
        quantity,
        estimateSource:
          quantityEstimate?.source ||
          null,
      });

      if (
        [
          "foundation",
          "column",
          "beam",
          "slab",
        ].includes(
          String(
            rule.geometry_type || ""
          ).toLowerCase()
        ) ||
        quantityEstimate?.mappedGeometry
      ) {
        console.log(
          "[VENTRA STRUCTURAL BOQ BINDING v33]",
          {
            item:
              rule.item_code,
            geometry:
              rule.geometry_type,
            mappedGeometry:
              quantityEstimate?.mappedGeometry ||
              null,
            description:
              priceItem.description,
            unit:
              priceItem.unit,
            quantity,
            source:
              quantityEstimate?.source ||
              null,
            measured:
              quantityEstimate?.measured ===
              true,
          }
        );
      }

      const isManualRule =
        String(
          rule.formula_type || ""
        ).toLowerCase() === "manual";

      const isQuantityPending =
        quantity <= 0;

      const isMeasuredDerivedRule =
        Number(
          quantityEstimate?.quantity
        ) > 0 &&
        quantityEstimate?.measured ===
          true;

      const isEstimatedRule =
        Number(
          quantityEstimate?.quantity
        ) > 0 &&
        !isMeasuredDerivedRule;

      // IMPORTANT:
      // Manual / future-quantity rules must remain visible in the BOQ.
      // They are scope coverage, not priced quantities yet.
      // Non-manual rules that unexpectedly resolve to zero are still skipped.
      if (
        isQuantityPending &&
        !isManualRule && !takeoff.pdf_analysis
      ) {
        continue;
      }

      const section =
        sectionsByCode.get(
          rule.section_code ||
            priceItem.section_code
        );

      const rateResolution =
        takeoff.pdf_analysis ? resolvePdfCatalogRate(priceItem,priceLevel) : resolveRate(
          priceItem,
          priceLevel,
          prices
        );
      const pdfRatePending=Boolean(pdfQuantity&&rateResolution.missingRate);
      if(pdfRatePending)warnings.push(`PDF catalog item ${pdfCode} has no own rate. Its measured quantity is retained without a peer or median rate.`);

      const unitRate =
        rateResolution.rate;

      if (
        rateResolution.source !==
          `direct_${String(
            priceLevel ||
            "standard"
          ).toLowerCase()}_rate`
      ) {
        console.log(
          "[VENTRA RATE RESOLVER]",
          {
            item:
              priceItem.item_code,
            description:
              priceItem.description,
            selectedPriceLevel:
              priceLevel,
            standardRate:
              toNumber(
                priceItem.standard_rate
              ),
            economyRate:
              toNumber(
                priceItem.economy_rate
              ),
            premiumRate:
              toNumber(
                priceItem.premium_rate
              ),
            componentRate:
              toNumber(
                priceItem.material_rate
              ) +
              toNumber(
                priceItem.labor_rate
              ) +
              toNumber(
                priceItem.equipment_rate
              ) +
              toNumber(
                priceItem.transport_rate
              ),
            resolvedRate:
              unitRate,
            source:
              rateResolution.source,
            peerCount:
              rateResolution.peerCount,
          }
        );
      }

      const amount =
        isQuantityPending
          ? 0
          : round(
              quantity * unitRate,
              2
            );

      const commercialRate =
        isQuantityPending
          ? 0
          : unitRate;

      const measuredFamily =
        getMeasuredRuleFamily(
          rule,
          priceItem
        );

      if (measuredFamily) {
        claimedMeasuredFamilies.add(
          measuredFamily
        );
      }

      items.push({
        itemNumber: "",
        itemCode:
          priceItem.item_code,

        sectionCode:
          rule.section_code ||
          priceItem.section_code ||
          "00",

        section:
          section?.section_name ||
          priceItem.category ||
          "General",

        category:
          priceItem.category ||
          "",

        subCategory:
          priceItem.sub_category ||
          "",

        description:
          priceItem.description,

        unit:
          priceItem.unit ||
          "item",

        quantity,

        materialRate:
          toNumber(
            priceItem.material_rate
          ),

        laborRate:
          toNumber(
            priceItem.labor_rate
          ),

        equipmentRate:
          toNumber(
            priceItem.equipment_rate
          ),

        transportRate:
          toNumber(
            priceItem.transport_rate
          ),

        rate: round(
          commercialRate,
          2
        ),

        referenceRate:
          round(
            unitRate,
            2
          ),

        rateSource:
          isQuantityPending
            ? "reference_rate_not_priced_until_quantity_verified"
            : rateResolution.source,

        rateMissing:
          rateResolution.missingRate,

        amount,

        priceLevel,
        source:
          isQuantityPending
            ? "Ventra Rule Library - Quantity Pending"
            : isEstimatedRule
              ? "Ventra Rule Library - Estimated Quantity"
              : pdfQuantity ? "PDF schedule - requires review" : (
                  priceItem.source_name ||
                  "Ventra UAE Base Rate"
                ),

        status:
          isQuantityPending
            ? "quantity_pending"
            : pdfRatePending
              ? "measured_rate_pending"
            : isEstimatedRule
              ? "provisional_estimate"
              : "measured",

        verification:
          isQuantityPending
            ? "pending"
            : pdfRatePending
              ? "pending"
            : isEstimatedRule
              ? "provisional"
              : "verified",

        includeInCommercialTotal:
          !isQuantityPending &&
          !isEstimatedRule && !pdfRatePending,

        measuredFromApsStructure:
          isMeasuredDerivedRule && !pdfQuantity,
        pdfEvidence:pdfQuantity?{metricKey:pdfQuantity.metricKey,...(pdfQuantity.metricKeys?{metricKeys:pdfQuantity.metricKeys}:{}),pages:pdfQuantity.pages,basis:pdfQuantity.evidence}:null,

        confidence:
          isEstimatedRule
            ? Math.min(
                toNumber(
                  quantityEstimate
                    ?.confidence
                ) || 35,
                65
              )
            : toNumber(
                priceItem.confidence_score
              ),

        quantityBasis:
          isQuantityPending ? "unavailable" : quantityEstimate
            ?.source ||
          (
            isEstimatedRule
              ? "derived_allowance"
              : "measured_takeoff"
          ),

        quantitySource:
          pdfQuantity ? "pdf_schedule_evidence" : isMeasuredDerivedRule
            ? "aps_measured_structural_properties"
            : isEstimatedRule
              ? "derived_from_verified_project_metrics"
              : isQuantityPending
                ? "unavailable"
                : "measured",

        notes:
          [
            pdfRatePending ? "The matched catalog item has no own rate. Quantity retained; no peer or median rate borrowed." : "",
            pdfQuantity ? "Quantity transcribed from PDF evidence; scope, specification and rate require review." : rule.notes || "",
            pdfQuantity ? `PDF SCHEDULE EVIDENCE (AI; REVIEW REQUIRED): pages ${pdfQuantity.pages.join(", ")}; ${pdfQuantity.evidence}` : isEstimatedRule
              ? `PROVISIONAL: ${quantityEstimate?.source || "derived allowance"}. Excluded from verified commercial subtotal until replaced by measured quantity.`
              : isMeasuredDerivedRule
                ? `MEASURED FROM APS STRUCTURAL PROPERTIES: ${quantityEstimate?.source || "structural measurement"}.`
                : "",
          ]
            .filter(Boolean)
            .join(" "),
      });
    }


    // ------------------------------------------------------------
    // v36 FINAL BOQ: verified member quantity + deterministic catalog rate.
    //
    // The drawing proves the column concrete quantity (4.21 m3) but not the
    // concrete grade. Instead of leaving a zero-value row, select a conservative
    // concrete catalog rate deterministically from the existing UAE price
    // library. Prefer C25/general structural concrete; otherwise use the lowest
    // valid concrete m3 rate in section 03. This keeps testing fully local and
    // avoids OpenAI/API cost.
    // ------------------------------------------------------------
    const v36ColumnVolume =
      Number(
        takeoff?.column_volume
      ) || 0;

    const v36ColumnMeasured =
      takeoff
        ?.structural_measurement_status
        ?.columns
        ?.volumeMeasured === true;

    if (
      !takeoff.pdf_analysis && v36ColumnMeasured &&
      v36ColumnVolume > 0
    ) {
      const v36Quantity =
        Math.round(
          v36ColumnVolume * 100
        ) / 100;

      const v36ConcreteCandidates =
        (pricesResult.data || [])
          .filter((candidate) => {
            const unit =
              normalizeRateUnit(
                candidate?.unit
              );

            const description =
              String(
                candidate?.description ||
                ""
              ).toLowerCase();

            const sectionCode =
              String(
                candidate?.section_code ||
                ""
              ).trim();

            return (
              unit === "m3" &&
              /concrete/.test(
                description
              ) &&
              !/block|masonry|screed|precast|kerb|curb/.test(
                description
              ) &&
              (
                sectionCode === "03" ||
                /reinforced|structural|c25|c30/.test(
                  description
                )
              )
            );
          })
          .map((candidate) => {
            const rateResolution =
              resolveRate(
                candidate,
                priceLevel,
                pricesResult.data || []
              );

            const description =
              String(
                candidate?.description ||
                ""
              ).toLowerCase();

            let score = 0;

            if (/c25/.test(description)) {
              score += 8;
            }

            if (/reinforced/.test(description)) {
              score += 5;
            }

            if (/structural/.test(description)) {
              score += 4;
            }

            if (/column/.test(description)) {
              score += 3;
            }

            if (
              String(
                candidate?.section_code ||
                ""
              ).trim() === "03"
            ) {
              score += 3;
            }

            return {
              candidate,
              rate:
                Number(
                  rateResolution?.rate
                ) || 0,
              rateSource:
                rateResolution?.source ||
                "catalog_rate",
              score,
            };
          })
          .filter(
            (candidate) =>
              candidate.rate > 0
          )
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.rate - b.rate
          );

      const v36SelectedConcrete =
        v36ConcreteCandidates[0] ||
        null;

      const v36Rate =
        v36SelectedConcrete
          ?.rate || 0;

      const v36Amount =
        Math.round(
          v36Quantity *
          v36Rate *
          100
        ) / 100;

      items.push({
        itemNumber: "",
        itemCode:
          "VSTR-COLUMN-CONC",
        sectionCode: "03",
        section: "Concrete Works",
        category: "Concrete Works",
        subCategory:
          "Column Concrete",
        description:
          v36SelectedConcrete
            ? `Reinforced concrete to columns - priced from ${v36SelectedConcrete.candidate?.description || "UAE concrete catalog"}`
            : "Reinforced concrete to columns - rate pending",
        unit: "m³",
        quantity:
          v36Quantity,
        materialRate: 0,
        laborRate: 0,
        equipmentRate: 0,
        transportRate: 0,
        rate:
          v36Rate,
        referenceRate:
          v36Rate,
        rateSource:
          v36SelectedConcrete
            ? `structural_catalog_${v36SelectedConcrete.rateSource}`
            : "rate_pending_no_safe_concrete_catalog_match",
        rateMissing:
          v36Rate <= 0,
        amount:
          v36Amount,
        priceLevel,
        source:
          "Autodesk APS Structural Measurement + Ventra UAE Price Library",
        status:
          v36Rate > 0
            ? "measured"
            : "measured_rate_pending",
        verification:
          "verified",
        includeInCommercialTotal:
          v36Rate > 0,
        measuredFromApsStructure:
          true,
        confidence:
          v36Rate > 0
            ? 94
            : 90,
        quantityBasis:
          "aps_measured_column_volume",
        quantitySource:
          "aps_measured_structural_properties",
        notes:
          v36SelectedConcrete
            ? "Column volume measured from APS. Rate selected deterministically from the existing UAE concrete price catalog; no OpenAI call used."
            : "Column volume measured from APS. No safe concrete catalog rate was available.",
      });

      console.log(
        "[VENTRA FINAL COLUMN CONCRETE v36]",
        {
          quantity:
            v36Quantity,
          rate:
            v36Rate,
          amount:
            v36Amount,
          selectedCatalogItem:
            v36SelectedConcrete
              ?.candidate
              ?.item_code ||
            null,
          selectedDescription:
            v36SelectedConcrete
              ?.candidate
              ?.description ||
            null,
          rateSource:
            v36SelectedConcrete
              ?.rateSource ||
            null,
          commercial:
            v36Rate > 0,
        }
      );
    }

    // AI scope expansion:
    // OpenAI decides WHAT construction scopes apply to the detected semantic
    // rooms. Deterministic Ventra geometry still decides HOW MUCH.
    // The model never invents rates, item codes, dimensions, or quantities.
    let aiScopePlan = null;
    let aiScopeMatches = [];

    const ventraMode =
      String(
        process.env.NEXT_PUBLIC_VENTRA_MODE ||
        process.env.VENTRA_MODE ||
        "production"
      )
        .trim()
        .toLowerCase();

    const allowBoqAi = !takeoff.pdf_analysis && (
      String(
        process.env.VENTRA_ENABLE_BOQ_AI ||
        ""
      )
        .trim()
        .toLowerCase() === "true" ||
      (
        ventraMode === "production" &&
        String(
          process.env.VENTRA_DISABLE_BOQ_AI ||
          ""
        )
          .trim()
          .toLowerCase() !== "true"
      ));

    console.log(
      "[VENTRA LOW COST v23] BOQ AI gate",
      {
        ventraMode,
        allowBoqAi,
        semanticRoomCount:
          semanticRooms.length,
        behavior:
          allowBoqAi
            ? "openai_scope_expansion_enabled"
            : "deterministic_boq_only_openai_skipped",
      }
    );

    if (
      allowBoqAi &&
      semanticRooms.length > 0
    ) {
      try {
        aiScopePlan =
          await inferConstructionScopes({
            rooms: semanticRooms,
            takeoff,
          });

        const scopeSearchTerms = [
          ...(aiScopePlan.catalog_search_terms || []),
          ...(aiScopePlan.scopes || []).flatMap((scope) => [
            scope.work,
            scope.trade,
            `${scope.trade || ""} ${scope.work || ""}`.trim(),
          ]),
        ];

        const catalogCandidates =
          shortlistPriceCatalog(
            prices,
            scopeSearchTerms,
            500
          );

        console.log("[VENTRA AI BOQ SCOPE] plan", {
          semanticRooms: semanticRooms.map((room) => ({
            name: room.name,
            type: room.type,
            area: room.area,
            perimeter: room.perimeter,
          })),
          scopesCount: aiScopePlan.scopes?.length || 0,
          searchTermsCount: scopeSearchTerms.length,
          catalogCandidates: catalogCandidates.length,
        });

        const matched =
          await matchScopesToCatalog({
            scopes:
              aiScopePlan.scopes || [],
            candidates:
              catalogCandidates,
          });

        const deterministicElectricalMatches =
          buildDeterministicRoomElectricalMatches(
            roomLocalMep,
            pricesByCode
          );

        const mergedMatches = [];
        const mergedMatchKeys =
          new Set();

        for (
          const match of [
            ...(matched.matches || []),
            ...deterministicElectricalMatches,
          ]
        ) {
          const key =
            `${normalizeCode(
              match?.item_code
            )}|${String(
              match?.room_type ||
              ""
            )}`;

          if (
            mergedMatchKeys.has(
              key
            )
          ) {
            continue;
          }

          mergedMatchKeys.add(
            key
          );

          mergedMatches.push(
            match
          );
        }

        console.log("[VENTRA AI BOQ SCOPE] catalog matches", {
          returnedMatches:
            matched.matches?.length || 0,
          deterministicElectricalMatches:
            deterministicElectricalMatches.length,
          mergedMatches:
            mergedMatches.length,
          matches:
            mergedMatches.slice(
              0,
              80
            ),
        });

        const candidateCodes =
          new Set(
            catalogCandidates.map(
              (item) =>
                normalizeCode(
                  item.item_code
                )
            )
          );

        const existingCodes =
          new Set(
            items.map((item) =>
              normalizeCode(
                item.itemCode
              )
            )
          );

        const measuredRoomLocalCodes =
          new Set();

        for (const match of mergedMatches) {
          const code =
            normalizeCode(
              match.item_code
            );

          // Hard safety lock: AI cannot escape the catalog supplied to it.
          if (
            !candidateCodes.has(code) &&
            match
              ?.deterministicRoomElectrical !==
              true
          ) {
            continue;
          }

          const existingItemIndex =
            items.findIndex(
              (item) =>
                normalizeCode(
                  item.itemCode
                ) === code
            );

          const existingItem =
            existingItemIndex >= 0
              ? items[
                  existingItemIndex
                ]
              : null;

          const priceItem =
            pricesByCode.get(code);

          if (!priceItem) {
            continue;
          }

          const effectiveQuantityBasis =
            getSafeQuantityBasis(
              match,
              priceItem
            );

          const effectiveMatch = {
            ...match,
            quantity_basis:
              effectiveQuantityBasis,
          };

          const roomLocalElectricalQuantity =
            effectiveQuantityBasis ===
              "electrical_items"
              ? resolveRoomLocalElectricalQuantity(
                  match,
                  roomLocalMep
                )
              : 0;

          const quantity =
            round(
              roomLocalElectricalQuantity > 0
                ? roomLocalElectricalQuantity
                : resolveAiQuantity({
                    match:
                      effectiveMatch,
                    rooms:
                      semanticRooms,
                    takeoff,
                  }),
              2
            );

          // Never fabricate a quantity just to make the BOQ longer.
          // Room-specific scopes must have room-local measurable quantities.
          if (quantity <= 0) {
            console.log(
              "[VENTRA AI BOQ SCOPE] rejected quantity",
              {
                item_code:
                  priceItem.item_code,
                room_type:
                  match.room_type,
                quantity_basis:
                  effectiveQuantityBasis,
                reason:
                  "no_safe_room_local_quantity",
              }
            );

            continue;
          }

          const section =
            sectionsByCode.get(
              priceItem.section_code
            );

          const rateResolution =
            resolveRate(
              priceItem,
              priceLevel,
              prices
            );

          const unitRate =
            rateResolution.rate;

          if (
            unitRate <= 0
          ) {
            console.log(
              "[VENTRA RATE MISSING]",
              {
                item:
                  priceItem.item_code,
                description:
                  priceItem.description,
                selectedPriceLevel:
                  priceLevel,
                standardRate:
                  toNumber(
                    priceItem.standard_rate
                  ),
                economyRate:
                  toNumber(
                    priceItem.economy_rate
                  ),
                premiumRate:
                  toNumber(
                    priceItem.premium_rate
                  ),
                materialRate:
                  toNumber(
                    priceItem.material_rate
                  ),
                laborRate:
                  toNumber(
                    priceItem.labor_rate
                  ),
                equipmentRate:
                  toNumber(
                    priceItem.equipment_rate
                  ),
                transportRate:
                  toNumber(
                    priceItem.transport_rate
                  ),
              }
            );
          }

          const amount =
            round(
              quantity *
                unitRate,
              2
            );

          if (
            roomLocalElectricalQuantity > 0 &&
            existingItem &&
            existingItem.status ===
              "measured_estimated"
          ) {
            const firstMeasuredRoomForCode =
              !measuredRoomLocalCodes.has(
                code
              );

            existingItem.quantity =
              round(
                firstMeasuredRoomForCode
                  ? quantity
                  : (
                      Number(
                        existingItem.quantity
                      ) || 0
                    ) +
                    quantity,
                2
              );

            existingItem.rate =
              round(
                unitRate,
                2
              );

            existingItem.rateSource =
              rateResolution.source;

            existingItem.rateMissing =
              rateResolution.missingRate;

            existingItem.amount =
              round(
                existingItem.quantity *
                  unitRate,
                2
              );

            existingItem.source =
              "Autodesk APS Room-local Measurement";

            existingItem.status =
              "measured";

            existingItem.notes =
              `${
                firstMeasuredRoomForCode
                  ? "Replaced estimated electrical allowance with measured APS room-local quantities."
                  : existingItem.notes || ""
              } Room ${match.room_type}: ${quantity}. ${match.reason}`.trim();

            measuredRoomLocalCodes.add(
              code
            );
          } else if (
            roomLocalElectricalQuantity > 0 &&
            existingItem &&
            existingItem.source ===
              "Autodesk APS Room-local Measurement"
          ) {
            existingItem.quantity =
              round(
                (Number(
                  existingItem.quantity
                ) || 0) +
                  quantity,
                2
              );

            existingItem.amount =
              round(
                existingItem.quantity *
                  unitRate,
                2
              );

            existingItem.notes =
              `${
                existingItem.notes || ""
              } Room ${match.room_type}: ${quantity}.`.trim();

            measuredRoomLocalCodes.add(
              code
            );
          } else if (
            existingItem &&
            existingItem.status ===
              "quantity_pending"
          ) {
            // Upgrade the registered database scope instead of rejecting it
            // as a duplicate. This is the missing bridge that kept 39 rules
            // visible but permanently priced at zero.
            existingItem.quantity =
              round(
                (Number(
                  existingItem.quantity
                ) || 0) +
                  quantity,
                2
              );

            existingItem.rate =
              round(
                unitRate,
                2
              );

            existingItem.rateSource =
              rateResolution.source;

            existingItem.rateMissing =
              rateResolution.missingRate;

            existingItem.amount =
              round(
                existingItem.quantity *
                  unitRate,
                2
              );

            existingItem.source =
              "Ventra AI Scope Engine";

            existingItem.status =
              "measured_estimated";

            existingItem.notes =
              `${
                existingItem.notes || ""
              } AI quantity upgrade: ${match.reason} Basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}. ${
                semanticRooms.some(
                  (room) =>
                    room.type ===
                      match.room_type &&
                    room.areaEstimated
                )
                  ? "Room quantity is currently estimated from semantic room layout and Autodesk total floor area."
                  : ""
              }`.trim();
          } else if (!existingItem) {
            items.push({
              itemNumber: "",
              itemCode:
                priceItem.item_code,
              sectionCode:
                priceItem.section_code ||
                "00",
              section:
                section?.section_name ||
                priceItem.category ||
                "General",
              category:
                priceItem.category ||
                "",
              subCategory:
                priceItem.sub_category ||
                "",
              description:
                priceItem.description,
              unit:
                priceItem.unit ||
                "item",
              quantity,
              materialRate:
                toNumber(
                  priceItem.material_rate
                ),
              laborRate:
                toNumber(
                  priceItem.labor_rate
                ),
              equipmentRate:
                toNumber(
                  priceItem.equipment_rate
                ),
              transportRate:
                toNumber(
                  priceItem.transport_rate
                ),
              rate:
                round(
                  unitRate,
                  2
                ),
              amount,
              priceLevel,
              source:
                roomLocalElectricalQuantity > 0
                  ? "Autodesk APS Room-local Measurement"
                  : "Ventra AI Scope Engine",
              status:
                roomLocalElectricalQuantity > 0
                  ? "measured"
                  : semanticRooms.some(
                      (room) =>
                        room.type ===
                          match.room_type &&
                        room.areaEstimated
                    )
                    ? "measured_estimated"
                    : "measured",
              confidence:
                toNumber(
                  priceItem.confidence_score
                ),
              notes:
                `AI scope: ${match.reason} Quantity basis: ${effectiveQuantityBasis}. Room type: ${match.room_type}.`,
            });
          } else if (
            existingItem.source ===
              "Ventra AI Scope Engine" ||
            existingItem.status ===
              "measured_estimated"
          ) {
            // Same catalog item may legitimately be selected for multiple
            // room types. Aggregate the quantities instead of silently
            // discarding the later rooms.
            existingItem.quantity =
              round(
                (Number(
                  existingItem.quantity
                ) || 0) +
                  quantity,
                2
              );

            existingItem.amount =
              round(
                existingItem.quantity *
                  unitRate,
                2
              );
          } else {
            // Existing deterministic measured rule wins over AI duplicate.
            continue;
          }

          existingCodes.add(code);

          aiScopeMatches.push({
            item_code:
              priceItem.item_code,
            quantity_basis:
              effectiveQuantityBasis,
            room_type:
              match.room_type,
            quantity,
            roomLocalQuantity:
              roomLocalElectricalQuantity > 0,
            deterministicRoomElectrical:
              match
                ?.deterministicRoomElectrical ===
                true,
            upgradedPendingRule:
              Boolean(
                existingItem &&
                existingItem.status ===
                  "measured_estimated"
              ),
          });
        }

        console.log("[VENTRA AI BOQ SCOPE] accepted", {
          acceptedItems: aiScopeMatches.length,
          items: aiScopeMatches,
          safetyMode:
            "room_specific_scopes_require_room_local_quantities",
        });
      } catch (aiScopeError) {
        warnings.push(
          `AI scope expansion skipped: ${
            aiScopeError instanceof Error
              ? aiScopeError.message
              : "unknown error"
          }`
        );

        console.warn(
          "[VENTRA AI BOQ SCOPE]",
          aiScopeError
        );
      }
    }

    const dwgResult = takeoff.pdf_analysis ? {items:[...items],warnings:[]} : applyDwgScheduleToBoq(items, getDrawingEvidence(rawTakeoff) || {}, prices.map((price) => {
      const resolved = resolveRate(price, priceLevel, prices);
      return {...price, resolvedRate: resolved.missingRate ? 0 : resolved.rate, resolvedSource: resolved.source};
    }));
    items.splice(0, items.length, ...dwgResult.items);
    warnings.push(...dwgResult.warnings);
    if (getDrawingEvidence(rawTakeoff)?.extractionError) warnings.push(`DWG schedule extraction: ${getDrawingEvidence(rawTakeoff).extractionError}`);

    const pdfCoverage = retainUnboundPdfQuantities(items, takeoff);
    items.splice(0, items.length, ...pdfCoverage.items);
    warnings.push(...pdfCoverage.warnings);

    // Apply after both deterministic and AI rules, before totals are calculated.
    items.forEach((item, index) => { items[index] = requireBoqReview(item); });
    const pdfCompletion=annotatePdfBoqCompletion(items,takeoff,prices,priceLevel);
    if(pdfCompletion.summary){
      items.splice(0,items.length,...pdfCompletion.items);
      warnings.push(`PDF BOQ: ${pdfCompletion.summary.unpricedMeasuredOperations} measured operations need specification/catalog-rate resolution. ${pdfCompletion.summary.catalogOptionsWithoutQuantity} zero-quantity catalog rows are options, not a count of missing project measurements. See each row's notes for required information.`);
    }
    console.log("[VENTRA BOQ EVIDENCE v37]", { reviewRequiredItems: items.filter((item) => item.reviewRequired).length, automaticScheduleReconciliation: true });
    warnings.push("Catalog descriptions and budget rates require project-specific review. Measured quantities alone do not verify scope or specification. Accepted DWG schedule quantities and explicit material notes are reconciled separately; unreadable or conflicting evidence remains unresolved.");

    console.log(
      "[VENTRA STRUCTURAL MEASUREMENT v30]",
      {
        slabVolume:
          Number(takeoff?.slab_volume) || 0,
        columnVolume:
          Number(takeoff?.column_volume) || 0,
        beamVolume:
          Number(takeoff?.beam_volume) || 0,
        foundationVolume:
          Number(takeoff?.foundation_volume) || 0,
        columnFormworkArea:
          Number(takeoff?.column_formwork_area) || 0,
        beamFormworkArea:
          Number(takeoff?.beam_formwork_area) || 0,
        foundationFormworkArea:
          Number(takeoff?.foundation_formwork_area) || 0,
        slabFormworkArea:
          Number(takeoff?.slab_formwork_area) || 0,
        status:
          takeoff?.structural_measurement_status || null,
        measuredStructuralItems:
          items.filter(
            (item) =>
              item.measuredFromApsStructure ===
              true
          ).length,
      }
    );

    console.log(
      "[VENTRA BOQ RULE VISIBILITY]",
      {
        totalVisibleItems:
          items.length,
        measuredItems:
          items.filter(
            (item) =>
              item.status ===
              "measured"
          ).length,
        provisionalItems:
          items.filter(
            (item) =>
              item.status ===
              "provisional_estimate"
          ).length,
        measuredStructuralItems:
          items.filter(
            (item) =>
              item.measuredFromApsStructure ===
              true
          ).length,
        quantityPendingItems:
          items.filter(
            (item) =>
              item.status ===
              "quantity_pending"
          ).length,
        zeroAmountItems:
          items.filter(
            (item) =>
              Number(
                item.amount
              ) === 0
          ).length,
        missingRateItems:
          items.filter(
            (item) =>
              item.rateMissing ===
              true
          ).length,
        peerRateFallbackItems:
          items.filter(
            (item) =>
              (
                String(
                  item.rateSource || ""
                ).includes(
                  "median_rate"
                ) ||
                String(
                  item.rateSource || ""
                ).includes(
                  "median"
                )
              )
          ).length,
      }
    );

    items.sort((a, b) => {
      const sectionCompare =
        String(
          a.sectionCode
        ).localeCompare(
          String(
            b.sectionCode
          )
        );

      if (sectionCompare !== 0) {
        return sectionCompare;
      }

      return String(
        a.itemCode
      ).localeCompare(
        String(
          b.itemCode
        )
      );
    });

    items.forEach(
      (item, index) => {
        item.itemNumber =
          `${item.sectionCode}.${String(
            index + 1
          ).padStart(2, "0")}`;
      }
    );

    const verifiedSubtotal =
      round(
        items
          .filter(
            (item) =>
              item.includeInCommercialTotal ===
              true
          )
          .reduce(
            (sum, item) =>
              sum +
              Number(item.amount || 0),
            0
          ),
        2
      );

    const provisionalSubtotal =
      round(
        items
          .filter(
            (item) =>
              item.status ===
              "provisional_estimate"
          )
          .reduce(
            (sum, item) =>
              sum +
              Number(item.amount || 0),
            0
          ),
        2
      );

    const pendingItems =
      items.filter(
        (item) =>
          ["quantity_pending", "measured_rate_pending"].includes(item.status)
      ).length;

    const subtotal =
      verifiedSubtotal;

    const vatAmount = round(
      verifiedSubtotal *
        (vatPercentage / 100),
      2
    );

    const grandTotal = round(
      verifiedSubtotal +
        vatAmount,
      2
    );

    console.log(
      "[VENTRA COMMERCIAL TOTAL v24]",
      {
        verifiedSubtotal,
        provisionalSubtotal,
        pendingItems,
        quotedSubtotal: subtotal,
      }
    );

    if (projectId && items.length) {
      const {
        error: deleteError,
      } = await supabase
        .from("project_boq_items")
        .delete()
        .eq(
          "project_id",
          projectId
        )
        .eq(
          "source",
          "Ventra Rule Engine"
        );

      if (deleteError) {
        throw deleteError;
      }

      const rows = items.map(
        (item, index) => ({
          project_id:
            projectId,

          section_code:
            item.sectionCode,

          item_code:
            item.itemCode,

          description:
            item.description,

          unit:
            item.unit,

          quantity:
            item.quantity,

          material_rate:
            item.materialRate,

          labor_rate:
            item.laborRate,

          equipment_rate:
            item.equipmentRate,

          transport_rate:
            item.transportRate,

          unit_rate:
            item.rate,

          total_amount:
            item.amount,

          source:
            item.source ||
            "Ventra Rule Engine",

          notes:
            item.notes,

          sort_order:
            index + 1,
        })
      );

      const {
        error: insertError,
      } = await supabase
        .from("project_boq_items")
        .insert(rows);

      if (insertError) {
        throw insertError;
      }
    }
if (items.length === 0) {
  return NextResponse.json(
    {
      success: false,
      error: `No BOQ items generated. Rules: ${
        rulesResult.data?.length || 0
      }, Prices: ${
        pricesResult.data?.length || 0
      }, Wall area: ${
        takeoff.wall_area
      }, Wall length: ${
        takeoff.wall_length
      }`,
      debug: {
        rules: (rulesResult.data || []).map((rule) => ({
          item_code: rule.item_code,
          geometry_type: rule.geometry_type,
          geometry_property: rule.geometry_property,
          formula_type: rule.formula_type,
          multiplier: rule.multiplier,
        })),
        availablePriceCodes: (pricesResult.data || []).map(
          (item) => item.item_code
        ),
      },
    },
    { status: 422 }
  );
}
    return NextResponse.json({
      success: true,

      boq: {
        projectId,
        projectName,
        currency: "AED",
        priceLevel,
        takeoff,
        items,
        assumptions: [
          "Quantities were generated from detected drawing geometry.",
          "Rates were loaded from the Ventra UAE price database.",
        ],
        warnings,
        pdfCatalogAudit:pdfCatalogPlan?.catalogAudit||null,
        pdfCompletion:pdfCompletion.summary,
        aiScope: {
          detectedRooms:
            semanticRooms.map((room) => ({
              name: room.name,
              type: room.type,
              area: room.area,
              perimeter: room.perimeter,
            })),
          plannedScopes:
            aiScopePlan?.scopes || [],
          matchedItems:
            aiScopeMatches,
        },
        summary: {
          totalItems:
            items.length,
          verifiedItems:
            items.filter(
              (item) =>
                item.status ===
                "measured"
            ).length,
          provisionalItems:
            items.filter(
              (item) =>
                item.status ===
                "provisional_estimate"
            ).length,
          pendingItems,
          verifiedSubtotal,
          provisionalSubtotal,
          subtotal,
          vatPercentage,
          vatAmount,
          grandTotal,
          commercialSafe: false,
          evidencePolicyVersion: 37,
          scopeCoverage: "unconfirmed",
          reviewRequiredItems: items.filter((item) => item.reviewRequired).length,
        },
      },
    });
  } catch (error) {
    console.error(
      "[Generate BOQ]",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate BOQ.",
      },
      {
        status: 500,
      }
    );
  }
}
export async function runBoqRequest(request){return commercialRun(request,'boq',handleCommercialRequest);}
