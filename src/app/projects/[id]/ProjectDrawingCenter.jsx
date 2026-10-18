"use client";
import {beginDrawingWorkflow,finishDrawingWorkflow,drawingWorkflowState} from '@/lib/drawingWorkflowGate.mjs';
import {latestPdfReportForExport} from '@/lib/pdfReportExport.mjs';
import {resolveDrawingSelection,schematicRequestKey,isSelectedApsDrawing} from '@/lib/drawingSelection.mjs';
import {apsManifestGeometry} from "@/lib/apsViewables.mjs";
import {dwgReconstructionReadiness} from "@/lib/dwgCalibration.mjs";
import {saveSchematic,saveActiveSource,selectSchematicDrawing,selectDrawingDocument,selectedDrawingSync,drawingSceneMatches} from "@/lib/schematicStorage.mjs";
import {collectInteriorRoomLabels} from "@/lib/dwgRoomBoundaries.mjs";
import {applyDesignDefaults} from "@/lib/designDefaults.mjs";
import DwgUnitConfirmation from "./DwgUnitConfirmation";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {persistTakeoff,readTakeoffSync,clearPersistedTakeoff} from "@/lib/takeoffStorage.mjs";
import {rememberEngineeringTakeoff} from "@/lib/sceneStyle.mjs";
import { collectDrawingText } from "@/lib/drawingEvidence.mjs";
import {commercialFetch} from '@/lib/commercialFetch';
import {runPreviewAnalysis,acknowledgePreviewJob} from '@/lib/previewJobClient.mjs';
import {useLanguage} from '@/app/components/i18n/LanguageProvider';
import RasterTraceReview from "./RasterTraceReview";
import { getRasterReview, subscribeRasterReview, updateRasterReview } from "@/lib/rasterReviewSession.mjs";
import { buildTakeoffFromAps } from "@/services/apsTakeoffBuilder";
import { useEffect, useRef, useState } from "react";
import { useBoqStore } from "@/modules/boq";
import ApsViewer from "@/app/components/ApsViewer";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileStack,
  FileText,
  LoaderCircle,
  ScanSearch,
  Trash2,
  UploadCloud,
} from "lucide-react";

import {
  deleteProjectDocument,
  downloadProjectDocument,
  getProjectDocuments,
  uploadProjectDocument,
} from "@/services/documentService";

import {
  analyzeProjectDrawing,
  getLatestProjectTakeoff,
} from "@/services/takeoffService";

import "./ProjectDrawingCenter.css";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = [
  "pdf",
  "dwg",
  "dxf",
  "ifc",
  "rvt",
  "jpg",
  "jpeg",
  "png",
  "webp",
];

const AI_SUPPORTED_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "webp",
];

const APS_SUPPORTED_EXTENSIONS = [
  "dwg",
  "dxf",
  "ifc",
  "rvt",
];
function applyWallAreaFallback(
  result,
  defaultWallHeight = 3
) {
  if (!result) {
    return result;
  }

  const currentWallArea =
    Number(result.wall_area) || 0;

  let wallLength =
    Number(result.wall_length) || 0;

  // Floor Area and Total Room Area are separate quantities.
  const floorArea =
    Number(
      result.floor_area
    ) || 0;

  const rooms =
    Number(result.rooms) || 0;

  let wallLengthSource =
    wallLength > 0
      ? "ai_analysis"
      : "unavailable";

  let wallLengthEstimated = false;

  /*
   * وقتی AI طول دیوار را صفر برگرداند،
   * یک تخمین اولیه از مساحت و تعداد اتاق‌ها می‌سازیم.
   */
  if (
    wallLength <= 0 &&
    floorArea > 0
  ) {
    const externalPerimeter =
      4 * Math.sqrt(floorArea);

    const internalPartitions =
      rooms > 1
        ? (rooms - 1) *
          Math.sqrt(
            floorArea /
            Math.max(rooms, 1)
          )
        : 0;

    wallLength =
      externalPerimeter +
      internalPartitions;

    wallLength =
      Number(
        wallLength.toFixed(2)
      );

    wallLengthSource =
      "floor_area_room_estimate";

    wallLengthEstimated = true;
  }

  if (
    currentWallArea > 0 ||
    wallLength <= 0
  ) {
    return {
      ...result,

      wall_length:
        Number(
          wallLength.toFixed(2)
        ),

      wall_length_source:
        wallLengthSource,

      wall_length_estimated:
        wallLengthEstimated,
    };
  }

  const calculatedWallArea =
    wallLength *
    defaultWallHeight;

  return {
    ...result,

    wall_length:
      Number(
        wallLength.toFixed(2)
      ),

    wall_area:
      Number(
        calculatedWallArea.toFixed(2)
      ),

    wall_height:
      defaultWallHeight,

    wall_height_source:
      "project_default",

    wall_length_source:
      wallLengthSource,

    wall_area_source:
      "wall_length_x_default_height",

    wall_length_estimated:
      wallLengthEstimated,

    wall_area_estimated: true,

    confidence:
      wallLengthEstimated
        ? Math.min(
            Number(result.confidence) ||
              40,
            45
          )
        : Number(
            result.confidence
          ) || 70,

    notes: [
      result.notes,

      wallLengthEstimated
        ? `Wall length was estimated from ${floorArea} m² floor area and ${rooms} detected rooms.`
        : null,

      `Wall area was calculated from ${wallLength} m wall length × ${defaultWallHeight} m default height.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}


function applyAiRoomRegionAreas(
  rooms,
  totalFloorArea
) {
  const list =
    Array.isArray(rooms)
      ? rooms.map((room) => ({
          ...room,
        }))
      : [];

  const floorArea =
    Number(totalFloorArea) || 0;

  if (
    floorArea <= 0 ||
    list.length === 0
  ) {
    return {
      rooms: list,
      applied: false,
      reason:
        "missing_floor_area_or_rooms",
    };
  }

  const weighted =
    list.map((room) => {
      const box =
        room?.regionBBox;

      const width =
        Number(box?.width) || 0;

      const height =
        Number(box?.height) || 0;

      const weight =
        width > 0 &&
        height > 0
          ? width * height
          : 0;

      return {
        room,
        weight,
        aspect:
          width > 0 &&
          height > 0
            ? Math.max(
                width / height,
                height / width
              )
            : 0,
      };
    });

  const valid =
    weighted.filter(
      (item) =>
        item.weight > 0 &&
        item.aspect <= 8
    );

  if (
    valid.length !== list.length
  ) {
    return {
      rooms: list,
      applied: false,
      reason:
        "incomplete_ai_room_regions",
    };
  }

  const totalWeight =
    valid.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  if (totalWeight <= 0) {
    return {
      rooms: list,
      applied: false,
      reason:
        "invalid_ai_room_region_area",
    };
  }

  const nextRooms =
    valid.map(({ room, weight }) => {
      const area =
        floorArea *
        (weight / totalWeight);

      const box =
        room.regionBBox;

      // Perimeter is estimated from the AI-detected rectangle only after
      // scaling its area to the authoritative Autodesk total floor area.
      const aspect =
        Math.max(
          Number(box.width) /
            Math.max(
              Number(box.height),
              1e-9
            ),
          1e-9
        );

      const scaledWidth =
        Math.sqrt(
          area * aspect
        );

      const scaledHeight =
        area /
        Math.max(
          scaledWidth,
          1e-9
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
              2 *
              (scaledWidth +
                scaledHeight)
            ).toFixed(2)
          ),
        geometrySource:
          "openai_room_region_scaled_to_autodesk_floor_area",
        areaConfidence:
          Math.min(
            Number(
              room.roomTypeConfidence
            ) || 0,
            82
          ),
      };
    });

  return {
    rooms: nextRooms,
    applied: true,
    reason:
      "openai_room_regions_scaled_to_autodesk_floor_area",
  };
}


function chooseRoomGeometryCandidates(
  polygons,
  roomCount,
  totalFloorArea
) {
  const candidates =
    Array.isArray(polygons)
      ? polygons
      : [];

  if (
    roomCount <= 0 ||
    candidates.length < roomCount
  ) {
    return {
      polygons: [],
      reason: "not_enough_geometry_candidates",
      areaRatio: null,
    };
  }

  if (candidates.length === roomCount) {
    const sum = candidates.reduce(
      (total, polygon) =>
        total +
        (Number(polygon?.area) || 0),
      0
    );

    return {
      polygons: candidates,
      reason: "exact_geometry_candidate_count",
      areaRatio:
        Number(totalFloorArea) > 0
          ? sum / Number(totalFloorArea)
          : null,
    };
  }

  const target =
    Number(totalFloorArea) || 0;

  // Prefer a subset whose combined room-polygon area agrees with Autodesk's
  // authoritative floor area. This removes small fixture/furniture loops and
  // large enclosing sheet/building loops without hard-coding room names.
  if (target > 0) {
    const scaledTarget =
      Math.max(
        1,
        Math.round(target * 10)
      );

    const maxScaled =
      Math.round(
        scaledTarget * 1.45
      );

    let states = new Map();
    states.set("0:0", {
      count: 0,
      sum: 0,
      indexes: [],
    });

    candidates.forEach(
      (polygon, polygonIndex) => {
        const area =
          Number(polygon?.area) || 0;
        const scaled =
          Math.max(
            1,
            Math.round(area * 10)
          );

        const next =
          new Map(states);

        for (const state of states.values()) {
          if (
            state.count >= roomCount
          ) {
            continue;
          }

          const newCount =
            state.count + 1;
          const newSum =
            state.sum + scaled;

          if (
            newSum > maxScaled &&
            newCount < roomCount
          ) {
            continue;
          }

          const key =
            `${newCount}:${newSum}`;

          if (!next.has(key)) {
            next.set(key, {
              count: newCount,
              sum: newSum,
              indexes: [
                ...state.indexes,
                polygonIndex,
              ],
            });
          }
        }

        // Keep the DP bounded. For each selected-count bucket retain only the
        // sums closest to the target area.
        const grouped = new Map();

        for (const state of next.values()) {
          if (!grouped.has(state.count)) {
            grouped.set(state.count, []);
          }
          grouped.get(state.count).push(state);
        }

        states = new Map();

        for (const [count, group] of grouped.entries()) {
          group
            .sort(
              (a, b) =>
                Math.abs(a.sum - scaledTarget) -
                Math.abs(b.sum - scaledTarget)
            )
            .slice(0, 350)
            .forEach((state) => {
              states.set(
                `${count}:${state.sum}`,
                state
              );
            });
        }
      }
    );

    const complete =
      [...states.values()]
        .filter(
          (state) =>
            state.count === roomCount
        )
        .sort(
          (a, b) =>
            Math.abs(a.sum - scaledTarget) -
            Math.abs(b.sum - scaledTarget)
        )[0];

    if (complete) {
      const selected =
        complete.indexes.map(
          (index) =>
            candidates[index]
        );

      return {
        polygons: selected,
        reason: "floor_area_matched_geometry_subset",
        areaRatio:
          complete.sum /
          scaledTarget,
      };
    }
  }

  // Last deterministic fallback: room interiors are typically the smaller
  // closed faces. Avoid the very largest enclosing loops and keep exactly the
  // semantic room count.
  const selected =
    [...candidates]
      .sort(
        (a, b) =>
          Number(a?.area || 0) -
          Number(b?.area || 0)
      )
      .slice(0, roomCount);

  const sum = selected.reduce(
    (total, polygon) =>
      total +
      (Number(polygon?.area) || 0),
    0
  );

  return {
    polygons: selected,
    reason: "smallest_closed_faces_fallback",
    areaRatio:
      target > 0
        ? sum / target
        : null,
  };
}

function applySemanticCentroidRoomAreas(
  rooms,
  totalFloorArea
) {
  const list =
    Array.isArray(rooms)
      ? rooms.map((room) => ({
          ...room,
        }))
      : [];

  const floorArea =
    Number(totalFloorArea) || 0;

  const valid =
    list.filter(
      (room) =>
        Number.isFinite(
          Number(room?.centroid?.x)
        ) &&
        Number.isFinite(
          Number(room?.centroid?.y)
        )
    );

  if (
    floorArea <= 0 ||
    valid.length !== list.length ||
    list.length === 0
  ) {
    return {
      rooms: list,
      applied: false,
      reason:
        "semantic_centroids_unavailable",
    };
  }

  // Deterministic Voronoi-style weighting from AI room-label centers.
  // We do NOT invent total area: Autodesk floor_area remains authoritative.
  // The centroid field only distributes that authoritative total among
  // already-detected semantic rooms when closed-face room polygons are absent.
  const gridSize = 120;
  const counts =
    new Array(list.length).fill(0);

  for (
    let gy = 0;
    gy < gridSize;
    gy += 1
  ) {
    const y =
      (gy + 0.5) / gridSize;

    for (
      let gx = 0;
      gx < gridSize;
      gx += 1
    ) {
      const x =
        (gx + 0.5) / gridSize;

      let bestIndex = 0;
      let bestDistance =
        Infinity;

      for (
        let index = 0;
        index < list.length;
        index += 1
      ) {
        const room =
          list[index];

        const dx =
          x -
          Number(
            room.centroid.x
          );

        const dy =
          y -
          Number(
            room.centroid.y
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

  const nextRooms =
    list.map(
      (room, index) => {
        const weight =
          counts[index] /
          totalCells;

        const area =
          floorArea *
          weight;

        // Perimeter remains an estimate because only semantic centers are
        // available. Use a neutral square-equivalent perimeter rather than
        // claiming exact wall geometry.
        const perimeter =
          area > 0
            ? 4 * Math.sqrt(area)
            : 0;

        return {
          ...room,
          area:
            Number(
              area.toFixed(2)
            ),
          perimeter:
            Number(
              perimeter.toFixed(2)
            ),
          geometrySource:
            "semantic_centroid_voronoi_scaled_to_autodesk_floor_area",
          areaConfidence:
            Math.min(
              Number(
                room.roomTypeConfidence
              ) || 0,
              68
            ),
          areaEstimated:
            true,
          perimeterEstimated:
            true,
        };
      }
    );

  return {
    rooms:
      nextRooms,
    applied:
      true,
    reason:
      "semantic_centroid_voronoi_scaled_to_autodesk_floor_area",
  };
}


function mapSemanticRoomsToGeometry(
  semanticRooms,
  geometryCandidates,
  totalFloorArea = 0
) {
  const rooms =
    (Array.isArray(semanticRooms)
      ? semanticRooms
      : []
    ).filter(
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

  const allPolygons =
    (Array.isArray(
      geometryCandidates
    )
      ? geometryCandidates
      : []
    ).filter(
      (polygon) =>
        Number(
          polygon?.area
        ) >= 1.2 &&
        Number(
          polygon?.area
        ) <= 1000 &&
        Number(
          polygon?.perimeter
        ) > 0 &&
        Number.isFinite(
          Number(
            polygon?.centroid?.x
          )
        ) &&
        Number.isFinite(
          Number(
            polygon?.centroid?.y
          )
        )
    );

  if (
    rooms.length === 0 ||
    allPolygons.length < rooms.length
  ) {
    return {
      matched: false,
      rooms:
        semanticRooms,
      reason:
        "semantic_geometry_count_mismatch",
      semanticCount:
        rooms.length,
      geometryCount:
        allPolygons.length,
    };
  }

  const candidateSelection =
    chooseRoomGeometryCandidates(
      allPolygons,
      rooms.length,
      totalFloorArea
    );

  const polygons =
    candidateSelection.polygons;

  if (
    polygons.length !== rooms.length
  ) {
    return {
      matched: false,
      rooms: semanticRooms,
      reason:
        "room_geometry_candidate_selection_failed",
      semanticCount:
        rooms.length,
      geometryCount:
        allPolygons.length,
      selectedGeometryCount:
        polygons.length,
    };
  }

  const normalize =
    (items, xAccessor, yAccessor) => {
      const xs =
        items.map(xAccessor);
      const ys =
        items.map(yAccessor);

      const minX =
        Math.min(...xs);
      const maxX =
        Math.max(...xs);
      const minY =
        Math.min(...ys);
      const maxY =
        Math.max(...ys);

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

      return items.map(
        (item, index) => ({
          item,
          index,
          x:
            (xAccessor(item) -
              minX) /
            width,
          y:
            (yAccessor(item) -
              minY) /
            height,
        })
      );
    };

  const roomPoints =
    normalize(
      rooms,
      (room) =>
        Number(
          room.centroid.x
        ),
      (room) =>
        Number(
          room.centroid.y
        )
    );

  const polygonPoints =
    normalize(
      polygons,
      (polygon) =>
        Number(
          polygon.centroid.x
        ),
      (polygon) =>
        Number(
          polygon.centroid.y
        )
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
    transforms
      .map(
        (transform, transformIndex) => {
          const pairs = [];

          for (const room of roomPoints) {
            for (const polygon of polygonPoints) {
              const transformed =
                transform(polygon);

              pairs.push({
                roomIndex:
                  room.index,
                polygonIndex:
                  polygon.index,
                distance:
                  Math.hypot(
                    room.x -
                      transformed.x,
                    room.y -
                      transformed.y
                  ),
              });
            }
          }

          pairs.sort(
            (a, b) =>
              a.distance -
              b.distance
          );

          const usedRooms =
            new Set();
          const usedPolygons =
            new Set();
          const assignments = [];

          for (const pair of pairs) {
            if (
              usedRooms.has(
                pair.roomIndex
              ) ||
              usedPolygons.has(
                pair.polygonIndex
              )
            ) {
              continue;
            }

            usedRooms.add(
              pair.roomIndex
            );
            usedPolygons.add(
              pair.polygonIndex
            );
            assignments.push(
              pair
            );

            if (
              assignments.length ===
              rooms.length
            ) {
              break;
            }
          }

          const averageDistance =
            assignments.length
              ? assignments.reduce(
                  (sum, item) =>
                    sum +
                    item.distance,
                  0
                ) /
                assignments.length
              : Infinity;

          const maxDistance =
            assignments.length
              ? Math.max(
                  ...assignments.map(
                    (item) =>
                      item.distance
                  )
                )
              : Infinity;

          return {
            transformIndex,
            assignments,
            averageDistance,
            maxDistance,
          };
        }
      )
      .sort(
        (a, b) =>
          a.averageDistance -
          b.averageDistance
      );

  const best =
    solutions[0];

  const areaRatio =
    Number(
      candidateSelection.areaRatio
    );

  const areaAgreement =
    !Number.isFinite(areaRatio) ||
    (
      areaRatio >= 0.72 &&
      areaRatio <= 1.28
    );

  const spatialAgreement =
    best &&
    best.assignments.length ===
      rooms.length &&
    best.averageDistance <= 0.33 &&
    best.maxDistance <= 0.62;

  if (
    !best ||
    best.assignments.length !==
      rooms.length ||
    !areaAgreement ||
    !spatialAgreement
  ) {
    return {
      matched: false,
      rooms:
        semanticRooms,
      reason:
        "semantic_geometry_spatial_mismatch",
      averageDistance:
        best?.averageDistance ??
        null,
      maxDistance:
        best?.maxDistance ??
        null,
      candidateSelection:
        candidateSelection.reason,
      candidateAreaRatio:
        Number.isFinite(areaRatio)
          ? Number(
              areaRatio.toFixed(3)
            )
          : null,
      semanticCount:
        rooms.length,
      geometryCount:
        allPolygons.length,
      selectedGeometryCount:
        polygons.length,
    };
  }

  const nextRooms =
    semanticRooms.map(
      (room) => ({
        ...room,
      })
    );

  for (const assignment of best.assignments) {
    const polygon =
      polygons[
        assignment.polygonIndex
      ];

    nextRooms[
      assignment.roomIndex
    ] = {
      ...nextRooms[
        assignment.roomIndex
      ],
      area:
        Number(
          polygon?.area
        ) || null,
      perimeter:
        Number(
          polygon?.perimeter
        ) || null,
      geometrySource:
        "aps_closed_face_spatial_match_v2",
      geometryMatchDistance:
        assignment.distance,
      geometryPolygonId:
        polygon?.id ||
        null,
    };
  }

  return {
    matched: true,
    rooms:
      nextRooms,
    averageDistance:
      best.averageDistance,
    maxDistance:
      best.maxDistance,
    transformIndex:
      best.transformIndex,
    candidateSelection:
      candidateSelection.reason,
    candidateAreaRatio:
      Number.isFinite(areaRatio)
        ? Number(
            areaRatio.toFixed(3)
          )
        : null,
    source:
      "aps_geometry_semantic_room_match_v2",
  };
}

function validateEngineeringQuantities(
  takeoff
) {
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

  const impliedHeight =
    wallLength > 0 &&
    wallArea > 0
      ? wallArea /
        wallLength
      : null;

  const maxPlausibleWallLength =
    floorArea > 0
      ? Math.max(
          60,
          floorArea * 2.5
        )
      : Infinity;

  const wallLengthPlausible =
    wallLength > 0 &&
    wallLength <=
      maxPlausibleWallLength;

  const wallAreaPlausible =
    wallArea > 0 &&
    wallLength > 0 &&
    impliedHeight >= 2.1 &&
    impliedHeight <= 6;

  const wallAccepted =
    wallLengthPlausible &&
    wallAreaPlausible;

  if (wallAccepted) {
    return {
      ...takeoff,
      engineering_validation: {
        ...(takeoff?.engineering_validation ||
          {}),
        walls: {
          status:
            "accepted",
          impliedHeight:
            Number(
              impliedHeight.toFixed(
                2
              )
            ),
          source:
            "aps_geometry_properties",
        },
      },
    };
  }

  return {
    ...takeoff,
    wall_length:
      null,
    wall_area:
      null,
    wall_volume:
      null,
    wall_length_source:
      "needs_review",
    wall_area_source:
      "needs_review",
    engineering_validation: {
      ...(takeoff?.engineering_validation ||
        {}),
      walls: {
        status:
          "needs_review",
        rawWallLength:
          wallLength || null,
        rawWallArea:
          wallArea || null,
        impliedHeight:
          Number.isFinite(
            impliedHeight
          )
            ? Number(
                impliedHeight.toFixed(
                  2
                )
              )
            : null,
        reason:
          "APS wall quantities failed plausibility validation",
      },
    },
  };
}

function getFileExtension(fileName = "") {
  return fileName
    .split(".")
    .pop()
    ?.toLowerCase();
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(
    value /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "The server returned an invalid response."
    );
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function formatQuantity(value, unit = "") {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "Pending extraction";
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return `${value}${unit ? ` ${unit}` : ""}`;
  }

  const formatted =
    Number.isInteger(number)
      ? number.toLocaleString("en-US")
      : number.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });

  return `${formatted}${unit ? ` ${unit}` : ""}`;
}


function formatGeometryNumber(value, digits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Unavailable";
  }

  return number.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatRoomType(value) {
  const normalized = String(value || "unlabeled_space")
    .replaceAll("_", " ")
    .trim();

  return normalized.replace(/\b\w/g, (character) =>
    character.toUpperCase()
  );
}

function getGeometryArcCount(result) {
  return (
    Number(result?.circularArcCount || 0) +
    Number(result?.ellipticalArcCount || 0)
  );
}

async function uploadDocumentToAps(document) {
  const { url, error } =
    await downloadProjectDocument(document);

  if (error || !url) {
    throw (
      error ||
      new Error(
        "Could not create a secure file URL."
      )
    );
  }

  const sourceResponse = await commercialFetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!sourceResponse.ok) {
    throw new Error(
      `Could not download the project file. HTTP ${sourceResponse.status}`
    );
  }

  const blob = await sourceResponse.blob();
  const file = new File(
    [blob],
    document.file_name,
    {
      type:
        document.file_type ||
        blob.type ||
        "application/octet-stream",
    }
  );

  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId",document.project_id);

  const response = await commercialFetch(
    "/api/aps/upload",
    {
      method: "POST",
      body: formData,
      cache: "no-store",
    }
  );

  const payload =
    await readJsonResponse(response);

  if (!response.ok || payload.success !== true) {
    throw new Error(
      payload.error ||
        `APS upload failed. HTTP ${response.status}`
    );
  }

  const result = payload.result || payload;
  const urn = result.urn || payload.urn;

  if (!urn) {
    throw new Error(
      "APS upload succeeded, but no URN was returned."
    );
  }

  return {
    ...result,
    urn,
  };
}

async function startApsTranslation(urn,projectId) {
  const response = await commercialFetch(
    "/api/aps/translate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        urn, projectId,
        rootFilename: "",
      }),
      cache: "no-store",
    }
  );

  const payload =
    await readJsonResponse(response);

  if (!response.ok || payload.success !== true) {
    throw new Error(
      payload.error ||
        `APS translation failed. HTTP ${response.status}`
    );
  }

  return payload.result || payload;
}

async function getApsTranslationStatus(urn) {
  const response = await commercialFetch(
    `/api/aps/status/${encodeURIComponent(urn)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const payload =
    await readJsonResponse(response);

  if (!response.ok || payload.success !== true) {
    throw new Error(
      payload.error ||
        `Could not read APS status. HTTP ${response.status}`
    );
  }

  return payload.manifest || payload;
}

async function waitForApsTranslation(
  urn,
  onProgress
) {
  const timeout = 10 * 60 * 1000;
  const interval = 5000;
  const startedAt = Date.now();
  let emptySuccess=0;

  while (Date.now() - startedAt < timeout) {
    const manifest =
      await getApsTranslationStatus(urn);

    const status = String(
      manifest.status || ""
    ).toLowerCase();

    const progress =
      manifest.progress || status;

    onProgress?.(progress);

    if (status === "success") {
      const check=apsManifestGeometry(manifest);
      if(check.views.length)return manifest;
      emptySuccess++;
      if(emptySuccess>=3)throw new Error(`Autodesk finished without a viewable 2D/3D drawing. ${check.messages.join(' ')||'Check that the DWG contains a populated Model/layout; translation success is not geometry extraction.'}`);
    }

    if (
      status === "failed" ||
      status === "timeout"
    ) {
      const derivativeMessage =
        manifest.derivatives?.[0]
          ?.messages?.[0]?.message;

      throw new Error(
        derivativeMessage ||
          "Autodesk could not translate this file."
      );
    }

    await wait(interval);
  }

  throw new Error(
    "Autodesk translation timed out. Check the file again later."
  );
}

export default function ProjectDrawingCenter({
  projectId,
  onOpenBoq,
}) {
  const {language}=useLanguage();
  const analysisRunIdRef = useRef('initial');
  const [analysisRunId,setAnalysisRunId]=useState('initial');
  const fileInputRef = useRef(null);
  const localImagePreviewUrlRef = useRef("");
  const localImagePreviewDocumentIdRef = useRef(null);
  // V42: coalesce duplicate JPG schematic requests for the same drawing.
  // Upload auto-generation and the Analyze button used to fire the expensive
  // /api/ai/design-3d request twice, producing two competing scenes.
  const schematic3DInFlightRef = useRef(new Map());

  const importAiBoq = useBoqStore(
    (state) => state.importAiBoq
  );

  const [documents, setDocuments] =
    useState([]);

  const [selectedDocumentId, setSelectedDocumentId] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [uploading, setUploading] =
    useState(false);

  const [analyzing, setAnalyzing] =
    useState(false);
  const analysisInFlightRef = useRef(false);
    const [generatingBoq, setGeneratingBoq] = useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [takeoffResult, setTakeoffResult] =
    useState(null);
  const [confirmedUnits,setConfirmedUnits]=useState({});
  useEffect(()=>{let live=true;Promise.resolve().then(()=>{if(!live)return;try{setConfirmedUnits(JSON.parse(localStorage.getItem(`ventra:confirmed-dwg-units:${projectId}`)||"{}"));}catch{setConfirmedUnits({});}});return()=>{live=false;};},[projectId]);
  const takeoffResultRef = useRef(null);
  useEffect(()=>{takeoffResultRef.current=takeoffResult;},[takeoffResult]);

  const [
    deletingDocumentId,
    setDeletingDocumentId,
  ] = useState(null);

  const [message, setMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [rasterReview, setRasterReview] = useState(null);
  useEffect(() => {
    const sync = () => setRasterReview(getRasterReview(projectId));
    const unsubscribe = subscribeRasterReview(sync);
    sync();
    return unsubscribe;
  }, [projectId]);

  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDrawingCenter() {
      if (!projectId) {
        if (mounted) {
          setErrorMessage(
            "Project ID is missing."
          );

          setLoading(false);
        }

        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");

        const [
          documentsResult,
          takeoffResultResponse,
        ] = await Promise.all([
          getProjectDocuments(projectId),
          getLatestProjectTakeoff(
            projectId
          ),
        ]);

        if (!mounted) {
          return;
        }

        if (documentsResult.error) {
          setErrorMessage(
            documentsResult.error.message ||
              "Could not load project files."
          );
        } else {
          const loadedDocuments =
            (documentsResult.documents || []).filter(item=>item.category!=="photo");

          setDocuments(loadedDocuments);

          const savedDocumentId =
            takeoffResultResponse?.takeoff?.document_id || null;

          setSelectedDocumentId(resolveDrawingSelection(
            loadedDocuments,selectedDrawingSync(projectId),savedDocumentId
          ));
        }

        if (
          !takeoffResultResponse.error &&
          takeoffResultResponse.takeoff
        ) {
          setTakeoffResult(
            takeoffResultResponse.takeoff
          );
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            error?.message ||
              "Could not load the Drawing Center."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDrawingCenter();

    return () => {
      mounted = false;
    };
  }, [projectId]);

  const analysisSelectionRef=useRef(null);
  const selectedDocumentForPreview =
    (selectedDocumentId
      ? documents.find((item) => item.id === selectedDocumentId)
      : null) || documents[0] || null;

  analysisSelectionRef.current={projectId,documentId:selectedDocumentForPreview?.id||null};

  const selectedPreviewExtension = getFileExtension(
    selectedDocumentForPreview?.file_name
  );

  const selectedDocumentIsImage = [
    "jpg",
    "jpeg",
    "png",
    "webp",
  ].includes(selectedPreviewExtension);

  useEffect(()=>{
    if(selectedDocumentId && selectedDocumentIsImage && selectedDocumentForPreview?.id===selectedDocumentId)selectSchematicDrawing(projectId,selectedDocumentId);
  },[projectId,selectedDocumentId,selectedDocumentIsImage,selectedDocumentForPreview?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadImagePreview() {
      setImagePreviewError("");

      if (!selectedDocumentForPreview || !selectedDocumentIsImage) {
        setImagePreviewLoading(false);
        setImagePreviewUrl("");
        return;
      }

      // Keep the immediate local blob preview visible after upload. Do not blank
      // the drawing while a Supabase signed URL is being requested in parallel.
      const hasImmediateLocalPreview =
        localImagePreviewDocumentIdRef.current === selectedDocumentForPreview.id &&
        Boolean(localImagePreviewUrlRef.current);

      if (hasImmediateLocalPreview) {
        setImagePreviewUrl(localImagePreviewUrlRef.current);
        setImagePreviewLoading(false);
      } else {
        setImagePreviewUrl("");
        setImagePreviewLoading(true);
      }

      try {
        const { url, error } = await downloadProjectDocument(
          selectedDocumentForPreview
        );

        if (error || !url) {
          throw error || new Error("Could not open the image preview.");
        }

        if (!cancelled) {
          // Switch to the persistent signed URL only after it is ready.
          setImagePreviewUrl(url);
        }
      } catch (error) {
        if (!cancelled && !hasImmediateLocalPreview) {
          setImagePreviewError(
            error?.message || "Could not load the image preview."
          );
        }
      } finally {
        if (!cancelled) {
          setImagePreviewLoading(false);
        }
      }
    }

    loadImagePreview();

    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, documents, selectedDocumentIsImage, selectedDocumentForPreview]);

  useEffect(() => {
    return () => {
      if (localImagePreviewUrlRef.current) {
        URL.revokeObjectURL(localImagePreviewUrlRef.current);
        localImagePreviewUrlRef.current = "";
        localImagePreviewDocumentIdRef.current = null;
      }
    };
  }, []);

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  async function generateImageSchematic3D(document, { quiet = false } = {}) {
    if (!document) return null;
    const key = schematicRequestKey(projectId,document);

    // V53: keep single-flight state on window, not on this React component.
    // ProjectDrawingCenter can remount while source/persistence state changes; a useRef map
    // is then recreated and the same expensive Vision request can be fired twice.
    const registry = typeof window !== "undefined"
      ? (window.__ventraSchematic3DInFlight ||= new Map())
      : schematic3DInFlightRef.current;

    const existing = registry.get(key);
    if (existing) {
      console.log("[VENTRA JPG 3D REQUEST COALESCED v53]", { document: key });
      return existing;
    }

    const task = generateImageSchematic3DUncoalesced(document, { quiet });
    registry.set(key, task);
    try {
      return await task;
    } finally {
      if (registry.get(key) === task) registry.delete(key);
    }
  }

  async function ventraFetchWithTransientRetry(url, options = {}, { attempts = 5, label = "request" } = {}) {
    let lastError = null;
    const retryDelays = [1200, 2500, 4500, 7500];

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await commercialFetch(url, options);

        // V55: Next/Turbopack can briefly answer an App Router API request with
        // its HTML 404 page while the dev server is restarting/recompiling.
        // That is a transport/dev-server condition, not a real design-3d 404.
        // Retry only non-JSON transient gateway/dev responses; never retry a
        // legitimate JSON API error such as billing, validation or 404 payloads.
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        const looksJson = contentType.includes("application/json") || contentType.includes("application/problem+json");
        const transientHttp = [404, 408, 425, 502, 503, 504].includes(response.status) && !looksJson;

        if (transientHttp && attempt < attempts) {
          const delayMs = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
          console.warn("[VENTRA CLIENT HTTP RETRY v55]", {
            label,
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
            status: response.status,
            contentType: contentType || "unknown",
            url,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || "");
        const transient =
          error instanceof TypeError ||
          /failed to fetch|network error|network request failed|load failed/i.test(message);

        if (!transient || attempt >= attempts) throw error;

        const delayMs = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
        console.warn("[VENTRA CLIENT NETWORK RETRY v55]", {
          label,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError || new Error(`${label} failed.`);
  }

  async function generateImageSchematic3DUncoalesced(document, { quiet = false } = {}) {
    if (!document || typeof window === "undefined") return null;

    const extension = getFileExtension(document.file_name);
    if (!["jpg", "jpeg", "png", "webp"].includes(extension)) return null;

    const previousReview = getRasterReview(projectId);
    const sameImage = previousReview?.documentId && document.id
      ? previousReview.documentId === document.id
      : previousReview?.fileName === document.file_name;
    const priorReport = previousReview?.report || {};
    const pendingReport = {
      ...(sameImage ? priorReport : {}),
      status: "analyzing",
      accepted: null,
      failure: null,
      transport: { stage: "preparing_image" },
      attempts: [],
    };
    // Preserve the visible card while a same-image request runs. The report is
    // held in the module session so a remounted tab can continue observing it.
    updateRasterReview(projectId, {
      report: pendingReport,
      imageUrl: sameImage ? previousReview?.imageUrl || "" : "",
      fileName: document.file_name,
      documentId: document.id || null,
    });
    try {
      if (!quiet) {
        setMessage("Creating interactive 3D preview from the floor plan…");
      }

      const { url, error: signedUrlError } =
        await downloadProjectDocument(document);

      if (signedUrlError || !url) {
        throw signedUrlError || new Error("Could not open the image for schematic 3D analysis.");
      }

      const requestId = crypto.randomUUID();
      const response = await runPreviewAnalysis(() => ventraFetchWithTransientRetry(
        "/api/ai/design-3d-preview",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ventra-Request-Id": requestId,
          },
          body: JSON.stringify({
            mode: "schematic_analyze",
            imageUrl: url,
            projectId,
            fileName: document.file_name,
            requestId,
          }),
          cache: "no-store",
        },
        // A lost response may already have consumed a model request. Resume a
        // known background job through runPreviewAnalysis, never replay this POST.
        { attempts: 1, label: "interactive-3d-preview" }
      ), {
        key: `${projectId}:${document.id || document.file_name}`,
        fetcher: commercialFetch,
        storage: typeof window !== 'undefined' ? window.sessionStorage : null,
        onProgress: transport => updateRasterReview(projectId,{...getRasterReview(projectId),report:{...getRasterReview(projectId)?.report,transport}}),
      });

      const responseText = await response.text();
      let payload = null;
      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        const error = new Error(
          response.status === 404
            ? "Schematic 3D API route was temporarily unavailable after retries. Restart the dev server once and refresh the page."
            : `Schematic 3D API returned ${response.status} instead of JSON.`
        );
        error.code = "RASTER_NON_JSON_RESPONSE";
        throw error;
      }
      if (payload?.diagnostics) {
        updateRasterReview(projectId, { report: payload.diagnostics, imageUrl: url, fileName: document.file_name, documentId: document.id || null });
      }
      if (!response.ok || !payload?.scene) {
        const apiError = new Error(payload?.error || `Schematic 3D analysis failed (${response.status}).`);
        apiError.code = payload?.code || payload?.diagnostics?.failure?.code || null;
        apiError.details = payload?.details || payload?.diagnostics?.failure?.details;
        throw apiError;
      }

      const scene = applyDesignDefaults({
        ...payload.scene,
        projectId,
        documentId: document.id || null,
        documentName: document.file_name,
        source: "image-interactive-preview-v3",
        generatedAt: new Date().toISOString(),
      });

      if(analysisSelectionRef.current?.projectId!==projectId||analysisSelectionRef.current?.documentId!==document.id)
        throw Object.assign(new Error('Analysis completed for another selected drawing. Select the analyzed drawing and press Analyze to recover its saved result.'),{code:'PREVIEW_SELECTION_CHANGED'});
      selectDrawingDocument(projectId,document.id);
      await saveSchematic(projectId,scene,{preserveBase:false});
      acknowledgePreviewJob(`${projectId}:${document.id||document.file_name}`,window.sessionStorage);
      // Same-tab storage events do not fire. Tell the existing 3D Viewer to
      // switch to the new schematic scene immediately without touching APS state.
      window.dispatchEvent(new CustomEvent("ventra:3d-source-updated", {
        detail: { projectId, source: "schematic", scene },
      }));

      if (!quiet) {
        setMessage(
          `Interactive 3D preview created from ${document.file_name}. Open the 3D tab to orbit, pan and zoom.`
        );
      }

      return scene;
    } catch (error) {
      console.warn("[VENTRA IMAGE SCHEMATIC 3D]", error);
      const message = error?.message || "Could not create schematic 3D from the image.";
      const current = getRasterReview(projectId)?.report || pendingReport;
      updateRasterReview(projectId, {
        report: {
          ...current,
          status: error?.code==='PREVIEW_SELECTION_CHANGED'?"awaiting_selection":"rejected",
          accepted: false,
          failure: current.failure?.code
            ? current.failure
            : { code: error?.code || "RASTER_REQUEST_FAILED", message, details: error?.details },
        },
        imageUrl: getRasterReview(projectId)?.imageUrl || "",
        fileName: document.file_name,
        documentId: document.id || null,
      });
      // The raster Analyze action must stop here on failure. Otherwise it can
      // report a successful analysis while the 3D tab still contains an older scene.
      if (quiet) {
        throw new Error(message.includes("No new 3D scene was saved.") ? message : `${message} No new 3D scene was saved.`);
      }
      if (!quiet) {
        setErrorMessage(error?.message || "Could not create schematic 3D from the image.");
      }
      return null;
    }
  }

  function validateFile(file) {
    if (!file) {
      return "Please select a file.";
    }

    const extension =
      getFileExtension(file.name);

    if (
      !extension ||
      !ACCEPTED_EXTENSIONS.includes(
        extension
      )
    ) {
      return "Only PDF, DWG, DXF, IFC, RVT, JPG, PNG and WEBP files are allowed.";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "The maximum file size is 100 MB.";
    }

    return null;
  }


  async function handleFile(file) {
    const validationError =
      validateFile(file);

    if (validationError) {
      setErrorMessage(
        validationError
      );

      return;
    }

    try {
      setUploading(true);
      clearMessages();

      const { document, error } =
        await uploadProjectDocument({
          projectId,
          file,
          category: "drawing",
        });

      if (error || !document) {
        throw (
          error ||
          new Error(
            "Upload could not be completed."
          )
        );
      }

      setDocuments((current) => [
        document,
        ...current,
      ]);

      if (["jpg", "jpeg", "png", "webp"].includes(getFileExtension(file.name))) {
        if (localImagePreviewUrlRef.current) {
          URL.revokeObjectURL(localImagePreviewUrlRef.current);
        }
        const immediatePreviewUrl = URL.createObjectURL(file);
        localImagePreviewUrlRef.current = immediatePreviewUrl;
        localImagePreviewDocumentIdRef.current = document.id;
        setImagePreviewUrl(immediatePreviewUrl);
        setImagePreviewError("");
        setImagePreviewLoading(false);
      }

      setSelectedDocumentId(document.id);
      selectDrawingDocument(projectId,document.id);
      if(["jpg","jpeg","png","webp"].includes(getFileExtension(document.file_name)))selectSchematicDrawing(projectId,document.id);
      setTakeoffResult(null);

      if (typeof window !== "undefined") {
        void saveActiveSource(projectId,["jpg", "jpeg", "png", "webp"].includes(getFileExtension(file.name))
            ? "schematic"
            : "aps"
        ).catch(error=>setMessage(error.message));
      }

      if (typeof window !== "undefined") {
        await rememberEngineeringTakeoff(window.localStorage,projectId,readTakeoffSync(projectId));
        window.localStorage.removeItem(
          `ventra:project-takeoff:${projectId}`
        );

        // Selecting a CAD file switches the source; it does not delete the JPG scene.
      }

      setMessage(
        `${file.name} uploaded successfully.`
      );

      if (["jpg", "jpeg", "png", "webp"].includes(getFileExtension(file.name))) {
        // V53: upload only establishes the source/preview. Do NOT launch a second paid
        // schematic request in the background. The Analyze action owns 3D generation.
        // This prevents upload + Analyze + remount from racing three identical requests.
        setMessage(`${file.name} uploaded successfully. Click Analyze to build the AI 3D scene.`);
      }
    } catch (error) {
      setErrorMessage(
        error?.message ||
          "Could not upload the file."
      );
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value =
          "";
      }
    }
  }

  function handleInputChange(event) {
    const file =
      event.target.files?.[0];

    if (file) {
      handleFile(file);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);

    const file =
      event.dataTransfer.files?.[0];

    if (file) {
      handleFile(file);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleAnalyzeDrawing() {
    if (analysisInFlightRef.current || analyzing || generatingBoq) return;
    if (documents.length === 0) {
      setErrorMessage(
        "Please upload a drawing first."
      );

      console.warn(
        "[VENTRA ANALYZER] analysis blocked: no documents"
      );

      return;
    }

    const explicitlySelectedDocument =
      selectedDocumentId
        ? documents.find(
            (item) =>
              item.id ===
              selectedDocumentId
          ) || null
        : null;

    const selectedDocument =
      explicitlySelectedDocument ||
      documents[0] ||
      null;

    if (!selectedDocument) {
      setErrorMessage(
        "No drawing is available for analysis."
      );

      console.error(
        "[VENTRA ANALYZER] analysis blocked: document resolution failed",
        {
          selectedDocumentId,
          documents: documents.map(
            (item) => ({
              id: item?.id,
              fileName:
                item?.file_name,
            })
          ),
        }
      );

      return;
    }

    if (
      selectedDocumentId !==
      selectedDocument.id
    ) {
      setSelectedDocumentId(
        selectedDocument.id
      );

      console.log(
        "[VENTRA ANALYZER] automatic drawing selection",
        {
          previousSelectedDocumentId:
            selectedDocumentId,
          selectedDocumentId:
            selectedDocument.id,
          fileName:
            selectedDocument.file_name,
        }
      );
    }

    selectDrawingDocument(projectId,selectedDocument.id);

    analysisRunIdRef.current = crypto.randomUUID();
    setAnalysisRunId(analysisRunIdRef.current);

    console.log(
      "[VENTRA ANALYZER] fresh analysis run",
      {
        analysisRunId:
          analysisRunIdRef.current,
        selectedDocumentId:
          selectedDocument.id,
        fileName:
          selectedDocument.file_name,
      }
    );

    const extension = getFileExtension(
      selectedDocument.file_name
    );

    const isAiDrawing =
      AI_SUPPORTED_EXTENSIONS.includes(
        extension
      );

    const isCadDrawing =
      APS_SUPPORTED_EXTENSIONS.includes(
        extension
      );

    if (!isAiDrawing && !isCadDrawing) {
      setErrorMessage(
        "This drawing format is not supported."
      );

      return;
    }

    const workflowToken = beginDrawingWorkflow(projectId, 'analysis');
    if (!workflowToken) return;
    let analysisSucceeded = false;
    analysisInFlightRef.current = true;
    try {
      setAnalyzing(true);
      clearMessages();

      if (isAiDrawing) {
        setMessage(
          extension === "pdf"
            ? "Analyzing the PDF page by page. Large drawing sets can take several minutes. Keep this page open."
            : "Analyzing the drawing. Keep this page open."
        );

        if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
          const previewScene = await generateImageSchematic3D(selectedDocument, { quiet: true });
          if (previewScene) {
            analysisSucceeded = true;
            // JPG/PNG interactive preview is intentionally isolated from the
            // expensive takeoff call. BOQ/takeoff remains available through
            // its own workflow; generating a 3D preview must not immediately
            // spend a second AI request or overwrite preview state.
            setMessage("Interactive 3D preview is ready. Open the 3D view to orbit, pan and zoom around it.");
            return;
          }
        }

        // Keep the last successful record in storage, but never expose it as
        // the result of this pending/failed PDF analysis or use it for BOQ.
        // The visible result is cleared during analysis. After a failed request,
        // reload saved evidence to preserve guarded source-only continuation.
        let savedPdf = takeoffResultRef.current;
        if (extension === "pdf" && !savedPdf) {
          const saved = await getLatestProjectTakeoff(projectId);
          if (saved.error) throw saved.error;
          savedPdf = saved.takeoff;
        }
        const samePdfRecord = !!savedPdf && (!!savedPdf.document_id && savedPdf.document_id === selectedDocument.id ||
          !!savedPdf.document_name && savedPdf.document_name === selectedDocument.file_name);
        const resumeSourceMeasurementsOnly = extension === 'pdf' && samePdfRecord &&
          savedPdf.pdf_analysis?.document_review_status?.status === 'completed' && savedPdf.pdf_analysis?.measurement_completion?.status === 'incomplete';
        const localPdfRecoveryOnly = resumeSourceMeasurementsOnly && ['failed','partial'].includes(savedPdf.pdf_analysis?.source_measurement_status?.status);
        if (localPdfRecoveryOnly) setMessage('Recovering native PDF schedules from the saved analysis. Model calls are disabled; missing cache stops recovery.');
        else if (resumeSourceMeasurementsOnly) setMessage('Continuing saved PDF analysis: only missing source measurements; no full page analysis if the saved cache is unavailable.');
        if (extension === "pdf") {
          takeoffResultRef.current = null;
          setTakeoffResult(null);
        }
        const { takeoff, error } =
          await analyzeProjectDrawing({
            projectId,
            document: selectedDocument,
            onProgress:progress=>{
              const labels={queued:['Queued','در صف','في الانتظار'],reading_source:['Reading drawing','خواندن نقشه','قراءة المخطط'],pages:['Reading pages','خواندن صفحات','قراءة الصفحات'],cross_page_review:['Checking pages together','تطبیق صفحات','مراجعة الصفحات'],source_measurements:['Checking measurements','بررسی اندازه‌ها','مراجعة القياسات'],finalizing:['Preparing report','تکمیل گزارش','إعداد التقرير']};
              const i=language==='fa'?1:language==='ar'?2:0;
              setMessage(`${(labels[progress.progress?.stage]||labels.queued)[i]} · ${progress.progress?.pagesCompleted || 0}/${progress.progress?.totalPages || '?'} · ${['Reopen analysis to recover saved work.','با بازکردن دوباره تحلیل، کار ذخیره‌شده بازیابی می‌شود.','افتح التحليل مجدداً لاستعادة العمل المحفوظ.'][i]}`);
            },
            resumeSourceMeasurementsOnly,
            localPdfRecoveryOnly,
          });
          console.log("TAKEOFF FROM API", takeoff);

        if (error || !takeoff) {
          throw (
            error ||
            new Error(
              "AI analysis could not be completed."
            )
          );
        }
const originalWallLength =
  Number(takeoff?.wall_length) || 0;

const originalWallArea =
  Number(takeoff?.wall_area) || 0;

const floorArea =
  Number(
    takeoff?.floor_area
  ) || 0;

const roomCount =
  Number(takeoff?.rooms) || 0;

const defaultWallHeight = Number(takeoff.wall_height)||3.2;

let finalWallLength =
  originalWallLength;

let wallLengthEstimated = false;

if (
  !takeoff.pdf_analysis &&
  finalWallLength <= 0 &&
  floorArea > 0
) {
  const externalPerimeter =
    4 * Math.sqrt(floorArea);

  const averageRoomSize =
    roomCount > 0
      ? Math.sqrt(
          floorArea / roomCount
        )
      : 0;

  const internalWallLength =
    roomCount > 1
      ? averageRoomSize *
        (roomCount - 1)
      : 0;

  finalWallLength =
    externalPerimeter +
    internalWallLength;

  wallLengthEstimated = true;
}

finalWallLength =
  Number(
    finalWallLength.toFixed(2)
  );

const finalWallArea =
  originalWallArea > 0
    ? originalWallArea
    : takeoff.pdf_analysis ? 0 : finalWallLength *
      defaultWallHeight;

const finalTakeoff = {
  ...takeoff,

  wall_length:
    finalWallLength,

  wall_area:
    Number(
      finalWallArea.toFixed(2)
    ),

  wall_height:
    defaultWallHeight,

  wall_length_estimated:
    wallLengthEstimated,

  wall_area_estimated:
    originalWallArea <= 0,

  wall_length_source:
    originalWallLength > 0
      ? "ai_analysis"
      : "floor_area_room_estimate",

  wall_height_source:
    "project_default",

  wall_area_source:
    originalWallArea > 0
      ? "ai_analysis"
      : "wall_length_x_default_height",
};

console.log(
  "[Takeoff] Final calculated values:",
  {
    originalWallLength,
    originalWallArea,
    floorArea,
    roomCount,
    finalWallLength:
      finalTakeoff.wall_length,
    finalWallArea:
      finalTakeoff.wall_area,
  }
);

takeoffResultRef.current = finalTakeoff;
setTakeoffResult(
  finalTakeoff
);
await persistTakeoff(projectId,finalTakeoff);
analysisSucceeded = true;

const measurementReview = finalTakeoff.pdf_analysis?.document_review_status;
if (extension === "pdf" && ["failed", "pending"].includes(measurementReview?.status)) {
  setMessage("PDF page extraction saved. Cross-page measurement review is incomplete.");
  setErrorMessage(
    `PDF measurement review ${measurementReview.status}: ${measurementReview.reason || "Additional source review is required."} Quantities remain provisional; the BOQ is incomplete.`
  );
} else if (extension === "pdf" && finalTakeoff.pdf_analysis?.measurement_completion?.status === 'incomplete') {
  setMessage("PDF requests finished. Measured quantities are incomplete.");
  setErrorMessage("Some source quantities are missing, excluded or withheld. Download the PDF report to review the gaps before using the BOQ.");
} else {
  setMessage("AI quantity takeoff completed successfully.");
}
        return;
      }

      // Start a new analysis scope. OCR cache must never leak from an old
      // translation/viewer run into the newly uploaded drawing.
      analysisRunIdRef.current =
        crypto.randomUUID();
      setAnalysisRunId(analysisRunIdRef.current);

      // Never allow a takeoff from another drawing to remain visible while
      // a different document is being analyzed.
      setTakeoffResult(null);
      if (typeof window !== "undefined") {
        await rememberEngineeringTakeoff(window.localStorage,projectId,readTakeoffSync(projectId));
        window.localStorage.removeItem(
          `ventra:project-takeoff:${projectId}`
        );
      }

      console.log("[VENTRA APS] analyzing selected document", {
        id: selectedDocument.id,
        fileName: selectedDocument.file_name,
        fileType: selectedDocument.file_type,
      });

      setMessage(
        `Uploading ${selectedDocument.file_name} to Autodesk APS...`
      );

      const uploadResult =
        await uploadDocumentToAps(
          selectedDocument
        );

      setMessage(
        "Starting Autodesk model translation..."
      );

      await startApsTranslation(
        uploadResult.urn, projectId
      );

      const manifest =
        await waitForApsTranslation(
          uploadResult.urn,
          (progress) => {
            setMessage(
              `Autodesk translation: ${
                progress || "in progress"
              }`
            );
          }
        );

      const apsResult = {
        project_id: projectId,
        document_id:
          selectedDocument.id || null,
        document_name:
          selectedDocument.file_name,
        document_type:
          selectedDocument.file_type || null,
        source: "autodesk-aps",
        aps_urn: uploadResult.urn,
        aps_status: "ready",
        extraction_status:
          "translation-complete",
        analyzed_at:
          new Date().toISOString(),
        confidence: null,
        rooms: null,
        doors: null,
        windows: null,
        wall_length: null,
        wall_area: null,
        floor_area: null,
        ceiling_area: null,
        notes:
          "Autodesk translation completed. Geometry quantities have not been extracted yet.",
        manifest,
      };

      takeoffResultRef.current=apsResult;
      setTakeoffResult(apsResult);

      await persistTakeoff(projectId,apsResult);

      setMessage(
        "Autodesk translation completed. The model is ready for Viewer and geometry extraction."
      );
      analysisSucceeded = true;
    } catch (error) {
      console.error(
        "[Drawing Center] Analysis failed:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Could not process the drawing."
      );
    } finally {
      analysisInFlightRef.current = false;
      finishDrawingWorkflow(projectId,workflowToken,analysisSucceeded);
      setAnalyzing(false);
    }
  }


  async function handleDownload(document) {
    try {
      clearMessages();

      const { url, error } =
        await downloadProjectDocument(document);

      if (error || !url) {
        throw (
          error ||
          new Error("Could not create a download link.")
        );
      }

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(
        error?.message || "Could not download the file."
      );
    }
  }

  async function handleDelete(document) {
    if (!document?.id || deletingDocumentId) {
      return;
    }

    try {
      setDeletingDocumentId(document.id);
      clearMessages();

      const { error } = await deleteProjectDocument(document);

      if (error) {
        throw error;
      }

      setDocuments((current) => {
        const remaining = current.filter(
          (item) => item.id !== document.id
        );

        if (selectedDocumentId === document.id) {
          setSelectedDocumentId(remaining[0]?.id || null);
          selectDrawingDocument(projectId,remaining[0]?.id || null);
        }

        return remaining;
      });

      if(takeoffResultRef.current?.document_id===document.id){
        await clearPersistedTakeoff(projectId);
        window.localStorage.removeItem(`ventra:project-room-cache:${projectId}`);
        takeoffResultRef.current=null;setTakeoffResult(null);
      }

      setMessage("Drawing deleted successfully.");
    } catch (error) {
      setErrorMessage(
        error?.message || "Could not delete the file."
      );
    } finally {
      setDeletingDocumentId(null);
    }
  }


function isDegenerateSemanticRoomPayload(
  payload
) {
  const labels =
    Array.isArray(
      payload?.labels
    )
      ? payload.labels
      : [];

  if (
    labels.length < 4
  ) {
    return true;
  }

  const normalizedTypes =
    labels
      .map(
        (room) =>
          String(
            room?.type ||
            room?.label ||
            ""
          )
            .trim()
            .toLowerCase()
      )
      .filter(Boolean);

  const distinctTypes =
    new Set(
      normalizedTypes
    );

  const suspiciousWetTypes =
    new Set([
      "toilet",
      "bathroom",
      "powder room",
      "powder_room",
      "wc",
    ]);

  const allWet =
    normalizedTypes.length > 0 &&
    normalizedTypes.every(
      (type) =>
        suspiciousWetTypes.has(
          type
        )
    );

  const singleTypeOnly =
    labels.length >= 4 &&
    distinctTypes.size === 1;

  return (
    allWet ||
    singleTypeOnly
  );
}

async function handleApsGeometryExtracted(analysis) {
  if (!analysis) {
    return;
  }

  const {
    objects = [],
    properties = [],
    layers,
    roomVisionImage,
    apsUrn,
    viewerRoomLabels,
    ...geometry
  } = analysis;

  const extractionSource=takeoffResultRef.current;
  if(!extractionSource||extractionSource.source!=="autodesk-aps"||extractionSource.aps_urn!==apsUrn||selectedDocumentId&&extractionSource.document_id!==selectedDocumentId){
    console.warn("[VENTRA APS] ignored stale geometry before AI analysis");return;
  }

  // v16: The property-level APS centroid is unreliable for this 2D DWG
  // (47 electrical blocks were all reporting the same point). The geometry
  // extractor already builds a per-dbId centroid from transformed line/arc
  // geometry, so merge that authoritative spatial data into each object
  // before the takeoff builder classifies and serializes it.
  const geometryCentroidsByDbId =
    geometry?.objectGeometryCentroids &&
    typeof geometry.objectGeometryCentroids ===
      "object"
      ? geometry.objectGeometryCentroids
      : {};

  geometry.roomLabelEvidence=collectInteriorRoomLabels([...objects,...collectDrawingText(objects).records],geometryCentroidsByDbId,viewerRoomLabels);

  const attachDbIdGeometryCentroid =
    (items) =>
      Array.isArray(items)
        ? items.map((item) => {
            const dbId =
              item?.dbId;

            const spatial =
              dbId !== null &&
              dbId !== undefined
                ? geometryCentroidsByDbId[
                    String(dbId)
                  ] ||
                  geometryCentroidsByDbId[
                    dbId
                  ] ||
                  null
                : null;

            const sx =
              spatial?.x;
            const sy =
              spatial?.y;

            const hasSpatial =
              sx !== null &&
              sx !== undefined &&
              sy !== null &&
              sy !== undefined &&
              Number.isFinite(
                Number(sx)
              ) &&
              Number.isFinite(
                Number(sy)
              );

            if (!hasSpatial) {
              return item;
            }

            const width =
              Number.isFinite(
                Number(
                  spatial?.width
                )
              )
                ? Math.abs(
                    Number(
                      spatial.width
                    )
                  )
                : 0;

            const height =
              Number.isFinite(
                Number(
                  spatial?.height
                )
              )
                ? Math.abs(
                    Number(
                      spatial.height
                    )
                  )
                : 0;

            const x =
              Number(sx);
            const y =
              Number(sy);

            return {
              ...item,
              centroid: {
                x,
                y,
                z: null,
                coordinateSystem:
                  "aps_transformed_2d_geometry",
                source:
                  "aps_dbid_geometry_bounds",
              },
              boundingBox:
                width > 0 ||
                height > 0
                  ? {
                      min: {
                        x:
                          x -
                          width / 2,
                        y:
                          y -
                          height / 2,
                        z: null,
                      },
                      max: {
                        x:
                          x +
                          width / 2,
                        y:
                          y +
                          height / 2,
                        z: null,
                      },
                    }
                  : item?.boundingBox ||
                    null,
              spatialSource:
                "aps_dbid_geometry_bounds",
            };
          })
        : [];

  const spatialObjects =
    attachDbIdGeometryCentroid(
      objects
    );

  const spatialProperties =
    attachDbIdGeometryCentroid(
      properties
    );

  console.log(
    "[VENTRA DBID GEOMETRY JOIN v16]",
    {
      geometryCentroidCount:
        Object.keys(
          geometryCentroidsByDbId
        ).length,
      objectCount:
        spatialObjects.length,
      objectsJoined:
        spatialObjects.filter(
          (item) =>
            item?.centroid
              ?.source ===
            "aps_dbid_geometry_bounds"
        ).length,
      propertyCount:
        spatialProperties.length,
      propertiesJoined:
        spatialProperties.filter(
          (item) =>
            item?.centroid
              ?.source ===
            "aps_dbid_geometry_bounds"
        ).length,
    }
  );

  let generatedTakeoff =
    buildTakeoffFromAps({
      geometry: {
        ...geometry,
        viewerRoomLabels:
          Array.isArray(viewerRoomLabels)
            ? viewerRoomLabels
            : [],
      },
      objects:
        spatialObjects,
      properties:
        spatialProperties,
      layers,
    });

  // Publish verified geometry independently; optional AI room/schedule reads must not block 3D.
  const preview={...extractionSource,geometry,object_details:generatedTakeoff.object_details,model_unit:generatedTakeoff.model_unit,meter_factor:generatedTakeoff.meter_factor,geometry_status:"ready-for-3d",extraction_status:"geometry-ready-analysis-pending",analyzed_at:new Date().toISOString()};
  if(dwgReconstructionReadiness(preview,apsUrn).ready){
    try{
      await persistTakeoff(projectId,preview,{kind:"engineering"});
      if(takeoffResultRef.current?.aps_urn!==apsUrn)return;
      window.dispatchEvent(new CustomEvent('ventra:engineering-takeoff-updated',{detail:{projectId,urn:apsUrn}}));
    }catch(error){console.warn("[VENTRA APS] early geometry save failed",error.message);}
  }

  generatedTakeoff.drawing_evidence = collectDrawingText(spatialProperties);

  console.log(
    "[VENTRA ACTUAL APS TAKEOFF PATH v16]",
    {
      electricalItems:
        Number(
          generatedTakeoff
            ?.electrical_items
        ) || 0,
      electricalObjectsWithCentroid:
        Number(
          generatedTakeoff
            ?.statistics
            ?.electricalObjectsWithCentroid
        ) || 0,
      distinctElectricalCentroids:
        Number(
          generatedTakeoff
            ?.statistics
            ?.distinctElectricalCentroids
        ) || 0,
      electricalCentroidSources:
        generatedTakeoff
          ?.statistics
          ?.electricalCentroidSources ||
        null,
      sampleElectrical:
        Array.isArray(
          generatedTakeoff
            ?.object_details
            ?.mep
        )
          ? generatedTakeoff.object_details.mep
              .filter(
                (item) =>
                  item?.detectedType ===
                    "electrical"
              )
              .slice(0, 8)
              .map(
                (item) => ({
                  dbId:
                    item?.dbId ??
                    null,
                  subtype:
                    item?.electricalSubtype ||
                    null,
                  centroid:
                    item?.centroid ||
                    null,
                  boundingBox:
                    item?.boundingBox ||
                    null,
                })
              )
          : [],
    }
  );

  // HARD LOCK: geometry loops are engineering diagnostics only. Never let
  // them become semantic rooms, even transiently while OpenAI is still
  // analyzing the translated plan.
  const geometryRoomCandidatesHardLock =
    Array.isArray(generatedTakeoff?.object_details?.rooms)
      ? generatedTakeoff.object_details.rooms
      : [];

  generatedTakeoff = {
    ...generatedTakeoff,
    rooms: 0,
    room_area: 0,
    object_details: {
      ...generatedTakeoff.object_details,
      rooms: [],
      geometry_room_candidates:
        geometryRoomCandidatesHardLock,
    },
    classifications: {
      ...generatedTakeoff.classifications,
      room_types: {},
      room_area_by_type: {},
    },
    room_label_source: "awaiting_openai_api",
    room_analysis_mode: "aps_openai_hybrid",
    geometry_room_candidate_count:
      geometryRoomCandidatesHardLock.length,
  };

  // HYBRID ROOM PIPELINE:
  // Autodesk APS remains the technical source for upload, translation,
  // viewability, thumbnail, metadata/properties, and engineering geometry.
  // OpenAI analyzes the APS-translated plan for room count/name/type and
  // visually verifies any safe APS text evidence. Ventra combines the two.
  // Geometry-derived closed loops remain engineering diagnostics only and are
  // never allowed to manufacture Room Schedule entries.
  if (apsUrn || roomVisionImage) {
    if (!roomVisionImage) {
      console.warn(
        "[VENTRA ANALYZER] semantic analysis deferred: real Viewer capture missing",
        {
          apsUrn:
            Boolean(apsUrn),
        }
      );

      setMessage(
        "Autodesk translation is ready. Waiting for the high-resolution Viewer capture before semantic takeoff..."
      );

      return;
    }

    try {
      console.log(
        "[VENTRA ROOM AI] analyzing translated plan",
        {
          hasImage: Boolean(roomVisionImage),
          apsUrn: Boolean(apsUrn),
        }
      );

      const ventraMode =
        String(
          process.env
            .NEXT_PUBLIC_VENTRA_MODE ||
            "production"
        )
          .trim()
          .toLowerCase();

      let payload = null;

      if (ventraMode === "test") {
        const roomCacheKey =
          `ventra:project-room-cache:${projectId}`;

        let cachedRoomPayload =
          null;

        try {
          const storedRoomCache =
            window.localStorage.getItem(
              roomCacheKey
            );

          if (storedRoomCache) {
            const parsed =
              JSON.parse(
                storedRoomCache
              );

            if (
              Array.isArray(
                parsed?.labels
              ) &&
              parsed.labels.length > 0
            ) {
              if (
                isDegenerateSemanticRoomPayload(
                  parsed
                )
              ) {
                console.warn(
                  "[VENTRA ROOM QUALITY v28] rejected degenerate room cache",
                  {
                    rooms:
                      parsed.labels.length,
                    types:
                      parsed.labels.map(
                        (room) =>
                          room?.type ||
                          room?.label
                      ),
                  }
                );

                window.localStorage.removeItem(
                  roomCacheKey
                );
              } else {
                cachedRoomPayload =
                  parsed;
              }
            }
          }
        } catch (cacheError) {
          console.warn(
            "[VENTRA TEST MODE v18] dedicated room cache read failed",
            cacheError
          );
        }

        // Backward-compatible recovery: before v18, successful rooms were
        // stored only as part of the takeoff. Recover them once if available.
        if (!cachedRoomPayload) {
          let legacyTakeoff =
            takeoffResult &&
            typeof takeoffResult ===
              "object"
              ? takeoffResult
              : null;

          if (
            !Array.isArray(
              legacyTakeoff
                ?.object_details
                ?.rooms
            ) ||
            legacyTakeoff
              .object_details
              .rooms.length === 0
          ) {
            try {
              const storedTakeoff=readTakeoffSync(projectId,'engineering')||readTakeoffSync(projectId);
              if(storedTakeoff)legacyTakeoff=storedTakeoff;
            } catch {}
          }

          const legacyRooms =
            Array.isArray(
              legacyTakeoff
                ?.object_details
                ?.rooms
            )
              ? legacyTakeoff
                  .object_details
                  .rooms
              : [];

          if (legacyRooms.length > 0) {
            cachedRoomPayload = {
              labels:
                legacyRooms.map(
                  (room) => ({
                    label:
                      room?.name ||
                      room?.label ||
                      "Room",
                    type:
                      room?.type ||
                      room?.name ||
                      "Room",
                    confidence:
                      Number(
                        room
                          ?.verificationConfidence ??
                        room?.confidence ??
                        0.95
                      ) > 1
                        ? Number(
                            room
                              ?.verificationConfidence ??
                            room?.confidence ??
                            95
                          ) / 100
                        : Number(
                            room
                              ?.verificationConfidence ??
                            room?.confidence ??
                            0.95
                          ),
                    verified: true,
                    x:
                      room?.centroid?.x ??
                      null,
                    y:
                      room?.centroid?.y ??
                      null,
                    coordinateSystem:
                      room?.centroid
                        ?.coordinateSystem ||
                      "viewer_sheet_normalized",
                    centroidSource:
                      room?.centroid
                        ?.source ||
                      "legacy_takeoff_cache",
                    bbox:
                      room?.regionBBox ||
                      room?.bbox ||
                      null,
                    planId:
                      room?.planId ||
                      null,
                    planTitle:
                      room?.planTitle ||
                      null,
                  })
                ),
              doors:
                legacyTakeoff
                  ?.doors ??
                null,
              windows:
                legacyTakeoff
                  ?.windows ??
                null,
              source:
                "legacy_takeoff_cache",
            };

            if (
              isDegenerateSemanticRoomPayload(
                cachedRoomPayload
              )
            ) {
              console.warn(
                "[VENTRA ROOM QUALITY v28] rejected degenerate legacy room payload",
                {
                  rooms:
                    cachedRoomPayload
                      .labels.length,
                }
              );
              cachedRoomPayload =
                null;
            }
          }
        }

        if (cachedRoomPayload) {
          payload = {
            ...cachedRoomPayload,
            apsEvidence:
              cachedRoomPayload
                ?.apsEvidence ||
              {
                rawCount: 0,
                trustedCount: 0,
                labels: [],
              },
            testMode: true,
          };

          console.log(
            "[VENTRA TEST MODE v18] dedicated semantic room cache reused",
            {
              rooms:
                payload.labels.length,
              source:
                cachedRoomPayload
                  ?.source ||
                "room_cache",
            }
          );
        } else {
          // Zero-cost fallback for a fresh test environment:
          // use APS-native room text that already has real per-dbId world
          // bounds. This is intentionally TEST-only and is never presented
          // as a production AI result.
          const apsSpatialRooms =
            Array.isArray(
              viewerRoomLabels
            )
              ? viewerRoomLabels.filter(
                  (room) =>
                    room &&
                    String(
                      room?.label ||
                      ""
                    ).trim() &&
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
                )
              : [];

          if (
            apsSpatialRooms.length === 0
          ) {
            throw new Error(
              "TEST MODE has no saved semantic room cache and APS did not expose any spatial room labels. Run one successful Production/Economy room analysis later to seed the permanent room cache."
            );
          }

          const apsFallbackPayload = {
            labels:
              apsSpatialRooms.map(
                (room) => {
                  const minX =
                    Number(
                      room
                        ?.boundingBox
                        ?.min?.x
                    );
                  const minY =
                    Number(
                      room
                        ?.boundingBox
                        ?.min?.y
                    );
                  const maxX =
                    Number(
                      room
                        ?.boundingBox
                        ?.max?.x
                    );
                  const maxY =
                    Number(
                      room
                        ?.boundingBox
                        ?.max?.y
                    );

                  const hasBox =
                    [
                      minX,
                      minY,
                      maxX,
                      maxY,
                    ].every(
                      Number.isFinite
                    ) &&
                    maxX > minX &&
                    maxY > minY;

                  return {
                    label:
                      room?.label ||
                      room?.rawLabel ||
                      "Room",
                    type:
                      room?.roomType ||
                      room?.label ||
                      "Room",
                    confidence: 0.99,
                    verified: true,
                    x:
                      Number(
                        room.centroid.x
                      ),
                    y:
                      Number(
                        room.centroid.y
                      ),
                    coordinateSystem:
                      "aps_model_world",
                    centroidSource:
                      "aps_direct_text_world_bounds",
                    bbox:
                      hasBox
                        ? {
                            x: minX,
                            y: minY,
                            width:
                              maxX -
                              minX,
                            height:
                              maxY -
                              minY,
                          }
                        : null,
                    planId: null,
                    planTitle: null,
                  };
                }
              ),
            apsEvidence: {
              rawCount:
                apsSpatialRooms.length,
              trustedCount:
                apsSpatialRooms.length,
              labels:
                apsSpatialRooms.map(
                  (room) =>
                    room?.label
                ),
            },
            doors:
              takeoffResult?.doors ??
              null,
            windows:
              takeoffResult
                ?.windows ??
              null,
            planAnalyses: [],
            testMode: true,
            source:
              "aps_spatial_room_labels",
          };

          if (
            isDegenerateSemanticRoomPayload(
              apsFallbackPayload
            )
          ) {
            console.warn(
              "[VENTRA ROOM QUALITY v28] APS room set is degenerate; using ONE low-cost recovery call",
              {
                rooms:
                  apsFallbackPayload
                    .labels.length,
                types:
                  apsFallbackPayload
                    .labels.map(
                      (room) =>
                        room?.type
                    ),
              }
            );

            const recoveryResponse =
              await commercialFetch(
                "/api/aps/room-labels",
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/json",
                    "X-Ventra-Mode":
                      "test-recovery",
                  },
                  body:
                    JSON.stringify({
                      projectId,
                      image:
                        roomVisionImage,
                      urn:
                        apsUrn ||
                        takeoffResult
                          ?.aps_urn ||
                        null,
                      analysisRunId:
                        analysisRunIdRef
                          .current,
                      recoveryOnly:
                        true,
                    }),
                }
              );

            const recoveryPayload =
              await recoveryResponse.json();

            if (
              recoveryResponse.ok &&
              Array.isArray(
                recoveryPayload
                  ?.labels
              ) &&
              recoveryPayload
                .labels.length >= 4 &&
              !isDegenerateSemanticRoomPayload(
                recoveryPayload
              )
            ) {
              payload = {
                ...recoveryPayload,
                testMode: true,
              };

              try {
                window.localStorage.setItem(
                  roomCacheKey,
                  JSON.stringify({
                    ...payload,
                    version: 2,
                    source:
                      "openai_low_cost_room_recovery",
                    savedAt:
                      new Date().toISOString(),
                  })
                );
              } catch {}

              console.log(
                "[VENTRA ROOM QUALITY v28] low-cost recovery accepted and cached",
                {
                  rooms:
                    payload.labels.length,
                  types:
                    payload.labels.map(
                      (room) =>
                        room?.type
                    ),
                }
              );
            } else {
              // Do not pretend a homogeneous APS set is trustworthy.
              // Keep it visible only as review data, not authoritative rooms.
              payload = {
                labels: [],
                apsEvidence:
                  apsFallbackPayload
                    .apsEvidence,
                doors:
                  apsFallbackPayload
                    .doors,
                windows:
                  apsFallbackPayload
                    .windows,
                planAnalyses: [],
                testMode: true,
                source:
                  "degenerate_aps_rooms_rejected",
              };

              console.warn(
                "[VENTRA ROOM QUALITY v28] recovery unavailable/degenerate; false room set rejected",
                {
                  status:
                    recoveryResponse.status,
                  recovered:
                    Array.isArray(
                      recoveryPayload
                        ?.labels
                    )
                      ? recoveryPayload
                          .labels.length
                      : 0,
                }
              );
            }
          } else {
            payload =
              apsFallbackPayload;

            console.log(
              "[VENTRA TEST MODE v28] APS spatial rooms accepted without OpenAI",
              {
                rooms:
                  payload.labels.length,
                source:
                  payload.source,
              }
            );
          }
        }
      } else {
        const response =
          await commercialFetch(
            "/api/aps/room-labels",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                "X-Ventra-Mode":
                  ventraMode,
              },
              body:
                JSON.stringify({
                  projectId,
                  image:
                    roomVisionImage ||
                    null,
                  urn:
                    apsUrn ||
                    takeoffResult
                      ?.aps_urn ||
                    null,
                  analysisRunId:
                    analysisRunIdRef
                      .current,
                  geometryWindowCount:
                    Number.isFinite(
                      Number(
                        geometry
                          ?.windowCount
                      )
                    )
                      ? Number(
                          geometry
                            .windowCount
                        )
                      : null,
                }),
            }
          );

        if (!response.ok) {
          throw new Error(
            `Room AI request failed (${response.status})`
          );
        }

        payload =
          await response.json();
      }

      const apsRoomEvidence =
        payload?.apsEvidence &&
        typeof payload.apsEvidence === "object"
          ? payload.apsEvidence
          : {
              rawCount: 0,
              trustedCount: 0,
              labels: [],
            };

      const aiLabels = Array.isArray(
        payload?.labels
      )
        ? payload.labels
        : [];

      const roomTypeKey = {
        Room: "room",
        "Living Room": "living_room",
        "Family Room": "family_room",
        Lounge: "lounge",
        "Dining Room": "dining_room",
        Kitchen: "kitchen",
        Pantry: "pantry",
        Laundry: "laundry",
        Bedroom: "bedroom",
        "Master Bedroom": "master_bedroom",
        Bathroom: "bathroom",
        Toilet: "toilet",
        "Powder Room": "powder_room",
        Hall: "hall",
        Corridor: "corridor",
        Foyer: "foyer",
        Office: "office",
        Study: "study",
        Closet: "closet",
        "Walk-in Closet": "walk_in_closet",
        Store: "store",
        Balcony: "balcony",
        Terrace: "terrace",
        Garage: "garage",
      };

      const semanticRooms = aiLabels
        .filter(
          (item) =>
            item &&
            String(item.label || "").trim() &&
            Number(item.confidence) >= 0.62 &&
            item.verified !== false
        )
        .map((item, index) => ({
          id: `ai-room-${index + 1}`,
          name: String(
            item.label || item.type || `Room ${index + 1}`
          ).trim(),
          roomType:
            roomTypeKey[item.type] ||
            "room",
          detectedType:
            roomTypeKey[item.type] ||
            "room",
          roomTypeSource:
            "openai_verified_plan_analysis",
          roomTypeConfidence:
            Math.round(
              Number(item.confidence || 0) * 100
            ),
          area: null,
          perimeter: null,
          regionBBox:
            item?.bbox &&
            typeof item.bbox === "object" &&
            Number.isFinite(
              Number(item.bbox.x)
            ) &&
            Number.isFinite(
              Number(item.bbox.y)
            ) &&
            Number.isFinite(
              Number(item.bbox.width)
            ) &&
            Number.isFinite(
              Number(item.bbox.height)
            ) &&
            Number(item.bbox.width) > 0 &&
            Number(item.bbox.height) > 0
              ? {
                  x:
                    Number(item.bbox.x),
                  y:
                    Number(item.bbox.y),
                  width:
                    Number(item.bbox.width),
                  height:
                    Number(item.bbox.height),
                }
              : null,
          centroid: (() => {
            const rawX =
              item?.x;
            const rawY =
              item?.y;

            const directX =
              rawX !== null &&
              rawX !== undefined &&
              rawX !== "" &&
              Number.isFinite(
                Number(rawX)
              )
                ? Number(rawX)
                : null;

            const directY =
              rawY !== null &&
              rawY !== undefined &&
              rawY !== "" &&
              Number.isFinite(
                Number(rawY)
              )
                ? Number(rawY)
                : null;

            if (
              directX !== null &&
              directY !== null
            ) {
              return {
                x: directX,
                y: directY,
                coordinateSystem:
                  item?.coordinateSystem ||
                  "viewer_sheet_normalized",
                source:
                  item?.centroidSource ||
                  "room_analyzer_xy",
              };
            }

            const bbox =
              item?.bbox &&
              typeof item.bbox === "object"
                ? item.bbox
                : null;

            const rawBx =
              bbox?.x;
            const rawBy =
              bbox?.y;
            const rawBw =
              bbox?.width;
            const rawBh =
              bbox?.height;

            const bx =
              rawBx !== null &&
              rawBx !== undefined &&
              rawBx !== "" &&
              Number.isFinite(
                Number(rawBx)
              )
                ? Number(rawBx)
                : null;

            const by =
              rawBy !== null &&
              rawBy !== undefined &&
              rawBy !== "" &&
              Number.isFinite(
                Number(rawBy)
              )
                ? Number(rawBy)
                : null;

            const bw =
              rawBw !== null &&
              rawBw !== undefined &&
              rawBw !== "" &&
              Number.isFinite(
                Number(rawBw)
              )
                ? Number(rawBw)
                : null;

            const bh =
              rawBh !== null &&
              rawBh !== undefined &&
              rawBh !== "" &&
              Number.isFinite(
                Number(rawBh)
              )
                ? Number(rawBh)
                : null;

            if (
              bx !== null &&
              by !== null &&
              bw !== null &&
              bh !== null &&
              bw > 0 &&
              bh > 0
            ) {
              return {
                x:
                  bx + bw / 2,
                y:
                  by + bh / 2,
                coordinateSystem:
                  "viewer_sheet_normalized",
                source:
                  "room_analyzer_bbox_center",
              };
            }

            return null;
          })(),
          planId:
            item.planId || null,
          planTitle:
            item.planTitle || null,
          source:
            "openai_verified_plan_region",
        }));

      const roomGeometryMatch =
        mapSemanticRoomsToGeometry(
          semanticRooms,
          geometryRoomCandidatesHardLock,
          generatedTakeoff.floor_area
        );

      console.log(
        "[VENTRA ROOM GEOMETRY MATCH]",
        {
          matched:
            roomGeometryMatch.matched,
          reason:
            roomGeometryMatch.reason || null,
          semanticCount:
            semanticRooms.length,
          geometryCount:
            geometryRoomCandidatesHardLock.length,
          selectedGeometryCount:
            roomGeometryMatch.selectedGeometryCount ||
            semanticRooms.length,
          candidateSelection:
            roomGeometryMatch.candidateSelection || null,
          candidateAreaRatio:
            roomGeometryMatch.candidateAreaRatio ?? null,
          averageDistance:
            roomGeometryMatch.averageDistance ?? null,
          maxDistance:
            roomGeometryMatch.maxDistance ?? null,
        }
      );

      const aiRegionAreas =
        !roomGeometryMatch.matched
          ? applyAiRoomRegionAreas(
              semanticRooms,
              generatedTakeoff.floor_area
            )
          : {
              rooms:
                roomGeometryMatch.rooms,
              applied: false,
              reason:
                "autodesk_room_geometry_match_available",
            };

      const centroidRoomAreas =
        !roomGeometryMatch.matched &&
        !aiRegionAreas.applied
          ? applySemanticCentroidRoomAreas(
              semanticRooms,
              generatedTakeoff.floor_area
            )
          : {
              rooms:
                aiRegionAreas.rooms,
              applied: false,
              reason:
                aiRegionAreas.applied
                  ? "ai_region_area_available"
                  : "autodesk_room_geometry_match_available",
            };

      const aiRooms =
        roomGeometryMatch.matched
          ? roomGeometryMatch.rooms
          : aiRegionAreas.applied
            ? aiRegionAreas.rooms
            : centroidRoomAreas.rooms;

      console.log(
        "[VENTRA ROOM AREA SOURCE]",
        {
          source:
            roomGeometryMatch.matched
              ? "aps_closed_face_spatial_match"
              : aiRegionAreas.applied
                ? "openai_room_region_scaled_to_autodesk_floor_area"
                : centroidRoomAreas.applied
                  ? "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
                  : "unavailable",
          roomsWithArea:
            aiRooms.filter(
              (room) =>
                Number(room?.area) > 0
            ).length,
          roomAreaTotal:
            Number(
              aiRooms.reduce(
                (sum, room) =>
                  sum +
                  (Number(room?.area) || 0),
                0
              ).toFixed(2)
            ),
          roomsWithCentroid:
            aiRooms.filter(
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
              aiRooms
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
            aiRooms.filter(
              (room) =>
                room?.regionBBox &&
                Number(
                  room.regionBBox.width
                ) > 0 &&
                Number(
                  room.regionBBox.height
                ) > 0
            ).length,
          roomPlans:
            [...new Set(
              aiRooms
                .map(
                  (room) =>
                    room?.planId
                )
                .filter(Boolean)
            )],
        }
      );

      const roomTypes = {};
      for (const room of aiRooms) {
        roomTypes[room.roomType] =
          (roomTypes[room.roomType] || 0) + 1;
      }

      const geometryRoomCandidates =
        geometryRoomCandidatesHardLock;

      const roomAreasAvailable =
        roomGeometryMatch.matched ||
        aiRegionAreas.applied ||
        centroidRoomAreas.applied;

      const validatedRoomArea =
        roomAreasAvailable
          ? aiRooms.reduce(
              (sum, room) =>
                sum +
                (Number(
                  room?.area
                ) || 0),
              0
            )
          : 0;

      const roomAreaByType =
        roomAreasAvailable
          ? aiRooms.reduce(
              (result, room) => {
                const key =
                  room.roomType ||
                  "room";

                result[key] =
                  Number(
                    (
                      Number(
                        result[key]
                      ) +
                      (Number(
                        room?.area
                      ) || 0)
                    ).toFixed(2)
                  );

                return result;
              },
              {}
            )
          : {};

      const wetRoomTypes = new Set([
        "bathroom",
        "toilet",
        "powder_room",
        "kitchen",
        "pantry",
        "laundry",
      ]);

      const measuredRoomQuantities =
        roomAreasAvailable
          ? aiRooms.reduce(
              (result, room) => {
                const type =
                  room?.roomType || "room";
                const area =
                  Number(room?.area) || 0;
                const perimeter =
                  Number(room?.perimeter) || 0;

                if (wetRoomTypes.has(type)) {
                  result.wet_floor_area += area;
                  result.wet_room_perimeter += perimeter;
                }

                if (type === "bathroom") {
                  result.bathroom_floor_area += area;
                  result.bathroom_perimeter += perimeter;
                }

                if (
                  type === "toilet" ||
                  type === "powder_room"
                ) {
                  result.toilet_floor_area += area;
                  result.toilet_perimeter += perimeter;
                }

                if (
                  type === "kitchen" ||
                  type === "pantry"
                ) {
                  result.kitchen_floor_area += area;
                  result.kitchen_perimeter += perimeter;
                }

                if (type === "laundry") {
                  result.laundry_floor_area += area;
                  result.laundry_perimeter += perimeter;
                }

                if (
                  type === "balcony" ||
                  type === "terrace"
                ) {
                  result.balcony_floor_area += area;
                  result.balcony_perimeter += perimeter;
                }

                return result;
              },
              {
                wet_floor_area: 0,
                wet_room_perimeter: 0,
                bathroom_floor_area: 0,
                bathroom_perimeter: 0,
                toilet_floor_area: 0,
                toilet_perimeter: 0,
                kitchen_floor_area: 0,
                kitchen_perimeter: 0,
                laundry_floor_area: 0,
                laundry_perimeter: 0,
                balcony_floor_area: 0,
                balcony_perimeter: 0,
              }
            )
          : {
              wet_floor_area: 0,
              wet_room_perimeter: 0,
              bathroom_floor_area: 0,
              bathroom_perimeter: 0,
              toilet_floor_area: 0,
              toilet_perimeter: 0,
              kitchen_floor_area: 0,
              kitchen_perimeter: 0,
              laundry_floor_area: 0,
              laundry_perimeter: 0,
              balcony_floor_area: 0,
              balcony_perimeter: 0,
            };

      for (const key of Object.keys(measuredRoomQuantities)) {
        measuredRoomQuantities[key] = Number(
          measuredRoomQuantities[key].toFixed(2)
        );
      }

      const doorValidation =
        payload?.validation
          ?.openings?.doors ||
        null;

      const windowValidation =
        payload?.validation
          ?.openings?.windows ||
        null;

      const geometryDoorCount =
        Number.isFinite(
          Number(
            generatedTakeoff?.doors
          )
        )
          ? Number(
              generatedTakeoff.doors
            )
          : null;

      const geometryWindowCount =
        Number.isFinite(
          Number(
            generatedTakeoff?.windows
          )
        )
          ? Number(
              generatedTakeoff.windows
            )
          : null;

      const analyzerDoorCount =
        doorValidation?.status ===
          "accepted" &&
        Number.isFinite(
          Number(
            payload?.openings?.doors
          )
        )
          ? Number(
              payload.openings.doors
            )
          : null;

      const analyzerWindowCount =
        windowValidation?.status ===
          "accepted" &&
        Number.isFinite(
          Number(
            payload?.openings?.windows
          )
        )
          ? Number(
              payload.openings.windows
            )
          : null;

      const doorAnalyzerSource =
        String(
          doorValidation?.source ||
            ""
        );

      const windowAnalyzerSource =
        String(
          windowValidation?.source ||
            ""
        );

      const doorHasScheduleAuthority =
        doorAnalyzerSource.includes(
          "schedule_verified_row_sum"
        );

      const windowHasScheduleAuthority =
        windowAnalyzerSource.includes(
          "schedule_verified_row_sum"
        );

      // Opening precedence:
      // 1) verified schedule quantity for that opening type
      // 2) positive Autodesk/geometry count
      // 3) accepted OpenAI visual count
      // The top-level openings.source is intentionally generic, so authority
      // must be read from validation.openings.doors/windows individually.
      const resolvedDoors =
        doorHasScheduleAuthority &&
        analyzerDoorCount !== null
          ? analyzerDoorCount
          : geometryDoorCount !== null &&
              geometryDoorCount > 0
            ? geometryDoorCount
            : analyzerDoorCount;

      const resolvedWindows =
        windowHasScheduleAuthority &&
        analyzerWindowCount !== null
          ? analyzerWindowCount
          : geometryWindowCount !== null &&
              geometryWindowCount > 0
            ? geometryWindowCount
            : analyzerWindowCount;

      generatedTakeoff = {
        ...generatedTakeoff,
        rooms: aiRooms.length,
        room_area:
          Number(
            validatedRoomArea.toFixed(
              2
            )
          ),
        ...measuredRoomQuantities,
        room_quantity_source:
          roomGeometryMatch.matched
            ? "aps_closed_face_spatial_match"
            : aiRegionAreas.applied
              ? "openai_room_region_scaled_to_autodesk_floor_area"
              : centroidRoomAreas.applied
                ? "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
                : "unavailable",
        doors:
          resolvedDoors,
        windows:
          resolvedWindows,
        object_details: {
          ...generatedTakeoff.object_details,
          rooms: aiRooms,
          geometry_room_candidates:
            geometryRoomCandidates,
        },
        classifications: {
          ...generatedTakeoff.classifications,
          room_types: roomTypes,
          room_area_by_type:
            roomAreaByType,
        },
        room_label_source:
          "aps_openai_verified_plan_geometry_match",
        room_analysis_mode:
          "aps_openai_verified",
        geometry_room_candidate_count:
          geometryRoomCandidates.length,
        room_geometry_match:
          roomGeometryMatch,
        room_area_source:
          roomGeometryMatch.matched
            ? "aps_closed_face_spatial_match"
            : aiRegionAreas.applied
              ? "openai_room_region_scaled_to_autodesk_floor_area"
              : centroidRoomAreas.applied
                ? "semantic_centroid_voronoi_scaled_to_autodesk_floor_area"
                : "unavailable",
        ai_room_region_area:
          {
            applied:
              aiRegionAreas.applied,
            reason:
              aiRegionAreas.reason,
          },
        takeoff_validation:
          payload?.validation ||
          null,
        sheet_analysis:
          payload?.sheet ||
          null,
        analyzer_version:
          payload?.analyzerVersion ||
          null,
        opening_analysis_source:
          payload?.openings?.source ||
          null,
        door_count_source:
          doorHasScheduleAuthority &&
          analyzerDoorCount !== null
            ? "verified_schedule"
            : geometryDoorCount !== null &&
                geometryDoorCount > 0
              ? "autodesk_geometry"
              : analyzerDoorCount !== null
                ? "openai_visual_fallback"
                : "unavailable",
        window_count_source:
          windowHasScheduleAuthority &&
          analyzerWindowCount !== null
            ? "verified_schedule"
            : geometryWindowCount !== null &&
                geometryWindowCount > 0
              ? "autodesk_geometry"
              : analyzerWindowCount !== null
                ? "openai_visual_fallback"
                : "unavailable",
        opening_analysis_confidence:
          Number(
            payload?.openings
              ?.confidence
          ) || 0,
        aps_room_text_evidence:
          apsRoomEvidence,
        room_analysis_sources: {
          autodeskAps: {
            upload: true,
            translation: true,
            thumbnail: true,
            metadata:
              Number(
                apsRoomEvidence.rawCount || 0
              ),
            geometryDiagnostics:
              geometryRoomCandidates.length,
          },
          openai: {
            semanticRooms:
              aiRooms.length,
          },
        },
      };

      console.log(
        "[VENTRA ROOM SOURCE] APS_OPENAI_HYBRID",
        {
          geometryCandidatesIgnored:
            geometryRoomCandidatesHardLock.length,
          semanticRooms: aiRooms.length,
          apsRawEvidence:
            apsRoomEvidence.rawCount,
          apsTrustedTextEvidence:
            apsRoomEvidence.trustedCount,
          roomsWithCentroid:
            aiRooms.filter(
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
            ).length,
          sampleSpatialRooms:
            aiRooms
              .slice(0, 4)
              .map(
                (room) => ({
                  name:
                    room?.name,
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
        "[VENTRA ROOM AI] authoritative result",
        {
          rooms: aiRooms.length,
          labels: aiRooms.map((room) => ({
            name: room.name,
            type: room.roomType,
            confidence:
              room.roomTypeConfidence,
          })),
          ignoredGeometryRoomCandidates:
            geometryRoomCandidates.length,
        }
      );

      if (
        ventraMode !== "test" &&
        aiRooms.length > 0
      ) {
        try {
          const roomCacheKey =
            `ventra:project-room-cache:${projectId}`;

          const cachePayload = {
            version: 1,
            source:
              "openai_verified_plan_analysis",
            savedAt:
              new Date().toISOString(),
            labels:
              aiRooms.map(
                (room) => ({
                  label:
                    room?.name ||
                    "Room",
                  type:
                    room?.roomType ||
                    room?.detectedType ||
                    "room",
                  confidence:
                    Math.max(
                      0.62,
                      Math.min(
                        1,
                        Number(
                          room
                            ?.roomTypeConfidence ??
                          95
                        ) / 100
                      )
                    ),
                  verified: true,
                  x:
                    room?.centroid?.x ??
                    null,
                  y:
                    room?.centroid?.y ??
                    null,
                  coordinateSystem:
                    room?.centroid
                      ?.coordinateSystem ||
                    "viewer_sheet_normalized",
                  centroidSource:
                    room?.centroid
                      ?.source ||
                    "room_analyzer_xy",
                  bbox:
                    room?.regionBBox ||
                    null,
                  planId:
                    room?.planId ||
                    null,
                  planTitle:
                    room?.planTitle ||
                    null,
                })
              ),
            doors:
              generatedTakeoff
                ?.doors ??
              null,
            windows:
              generatedTakeoff
                ?.windows ??
              null,
            planAnalyses:
              Array.isArray(
                payload
                  ?.planAnalyses
              )
                ? payload
                    .planAnalyses
                : [],
            apsEvidence:
              apsRoomEvidence,
          };

          window.localStorage.setItem(
            roomCacheKey,
            JSON.stringify(
              cachePayload
            )
          );

          console.log(
            "[VENTRA ROOM CACHE v18] saved verified semantic rooms",
            {
              rooms:
                cachePayload
                  .labels.length,
              key:
                roomCacheKey,
            }
          );
        } catch (cacheError) {
          console.warn(
            "[VENTRA ROOM CACHE v18] save failed",
            cacheError
          );
        }
      }
    } catch (roomAiError) {
      console.warn(
        "[VENTRA ROOM AI] analysis failed",
        roomAiError
      );

      // Never fall back to inventing Room Schedule entries from closed loops.
      // A failed AI analysis should show zero semantic rooms, not false rooms.
      const geometryRoomCandidates =
        geometryRoomCandidatesHardLock;

      generatedTakeoff = {
        ...generatedTakeoff,
        rooms: 0,
        room_area: 0,
        object_details: {
          ...generatedTakeoff.object_details,
          rooms: [],
          geometry_room_candidates:
            geometryRoomCandidates,
        },
        room_label_source:
          "aps_openai_hybrid_failed_no_geometry_room_fallback",
        room_analysis_mode:
          "aps_openai_hybrid",
        geometry_room_candidate_count:
          geometryRoomCandidates.length,
      };
    }
  }

  // A dedicated, source-scoped pass reads schedules/notes even in low-cost room mode.
  // It never rewrites geometric openings used by 3D reconstruction.
  if (roomVisionImage && apsUrn && projectId) {
    const evidenceKey = `ventra:dwg-evidence:${projectId}:${apsUrn}`;
    try {
      const cached = JSON.parse(window.localStorage.getItem(evidenceKey) || "null");
      if (cached?.version === 2 && cached.sourceUrn === apsUrn) {
        generatedTakeoff.drawing_evidence = { ...generatedTakeoff.drawing_evidence, ...cached };
      } else {
        setMessage("Reading DWG opening schedules and material notes. Comparing two reads; this may take a moment.");
        const response = await commercialFetch("/api/ai/dwg-evidence", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({projectId, urn: apsUrn, image: roomVisionImage,
            records: generatedTakeoff.drawing_evidence?.records || [],
            requestId: `dwg-evidence-v40:${projectId}:${analysisRunIdRef.current}`}),
        });
        const result = await response.json();
        if (!response.ok || !result.evidence) throw new Error(result.error || "DWG schedule extraction failed.");
        generatedTakeoff.drawing_evidence = {...generatedTakeoff.drawing_evidence, ...result.evidence};
        window.localStorage.setItem(evidenceKey, JSON.stringify(result.evidence));
      }
    } catch (error) {
      generatedTakeoff.drawing_evidence = {...generatedTakeoff.drawing_evidence, extractionError: error.message};
      console.warn("[VENTRA DWG EVIDENCE v40]", error.message);
    }
  }

  generatedTakeoff =
    validateEngineeringQuantities(
      generatedTakeoff
    );

  const diagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    geometry,
    layers: layers || null,
    objectsCount: objects.length,
    propertiesCount: properties.length,
    generatedTakeoff,
  };

  if (typeof window !== "undefined") {
    Reflect.set(window,"__VENTRA_APS_TAKEOFF__",generatedTakeoff);
    Reflect.set(window,"__VENTRA_APS_DIAGNOSTIC__",diagnosticSnapshot);
  }

  console.group("[VENTRA ADVANCED APS TAKEOFF]");
  console.log("Diagnostic snapshot", diagnosticSnapshot);
  console.table(
    (Array.isArray(properties) ? properties : []).map((item) => ({
      dbId: item?.dbId ?? null,
      name: item?.name || "",
      category: item?.category || "",
      family: item?.family || "",
      type: item?.type || "",
      layer: item?.layer || item?.layerName || "",
      length: item?.length ?? null,
      area: item?.area ?? null,
      height: item?.height ?? null,
    }))
  );
  console.groupEnd();

  {
    const current = takeoffResultRef.current;
    if (
      !current ||
      current.source !== "autodesk-aps"
    ) {
      return current;
    }

    // Ignore stale geometry emitted by a Viewer belonging to another document.
    if (
      selectedDocumentId &&
      current.document_id &&
      current.document_id !== selectedDocumentId
    ) {
      console.warn("[VENTRA APS] ignored stale geometry from another document", {
        selectedDocumentId,
        resultDocumentId: current.document_id,
      });
      return current;
    }

    if (
      apsUrn &&
      current.aps_urn &&
      apsUrn !== current.aps_urn
    ) {
      console.warn("[VENTRA APS] ignored stale geometry from another URN", {
        viewerUrn: apsUrn,
        resultUrn: current.aps_urn,
      });
      return current;
    }

    const geometryCoreReady =
      Number(generatedTakeoff.floor_area)>0 &&
      Number(generatedTakeoff.rooms)>0 &&
      Number(generatedTakeoff.wall_length)>0 &&
      generatedTakeoff.doors!==null && generatedTakeoff.doors!==undefined &&
      generatedTakeoff.windows!==null && generatedTakeoff.windows!==undefined;

    const nextResult = {
      ...current,

      extraction_status: geometryCoreReady ? "advanced-takeoff-ready" : "advanced-takeoff-needs-review",

      geometry_status: geometryCoreReady ? "ready" : "needs_review",

      object_count:
        Number(geometry.objectCount) ||
        objects.length ||
        0,

      line_count:
        Number(geometry.lineCount) ||
        0,

      arc_count:
        getGeometryArcCount(geometry),

      total_curve_length:
        Number(
          geometry.totalCurveLength
        ) || 0,

      total_curve_length_m:
        Number.isFinite(
          Number(
            geometry.totalLengthMeters
          )
        )
          ? Number(
              geometry.totalLengthMeters
            )
          : null,

      model_unit:
        generatedTakeoff.model_unit,

      meter_factor:
        generatedTakeoff.meter_factor,

      layer_status:
        layers?.status || "pending",

      total_layers:
        Number(
          layers?.effectiveTotalLayers ??
          layers?.totalLayers
        ) || 0,

      wall_layers:
        layers?.layers?.walls || [],

      wall_layer_count:
        Number(layers?.objectCounts?.walls) ||
        Number(layers?.statistics?.walls) ||
        0,

      door_layers:
        layers?.layers?.doors || [],

      door_layer_count:
        Number(layers?.objectCounts?.doors) ||
        Number(layers?.statistics?.doors) ||
        0,

      window_layers:
        layers?.layers?.windows || [],

      window_layer_count:
        Number(layers?.objectCounts?.windows) ||
        Number(layers?.statistics?.windows) ||
        0,

      slab_layers:
        layers?.layers?.slabs || [],

      slab_layer_count:
        Number(layers?.objectCounts?.slabs) ||
        Number(layers?.statistics?.slabs) ||
        0,

      column_layers:
        layers?.layers?.columns || [],

      beam_layers:
        layers?.layers?.beams || [],

      text_layers:
        layers?.layers?.texts || [],

      dimension_layers:
        layers?.layers
          ?.dimensions || [],

      unknown_layers:
        layers?.layers?.unknown || [],

      layer_statistics:
        layers?.statistics || null,

      layer_object_counts:
        layers?.objectCounts || null,

      rooms:
        generatedTakeoff.rooms,

      doors:
        generatedTakeoff.doors,

      windows:
        generatedTakeoff.windows,

      walls:
        generatedTakeoff.walls,

      floors:
        generatedTakeoff.floors,

      slabs:
        generatedTakeoff.slabs,

      ceilings:
        generatedTakeoff.ceilings,

      columns:
        generatedTakeoff.columns,

      beams:
        generatedTakeoff.beams,

      foundations:
        generatedTakeoff.foundations,

      stairs:
        generatedTakeoff.stairs,

      ramps:
        generatedTakeoff.ramps,

      roofs:
        generatedTakeoff.roofs,

      pipes:
        generatedTakeoff.pipes,

      ducts:
        generatedTakeoff.ducts,

      electrical_items:
        generatedTakeoff
          .electrical_items,

      // v27: preserve measured electrical subtype counts at the root.
      // BOQ and takeoffService read the root object after refresh/navigation.
      lighting_points:
        Number(
          generatedTakeoff
            .lighting_points
        ) || 0,

      socket_points:
        Number(
          generatedTakeoff
            .socket_points
        ) || 0,

      switches:
        Number(
          generatedTakeoff
            .switches
        ) || 0,

      distribution_boards:
        Number(
          generatedTakeoff
            .distribution_boards
        ) || 0,

      other_electrical:
        Number(
          generatedTakeoff
            .other_electrical
        ) || 0,

      electrical_subtype_counts:
        generatedTakeoff
          .electrical_subtype_counts ||
        generatedTakeoff
          ?.statistics
          ?.electricalSubtypeCounts ||
        null,

      wall_length:
        generatedTakeoff.wall_length,

      wall_area:
        generatedTakeoff.wall_area,

      wall_area_estimated:
        generatedTakeoff.wall_area_estimated === true,

      wall_height_source:
        generatedTakeoff.wall_height_source || null,

      unit_calibration_source:
        generatedTakeoff.unit_calibration_source || null,

      source_meter_factor:
        generatedTakeoff.source_meter_factor ?? null,

      wall_volume:
        generatedTakeoff.wall_volume,

      room_area:
        generatedTakeoff.room_area,

      floor_area:
        generatedTakeoff.floor_area,

      wet_floor_area:
        generatedTakeoff.wet_floor_area || 0,
      wet_room_perimeter:
        generatedTakeoff.wet_room_perimeter || 0,
      bathroom_floor_area:
        generatedTakeoff.bathroom_floor_area || 0,
      bathroom_perimeter:
        generatedTakeoff.bathroom_perimeter || 0,
      toilet_floor_area:
        generatedTakeoff.toilet_floor_area || 0,
      toilet_perimeter:
        generatedTakeoff.toilet_perimeter || 0,
      kitchen_floor_area:
        generatedTakeoff.kitchen_floor_area || 0,
      kitchen_perimeter:
        generatedTakeoff.kitchen_perimeter || 0,
      laundry_floor_area:
        generatedTakeoff.laundry_floor_area || 0,
      laundry_perimeter:
        generatedTakeoff.laundry_perimeter || 0,
      balcony_floor_area:
        generatedTakeoff.balcony_floor_area || 0,
      balcony_perimeter:
        generatedTakeoff.balcony_perimeter || 0,
      room_quantity_source:
        generatedTakeoff.room_quantity_source || "unavailable",

      takeoff_validation:
        generatedTakeoff.takeoff_validation ||
        null,

      engineering_validation:
        generatedTakeoff.engineering_validation ||
        null,

      room_geometry_match:
        generatedTakeoff.room_geometry_match ||
        null,

      opening_analysis_source:
        generatedTakeoff.opening_analysis_source ||
        null,

      opening_analysis_confidence:
        generatedTakeoff.opening_analysis_confidence ||
        0,

      slab_area:
        generatedTakeoff.slab_area,

      slab_volume:
        generatedTakeoff.slab_volume,

      ceiling_area:
        generatedTakeoff.ceiling_area,

      column_volume:
        generatedTakeoff.column_volume,

      beam_volume:
        generatedTakeoff.beam_volume,

      foundation_volume:
        generatedTakeoff
          .foundation_volume,

      column_formwork_area:
        generatedTakeoff
          .column_formwork_area,

      beam_formwork_area:
        generatedTakeoff
          .beam_formwork_area,

      foundation_formwork_area:
        generatedTakeoff
          .foundation_formwork_area,

      slab_formwork_area:
        generatedTakeoff
          .slab_formwork_area,

      structural_measurement_status:
        generatedTakeoff
          .structural_measurement_status ||
        null,

      roof_area:
        generatedTakeoff.roof_area,

      pipe_length:
        generatedTakeoff.pipe_length,

      duct_length:
        generatedTakeoff.duct_length,

      levels:
        generatedTakeoff.levels,

      materials:
        generatedTakeoff.materials,

      classifications:
        generatedTakeoff
          .classifications,

      drawing_evidence: generatedTakeoff.drawing_evidence,

      object_details:
        generatedTakeoff.object_details,

      confidence:
        generatedTakeoff.confidence,

      takeoff_statistics:
        generatedTakeoff.statistics,

      advanced_takeoff:
        generatedTakeoff,

      geometry,

      analyzed_at:
        new Date().toISOString(),

      notes:
        generatedTakeoff.notes,
    };

    try {
      await persistTakeoff(projectId,nextResult);
      takeoffResultRef.current = nextResult;
      setTakeoffResult(nextResult);
      window.dispatchEvent(new CustomEvent('ventra:engineering-takeoff-updated',{detail:{projectId,urn:nextResult.aps_urn}}));
      setMessage('Advanced takeoff extracted and saved. Full geometry is available for 3D.');
    } catch (storageError) {
      takeoffResultRef.current = nextResult;
      setTakeoffResult(nextResult);
      setErrorMessage(`Geometry extracted but could not be saved: ${storageError.message}`);
      setMessage('Drawing storage failed. Keep this page open and retry saving/extraction.');
    }
  }
}

 async function handleGenerateBoq() {
  if (analysisInFlightRef.current || analyzing || generatingBoq) return;
  if (drawingWorkflowState(projectId).active || drawingWorkflowState(projectId).analysisFailed) return;
  if (!takeoffResult) {
    setErrorMessage(
      "Please analyze a drawing first."
    );
    return;
  }
  const workflowToken = beginDrawingWorkflow(projectId, 'boq');
  if (!workflowToken) return;
  try {
    setGeneratingBoq(true);
    clearMessages();

    const validation =
      takeoffResult
        ?.takeoff_validation;

    const problems = [];

    const effectiveRoomArea =
      Number(takeoffResult.room_area) > 0
        ? Number(takeoffResult.room_area)
        : Number(takeoffResult.geometry?.roomArea) > 0
          ? Number(takeoffResult.geometry.roomArea)
          : Number(takeoffResult.floor_area) > 0
            ? Number(takeoffResult.floor_area)
            : Number(takeoffResult.slab_area) > 0
              ? Number(takeoffResult.slab_area)
              : Number(takeoffResult.geometry?.floorArea) > 0
                ? Number(takeoffResult.geometry.floorArea)
                : 0;

    if (
      Number(
        validation?.rooms
          ?.reviewCount
      ) > 0
    ) {
      problems.push(
        `${Number(
          validation.rooms
            .reviewCount
        )} room candidate(s) need review`
      );
    }

    if (
      validation?.openings
        ?.doors?.status ===
      "needs_review"
    ) {
      problems.push(
        "door quantity needs review"
      );
    }

    if (
      validation?.openings
        ?.windows?.status ===
      "needs_review"
    ) {
      problems.push(
        "window quantity needs review"
      );
    }

    if (
      Number(
        takeoffResult.rooms
      ) > 0 &&
      effectiveRoomArea <= 0
    ) {
      problems.push(
        "room areas are not matched to Autodesk geometry"
      );
    }

    if (
      takeoffResult
        ?.engineering_validation
        ?.walls?.status ===
      "needs_review"
    ) {
      problems.push(
        "wall quantities failed engineering validation"
      );
    }

    if (
      problems.length > 0
    ) {
      throw new Error(
        `BOQ blocked: ${problems.join(
          "; "
        )}.`
      );
    }

    setMessage(
      "Generating BOQ from validated takeoff..."
    );

    const response = await commercialFetch(
      "/api/ai/generate-boq",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          projectId,

          projectName:
            takeoffResult.document_name ||
            "Untitled Project",

          currency: "AED",

          vatPercentage: 5,

          takeoff: {
            ...(takeoffResult.pdf_analysis ? {...takeoffResult,raw_result:undefined} : {}),
            rooms:
              Number(
                takeoffResult.rooms
              ) || 0,

            doors:
              Number(
                takeoffResult.doors
              ) || 0,

            windows:
              Number(
                takeoffResult.windows
              ) || 0,

            walls:
              Number(
                takeoffResult.walls
              ) || 0,

            floors:
              Number(
                takeoffResult.floors
              ) || 0,

            slabs:
              Number(
                takeoffResult.slabs
              ) || 0,

            ceilings:
              Number(
                takeoffResult.ceilings
              ) || 0,

            columns:
              Number(
                takeoffResult.columns
              ) || 0,

            beams:
              Number(
                takeoffResult.beams
              ) || 0,

            foundations:
              Number(
                takeoffResult.foundations
              ) || 0,

            stairs:
              Number(
                takeoffResult.stairs
              ) || 0,

            ramps:
              Number(
                takeoffResult.ramps
              ) || 0,

            roofs:
              Number(
                takeoffResult.roofs
              ) || 0,

            pipes:
              Number(
                takeoffResult.pipes
              ) || 0,

            ducts:
              Number(
                takeoffResult.ducts
              ) || 0,

            electrical_items:
              Number(
                takeoffResult
                  .electrical_items
              ) || 0,

            lighting_points:
              Number(
                takeoffResult
                  .lighting_points ??
                takeoffResult
                  ?.advanced_takeoff
                  ?.lighting_points
              ) || 0,

            socket_points:
              Number(
                takeoffResult
                  .socket_points ??
                takeoffResult
                  ?.advanced_takeoff
                  ?.socket_points
              ) || 0,

            switches:
              Number(
                takeoffResult
                  .switches ??
                takeoffResult
                  ?.advanced_takeoff
                  ?.switches
              ) || 0,

            distribution_boards:
              Number(
                takeoffResult
                  .distribution_boards ??
                takeoffResult
                  ?.advanced_takeoff
                  ?.distribution_boards
              ) || 0,

            other_electrical:
              Number(
                takeoffResult
                  .other_electrical ??
                takeoffResult
                  ?.advanced_takeoff
                  ?.other_electrical
              ) || 0,

            wall_length:
              Number(
                takeoffResult.wall_length
              ) || 0,

            wall_area:
              Number(
                takeoffResult.wall_area
              ) || 0,

            wall_volume:
              Number(
                takeoffResult.wall_volume
              ) || 0,

            room_area:
              effectiveRoomArea,

            floor_area:
              Number(
                takeoffResult.floor_area
              ) || 0,

            wet_floor_area:
              Number(takeoffResult.wet_floor_area) || 0,
            wet_room_perimeter:
              Number(takeoffResult.wet_room_perimeter) || 0,
            bathroom_floor_area:
              Number(takeoffResult.bathroom_floor_area) || 0,
            bathroom_perimeter:
              Number(takeoffResult.bathroom_perimeter) || 0,
            toilet_floor_area:
              Number(takeoffResult.toilet_floor_area) || 0,
            toilet_perimeter:
              Number(takeoffResult.toilet_perimeter) || 0,
            kitchen_floor_area:
              Number(takeoffResult.kitchen_floor_area) || 0,
            kitchen_perimeter:
              Number(takeoffResult.kitchen_perimeter) || 0,
            laundry_floor_area:
              Number(takeoffResult.laundry_floor_area) || 0,
            laundry_perimeter:
              Number(takeoffResult.laundry_perimeter) || 0,
            balcony_floor_area:
              Number(takeoffResult.balcony_floor_area) || 0,
            balcony_perimeter:
              Number(takeoffResult.balcony_perimeter) || 0,

            slab_area:
              Number(
                takeoffResult.slab_area
              ) || 0,

            slab_volume:
              Number(
                takeoffResult.slab_volume
              ) || 0,

            ceiling_area:
              Number(
                takeoffResult.ceiling_area
              ) || 0,

            column_volume:
              Number(
                takeoffResult
                  .column_volume
              ) || 0,

            beam_volume:
              Number(
                takeoffResult.beam_volume
              ) || 0,

            foundation_volume:
              Number(
                takeoffResult
                  .foundation_volume
              ) || 0,

            column_formwork_area:
              Number(
                takeoffResult
                  .column_formwork_area
              ) || 0,

            beam_formwork_area:
              Number(
                takeoffResult
                  .beam_formwork_area
              ) || 0,

            foundation_formwork_area:
              Number(
                takeoffResult
                  .foundation_formwork_area
              ) || 0,

            slab_formwork_area:
              Number(
                takeoffResult
                  .slab_formwork_area
              ) || 0,

            structural_measurement_status:
              takeoffResult
                .structural_measurement_status ||
              null,

            roof_area:
              Number(
                takeoffResult.roof_area
              ) || 0,

            pipe_length:
              Number(
                takeoffResult.pipe_length
              ) || 0,

            duct_length:
              Number(
                takeoffResult.duct_length
              ) || 0,

            model_unit:
              takeoffResult.model_unit ||
              "model units",

            meter_factor:
              takeoffResult.meter_factor ??
              null,

            levels:
              takeoffResult.levels || {},

            materials:
              takeoffResult.materials ||
              {},

            classifications:
              takeoffResult
                .classifications || {},

            object_details:
              takeoffResult.object_details ||
              {},

            statistics:
              takeoffResult
                .takeoff_statistics || {},

            confidence:
              Number(
                takeoffResult.confidence
              ) || 0,

            notes:
              takeoffResult.notes || "",
          },
        }),
      }
    );

    const responseText =
      await response.text();

    let result = {};

    try {
      result = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error(
        "[Generate BOQ] Non-JSON response:",
        {
          status: response.status,
          responseText,
        }
      );

      throw new Error(
        `BOQ API returned invalid JSON. HTTP ${response.status}`
      );
    }

    if (
      !response.ok ||
      result.success === false
    ) {
      throw new Error(
        result.error ||
          result.message ||
          `BOQ generation failed. HTTP ${response.status}`
      );
    }

    if (!result.boq) {
      throw new Error(
        "BOQ API did not return a BOQ."
      );
    }

    importAiBoq(result.boq, {
      replace: true,
    });

    localStorage.setItem(
      `ventra:project-boq:${projectId}`,
      JSON.stringify(result.boq)
    );

    onOpenBoq?.(result.boq);

    setMessage(
      "Advanced BOQ generated successfully."
    );
  } catch (error) {
    console.error(
      "[Generate BOQ] Failed:",
      error
    );

    setErrorMessage(
      error?.message ||
        "Could not generate the BOQ."
    );
  } finally {
    finishDrawingWorkflow(projectId,workflowToken,true);
    setGeneratingBoq(false);
  }
}

  const aiTools = [
  {
    icon: UploadCloud,
    title: "Upload Drawing",
    text:
      "Upload PDF, DWG, DXF, IFC, RVT or image files.",
    buttonText: uploading
      ? "Uploading..."
      : "Open",
    actionType: "upload",
    disabled: uploading,
  },
  {
    icon: ScanSearch,
    title: "AI Quantity Takeoff",
    text:
      "Detect rooms, walls, doors, windows and measurable areas.",
    buttonText: analyzing
      ? "Analyzing..."
      : "Analyze",
    actionType: "analyze",
    disabled:
      documents.length === 0 ||
      analyzing ||
      generatingBoq ||
      uploading,
  },
 {
  icon: FileSpreadsheet,
  title: "Generate BOQ",
  text: "Create an automatic quantity schedule.",
  buttonText: generatingBoq
    ? "Generating..."
    : "Generate BOQ",
  actionType: "boq",
  disabled: generatingBoq || analyzing,
},
  {
    icon: Brain,
    title: "AI Cost Estimate",
    text:
      "Calculate construction costs using UAE pricing.",
    buttonText: "Generate BOQ First",
    actionType: null,
    disabled: true,
  },
  {
    icon: FileStack,
    title: "Quotation Builder",
    text:
      "Generate a professional client quotation.",
    buttonText: "Estimate First",
    actionType: null,
    disabled: true,
  },
];
  return (
    <LocalizedElement as="section" className="drawing-center">
      <LocalizedElement as="div" className="drawing-header">
        <LocalizedElement as="span">
          AI CONSTRUCTION ENGINE
        </LocalizedElement>

        <LocalizedElement as="h2">Drawing Center</LocalizedElement>

        <LocalizedElement as="p">
          Upload project drawings and
          prepare them for quantity
          takeoff, BOQ and cost analysis.
        </LocalizedElement>
      </LocalizedElement>

      {message && (
        <LocalizedElement as="div" className="drawing-message drawing-message-success">
          <CheckCircle2 size={18} />

          <LocalizedElement as="span">{message}</LocalizedElement>
        </LocalizedElement>
      )}

      {takeoffResult?.pdf_analysis&&<details className="takeoff-result" open>
        <summary>{language==='fa'?'گزارش تحلیل صفحات PDF':language==='ar'?'تقرير تحليل صفحات PDF':'PDF page analysis report'}</summary>
        <p>{language==='fa'?'صفحات پلان از جدول‌ها و جزئیات جدا شده‌اند. مقادیر AI نیاز به بررسی دارند.':language==='ar'?'تم فصل المخططات عن الجداول والتفاصيل. تحتاج كميات AI إلى المراجعة.':'Floor plans are reconciled separately from schedules and details. AI quantities require review.'}</p>
        {!!takeoffResult.pdf_analysis.withheld_area_metrics?.length&&<p role="alert">{language==='fa'?'بعضی مساحت‌ها به دلیل نبود هندسه مستقل یا مغایرت ابعاد، قیمت‌گذاری نمی‌شوند. گزارش را برای جزئیات بررسی کنید.':language==='ar'?'لا تُسعّر بعض المساحات لغياب هندسة مستقلة أو وجود تعارض في الأبعاد. راجع التقرير للتفاصيل.':'Some areas are withheld from pricing because independent geometry is missing or dimensions conflict. Check the report for details.'}</p>}
        {(takeoffResult.pdf_analysis.area_validation||[]).map(a=><p key={a.page}>{language==='fa'?'صفحه':language==='ar'?'الصفحة':'Page'} {a.page}: {a.status==='partial_geometry_with_printed_labels'?(language==='fa'?'هندسه بخش‌های اندازه‌دار کنترل شد؛ مساحت سایر اتاق‌ها از برچسب نقشه است و نیازمند بازبینی است.':language==='ar'?'تم فحص الأجزاء ذات الأبعاد؛ مساحات الغرف الأخرى مأخوذة من تسميات المخطط وتحتاج إلى مراجعة.':'Dimensioned spaces checked; other room areas come from printed labels and require review.'):a.status==='dimension_geometry_checked'?(language==='fa'?'کنترل هندسی مساحت انجام شد؛ تشخیص ابعاد و مصالح AI همچنان نیازمند بررسی است.':language==='ar'?'تم فحص هندسة المساحة؛ لا تزال أبعاد ومواد AI بحاجة إلى مراجعة.':'Area geometry checked; AI dimensions and materials still require review.'):(language==='fa'?'هندسه مستقل برای تأیید کامل مساحت موجود نیست.':language==='ar'?'الهندسة المستقلة غير متاحة للتحقق الكامل من المساحة.':'Independent geometry is unavailable for complete area verification.')}</p>)}
        <button type="button" disabled={analyzing} onClick={async()=>{if(analysisInFlightRef.current)return;try{const report=await latestPdfReportForExport({projectId,visible:takeoffResultRef.current,readLatest:getLatestProjectTakeoff,workflow:drawingWorkflowState});takeoffResultRef.current=report;setTakeoffResult(report);const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ventra-pdf-analysis-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setErrorMessage(error?.message||'Could not export the saved PDF report.');}}}>{language==='fa'?'دانلود گزارش تحلیل PDF':language==='ar'?'تنزيل تقرير PDF':'Download PDF analysis report'}</button>
      </details>}
      {rasterReview && <RasterTraceReview {...rasterReview} />}

      {errorMessage && (
        <LocalizedElement as="div" className="drawing-message drawing-message-error">
          <AlertCircle size={18} />

          <LocalizedElement as="span">{errorMessage}</LocalizedElement>
        </LocalizedElement>
      )}

      <LocalizedElement as="div"
        className={`drawing-upload-zone ${
          dragging
            ? "drawing-upload-zone-active"
            : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!uploading) {
            openFilePicker();
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();

            if (!uploading) {
              openFilePicker();
            }
          }
        }}
      >
        <LocalizedElement as="input"
          ref={fileInputRef}
          type="file"
          accept=".pdf,.dwg,.dxf,.ifc,.rvt,.jpg,.jpeg,.png,.webp"
          onChange={handleInputChange}
          hidden
        />

        {uploading ? (
          <LoaderCircle
            size={42}
            className="drawing-spinner"
          />
        ) : (
          <UploadCloud size={42} />
        )}

        <LocalizedElement as="h3">
          {uploading
            ? "Uploading drawing..."
            : "Drop your drawing here"}
        </LocalizedElement>

        <LocalizedElement as="p">
          PDF, DWG, DXF, IFC, RVT, JPG,
          PNG or WEBP. Maximum size 100 MB.
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();

            openFilePicker();
          }}
        >
          {uploading
            ? "Uploading..."
            : "Choose File"}
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="drawing-grid">
        {aiTools.map((tool) => {
          const Icon = tool.icon;

          return (
            <LocalizedElement as="article"
              className={`drawing-card ${
                tool.disabled
                  ? "drawing-card-disabled"
                  : ""
              }`}
              key={tool.title}
            >
              <LocalizedElement as="div" className="drawing-icon">
                <Icon size={30} />
              </LocalizedElement>

              <LocalizedElement as="h3">{tool.title}</LocalizedElement>

              <LocalizedElement as="p">{tool.text}</LocalizedElement>

              <LocalizedElement as="button"
                type="button"
                disabled={tool.disabled}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  if (tool.actionType === "upload") {
                    openFilePicker();
                    return;
                  }

                  if (tool.actionType === "analyze") {
                    handleAnalyzeDrawing();
                    return;
                  }

                  if (tool.actionType === "boq") {
                    handleGenerateBoq();
                  }
                }}
              >
                {tool.buttonText}
              </LocalizedElement>
            </LocalizedElement>
          );
        })}
      </LocalizedElement>

      {takeoffResult && (
        <LocalizedElement as="section" className="takeoff-result">
          <LocalizedElement as="div" className="drawing-files-header">
            <LocalizedElement as="div">
              <LocalizedElement as="span">
                {takeoffResult.source ===
                "autodesk-aps"
                  ? "AUTODESK GEOMETRY RESULT"
                  : "AI ANALYSIS RESULT"}
              </LocalizedElement>

              <LocalizedElement as="h3">
                {takeoffResult.source ===
                "autodesk-aps"
                  ? "Geometry Extraction Summary"
                  : "Quantity Takeoff Summary"}
              </LocalizedElement>
            </LocalizedElement>

            <LocalizedElement as="strong">
              {takeoffResult.source === "autodesk-aps"
                ? takeoffResult.geometry_status === "ready"
                  ? "Geometry ready"
                  : "APS model ready"
                : `${Number(takeoffResult.confidence) || 0}% confidence`}
            </LocalizedElement>
          </LocalizedElement>

          {takeoffResult.source ===
          "autodesk-aps" ? (
            <>
              <LocalizedElement as="div" className="takeoff-result-grid takeoff-result-grid-geometry">
              <LocalizedElement as="article">
                <LocalizedElement as="span">Model Objects</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.object_count ??
                    "Extracting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Lines</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.line_count ??
                    "Extracting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Arcs</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.arc_count ??
                    "Extracting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Total Curve Length</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.total_curve_length_m !==
                  null &&
                  takeoffResult.total_curve_length_m !==
                    undefined
                    ? `${formatGeometryNumber(
                        takeoffResult.total_curve_length_m
                      )} m`
                    : "Extracting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Wall Length</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.wall_length,
                    "m"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Wall Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.wall_area_estimated
                    ? `${formatQuantity(takeoffResult.wall_area,"m²")} (est.)`
                    : formatQuantity(takeoffResult.wall_area,"m²")}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Floor Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.floor_area,
                    "m²"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Rooms Detected</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.source === "autodesk-aps"
                    ? Number(takeoffResult.rooms) || 0
                    : Number(takeoffResult.rooms) ||
                      takeoffResult.object_details?.rooms?.length ||
                      0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Total Room Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    Number(takeoffResult.room_area) ||
                      Number(takeoffResult.geometry?.roomArea) ||
                      0,
                    "m²"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Largest Room</LocalizedElement>
                <LocalizedElement as="strong">
                  {(() => {
                    const roomItems = Array.isArray(
                      takeoffResult.object_details?.rooms
                    )
                      ? takeoffResult.object_details.rooms
                      : [];
                    const largest = roomItems.reduce(
                      (best, room) =>
                        Number(room?.area) > Number(best?.area || 0)
                          ? room
                          : best,
                      null
                    );
                    return largest && Number(largest?.area) > 0
                      ? `${formatGeometryNumber(Number(largest.area))} m²`
                      : "—";
                  })()}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Model Unit</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.model_unit
                    ? takeoffResult.unit_calibration_source === "geometry_plausibility_calibration"
                      ? `${takeoffResult.model_unit} (APS) / calibrated → m`
                      : `${takeoffResult.model_unit} → m`
                    : "Detecting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Geometry Status</LocalizedElement>
                <LocalizedElement as="strong" className="takeoff-ready-value">
                  {takeoffResult.geometry_status === "ready"
                    ? "READY"
                    : takeoffResult.geometry_status === "needs_review"
                      ? "NEEDS REVIEW"
                      : "PROCESSING"}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Detected Categories</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.total_layers ??
                    "Detecting..."}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Wall Objects</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.wall_layer_count ?? takeoffResult.wall_layers?.length ?? 0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Doors Detected</LocalizedElement>
                <LocalizedElement as="strong">
                  {Number.isFinite(Number(takeoffResult.doors)) ? Number(takeoffResult.doors) : (takeoffResult.door_layer_count ?? takeoffResult.door_layers?.length ?? 0)}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Windows Detected</LocalizedElement>
                <LocalizedElement as="strong">
                  {Number.isFinite(Number(takeoffResult.windows)) ? Number(takeoffResult.windows) : (takeoffResult.window_layer_count ?? takeoffResult.window_layers?.length ?? 0)}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Slab Objects</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.slab_layer_count ?? takeoffResult.slab_layers?.length ?? 0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Unknown Layers</LocalizedElement>
                <LocalizedElement as="strong">
                  {takeoffResult.unknown_layers?.length ?? 0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Layer Status</LocalizedElement>
                <LocalizedElement as="strong" className="takeoff-ready-value">
                  {takeoffResult.layer_status === "ready" ||
                  takeoffResult.layer_status === "ready-no-layers" ||
                  takeoffResult.layer_status === "ready-object-classification" ||
                  takeoffResult.layer_status === "ready-unclassified"
                    ? "READY"
                    : takeoffResult.layer_status === "failed"
                      ? "FAILED"
                      : "PROCESSING"}
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>

              {Array.isArray(takeoffResult.object_details?.rooms) &&
                takeoffResult.object_details.rooms.length > 0 &&
                (takeoffResult.source !== "autodesk-aps" ||
                  String(takeoffResult.room_label_source || "").startsWith(
                    "openai_api"
                  )) && (
                  <LocalizedElement as="div" className="room-schedule">
                    <LocalizedElement as="div" className="room-schedule-header">
                      <LocalizedElement as="div">
                        <LocalizedElement as="span">DETECTED SPACES</LocalizedElement>
                        <LocalizedElement as="h4">Room Schedule</LocalizedElement>
                      </LocalizedElement>

                      <LocalizedElement as="strong">
                        {takeoffResult.object_details.rooms.length}{" "}
                        {takeoffResult.object_details.rooms.length === 1
                          ? "room"
                          : "rooms"}
                      </LocalizedElement>
                    </LocalizedElement>

                    <LocalizedElement as="div" className="room-schedule-table-wrap">
                      <LocalizedElement as="table" className="room-schedule-table">
                        <LocalizedElement as="thead">
                          <LocalizedElement as="tr">
                            <LocalizedElement as="th">Room</LocalizedElement>
                            <LocalizedElement as="th">Area</LocalizedElement>
                            <LocalizedElement as="th">Perimeter</LocalizedElement>
                            <LocalizedElement as="th">Type</LocalizedElement>
                          </LocalizedElement>
                        </LocalizedElement>

                        <LocalizedElement as="tbody">
                          {takeoffResult.object_details.rooms.map(
                            (room, index) => (
                              <LocalizedElement as="tr" key={room?.id || `room-${index + 1}`}>
                                <LocalizedElement as="td">{room?.name || `Room ${index + 1}`}</LocalizedElement>
                                <LocalizedElement as="td">
                                  {Number.isFinite(Number(room?.area)) &&
                                  Number(room?.area) > 0
                                    ? `${formatGeometryNumber(Number(room.area))} m²`
                                    : "—"}
                                </LocalizedElement>
                                <LocalizedElement as="td">
                                  {Number.isFinite(Number(room?.perimeter)) &&
                                  Number(room?.perimeter) > 0
                                    ? `${formatGeometryNumber(Number(room.perimeter))} m`
                                    : "—"}
                                </LocalizedElement>
                                <LocalizedElement as="td">
                                  {formatRoomType(
                                    room?.roomType ||
                                      room?.detectedType
                                  )}
                                </LocalizedElement>
                              </LocalizedElement>
                            )
                          )}
                        </LocalizedElement>
                      </LocalizedElement>
                    </LocalizedElement>
                  </LocalizedElement>
                )}
            </>
          ) : (
            <LocalizedElement as="div" className="takeoff-result-grid">
              <LocalizedElement as="article">
                <LocalizedElement as="span">Rooms</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.rooms
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Doors</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.doors
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Windows</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.windows
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Wall Length</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.wall_length,
                    "m"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Wall Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.wall_area,
                    "m²"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Floor Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.floor_area,
                    "m²"
                  )}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="article">
                <LocalizedElement as="span">Ceiling Area</LocalizedElement>
                <LocalizedElement as="strong">
                  {formatQuantity(
                    takeoffResult.ceiling_area,
                    "m²"
                  )}
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          )}

        {takeoffResult.notes && (
            <LocalizedElement as="p" className="takeoff-result-notes">
              {takeoffResult.notes}
            </LocalizedElement>
          )}
        </LocalizedElement>
          )}

      {selectedDocumentIsImage && selectedDocumentForPreview && (
        <LocalizedElement as="section"
          style={{
            marginTop: 18,
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: 16,
            background: "rgba(15, 23, 42, 0.72)",
            overflow: "hidden",
          }}
        >
          <LocalizedElement as="div"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "16px 18px",
              borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
            }}
          >
            <LocalizedElement as="div">
              <LocalizedElement as="span" style={{ fontSize: 11, letterSpacing: "0.08em", color: "#94a3b8" }}>
                IMAGE DRAWING
              </LocalizedElement>
              <LocalizedElement as="h3" style={{ margin: "4px 0 0", fontSize: 15, color: "#f8fafc" }}>
                {selectedDocumentForPreview.file_name}
              </LocalizedElement>
            </LocalizedElement>
            <LocalizedElement as="strong" style={{ fontSize: 11, color: "#94a3b8" }}>SCHEMATIC 3D SOURCE</LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="div"
            style={{
              minHeight: 360,
              maxHeight: "72vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
              background: "#0b0f19",
              overflow: "auto",
            }}
          >
            {imagePreviewLoading ? (
              <LocalizedElement as="div" style={{ minHeight: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#cbd5e1" }}>
                <LoaderCircle size={28} className="drawing-spinner" />
                <LocalizedElement as="p">Loading image preview...</LocalizedElement>
              </LocalizedElement>
            ) : imagePreviewError ? (
              <LocalizedElement as="div" style={{ minHeight: 320, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#fca5a5" }}>
                <AlertCircle size={28} />
                <LocalizedElement as="p">{imagePreviewError}</LocalizedElement>
              </LocalizedElement>
            ) : imagePreviewUrl ? (
              <LocalizedElement as="img"
                src={imagePreviewUrl}
                alt={selectedDocumentForPreview.file_name || "Uploaded drawing"}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "68vh",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  borderRadius: 8,
                  background: "#fff",
                }}
              />
            ) : null}
          </LocalizedElement>

          <LocalizedElement as="p" style={{ margin: 0, padding: "12px 18px 16px", fontSize: 12, color: "#94a3b8" }}>
            JPG/PNG/WebP is shown directly while AI schematic 3D runs separately in the background.
          </LocalizedElement>
        </LocalizedElement>
      )}

      {isSelectedApsDrawing(takeoffResult,selectedDocumentForPreview) && (
          <div>
          <DwgUnitConfirmation key={takeoffResult.aps_urn} value={confirmedUnits[takeoffResult.aps_urn]} onConfirm={value=>{const units={...confirmedUnits,[takeoffResult.aps_urn]:value};localStorage.setItem(`ventra:confirmed-dwg-units:${projectId}`,JSON.stringify(units));setConfirmedUnits(units);}}/>
          <ApsViewer
            key={`${takeoffResult.document_id || "document"}:${takeoffResult.aps_urn}:${analysisRunId}:${confirmedUnits[takeoffResult.aps_urn]?.unit||"auto"}`}
            urn={takeoffResult.aps_urn}
            confirmedUnit={confirmedUnits[takeoffResult.aps_urn]||null}
            title={
              takeoffResult.document_name ||
              "Autodesk Model Viewer"
            }
            onGeometryExtracted={
              handleApsGeometryExtracted
            }
          />
          </div>
        )}
      <LocalizedElement as="div" className="drawing-files">
        <LocalizedElement as="div" className="drawing-files-header">
          <LocalizedElement as="div">
            <LocalizedElement as="span">PROJECT FILES</LocalizedElement>

            <LocalizedElement as="h3">Uploaded Drawings</LocalizedElement>
          </LocalizedElement>

          <LocalizedElement as="strong">
            {documents.length}{" "}
            {documents.length === 1
              ? "file"
              : "files"}
          </LocalizedElement>
        </LocalizedElement>

        <OriginalText>{loading ? (
          <LocalizedElement as="div" className="drawing-files-state">
            <LoaderCircle
              size={28}
              className="drawing-spinner"
            />

            <LocalizedElement as="p">
              Loading project files...
            </LocalizedElement>
          </LocalizedElement>
        ) : documents.length === 0 ? (
          <LocalizedElement as="div" className="drawing-files-state">
            <FileText size={36} />

            <LocalizedElement as="h4">
              No drawings uploaded
            </LocalizedElement>

            <LocalizedElement as="p">
              Upload the first project
              drawing to start analysis.
            </LocalizedElement>
          </LocalizedElement>
        ) : (
          <LocalizedElement as="div" className="drawing-file-list">
            <OriginalText>{documents.map(
              (document) => (
                <LocalizedElement as="article"
                  className={`drawing-file-row ${
                    selectedDocumentId === document.id
                      ? "drawing-file-row-active"
                      : ""
                  }`}
                  key={document.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedDocumentId(document.id);
      selectDrawingDocument(projectId,document.id);
      if(["jpg","jpeg","png","webp"].includes(getFileExtension(document.file_name)))selectSchematicDrawing(projectId,document.id);
                    if (typeof window !== "undefined") {
                      void saveActiveSource(projectId,["jpg", "jpeg", "png", "webp"].includes(getFileExtension(document.file_name))
                          ? "schematic"
                          : "aps"
                      ).catch(error=>setMessage(error.message));
                    }

                    if (takeoffResult?.document_id !== document.id) {
                      setTakeoffResult(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDocumentId(document.id);
      selectDrawingDocument(projectId,document.id);
      if(["jpg","jpeg","png","webp"].includes(getFileExtension(document.file_name)))selectSchematicDrawing(projectId,document.id);
                      if (typeof window !== "undefined") {
                        void saveActiveSource(projectId,["jpg", "jpeg", "png", "webp"].includes(getFileExtension(document.file_name))
                            ? "schematic"
                            : "aps"
                        ).catch(error=>setMessage(error.message));
                      }

                      if (takeoffResult?.document_id !== document.id) {
                        setTakeoffResult(null);
                      }
                    }
                  }}
                >
                  <LocalizedElement as="div" className="drawing-file-icon">
                    <FileText size={24} />
                  </LocalizedElement>

                  <LocalizedElement as="div" className="drawing-file-info">
                    <LocalizedElement as="strong">
                      <OriginalText>{document.file_name}</OriginalText>
                    </LocalizedElement>

                    <LocalizedElement as="span">
                      {formatFileSize(
                        document.file_size
                      )}
                      {" · "}
                      {formatDate(
                        document.created_at
                      )}
                    </LocalizedElement>
                  </LocalizedElement>

                  <LocalizedElement as="span" className="drawing-file-status">
                    {document.status ||
                      "uploaded"}
                  </LocalizedElement>

                  <LocalizedElement as="div" className="drawing-file-actions">
                    <LocalizedElement as="button"
                      type="button"
                      title="Download file"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDownload(document);
                      }}
                    >
                      <Download size={18} />
                    </LocalizedElement>

                    <LocalizedElement as="button"
                      type="button"
                      title="Delete file"
                      className="drawing-file-delete"
                      disabled={
                        deletingDocumentId ===
                        document.id
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(document);
                      }}
                    >
                      {deletingDocumentId ===
                      document.id ? (
                        <LoaderCircle
                          size={18}
                          className="drawing-spinner"
                        />
                      ) : (
                        <Trash2 size={18} />
                      )}
                    </LocalizedElement>
                  </LocalizedElement>
                </LocalizedElement>
              )
            )}</OriginalText>
          </LocalizedElement>
        )}</OriginalText>
      </LocalizedElement>
    </LocalizedElement>
  );
}
