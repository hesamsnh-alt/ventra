"use client";
import {apsGeometryNodes} from "@/lib/apsViewables.mjs";
import PlanRenderPanel from "./PlanRenderPanel";
import DwgFloorPanel from "./DwgFloorPanel";
import ToolDrawer from "./ToolDrawer";
import CloudSyncPanel from "./CloudSyncPanel";
import {assertOpeningOnlyEdit} from '@/lib/manualOpenings.mjs';
import FurnitureEditorPanel from "./FurnitureEditorPanel";
import {bindFurnitureInputs} from '@/lib/furnitureInputs.mjs';
import {LOCKED_ARCHITECTURE} from '@/lib/furnitureEditor.mjs';
import {repairObservedDoors} from "@/lib/repairObservedDoors.mjs";
import {waitForViewerSurface} from "@/lib/viewerSurface.mjs";
import {schematicGeometryAudit} from "@/lib/schematicGeometryAudit.mjs";
import {createPhysicalPreview} from "@/lib/physicalPreview.mjs";
import {configureSchematicLighting} from "@/lib/schematicLighting.mjs";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {readSchematicSync,readSchematic,saveSchematic,drawingSceneMatches,activeSourceSync,readActiveSource,saveActiveSource} from '@/lib/schematicStorage.mjs';
import {readTakeoffSync,readPersistedTakeoff,persistTakeoff} from "@/lib/takeoffStorage.mjs";
import {resolveDwgCalibration,dwgReconstructionReadiness} from "@/lib/dwgCalibration.mjs";
import {bindProjectCameraInputs} from '@/lib/projectCameraInputs.mjs';
import {applySceneStyle,engineeringUrn,rememberEngineeringTakeoff,chooseEngineeringTakeoff} from '@/lib/sceneStyle.mjs';
import {reconcileEngineering,restoreEngineeringSnapshot} from '@/lib/engineeringRestore.mjs';
import {orbitOffset, cameraFitDistance, namedCameraOffset} from "@/lib/orbitCamera.mjs";
import {commercialFetch,commercialHeaders} from '@/lib/commercialFetch';
import { sourcePresentationAssets, restoreWallContactFurniture } from "@/lib/sourceFurniture.mjs";
import {isInteriorSource,dwgInteriorMatches,savedDwgInterior,upgradeDwgInterior,dwgInteriorScene,rebuildDwgInterior,repairDwgInterior,updateDwgInterior,patchDwgPresentation,dwgInteriorCameraKey,dwgFloorIndices} from "@/lib/dwgInterior.mjs";
import {recoverInteriorRoomBoundaries,collectInteriorRoomLabels} from "@/lib/dwgRoomBoundaries.mjs";
import {splitDwgRegions,dwgRoomScene} from "@/lib/dwgFloors.mjs";
import {applyDesignDefaults} from "@/lib/designDefaults.mjs";
import {watermarkJpegCapture} from "@/lib/brandWatermark.mjs";
import { arrangeLivingFurniture } from "@/lib/interiorPresentation.mjs";

import { useEffect, useRef, useState, useSyncExternalStore, useEffectEvent } from "react";
import { getRasterReview, subscribeRasterReview } from "@/lib/rasterReviewSession.mjs";
import "./Project3DViewer.css";

const VIEWER_CSS =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";
const VIEWER_JS =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";

function loadViewerSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Viewer requires a browser."));
  }

  if (window.Autodesk?.Viewing) {
    return Promise.resolve();
  }

  if (!document.querySelector(`link[href="${VIEWER_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = VIEWER_CSS;
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${VIEWER_JS}"]`);

    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = VIEWER_JS;
    script.async = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("Autodesk Viewer SDK could not be loaded."));
    document.head.appendChild(script);
  });
}

async function requestToken(urn) {
  let response = await commercialFetch(`/api/aps/token?urn=${encodeURIComponent(urn)}`, { cache: "no-store" });

  if (!response.ok) {
    response = await commercialFetch(`/api/aps/viewer-token?urn=${encodeURIComponent(urn)}`, { cache: "no-store" });
  }

  const payload = await response.json();

  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error || "APS viewer token could not be loaded.");
  }

  return payload;
}

function initializeViewer(urn) {
  return new Promise((resolve, reject) => {
    window.Autodesk.Viewing.Initializer(
      {
        env: "AutodeskProduction2",
        api: "streamingV2_EU",
        getAccessToken: async (callback) => {
          try {
            const token = await requestToken(urn);
            callback(token.access_token, Number(token.expires_in) || 3599);
          } catch (error) {
            console.error("[VENTRA 3D TOKEN]", error);
            callback("", 0);
          }
        },
      },
      resolve,
      reject
    );
  });
}

function loadDocument(urn) {
  return new Promise((resolve, reject) => {
    window.Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      resolve,
      (code, message) =>
        reject(
          new Error(
            message || `Autodesk document load failed (${code}).`
          )
        )
    );
  });
}

function getViewables(documentNode) {
  const root =
    documentNode?.getRoot?.();

  if (!root) {
    return [];
  }

  const geometries=apsGeometryNodes(root);

  return (
    Array.isArray(geometries)
      ? geometries
      : []
  ).map(
    (node, index) => {
      const role =
        node?.data?.role ||
        node?.role?.() ||
        "unknown";

      return {
        node,
        index,
        name:
          node?.name?.() ||
          node?.data?.name ||
          `View ${index + 1}`,
        role,
        is3D:
          String(role)
            .toLowerCase() ===
          "3d",
      };
    }
  );
}


const VENTRA_RECON_OVERLAY =
  "ventra-reconstruction-overlay";
const VENTRA_DESIGN_OVERLAY =
  "ventra-design-overlay";
const VENTRA_SCHEMATIC_ROOT_NAME = "ventra-schematic-root";
const VENTRA_SCHEMATIC_OVERLAY =
  "ventra-schematic-overlay";

function getThree() {
  return (
    window?.THREE ||
    window?.Autodesk
      ?.Viewing
      ?.Private
      ?.THREE ||
    null
  );
}

function clearDesignOverlay(viewer) {
  try {
    viewer?.impl
      ?.removeOverlayScene?.(
        VENTRA_DESIGN_OVERLAY
      );
  } catch {}
}

function clearReconstruction(
  viewer
) {
  clearDesignOverlay(viewer);

  try {
    viewer?.impl
      ?.removeOverlayScene?.(
        VENTRA_RECON_OVERLAY
      );
  } catch {}
}


function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function pointAlongSegment(start, end, t) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function splitWallByOpenings({ start, end, openings, minimumWallPiece = 0.08, preserveRasterTrace = false }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= minimumWallPiece) return [];

  const intervals = [];
  for (const opening of openings || []) {
    const center = opening?.wallPosition;
    if (!center) continue;
    const projected = projectPointToSegment2D(center, start, end);
    if (projected.distance > 0.18) continue;
    const width = preserveRasterTrace ? Number(opening.width) : Math.max(0.10, Number(opening.width) || 0);
    const halfT = (width / 2) / length;
    const a = clamp01(projected.t - halfT);
    const b = clamp01(projected.t + halfT);
    if (b - a > 1e-6) intervals.push([a, b]);
  }

  if (intervals.length === 0) return [{ start, end }];
  intervals.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const interval of intervals) {
    const last=merged[merged.length-1];
    if (!last || interval[0] > last[1] + 1e-6) merged.push([interval[0], interval[1]]);
    else last[1]=Math.max(last[1], interval[1]);
  }

  const pieces=[];
  let cursor=0;
  for (const [a,b] of merged) {
    if (a-cursor > 1e-6) {
      const s=pointAlongSegment(start,end,cursor);
      const e=pointAlongSegment(start,end,a);
      if (Math.hypot(e.x-s.x,e.y-s.y) >= minimumWallPiece) pieces.push({start:s,end:e});
    }
    cursor=Math.max(cursor,b);
  }
  if (1-cursor > 1e-6) {
    const s=pointAlongSegment(start,end,cursor);
    const e=end;
    if (Math.hypot(e.x-s.x,e.y-s.y) >= minimumWallPiece) pieces.push({start:s,end:e});
  }
  return pieces;
}

function buildHeaderWallMesh({ THREE, opening, thickness, wallHeight, zBase, material }) {
  const openingHeight=Number(opening?.height);
  const sillHeight=Number(opening?.sillHeight)||0;
  const top=sillHeight+openingHeight;
  const headerHeight=wallHeight-top;
  if (!Number.isFinite(headerHeight) || headerHeight <= (opening?.preserveRasterTrace ? 0.001 : 0.05)) return null;
  return createWallMesh({THREE,start:opening.start,end:opening.end,height:headerHeight,thickness,zBase:zBase+top,material});
}

function buildWindowSillWallMesh({ THREE, opening, thickness, zBase, material }) {
  if (opening?.type !== 'window') return null;
  const sillHeight=Number(opening?.sillHeight)||0;
  if (sillHeight <= (opening?.preserveRasterTrace ? 0.001 : 0.05)) return null;
  return createWallMesh({THREE,start:opening.start,end:opening.end,height:sillHeight,thickness,zBase,material});
}

function createWallMesh({
  THREE,
  start,
  end,
  height,
  thickness,
  zBase = 0,
  material,
}) {
  const x1 = Number(start?.x);
  const y1 = Number(start?.y);
  const x2 = Number(end?.x);
  const y2 = Number(end?.y);

  if (
    ![
      x1,
      y1,
      x2,
      y2,
    ].every(Number.isFinite)
  ) {
    return null;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length =
    Math.hypot(dx, dy);

  if (
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return null;
  }

  const geometry =
    new THREE.BoxGeometry(
      length,
      thickness,
      height
    );

  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );

  mesh.position.set(
    (x1 + x2) / 2,
    (y1 + y2) / 2,
    zBase + height / 2
  );

  mesh.rotation.z =
    Math.atan2(dy, dx);

  return mesh;
}

function ventraDistance2D(
  a,
  b
) {
  return Math.hypot(
    Number(a?.x) -
      Number(b?.x),
    Number(a?.y) -
      Number(b?.y)
  );
}

function ventraCross2D(
  a,
  b,
  c
) {
  return (
    (Number(b?.x) -
      Number(a?.x)) *
      (Number(c?.y) -
        Number(a?.y)) -
    (Number(b?.y) -
      Number(a?.y)) *
      (Number(c?.x) -
        Number(a?.x))
  );
}

function ventraOrientation(
  a,
  b,
  c,
  epsilon = 1e-9
) {
  const cross =
    ventraCross2D(
      a,
      b,
      c
    );

  if (
    Math.abs(cross) <=
    epsilon
  ) {
    return 0;
  }

  return cross > 0
    ? 1
    : -1;
}

function ventraOnSegment(
  a,
  b,
  p,
  epsilon = 1e-9
) {
  return (
    Number(p.x) >=
      Math.min(
        Number(a.x),
        Number(b.x)
      ) -
        epsilon &&
    Number(p.x) <=
      Math.max(
        Number(a.x),
        Number(b.x)
      ) +
        epsilon &&
    Number(p.y) >=
      Math.min(
        Number(a.y),
        Number(b.y)
      ) -
        epsilon &&
    Number(p.y) <=
      Math.max(
        Number(a.y),
        Number(b.y)
      ) +
        epsilon
  );
}

function ventraSegmentsIntersect(
  a,
  b,
  c,
  d,
  epsilon = 1e-9
) {
  const o1 =
    ventraOrientation(
      a,
      b,
      c,
      epsilon
    );
  const o2 =
    ventraOrientation(
      a,
      b,
      d,
      epsilon
    );
  const o3 =
    ventraOrientation(
      c,
      d,
      a,
      epsilon
    );
  const o4 =
    ventraOrientation(
      c,
      d,
      b,
      epsilon
    );

  if (
    o1 !== o2 &&
    o3 !== o4
  ) {
    return true;
  }

  if (
    o1 === 0 &&
    ventraOnSegment(
      a,
      b,
      c,
      epsilon
    )
  ) {
    return true;
  }

  if (
    o2 === 0 &&
    ventraOnSegment(
      a,
      b,
      d,
      epsilon
    )
  ) {
    return true;
  }

  if (
    o3 === 0 &&
    ventraOnSegment(
      c,
      d,
      a,
      epsilon
    )
  ) {
    return true;
  }

  if (
    o4 === 0 &&
    ventraOnSegment(
      c,
      d,
      b,
      epsilon
    )
  ) {
    return true;
  }

  return false;
}

function ventraPolygonIsSimple(
  points
) {
  const count =
    points.length;

  if (count < 3) {
    return false;
  }

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    const a =
      points[i];
    const b =
      points[
        (i + 1) %
          count
      ];

    for (
      let j = i + 1;
      j < count;
      j += 1
    ) {
      const c =
        points[j];
      const d =
        points[
          (j + 1) %
            count
        ];

      const adjacent =
        i === j ||
        (i + 1) %
          count === j ||
        i ===
          (j + 1) %
            count;

      if (adjacent) {
        continue;
      }

      if (
        ventraSegmentsIntersect(
          a,
          b,
          c,
          d
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

function sanitizeFloorPolygon(
  polygon
) {
  const rawPoints =
    Array.isArray(polygon)
      ? polygon
      : Array.isArray(
          polygon?.points
        )
        ? polygon.points
        : [];

  const numeric =
    rawPoints
      .map((point) => ({
        x:
          Number(
            point?.x
          ),
        y:
          Number(
            point?.y
          ),
      }))
      .filter(
        (point) =>
          Number.isFinite(
            point.x
          ) &&
          Number.isFinite(
            point.y
          )
      );

  if (
    numeric.length < 3
  ) {
    return {
      valid: false,
      reason:
        "too_few_numeric_points",
      points: [],
    };
  }

  const epsilon =
    1e-6;

  const deduped = [];

  for (
    const point of
    numeric
  ) {
    const previous =
      deduped[
        deduped.length - 1
      ];

    if (
      previous &&
      ventraDistance2D(
        previous,
        point
      ) <= epsilon
    ) {
      continue;
    }

    deduped.push(
      point
    );
  }

  if (
    deduped.length >= 2 &&
    ventraDistance2D(
      deduped[0],
      deduped[
        deduped.length - 1
      ]
    ) <= epsilon
  ) {
    deduped.pop();
  }

  if (
    deduped.length < 3
  ) {
    return {
      valid: false,
      reason:
        "collapsed_after_duplicate_cleanup",
      points: [],
    };
  }

  let cleaned =
    [...deduped];

  // Remove near-collinear intermediate vertices. CAD outlines often contain
  // dozens of tiny points on one straight edge; ShapeGeometry does not enjoy
  // being fed those any more than a human enjoys reading them.
  let changed = true;
  let guard = 0;

  while (
    changed &&
    cleaned.length > 3 &&
    guard < 10
  ) {
    changed = false;
    guard += 1;

    const next = [];

    for (
      let index = 0;
      index <
      cleaned.length;
      index += 1
    ) {
      const previous =
        cleaned[
          (index -
            1 +
            cleaned.length) %
            cleaned.length
        ];
      const current =
        cleaned[index];
      const following =
        cleaned[
          (index + 1) %
            cleaned.length
        ];

      const cross =
        Math.abs(
          ventraCross2D(
            previous,
            current,
            following
          )
        );

      const span =
        Math.max(
          ventraDistance2D(
            previous,
            following
          ),
          1
        );

      if (
        cross <=
        epsilon * span
      ) {
        changed = true;
        continue;
      }

      next.push(
        current
      );
    }

    if (
      next.length >= 3
    ) {
      cleaned = next;
    } else {
      break;
    }
  }

  if (
    cleaned.length < 3
  ) {
    return {
      valid: false,
      reason:
        "collapsed_after_collinear_cleanup",
      points: [],
    };
  }

  if (
    !ventraPolygonIsSimple(
      cleaned
    )
  ) {
    return {
      valid: false,
      reason:
        "self_intersecting_polygon",
      points:
        cleaned,
    };
  }

  let signedArea = 0;

  for (
    let index = 0;
    index <
    cleaned.length;
    index += 1
  ) {
    const a =
      cleaned[index];
    const b =
      cleaned[
        (index + 1) %
          cleaned.length
      ];

    signedArea +=
      a.x * b.y -
      b.x * a.y;
  }

  signedArea /= 2;

  if (
    Math.abs(
      signedArea
    ) <= 1e-8
  ) {
    return {
      valid: false,
      reason:
        "near_zero_area_polygon",
      points:
        cleaned,
    };
  }

  return {
    valid: true,
    reason: "ok",
    points:
      cleaned,
    signedArea,
  };
}

function buildFloorMesh({
  THREE,
  polygon,
  z = 0,
  material,
}) {
  const sanitized =
    sanitizeFloorPolygon(
      polygon
    );

  if (
    !sanitized.valid
  ) {
    return {
      mesh: null,
      skipped: true,
      reason:
        sanitized.reason,
    };
  }

  const valid =
    sanitized.points;

  try {
    const shape =
      new THREE.Shape();

    shape.moveTo(
      valid[0].x,
      valid[0].y
    );

    for (
      let index = 1;
      index <
      valid.length;
      index += 1
    ) {
      shape.lineTo(
        valid[index].x,
        valid[index].y
      );
    }

    shape.closePath();

    const geometry =
      new THREE.ShapeGeometry(
        shape
      );

    const bufferVertexCount =
      Number(
        geometry?.attributes
          ?.position?.count
      ) || 0;

    const legacyVertexCount =
      Array.isArray(
        geometry?.vertices
      )
        ? geometry.vertices.length
        : 0;

    const legacyFaceCount =
      Array.isArray(
        geometry?.faces
      )
        ? geometry.faces.length
        : 0;

    // Autodesk Viewer currently exposes THREE r71 in this project.
    // In that legacy THREE version ShapeGeometry returns Geometry with
    // .vertices / .faces instead of BufferGeometry .attributes.position.
    // The previous check rejected every valid room floor, which is why the
    // console reported roomCount: 0 even though the room polygons existed.
    const hasValidGeometry =
      bufferVertexCount >= 3 ||
      (
        legacyVertexCount >= 3 &&
        legacyFaceCount >= 1
      );

    if (!hasValidGeometry) {
      geometry?.dispose?.();

      console.warn(
        "[VENTRA JPG FLOOR GEOMETRY REJECTED v14.1]",
        {
          bufferVertexCount,
          legacyVertexCount,
          legacyFaceCount,
          threeRevision:
            THREE?.REVISION ||
            null,
        }
      );

      return {
        mesh: null,
        skipped: true,
        reason:
          "triangulation_returned_empty_geometry",
      };
    }

    try {
      geometry.computeFaceNormals?.();
      geometry.computeVertexNormals?.();
      geometry.computeBoundingBox?.();
      geometry.computeBoundingSphere?.();
    } catch {}

    const mesh =
      new THREE.Mesh(
        geometry,
        material
      );

    mesh.position.z = z;

    console.log(
      "[VENTRA JPG ROOM FLOOR BUILT v14.1]",
      {
        threeRevision:
          THREE?.REVISION ||
          null,
        bufferVertexCount,
        legacyVertexCount,
        legacyFaceCount,
        z,
      }
    );

    return {
      mesh,
      skipped: false,
      reason: "ok",
    };
  } catch (error) {
    console.warn(
      "[VENTRA FLOOR POLYGON v42.2] skipped",
      {
        reason:
          error?.message ||
          "shape_geometry_failed",
        points:
          valid.length,
      }
    );

    return {
      mesh: null,
      skipped: true,
      reason:
        "shape_geometry_failed",
    };
  }
}


function ventraSignedPolygonArea2D(points = []) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return area / 2;
}

function ventraPointInTriangle2D(point, a, b, c) {
  const sign = (p1, p2, p3) =>
    (Number(p1.x) - Number(p3.x)) * (Number(p2.y) - Number(p3.y)) -
    (Number(p2.x) - Number(p3.x)) * (Number(p1.y) - Number(p3.y));

  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNeg && hasPos);
}

function ventraTriangulateSimplePolygon2D(polygon = []) {
  const sanitized = sanitizeFloorPolygon(polygon);
  if (!sanitized.valid || sanitized.points.length < 3) return [];

  const points = sanitized.points.slice();
  if (ventraSignedPolygonArea2D(points) < 0) points.reverse();

  const remaining = points.map((_, index) => index);
  const triangles = [];
  let guard = 0;

  while (remaining.length > 3 && guard < points.length * points.length * 2) {
    let earFound = false;

    for (let i = 0; i < remaining.length; i += 1) {
      const prevIndex = remaining[(i - 1 + remaining.length) % remaining.length];
      const currIndex = remaining[i];
      const nextIndex = remaining[(i + 1) % remaining.length];
      const a = points[prevIndex];
      const b = points[currIndex];
      const c = points[nextIndex];

      const cross =
        (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));

      if (cross <= 1e-9) continue;

      let containsOtherPoint = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === prevIndex || candidateIndex === currIndex || candidateIndex === nextIndex) continue;
        if (ventraPointInTriangle2D(points[candidateIndex], a, b, c)) {
          containsOtherPoint = true;
          break;
        }
      }

      if (containsOtherPoint) continue;

      triangles.push([prevIndex, currIndex, nextIndex]);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }

    if (!earFound) break;
    guard += 1;
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }

  return { points, triangles };
}

function ventraBuildConcaveFloorMesh({ THREE, polygon, z = 0, material }) {
  const triangulated = ventraTriangulateSimplePolygon2D(polygon);
  if (!triangulated?.triangles?.length) {
    return buildFloorMesh({ THREE, polygon, z, material });
  }

  const { points, triangles } = triangulated;

  try {
    if (THREE?.Geometry && THREE?.Face3 && THREE?.Vector3) {
      const geometry = new THREE.Geometry();
      geometry.vertices = points.map((point) => new THREE.Vector3(Number(point.x), Number(point.y), 0));
      geometry.faces = triangles.map(([a, b, c]) => new THREE.Face3(a, b, c));
      geometry.computeFaceNormals?.();
      geometry.computeVertexNormals?.();
      geometry.computeBoundingBox?.();
      geometry.computeBoundingSphere?.();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = z;
      return { mesh, skipped: false, reason: 'ear_clip_legacy_geometry' };
    }

    if (THREE?.BufferGeometry && THREE?.Float32BufferAttribute) {
      const positions = [];
      for (const [a, b, c] of triangles) {
        for (const index of [a, b, c]) {
          const point = points[index];
          positions.push(Number(point.x), Number(point.y), 0);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals?.();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = z;
      return { mesh, skipped: false, reason: 'ear_clip_buffer_geometry' };
    }
  } catch (error) {
    console.warn('[VENTRA JPG FOOTPRINT EAR CLIP v33]', error);
  }

  return buildFloorMesh({ THREE, polygon, z, material });
}



function serializeBox3(
  box
) {
  if (!box) {
    return null;
  }

  return {
    min: {
      x: Number(box.min?.x),
      y: Number(box.min?.y),
      z: Number(box.min?.z),
    },
    max: {
      x: Number(box.max?.x),
      y: Number(box.max?.y),
      z: Number(box.max?.z),
    },
  };
}

function deserializeBox3(
  THREE,
  value
) {
  if (
    !value?.min ||
    !value?.max
  ) {
    return null;
  }

  const numbers = [
    value.min.x,
    value.min.y,
    value.min.z,
    value.max.x,
    value.max.y,
    value.max.z,
  ].map(Number);

  if (
    !numbers.every(
      Number.isFinite
    )
  ) {
    return null;
  }

  return new THREE.Box3(
    new THREE.Vector3(
      numbers[0],
      numbers[1],
      numbers[2]
    ),
    new THREE.Vector3(
      numbers[3],
      numbers[4],
      numbers[5]
    )
  );
}

function frameReconstruction(
  viewer,
  serializedBounds
) {
  const THREE =
    getThree();

  if (
    !viewer ||
    !THREE?.Box3 ||
    !THREE?.Vector3
  ) {
    return false;
  }

  const bounds =
    deserializeBox3(
      THREE,
      serializedBounds
    );

  if (
    !bounds ||
    bounds.isEmpty?.()
  ) {
    return false;
  }

  const center =
    bounds.getCenter(
      new THREE.Vector3()
    );

  const size =
    bounds.getSize(
      new THREE.Vector3()
    );

  const maxDimension =
    Math.max(
      size.x,
      size.y,
      size.z,
      1
    );

  // Tight isometric framing for Ventra reconstruction.
  // The previous 1.65 multiplier made the building appear like a tiny model
  // because the Autodesk 2D sheet remained in the same Viewer session.
  const distance =
    maxDimension * 0.62;

  const position =
    new THREE.Vector3(
      center.x +
        distance,
      center.y -
        distance,
      center.z +
        distance * 0.72
    );

  try {
    viewer.navigation
      ?.toPerspective?.();

    viewer.navigation
      ?.setView?.(
        position,
        center
      );

    viewer.navigation
      ?.setPivotPoint?.(
        center
      );

    viewer.navigation
      ?.setCameraUpVector?.(
        new THREE.Vector3(
          0,
          0,
          1
        )
      );

    viewer.setActiveNavigationTool?.(
      "orbit"
    );

    viewer.impl
      ?.invalidate?.(
        true,
        true,
        true
      );

    return true;
  } catch (error) {
    console.warn(
      "[VENTRA 3D CAMERA v42.6]",
      error
    );

    return false;
  }
}



function lineMidpointMeters(
  line,
  meterFactor
) {
  const x1 = Number(line?.start?.x);
  const y1 = Number(line?.start?.y);
  const x2 = Number(line?.end?.x);
  const y2 = Number(line?.end?.y);

  if (
    ![
      x1,
      y1,
      x2,
      y2,
    ].every(Number.isFinite)
  ) {
    return null;
  }

  return {
    x:
      ((x1 + x2) / 2) *
      meterFactor,
    y:
      ((y1 + y2) / 2) *
      meterFactor,
  };
}

function splitWallLinesIntoStoreys(
  wallLines,
  meterFactor
) {
  return splitDwgRegions(wallLines,meterFactor);
}

function getStoreyFrame(
  lines,
  meterFactor
) {
  return getWallGeometryFrame(
    lines,
    meterFactor
  );
}

function toStoreyLocalMeters(
  point,
  frame,
  meterFactor
) {
  return toLocalMeters(
    point,
    frame,
    meterFactor
  );
}

function getWallGeometryFrame(
  wallLines,
  meterFactor
) {
  const points = [];

  for (const line of wallLines || []) {
    for (const point of [
      line?.start,
      line?.end,
    ]) {
      const x = Number(point?.x);
      const y = Number(point?.y);

      if (
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        points.push({ x, y });
      }
    }
  }

  if (points.length === 0) {
    return null;
  }

  const minX = Math.min(
    ...points.map(
      (point) => point.x
    )
  );
  const maxX = Math.max(
    ...points.map(
      (point) => point.x
    )
  );
  const minY = Math.min(
    ...points.map(
      (point) => point.y
    )
  );
  const maxY = Math.max(
    ...points.map(
      (point) => point.y
    )
  );

  const centerX =
    (minX + maxX) / 2;
  const centerY =
    (minY + maxY) / 2;

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX,
    centerY,
    widthMeters:
      (maxX - minX) *
      meterFactor,
    depthMeters:
      (maxY - minY) *
      meterFactor,
  };
}

function toLocalMeters(
  point,
  frame,
  meterFactor
) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (
    !frame ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    x:
      (x - frame.centerX) *
      meterFactor,
    y:
      (y - frame.centerY) *
      meterFactor,
    z: 0,
  };
}

function hideAutodeskSourceModel(
  viewer,
  sourceModel
) {
  if (!viewer) {
    return {
      hidden: false,
      unloaded: false,
    };
  }

  const model =
    sourceModel ||
    viewer.model;

  if (!model) {
    return {
      hidden: false,
      unloaded: false,
    };
  }

  let hidden = false;
  const unloaded = false;

  // Keep the Autodesk source model LOADED.
  // Unloading the only active 2D model can reset Autodesk's render lifecycle
  // and make Ventra's reconstruction overlay disappear even though all wall,
  // slab, door and window meshes were created successfully.
  //
  // We only hide the source model. The Viewer stays alive and continues
  // rendering VENTRA_RECON_OVERLAY.
  try {
    viewer.impl
      ?.setModelVisibility?.(
        model,
        false
      );
    hidden = true;
  } catch {}

  try {
    model
      ?.setAllVisibility?.(
        false
      );
    hidden = true;
  } catch {}

  try {
    viewer.impl
      ?.visibilityManager
      ?.setAllVisibility?.(
        false,
        model
      );
    hidden = true;
  } catch {}

  try {
    viewer.clearSelection?.();
  } catch {}

  viewer.impl
    ?.invalidate?.(
      true,
      true,
      true
    );

  console.log(
    "[VENTRA DWG SOURCE MODEL HIDDEN SAFELY]",
    {
      hidden,
      unloaded: false,
      viewerModelKeptAlive:
        Boolean(
          viewer.model ||
          model
        ),
    }
  );

  return {
    hidden,
    unloaded,
  };
}

async function showAutodeskSourceModel(
  viewer,
  documentNode,
  viewable,
  sourceModel,
  wasUnloaded
) {
  if (!viewer) {
    return null;
  }

  if (
    wasUnloaded &&
    documentNode &&
    viewable?.node
  ) {
    try {
      const restored =
        await viewer.loadDocumentNode(
          documentNode,
          viewable.node,
          {
            keepCurrentModels:
              false,
          }
        );

      viewer.fitToView?.();

      return (
        restored ||
        viewer.model ||
        null
      );
    } catch (error) {
      console.error(
        "[VENTRA SOURCE RESTORE v42.6]",
        error
      );
    }
  }

  const model =
    sourceModel ||
    viewer.model;

  try {
    viewer.impl
      ?.setModelVisibility?.(
        model,
        true
      );
  } catch {}

  try {
    model
      ?.setAllVisibility?.(
        true
      );
  } catch {}

  try {
    viewer.impl
      ?.visibilityManager
      ?.setAllVisibility?.(
        true,
        model
      );
  } catch {}

  try {
    viewer.showAll?.();
  } catch {}

  viewer.impl
    ?.invalidate?.(
      true,
      true,
      true
    );

  viewer.fitToView?.();

  return model || null;
}


function getLegacyObjectList(
  takeoff,
  key
) {
  const direct =
    takeoff
      ?.object_details
      ?.[key];

  if (Array.isArray(direct)) {
    return direct;
  }

  const advanced =
    takeoff
      ?.advanced_takeoff
      ?.object_details
      ?.[key];

  return Array.isArray(advanced)
    ? advanced
    : [];
}

function getVerifiedLinesByType(
  takeoff,
  geometry,
  type
) {
  const directKey =
    type === "door"
      ? "doorLineSegments"
      : type === "window"
        ? "windowLineSegments"
        : null;

  if (
    directKey &&
    Array.isArray(
      geometry?.[directKey]
    ) &&
    geometry[directKey].length > 0
  ) {
    return {
      lines:
        geometry[directKey],
      source:
        `saved_${type}_segments`,
    };
  }

  const allLines =
    Array.isArray(
      geometry?.lineSegments
    )
      ? geometry.lineSegments
      : [];

  const objectKey =
    type === "door"
      ? "doors"
      : "windows";

  const objects =
    getLegacyObjectList(
      takeoff,
      objectKey
    );

  const ids =
    new Set(
      objects
        .map(
          (item) =>
            item?.dbId
        )
        .filter(
          (value) =>
            value !== null &&
            value !== undefined
        )
        .map(String)
    );

  if (
    allLines.length === 0 ||
    ids.size === 0
  ) {
    return {
      lines: [],
      source: "unavailable",
    };
  }

  return {
    lines:
      allLines.filter(
        (line) =>
          ids.has(
            String(
              line?.dbId
            )
          )
      ),
    source:
      `legacy_lines_plus_verified_${type}_dbids`,
  };
}

function convexHull2D(
  points
) {
  const unique =
    [...new Map(
      (points || [])
        .filter(
          (p) =>
            Number.isFinite(Number(p?.x)) &&
            Number.isFinite(Number(p?.y))
        )
        .map(
          (p) => [
            `${Number(p.x).toFixed(6)}:${Number(p.y).toFixed(6)}`,
            {
              x: Number(p.x),
              y: Number(p.y),
            },
          ]
        )
    ).values()];

  if (unique.length < 3) {
    return [];
  }

  unique.sort(
    (a, b) =>
      a.x === b.x
        ? a.y - b.y
        : a.x - b.x
  );

  const cross =
    (o, a, b) =>
      (a.x - o.x) *
        (b.y - o.y) -
      (a.y - o.y) *
        (b.x - o.x);

  const lower = [];

  for (const p of unique) {
    while (
      lower.length >= 2 &&
      cross(
        lower[lower.length - 2],
        lower[lower.length - 1],
        p
      ) <= 0
    ) {
      lower.pop();
    }

    lower.push(p);
  }

  const upper = [];

  for (
    let i = unique.length - 1;
    i >= 0;
    i -= 1
  ) {
    const p = unique[i];

    while (
      upper.length >= 2 &&
      cross(
        upper[upper.length - 2],
        upper[upper.length - 1],
        p
      ) <= 0
    ) {
      upper.pop();
    }

    upper.push(p);
  }

  lower.pop();
  upper.pop();

  return [
    ...lower,
    ...upper,
  ];
}

function createSlabMesh({
  THREE,
  points,
  thickness = 0.18,
  zBase = 0,
  material,
}) {
  const hull =
    convexHull2D(
      points
    );

  if (hull.length < 3) {
    return null;
  }

  try {
    const shape =
      new THREE.Shape();

    shape.moveTo(
      hull[0].x,
      hull[0].y
    );

    for (
      let i = 1;
      i < hull.length;
      i += 1
    ) {
      shape.lineTo(
        hull[i].x,
        hull[i].y
      );
    }

    shape.closePath();

    const geometry =
      new THREE.ExtrudeGeometry(
        shape,
        {
          // Autodesk Viewer can ship an older THREE build where
          // ExtrudeGeometry uses `amount` instead of `depth`. If only
          // `depth` is supplied that runtime falls back to its historical
          // default extrusion (100 units), producing the giant vertical
          // towers seen in the reconstruction. Supply both keys so the
          // slab is 0.18 m thick on old and new THREE runtimes.
          amount:
            thickness,
          depth:
            thickness,
          bevelEnabled:
            false,
          steps: 1,
        }
      );

    const mesh =
      new THREE.Mesh(
        geometry,
        material
      );

    mesh.position.z =
      zBase -
      thickness;

    return mesh;
  } catch (error) {
    console.warn(
      "[VENTRA SLAB v43]",
      error
    );

    return null;
  }
}


function groupLinesByDbId(
  lines
) {
  const groups =
    new Map();

  for (const line of lines || []) {
    const key =
      String(
        line?.dbId ??
        ""
      );

    if (!key) {
      continue;
    }

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(line);
  }

  return [
    ...groups.entries()
  ].map(
    ([dbId, groupedLines]) => ({
      dbId,
      lines:
        groupedLines,
    })
  );
}

function getOpeningDescriptor({
  group,
  storeyFrames,
  meterFactor,
  type,
}) {
  if (
    !group?.lines?.length
  ) {
    return null;
  }

  const points = [];

  for (
    const line of
    group.lines
  ) {
    for (const point of [
      line?.start,
      line?.end,
    ]) {
      const x =
        Number(point?.x);
      const y =
        Number(point?.y);

      if (
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        points.push({
          x,
          y,
        });
      }
    }
  }

  if (
    points.length < 2
  ) {
    return null;
  }

  const centroid = {
    x:
      points.reduce(
        (sum, p) =>
          sum + p.x,
        0
      ) /
      points.length,
    y:
      points.reduce(
        (sum, p) =>
          sum + p.y,
        0
      ) /
      points.length,
  };

  let bestStorey =
    storeyFrames[0];
  let bestDistance =
    Infinity;

  for (
    const storey of
    storeyFrames
  ) {
    const dx =
      (
        centroid.x -
        storey.frame
          .centerX
      ) *
      meterFactor;
    const dy =
      (
        centroid.y -
        storey.frame
          .centerY
      ) *
      meterFactor;

    const d =
      Math.hypot(
        dx,
        dy
      );

    if (
      d < bestDistance
    ) {
      bestDistance = d;
      bestStorey =
        storey;
    }
  }

  if (!bestStorey) {
    return null;
  }

  const localPoints =
    points
      .map(
        (point) =>
          toStoreyLocalMeters(
            point,
            bestStorey.frame,
            meterFactor
          )
      )
      .filter(Boolean);

  if (
    localPoints.length < 2
  ) {
    return null;
  }

  const minX =
    Math.min(
      ...localPoints.map(
        (p) => p.x
      )
    );
  const maxX =
    Math.max(
      ...localPoints.map(
        (p) => p.x
      )
    );
  const minY =
    Math.min(
      ...localPoints.map(
        (p) => p.y
      )
    );
  const maxY =
    Math.max(
      ...localPoints.map(
        (p) => p.y
      )
    );

  const spanX =
    maxX - minX;
  const spanY =
    maxY - minY;

  const major =
    Math.max(
      spanX,
      spanY
    );

  const minor =
    Math.min(
      spanX,
      spanY
    );

  // CAD door/window symbols often contain swing arcs and multiple short
  // segments. Use the overall object envelope, not every primitive line.
  let width =
    major;

  if (
    !Number.isFinite(width)
  ) {
    return null;
  }

  const limits =
    type === "door"
      ? {
          min: 0.55,
          max: 1.80,
          fallback:
            0.90,
        }
      : {
          min: 0.40,
          max: 3.60,
          fallback:
            1.20,
        };

  // Reject annotation-like or sheet-scale objects. Do not silently clamp huge
  // garbage into a plausible opening, because that would just hide bad data.
  if (
    width <
      limits.min ||
    width >
      limits.max
  ) {
    // If the envelope is distorted by a symbol arc, try the longest actual
    // primitive line as a secondary width estimate.
    let longest =
      0;

    for (
      const line of
      group.lines
    ) {
      const a =
        toStoreyLocalMeters(
          line?.start,
          bestStorey.frame,
          meterFactor
        );
      const b =
        toStoreyLocalMeters(
          line?.end,
          bestStorey.frame,
          meterFactor
        );

      if (!a || !b) {
        continue;
      }

      longest =
        Math.max(
          longest,
          Math.hypot(
            b.x - a.x,
            b.y - a.y
          )
        );
    }

    if (
      longest >=
        limits.min &&
      longest <=
        limits.max
    ) {
      width =
        longest;
    } else {
      return null;
    }
  }

  const center = {
    x:
      (minX + maxX) /
      2,
    y:
      (minY + maxY) /
      2,
  };

  // Orientation follows the longer dimension of the verified object envelope.
  const horizontal =
    spanX >= spanY;

  const half =
    width / 2;

  return {
    dbId:
      group.dbId,
    storey:
      bestStorey,
    start:
      horizontal
        ? {
            x:
              center.x -
              half,
            y:
              center.y,
          }
        : {
            x:
              center.x,
            y:
              center.y -
              half,
          },
    end:
      horizontal
        ? {
            x:
              center.x +
              half,
            y:
              center.y,
          }
        : {
            x:
              center.x,
            y:
              center.y +
              half,
          },
    width,
    minorSpan:
      minor,
  };
}


function validOpeningCentroid(
  object
) {
  const x =
    Number(
      object
        ?.centroid
        ?.x
    );
  const y =
    Number(
      object
        ?.centroid
        ?.y
    );

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  return {
    x,
    y,
  };
}

function resolveOpeningWidthMeters(
  object,
  type
) {
  const limits =
    type === "door"
      ? {
          min: 0.55,
          max: 1.80,
          fallback:
            0.90,
          defaultHeight:
            2.10,
        }
      : {
          min: 0.40,
          max: 3.60,
          fallback:
            1.20,
          defaultHeight:
            1.20,
        };

  const candidates = [
    Number(
      object?.width
    ),
    Number(
      object?.length
    ),
  ];

  const area =
    Number(
      object?.area
    );
  const height =
    Number(
      object?.height
    );

  if (
    Number.isFinite(area) &&
    area > 0
  ) {
    const usableHeight =
      Number.isFinite(height) &&
      height > 0.5 &&
      height < 4
        ? height
        : limits
            .defaultHeight;

    candidates.push(
      area /
        usableHeight
    );
  }

  for (
    const value of
    candidates
  ) {
    if (
      Number.isFinite(value) &&
      value >= limits.min &&
      value <= limits.max
    ) {
      return value;
    }
  }

  return limits.fallback;
}

function resolveOpeningHeightMeters(
  object,
  type
) {
  const value =
    Number(
      object?.height
    );

  const min =
    type === "door"
      ? 1.70
      : 0.50;

  const max =
    type === "door"
      ? 2.70
      : 2.40;

  if (
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  ) {
    return value;
  }

  return type === "door"
    ? 2.10
    : 1.20;
}

function chooseStoreyForPoint(point,storeyFrames,meterFactor) {
  if(!point||!Array.isArray(storeyFrames)||!storeyFrames.length)return null;
  const bounded=storeyFrames.filter(s=>[s.frame?.minX,s.frame?.maxX,s.frame?.minY,s.frame?.maxY].every(Number.isFinite));
  if(bounded.length===storeyFrames.length){
    const tolerance=.4/meterFactor;
    const contains=storeyFrames.filter(s=>point.x>=s.frame.minX-tolerance&&point.x<=s.frame.maxX+tolerance&&point.y>=s.frame.minY-tolerance&&point.y<=s.frame.maxY+tolerance);
    // The nearest floor centre is not evidence that an opening belongs to it.
    return contains.length===1?contains[0]:null;
  }
  // Compatibility for older callers without full frame bounds.
  return [...storeyFrames].sort((a,b)=>Math.hypot(point.x-a.frame.centerX,point.y-a.frame.centerY)-Math.hypot(point.x-b.frame.centerX,point.y-b.frame.centerY))[0]||null;
}

function projectPointToSegment2D(
  point,
  start,
  end
) {
  const dx =
    end.x -
    start.x;
  const dy =
    end.y -
    start.y;

  const lengthSquared =
    dx * dx +
    dy * dy;

  if (
    lengthSquared <=
    1e-10
  ) {
    return {
      point: {
        x:
          start.x,
        y:
          start.y,
      },
      t: 0,
      distance:
        Math.hypot(
          point.x -
            start.x,
          point.y -
            start.y
        ),
    };
  }

  const rawT =
    (
      (
        point.x -
        start.x
      ) *
        dx +
      (
        point.y -
        start.y
      ) *
        dy
    ) /
    lengthSquared;

  const t =
    Math.max(
      0,
      Math.min(
        1,
        rawT
      )
    );

  const projected = {
    x:
      start.x +
      dx * t,
    y:
      start.y +
      dy * t,
  };

  return {
    point:
      projected,
    t,
    distance:
      Math.hypot(
        point.x -
          projected.x,
        point.y -
          projected.y
      ),
  };
}

function normalizedWallKey(line) {
  const x1=Number(line?.start?.x), y1=Number(line?.start?.y);
  const x2=Number(line?.end?.x), y2=Number(line?.end?.y);
  if (![x1,y1,x2,y2].every(Number.isFinite)) return null;
  const a=`${x1.toFixed(6)},${y1.toFixed(6)}`;
  const b=`${x2.toFixed(6)},${y2.toFixed(6)}`;
  const ordered=a<=b?`${a}|${b}`:`${b}|${a}`;
  const dbId=(line?.dbId!==null&&line?.dbId!==undefined)?String(line.dbId):"no-db";
  return `${dbId}:${ordered}`;
}

function snapOpeningObjectToWall({
  object,
  type,
  storeyFrames,
  meterFactor,
  fallbackGroup,
}) {
  let centroid =
    validOpeningCentroid(
      object
    );

  // Older saved takeoffs may not contain centroids. When available, use the
  // verified dbId line group only to recover the object's center, never to
  // create hundreds of primitive-line openings.
  if (
    !centroid &&
    fallbackGroup
      ?.lines
      ?.length
  ) {
    const points = [];

    for (
      const line of
      fallbackGroup.lines
    ) {
      for (
        const point of [
          line?.start,
          line?.end,
        ]
      ) {
        const x =
          Number(point?.x);
        const y =
          Number(point?.y);

        if (
          Number.isFinite(x) &&
          Number.isFinite(y)
        ) {
          points.push({
            x,
            y,
          });
        }
      }
    }

    if (
      points.length > 0
    ) {
      centroid = {
        x:
          points.reduce(
            (sum, p) =>
              sum + p.x,
            0
          ) /
          points.length,
        y:
          points.reduce(
            (sum, p) =>
              sum + p.y,
            0
          ) /
          points.length,
      };
    }
  }

  if (!centroid) {
    return {
      valid: false,
      reason:
        "missing_centroid",
    };
  }

  const storey =
    chooseStoreyForPoint(
      centroid,
      storeyFrames,
      meterFactor
    );

  if (!storey) {
    return {
      valid: false,
      reason:
        "storey_not_found",
    };
  }

  const localCentroid =
    toStoreyLocalMeters(
      centroid,
      storey.frame,
      meterFactor
    );

  if (!localCentroid) {
    return {
      valid: false,
      reason:
        "centroid_transform_failed",
    };
  }

  let nearest = null;
  let nearestContaining = null;
  const resolvedOpeningWidth =
    resolveOpeningWidthMeters(
      object,
      type
    );
  const openingHalfWidth =
    Math.max(0.05, resolvedOpeningWidth / 2);

  for (
    const wallLine of
    storey.lines || []
  ) {
    const start =
      toStoreyLocalMeters(
        wallLine?.start,
        storey.frame,
        meterFactor
      );
    const end =
      toStoreyLocalMeters(
        wallLine?.end,
        storey.frame,
        meterFactor
      );

    if (
      !start ||
      !end
    ) {
      continue;
    }

    const wallLength =
      Math.hypot(
        end.x -
          start.x,
        end.y -
          start.y
      );

    // Tiny line fragments are usually CAD detail noise, not usable walls.
    if (
      wallLength <
      0.25
    ) {
      continue;
    }

    const projection =
      projectPointToSegment2D(
        localCentroid,
        start,
        end
      );

    const candidate = {
      start,
      end,
      rawWallLine: wallLine,
      parentWallKey: normalizedWallKey(wallLine),
      distance:
        projection.distance,
      position:
        projection.point,
      wallLength,
    };

    if (
      !nearest ||
      projection.distance <
        nearest.distance
    ) {
      nearest = candidate;
    }

    const edgeClearance =
      Math.min(
        projection.t * wallLength,
        (1 - projection.t) * wallLength
      );
    const containsFullOpening =
      edgeClearance + 0.02 >=
      openingHalfWidth;

    if (
      containsFullOpening &&
      (
        !nearestContaining ||
        projection.distance <
          nearestContaining.distance
      )
    ) {
      nearestContaining = candidate;
    }
  }

  // A containing span cannot justify jumping past the closest wall.
  if(nearestContaining && nearest && nearestContaining.distance<=nearest.distance+.12)nearest=nearestContaining;
  else if(nearestContaining!==nearest && nearest) {
    const projection=projectPointToSegment2D(localCentroid,nearest.start,nearest.end);
    if(Math.min(projection.t,1-projection.t)*nearest.wallLength+.02<openingHalfWidth)
      return {valid:false,reason:'opening_does_not_fit_nearest_wall'};
  }

  if (!nearest) {
    return {
      valid: false,
      reason:
        "nearest_wall_missing",
    };
  }

  const maxSnapDistance =
    0.40;

  if (
    nearest.distance >
    maxSnapDistance
  ) {
    return {
      valid: false,
      reason:
        "too_far_from_wall",
      distance:
        nearest.distance,
    };
  }

  const wallDx =
    nearest.end.x -
    nearest.start.x;
  const wallDy =
    nearest.end.y -
    nearest.start.y;

  const wallLength =
    Math.hypot(
      wallDx,
      wallDy
    );

  if (
    wallLength <= 0
  ) {
    return {
      valid: false,
      reason:
        "invalid_wall_direction",
    };
  }

  const width =
    Math.min(
      resolvedOpeningWidth,
      Math.max(
        0.45,
        wallLength * 0.92
      )
    );

  const ux =
    wallDx /
    wallLength;
  const uy =
    wallDy /
    wallLength;

  const half =
    width / 2;

  return {
    valid: true,
    dbId:
      object?.dbId ??
      null,
    storey,
    start: {
      x:
        nearest
          .position
          .x -
        ux * half,
      y:
        nearest
          .position
          .y -
        uy * half,
    },
    end: {
      x:
        nearest
          .position
          .x +
        ux * half,
      y:
        nearest
          .position
          .y +
        uy * half,
    },
    width,
    height:
      resolveOpeningHeightMeters(
        object,
        type
      ),
    snapDistance:
      nearest.distance,
    wallPosition:
      nearest.position,
    wallStart:
      nearest.start,
    wallEnd:
      nearest.end,
    parentWallKey:
      nearest.parentWallKey,
    parentWallDbId:
      nearest.rawWallLine?.dbId ?? null,
    source:
      validOpeningCentroid(
        object
      )
        ? "aps_object_centroid_snapped_to_verified_wall"
        : "verified_dbid_geometry_center_snapped_to_verified_wall",
  };
}

function uniqueOpeningObjects(
  objects,
  expectedCount
) {
  const result = [];
  const seen =
    new Set();

  for (
    let index = 0;
    index <
    (objects || []).length;
    index += 1
  ) {
    const object =
      objects[index];

    const dbId =
      object?.dbId;

    const key =
      dbId !== null &&
      dbId !== undefined
        ? `db:${String(dbId)}`
        : `idx:${index}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(object);
  }

  const expected =
    Number(
      expectedCount
    );

  if (
    Number.isFinite(expected) &&
    expected > 0 &&
    result.length > expected
  ) {
    return result.slice(
      0,
      expected
    );
  }

  return result;
}

function createOpeningMarker({
  THREE,
  start,
  end,
  widthFallback,
  thickness,
  height,
  sillHeight = 0,
  zBase = 0,
  material,
}) {
  if (
    !start ||
    !end
  ) {
    return null;
  }

  const dx =
    Number(end.x) -
    Number(start.x);
  const dy =
    Number(end.y) -
    Number(start.y);

  let length =
    Math.hypot(
      dx,
      dy
    );

  if (
    !Number.isFinite(length) ||
    length <= 0.05
  ) {
    length =
      widthFallback;
  }

  const geometry =
    new THREE.BoxGeometry(
      Math.max(
        length,
        widthFallback
      ),
      thickness,
      height
    );

  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );

  mesh.position.set(
    (
      Number(start.x) +
      Number(end.x)
    ) / 2,
    (
      Number(start.y) +
      Number(end.y)
    ) / 2,
    zBase +
      sillHeight +
      height / 2
  );

  mesh.rotation.z =
    Math.atan2(
      dy,
      dx
    );

  return mesh;
}

function getStoreyIndexForLine(
  line,
  storeyFrames,
  meterFactor
) {
  const midpoint =
    lineMidpointMeters(
      line,
      meterFactor
    );

  if (!midpoint) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance =
    Infinity;

  for (
    const storey of
    storeyFrames
  ) {
    const cx =
      storey.frame
        .centerX *
      meterFactor;
    const cy =
      storey.frame
        .centerY *
      meterFactor;

    const d =
      Math.hypot(
        midpoint.x - cx,
        midpoint.y - cy
      );

    if (
      d < bestDistance
    ) {
      bestDistance = d;
      bestIndex =
        storey.index;
    }
  }

  return bestIndex;
}

function addMeshToBounds(
  THREE,
  mesh,
  bounds
) {
  if (!mesh || !bounds) {
    return false;
  }

  try {
    mesh.updateMatrixWorld?.(
      true
    );

    const meshBounds =
      new THREE.Box3()
        .setFromObject(
          mesh
        );

    if (
      meshBounds.isEmpty()
    ) {
      return false;
    }

    const size =
      meshBounds.getSize(
        new THREE.Vector3()
      );

    // Final geometry fuse. A normal Ventra villa reconstruction is measured
    // in metres. Never allow a malformed primitive (for example an old
    // ExtrudeGeometry defaulting to 100 units) to poison camera bounds.
    if (
      !Number.isFinite(size.x) ||
      !Number.isFinite(size.y) ||
      !Number.isFinite(size.z) ||
      size.x > 80 ||
      size.y > 80 ||
      size.z > 20
    ) {
      console.warn(
        "[VENTRA RECONSTRUCTION] rejected implausible mesh bounds",
        { x: size.x, y: size.y, z: size.z }
      );
      return false;
    }

    bounds.union(
      meshBounds
    );

    return true;
  } catch {
    return false;
  }
}


function colorToHex(value, fallback) {
  const normalized = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return Number.parseInt(normalized.slice(1), 16);
  }
  return fallback;
}

function setMaterialDesign(material, color, fallbackColor, shininess = 22) {
  if (!material) return;
  const nextColor = colorToHex(color, fallbackColor);
  material.color?.setHex?.(nextColor);
  material.shininess = Number.isFinite(Number(shininess))
    ? Math.max(0, Math.min(100, Number(shininess)))
    : 22;
  material.needsUpdate = true;
}

function distancePointToSegment(point, start, end) {
  return projectPointToSegment2D(point, start, end).distance;
}

function isExteriorWallSegment(start, end, hull, tolerance = 0.24) {
  if (!start || !end || !Array.isArray(hull) || hull.length < 3) return false;
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.05) return false;

  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index];
    const b = hull[(index + 1) % hull.length];
    const hx = b.x - a.x;
    const hy = b.y - a.y;
    const hullLength = Math.hypot(hx, hy);
    if (!Number.isFinite(hullLength) || hullLength < 0.05) continue;
    const parallel = Math.abs((dx * hx + dy * hy) / (length * hullLength));
    if (parallel < 0.94) continue;
    if (distancePointToSegment(midpoint, a, b) <= tolerance) return true;
  }
  return false;
}

function buildDesignOverlay({ viewer, reconstruction, design }) {
  const THREE = getThree();
  const runtime = reconstruction?._runtime;
  const impl = viewer?.impl;
  if (!viewer || !THREE || !runtime || !impl) {
    throw new Error("Reconstruct 3D before applying a design prompt.");
  }

  clearDesignOverlay(viewer);
  if (typeof impl.createOverlayScene === 'function') {
    impl.createOverlayScene(VENTRA_DESIGN_OVERLAY);
  }

  const palette = design?.palette || {};
  setMaterialDesign(runtime.interiorWallMaterial, palette.interiorWall, 0xd8d8d8, design?.wallShininess);
  setMaterialDesign(runtime.exteriorWallMaterial, palette.facade, 0xd8d8d8, design?.facadeShininess);
  setMaterialDesign(runtime.doorMaterial, palette.door, 0x8b5a2b, 30);
  setMaterialDesign(runtime.windowMaterial, palette.glass, 0x85c8ff, 80);

  if (runtime.windowMaterial) {
    runtime.windowMaterial.opacity = Math.max(0.2, Math.min(0.85, Number(design?.glassOpacity) || 0.52));
    runtime.windowMaterial.transparent = true;
    runtime.windowMaterial.needsUpdate = true;
  }

  const floorFinishMaterial = new THREE.MeshPhongMaterial({
    color: colorToHex(palette.floor, 0xc7b8a2),
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    shininess: Math.max(0, Math.min(100, Number(design?.floorShininess) || 28)),
  });

  const ceilingMaterial = new THREE.MeshPhongMaterial({
    color: colorToHex(palette.ceiling, 0xf4f1e9),
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    shininess: 8,
  });

  const accentMaterial = new THREE.MeshPhongMaterial({
    color: colorToHex(palette.accent, 0x7b5b3d),
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    shininess: 25,
  });

  let floorFinishCount = 0;
  let ceilingCount = 0;
  let baseboardCount = 0;
  let facadeBandCount = 0;

  for (const storey of runtime.storeys || []) {
    const zBase = storey.index * runtime.storeyHeightMeters;

    if (design?.features?.floorFinish !== false && Array.isArray(storey.hull) && storey.hull.length >= 3) {
      const finish = createSlabMesh({
        THREE,
        points: storey.hull,
        thickness: 0.025,
        zBase: zBase + 0.185,
        material: floorFinishMaterial,
      });
      if (finish) {
        finish.userData = { ventraType: "design_floor_finish", aiGeneratedDesign: true };
        viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY, finish);
        floorFinishCount += 1;
      }
    }

    if (design?.features?.ceiling === true && Array.isArray(storey.hull) && storey.hull.length >= 3) {
      const ceiling = createSlabMesh({
        THREE,
        points: storey.hull,
        thickness: 0.035,
        zBase: zBase + runtime.wallHeightMeters - 0.04,
        material: ceilingMaterial,
      });
      if (ceiling) {
        ceiling.userData = { ventraType: "design_ceiling", aiGeneratedDesign: true };
        viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY, ceiling);
        ceilingCount += 1;
      }
    }

    if (design?.features?.baseboards !== false) {
      for (const piece of storey.wallPieces || []) {
        if (piece.exterior) continue;
        const baseboard = createWallMesh({
          THREE,
          start: piece.start,
          end: piece.end,
          height: 0.11,
          thickness: runtime.wallThicknessMeters + 0.012,
          zBase: zBase + 0.19,
          material: accentMaterial,
        });
        if (!baseboard) continue;
        baseboard.userData = { ventraType: "design_baseboard", aiGeneratedDesign: true };
        viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY, baseboard);
        baseboardCount += 1;
      }
    }

    if (design?.features?.facadeBand === true) {
      for (const piece of storey.wallPieces || []) {
        if (!piece.exterior) continue;
        const band = createWallMesh({
          THREE,
          start: piece.start,
          end: piece.end,
          height: 0.10,
          thickness: runtime.wallThicknessMeters + 0.018,
          zBase: zBase + Math.min(runtime.wallHeightMeters - 0.35, 2.55),
          material: accentMaterial,
        });
        if (!band) continue;
        band.userData = { ventraType: "design_facade_band", aiGeneratedDesign: true };
        viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY, band);
        facadeBandCount += 1;
      }
    }
  }

  viewer.impl.invalidate(true, true, true);

  return {
    floorFinishCount,
    ceilingCount,
    baseboardCount,
    facadeBandCount,
    style: design?.style || "custom",
  };
}



const VENTRA_DESIGN_FETCH_TIMEOUT_MS = 25000;

function ventraLocalDesignFromPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  const design = {
    style: "modern neutral",
    palette: {
      interiorWall: "#E7E1D8", facade: "#D8D0C3", floor: "#C9B89F",
      ceiling: "#F5F2EA", door: "#6E4A32", glass: "#7896AA", accent: "#403D39",
    },
    floorFinish: "warm stone", facadeFinish: "smooth mineral finish",
    wallShininess: 18, facadeShininess: 12, floorShininess: 28, glassOpacity: 0.48,
    features: { floorFinish: true, baseboards: true, ceiling: false, facadeBand: false },
  };

  if (/(luxury|luxurious|لوکس)/i.test(text)) {
    design.style = "modern luxury";
    design.palette.interiorWall = "#EEE6D8";
    design.palette.floor = "#D6C5AA";
    design.palette.door = "#5C3C2B";
    design.palette.accent = "#2E2B28";
    design.floorFinish = "beige marble";
    design.facadeFinish = "light stone cladding";
    design.floorShininess = 52;
  }
  if (/(minimal|scandinav|مینیمال|اسکاند)/i.test(text)) {
    design.style = "warm minimal";
    design.palette.interiorWall = "#E9E5DC";
    design.palette.floor = "#C9A97D";
    design.palette.door = "#9A7654";
    design.floorFinish = "natural oak";
    design.floorShininess = 14;
  }
  if (/(black|charcoal|مشکی|ذغالی)/i.test(text)) design.palette.accent = "#25282B";
  if (/(white|سفید)/i.test(text)) design.palette.interiorWall = "#F2F1EC";
  if (/(wood|walnut|oak|چوب|گردو)/i.test(text)) design.palette.door = "#66452F";
  if (/(stone|limestone|travertine|سنگ|تراورتن)/i.test(text)) {
    design.palette.facade = "#D6CABB";
    design.facadeFinish = "natural stone";
  }
  if (/(marble|مرمر|ماربل)/i.test(text)) {
    design.palette.floor = "#D8D0C5";
    design.floorFinish = "marble";
    design.floorShininess = 58;
  }
  if (/(ceiling|سقف)/i.test(text)) design.features.ceiling = true;
  if (/(band|facade accent|فریم نما|خط افقی)/i.test(text)) design.features.facadeBand = true;
  return design;
}

function ventraLocalEditSchematicScene(scene, prompt) {
  const next = JSON.parse(JSON.stringify(scene || {}));
  next.assets = Array.isArray(next.assets) ? next.assets : [];
  next.palette = next.palette || {};
  const text = String(prompt || "").toLowerCase();
  const hasType = (type) => next.assets.some((item) => item?.type === type);
  const add = (asset) => { if (!hasType(asset.type)) next.assets.push(asset); };

  if (/(bathtub|bath tub|وان)/i.test(text)) add({ type: "bathtub", x: 0.72, y: 0.72, width: 1.7, depth: 0.75, height: 0.58, rotation: 0 });
  if (/(sink|vanity|روشویی)/i.test(text)) add({ type: "sink", x: 0.22, y: 0.28, width: 0.8, depth: 0.5, height: 0.85, rotation: 0 });
  if (/(faucet|شیر آب|شیرآلات)/i.test(text)) add({ type: "faucet", x: 0.22, y: 0.28, width: 0.15, depth: 0.15, height: 0.35, rotation: 0 });
  if (/(shower|دوش)/i.test(text)) add({ type: "shower", x: 0.82, y: 0.22, width: 0.95, depth: 0.95, height: 2.1, rotation: 0 });
  if (/(toilet|wc|توالت)/i.test(text)) add({ type: "toilet", x: 0.35, y: 0.72, width: 0.7, depth: 0.8, height: 0.78, rotation: 0 });
  if (/(sofa|couch|مبل)/i.test(text)) add({ type: "sofa", x: 0.5, y: 0.7, width: 2.2, depth: 0.9, height: 0.85, rotation: 0 });
  if (/(armchair|صندلی راحتی)/i.test(text)) add({ type: "armchair", x: 0.22, y: 0.62, width: 0.85, depth: 0.85, height: 0.9, rotation: 15 });
  if (/(coffee table|میز جلو مبلی)/i.test(text)) add({ type: "coffee_table", x: 0.5, y: 0.5, width: 1.1, depth: 0.65, height: 0.42, rotation: 0 });
  if (/(bed|تخت)/i.test(text)) add({ type: "bed", x: 0.5, y: 0.62, width: 1.8, depth: 2.0, height: 0.55, rotation: 0 });
  if (/(wardrobe|closet|کمد)/i.test(text)) add({ type: "wardrobe", x: 0.82, y: 0.5, width: 1.6, depth: 0.6, height: 2.2, rotation: 90 });
  if (/(tv|تلویزیون)/i.test(text)) add({ type: "tv_unit", x: 0.5, y: 0.14, width: 1.8, depth: 0.35, height: 0.65, rotation: 0 });
  if (/(island|جزیره)/i.test(text)) add({ type: "kitchen_island", x: 0.5, y: 0.5, width: 1.8, depth: 0.9, height: 0.92, rotation: 0 });

  // Schematic style presets must mutate the scene palette itself. The standalone
  // JPG renderer reads scene.palette directly, so changing only Design Mode state
  // would make the preset buttons appear to do nothing.
  if (/(modern luxury|luxury|luxurious|لوکس)/i.test(text)) {
    next.style = "modern_luxury";
    next.palette.wall = "#EFE5D6";
    next.palette.floor = "#D8C8B2";
    next.palette.accent = "#8B6F58";
    next.palette.glass = "#A8C5D6";
    next.palette.door = "#6B4935";
    next.palette.metal = "#A38E78";
    next.palette.furniture = "#B79B83";
  }
  if (/(warm minimal|minimal|scandinav|مینیمال|اسکاند)/i.test(text)) {
    next.style = "warm_minimal";
    next.palette.wall = "#EEEAE2";
    next.palette.floor = "#C9B18C";
    next.palette.accent = "#9A8068";
    next.palette.glass = "#B6CED8";
    next.palette.door = "#A37B55";
    next.palette.metal = "#9C9388";
    next.palette.furniture = "#B79C7D";
  }
  if (/(facade concept|contemporary exterior|facade|exterior|نما)/i.test(text)) {
    next.style = "facade_concept";
    next.palette.wall = next.palette.wall || "#E9E4DB";
    next.palette.floor = next.palette.floor || "#CFC1AB";
    next.palette.accent = "#6C7277";
    next.palette.glass = "#7897AA";
    next.palette.door = "#4F4740";
    next.palette.metal = "#73787C";
    next.palette.furniture = "#8B8179";
  }

  if (/(white|سفید)/i.test(text)) next.palette.wall = "#F2F1EC";
  if (/(black|charcoal|مشکی|ذغالی)/i.test(text)) next.palette.accent = "#565A5E";
  if (/(warm|گرم)/i.test(text) && !/(minimal|luxury|لوکس)/i.test(text)) next.palette.wall = "#E8DFD0";
  if (/(marble|مرمر|ماربل)/i.test(text)) next.palette.floor = "#DDD3C5";
  if (/(oak|natural oak|بلوط)/i.test(text)) next.palette.floor = "#C6A77D";
  if (/(walnut|گردو)/i.test(text)) next.palette.door = "#684A38";

  next.updatedAt = new Date().toISOString();
  return next;
}


const VENTRA_SCHEMATIC_ASSET_DEFAULTS = {
  sofa: { width: 2.35, depth: 0.95, height: 0.88 },
  armchair: { width: 0.9, depth: 0.9, height: 0.92 },
  coffee_table: { width: 1.15, depth: 0.65, height: 0.42 },
  dining_table: { width: 1.8, depth: 0.95, height: 0.76 },
  desk: { width: 1.35, depth: 0.65, height: 0.76 },
  chair: { width: 0.48, depth: 0.52, height: 0.9 },
  bed: { width: 1.8, depth: 2.05, height: 0.62 },
  wardrobe: { width: 1.8, depth: 0.62, height: 2.25 },
  cabinet: { width: 1.2, depth: 0.55, height: 0.9 },
  tv_unit: { width: 1.9, depth: 0.38, height: 0.62 },
  kitchen_counter: { width: 2.2, depth: 0.65, height: 0.92 },
  rug: { width: 2.2, depth: 1.6, height: 0.025 },
  plant: { width: 0.45, depth: 0.45, height: 0.9 },
  kitchen_island: { width: 1.9, depth: 0.95, height: 0.92 },
  nightstand: { width: 0.5, depth: 0.45, height: 0.5 },
  bathtub: { width: 1.75, depth: 0.78, height: 0.58 },
  sink: { width: 0.82, depth: 0.52, height: 0.86 },
  faucet: { width: 0.18, depth: 0.18, height: 0.38 },
  shower: { width: 0.95, depth: 0.95, height: 2.1 },
  toilet: { width: 0.72, depth: 0.82, height: 0.78 },
  refrigerator: { width: 0.85, depth: 0.75, height: 1.85 },
  stove: { width: 0.70, depth: 0.65, height: 0.90 },
  washing_machine: { width: 0.65, depth: 0.65, height: 0.88 },
  mirror: { width: 0.75, depth: 0.04, height: 1.10 },
};

function ventraSchematicPresetFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/(modern luxury|luxury|luxurious|لوکس)/i.test(text)) return "luxury";
  if (/(warm minimal|minimal|scandinav|مینیمال|اسکاند)/i.test(text)) return "minimal";
  if (/(modern|contemporary|مدرن)/i.test(text)) return "modern";
  if (/(facade|exterior|نما)/i.test(text)) return "facade";
  return null;
}


function ventraHasMetricAssetPlacement(asset) {
  return asset?.xMeters != null && asset?.yMeters != null &&
    Number.isFinite(Number(asset.xMeters)) && Number.isFinite(Number(asset.yMeters));
}

function ventraApplySchematicPreset(scene, presetId) {
  const next = JSON.parse(JSON.stringify(scene || {}));
  next.assets = Array.isArray(next.assets) ? next.assets : [];
  next.palette = next.palette || {};

  const definitions = {
    typical: { scale: 1.00, style: 'typical_modern' },
    modern: { scale: 1.00, style: 'modern' },
    minimal: { scale: 0.97, style: 'warm_minimal' },
    luxury: { scale: 1.04, style: 'modern_luxury' },
    facade: { scale: 1.00, style: 'facade_concept' },
  };

  const normalizedId = presetId === 'classic' ? 'typical' : presetId;
  const definition = ventraGetSchematicPresetDefinition(normalizedId);
  const meta = definitions[normalizedId] || definitions.modern;

  next.style = definition.style || meta.style;
  next.backgroundColor = definition.backgroundColor || next.backgroundColor;
  next.palette = { ...next.palette, ...(definition.palette || {}) };

  const scale = meta.scale || 1;

  next.assets = next.assets.map((asset) => {
    if (!asset || typeof asset !== 'object') return asset;
    if (ventraHasMetricAssetPlacement(asset)) return { ...asset, variant: normalizedId };
    return {
      ...asset,
      width: Math.max(0.15, Number(asset.width || 0.8) * scale),
      depth: Math.max(0.15, Number(asset.depth || 0.8) * scale),
      height: Math.max(0.10, Number(asset.height || 0.8) * (normalizedId === 'luxury' ? 1.02 : 1)),
      variant: normalizedId,
    };
  });

  next.updatedAt = new Date().toISOString();
  return next;
}

function ventraCloneScene(scene) {
  return scene ? JSON.parse(JSON.stringify(scene)) : null;
}


function ventraGetSchematicPresetDefinition(presetId) {
  const presets = {
    typical: {
      style: 'typical_modern',
      backgroundColor: '#23262B',
      palette: {
        wall: '#E9E6DF',
        floor: '#DDD7CF',
        accent: '#6E6257',
        glass: '#94B4C5',
        door: '#7A5A42',
        metal: '#6E7378',
        furniture: '#B08C6C',
        upholstery: '#DDD4C8',
        textileAccent: '#8D9A74',
        bathroomTile: '#F2F3F1',
        bedroomWood: '#C89E70',
        mainStone: '#E5E1DA',
      },
    },
    modern: {
      style: 'modern',
      backgroundColor: '#1E2228',
      palette: {
        wall: '#ECEAE5',
        floor: '#E3DED6',
        accent: '#394149',
        glass: '#8FAFC0',
        door: '#6D4E38',
        metal: '#4E5962',
        furniture: '#A97C57',
        upholstery: '#D8D2C8',
        textileAccent: '#7D8F71',
        bathroomTile: '#F6F7F5',
        bedroomWood: '#C89563',
        mainStone: '#E7E3DD',
      },
    },
    minimal: {
      style: 'warm_minimal',
      backgroundColor: '#22201D',
      palette: {
        wall: '#F1EDE5',
        floor: '#E6E0D7',
        accent: '#A47F5B',
        glass: '#B7CDD8',
        door: '#9A744F',
        metal: '#8A8882',
        furniture: '#B89069',
        upholstery: '#E6DDD0',
        textileAccent: '#9AA486',
        bathroomTile: '#FAFAF8',
        bedroomWood: '#CDA57B',
        mainStone: '#EAE5DD',
      },
    },
    luxury: {
      style: 'modern_luxury',
      backgroundColor: '#1F1B18',
      palette: {
        wall: '#F1E8DB',
        floor: '#DDD3C7',
        accent: '#6E5140',
        glass: '#A5BDCA',
        door: '#5A3C2A',
        metal: '#9E8467',
        furniture: '#B68963',
        upholstery: '#DDD2C7',
        textileAccent: '#88916D',
        bathroomTile: '#F4F4F1',
        bedroomWood: '#BB8A58',
        mainStone: '#E4DED4',
      },
    },
    facade: {
      style: 'facade_concept',
      backgroundColor: '#23272E',
      palette: {
        wall: '#E7E1D7',
        floor: '#CEC2B0',
        accent: '#626970',
        glass: '#7898AA',
        door: '#4D4640',
        metal: '#6D7479',
        furniture: '#948A82',
        upholstery: '#D7D1C8',
        textileAccent: '#8D987B',
        bathroomTile: '#ECEDEA',
        bedroomWood: '#C59A72',
        mainStone: '#D9D1C4',
      },
    },
  };

  if (presetId === 'classic') return presets.typical;
  return presets[presetId] || presets.modern;
}

function ventraSuggestAssetPlacement(asset, index = 0, presetId = 'modern') {
  const type = String(asset?.type || '').toLowerCase();
  const living = {
    sofa: { x: 0.34, y: 0.57, rotation: 0 },
    armchair: [
      { x: 0.24, y: 0.38, rotation: 28 },
      { x: 0.47, y: 0.37, rotation: -28 },
    ],
    coffee_table: { x: 0.35, y: 0.43, rotation: 0 },
    tv_unit: { x: 0.35, y: 0.17, rotation: 0 },
  };
  const dining = {
    dining_table: { x: 0.68, y: 0.48, rotation: 0 },
    chair: [
      { x: 0.61, y: 0.38, rotation: 0 },
      { x: 0.75, y: 0.38, rotation: 0 },
      { x: 0.61, y: 0.58, rotation: 180 },
      { x: 0.75, y: 0.58, rotation: 180 },
      { x: 0.56, y: 0.48, rotation: 90 },
      { x: 0.80, y: 0.48, rotation: -90 },
    ],
  };
  const bedroom = {
    bed: [
      { x: 0.30, y: 0.76, rotation: 0 },
      { x: 0.73, y: 0.77, rotation: 0 },
    ],
    nightstand: [
      { x: 0.18, y: 0.76, rotation: 0 },
      { x: 0.42, y: 0.76, rotation: 0 },
      { x: 0.61, y: 0.77, rotation: 0 },
      { x: 0.85, y: 0.77, rotation: 0 },
    ],
    wardrobe: [
      { x: 0.12, y: 0.56, rotation: 90 },
      { x: 0.90, y: 0.56, rotation: 90 },
    ],
  };
  const service = {
    kitchen_counter: [
      { x: 0.84, y: 0.18, rotation: 0 },
      { x: 0.84, y: 0.30, rotation: 0 },
    ],
    kitchen_island: { x: 0.67, y: 0.22, rotation: 0 },
    bathtub: { x: 0.16, y: 0.22, rotation: 90 },
    sink: { x: 0.14, y: 0.40, rotation: 90 },
    faucet: { x: 0.14, y: 0.42, rotation: 90 },
    shower: { x: 0.09, y: 0.12, rotation: 0 },
    toilet: { x: 0.25, y: 0.15, rotation: 90 },
    desk: { x: 0.84, y: 0.74, rotation: 180 },
    cabinet: { x: 0.88, y: 0.84, rotation: 90 },
  };

  const fetchEntry = (entry) => Array.isArray(entry) ? entry[index % entry.length] : entry;
  const found = fetchEntry(living[type]) || fetchEntry(dining[type]) || fetchEntry(bedroom[type]) || fetchEntry(service[type]);
  if (!found) return null;

  const styleOffset = presetId === 'luxury'
    ? { x: 0.01, y: 0.01 }
    : presetId === 'minimal'
      ? { x: -0.01, y: 0 }
      : presetId === 'modern'
        ? { x: 0, y: -0.01 }
        : { x: 0, y: 0 };

  return {
    x: Math.max(0.07, Math.min(0.93, Number(found.x) + styleOffset.x)),
    y: Math.max(0.07, Math.min(0.93, Number(found.y) + styleOffset.y)),
    rotation: Number(found.rotation || 0),
  };
}

function ventraRestyleSchematicScene(baseScene, presetId = 'modern') {
  const startingScene = ventraCloneScene(baseScene) || {};
  let next = presetId === 'classic'
    ? startingScene
    : ventraApplySchematicPreset(startingScene, presetId);

  const preset = ventraGetSchematicPresetDefinition(presetId);
  next.style = preset.style;
  next.backgroundColor = next.sceneType === 'floorplan_interactive_preview' ? '#D5D7DA' : preset.backgroundColor;
  next.palette = { ...(next.palette || {}), ...(preset.palette || {}) };
  next.assets = Array.isArray(next.assets) ? next.assets : [];

  const counts = {};
  next.assets = next.assets.map((asset) => {
    if (!asset || typeof asset !== 'object') return asset;
    const type = String(asset.type || '').toLowerCase();
    const index = counts[type] || 0;
    counts[type] = index + 1;
    const placed = ventraSuggestAssetPlacement(asset, index, presetId);
    const styled = { ...asset };
    const metricPlacement = ventraHasMetricAssetPlacement(asset);
    if (placed && presetId !== 'classic' && !metricPlacement) {
      styled.x = placed.x;
      styled.y = placed.y;
      styled.rotation = placed.rotation;
    }
    if (!metricPlacement && presetId === 'minimal') {
      styled.width = Math.max(0.15, Number(styled.width || 0.8) * 0.94);
      styled.depth = Math.max(0.15, Number(styled.depth || 0.8) * 0.94);
    } else if (!metricPlacement && presetId === 'luxury') {
      styled.width = Math.max(0.15, Number(styled.width || 0.8) * 1.06);
      styled.depth = Math.max(0.15, Number(styled.depth || 0.8) * 1.04);
    }
    styled.variant = presetId;
    return styled;
  });

  next.updatedAt = new Date().toISOString();
  return applySceneStyle(next,presetId);
}

async function ventraFetchJson(url, options = {}, timeoutMs = VENTRA_DESIGN_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {
      throw new Error(`API returned HTTP ${response.status} with a non-JSON response.`);
    }
    if (!response.ok) throw new Error(payload?.error || `API request failed (${response.status}).`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
function applyDwgInteriorMaterials(reconstruction) {
  const runtime = reconstruction?._runtime;
  if (!runtime) throw new Error("Reconstruct the calibrated DWG first.");
  const finishes = {
    interiorWallMaterial: [0xE8E2D9, 3],
    exteriorWallMaterial: [0x474A4D, 8],
    floorMaterial: [0xDDD4C6, 10],
    doorMaterial: [0x7B573E, 9],
    windowMaterial: [0x7896AA, 55],
  };
  if (!runtime.interiorMaterialSnapshot) {
    runtime.interiorMaterialSnapshot = Object.fromEntries(Object.keys(finishes).map(key => {
      const m = runtime[key];
      return [key, m ? {color:m.color?.getHex?.(),shininess:m.shininess,opacity:m.opacity,transparent:m.transparent} : null];
    }));
  }
  for (const [key,[color,shininess]] of Object.entries(finishes)) {
    const m=runtime[key]; if(!m)continue;
    m.color?.setHex?.(color); m.shininess=shininess;
    if(key==='windowMaterial'){m.transparent=true;m.opacity=0.34;}
    m.needsUpdate=true;
  }
}

function restoreDwgInteriorMaterials(reconstruction) {
  const runtime=reconstruction?._runtime, snapshot=runtime?.interiorMaterialSnapshot;
  if(!snapshot)return false;
  for(const [key,value] of Object.entries(snapshot)){
    const m=runtime[key];if(!m||!value)continue;
    if(value.color!==undefined)m.color?.setHex?.(value.color);
    for(const property of ['shininess','opacity','transparent'])m[property]=value[property];
    m.needsUpdate=true;
  }
  delete runtime.interiorMaterialSnapshot;
  return true;
}

function resetDesignMaterials(reconstruction) {
  if (restoreDwgInteriorMaterials(reconstruction)) return;
  const runtime = reconstruction?._runtime;
  if (!runtime) return;
  setMaterialDesign(runtime.interiorWallMaterial, "#d8d8d8", 0xd8d8d8, 22);
  setMaterialDesign(runtime.exteriorWallMaterial, "#d8d8d8", 0xd8d8d8, 22);
  setMaterialDesign(runtime.doorMaterial, "#8b5a2b", 0x8b5a2b, 30);
  setMaterialDesign(runtime.windowMaterial, "#85c8ff", 0x85c8ff, 80);
  if (runtime.windowMaterial) {
    runtime.windowMaterial.opacity = 0.58;
    runtime.windowMaterial.transparent = true;
    runtime.windowMaterial.needsUpdate = true;
  }
}

function buildDwgInteriorRuntime(takeoff){
  const {geometry:sourceGeometry,meterFactor}=resolveDwgCalibration(takeoff||{});
  let geometry=sourceGeometry;
  if(!Number.isFinite(meterFactor)||meterFactor<=0)throw new Error('Saved DWG calibration is missing.');
  let lines=geometry.wallLineSegments||[];
  if(!lines.length){const ids=new Set(getLegacyObjectList(takeoff,'walls').map(o=>String(o.dbId)));lines=(geometry.lineSegments||[]).filter(l=>ids.has(String(l.dbId)));}
  const records=takeoff.drawing_evidence?.records||takeoff.advanced_takeoff?.drawing_evidence?.records||[];
  const labels=geometry.roomLabelEvidence?.length?geometry.roomLabelEvidence:collectInteriorRoomLabels([...records,...getLegacyObjectList(takeoff,'rooms')],geometry.objectGeometryCentroids||{});
  const roomRecovery=recoverInteriorRoomBoundaries({wallLines:lines,openingLines:[...getVerifiedLinesByType(takeoff,geometry,'door').lines,...getVerifiedLinesByType(takeoff,geometry,'window').lines],meterFactor,labels});
  if(roomRecovery.rooms.length&&labels.length)geometry={...geometry,roomPolygons:roomRecovery.rooms,interiorRoomRecovery:{version:82,labelCount:labels.length,portalCount:roomRecovery.closures.length,unmatchedLabels:roomRecovery.unmatchedLabels.map(l=>l.name)}};
  const candidates=splitWallLinesIntoStoreys(lines,meterFactor);
  const storeyFrames=candidates.map(s=>({...s,sourceRegionIndex:s.index,frame:getStoreyFrame(s.lines,meterFactor)}));
  if(!storeyFrames.length||storeyFrames.some(s=>!s.frame))throw new Error('Saved calibrated DWG wall geometry is unavailable.');
  const storeys=storeyFrames.map(s=>({index:s.index,hull:convexHull2D(s.lines.flatMap(l=>[toStoreyLocalMeters(l.start,s.frame,meterFactor),toStoreyLocalMeters(l.end,s.frame,meterFactor)]).filter(Boolean))}));
  const openings=type=>{
    const groups=new Map(groupLinesByDbId(getVerifiedLinesByType(takeoff,geometry,type).lines).map(g=>[String(g.dbId),g]));
    const count=type==='door'?takeoff.doors:takeoff.windows;
    const result=[],seen=new Set();
    for(const object of uniqueOpeningObjects(getLegacyObjectList(takeoff,type==='door'?'doors':'windows'),count)){
      const opening=snapOpeningObjectToWall({object,type,storeyFrames,meterFactor,fallbackGroup:groups.get(String(object.dbId))});
      if(!opening.valid)continue;
      const key=`${opening.storey.index}:${opening.dbId}`;if(seen.has(key))continue;seen.add(key);
      result.push({...opening,type,sillHeight:type==='door'?0:.9});
    }
    return result;
  };
  return {geometry,meterFactor,regionCount:candidates.length,storeyFrames,storeys,doors:openings('door'),windows:openings('window'),semanticRooms:takeoff.object_details?.rooms||takeoff.advanced_takeoff?.object_details?.rooms||[],wallThicknessMeters:.15};
}

function buildReconstructionOverlay({
  viewer,
  takeoff,
  wallHeightMeters = 3.2,
  wallThicknessMeters = 0.15,
  regionIndex = null,
}) {
  const THREE = getThree();

  if (
    !viewer ||
    !THREE?.Mesh ||
    !THREE?.BoxGeometry
  ) {
    throw new Error(
      "Autodesk THREE runtime is unavailable."
    );
  }

  const {geometry,meterFactor,unitName,source:calibrationSource}=resolveDwgCalibration(takeoff||{});
  if(!Number.isFinite(meterFactor)||meterFactor<=0)throw new Error('DWG calibration is unavailable. Complete geometry extraction in Drawings.');
  console.log('[VENTRA DWG CALIBRATION RESOLVER]',{meterFactor,source:calibrationSource,modelUnit:unitName||null});

  let wallLines =
    Array.isArray(
      geometry
        ?.wallLineSegments
    )
      ? geometry
          .wallLineSegments
      : [];

  let wallLineSource =
    wallLines.length > 0
      ? "saved_verified_wall_segments"
      : "unavailable";

  // v42.1 backward compatibility:
  // Older saved takeoffs already contain all APS line segments plus the
  // dbIds of objects classified as walls. Reconstruct verified wall segments
  // from those two existing datasets instead of forcing a full re-analysis.
  if (wallLines.length === 0) {
    const allLines =
      Array.isArray(
        geometry?.lineSegments
      )
        ? geometry.lineSegments
        : [];

    const wallObjects =
      Array.isArray(
        takeoff
          ?.object_details
          ?.walls
      )
        ? takeoff
            .object_details
            .walls
        : Array.isArray(
            takeoff
              ?.advanced_takeoff
              ?.object_details
              ?.walls
          )
          ? takeoff
              .advanced_takeoff
              .object_details
              .walls
          : [];

    const wallDbIds =
      new Set(
        wallObjects
          .map(
            (item) =>
              item?.dbId
          )
          .filter(
            (value) =>
              value !== null &&
              value !== undefined
          )
          .map(String)
      );

    if (
      allLines.length > 0 &&
      wallDbIds.size > 0
    ) {
      wallLines =
        allLines.filter(
          (line) =>
            wallDbIds.has(
              String(
                line?.dbId
              )
            )
        );

      if (wallLines.length > 0) {
        wallLineSource =
          "legacy_line_segments_plus_verified_wall_dbids";
      }
    }
  }

  if (wallLines.length === 0) {
    throw new Error(
      "Verified wall centerlines are unavailable in the saved takeoff. Open Drawings and run Analyze Drawing once."
    );
  }

  const doorData =
    getVerifiedLinesByType(
      takeoff,
      geometry,
      "door"
    );

  const windowData =
    getVerifiedLinesByType(
      takeoff,
      geometry,
      "window"
    );

  const doorLines =
    doorData.lines;

  const windowLines =
    windowData.lines;

  clearReconstruction(viewer);

  viewer.impl.createOverlayScene(
    VENTRA_RECON_OVERLAY
  );

  const reconstructionBounds =
    new THREE.Box3();
  let hasReconstructionBounds =
    false;

  const candidates = splitWallLinesIntoStoreys(wallLines,meterFactor);
  if(regionIndex !== null && !candidates[regionIndex])throw new Error("Select an available drawing region.");
  const storeys = (regionIndex === null ? candidates : [candidates[regionIndex]]).map((s,i)=>({...s,index:i,sourceRegionIndex:s.index}));

  const storeyHeightMeters =
    Math.max(
      wallHeightMeters +
        0.25,
      3.25
    );

  const storeyFrames =
    storeys.map(
      (storey) => ({
        ...storey,
        frame:
          getStoreyFrame(
            storey.lines,
            meterFactor
          ),
      })
    );

  if (
    storeyFrames.some(
      (storey) =>
        !storey.frame
    )
  ) {
    throw new Error(
      "Unable to calculate one or more storey coordinate frames."
    );
  }

  const geometryFrame = {
    widthMeters:
      Math.max(
        ...storeyFrames.map(
          (storey) =>
            storey.frame
              .widthMeters
        )
      ),
    depthMeters:
      Math.max(
        ...storeyFrames.map(
          (storey) =>
            storey.frame
              .depthMeters
        )
      ),
    storeyCount:
      storeyFrames.length,
    splitAxis:
      storeyFrames[0]
        ?.axis ||
      "none",
    splitGapMeters:
      storeyFrames[0]
        ?.splitGapMeters ||
      0,
  };

  const wallHeight =
    wallHeightMeters;

  const wallThickness =
    wallThicknessMeters;

  const createWallMaterial = () =>
    new THREE.MeshPhongMaterial({
      color: 0xd8d8d8,
      // Solid wall pieces stay opaque/front-side to avoid transparent seam
      // artifacts at adjacent BoxGeometry boundaries.
      transparent: false,
      opacity: 1,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
      shininess: 22,
    });

  const interiorWallMaterial = createWallMaterial();
  const exteriorWallMaterial = createWallMaterial();

  const storeyHullByIndex = new Map(
    storeyFrames.map((storey) => {
      const points = [];
      for (const line of storey.lines || []) {
        const a = toStoreyLocalMeters(line?.start, storey.frame, meterFactor);
        const b = toStoreyLocalMeters(line?.end, storey.frame, meterFactor);
        if (a) points.push(a);
        if (b) points.push(b);
      }
      return [storey.index, convexHull2D(points)];
    })
  );

  const exteriorWallKeysByStorey = new Map(
    storeyFrames.map((storey) => {
      const hull = storeyHullByIndex.get(storey.index) || [];
      const keys = new Set();
      for (const line of storey.lines || []) {
        const a = toStoreyLocalMeters(line?.start, storey.frame, meterFactor);
        const b = toStoreyLocalMeters(line?.end, storey.frame, meterFactor);
        if (a && b && isExteriorWallSegment(a, b, hull)) {
          keys.add(normalizedWallKey(line));
        }
      }
      return [storey.index, keys];
    })
  );

  const floorMaterial =
    new THREE.MeshPhongMaterial({
      color: 0xb8c2d3,
      transparent: true,
      opacity: 0.52,
      side:
        THREE.DoubleSide,
    });

  const doorMaterial =
    new THREE.MeshPhongMaterial({
      color: 0x8b5a2b,
      transparent: true,
      opacity: 0.95,
      side:
        THREE.DoubleSide,
    });

  const windowMaterial =
    new THREE.MeshPhongMaterial({
      color: 0x85c8ff,
      transparent: true,
      opacity: 0.58,
      side:
        THREE.DoubleSide,
    });

  let wallCount = 0;
  let wallPieceCount = 0;
  let wallOpeningCutCount = 0;

  const doorGroupsForCuts = groupLinesByDbId(doorLines);
  const windowGroupsForCuts = groupLinesByDbId(windowLines);
  const doorGroupMapForCuts = new Map(doorGroupsForCuts.map((group)=>[String(group.dbId),group]));
  const windowGroupMapForCuts = new Map(windowGroupsForCuts.map((group)=>[String(group.dbId),group]));

  const authoritativeDoorObjects = uniqueOpeningObjects(getLegacyObjectList(takeoff,"doors"), takeoff?.doors);
  const authoritativeWindowObjects = uniqueOpeningObjects(getLegacyObjectList(takeoff,"windows"), takeoff?.windows);

  const snappedDoorOpenings = [];
  const snappedWindowOpenings = [];

  for (const object of authoritativeDoorObjects) {
    const snapped = snapOpeningObjectToWall({
      object,
      type: "door",
      storeyFrames,
      meterFactor,
      fallbackGroup: doorGroupMapForCuts.get(String(object?.dbId ?? "")),
    });
    if (snapped?.valid) snappedDoorOpenings.push({...snapped,type:"door",sillHeight:0});
  }

  for (const object of authoritativeWindowObjects) {
    const snapped = snapOpeningObjectToWall({
      object,
      type: "window",
      storeyFrames,
      meterFactor,
      fallbackGroup: windowGroupMapForCuts.get(String(object?.dbId ?? "")),
    });
    if (snapped?.valid) snappedWindowOpenings.push({...snapped,type:"window",sillHeight:0.90});
  }

  function dedupeSnappedOpenings(openings) {
    const seen=new Set();
    const result=[];
    for (const opening of openings || []) {
      const key=(opening?.dbId!==null&&opening?.dbId!==undefined)
        ? `db:${String(opening.dbId)}`
        : opening?.wallPosition
          ? `xy:${Number(opening.wallPosition.x).toFixed(4)}:${Number(opening.wallPosition.y).toFixed(4)}:${opening?.type||""}`
          : null;
      if (!key || seen.has(key)) continue;

      const duplicatePhysicalOpening=result.some((existing)=>{
        if (existing?.type!==opening?.type) return false;
        if (existing?.storey?.index!==opening?.storey?.index) return false;
        if (!existing?.parentWallKey || existing.parentWallKey!==opening?.parentWallKey) return false;
        if (!existing?.wallPosition || !opening?.wallPosition) return false;
        return Math.hypot(
          existing.wallPosition.x-opening.wallPosition.x,
          existing.wallPosition.y-opening.wallPosition.y
        ) <= 0.06;
      });
      if (duplicatePhysicalOpening) continue;

      seen.add(key);
      result.push(opening);
    }
    return result;
  }

  const uniqueSnappedDoorOpenings=dedupeSnappedOpenings(snappedDoorOpenings);
  const uniqueSnappedWindowOpenings=dedupeSnappedOpenings(snappedWindowOpenings);
  const allSnappedOpenings=[...uniqueSnappedDoorOpenings,...uniqueSnappedWindowOpenings];
  const designStoreys = storeyFrames.map((storey) => ({
    index: storey.index,
    hull: storeyHullByIndex.get(storey.index) || [],
    wallPieces: [],
  }));

  for (const storey of storeyFrames) {
    const zBase=storey.index*storeyHeightMeters;
    const storeyOpenings=allSnappedOpenings.filter((opening)=>opening?.storey?.index===storey.index);

    for (const line of storey.lines) {
      const localStart=toStoreyLocalMeters(line?.start,storey.frame,meterFactor);
      const localEnd=toStoreyLocalMeters(line?.end,storey.frame,meterFactor);
      if (!localStart || !localEnd) continue;

      const currentWallKey=normalizedWallKey(line);
      const relevantOpenings=storeyOpenings.filter(
        (opening)=>Boolean(opening?.parentWallKey) && opening.parentWallKey===currentWallKey
      );

      const pieces=splitWallByOpenings({start:localStart,end:localEnd,openings:relevantOpenings});
      const exterior = exteriorWallKeysByStorey.get(storey.index)?.has(currentWallKey) || false;
      const activeWallMaterial = exterior ? exteriorWallMaterial : interiorWallMaterial;
      const designStorey = designStoreys.find((item) => item.index === storey.index);
      for (const piece of pieces) {
        const mesh=createWallMesh({THREE,start:piece.start,end:piece.end,height:wallHeight,thickness:wallThickness,zBase,material:activeWallMaterial});
        if (!mesh) continue;
        mesh.userData={ventraType:exterior?"exterior_wall":"interior_wall",parentWallKey:currentWallKey,storeyIndex:storey.index};
        viewer.impl.addOverlay(VENTRA_RECON_OVERLAY,mesh);
        if (addMeshToBounds(THREE,mesh,reconstructionBounds)) hasReconstructionBounds=true;
        designStorey?.wallPieces.push({start:piece.start,end:piece.end,exterior,parentWallKey:currentWallKey});
        wallPieceCount+=1;
      }
      wallCount+=1;
      wallOpeningCutCount+=relevantOpenings.length;
    }

    for (const opening of storeyOpenings) {
      const openingExterior = exteriorWallKeysByStorey.get(storey.index)?.has(opening?.parentWallKey) || false;
      const openingWallMaterial = openingExterior ? exteriorWallMaterial : interiorWallMaterial;
      const sillMesh=buildWindowSillWallMesh({THREE,opening,thickness:wallThickness,zBase,material:openingWallMaterial});
      if (sillMesh) {
        viewer.impl.addOverlay(VENTRA_RECON_OVERLAY,sillMesh);
        if (addMeshToBounds(THREE,sillMesh,reconstructionBounds)) hasReconstructionBounds=true;
      }
      const headerMesh=buildHeaderWallMesh({THREE,opening,thickness:wallThickness,wallHeight,zBase,material:openingWallMaterial});
      if (headerMesh) {
        viewer.impl.addOverlay(VENTRA_RECON_OVERLAY,headerMesh);
        if (addMeshToBounds(THREE,headerMesh,reconstructionBounds)) hasReconstructionBounds=true;
      }
    }
  }

  // v43: slab surfaces are provisional and derived from each verified wall
  // cluster's convex hull. This avoids the broken raw floor polygons while
  // giving the 3D model a real structural floor plate.
  let floorCount = 0;
  let slabCount = 0;

  for (
    const storey of
    storeyFrames
  ) {
    const zBase =
      storey.index *
      storeyHeightMeters;

    const localPoints = [];

    for (
      const line of
      storey.lines
    ) {
      const a =
        toStoreyLocalMeters(
          line?.start,
          storey.frame,
          meterFactor
        );

      const b =
        toStoreyLocalMeters(
          line?.end,
          storey.frame,
          meterFactor
        );

      if (a) {
        localPoints.push(
          a
        );
      }

      if (b) {
        localPoints.push(
          b
        );
      }
    }

    const slab =
      createSlabMesh({
        THREE,
        points:
          localPoints,
        thickness:
          0.18,
        zBase,
        material:
          floorMaterial,
      });

    if (slab) {
      viewer.impl.addOverlay(
        VENTRA_RECON_OVERLAY,
        slab
      );

      if (
        addMeshToBounds(
          THREE,
          slab,
          reconstructionBounds
        )
      ) {
        hasReconstructionBounds =
          true;
      }

      slabCount += 1;
      floorCount += 1;
    }
  }

  let doorCount = 0;
  let windowCount = 0;
  const rejectedDoorObjects=Math.max(0,authoritativeDoorObjects.length-uniqueSnappedDoorOpenings.length);
  const rejectedWindowObjects=Math.max(0,authoritativeWindowObjects.length-uniqueSnappedWindowOpenings.length);
  const rejectedOpeningReasons={};

  for (const opening of uniqueSnappedDoorOpenings) {
    const marker=createOpeningMarker({THREE,start:opening.start,end:opening.end,widthFallback:opening.width,thickness:0.05,height:opening.height,sillHeight:0,zBase:opening.storey.index*storeyHeightMeters,material:doorMaterial});
    if (!marker) continue;
    marker.userData={ventraType:"door_panel",dbId:opening.dbId,widthMeters:opening.width,heightMeters:opening.height,snapDistanceMeters:opening.snapDistance,source:opening.source,realWallOpening:true};
    viewer.impl.addOverlay(VENTRA_RECON_OVERLAY,marker);
    doorCount+=1;
  }

  for (const opening of uniqueSnappedWindowOpenings) {
    const marker=createOpeningMarker({THREE,start:opening.start,end:opening.end,widthFallback:opening.width,thickness:0.04,height:opening.height,sillHeight:opening.sillHeight,zBase:opening.storey.index*storeyHeightMeters,material:windowMaterial});
    if (!marker) continue;
    marker.userData={ventraType:"window_glazing",dbId:opening.dbId,widthMeters:opening.width,heightMeters:opening.height,sillHeightMeters:opening.sillHeight,snapDistanceMeters:opening.snapDistance,source:opening.source,realWallOpening:true};
    viewer.impl.addOverlay(VENTRA_RECON_OVERLAY,marker);
    windowCount+=1;
  }

  const skippedFloorCount = 0;
  const skippedFloorReasons = {};

  viewer.impl.invalidate(
    true,
    true,
    true
  );

  const serializedBounds =
    hasReconstructionBounds
      ? serializeBox3(
          reconstructionBounds
        )
      : null;

  // Add a neutral reconstruction backdrop inside the Ventra overlay.
  // Autodesk 2D sheets can retain a white paper surface even after model
  // visibility is disabled. This plane visually isolates the 3D building
  // without unloading the source model or touching engineering geometry.
  if (
    hasReconstructionBounds &&
    THREE?.PlaneGeometry &&
    THREE?.MeshBasicMaterial
  ) {
    try {
      const reconCenter =
        reconstructionBounds.getCenter(
          new THREE.Vector3()
        );

      const reconSize =
        reconstructionBounds.getSize(
          new THREE.Vector3()
        );

      const backdropSpan =
        Math.max(
          reconSize.x,
          reconSize.y,
          8
        ) * 7;

      const backdropMaterial =
        new THREE.MeshBasicMaterial({
          color: 0xb7b7b7,
          side: THREE.DoubleSide,
          depthWrite: true,
          depthTest: true,
        });

      const backdrop =
        new THREE.Mesh(
          new THREE.PlaneGeometry(
            backdropSpan,
            backdropSpan
          ),
          backdropMaterial
        );

      backdrop.position.set(
        reconCenter.x,
        reconCenter.y,
        Number(
          reconstructionBounds.min?.z ??
          0
        ) - 0.08
      );

      backdrop.userData = {
        ventraType:
          "reconstruction_backdrop",
        schematic: false,
        selectable: false,
      };

      viewer.impl.addOverlay(
        VENTRA_RECON_OVERLAY,
        backdrop
      );
    } catch (error) {
      console.warn(
        "[VENTRA DWG BACKDROP]",
        error
      );
    }
  }

  const sourceModelState =
    hideAutodeskSourceModel(
      viewer,
      viewer.model
    );

  const sourceModelHidden =
    Boolean(
      sourceModelState?.hidden
    );

  const sourceModelUnloaded =
    Boolean(
      sourceModelState?.unloaded
    );

  const framed =
    frameReconstruction(
      viewer,
      serializedBounds
    );

  try {
    viewer.impl?.invalidate?.(
      true,
      true,
      true
    );
  } catch {}

  console.log(
    "[VENTRA DWG RECONSTRUCTION VISIBILITY]",
    {
      framed,
      hasBounds:
        Boolean(
          serializedBounds
        ),
      sourceModelHidden,
      sourceModelUnloaded,
      bounds: serializedBounds,
    }
  );

  return {
    wallCount,
    wallPieceCount,
    wallOpeningCutCount,
    singleParentWallAssignment:true,
    floorCount,
    slabCount,
    doorCount,
    windowCount,
    rejectedDoorObjects,
    rejectedWindowObjects,
    rawDoorLineCount:
      doorLines.length,
    rawWindowLineCount:
      windowLines.length,
    rawDoorObjectCount:
      authoritativeDoorObjects.length,
    rawWindowObjectCount:
      authoritativeWindowObjects.length,
    expectedDoorCount:
      Number(takeoff?.doors) || 0,
    expectedWindowCount:
      Number(takeoff?.windows) || 0,
    rejectedOpeningReasons,
    doorSource:
      "takeoff_object_details_centroid_wall_snap",
    windowSource:
      "takeoff_object_details_centroid_wall_snap",
    skippedFloorCount,
    skippedFloorReasons,
    wallHeightMeters,
    wallThicknessMeters,
    meterFactor,
    wallLineSource,
    bounds:
      serializedBounds,
    geometryFrame,
    coordinateSpace:
      "local_meters",
    sourceModelHidden,
    sourceModelUnloaded,
    storeyCount:
      storeyFrames.length,
    storeyHeightMeters,
    splitAxis:
      geometryFrame.splitAxis,
    splitGapMeters:
      geometryFrame.splitGapMeters,
    _runtime: {
      interiorWallMaterial,
      exteriorWallMaterial,
      floorMaterial,
      doorMaterial,
      windowMaterial,
      storeys: designStoreys,
      storeyFrames, geometry, meterFactor,
      semanticRooms: takeoff?.object_details?.rooms||takeoff?.advanced_takeoff?.object_details?.rooms||[],
      doors: uniqueSnappedDoorOpenings,
      windows: uniqueSnappedWindowOpenings,
      regionCount: candidates.length,
      wallHeightMeters,
      wallThicknessMeters,
      storeyHeightMeters,
    },
  };
}


function hexNumber(value, fallback = 0xcccccc) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  return fallback;
}

function ventraReadableSchematicColor(value, fallback = 0xcccccc, maxChannel = 224) {
  const color = hexNumber(value, fallback);
  let r = (color >> 16) & 255;
  let g = (color >> 8) & 255;
  let b = color & 255;

  // AI palettes often return pure white (#ffffff), which destroys depth
  // under simple schematic lighting. Preserve the hue but cap near-white
  // materials to a readable architectural ivory/stone range.
  const brightest = Math.max(r, g, b);
  if (brightest > maxChannel) {
    const scale = maxChannel / brightest;
    r = Math.max(0, Math.min(255, Math.round(r * scale)));
    g = Math.max(0, Math.min(255, Math.round(g * scale)));
    b = Math.max(0, Math.min(255, Math.round(b * scale)));
  }

  return (r << 16) | (g << 8) | b;
}

function clearSchematicOverlay(viewer) {
  try {
    const sceneAfter = viewer?.impl?.sceneAfter;
    const previous = sceneAfter?.getObjectByName?.(VENTRA_SCHEMATIC_ROOT_NAME);
    if (previous) {
      sceneAfter.remove(previous);
      previous.traverse?.((object) => {
        try { object.geometry?.dispose?.(); } catch {}
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          try { material?.map?.dispose?.(); } catch {}
          try { material?.dispose?.(); } catch {}
        }
      });
    }
  } catch {}
  try { viewer?.impl?.removeOverlayScene?.(VENTRA_SCHEMATIC_OVERLAY); } catch {}
}


function ventraNormalizeSchematicAssetType(asset) {
  const raw = String(
    asset?.type ||
    asset?.assetType ||
    asset?.name ||
    asset?.label ||
    asset?.description ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  if (!raw) return "generic";

  if (/(sectional|l_shape.*sofa|l_sofa|couch|sofa)/.test(raw)) return "sofa";
  if (/(armchair|lounge_chair|accent_chair)/.test(raw)) return "armchair";
  if (/(double_bed|queen_bed|king_bed|single_bed|bed)/.test(raw)) return "bed";
  if (/(wardrobe|closet|dresser|cupboard)/.test(raw)) return "wardrobe";
  if (/(nightstand|bedside|side_table)/.test(raw)) return "nightstand";
  if (/(coffee_table|center_table|centre_table)/.test(raw)) return "coffee_table";
  if (/(dining_table|dinner_table)/.test(raw)) return "dining_table";
  if (/(office_desk|study_desk|desk)/.test(raw)) return "desk";
  if (/(dining_chair|chair|stool)/.test(raw)) return "chair";
  if (/(tv_unit|tv_console|media_console|television_unit)/.test(raw)) return "tv_unit";
  if (/(kitchen_island|island_counter|island)/.test(raw)) return "kitchen_island";
  if (/(kitchen_counter|base_cabinet|wall_cabinet|kitchen_cabinet|countertop|counter)/.test(raw)) return "kitchen_counter";
  if (/(range_hood|extractor_hood|cooker_hood)/.test(raw)) return "range_hood";
  if (/(rug|carpet)/.test(raw)) return "rug";
  if (/(plant|potted_plant|indoor_plant)/.test(raw)) return "plant";
  if (raw === "cabinet_door") return "cabinet_door";
  if (/(cabinet|storage_unit|shelving|shelf)/.test(raw)) return "cabinet";
  if (/(bathtub|bath_tub|bath)/.test(raw)) return "bathtub";
  if (/(wash_basin|basin|vanity_sink|sink)/.test(raw)) return "sink";
  if (/(faucet|tap|mixer)/.test(raw)) return "faucet";
  if (/(shower_enclosure|shower_cubicle|shower)/.test(raw)) return "shower";
  if (/(toilet|wc|water_closet)/.test(raw)) return "toilet";
  if (/(fridge|refrigerator)/.test(raw)) return "refrigerator";
  if (/(oven|stove|cooker|range)/.test(raw)) return "stove";
  if (/(washing_machine|washer)/.test(raw)) return "washing_machine";
  if (/(mirror)/.test(raw)) return "mirror";

  return raw;
}


const VENTRA_SCHEMATIC_TEXTURE_CACHE = new Map();

function ventraGetPolygonBounds2D(points) {
  const valid = (Array.isArray(points) ? points : []).filter(
    (point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
  );
  if (!valid.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }

  const xs = valid.map((point) => Number(point.x));
  const ys = valid.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0.25, maxX - minX),
    height: Math.max(0.25, maxY - minY),
  };
}

function ventraGetSchematicTexture({ THREE, kind, baseColor, detailColor, accentColor, repeatX = 1, repeatY = 1 }) {
  if (typeof document === 'undefined' || !THREE?.Texture) return null;
  const key = [kind,baseColor,detailColor,accentColor,repeatX,repeatY].join('|');
  const clone = texture => {const result=texture.clone();result.needsUpdate=true;return result;};
  if (VENTRA_SCHEMATIC_TEXTURE_CACHE.has(key)) return clone(VENTRA_SCHEMATIC_TEXTURE_CACHE.get(key));
  try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    ctx.fillStyle=baseColor;ctx.fillRect(0,0,512,512);
    let seed=541;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    if(kind==='doorwood'){
      for(let i=0;i<180;i++){const x=random()*512;ctx.globalAlpha=.035+random()*.07;ctx.strokeStyle=detailColor;ctx.lineWidth=.4+random();ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x+5,170,x-5,340,x,512);ctx.stroke();}
    }else if(kind==='parquet'){
      for(let i=0;i<4;i++){
        ctx.globalAlpha=i%2?.11:.05;ctx.fillStyle=i%2?detailColor:accentColor;ctx.fillRect(i*128,0,128,512);
        for(let j=0;j<42;j++){
          const x=i*128+random()*128;
          ctx.globalAlpha=.04+random()*.09;ctx.strokeStyle=detailColor;ctx.lineWidth=.5+random()*1.5;
          ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x+9,170,x-9,340,x,512);ctx.stroke();
        }
        ctx.globalAlpha=.28;ctx.strokeStyle=detailColor;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(i*128,0);ctx.lineTo(i*128,512);ctx.stroke();
        const cut=i%2?256:0;ctx.beginPath();ctx.moveTo(i*128,cut);ctx.lineTo((i+1)*128,cut);ctx.stroke();
      }
    }else{
      for(let i=0;i<2200;i++){
        ctx.globalAlpha=.015+random()*.04;ctx.fillStyle=random()>.5?detailColor:accentColor;
        ctx.fillRect(random()*512,random()*512,1+random()*3,1+random()*3);
      }
      if(kind==='marble')for(let i=0;i<5;i++){
        const y=i*120;ctx.globalAlpha=.10;ctx.strokeStyle=detailColor;ctx.lineWidth=.7+random()*1.5;
        ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(160,y+90,360,y-60,512,y+30);ctx.stroke();
      }
      ctx.globalAlpha=.25;ctx.strokeStyle=detailColor;ctx.lineWidth=2;ctx.strokeRect(0,0,512,512);
    }
    ctx.globalAlpha=1;
    const texture=new THREE.Texture(canvas);texture.needsUpdate=true;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);
    texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipMapLinearFilter||THREE.LinearMipmapLinearFilter||THREE.LinearFilter;
    texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;
    VENTRA_SCHEMATIC_TEXTURE_CACHE.set(key,texture);return clone(texture);
  }catch{return null;}
}

// World-coordinate UVs keep grain and grout at a metric scale across triangles.
function ventraApplyFloorMaterialUVs(THREE,geometry){
  if(geometry?.vertices&&geometry?.faces&&THREE.Vector2){
    geometry.faceVertexUvs[0]=geometry.faces.map(f=>[f.a,f.b,f.c].map(i=>new THREE.Vector2(geometry.vertices[i].x,geometry.vertices[i].y)));
    geometry.uvsNeedUpdate=true;
  }else if(geometry?.attributes?.position&&THREE.Float32BufferAttribute){
    const p=geometry.attributes.position,uv=[];
    for(let i=0;i<p.count;i++)uv.push(p.getX(i),p.getY(i));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  }
}


function ventraCreateRoomFloorMaterial({ THREE, room, palette = {}, polygon = [] }) {
  const OpaqueMaterial =
    THREE.MeshPhongMaterial ||
    THREE.MeshLambertMaterial ||
    THREE.MeshBasicMaterial;

  const roomType = String(room?.semanticType || room?.type || room?.name || '').toLowerCase();
  const explicitFinish = String(room?.floorFinish || '').toLowerCase();

  let color = 0xDDD4C6;
  let finish = 'large_white_tile';
  let pattern = 'tile';
  let lineColor = 0xC9C3BA;
  let lineOpacity = 0.10;
  let spacingX = 0.95;
  let spacingY = 0.95;

  if (explicitFinish === 'wet_tile' || /(bath|wc|toilet|shower|laundry|wash)/.test(roomType)) {
    color = hexNumber(palette?.bathroomTile, 0xF5F6F4);
    finish = 'white_ceramic';
    pattern = 'tile';
    lineColor = 0xD0D4D6;
    lineOpacity = 0.28;
    spacingX = 0.40;
    spacingY = 0.40;
  } else if (explicitFinish === 'light_oak' || /(bed|bedroom|master|guest)/.test(roomType)) {
    color = 0xBFA484;
    finish = 'warm_oak';
    pattern = 'wood';
    lineColor = 0x9F876C;
    lineOpacity = 0.16;
    spacingX = 0.22;
    spacingY = 1.05;
  } else if (/(store|storage|closet)/.test(roomType)) {
    color = 0xD8D4CC;
    finish = 'utility_tile';
    pattern = 'tile';
    lineColor = 0xBDB7AD;
    lineOpacity = 0.20;
    spacingX = 0.55;
    spacingY = 0.55;
  }

  if(palette.designPreset && !explicitFinish){
    color=hexNumber(/bed/.test(roomType)?palette.bedroomWood:/(bath|wc|toilet|shower|laundry)/.test(roomType)?palette.bathroomTile:palette.mainStone||palette.floor,color);
    if(palette.designPreset==='luxury'&&!/(bath|wc|toilet|shower|laundry)/.test(roomType)){finish='marble';pattern='tile';spacingX=1.2;spacingY=1.2;lineOpacity=.14;}
    else if(palette.designPreset==='minimal'){lineOpacity=.06;spacingX=1.4;spacingY=1.4;}
  }
  const css=hex=>`#${Number(hex).toString(16).padStart(6,'0')}`;
  const wood=pattern==='wood';
  const texture=ventraGetSchematicTexture({THREE,kind:wood?'parquet':finish==='marble'?'marble':'tile',baseColor:css(color),detailColor:css(lineColor),accentColor:'#f1e9da',repeatX:wood?1/.72:1/spacingX,repeatY:wood?1/2.4:1/spacingY});
  const material = new OpaqueMaterial({
    color: texture ? 0xffffff : color,
    ...(texture?{map:texture,bumpMap:texture,bumpScale:wood?.0015:.0007}:{}),
    specular: wood?0x181411:0x282828,
    side: THREE.DoubleSide,
    shininess: palette.designPreset==='luxury'?65:7,
  });

  material.userData = {
    ...(material.userData || {}),
    ventraFloorFinish: finish,
    ventraFloorPattern: pattern,
    ventraFloorLineColor: lineColor,
    ventraFloorLineOpacity: lineOpacity,
    ventraFloorSpacingX: spacingX,
    ventraFloorSpacingY: spacingY,
  };

  return material;
}

function ventraCreateLineGeometry(
  THREE,
  points = []
) {
  const safePoints =
    (Array.isArray(points)
      ? points
      : []
    ).filter(
      (point) =>
        Number.isFinite(
          Number(point?.x)
        ) &&
        Number.isFinite(
          Number(point?.y)
        ) &&
        Number.isFinite(
          Number(point?.z ?? 0)
        )
    );

  if (
    safePoints.length < 2
  ) {
    return null;
  }

  // Modern THREE path.
  if (
    THREE?.BufferGeometry &&
    THREE?.Float32BufferAttribute
  ) {
    try {
      const positions = [];

      for (
        const point of
        safePoints
      ) {
        positions.push(
          Number(point.x),
          Number(point.y),
          Number(
            point.z ?? 0
          )
        );
      }

      const geometry =
        new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          positions,
          3
        )
      );

      return geometry;
    } catch {}
  }

  // Autodesk Viewer currently exposes THREE r71.
  // Legacy Geometry is the reliable path there.
  if (
    THREE?.Geometry &&
    THREE?.Vector3
  ) {
    try {
      const geometry =
        new THREE.Geometry();

      geometry.vertices =
        safePoints.map(
          (point) =>
            new THREE.Vector3(
              Number(point.x),
              Number(point.y),
              Number(
                point.z ?? 0
              )
            )
        );

      geometry.verticesNeedUpdate =
        true;

      return geometry;
    } catch {}
  }

  console.warn(
    "[VENTRA JPG LINE GEOMETRY UNSUPPORTED v14.2]",
    {
      threeRevision:
        THREE?.REVISION ||
        null,
      hasGeometry:
        Boolean(
          THREE?.Geometry
        ),
      hasBufferGeometry:
        Boolean(
          THREE?.BufferGeometry
        ),
      hasFloat32BufferAttribute:
        Boolean(
          THREE?.Float32BufferAttribute
        ),
    }
  );

  return null;
}

function ventraCreateLineSegmentsObject(
  THREE,
  geometry,
  material
) {
  if (
    !geometry ||
    !material
  ) {
    return null;
  }

  // Modern THREE.
  if (
    THREE?.LineSegments
  ) {
    try {
      return new THREE.LineSegments(
        geometry,
        material
      );
    } catch {}
  }

  // THREE r71 / Autodesk legacy path.
  if (
    THREE?.Line
  ) {
    try {
      return new THREE.Line(
        geometry,
        material,
        THREE.LinePieces
      );
    } catch {}
  }

  return null;
}


function ventraPointOnSegment2D(point, a, b, epsilon = 1e-6) {
  const cross =
    (Number(point.y) - Number(a.y)) *
      (Number(b.x) - Number(a.x)) -
    (Number(point.x) - Number(a.x)) *
      (Number(b.y) - Number(a.y));

  if (Math.abs(cross) > epsilon) return false;

  const dot =
    (Number(point.x) - Number(a.x)) *
      (Number(b.x) - Number(a.x)) +
    (Number(point.y) - Number(a.y)) *
      (Number(b.y) - Number(a.y));

  if (dot < -epsilon) return false;

  const lengthSquared =
    Math.pow(Number(b.x) - Number(a.x), 2) +
    Math.pow(Number(b.y) - Number(a.y), 2);

  return dot <= lengthSquared + epsilon;
}

function ventraPointInsidePolygon2D(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (ventraPointOnSegment2D(point, a, b)) return true;
  }

  let inside = false;

  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i, i += 1
  ) {
    const xi = Number(polygon[i].x);
    const yi = Number(polygon[i].y);
    const xj = Number(polygon[j].x);
    const yj = Number(polygon[j].y);

    const intersects =
      (yi > point.y) !== (yj > point.y) &&
      point.x <
        ((xj - xi) * (point.y - yi)) /
          Math.max(1e-9, yj - yi) +
          xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function ventraLineSegmentIntersection2D(a, b, c, d) {
  const r = {
    x: Number(b.x) - Number(a.x),
    y: Number(b.y) - Number(a.y),
  };
  const s = {
    x: Number(d.x) - Number(c.x),
    y: Number(d.y) - Number(c.y),
  };

  const crossRS = r.x * s.y - r.y * s.x;
  if (Math.abs(crossRS) < 1e-9) return null;

  const qmp = {
    x: Number(c.x) - Number(a.x),
    y: Number(c.y) - Number(a.y),
  };

  const t = (qmp.x * s.y - qmp.y * s.x) / crossRS;
  const u = (qmp.x * r.y - qmp.y * r.x) / crossRS;

  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) {
    return null;
  }

  return {
    x: Number(a.x) + r.x * t,
    y: Number(a.y) + r.y * t,
    t,
  };
}

function ventraClipLineToPolygon2D(start, end, polygon) {
  const hits = [];

  const addHit = (point, t) => {
    if (!point || !Number.isFinite(t)) return;
    if (
      hits.some(
        (existing) =>
          Math.abs(existing.point.x - point.x) < 1e-5 &&
          Math.abs(existing.point.y - point.y) < 1e-5
      )
    ) {
      return;
    }
    hits.push({ point, t });
  };

  if (ventraPointInsidePolygon2D(start, polygon)) addHit(start, 0);
  if (ventraPointInsidePolygon2D(end, polygon)) addHit(end, 1);

  for (let i = 0; i < polygon.length; i += 1) {
    const c = polygon[i];
    const d = polygon[(i + 1) % polygon.length];
    const hit = ventraLineSegmentIntersection2D(start, end, c, d);
    if (hit) addHit(hit, hit.t);
  }

  hits.sort((a, b) => a.t - b.t);
  if (hits.length < 2) return [];

  const segments = [];
  for (let i = 0; i < hits.length - 1; i += 1) {
    const a = hits[i];
    const b = hits[i + 1];
    const mid = {
      x: (a.point.x + b.point.x) / 2,
      y: (a.point.y + b.point.y) / 2,
    };

    if (ventraPointInsidePolygon2D(mid, polygon)) {
      segments.push([a.point, b.point]);
    }
  }

  return segments;
}


function ventraSegmentIntersectionT2D(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const crossRS = r.x * s.y - r.y * s.x;

  if (Math.abs(crossRS) < 1e-9) return null;

  const qmp = { x: c.x - a.x, y: c.y - a.y };
  const t = (qmp.x * s.y - qmp.y * s.x) / crossRS;
  const u = (qmp.x * r.y - qmp.y * r.x) / crossRS;

  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return Math.max(0, Math.min(1, t));
}

function ventraClipSegmentToPolygon2D(start, end, polygon) {
  if (!start || !end || !Array.isArray(polygon) || polygon.length < 3) return [];

  const ts = [0, 1];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const t = ventraSegmentIntersectionT2D(start, end, a, b);
    if (Number.isFinite(t)) ts.push(t);
  }

  ts.sort((a, b) => a - b);
  const unique = [];
  for (const t of ts) {
    if (!unique.length || Math.abs(t - unique[unique.length - 1]) > 1e-6) unique.push(t);
  }

  const clipped = [];
  for (let i = 0; i < unique.length - 1; i += 1) {
    const t0 = unique[i];
    const t1 = unique[i + 1];
    if (t1 - t0 < 1e-6) continue;

    const tm = (t0 + t1) / 2;
    const midpoint = {
      x: start.x + (end.x - start.x) * tm,
      y: start.y + (end.y - start.y) * tm,
    };

    if (!ventraPointInsidePolygon2D(midpoint, polygon)) continue;

    clipped.push([
      {
        x: start.x + (end.x - start.x) * t0,
        y: start.y + (end.y - start.y) * t0,
      },
      {
        x: start.x + (end.x - start.x) * t1,
        y: start.y + (end.y - start.y) * t1,
      },
    ]);
  }

  return clipped;
}

function ventraAddVisibleFloorPattern({
  THREE,
  root,
  polygon,
  material,
  z = 0.018,
}) {
  if (
    !THREE?.LineBasicMaterial ||
    !Array.isArray(polygon) ||
    polygon.length < 3
  ) {
    return;
  }

  const xs = polygon.map((p) => Number(p?.x)).filter(Number.isFinite);
  const ys = polygon.map((p) => Number(p?.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spacingX = Math.max(
    0.16,
    Number(material?.userData?.ventraFloorSpacingX) || 0.6
  );
  const spacingY = Math.max(
    0.16,
    Number(material?.userData?.ventraFloorSpacingY) || spacingX
  );

  const points = [];

  const appendClipped = (start, end) => {
    const pieces = ventraClipSegmentToPolygon2D(start, end, polygon);
    for (const [a, b] of pieces) {
      points.push(
        { x: a.x, y: a.y, z },
        { x: b.x, y: b.y, z }
      );
    }
  };

  for (let x = minX + spacingX; x < maxX; x += spacingX) {
    appendClipped({ x, y: minY }, { x, y: maxY });
  }

  for (let y = minY + spacingY; y < maxY; y += spacingY) {
    appendClipped({ x: minX, y }, { x: maxX, y });
  }

  if (!points.length) return;

  const geometry = ventraCreateLineGeometry(THREE, points);
  if (!geometry) return;

  const lineMaterial = new THREE.LineBasicMaterial({
    color: material?.userData?.ventraFloorLineColor ?? 0x66584a,
    transparent: true,
    opacity: Math.min(
      0.32,
      Number(material?.userData?.ventraFloorLineOpacity) || 0.26
    ),
    depthWrite: false,
  });

  const lines = ventraCreateLineSegmentsObject(THREE, geometry, lineMaterial);
  if (!lines) {
    geometry?.dispose?.();
    lineMaterial?.dispose?.();
    return;
  }

  lines.userData = {
    ventraType: 'schematic_floor_pattern',
    finish: material?.userData?.ventraFloorFinish || null,
    schematic: true,
    nonSelectable: true,
  };

  root.add(lines);
}

function ventraResolveSchematicAssetPlacement(
  asset,
  roomWidth,
  roomDepth
) {
  const assetType =
    ventraNormalizeSchematicAssetType(
      asset
    );

  const defaults =
    VENTRA_SCHEMATIC_ASSET_DEFAULTS[
      assetType
    ] || {
      width: 0.8,
      depth: 0.8,
      height: 0.8,
    };

  const finite = (value, fallback) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const positive = (value, fallback) => {
    const number = finite(value, NaN);
    return number > 0 ? number : fallback;
  };
  const w = positive(asset.width, defaults.width);
  const d = positive(asset.depth, defaults.depth);
  const h = positive(asset.height, defaults.height);
  const rot = finite(asset.rotation, 0) * Math.PI / 180;
  const cx = finite(asset.xMeters, finite(asset.x, 0.5) * roomWidth) - roomWidth / 2;
  const cy = finite(asset.yMeters, finite(asset.y, 0.5) * roomDepth) - roomDepth / 2;

  return {
    assetType,
    defaults,
    w,
    d,
    h,
    rot,
    cx,
    cy,
    roomId:
      asset?.roomId ||
      null,
    againstWallId:
      asset?.againstWallId ||
      null,
    placementSource:
      asset?.placementSource ||
      null,
  };
}

function ventraPresentationAssets(scene) {
  if (scene.furnishingMode === "source_observed") return sourcePresentationAssets(scene);
  const inside = (p, poly) => {
    let yes = false;
    for (let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const a=poly[i],b=poly[j];
      if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) yes=!yes;
    }
    return yes;
  };
  const assets=(scene.assets || []).map(asset => {
    if (!['sofa','armchair','bed'].includes(asset.type) || !asset.wallSupported) return asset;
    const room=(scene.rooms || []).find(r=>r.id===asset.roomId);
    const poly=room?.polygon;
    if (!poly?.length || !Number.isFinite(asset.xMeters) || !Number.isFinite(asset.yMeters)) return asset;
    const center=poly.reduce((p,v)=>({x:p.x+v.x/poly.length,y:p.y+v.y/poly.length}),{x:0,y:0});
    const angle=(Number(asset.rotation)||0)*Math.PI/180;
    // Mesh front is local +Y, backrest/headboard is local -Y.
    const facing=-Math.sin(angle)*(center.x-asset.xMeters)+Math.cos(angle)*(center.y-asset.yMeters);
    return facing < -0.15 ? {...asset,rotation:(Number(asset.rotation)||0)+180} : asset;
  });
  for (const room of scene.rooms || []) {
    if (assets.some(a=>a.roomId===room.id && a.type==='rug')) continue;
    const table=assets.find(a=>a.roomId===room.id && a.type==='coffee_table');
    if (!table || !room.polygon?.length) continue;
    const width=Math.max(1.4,Number(table.width)+0.7),depth=Math.max(1.1,Number(table.depth)+0.65);
    const angle=(Number(table.rotation)||0)*Math.PI/180;
    const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>({x:table.xMeters+x*width/2*Math.cos(angle)-y*depth/2*Math.sin(angle),y:table.yMeters+x*width/2*Math.sin(angle)+y*depth/2*Math.cos(angle)}));
    if(corners.every(p=>inside(p,room.polygon))) assets.push({type:'rug',roomId:room.id,xMeters:table.xMeters,yMeters:table.yMeters,width,depth,height:0.018,rotation:table.rotation||0});
  }
  // Add a dressing table only where its complete footprint and front
  // access area fit inside the room without overlapping existing furniture.
  const bounds = a => {
    const p=ventraResolveSchematicAssetPlacement(a,scene.width,scene.depth);
    const hx=(Math.abs(Math.cos(p.rot))*p.w+Math.abs(Math.sin(p.rot))*p.d)/2;
    const hy=(Math.abs(Math.sin(p.rot))*p.w+Math.abs(Math.cos(p.rot))*p.d)/2;
    const x=p.cx+scene.width/2,y=p.cy+scene.depth/2;
    return {x0:x-hx,x1:x+hx,y0:y-hy,y1:y+hy};
  };
  for(const room of scene.rooms || []) {
    if (!/bedroom/.test(room.semanticType || room.type || '') || assets.some(a=>a.roomId===room.id && a.type==='dressing_table')) continue;
    const poly=room.polygon || [];
    const occupied=assets.filter(a=>a.type!=='rug').map(bounds);
    let chosen=null;
    for(let i=0;i<poly.length && !chosen;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len<1.1)continue;
      for(const sign of [1,-1]) for(let distance=0.6;distance<len-0.5 && !chosen;distance+=0.25) {
        const nx=-dy/len*sign,ny=dx/len*sign;
        const p={x:a.x+dx/len*distance+nx*0.3,y:a.y+dy/len*distance+ny*0.3};
        const rotation=Math.atan2(-nx,ny)*180/Math.PI;
        const candidate={type:'dressing_table',roomId:room.id,xMeters:p.x,yMeters:p.y,width:0.9,depth:0.42,height:1.6,rotation};
        const area=bounds({...candidate,xMeters:p.x+nx*0.3,yMeters:p.y+ny*0.3,depth:1.02});
        const corners=[{x:area.x0,y:area.y0},{x:area.x0,y:area.y1},{x:area.x1,y:area.y0},{x:area.x1,y:area.y1}];
        if(!corners.every(c=>inside(c,poly)))continue;
        if(occupied.some(q=>area.x0<q.x1+0.08 && area.x1>q.x0-0.08 && area.y0<q.y1+0.08 && area.y1>q.y0-0.08))continue;
        const blocksDoor=(scene.openings || []).some(o=>{
          if(o.type!=='door')return false;
          const wall=(scene.walls || []).find(w=>w.id===o.wallId);if(!wall)return false;
          const x=wall.start.x+(wall.end.x-wall.start.x)*o.offset,y=wall.start.y+(wall.end.y-wall.start.y)*o.offset;
          return Math.hypot(Math.max(area.x0-x,0,x-area.x1),Math.max(area.y0-y,0,y-area.y1))<Math.max(0.8,Number(o.width)||0.8);
        });
        if(!blocksDoor)chosen=candidate;
      }
    }
    if(chosen)assets.push(chosen);
  }
  // Do not synthesize extra seating during display. Existing seating is preserved;
  // adding chairs without a verified circulation plan can obstruct cabinetry.
  return scene.promptEdit ? assets : arrangeLivingFurniture(scene, assets);
}

// Render-only edge treatment. Source footprints and furniture dimensions stay intact.
// Soft contact shading is a display overlay, never a selectable furniture item.
function ventraFurnitureContactShade({THREE,asset,roomWidth,roomDepth}){
 if(typeof document==='undefined'||!THREE.Texture||!THREE.PlaneGeometry)return null;
 if(!['sofa','armchair','bed','cabinet','wardrobe','kitchen_counter','plant','dressing_table','refrigerator','washing_machine'].includes(asset?.type)||Number(asset.zMeters)>0.08)return null;
 try{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const ctx=canvas.getContext('2d');if(!ctx?.createRadialGradient)return null;
  const gradient=ctx.createRadialGradient(32,32,5,32,32,32);gradient.addColorStop(0,'rgba(20,16,12,0.24)');gradient.addColorStop(.55,'rgba(20,16,12,0.13)');gradient.addColorStop(1,'rgba(20,16,12,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const texture=new THREE.Texture(canvas);texture.needsUpdate=true;
  const p=ventraResolveSchematicAssetPlacement(asset,roomWidth,roomDepth);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(p.w*.96,p.d*.96),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  mesh.position.set(p.cx,p.cy,.004);mesh.rotation.z=p.rot;mesh.renderOrder=2;
  mesh.userData={ventraType:'furniture_contact_shade',schematic:true,nonSelectable:true};return mesh;
 }catch{return null;}
}

function ventraSoftFurnitureBox(THREE,w,d,h){
 const b=Math.min(.006,w*.04,d*.04,h*.12);
 if(!THREE.Shape||!THREE.ExtrudeGeometry||b<.0004)return new THREE.BoxGeometry(w,d,h);
 try{
  const shape=new THREE.Shape(),x=w/2-b,y=d/2-b;
  shape.moveTo(-x,-y);shape.lineTo(x,-y);shape.lineTo(x,y);shape.lineTo(-x,y);shape.lineTo(-x,-y);
  const geometry=new THREE.ExtrudeGeometry(shape,{amount:h-2*b,depth:h-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:2,steps:1,curveSegments:1});
  // r71 uses Geometry, newer runtimes use BufferGeometry.
  if(geometry.translate)geometry.translate(0,0,b-h/2);
  else if(geometry.vertices)for(const v of geometry.vertices)v.z+=b-h/2;
  geometry.parameters={...(geometry.parameters||{}),width:w,height:d,depth:h};
  return geometry;
 }catch{return new THREE.BoxGeometry(w,d,h);}
}

// Soft upholstery geometry, generated inside the existing measured dimensions.
function ventraUpholsteryGeometry(THREE,w,d,h){
 const g=new THREE.BoxGeometry(w,d,h,10,8,6),r=Math.min(w*.12,d*.16,h*.42);
 if(!g.vertices)return ventraSoftFurnitureBox(THREE,w,d,h);
 for(const v of g.vertices){
  const q=new THREE.Vector3(Math.max(-w/2+r,Math.min(w/2-r,v.x)),Math.max(-d/2+r,Math.min(d/2-r,v.y)),Math.max(-h/2+r,Math.min(h/2-r,v.z)));
  const delta=v.clone().sub(q);if(delta.length()>0)v.copy(q.add(delta.normalize().multiplyScalar(r)));
 }
 g.computeFaceNormals();g.computeVertexNormals();g.userData={upholstery:true};return g;
}

function buildSchematicAssetMeshes({ THREE, asset, palette, roomWidth, roomDepth }) {
  const meshes = [];
  const base=asset.renderingBaseDimensions;
  const ratios=base?['width','depth','height'].map(key=>asset[key]/base[key]):[];
  const objectScale=ratios.length&&ratios.every(n=>Number.isFinite(n)&&n>0&&Math.abs(n-ratios[0])<.000001)?ratios[0]:1;
  const renderAsset=base&&objectScale!==1?{...asset,...base}:asset;
  const { assetType, w, d, h, rot, cx, cy } = ventraResolveSchematicAssetPlacement(renderAsset, roomWidth, roomDepth);
  // Tiny, deterministic surface grain adds material depth without a network asset.
  // Textures belong to this asset and are released with its mesh materials.
  const surfaceTexture = (kind) => {
    if (typeof document === 'undefined' || !THREE.Texture) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) return null;
      // Seeded, seamless grayscale surfaces preserve the material tint.
      // Geometry, dimensions and transforms are untouched.
      const pixels = context.createImageData(256, 256);
      let seed = 1729;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 4294967296 - 0.5;
        const wave = Math.sin(2 * Math.PI * y / 256);
        const grain = Math.sin(2 * Math.PI * (x * 13 / 256 + 0.28 * wave));
        const value = kind === 'wood'
          ? 240 + Math.sin(2 * Math.PI * (x * 79 / 256 + 0.28 * wave)) * 6 + Math.sin(2 * Math.PI * (x * 173 / 256 + 0.15 * wave)) * 2 + noise * 3
          : kind === 'fabric'
            ? 242 + ((x % 4 < 2) !== (y % 4 < 2) ? 4 : -4) + noise * 5
            : 246 + noise * 6 + Math.sin(2 * Math.PI * (x + y) / 256) * 2;
        const index = (y * 256 + x) * 4;
        pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
        pixels.data[index + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const texture = new THREE.Texture(canvas);
      texture.needsUpdate = true;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipMapLinearFilter || THREE.LinearMipmapLinearFilter || THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;
      texture.repeat.set(kind === 'fabric' ? 8 : 1, kind === 'fabric' ? 8 : 1);
      return texture;
    } catch { return null; }
  };
  const designVariant=asset.variant||palette.designPreset||'classic';
  const upholstery = assetType === 'sofa' || assetType === 'armchair';
  const finish = (kind) => {
    const map = surfaceTexture(kind);
    return map ? {map,bumpMap:map,bumpScale:kind==='fabric'?.0005:kind==='wood'?.0012:.00035} : {};
  };
  const OpaqueMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const GlassMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const accent = new OpaqueMaterial({
    color: hexNumber(asset?.color || (upholstery ? palette?.upholstery : palette?.furniture || palette?.accent), upholstery ? 0xb8afa2 : 0x815a3f),
    side: THREE.DoubleSide,
    shininess: upholstery ? 5 : 36,
    specular: upholstery ? 0x121212 : 0x302b25,
    ...finish(upholstery ? 'fabric' : 'wood'),
  });
  const light = new OpaqueMaterial({ color: hexNumber(asset?.color || palette?.upholstery, 0xd9d0c4), side: THREE.DoubleSide, shininess: ['cabinet','wardrobe','kitchen_counter','dining_table','desk'].includes(assetType) ? 20 : 3, specular: 0x222222, ...finish(['cabinet','wardrobe','kitchen_counter','dining_table','desk'].includes(assetType) ? 'wood' : 'fabric') });
  const white = new OpaqueMaterial({ color: hexNumber(asset?.color, 0xe8e2da), side: THREE.DoubleSide, shininess: 38, specular: 0x444444, ...finish('stone') });
  const dark = new OpaqueMaterial({ color: 0x4d433b, side: THREE.DoubleSide, shininess: 9 });
  const sage = new OpaqueMaterial({ color: hexNumber(palette?.textileAccent, 0x8e9b78), side: THREE.DoubleSide, shininess: 3, ...finish('fabric') });
  const rugMat = new OpaqueMaterial({ color: 0xc7bbaa, side: THREE.DoubleSide, shininess: 1, ...finish('fabric') });
  const leafMat = new OpaqueMaterial({ color: 0x6f805c, side: THREE.DoubleSide, shininess: 4 });
  const potMat = new OpaqueMaterial({ color: 0x8f7358, side: THREE.DoubleSide, shininess: 6 });
  const glass = new GlassMaterial({ color: hexNumber(palette?.glass, 0x8fb6cc), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, shininess: 80 });
  const metal = new OpaqueMaterial({ color: hexNumber(palette?.metal, 0x817a72), side: THREE.DoubleSide, shininess: 110, specular:0xb8b6b1 });

  const rotateOffset = (ox, oy) => ({
    x: ox * Math.cos(rot) - oy * Math.sin(rot),
    y: ox * Math.sin(rot) + oy * Math.cos(rot),
  });

  const addBox = (bw, bd, bh, ox = 0, oy = 0, oz = bh / 2, material = accent) => {
    const mesh = new THREE.Mesh(ventraSoftFurnitureBox(THREE,bw,bd,bh), material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz + (Number(asset.zMeters) || 0));
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };

  // Rounded rectangle extruded along Z: an actual cushion silhouette, including
  // rounded plan corners and a narrow softened upper/lower edge in legacy r71.
  const addCushion = (bw, bd, bh, ox, oy, oz, material = light) => {
    const geometry = ventraUpholsteryGeometry(THREE,bw,bd,bh);
    const mesh = new THREE.Mesh(geometry, material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz + (Number(asset.zMeters)||0));
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };

  const addCylinder = (radius, length, ox, oy, oz, material = metal, horizontal = false) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 18), material);
    const shifted = rotateOffset(ox, oy);
    mesh.position.set(cx + shifted.x, cy + shifted.y, oz);
    if (!horizontal) mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    return mesh;
  };

  switch (assetType) {
    case 'sofa': {
      addBox(w * 0.94, d * 0.82, 0.13, 0, 0.03 * d, 0.15, dark);
      addCushion(w * 0.88, d * 0.64, 0.19, 0, 0.08 * d, 0.30, accent);
      addCushion(w * 0.88, d * 0.16, 0.55, 0, -d * 0.39, 0.51, accent);
      for (const sx of [-1, 1]) {
        addCushion(w * 0.09, d * 0.66, 0.39, sx * w * 0.43, d * 0.05, 0.43, accent);
        addBox(w * 0.035, d * 0.035, 0.12, sx * w * 0.38, d * 0.32, 0.06, dark);
      }
      for (const offset of (designVariant==='minimal'?[0]:[-0.27, 0, 0.27])) {
        addCushion(w * 0.26, d * 0.46, 0.09, w * offset, d * 0.09, 0.43, offset < 0 ? sage : light);
        addCushion(w * 0.25, d * 0.11, 0.25, w * offset, -d * 0.27, 0.53, light);
      }
      if(designVariant==='luxury'){for(const sx of [-1,1])addBox(w*.02,d*.78,.12,sx*w*.43,0,.08,metal);for(const x of [-.3,-.1,.1,.3])addCylinder(.025,.02,w*x,-d*.39,.69,metal,false);}
      break;
    }
    case 'rug': {
      addBox(w, d, 0.012, 0, 0, 0.014, dark);
      addBox(w * 0.96, d * 0.96, 0.012, 0, 0, 0.018, rugMat);
      addBox(w * 0.84, d * 0.84, 0.004, 0, 0, 0.026, light);
      break;
    }
    case 'plant': {
      const potH=Math.min(.32,h*.26),radius=Math.min(w,d)*.20;
      addCylinder(radius,potH,0,0,potH/2,potMat,false);
      addCylinder(radius*.92,.018,0,0,potH,dark,false);
      addCylinder(Math.min(.012,radius*.07),h*.66,0,0,potH+h*.33,leafMat,false);
      for(let i=0;i<36;i++){
        const angle=i*2.399963,reach=Math.min(w,d)*(.13+(i%3)*.035),length=Math.min(Math.min(w,d)*.30,h*.18);
        const geometry=new THREE.SphereGeometry(1,10,6);
        if(geometry.vertices){for(const v of geometry.vertices){v.x*=length;v.y*=length*.40;v.z*=length*.065;}geometry.computeFaceNormals?.();geometry.computeVertexNormals?.();}
        else geometry.scale?.(length,length*.40,length*.065);
        const leaf=new THREE.Mesh(geometry,leafMat),shift=rotateOffset(Math.cos(angle)*reach,Math.sin(angle)*reach);
        leaf.position.set(cx+shift.x,cy+shift.y,potH+(h-potH)*(.23+i*.019));
        leaf.rotation.set(0,(i%2?.22:-.16),angle+rot);leaf.castShadow=true;leaf.receiveShadow=true;
        meshes.push(leaf);
      }
      break;
    }
    case 'flower_pot': {
      addCylinder(Math.min(w, d) * 0.20, 0.28, 0, 0, 0.14, potMat, false);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.33, 14, 10), leafMat);
      crown.position.set(cx, cy, Math.max(0.55, h * 0.64));
      meshes.push(crown);
      if (assetType === 'flower_pot') {
        for (const [x,y] of [[0,0],[w*.2,0],[-w*.2,d*.15],[0,-d*.2]]) {
          const flower = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w,d)*.12,12,8), accent);
          const shifted=rotateOffset(x,y);flower.position.set(cx+shifted.x,cy+shifted.y,h*.9);meshes.push(flower);
        }
      }
      for (const [ox, oy, oz] of [
        [0.12,0.00,0.66],[-0.10,0.05,0.72],[0.02,0.11,0.78],[0.00,-0.11,0.70]
      ]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.18, 12, 8), leafMat);
        const shifted = rotateOffset(ox, oy);
        leaf.position.set(cx + shifted.x, cy + shifted.y, Math.max(0.45, h * oz));
        meshes.push(leaf);
      }
      break;
    }
    case 'armchair': {
      addBox(w * 0.82, d * 0.74, 0.13, 0, 0.04 * d, 0.14, dark);
      addCushion(w * 0.76, d * 0.61, 0.17, 0, 0.06 * d, 0.31, light);
      addCushion(w * 0.76, d * 0.16, 0.55, 0, -d * 0.38, 0.50, accent);
      addCushion(w * 0.10, d * 0.69, 0.42, -w * 0.40, 0, 0.41, accent);
      addCushion(w * 0.10, d * 0.69, 0.42, w * 0.40, 0, 0.41, accent);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.045, 0.045, 0.08, sx * w * 0.30, sy * d * 0.26, 0.04, dark);
      break;
    }
    case 'bed': {
      addBox(w, d, 0.20, 0, 0, 0.10, accent);
      addCushion(w * 0.91, d * 0.88, 0.24, 0, 0.01 * d, 0.32, white);
      addBox(w, 0.11, Math.min(h, 1.05), 0, -d * 0.47, Math.min(h, 1.05) / 2, designVariant==='luxury'?light:accent);
      if(designVariant==='luxury')for(const x of [-.32,-.16,0,.16,.32])addBox(w*.02,.035,Math.min(h,.9),w*x,-d*.40,Math.min(h,.9)/2,metal);
      addCushion(w * 0.30, d * 0.17, 0.11, -w * 0.19, -d * 0.29, 0.50, white);
      addCushion(w * 0.30, d * 0.17, 0.11,  w * 0.19, -d * 0.29, 0.50, white);
      if(THREE.Geometry&&THREE.Face3){
        const geometry=new THREE.Geometry(),nx=16,ny=20;
        for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
          const x=(i/nx-.5)*w*.88,y=(j/ny-.5)*d*.50+d*.16;
          const edge=Math.pow(Math.abs(i/nx-.5)*2,8);
          const z=.478+.012*Math.sin(i*.8+j*.32)+.008*Math.cos(j*.75)-edge*.055;
          geometry.vertices.push(new THREE.Vector3(x,y,z));
        }
        for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
          const a=j*(nx+1)+i,b=a+1,c=a+nx+1,e=c+1;
          geometry.faces.push(new THREE.Face3(a,b,e),new THREE.Face3(a,e,c));
        }
        geometry.computeFaceNormals();geometry.computeVertexNormals();
        ventraApplyFloorMaterialUVs(THREE,geometry);
        const blanket=new THREE.Mesh(geometry,sage);blanket.position.set(cx,cy,0);blanket.rotation.z=rot;
        blanket.castShadow=blanket.receiveShadow=true;blanket.userData={ventraComponent:'bed_fabric'};meshes.push(blanket);
      }else addCushion(w*.88,d*.5,.035,0,d*.16,.478,sage);
      addBox(w * 0.88, d * 0.05, 0.07, 0, d * 0.45, 0.07, dark);
      break;
    }
    case 'dressing_table': {
      addBox(w, d, 0.06, 0, 0, 0.75, accent);
      addBox(w * 0.92, d * 0.9, 0.16, 0, 0, 0.64, light);
      for(const sx of [-1,1]) addBox(0.045,d * 0.8,0.6,sx*w*0.43,0,0.30,dark);
      addBox(w * 0.8,0.035,0.7,0,-d*0.43,1.18,accent);
      // Opaque silver inset: a mirror surface, not a simulated reflection.
      addBox(w * 0.72,0.018,0.62,0,-d*0.38,1.18,metal);
      break;
    }
    case 'dining_table':
    case 'desk': {
      if (designVariant === 'round') {
        addCylinder(Math.min(w,d)/2,.08,0,0,Math.min(h,.76),accent,false);
        addCylinder(Math.min(w,d)*.13,Math.min(h,.72),0,0,Math.min(h,.72)/2,dark,false);
        addCylinder(Math.min(w,d)*.32,.045,0,0,.025,dark,false);
        break;
      }
      addBox(w, d, 0.08, 0, 0, Math.min(h, 0.76), accent);
      addBox(w * 0.86, d * 0.82, 0.035, 0, 0, Math.min(h, 0.76) + 0.055, light);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.08, 0.08, Math.min(h, 0.72), sx * w * 0.34, sy * d * 0.28, Math.min(h, 0.72) / 2, dark);
      break;
    }
    case 'coffee_table': {
      if(designVariant==='luxury'){const radius=Math.min(w,d)*.46;addCylinder(radius,.06,0,0,.41,white,false);addCylinder(radius*.65,.36,0,0,.19,metal,false);break;}
      if(designVariant==='minimal'){addBox(w*.95,d*.95,.05,0,0,.37,accent);for(const x of [-1,1])addBox(w*.04,d*.75,.34,x*w*.35,0,.17,accent);break;}
      addBox(w, d, 0.07, 0, 0, 0.34, accent);
      addBox(w * 0.94, d * 0.88, 0.03, 0, 0, 0.39, glass);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.05, 0.05, 0.30, sx * w * 0.34, sy * d * 0.26, 0.15, dark);
      break;
    }
    case 'chair': {
      addBox(w * 0.92, d * 0.92, 0.08, 0, 0, 0.46, accent);
      addBox(w * 0.88, 0.08, 0.50, 0, -d * 0.40, 0.69, accent);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) addBox(0.04, 0.04, 0.44, sx * w * 0.30, sy * d * 0.30, 0.22, dark);
      break;
    }
    case 'wardrobe': {
      addBox(w, d, h, 0, 0, h / 2, accent);
      addBox(w * 0.47, d * 0.03, h * 0.84, -w * 0.24, -d * 0.50, h * 0.52, light);
      addBox(w * 0.47, d * 0.03, h * 0.84, w * 0.24, -d * 0.50, h * 0.52, light);
      addCylinder(0.012, Math.min(0.16, h * 0.25), -w * 0.04, -d * 0.53, h * 0.53, metal);
      addCylinder(0.012, Math.min(0.16, h * 0.25), w * 0.04, -d * 0.53, h * 0.53, metal);
      break;
    }
    case 'cabinet_door': {
      addBox(w,d,h,0,0,h/2,accent);
      addBox(w*.8,.012,h*.8,0,-d/2,h/2,light);
      addBox(.02,.03,h*.2,w*.35,-d/2-.01,h*.5,metal);
      break;
    }
    case 'cabinet':
    case 'tv_unit': {
      addBox(w, d, Math.min(h, assetType === 'tv_unit' ? 0.52 : h), 0, 0, Math.min(h, assetType === 'tv_unit' ? 0.52 : h) / 2, accent);
      addBox(w * 0.42, d * 0.04, Math.min(h * 0.78, 0.32), -w * 0.24, -d * 0.52, Math.min(h * 0.78, 0.32) * 0.72, light);
      addBox(w * 0.42, d * 0.04, Math.min(h * 0.78, 0.32), w * 0.24, -d * 0.52, Math.min(h * 0.78, 0.32) * 0.72, light);
      if (assetType === 'tv_unit') {
        const screenWidth = w * 0.94;
        const screenHeight = screenWidth * 9 / 16;
        const consoleTop = Math.min(h, 0.52);
        addBox(w * 0.28, d * 0.50, 0.025, 0, 0, consoleTop + 0.025, dark);
        addBox(0.035, 0.035, 0.13, 0, 0, consoleTop + 0.09, dark);
        addBox(screenWidth, 0.035, screenHeight, 0, 0, consoleTop + 0.15 + screenHeight / 2, dark);
        addBox(screenWidth * 0.95, 0.009, screenHeight * 0.93, 0, d > 0 ? -0.023 : 0, consoleTop + 0.15 + screenHeight / 2,
          new OpaqueMaterial({color:0x253845,emissive:0x080d13,shininess:65,side:THREE.DoubleSide}));
      }
      break;
    }
    case 'range_hood': {
      addBox(w,d,h*.24,0,0,h*.12,metal);
      addBox(w*.35,d*.45,h*.76,0,d*.2,h*.62,metal);
      addBox(w*.65,d*.55,.012,0,0,.012,dark);
      break;
    }
    case 'kitchen_counter': {
      if(designVariant==='l-shape'){
        const run=Math.min(.6,d*.4,w*.4),body=Math.min(h,.88);
        addBox(w,run,body,0,d/2-run/2,body/2,accent);
        addBox(run,d-run,body,-w/2+run/2,-run/2,body/2,accent);
        addBox(w,run,.04,0,d/2-run/2,body+.02,white);
        addBox(run,d-run,.04,-w/2+run/2,-run/2,body+.02,white);
        for(let i=0;i<4;i++)addBox(w/4-.02,.02,body*.8,-w/2+w*(i+.5)/4,d/2-run-.01,body/2,light);
        break;
      }
      addBox(w, d, Math.min(h, 0.88), 0, 0, Math.min(h, 0.88) / 2, accent);
      addBox(w * 1.03, d * 1.04, 0.045, 0, 0, Math.min(h, 0.88) + 0.03, white);
      addBox(w * 0.44, d * 0.03, Math.min(h, 0.72), -w * 0.25, -d * 0.52, Math.min(h, 0.72) / 2, light);
      addBox(w * 0.44, d * 0.03, Math.min(h, 0.72), w * 0.25, -d * 0.52, Math.min(h, 0.72) / 2, light);
      break;
    }
    case 'kitchen_island': {
      addBox(w * 0.92, d * 0.86, Math.min(h, 0.88), 0, 0, Math.min(h, 0.88) / 2, accent);
      addBox(w, d, 0.05, 0, 0, Math.min(h, 0.88) + 0.03, white);
      break;
    }
    case 'floor_lamp': {
      addCylinder(Math.min(w,d)*.46, .045, 0, 0, .025, metal, false);
      addCylinder(.014, h*.78, 0, 0, h*.4, metal, false);
      addCylinder(Math.min(w,d)*.4, h*.2, 0, 0, h*.88, light, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 8), new OpaqueMaterial({color:0xffe7b0,emissive:0x665020}));
      bulb.position.set(cx,cy,h*.86); meshes.push(bulb);
      break;
    }
    case 'nightstand': {
      const nh = Math.min(h, 0.52);
      addBox(w, d, nh, 0, 0, nh / 2, accent);
      addBox(w * 0.88, d * 0.03, 0.12, 0, -d * 0.50, nh * 0.68, light);
      addCylinder(0.025, 0.22, 0, 0, nh + 0.11, metal);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 0.18, 16), light);
      shade.position.set(cx, cy, nh + 0.31);
      shade.rotation.x = Math.PI / 2;
      shade.castShadow = true;
      meshes.push(shade);
      break;
    }
    case 'freezer':
    case 'refrigerator': {
      addBox(w, d, h, 0, 0, h / 2, light);
      addBox(w * 0.03, d * 0.05, h * 0.34, w * 0.33, -d * 0.52, h * 0.60, metal);
      addBox(w * 0.84, d * 0.02, 0.02, 0, -d * 0.515, h * 0.36, metal);
      break;
    }
    case 'stove': {
      const top = asset?.embeddedInCounter ? 0.93 : Math.min(h, 0.88);
      if (!asset?.embeddedInCounter) addBox(w, d, top, 0, 0, top / 2, accent);
      addBox(w * 0.95, d * 0.95, 0.035, 0, 0, top + 0.025, dark);
      for (const sx of [-0.23, 0.23]) for (const sy of [-0.22, 0.22]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.10, Math.min(w, d) * 0.10, 0.02, 18), dark);
        const shifted = rotateOffset(sx * w, sy * d);
        burner.position.set(cx + shifted.x, cy + shifted.y, top + 0.06);
        burner.rotation.x = Math.PI / 2;
        burner.rotation.z = rot;
        meshes.push(burner);
      }
      break;
    }
    case 'sink': {
      const vanityH = asset?.embeddedInCounter ? 0.90 : Math.min(h, 0.82);

      if (!asset?.embeddedInCounter) addBox(w, d, vanityH, 0, 0, vanityH / 2, accent);

      addBox(
        w * 0.96,
        d * 0.94,
        asset?.embeddedInCounter ? 0.025 : 0.07,
        0,
        0,
        vanityH + (asset?.embeddedInCounter ? 0.045 : 0.035),
        white
      );

      addBox(
        w * 0.62,
        d * 0.52,
        0.055,
        0,
        -d * 0.02,
        vanityH +
          0.075,
        dark
      );

      addCylinder(
        0.022,
        0.28,
        0,
        -d * 0.20,
        vanityH +
          0.20,
        metal
      );

      break;
    }
    case 'bathtub': {
      addBox(
        w,
        d,
        0.50,
        0,
        0,
        0.25,
        white
      );

      addBox(
        w * 0.82,
        d * 0.68,
        0.16,
        0,
        0,
        0.43,
        glass
      );

      addCylinder(
        0.018,
        0.30,
        w * 0.34,
        -d * 0.30,
        0.62,
        metal
      );

      break;
    }
    case 'shower': {
      addBox(w, d, 0.05, 0, 0, 0.025, white);
      addBox(0.028, d, Math.min(h, 2.1), -w / 2, 0, Math.min(h, 2.1) / 2, glass);
      addBox(w, 0.028, Math.min(h, 2.1), 0, -d / 2, Math.min(h, 2.1) / 2, glass);
      addCylinder(0.018, Math.min(h, 2), w * 0.36, d * 0.36, Math.min(h, 2) / 2, metal);
      break;
    }
    case 'toilet': {
      addBox(w * 0.68, d * 0.44, 0.26, 0, d * 0.14, 0.13, white);
      addBox(w * 0.72, d * 0.20, 0.44, 0, -d * 0.22, 0.34, white);
      addBox(w * 0.36, d * 0.24, 0.08, 0, d * 0.02, 0.28, light);
      break;
    }
    case 'washing_machine': {
      addBox(w,d,h,0,0,h/2,white);
      const radius=Math.min(w,h)*.22;
      const front=(geometry,mat,z)=>{
        const mesh=new THREE.Mesh(geometry,mat),shift=rotateOffset(0,-d*.515);
        mesh.position.set(cx+shift.x,cy+shift.y,z);mesh.rotation.z=rot;mesh.rotation.x=Math.PI/2;mesh.castShadow=true;meshes.push(mesh);
      };
      if(THREE.TorusGeometry)front(new THREE.TorusGeometry(radius,.022,8,32),metal,h*.52);
      front(new THREE.CircleGeometry(radius*.88,32),dark,h*.52);
      addBox(w*.94,.018,h*.10,0,-d*.51,h*.88,light);
      addCylinder(w*.045,.035,-w*.28,-d*.54,h*.88,metal,true);
      addBox(w*.25,.012,h*.045,w*.16,-d*.535,h*.88,dark);
      break;
    }
    case 'mirror': {
      const mirrorW =
        Math.max(
          0.55,
          w
        );

      const mirrorH =
        Math.max(
          0.75,
          h
        );

      // Wall-mounted mirror. Previous code started it at floor level.
      addBox(
        mirrorW,
        0.035,
        mirrorH,
        0,
        0,
        1.48,
        glass
      );

      addBox(
        mirrorW + 0.08,
        0.055,
        0.045,
        0,
        0.006,
        1.48 +
          mirrorH /
            2,
        metal
      );

      addBox(
        mirrorW + 0.08,
        0.055,
        0.045,
        0,
        0.006,
        1.48 -
          mirrorH /
            2,
        metal
      );

      addBox(
        0.045,
        0.055,
        mirrorH,
        -mirrorW /
          2,
        0.006,
        1.48,
        metal
      );

      addBox(
        0.045,
        0.055,
        mirrorH,
        mirrorW /
          2,
        0.006,
        1.48,
        metal
      );

      break;
    }
    default: {
      addBox(w, d, Math.min(h, 0.42), 0, 0, Math.min(h, 0.42) / 2, light);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        addBox(0.045, 0.045, Math.min(0.38, h), sx * w * 0.38, sy * d * 0.34, Math.min(0.38, h) / 2, accent);
      }
    }
  }

  for (const mesh of meshes) {
    if(objectScale!==1){
      const z=Number(asset.zMeters)||0;
      mesh.position.set(cx+(mesh.position.x-cx)*objectScale,cy+(mesh.position.y-cy)*objectScale,z+(mesh.position.z-z)*objectScale);
      mesh.scale.multiplyScalar(objectScale);
    }
    mesh.userData = {
      ...(mesh.userData || {}),
      assetId: asset?.id || null,
      ventraType:
        `schematic_${assetType}`,

      originalVentraType:
        asset?.type ||
        null,

      roomId:
        asset?.roomId ||
        null,

      againstWallId:
        asset?.againstWallId ||
        null,

      placementSource:
        asset?.placementSource ||
        null,

      schematic: true,
    };
  }

  const usedMaterials = new Set(meshes.map((mesh) => mesh.material));
  for (const material of [accent, light, white, dark, sage, rugMat, leafMat, potMat, glass, metal]) {
    if (!usedMaterials.has(material)) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  }

  return meshes;
}

function ventraCreateDoorLeafVisual({ THREE, opening, material, wallHeight = 2.8 }) {
  if (!THREE || !opening?.start || !opening?.end) return null;
  const preserveTrace = opening.preserveRasterTrace === true;
  if (preserveTrace && (!["start", "end"].includes(opening.hinge) || !["clockwise", "counterclockwise"].includes(opening.swing))) return null;

  const sx = Number(opening.start.x);
  const sy = Number(opening.start.y);
  const ex = Number(opening.end.x);
  const ey = Number(opening.end.y);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return null;

  const dx = ex - sx;
  const dy = ey - sy;
  const openingWidth = Math.hypot(dx, dy);
  if (!Number.isFinite(openingWidth) || openingWidth < (preserveTrace ? 0.005 : 0.2)) return null;

  const safeWallHeight = Math.max(2.2, Number(wallHeight) || 2.8);
  const requestedHeight = Number(opening?.height);
  const leafHeight = preserveTrace || opening.preserveSourceDimensions ? requestedHeight : Math.max(
    1.9,
    Math.min(
      Number.isFinite(requestedHeight) ? requestedHeight : 2.1,
      2.15,
      safeWallHeight - 0.16
    )
  );

  if(opening.variant==='double'){
    const mid={x:(sx+ex)/2,y:(sy+ey)/2},group=new THREE.Group();
    for(const half of [{start:{x:sx,y:sy},end:mid,hinge:'start'},{start:mid,end:{x:ex,y:ey},hinge:'end'}]){
      const leaf=ventraCreateDoorLeafVisual({THREE,opening:{...opening,...half,width:openingWidth/2,variant:'single'},material,wallHeight});
      if(leaf)group.add(leaf);
    }
    return group;
  }
  const group = new THREE.Group();
  const hingeAtEnd = String(opening?.hinge || opening?.hingeSide || '').toLowerCase() === 'end';
  const hinge = hingeAtEnd ? { x: ex, y: ey } : { x: sx, y: sy };
  const closedEnd = hingeAtEnd ? { x: sx, y: sy } : { x: ex, y: ey };
  const closedAngle = Math.atan2(closedEnd.y - hinge.y, closedEnd.x - hinge.x);
  const swingValue = String(opening?.swing || opening?.swingDirection || '').toLowerCase();
  const sign = preserveTrace
    ? (swingValue === "clockwise" ? -1 : 1)
    : ["right", "clockwise", "cw", "out"].includes(swingValue) ? -1 : 1;
  const requestedAngle = Number(opening.openAngleDegrees);
  const angleDegrees = Number.isFinite(requestedAngle) ? Math.max(0,Math.min(90,requestedAngle)) : preserveTrace ? 60 : 0;
  const openAngle = closedAngle + sign * angleDegrees * Math.PI / 180;

  const leafWidth = preserveTrace || opening.preserveSourceDimensions ? openingWidth * 0.94 : Math.max(0.52, openingWidth * 0.94);
  const leafThickness = 0.042;
  const frameDepth = 0.095;
  const frameWidth = 0.055;

  const OpaqueMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const frameMaterial = new OpaqueMaterial({
    color: 0xb49a7d,
    side: THREE.DoubleSide,
    shininess: 24,
  });
  const handleMaterial = new OpaqueMaterial({
    color: 0xb8bdc2,
    side: THREE.DoubleSide,
    shininess: 70,
  });

  // Two full-height jambs around the opening.
  for (const p of [{ x: sx, y: sy }, { x: ex, y: ey }]) {
    const jamb = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth, frameDepth, leafHeight + 0.08),
      frameMaterial
    );
    jamb.position.set(p.x, p.y, (leafHeight + 0.08) / 2);
    jamb.rotation.z = closedAngle + Math.PI / 2;
    jamb.userData = { ventraType: 'schematic_door_jamb', schematic: true };
    group.add(jamb);
  }

  const frameHeader = new THREE.Mesh(
    new THREE.BoxGeometry(openingWidth + frameWidth * 1.5, frameDepth, frameWidth),
    frameMaterial
  );
  frameHeader.position.set(
    (sx + ex) / 2,
    (sy + ey) / 2,
    leafHeight + frameWidth / 2
  );
  frameHeader.rotation.z = closedAngle;
  frameHeader.userData = { ventraType: 'schematic_door_frame_header', schematic: true };
  group.add(frameHeader);

  const woodTexture=ventraGetSchematicTexture({THREE,kind:'doorwood',baseColor:'#ad8965',detailColor:'#71543d',accentColor:'#cfb99a'});
  const leafMaterial=material.clone();
  if(woodTexture){leafMaterial.color.setHex(0xffffff);leafMaterial.map=woodTexture;leafMaterial.bumpMap=woodTexture;leafMaterial.bumpScale=.002;}
  leafMaterial.shininess=18;
  // Leaf dimensions and hinge rotation remain tied to the observed opening.
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(leafWidth, leafThickness, leafHeight),
    leafMaterial
  );
  leaf.position.set(
    hinge.x + Math.cos(openAngle) * (leafWidth / 2),
    hinge.y + Math.sin(openAngle) * (leafWidth / 2),
    leafHeight / 2
  );
  leaf.rotation.z = openAngle;
  leaf.userData = { ventraType: 'schematic_door_panel', schematic: true };
  if(leaf.geometry.vertices&&THREE.Vector2){leaf.geometry.faceVertexUvs[0]=leaf.geometry.faces.map(f=>[f.a,f.b,f.c].map(i=>{const v=leaf.geometry.vertices[i];return new THREE.Vector2(v.x/leafWidth+.5,v.z/leafHeight+.5);}));leaf.geometry.uvsNeedUpdate=true;}
  leaf.castShadow=true;leaf.receiveShadow=true;
  group.add(leaf);

  // Hardware uses leaf-local axes, so it follows every hinge/swing orientation.
  const details=new THREE.Group();details.position.set(hinge.x,hinge.y,0);details.rotation.z=openAngle;
  const addDetail=(geometry,mat,x,y,z,type)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.userData={ventraType:type,schematic:true};mesh.castShadow=true;details.add(mesh);return mesh;};
  const handleX=leafWidth*.86,handleZ=Math.min(1.02,leafHeight*.49);
  for(const side of [-1,1]){
    addDetail(new THREE.CylinderGeometry(.027,.027,.006,24),handleMaterial,handleX,side*(leafThickness/2+.003),handleZ,'schematic_door_rosette');
    addDetail(new THREE.CylinderGeometry(.009,.009,.035,16),handleMaterial,handleX,side*(leafThickness/2+.02),handleZ,'schematic_door_spindle');
    const lever=addDetail(new THREE.CylinderGeometry(.009,.009,.12,16),handleMaterial,handleX-.05,side*(leafThickness/2+.038),handleZ,'schematic_door_handle');lever.rotation.z=Math.PI/2;
    // Shallow panel mouldings, contained inside the observed door leaf.
    const inset=.085,panelW=Math.max(.05,leafWidth-2*inset);
    for(const [bottom,top] of [[.18,leafHeight*.43],[leafHeight*.56,leafHeight-.16]]){
      if(top<=bottom)continue;
      for(const z of [bottom,top])addDetail(new THREE.BoxGeometry(panelW,.006,.012),frameMaterial,leafWidth/2,side*(leafThickness/2+.003),z,'schematic_door_moulding');
      for(const x of [inset,leafWidth-inset])addDetail(new THREE.BoxGeometry(.012,.006,top-bottom),frameMaterial,x,side*(leafThickness/2+.003),(bottom+top)/2,'schematic_door_moulding');
    }
  }
  for(const fraction of [.17,.5,.83]){
    const hingeBar=addDetail(new THREE.CylinderGeometry(.012,.012,.075,16),handleMaterial,.01,0,leafHeight*fraction,'schematic_door_hinge');hingeBar.rotation.x=Math.PI/2;
  }
  group.add(details);

  // Plan swing arc stays near floor so opening direction remains readable.
  const arcPoints = [];
  const steps = 22;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = closedAngle + (openAngle - closedAngle) * t;
    arcPoints.push({
      x: hinge.x + Math.cos(angle) * leafWidth,
      y: hinge.y + Math.sin(angle) * leafWidth,
      z: 0.025,
    });
  }

  const arcGeometry = ventraCreateLineGeometry(THREE, arcPoints);
  if (arcGeometry && THREE.LineBasicMaterial) {
    const arcMaterial = new THREE.LineBasicMaterial({
      color: 0x7a6553,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const arc = ventraCreateLineSegmentsObject(THREE, arcGeometry, arcMaterial);
    if (arc) {
      arc.userData = { ventraType: 'schematic_door_arc', schematic: true, nonSelectable: true };
      group.add(arc);
    }
  }

  group.userData = {
    ventraType: 'schematic_door_leaf',
    schematic: true,
  };

  return group;
}

function ventraCreateWindowVisual({ THREE, opening, glassMaterial, frameMaterial, wallThickness = 0.18 }) {
  if (!THREE || !opening?.start || !opening?.end) return null;

  const sx = Number(opening.start.x);
  const sy = Number(opening.start.y);
  const ex = Number(opening.end.x);
  const ey = Number(opening.end.y);
  const sillHeight = opening.preserveRasterTrace || opening.preserveSourceDimensions ? Number(opening.sillHeight) : Math.max(0.55, Number(opening?.sillHeight) || 0.9);
  const windowHeight = opening.preserveRasterTrace || opening.preserveSourceDimensions ? Number(opening.height) : Math.max(0.45, Number(opening?.height) || 1.2);

  if (![sx, sy, ex, ey, sillHeight, windowHeight].every(Number.isFinite)) return null;

  const dx = ex - sx;
  const dy = ey - sy;
  const width = Math.hypot(dx, dy);
  if (width < (opening.preserveRasterTrace ? 0.005 : 0.2)) return null;

  const group = new THREE.Group();
  const angle = Math.atan2(dy, dx);
  const thickness = Math.max(0.03, Math.min(0.08, Number(wallThickness) * 0.40));
  const frameWidth = Math.min(0.075, Math.max(0.045, width * 0.035));

  // Glass is embedded in the opening, not floating in front of the wall.
  const pane = createWallMesh({
    THREE,
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
    height: windowHeight,
    thickness,
    zBase: sillHeight,
    material: glassMaterial,
  });
  if (pane) {
    pane.userData = { ventraType: 'schematic_window_glass', schematic: true };
    group.add(pane);
  }

  // Bottom and top frame rails.
  for (const z of [sillHeight, sillHeight + windowHeight - frameWidth]) {
    const rail = createWallMesh({
      THREE,
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      height: frameWidth,
      thickness: Math.max(thickness * 1.4, 0.055),
      zBase: z,
      material: frameMaterial,
    });
    if (rail) {
      rail.userData = { ventraType: 'schematic_window_frame_rail', schematic: true };
      group.add(rail);
    }
  }

  // Side jambs and a centre mullion.
  const jambHeight = Math.max(0.25, windowHeight - frameWidth * 2);
  const jambZ = sillHeight + frameWidth + jambHeight / 2;
  const jambDepth = Math.max(thickness * 1.4, 0.055);

  const addJamb = (x, y) => {
    const jamb = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth, jambDepth, jambHeight),
      frameMaterial
    );
    jamb.position.set(x, y, jambZ);
    jamb.rotation.z = angle + Math.PI / 2;
    jamb.userData = { ventraType: 'schematic_window_frame_jamb', schematic: true };
    group.add(jamb);
  };

  addJamb(sx, sy);
  addJamb(ex, ey);

  if (width >= 1.05) {
    addJamb((sx + ex) / 2, (sy + ey) / 2);
  }

  group.userData = {
    ventraType: 'schematic_window_assembly',
    schematic: true,
  };

  return group;
}

function ventraStructuredSceneIsValid(scene) {
  return Boolean(
    scene &&
    Array.isArray(scene.rooms) &&
    scene.rooms.length > 0 &&
    Array.isArray(scene.walls) &&
    scene.walls.length > 0
  );
}

function ventraScenePointToLocal(point, sceneWidth, sceneDepth) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: x - sceneWidth / 2,
    y: y - sceneDepth / 2,
  };
}


function ventraStructuredRoomMaterial(THREE, room, palette = {}) {
  const OpaqueMaterial =
    THREE.MeshPhongMaterial ||
    THREE.MeshLambertMaterial ||
    THREE.MeshBasicMaterial;

  const roomType =
    String(
      room?.type ||
      room?.name ||
      ""
    ).toLowerCase();

  let color = 0xcbbda2;

  if (/(bed|bedroom|master)/.test(roomType)) {
    color = 0xc9b99f;
  } else if (/(living|lounge|family)/.test(roomType)) {
    color = 0xd2c4a8;
  } else if (/(kitchen|dining)/.test(roomType)) {
    color = 0xc8b28e;
  } else if (/(bath|wc|toilet|shower)/.test(roomType)) {
    color = 0xb9c6ca;
  } else if (/(store|storage|closet)/.test(roomType)) {
    color = 0xb7b3aa;
  }

  return new OpaqueMaterial({
    color,
    side: THREE.DoubleSide,
    shininess: 8,
  });
}

function ventraRoomPolygonCentroid(points) {
  const valid =
    (Array.isArray(points) ? points : [])
      .map((point) => ({
        x: Number(point?.x),
        y: Number(point?.y),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
      );

  if (!valid.length) {
    return null;
  }

  return {
    x:
      valid.reduce(
        (sum, point) =>
          sum + point.x,
        0
      ) / valid.length,
    y:
      valid.reduce(
        (sum, point) =>
          sum + point.y,
        0
      ) / valid.length,
  };
}

function ventraBuildRoomLabelSprite({
  THREE,
  text,
  x,
  y,
  z = 0.12,
  scale = 1,
}) {
  if (
    typeof document === "undefined" ||
    !THREE?.Sprite ||
    !THREE?.SpriteMaterial ||
    !THREE?.Texture
  ) {
    return null;
  }

  try {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = 512;
    canvas.height = 128;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      return null;
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle =
      "rgba(28,32,36,0.66)";

    const radius = 18;
    const w = canvas.width;
    const h = canvas.height;

    ctx.beginPath();
    ctx.roundRect?.(
      8,
      8,
      w - 16,
      h - 16,
      radius
    );

    if (
      typeof ctx.roundRect !==
      "function"
    ) {
      ctx.rect(
        8,
        8,
        w - 16,
        h - 16
      );
    }

    ctx.fill();

    ctx.font =
      "600 38px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(
      String(text || "Room"),
      w / 2,
      h / 2
    );

    const texture =
      new THREE.Texture(
        canvas
      );

    texture.needsUpdate = true;

    if (
      THREE.LinearFilter !==
      undefined
    ) {
      texture.minFilter =
        THREE.LinearFilter;
      texture.magFilter =
        THREE.LinearFilter;
    }

    texture.generateMipmaps =
      false;

    if (
      THREE.ClampToEdgeWrapping !==
      undefined
    ) {
      texture.wrapS =
        THREE.ClampToEdgeWrapping;
      texture.wrapT =
        THREE.ClampToEdgeWrapping;
    }

    const material =
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

    const sprite =
      new THREE.Sprite(
        material
      );

    sprite.position.set(
      x,
      y,
      z
    );

    sprite.scale.set(
      1.45 * scale,
      0.36 * scale,
      1
    );

    sprite.userData = {
      ventraType:
        "schematic_room_label",
      schematic: true,
      nonSelectable: true,
    };

    return sprite;
  } catch {
    return null;
  }
}


function ventraAttachSchematicLights({ THREE, root }) {
  if (!THREE || !root) return;

  try {
    const lightGroup = new THREE.Group();
    lightGroup.name = 'ventra_schematic_lights';

    if (THREE.AmbientLight) {
      lightGroup.add(new THREE.AmbientLight(0xFFFFFF, 0.42));
    }

    if (THREE.DirectionalLight) {
      const key = new THREE.DirectionalLight(0xFFF7EE, 0.62);
      key.position.set(11, -13, 20);
      lightGroup.add(key);

      const fill = new THREE.DirectionalLight(0xDBE7EF, 0.24);
      fill.position.set(-10, 8, 14);
      lightGroup.add(fill);

      const rim = new THREE.DirectionalLight(0xF7F1E6, 0.14);
      rim.position.set(0, 14, 9);
      lightGroup.add(rim);
    }

    root.add(lightGroup);
  } catch {}
}

function ventraBuildTracedRasterFloor({ THREE, polygon, holes = [], material, z = 0 }) {
  const trace = (path, points) => {
    path.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) path.lineTo(point.x, point.y);
    path.closePath();
    return path;
  };
  const shape = trace(new THREE.Shape(), polygon);
  for (const points of holes) shape.holes.push(trace(new THREE.Path(), points));
  const geometry = new THREE.ShapeGeometry(shape);
  if (!(geometry.faces?.length || geometry.attributes?.position?.count)) {
    geometry.dispose?.();
    throw new Error("The traced raster floor could not be triangulated.");
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return { mesh, reason: "traced_raster_floor_with_real_voids" };
}

function renderStructuredSchematicScene(viewer, scene) {
  // Display the accepted scene verbatim: geometry repair belongs to analysis, never rendering.
  const THREE = getThree();
  if (!viewer || !scene || !THREE) {
    throw new Error("Structured schematic 3D renderer is not ready.");
  }

  clearSchematicOverlay(viewer);

  const schematicRoot = new THREE.Group();
  schematicRoot.name = VENTRA_SCHEMATIC_ROOT_NAME;
  const targetScene = viewer?.impl?.sceneAfter || viewer?.impl?.scene;
  if (!targetScene?.add) {
    throw new Error("Standalone structured schematic render scene is unavailable.");
  }
  targetScene.add(schematicRoot);

  const preserveRasterTrace = scene.rasterGeometryVersion === "raster-metric-trace-v1";
  const width = preserveRasterTrace ? Number(scene.width) : Math.max(2, Number(scene.width) || 12.5);
  const depth = preserveRasterTrace ? Number(scene.depth) : Math.max(2, Number(scene.depth) || 9.5);
  const fullHeight = preserveRasterTrace ? Number(scene.height) : Math.max(2.4, Math.min(3.4, Number(scene.height) || 2.8));
  const cutawayHeight = fullHeight;
  const externalThickness = Math.max(0.12, Number(scene.externalWallThickness) || 0.18);
  const internalThickness = Math.max(0.08, Number(scene.wallThickness) || 0.12);
  const palette = scene.palette || {};

  const OpaqueMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const GlassMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;

  const wallMat = new OpaqueMaterial({
    color: ventraReadableSchematicColor(palette.wall, 0xe8e2d9, 220),
    side: THREE.DoubleSide,
    shininess: 4,
    specular:0x0c0c0c,
  });
  const externalWallMat = new OpaqueMaterial({
    color: hexNumber(palette.externalWall, 0x474a4d),
    side: THREE.DoubleSide,
    shininess: 8,
  });
  const floorMat = new OpaqueMaterial({
    color: ventraReadableSchematicColor(palette.floor, 0x9f8b70, 170),
    side: THREE.DoubleSide,
    shininess: 10,
  });
  const glassMat = new GlassMaterial({
    color: ventraReadableSchematicColor(palette.glass, 0x6f96aa, 205),
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
    shininess: 55,
  });
  const windowFrameMat = new OpaqueMaterial({
    color: 0x747a7d,
    side: THREE.DoubleSide,
    shininess: 32,
  });
  const doorMat = new OpaqueMaterial({
    color: ventraReadableSchematicColor(palette.door || palette.accent, 0x7b573e, 190),
    side: THREE.DoubleSide,
    shininess: 9,
  });

  const bounds = new THREE.Box3();
  let roomCount = 0;
  let wallPieceCount = 0;
  let openingCount = 0;
  let assetMeshCount = 0;

  const addReadableEdges = (mesh) => {
    if (!mesh?.geometry || !THREE?.EdgesGeometry || !THREE?.LineSegments || !THREE?.LineBasicMaterial) return;
    if (mesh.material?.transparent && Number(mesh.material.opacity) < 0.75) return;
    try {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 24),
        new THREE.LineBasicMaterial({ color: 0x5b5650, transparent: true, opacity: 0.28 })
      );
      edges.userData = { ventraType: 'schematic_edges', schematic: true, nonSelectable: true };
      mesh.add(edges);
    } catch {}
  };

  const add = (mesh) => {
    if (!mesh) return;
    if(scene.presentationEdges === true) addReadableEdges(mesh);
    try {
      if (mesh.geometry && mesh.material && !mesh.material?.transparent) {
        // Tall cutaway walls must not black out the plan. Keep furniture contact shadows.
        mesh.castShadow = !!mesh.userData?.originalVentraType;
        mesh.receiveShadow = true;
      }
    } catch {}
    schematicRoot.add(mesh);
    try {
      mesh.updateMatrixWorld(true);
      bounds.expandByObject(mesh);
    } catch {}
  };

  // V35: draw the validated outer footprint first, then layer room finishes above it.
  // This prevents black interior gaps when room polygons miss circulation slivers,
  // while the ear-clipping mesh avoids THREE r71 concave-polygon artifacts.
  const BaseFloorMaterial =
    THREE.MeshPhongMaterial ||
    THREE.MeshLambertMaterial ||
    THREE.MeshBasicMaterial;

  const baseFloorMaterial = new BaseFloorMaterial({
    // V41: uncovered circulation/slivers are valid floor plate, never a black void.
    color: ventraReadableSchematicColor(palette.floor, 0xb7a68f, 188),
    side: THREE.DoubleSide,
    shininess: 5,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const footprintPoints =
    (Array.isArray(scene?.footprint) ? scene.footprint : [])
      .map((point) => ventraScenePointToLocal(point, width, depth))
      .filter(Boolean);

  if (footprintPoints.length >= 3) {
    const footprintBuilder = preserveRasterTrace ? ventraBuildTracedRasterFloor : ventraBuildConcaveFloorMesh;
    const footprintResult = footprintBuilder({
      THREE,
      polygon: footprintPoints,
      holes: preserveRasterTrace ? (scene.holes || []).map((hole) => hole.polygon.map((point) => ventraScenePointToLocal(point, width, depth))) : [],
      z: 0,
      material: baseFloorMaterial,
    });

    if (footprintResult?.mesh) {
      footprintResult.mesh.userData = {
        ventraType: 'schematic_footprint_floor_v36',
        schematic: true,
      };
      add(footprintResult.mesh);
    }

    console.log('[VENTRA JPG FOOTPRINT FIRST v41]', {
      pointCount: footprintPoints.length,
      strategy: footprintResult?.reason || 'unknown',
      roomCount: Array.isArray(scene?.rooms) ? scene.rooms.length : 0,
      width,
      depth,
    });
  } else {
    console.warn('[VENTRA JPG FOOTPRINT FIRST v41] missing footprint; room floors only');
  }

  // V36: render ONLY explicitly detected real holes/shafts as dark cut-out caps.
  // Uncovered room gaps are NOT treated as voids anymore because the footprint
  // base floor exists underneath them.
  const sceneHoles =
    (Array.isArray(scene?.holes) ? scene.holes : [])
      .filter((hole) => ["shaft", "courtyard"].includes(String(hole?.type || "").toLowerCase()));

  if (sceneHoles.length && !preserveRasterTrace) {
    const HoleMaterial =
      THREE.MeshBasicMaterial ||
      THREE.MeshLambertMaterial ||
      THREE.MeshPhongMaterial;

    const holeMaterial =
      new HoleMaterial({
        color:
          hexNumber(
            scene.backgroundColor ||
              "#262A30",
            0x262a30
          ),
        side:
          THREE.DoubleSide,
      });

    let renderedHoleCount = 0;

    for (const hole of sceneHoles) {
      const polygon =
        (Array.isArray(hole?.polygon) ? hole.polygon : [])
          .map((point) => ventraScenePointToLocal(point, width, depth))
          .filter(Boolean);

      if (polygon.length < 3) continue;

      const holeResult =
        ventraBuildConcaveFloorMesh({
          THREE,
          polygon,
          z: 0.026,
          material:
            holeMaterial,
        });

      if (holeResult?.mesh) {
        holeResult.mesh.userData = {
          ventraType:
            "schematic_real_hole_v36",
          holeId:
            hole?.id || null,
          holeType:
            hole?.type || "void",
          schematic: true,
        };

        add(holeResult.mesh);
        renderedHoleCount += 1;
      }
    }

    console.log(
      "[VENTRA JPG REAL HOLES v41]",
      {
        detected:
          sceneHoles.length,
        rendered:
          renderedHoleCount,
      }
    );
  }

  // Room polygons are absolute plan coordinates in metres, origin at lower-left.
  // Convert them into the Viewer-centred coordinate system and create one floor
  // slab per room. This is the core difference from the old single-box renderer.
  for (const room of scene.rooms || []) {
    const rawPolygon = Array.isArray(room?.polygon)
      ? room.polygon
      : Array.isArray(room?.points)
        ? room.points
        : [];
    if(room.scopeOnly)continue;
    const polygon = rawPolygon
      .map((point) => ventraScenePointToLocal(point, width, depth))
      .filter(Boolean);
    if (polygon.length < 3) continue;

    const material =
      ventraCreateRoomFloorMaterial({
        THREE,
        room,
        palette,
        polygon,
      });

    const roomFloorBuilder = preserveRasterTrace ? ventraBuildTracedRasterFloor : buildFloorMesh;
    const result =
      roomFloorBuilder({
        THREE,
        polygon,
        z: 0,
        material,
      });

    if (result?.mesh) {
      ventraApplyFloorMaterialUVs(THREE,result.mesh.geometry);
      result.mesh.receiveShadow=true;
      result.mesh.userData = {
        ventraType:
          "schematic_room_floor",
        roomId:
          room?.id || null,
        roomName:
          room?.name || null,
        schematic: true,
      };

      add(result.mesh);

      if (!material.map) ventraAddVisibleFloorPattern({
        THREE,
        root:
          schematicRoot,
        polygon,
        material,
        z: 0.022,
      });

      roomCount += 1;

      const centroid =
        ventraRoomPolygonCentroid(
          polygon
        );

      if (
        centroid &&
        scene?.showRoomLabels ===
          true
      ) {
        const roomLabel =
          ventraBuildRoomLabelSprite({
            THREE,
            text:
              room?.name ||
              room?.type ||
              "Room",
            x: centroid.x,
            y: centroid.y,
            z: 0.12,
            scale:
              /bath|store/i.test(
                String(
                  room?.type ||
                  room?.name ||
                  ""
                )
              )
                ? 0.55
                : 0.68,
          });

        if (roomLabel) {
          schematicRoot.add(
            roomLabel
          );
        }
      }
    }
  }

  const railingPostKeys = new Set();
  const wallMap = new Map();
  for (const wall of scene.walls || []) {
    if (wall?.id) wallMap.set(String(wall.id), wall);
  }

  for (const wall of scene.walls || []) {
    const start = ventraScenePointToLocal(wall?.start, width, depth);
    const end = ventraScenePointToLocal(wall?.end, width, depth);
    if (!start || !end) continue;
    const wallLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(wallLength) || wallLength < (preserveRasterTrace ? 0.001 : 0.05)) continue;

    const wallType = String(wall?.type || 'internal').toLowerCase();
    const thickness = wallType === 'external' ? externalThickness : internalThickness;
    const requestedWallHeight = Number(wall?.height);

    // Architectural wall geometry must use real wall height. Previous versions
    // reused the dollhouse cutaway height for internal partitions, which made
    // doors look taller than the walls and destroyed scale perception.
    const displayHeight = wallType === 'railing' ? Math.max(.5,Math.min(1.2,requestedWallHeight||1.1)) : Number.isFinite(requestedWallHeight) && requestedWallHeight >= 2.2
      ? Math.min(fullHeight, requestedWallHeight)
      : fullHeight;

    if(wallType === 'railing') {
      for(const mesh of ventraBuildBalconyRailing({THREE,wall,start,end,height:displayHeight,palette,postKeys:railingPostKeys}))add(mesh);
      continue;
    }

    const wallOpenings = (scene.openings || [])
      .filter((opening) => String(opening?.wallId || '') === String(wall?.id || ''))
      .map((opening) => {
        // The raster compiler already checked the jamb span and owning wall.
        // Preserve it exactly, including narrow/low/edge-adjacent openings.
        if (preserveRasterTrace || scene.furnishingMode === "source_observed") {
          return {
            ...opening,
            preserveRasterTrace,
            preserveSourceDimensions: scene.furnishingMode === "source_observed",
            wallPosition: pointAlongSegment(start, end, Number(opening.offset)),
          };
        }
        const type = opening?.type === 'window' ? 'window' : 'door';
        const offset = Math.max(0.025, Math.min(0.975, Number(opening?.offset) || 0.5));
        const maxOpeningWidth = Math.max(0.45, wallLength - 0.16);
        const rawWidth = Number(opening?.width);
        const openingWidth = Math.min(
          maxOpeningWidth,
          Math.max(0.45, Number.isFinite(rawWidth) ? rawWidth : (type === 'window' ? 1.4 : 0.9))
        );

        if (type === 'door') {
          const rawDoorHeight = Number(opening?.height);
          return {
            ...opening,
            type,
            wallPosition: pointAlongSegment(start, end, offset),
            width: openingWidth,
            height: Math.max(
              1.9,
              Math.min(
                Number.isFinite(rawDoorHeight) ? rawDoorHeight : 2.1,
                2.15,
                displayHeight - 0.16
              )
            ),
            sillHeight: 0,
          };
        }

        const rawSill = Number(opening?.sillHeight);
        const sillHeight = Math.max(
          0.55,
          Math.min(
            Number.isFinite(rawSill) ? rawSill : 0.9,
            displayHeight - 0.85
          )
        );
        const rawWindowHeight = Number(opening?.height);
        const windowHeight = Math.max(
          0.45,
          Math.min(
            Number.isFinite(rawWindowHeight) ? rawWindowHeight : 1.2,
            displayHeight - sillHeight - 0.18
          )
        );

        return {
          ...opening,
          type,
          wallPosition: pointAlongSegment(start, end, offset),
          width: openingWidth,
          height: windowHeight,
          sillHeight,
        };
      });

    const pieces = splitWallByOpenings({
      start,
      end,
      openings: wallOpenings,
      minimumWallPiece: preserveRasterTrace || scene.furnishingMode === "source_observed" ? 0.001 : 0.06,
      preserveRasterTrace,
    });

    for (const piece of pieces) {
      const mesh = createWallMesh({
        THREE,
        start: piece.start,
        end: piece.end,
        height: displayHeight,
        thickness,
        zBase: 0,
        material: wallType === 'external' ? externalWallMat : wallMat,
      });
      if (!mesh) continue;
      mesh.userData = {
        ventraType: 'schematic_plan_wall',
        wallId: wall?.id || null,
        wallKind: wallType,
        schematic: true,
      };
      add(mesh);
      wallPieceCount += 1;
    }

    for (const opening of wallOpenings) {
      const half = (opening.width / 2) / wallLength;
      const centerT = projectPointToSegment2D(opening.wallPosition, start, end).t;
      opening.start = pointAlongSegment(start, end, Math.max(0, centerT - half));
      opening.end = pointAlongSegment(start, end, Math.min(1, centerT + half));

      if (opening.type === 'window') {
        // The horizontal wall split removes the entire wall column. Rebuild
        // the solid wall below and above the window so glass is physically
        // embedded in the wall instead of floating in space.
        const sillWall = buildWindowSillWallMesh({
          THREE,
          opening,
          thickness,
          zBase: 0,
          material: wallType === 'external' ? externalWallMat : wallMat,
        });
        add(sillWall);

        const headerWall = buildHeaderWallMesh({
          THREE,
          opening,
          thickness,
          wallHeight: displayHeight,
          zBase: 0,
          material: wallType === 'external' ? externalWallMat : wallMat,
        });
        add(headerWall);

        const windowAssembly = opening.cutOnly ? null : ventraCreateWindowVisual({
          THREE,
          opening,
          glassMaterial: glassMat,
          frameMaterial: windowFrameMat,
          wallThickness: thickness,
        });
        if(!opening.cutOnly)add(windowAssembly);
      } else {
        // Fill wall above the door opening; otherwise the renderer leaves an
        // unrealistic floor-to-ceiling slot above every door.
        const doorHeaderWall = buildHeaderWallMesh({
          THREE,
          opening,
          thickness,
          wallHeight: displayHeight,
          zBase: 0,
          material: wallType === 'external' ? externalWallMat : wallMat,
        });
        add(doorHeaderWall);

        const doorLeaf = opening.cutOnly||opening.variant==='passage' ? null : ventraCreateDoorLeafVisual({
          THREE,
          opening,
          material: doorMat,
          wallHeight: displayHeight,
        });
        if(!opening.cutOnly&&opening.variant!=='passage')add(doorLeaf);
      }
      if(!opening.cutOnly)openingCount += 1;
    }
  }

  for (const asset of (scene.sceneType === 'floorplan_interactive_preview' ? ventraPresentationAssets(scene) : scene.assets || [])) {
    const meshes = buildSchematicAssetMeshes({
      THREE,
      asset,
      palette,
      roomWidth: width,
      roomDepth: depth,
    });
    meshes.forEach(add);
    const shade=ventraFurnitureContactShade({THREE,asset,roomWidth:width,roomDepth:depth});
    if(shade)schematicRoot.add(shade);
    assetMeshCount += meshes.length;
  }

  try {
    const bg = hexNumber(scene.backgroundColor || '#262A30', 0x262a30);
    const r = (bg >> 16) & 255;
    const g = (bg >> 8) & 255;
    const b = bg & 255;
    viewer.setBackgroundColor?.(r, g, b, r, g, b);
  } catch {}

  if(scene.designDefaults?.viewOriginMeters){
    const origin=scene.designDefaults.viewOriginMeters;
    schematicRoot.position.set(width/2-origin.x,depth/2-origin.y,0);
    bounds.translate(schematicRoot.position);
  }
  schematicRoot.updateMatrixWorld(true);
  try { viewer.impl?.sceneUpdated?.(true); } catch {}
  viewer.impl?.invalidate?.(true, true, true);

  const serializedBounds = serializeBox3(bounds);
  try {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 3);
    const position =
      new THREE.Vector3(
        center.x +
          maxDimension * 0.78,
        center.y -
          maxDimension * 1.04,
        center.z +
          maxDimension * 1.20
      );

    if (viewer.navigation?.toOrthographic) {
      viewer.navigation.toOrthographic();
    } else {
      viewer.navigation?.toPerspective?.();
    }
    viewer.navigation?.setView?.(position, center);
    viewer.navigation?.setPivotPoint?.(center);
    viewer.navigation?.setCameraUpVector?.(new THREE.Vector3(0, 0, 1));
    viewer.setActiveNavigationTool?.('orbit');
    viewer.impl?.invalidate?.(
      true,
      true,
      true
    );

    if (
      typeof window !==
      "undefined"
    ) {
      window.requestAnimationFrame(
        () => {
          try {
            viewer.navigation
              ?.setView?.(
                position,
                center
              );
            viewer.navigation
              ?.setPivotPoint?.(
                center
              );
            viewer.impl
              ?.invalidate?.(
                true,
                true,
                true
              );
          } catch {}
        }
      );
    }
  } catch {}

  console.log('[VENTRA JPG READABLE DOLLHOUSE v8]', { roomCount, wallPieceCount, openingCount, assetMeshCount });

  console.log('[VENTRA JPG RENDER INTEGRITY v41]', {
    roomsReceived: Array.isArray(scene.rooms) ? scene.rooms.length : 0,
    wallsReceived: Array.isArray(scene.walls) ? scene.walls.length : 0,
    openingsReceived: Array.isArray(scene.openings) ? scene.openings.length : 0,
    assetsReceived: Array.isArray(scene.assets) ? scene.assets.length : 0,
    holesRendered: sceneHoles.length,
    footprintPoints: Array.isArray(scene.footprint) ? scene.footprint.length : 0,
  });

  console.log('[VENTRA JPG GENERIC STRUCTURED FLOOR PLAN 3D v41]', {
    sceneType: scene.sceneType,
    roomCount,
    wallCount: Array.isArray(scene.walls) ? scene.walls.length : 0,
    wallPieceCount,
    openingCount,
    assetCount: Array.isArray(scene.assets) ? scene.assets.length : 0,
    assetMeshCount,
    width,
    depth,
  });

  return {
    bounds: serializedBounds,
    schematic: true,
    structured: true,
    sceneType: scene.sceneType || 'apartment_floorplan',
    title: scene.title || 'Floor Plan 3D',
    roomCount,
    wallPieceCount,
    openingCount,
    assetCount: Array.isArray(scene.assets) ? scene.assets.length : 0,
    assetMeshCount,
    width,
    depth,
    height: fullHeight,
  };
}

function renderSchematicScene(viewer, scene) {
  if (ventraStructuredSceneIsValid(scene)) {
    return renderStructuredSchematicScene(viewer, scene);
  }

  const THREE = getThree();
  if (!viewer || !scene || !THREE) throw new Error("Schematic 3D renderer is not ready.");
  clearSchematicOverlay(viewer);

  // Standalone JPG scenes cannot rely on Autodesk overlay rendering because
  // there may be no Autodesk model loaded. Render into sceneAfter instead.
  const schematicRoot = new THREE.Group();
  schematicRoot.name = VENTRA_SCHEMATIC_ROOT_NAME;
  const targetScene = viewer?.impl?.sceneAfter || viewer?.impl?.scene;
  if (!targetScene?.add) {
    throw new Error("Autodesk standalone schematic render scene is unavailable.");
  }
  targetScene.add(schematicRoot);

  const width = Math.max(1.8, Number(scene.width) || 4.8);
  const depth = Math.max(1.8, Number(scene.depth) || 4.2);
  const height = Math.max(2.2, Number(scene.height) || 2.8);
  const thickness = 0.12;
  const palette = scene.palette || {};
  const OpaqueMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;
  const GlassMaterial = THREE.MeshPhongMaterial || THREE.MeshLambertMaterial || THREE.MeshBasicMaterial;

  const wallMat = new OpaqueMaterial({
    color: ventraReadableSchematicColor(palette.wall, 0xd5cec2, 218),
    side: THREE.DoubleSide,
    shininess: 4
  });

  const floorMat = new OpaqueMaterial({
    color: ventraReadableSchematicColor(palette.floor, 0xb39f82, 205),
    side: THREE.DoubleSide,
    shininess: 8
  });

  const glassMat = new GlassMaterial({
    color: ventraReadableSchematicColor(palette.glass, 0x6f96aa, 205),
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
    shininess: 55
  });

  const bounds = new THREE.Box3();
  let assetMeshCount = 0, openingCount = 0, wallPieceCount = 0;

  const addReadableEdges = (mesh) => {
    if (
      !mesh?.geometry ||
      !THREE?.EdgesGeometry ||
      !THREE?.LineSegments ||
      !THREE?.LineBasicMaterial
    ) {
      return;
    }

    const material = mesh.material;
    if (material?.transparent && Number(material?.opacity) < 0.75) {
      return;
    }

    try {
      const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 24);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x625d57,
        transparent: true,
        opacity: 0.32,
      });

      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edges.userData = {
        ventraType: "schematic_edges",
        schematic: true,
        nonSelectable: true,
      };
      mesh.add(edges);
    } catch {}
  };

  const add = (mesh) => {
    if (!mesh) return;
    if(scene.presentationEdges === true) addReadableEdges(mesh);
    if (mesh.geometry && mesh.material && !mesh.material.transparent) {
      mesh.castShadow = mesh.userData?.ventraType !== 'schematic_floor';
      mesh.receiveShadow = true;
    }
    schematicRoot.add(mesh);
    try {
      mesh.updateMatrixWorld(true);
      bounds.expandByObject(mesh);
    } catch {}
  };

  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, depth, 0.08), floorMat);
  floor.position.set(0, 0, -0.04); floor.userData={ventraType:"schematic_floor",schematic:true}; add(floor);

  const walls = [
    {name:"south",start:{x:-width/2,y:-depth/2},end:{x:width/2,y:-depth/2}},
    {name:"north",start:{x:width/2,y:depth/2},end:{x:-width/2,y:depth/2}},
    {name:"east",start:{x:width/2,y:-depth/2},end:{x:width/2,y:depth/2}},
    {name:"west",start:{x:-width/2,y:depth/2},end:{x:-width/2,y:-depth/2}},
  ];

  const interiorScene =
    !/(exterior|facade|elevation)/i.test(
      String(scene.sceneType || scene.title || "")
    );

  for (const wall of walls) {
    // The default schematic camera looks from +X / -Y.
    // East + South are therefore the two front walls. Keeping both at full
    // height turns every interior scene into an opaque box. In interior mode
    // they become low cutaway walls so furniture and room layout remain visible.
    const isFrontCutaway =
      interiorScene &&
      (wall.name === "south" || wall.name === "east");

    if (isFrontCutaway) {
      const cutawayHeight =
        Math.min(
          1.0,
          Math.max(0.72, height * 0.34)
        );

      const cutawayWall =
        createWallMesh({
          THREE,
          start: wall.start,
          end: wall.end,
          height: cutawayHeight,
          thickness,
          zBase: 0,
          material: wallMat,
        });

      if (cutawayWall) {
        cutawayWall.userData = {
          ventraType: "schematic_cutaway_wall",
          wall: wall.name,
          schematic: true,
          cutaway: true,
        };
        add(cutawayWall);
        wallPieceCount += 1;
      }

      // Count original openings for inspector accuracy, but do not rebuild
      // full-height headers/windows on the two cutaway walls.
      openingCount +=
        (scene.openings || []).filter(
          (o) => o.wall === wall.name
        ).length;

      continue;
    }

    const wallOpenings = (scene.openings || []).filter(o=>o.wall===wall.name).map(o=>{
      const t=Math.max(0.02,Math.min(0.98,Number(o.offset)||0.5));
      const center=pointAlongSegment(wall.start,wall.end,t);
      return { type:o.type, wallPosition:center, width:Number(o.width)||0.9, height:Number(o.height)||2.1, sillHeight:Number(o.sillHeight)||0 };
    });

    const pieces=splitWallByOpenings({start:wall.start,end:wall.end,openings:wallOpenings,minimumWallPiece:0.06});

    for(const piece of pieces){
      const mesh=createWallMesh({THREE,start:piece.start,end:piece.end,height,thickness,zBase:0,material:wallMat});
      if(mesh){
        mesh.userData={ventraType:"schematic_wall",wall:wall.name,schematic:true};
        add(mesh);
        wallPieceCount++;
      }
    }

    for(const o of wallOpenings){
      const len = Math.hypot(wall.end.x-wall.start.x, wall.end.y-wall.start.y);
      const half=(o.width/2)/len;
      const centerT=projectPointToSegment2D(o.wallPosition,wall.start,wall.end).t;
      o.start=pointAlongSegment(wall.start,wall.end,Math.max(0,centerT-half));
      o.end=pointAlongSegment(wall.start,wall.end,Math.min(1,centerT+half));

      const header=buildHeaderWallMesh({THREE,opening:o,thickness,wallHeight:height,zBase:0,material:wallMat});
      add(header);

      const sill=buildWindowSillWallMesh({THREE,opening:o,thickness,zBase:0,material:wallMat});
      add(sill);

      if(o.type==="window"){
        const pane=createWallMesh({THREE,start:o.start,end:o.end,height:o.height,thickness:0.025,zBase:o.sillHeight,material:glassMat});
        if(pane){
          pane.userData={ventraType:"schematic_window",schematic:true};
          add(pane);
        }
      }

      openingCount++;
    }
  }

  for(const asset of scene.assets || []){
    const meshes=buildSchematicAssetMeshes({THREE,asset,palette,roomWidth:width,roomDepth:depth});
    meshes.forEach(add); assetMeshCount += meshes.length;
    const shade=ventraFurnitureContactShade({THREE,asset,roomWidth:width,roomDepth:depth});
    if(shade)schematicRoot.add(shade);
  }

  try {
    const bg = hexNumber(scene.backgroundColor || "#262A30", 0x262a30);
    const r = (bg >> 16) & 255; const g = (bg >> 8) & 255; const b = bg & 255;
    viewer.setBackgroundColor?.(r, g, b, r, g, b);
  } catch {}
  schematicRoot.updateMatrixWorld(true);
  try { viewer.impl?.sceneUpdated?.(true); } catch {}
  viewer.impl.invalidate(true,true,true);
  const serializedBounds=serializeBox3(bounds);

  const frameSchematic = () => {
    try {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 3);

      const position = new THREE.Vector3(
        center.x + maxDimension * 1.18,
        center.y - maxDimension * 1.28,
        center.z + maxDimension * 0.95
      );

      viewer.navigation?.toPerspective?.();
      viewer.navigation?.setView?.(position, center);
      viewer.navigation?.setPivotPoint?.(center);
      viewer.navigation?.setCameraUpVector?.(
        new THREE.Vector3(0, 0, 1)
      );
      viewer.setActiveNavigationTool?.("orbit");
      viewer.impl?.invalidate?.(true, true, true);
      return true;
    } catch {
      return false;
    }
  };

  frameSchematic();

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      frameSchematic();
      try { viewer.impl?.sceneUpdated?.(true); } catch {}
      viewer.impl?.invalidate?.(true, true, true);
    });
  }
  return { bounds:serializedBounds, schematic:true, sceneType:scene.sceneType||"room", title:scene.title||"AI Schematic", wallPieceCount, openingCount, assetCount:(scene.assets||[]).length, assetMeshCount, width, depth, height };
}

// Presentation only: restore every material/shadow property when disabled.
function ventraBuildBalconyRailing({THREE,wall,start,end,height,palette={},postKeys=new Set()}){
 const length=Math.hypot(end.x-start.x,end.y-start.y);if(length<.05)return [];
 const angle=Math.atan2(end.y-start.y,end.x-start.x),h=height,meshes=[];
 const metal=new THREE.MeshPhongMaterial({color:hexNumber(palette.metal,0x374148),shininess:110,specular:0xb8b6b1});
 const glass=new THREE.MeshPhongMaterial({color:0xdcebf1,transparent:true,opacity:.24,depthWrite:false,shininess:90,side:THREE.DoubleSide});glass.userData={ventraMaterial:'railing_glass'};
 const point=t=>({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t});
 const register=(mesh,part)=>{mesh.userData={ventraType:'schematic_balcony_railing',railingPart:part,wallId:wall.id,schematic:true};mesh.castShadow=part!=='glass';mesh.receiveShadow=true;meshes.push(mesh);return mesh;};
 const box=(w,d,z,p,center,mat,part)=>{const mesh=new THREE.Mesh(ventraSoftFurnitureBox(THREE,w,d,z),mat);mesh.position.set(p.x,p.y,center);mesh.rotation.z=angle;return register(mesh,part);};
 const tube=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,length,24),metal);
 tube.position.set((start.x+end.x)/2,(start.y+end.y)/2,h-.022);tube.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(end.x-start.x,end.y-start.y,0).normalize());register(tube,'handrail');
 const bays=Math.max(1,Math.ceil(length/1.05)),span=length/bays;
 for(let i=0;i<=bays;i++){
  const p=point(i/bays),key=[p.x.toFixed(4),p.y.toFixed(4),h.toFixed(3)].join(':');
  if(!postKeys.has(key)){
   postKeys.add(key);box(.038,.038,h-.04,p,(h-.04)/2,metal,'post');box(.086,.086,.012,p,.006,metal,'base_plate');
   for(const offset of [-1,1]){const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.0045,.0045,.003,8),metal);bolt.rotation.x=Math.PI/2;bolt.position.set(p.x+Math.cos(angle)*offset*.025,p.y+Math.sin(angle)*offset*.025,.014);register(bolt,'bolt');}
  }
  if(i===bays)continue;
  const center=point((i+.5)/bays),panelWidth=Math.max(.01,span-.068);
  box(panelWidth,.012,h-.17,center,(h-.17)/2+.10,glass,'glass');
  for(const t of [(i+.03)/bays,(i+.97)/bays])for(const z of [.18,h-.16])box(.032,.031,.044,point(t),z,metal,'glass_clamp');
 }
 return meshes;
}

function ventraCreateInteriorView(root){
  const materials=new Map(),objects=new Map(),wallMaterials=new Set();
  root.traverse(object=>{if(['schematic_plan_wall','schematic_wall','schematic_cutaway_wall'].includes(object.userData?.ventraType))wallMaterials.add(object.material);});
  root.traverse(object=>{if(!wallMaterials.has(object.material))return;objects.set(object,object.castShadow);const mat=object.material;if(!materials.has(mat))materials.set(mat,{opacity:mat.opacity,transparent:mat.transparent,depthWrite:mat.depthWrite});});
  return enabled=>{for(const [mat,original] of materials){Object.assign(mat,enabled?{opacity:.045,transparent:true,depthWrite:false}:original);mat.needsUpdate=true;}for(const [object,shadow] of objects)object.castShadow=enabled?false:shadow;};
}

function mountStandaloneSchematicRenderer(container, sceneData, canvasElement, initialCameraState) {
  const THREE = getThree();
  if (!container || !sceneData || !canvasElement || !THREE?.WebGLRenderer || !THREE?.PerspectiveCamera) {
    throw new Error("Standalone schematic renderer is not available.");
  }

  const width = Math.max(320, container.clientWidth || 960);
  const height = Math.max(320, container.clientHeight || 640);
  const background = hexNumber(sceneData?.backgroundColor || "#D9DADC", 0x262a30);
  const rendererOptions = {
    sceneData,
    span: Math.max(4, Math.hypot(Number(sceneData.width)||12,Number(sceneData.depth)||8)),
    mobile: width <= 600,
    canvas: canvasElement,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  };
  let renderer;
  try { renderer = createPhysicalPreview(rendererOptions); }
  catch { renderer = new THREE.WebGLRenderer(rendererOptions); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width <= 600 ? 1.5 : 2));
  renderer.setSize(width, height, false);
  renderer.setClearColor(background, 1);
  try {
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) {
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    } else if ("shadowMapEnabled" in renderer) {
      renderer.shadowMapEnabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) {
        renderer.shadowMapType = THREE.PCFSoftShadowMap;
      }
    }
  } catch {}
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.zIndex = "2";

  const threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(background);

  configureSchematicLighting(THREE, renderer, threeScene, sceneData.width, sceneData.depth);

  const camera = new THREE.PerspectiveCamera(30, width / height, 0.02, 5000);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(0, 0, 1);
  let controlMode = "orbit";

  const render = () => {
    camera.lookAt(target);
    renderer.render(threeScene, camera);
  };

  const adapter = {
    impl: {
      sceneAfter: threeScene,
      scene: threeScene,
      invalidate: render,
      sceneUpdated: render,
      removeOverlayScene: () => {},
    },
    navigation: {
      toPerspective: () => {},
      setView: (position, center) => {
        if (position?.isVector3) camera.position.copy(position);
        if (center?.isVector3) target.copy(center);
        camera.up.set(0, 0, 1);
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        render();
      },
      setCameraUpVector: (up) => {
        if (up?.isVector3) camera.up.copy(up);
        camera.lookAt(target);
        render();
      },
    },
    setActiveNavigationTool: () => {},
    setBackgroundColor: (r, g, b) => {
      const color = new THREE.Color(r / 255, g / 255, b / 255);
      threeScene.background = color;
      renderer.setClearColor(color, 1);
      render();
    },
  };

  const model = renderSchematicScene(adapter, sceneData);
  const setInteriorView=ventraCreateInteriorView(threeScene);

  const getBoundsInfo = () => {
    const b = model?.bounds || {};
    const min = b.min || { x: -2, y: -2, z: 0 };
    const max = b.max || { x: 2, y: 2, z: 3 };
    const center = new THREE.Vector3(
      (Number(min.x) + Number(max.x)) / 2,
      (Number(min.y) + Number(max.y)) / 2,
      (Number(min.z) + Number(max.z)) / 2
    );
    const sx = Math.max(1, Number(max.x) - Number(min.x));
    const sy = Math.max(1, Number(max.y) - Number(min.y));
    const sz = Math.max(1, Number(max.z) - Number(min.z));
    return { center, distance: cameraFitDistance({x:sx,y:sy,z:sz},camera.fov,camera.aspect), sx, sy, sz };
  };

  const setNamedView = (view = "iso") => {
    const {center, distance} = getBoundsInfo();
    target.copy(center);
    const offset = namedCameraOffset(view,distance);
    camera.up.set(0, view === 'top' || view === 'bottom' ? 1 : 0, view === 'top' || view === 'bottom' ? 0 : 1);
    camera.position.set(center.x+offset.x,center.y+offset.y,center.z+offset.z);
    camera.near = Math.max(0.001,distance/10000); camera.far = Math.max(5000,distance*100);
    camera.lookAt(target); camera.updateProjectionMatrix(); render();
  };

  const orbit = (dx, dy) => {
    camera.up.set(0,0,1);
    const offset = orbitOffset(camera.position.clone().sub(target), -dx, dy);
    camera.position.set(target.x+offset.x,target.y+offset.y,target.z+offset.z);
    camera.lookAt(target); render();
  };

  const pan = (dx, dy) => {
    const distance = Math.max(0.01, camera.position.distanceTo(target) * 0.0018);
    const forward = target.clone().sub(camera.position).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const delta = right.multiplyScalar(-dx * distance).add(up.multiplyScalar(dy * distance));
    target.add(delta);
    camera.position.add(delta);
    render();
  };

  const zoomBy = (direction) => {
    const offset = camera.position.clone().sub(target);
    const factor = direction > 0 ? 0.88 : 1.14;
    const fit = getBoundsInfo().distance;
    const nextLength = Math.max(fit * 0.025, Math.min(fit * 20, offset.length() * factor));
    offset.setLength(nextLength);
    camera.position.copy(target).add(offset);
    render();
  };

  setNamedView("iso");
  if(initialCameraState){
    camera.position.fromArray(initialCameraState.position);camera.up.fromArray(initialCameraState.up);
    target.fromArray(initialCameraState.target);render();
  }

  let furnitureTool=null, furniturePreview=null, furniturePreviewTransforms=[];
  const raycaster=new THREE.Raycaster();
  const origin=sceneData.designDefaults?.viewOriginMeters||{x:sceneData.width/2,y:sceneData.depth/2};
  const rayFor=e=>{
    const r=renderer.domElement.getBoundingClientRect();if(!r.width||!r.height)return false;
    camera.updateMatrixWorld(true);threeScene.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);return true;
  };
  const pickPoint=e=>{
    if(!rayFor(e))return null;
    const p=raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),0),new THREE.Vector3());
    return p?{x:p.x+origin.x,y:p.y+origin.y}:null;
  };
  const clearFurniturePreview=()=>{
    const changed=furniturePreview||furniturePreviewTransforms.length;
    for(const {mesh,position,quaternion,scale} of furniturePreviewTransforms){mesh.position.copy(position);mesh.quaternion.copy(quaternion);mesh.scale.copy(scale);}
    furniturePreviewTransforms=[];
    if(furniturePreview){threeScene.remove(furniturePreview);furniturePreview.geometry.dispose();furniturePreview.material.dispose();furniturePreview=null;}
    if(changed)render();
  };
  const unbindFurniture=bindFurnitureInputs(renderer.domElement,{
    getTool:()=>furnitureTool,pickPoint,
    pickAsset:e=>rayFor(e)?raycaster.intersectObjects(threeScene.children,true).find(hit=>hit.object.visible&&hit.object.userData?.assetId)?.object.userData.assetId:null,
    clearPreview:clearFurniturePreview,
    preview:(a,valid)=>{
      clearFurniturePreview();if(!a)return;
      const original=sceneData.assets?.find(asset=>asset.id===a.id);
      if(valid&&['rotate','resize'].includes(a.previewOperation)&&original){
        const angle=((a.rotation||0)-(original.rotation||0))*Math.PI/180;
        const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle);
        const cx=original.xMeters-sceneData.width/2,cy=original.yMeters-sceneData.depth/2;
        threeScene.traverse(mesh=>{
          if(mesh.userData?.assetId!==a.id)return;
          const position=mesh.position.clone(),quaternion=mesh.quaternion.clone(),scale=mesh.scale.clone();
          furniturePreviewTransforms.push({mesh,position,quaternion,scale});
          const x=position.x-cx,y=position.y-cy;
          if(a.previewOperation==='resize'){
            const factor=a.width/original.width,z=Number(original.zMeters)||0;
            mesh.position.set(cx+x*factor,cy+y*factor,z+(position.z-z)*factor);mesh.scale.copy(scale).multiplyScalar(factor);
          }else{
            mesh.position.set(cx+x*Math.cos(angle)-y*Math.sin(angle),cy+x*Math.sin(angle)+y*Math.cos(angle),position.z);
            mesh.quaternion.multiplyQuaternions(q,quaternion);
          }
        });
      }
      furniturePreview=new THREE.Mesh(new THREE.BoxGeometry(a.width,a.depth,.025),new THREE.MeshBasicMaterial({color:valid?0x39dd81:0xff5544,transparent:true,opacity:.65,depthTest:false}));
      furniturePreview.position.set(a.xMeters-origin.x,a.yMeters-origin.y,.04);furniturePreview.rotation.z=(a.rotation||0)*Math.PI/180;
      threeScene.add(furniturePreview);render();
    }
  });

  const stopMotion=()=>{};
  const unbindInputs=bindProjectCameraInputs(renderer.domElement,{
    orbit,pan,getMode:()=>controlMode,home:()=>setNamedView('iso'),
    zoom:factor=>{const offset=camera.position.clone().sub(target),fit=getBoundsInfo().distance;
      offset.setLength(Math.max(fit*.025,Math.min(fit*20,offset.length()*factor)));camera.position.copy(target).add(offset);render();}
  });

  const resize = () => {
    if (!container.isConnected) return;
    const nextWidth = Math.max(1, container.clientWidth || width);
    const nextHeight = Math.max(1, container.clientHeight || height);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
    render();
  };
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  window.requestAnimationFrame(resize);

  return {
    model,
    render,
    ready:()=>renderer.readyResources?.(),
    captureCanvas:()=>{
      const size={width:renderer.domElement.width,height:renderer.domElement.height};
      const ratio=renderer.getPixelRatio?.()||1,logical={width:size.width/ratio,height:size.height/ratio};
      const scale=2048/Math.max(size.width,size.height);
      if(scale<=1){render();return renderer.domElement;}
      try{
        renderer.setPixelRatio(1);renderer.setSize(Math.round(size.width*scale),Math.round(size.height*scale),false);render();
        const copy=document.createElement('canvas');copy.width=renderer.domElement.width;copy.height=renderer.domElement.height;
        copy.getContext('2d').drawImage(renderer.domElement,0,0);return copy;
      }finally{renderer.setPixelRatio(ratio);renderer.setSize(logical.width,logical.height,false);render();}
    },
    getCameraState:()=>({position:camera.position.toArray(),up:camera.up.toArray(),target:target.toArray()}),
    setFurnitureTool:tool=>{unbindFurniture.cancel();furnitureTool=tool;},
    clearFurniturePreview,
    setInteriorView: enabled => {setInteriorView(enabled);render();},
    fitView: () => {stopMotion();setNamedView("iso");},
    homeView: () => {stopMotion();setNamedView("iso");},
    setNamedView: view => {stopMotion();setNamedView(view);},
    setControlMode: (mode) => { controlMode = mode === "pan" ? "pan" : "orbit"; },
    orbitBy: (yaw,pitch=0) => {stopMotion();orbit(-yaw,pitch);},
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    dispose: () => {
      unbindFurniture();
      unbindInputs();
      resizeObserver?.disconnect();
      threeScene.traverse?.((object) => {
        try { object.geometry?.dispose?.(); } catch {}
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          try { material?.map?.dispose?.(); } catch {}
          try { material?.dispose?.(); } catch {}
        }
      });
      try { renderer.dispose(); } catch {}
      // React owns canvasElement. Never remove renderer.domElement here.
    },
  };
}


function ventraSafeFileBase(value) {
  return String(value || "ventra-project")
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function ventraDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function ventraWait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}


function ventraCropCanvasToContent(sourceCanvas, paddingRatio = 0.035) {
  if (
    !sourceCanvas ||
    !sourceCanvas.width ||
    !sourceCanvas.height
  ) {
    return sourceCanvas;
  }

  try {
    const width =
      sourceCanvas.width;
    const height =
      sourceCanvas.height;

    // WebGL canvases cannot be inspected with getContext("2d") after the
    // WebGL context already exists. Copy the rendered frame into a temporary
    // 2D canvas first, then inspect/crop that copy.
    const readableCanvas =
      document.createElement(
        "canvas"
      );

    readableCanvas.width =
      width;
    readableCanvas.height =
      height;

    const readableContext =
      readableCanvas.getContext(
        "2d",
        {
          willReadFrequently: true,
        }
      );

    if (!readableContext) {
      return sourceCanvas;
    }

    readableContext.drawImage(
      sourceCanvas,
      0,
      0,
      width,
      height
    );

    const image =
      readableContext.getImageData(
        0,
        0,
        width,
        height
      );

    const data =
      image.data;

    const samplePixel =
      (x, y) => {
        const index =
          (y * width + x) * 4;

        return [
          data[index],
          data[index + 1],
          data[index + 2],
        ];
      };

    const corners = [
      samplePixel(0, 0),
      samplePixel(
        width - 1,
        0
      ),
      samplePixel(
        0,
        height - 1
      ),
      samplePixel(
        width - 1,
        height - 1
      ),
    ];

    const background = [
      Math.round(
        corners.reduce(
          (sum, color) =>
            sum + color[0],
          0
        ) /
          corners.length
      ),
      Math.round(
        corners.reduce(
          (sum, color) =>
            sum + color[1],
          0
        ) /
          corners.length
      ),
      Math.round(
        corners.reduce(
          (sum, color) =>
            sum + color[2],
          0
        ) /
          corners.length
      ),
    ];

    let minX =
      width;
    let minY =
      height;
    let maxX =
      -1;
    let maxY =
      -1;

    const step = 2;
    const threshold = 28;

    for (
      let y = 0;
      y < height;
      y += step
    ) {
      for (
        let x = 0;
        x < width;
        x += step
      ) {
        const index =
          (y * width + x) *
          4;

        const r =
          data[index];
        const g =
          data[index + 1];
        const b =
          data[index + 2];
        const a =
          data[index + 3];

        if (a < 10) {
          continue;
        }

        const distance =
          Math.abs(
            r -
              background[0]
          ) +
          Math.abs(
            g -
              background[1]
          ) +
          Math.abs(
            b -
              background[2]
          );

        if (
          distance <=
          threshold
        ) {
          continue;
        }

        minX =
          Math.min(
            minX,
            x
          );
        maxX =
          Math.max(
            maxX,
            x
          );
        minY =
          Math.min(
            minY,
            y
          );
        maxY =
          Math.max(
            maxY,
            y
          );
      }
    }

    if (
      maxX < minX ||
      maxY < minY
    ) {
      console.warn(
        "[VENTRA EXPORT CROP v24.2] visible content bounds not detected; using readable full canvas"
      );

      return readableCanvas;
    }

    const contentWidth =
      maxX -
      minX +
      1;

    const contentHeight =
      maxY -
      minY +
      1;

    const padding =
      Math.max(
        18,
        Math.round(
          Math.max(
            contentWidth,
            contentHeight
          ) *
            paddingRatio
        )
      );

    const sx =
      Math.max(
        0,
        minX -
          padding
      );

    const sy =
      Math.max(
        0,
        minY -
          padding
      );

    const ex =
      Math.min(
        width,
        maxX +
          padding
      );

    const ey =
      Math.min(
        height,
        maxY +
          padding
      );

    const cropWidth =
      Math.max(
        1,
        ex -
          sx
      );

    const cropHeight =
      Math.max(
        1,
        ey -
          sy
      );

    const cropped =
      document.createElement(
        "canvas"
      );

    cropped.width =
      cropWidth;
    cropped.height =
      cropHeight;

    const croppedContext =
      cropped.getContext(
        "2d"
      );

    if (!croppedContext) {
      return readableCanvas;
    }

    croppedContext.drawImage(
      readableCanvas,
      sx,
      sy,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    console.log(
      "[VENTRA EXPORT CAPTURE v24.2]",
      {
        original:
          `${width}x${height}`,
        exported:
          `${cropWidth}x${cropHeight}`,
        preserveDrawingBuffer:
          true,
      }
    );

    return cropped;
  } catch (error) {
    console.warn(
      "[VENTRA EXPORT CAPTURE v24.2]",
      error
    );

    return sourceCanvas;
  }
}


function ventraCanvasToJpegBlob(canvas, quality = 0.96) {
  return new Promise((resolve, reject) => {
    if (!canvas) {
      reject(new Error("3D canvas is unavailable."));
      return;
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("JPEG capture failed."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function ventraDataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || "").split(",");
  if (parts.length < 2) throw new Error("Invalid screenshot data.");
  const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function ventraBuildSingleImagePdf(jpegBytes, imageWidth, imageHeight, title = "Ventra 3D Export") {
  const enc = new TextEncoder();
  const pageW = 842;
  const pageH = 595;
  const margin = 28;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2 - 24;
  const scale = Math.min(maxW / imageWidth, maxH / imageHeight);
  const drawW = imageWidth * scale;
  const drawH = imageHeight * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2 - 6;

  const safeTitle = String(title || "Ventra 3D Export")
    .replace(/[()\\]/g, (m) => `\\${m}`);

  const content = [
    "q",
    `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`,
    "/Im0 Do",
    "Q",
    "BT",
    "/F1 12 Tf",
    `${margin} ${pageH - 20} Td`,
    `(${safeTitle}) Tj`,
    "ET",
  ].join("\n");

  const objects = [];
  objects[1] = enc.encode("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = enc.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects[3] = enc.encode(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`
  );

  const imageHead = enc.encode(
    `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(imageWidth))} /Height ${Math.max(1, Math.round(imageHeight))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  const imageTail = enc.encode("\nendstream");
  objects[4] = { binaryParts: [imageHead, jpegBytes, imageTail] };

  const contentBytes = enc.encode(content);
  objects[5] = enc.encode(`<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`);
  objects[6] = enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const chunks = [];
  const offsets = [0];
  let length = 0;

  const push = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };

  push(enc.encode("%PDF-1.4\n%Ventra\n"));

  for (let i = 1; i <= 6; i += 1) {
    offsets[i] = length;
    push(enc.encode(`${i} 0 obj\n`));
    const obj = objects[i];
    if (obj?.binaryParts) {
      for (const part of obj.binaryParts) push(part);
    } else {
      push(obj);
    }
    push(enc.encode("\nendobj\n"));
  }

  const xrefOffset = length;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  push(enc.encode(xref));

  return new Blob(chunks, { type: "application/pdf" });
}

function ventraDxfLine(x1, y1, x2, y2, layer = "0") {
  return [
    "0","LINE","8",layer,
    "10",String(x1),"20",String(y1),"30","0",
    "11",String(x2),"21",String(y2),"31","0",
  ].join("\n");
}

function ventraDxfPolyline(points = [], layer = "0", closed = true) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const lines = ["0","LWPOLYLINE","8",layer,"90",String(points.length),"70",closed ? "1" : "0"];
  for (const point of points) {
    lines.push("10", String(Number(point?.x) || 0));
    lines.push("20", String(Number(point?.y) || 0));
  }
  return lines.join("\n");
}

function ventraSceneToMetricDxf(scene) {
  const entities = [];
  const safeScene = scene || {};

  for (const room of Array.isArray(safeScene.rooms) ? safeScene.rooms : []) {
    const polygon = Array.isArray(room?.polygon) ? room.polygon : [];
    if (polygon.length >= 3) {
      entities.push(ventraDxfPolyline(polygon, "ROOM_BOUNDARY", true));
    }
  }

  for (const wall of Array.isArray(safeScene.walls) ? safeScene.walls : []) {
    entities.push(
      ventraDxfLine(
        Number(wall?.start?.x) || 0,
        Number(wall?.start?.y) || 0,
        Number(wall?.end?.x) || 0,
        Number(wall?.end?.y) || 0,
        wall?.type === "external" ? "WALL_EXTERNAL" : "WALL_INTERNAL"
      )
    );
  }

  for (const opening of Array.isArray(safeScene.openings) ? safeScene.openings : []) {
    const wall = (safeScene.walls || []).find((item) => String(item?.id || "") === String(opening?.wallId || ""));
    if (!wall) continue;

    const x1 = Number(wall?.start?.x) || 0;
    const y1 = Number(wall?.start?.y) || 0;
    const x2 = Number(wall?.end?.x) || 0;
    const y2 = Number(wall?.end?.y) || 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.05) continue;

    const offset = Math.max(0.02, Math.min(0.98, Number(opening?.offset) || 0.5));
    const width = Math.max(0.45, Number(opening?.width) || (opening?.type === "window" ? 1.4 : 0.9));
    const ux = dx / length;
    const uy = dy / length;
    const center = offset * length;
    const a = Math.max(0, center - width / 2);
    const b = Math.min(length, center + width / 2);

    entities.push(
      ventraDxfLine(
        x1 + ux * a,
        y1 + uy * a,
        x1 + ux * b,
        y1 + uy * b,
        opening?.type === "window" ? "WINDOW" : "DOOR_OPENING"
      )
    );
  }

  return [
    "0","SECTION","2","HEADER",
    "9","$INSUNITS","70","6",
    "0","ENDSEC",
    "0","SECTION","2","ENTITIES",
    entities.filter(Boolean).join("\n"),
    "0","ENDSEC","0","EOF"
  ].join("\n");
}


export default function Project3DViewer({ projectId }) {
  const rasterReview = useSyncExternalStore(subscribeRasterReview, () => getRasterReview(projectId), () => null);
  const containerRef = useRef(null);
  const apsContainerRef = useRef(null);
  const schematicCanvasRef = useRef(null);
  const viewerRef = useRef(null);
  const schematicRendererRef = useRef(null);
  const furnitureCameraRef = useRef(null);
  const documentRef = useRef(null);
  const sourceModelRef = useRef(null);
  const schematicBaseSceneRef = useRef(null);

  const [urn, setUrn] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [viewables, setViewables] = useState([]);
  const [activeViewIndex, setActiveViewIndex] = useState(-1);
  const [selectedObject, setSelectedObject] = useState(null);
  const [takeoff, setTakeoff] = useState(null);
  const [reconstruction, setReconstruction] = useState(null);
  const [dwgRegion,setDwgRegion]=useState(null);
  const [dwgRoomUses,setDwgRoomUses]=useState({});
  const [dwgFurnitureBusy,setDwgFurnitureBusy]=useState(false);
  const dwgFurnitureBusyRef=useRef(false);
  const [dwgFurnitureCount,setDwgFurnitureCount]=useState(0);
  const [reconstructing, setReconstructing] = useState(false);
  const automaticDwgAttemptRef = useRef(null);
  const [designPrompt, setDesignPrompt] = useState("");
  const [designBusy, setDesignBusy] = useState(false);
  const [designResult, setDesignResult] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [schematicScene, setSchematicScene] = useState(null);
  const [furnitureRepairBusy, setFurnitureRepairBusy] = useState(false);
  const [promptUndoScene, setPromptUndoScene] = useState(null);
  const currentPromptSceneRef = useRef(null);
  const furnitureImageInput = useRef(null);
  const [schematicModel, setSchematicModel] = useState(null);
  const [active3DSource, setActive3DSource] = useState("aps");
  useEffect(() => { currentPromptSceneRef.current = {scene: schematicScene, source: active3DSource}; }, [schematicScene, active3DSource]);
  function currentSceneMatches(scene){
    return scene?.source==='dwg-engineering-interior'?dwgInteriorMatches(scene,readTakeoffSync(projectId,'engineering')):drawingSceneMatches(projectId,scene);
  }

  function refreshProject3DSourceFromStorage(
    preferredSource = null,
    preferredScene = undefined,
    preferredTakeoff = undefined
  ) {
    if (
      !projectId ||
      typeof window === "undefined"
    ) {
      return;
    }

    try {
      let takeoff =
        preferredTakeoff !== undefined
          ? preferredTakeoff
          : (() => {
              return readTakeoffSync(projectId);
            })();

      const candidateScene =
        preferredScene !== undefined
          ? preferredScene
          : (() => {
              return readSchematicSync(projectId);
            })();

      let storedScene=drawingSceneMatches(projectId,candidateScene)?candidateScene:null;

      const requestedSource =
        preferredSource ||
        activeSourceSync(projectId) ||
        "aps";

      const savedEngineering=readTakeoffSync(projectId,'engineering');
      if(requestedSource==='dwg-interior')storedScene=savedDwgInterior(savedEngineering);
      if(requestedSource==='aps'||requestedSource==='dwg-interior')takeoff=chooseEngineeringTakeoff(takeoff,savedEngineering);
      const resolvedUrn=engineeringUrn(takeoff)||engineeringUrn(savedEngineering);

      const hasSchematic =
        Boolean(
          storedScene &&
          typeof storedScene ===
            "object" &&
          Number.isFinite(
            Number(
              storedScene.width
            )
          ) &&
          Number.isFinite(
            Number(
              storedScene.depth
            )
          )
        );

      const resolvedSource=requestedSource==='dwg-interior'&&storedScene?'dwg-interior':requestedSource==='aps'?'aps':requestedSource==='schematic'?'schematic':resolvedUrn?'aps':hasSchematic?'schematic':'aps';

      setTakeoff(takeoff);
      setSchematicScene(
        storedScene || null
      );
      setUrn(
        String(
          resolvedUrn || ""
        )
      );
      setActive3DSource(
        resolvedSource
      );
      if(resolvedSource==='dwg-interior')setInteriorView(true);

      if (storedScene) {
        const baseScene = requestedSource==='dwg-interior'?storedScene:readSchematicSync(projectId,'schematic3d-base') || storedScene;
        schematicBaseSceneRef.current =
          baseScene;

        setSchematicPreset(
          storedScene?.variant ||
            (storedScene?.style ===
            "modern_luxury"
              ? "luxury"
              : storedScene?.style ===
                  "warm_minimal"
              ? "minimal"
              : storedScene?.style ===
                  "modern"
              ? "modern"
              : "classic")
        );
      }

      console.log(
        "[VENTRA 3D SOURCE LIVE REFRESH]",
        {
          requestedSource,
          resolvedSource,
          hasSchematic,
          hasAps:
            Boolean(
              resolvedUrn
            ),
          assets:
            Array.isArray(
              storedScene?.assets
            )
              ? storedScene
                  .assets.length
              : 0,
        }
      );
    } catch (error) {
      console.error(
        "[VENTRA 3D SOURCE LIVE REFRESH]",
        error
      );
    }
  }
  const [schematicPreset, setSchematicPreset] = useState("classic");
  const [schematicNavMode, setSchematicNavMode] = useState("orbit");
  const [interiorView,setInteriorView] = useState(false);
  const interiorModeFromEffect=useEffectEvent(()=>interiorView);
  useEffect(()=>{schematicRendererRef.current?.setInteriorView?.(interiorView);},[interiorView,status]);
  const [autoOrbit,setAutoOrbit] = useState(false);

  const refreshSourceFromEffect=useEffectEvent(refreshProject3DSourceFromStorage);
  const takeoffFromEffect=useEffectEvent(getFreshProjectTakeoff);
  const reconstructFromEffect=useEffectEvent(reconstruct3D);
  const orbitFromEffect=useEffectEvent(orbitProject);
  const navigationModeFromEffect=useEffectEvent(()=>schematicNavMode);
  useEffect(() => {
    if (
      !projectId ||
      typeof window === "undefined"
    ) {
      return;
    }

    function handle3DSourceUpdated(
      event
    ) {
      const detail =
        event?.detail || {};

      if (
        detail.projectId &&
        detail.projectId !==
          projectId
      ) {
        return;
      }

      refreshSourceFromEffect(
        detail.source || null,
        detail.scene,
        detail.takeoff
      );
    }

    async function handleStorage(
      event
    ) {
      if (
        !event?.key ||
        !event.key.includes(
          projectId
        )
      ) {
        return;
      }

      if (
        event.key.includes(
          "project-active-3d-source"
        ) ||
        event.key.includes(
          "project-schematic3d"
        ) || event.key.includes("project-selected-drawing") ||
        event.key.includes(
          "project-takeoff"
        )
      ) {
        try{await Promise.all([readPersistedTakeoff(projectId),readPersistedTakeoff(projectId,'engineering'),readSchematic(projectId),readSchematic(projectId,'schematic3d-base'),readActiveSource(projectId)]);refreshSourceFromEffect();}catch(error){setMessage(`Could not refresh drawing geometry: ${error.message}`);}
      }
    }

    window.addEventListener(
      "ventra:3d-source-updated",
      handle3DSourceUpdated
    );
    window.addEventListener(
      "storage",
      handleStorage
    );

    return () => {
      window.removeEventListener(
        "ventra:3d-source-updated",
        handle3DSourceUpdated
      );
      window.removeEventListener(
        "storage",
        handleStorage
      );
    };
  }, [projectId]);

  useEffect(() => {
    const useSchematic = Boolean(schematicScene) && isInteriorSource(active3DSource);
    if(!containerRef.current)return;
    if(!urn&&!useSchematic)return;

    const sourceContainer=containerRef.current,apsContainer=apsContainerRef.current;
    let cancelled = false;
    let selectionHandler = null;
    let ownedViewer = null;
    const surfaceAbort = new AbortController();

    async function boot() {
      try {
        setStatus("loading");
        setMessage(useSchematic ? "Loading AI schematic 3D…" : "Loading Autodesk model…");
        setSelectedObject(null);
        automaticDwgAttemptRef.current=null;
        setReconstruction(null);

        if (!await waitForViewerSurface(useSchematic ? sourceContainer : apsContainer, surfaceAbort.signal)) return;
        await loadViewerSdk();

        if (cancelled || !containerRef.current) return;

        if (viewerRef.current) {
          viewerRef.current.finish();
          viewerRef.current = null;
        }
        if (schematicRendererRef.current) {
          schematicRendererRef.current.dispose?.();
          schematicRendererRef.current = null;
        }
        if (useSchematic) {
          console.log("[VENTRA SCHEMATIC SOURCE]", {
            projectId,
            active3DSource,
            source: schematicScene?.source || null,
            sceneType: schematicScene?.sceneType || null,
            width: schematicScene?.width || null,
            depth: schematicScene?.depth || null,
            assets: Array.isArray(schematicScene?.assets) ? schematicScene.assets.length : 0,
            renderer: "standalone-three",
          });
          const standalone = mountStandaloneSchematicRenderer(
            containerRef.current,
            schematicScene,
            schematicCanvasRef.current,
            furnitureCameraRef.current?.key===dwgInteriorCameraKey(projectId,schematicScene)?furnitureCameraRef.current.state:null
          );
          if (cancelled) {
            standalone.dispose?.();
            return;
          }
          schematicRendererRef.current = standalone;
          standalone.setControlMode?.(navigationModeFromEffect());
          standalone.setInteriorView?.(interiorModeFromEffect());
          const model = standalone.model;
          setSchematicModel(model);
          setReconstruction(null);
          setViewables([]);
          setActiveViewIndex(-1);
          setStatus("ready");
          setMessage(
            `AI schematic 3D ready: ${schematicScene.title || schematicScene.sceneType || "room"}. ${model.assetCount} furniture/fixture object(s). Drag to orbit and use the mouse wheel to zoom.`
          );
          console.log("[VENTRA JPG SCHEMATIC 3D STANDALONE]", model);
          return;
        }

        if(apsContainerRef.current) apsContainerRef.current.innerHTML = "";
        await initializeViewer(urn);
        if (cancelled || !containerRef.current) return;

        const viewer = new window.Autodesk.Viewing.GuiViewer3D(
          apsContainerRef.current,
          {
            extensions: ["Autodesk.DocumentBrowser"],
            // Avoid Hyperlink property queries after a model is unloaded.
            disabledExtensions: { hyperlink: true },
          }
        );

        if(cancelled || !await waitForViewerSurface(apsContainer, surfaceAbort.signal)){viewer.finish();return;}
        ownedViewer=viewer;
        viewerRef.current=viewer;
        const code = viewer.start();

        if (code > 0) {
          throw new Error(`Autodesk Viewer start failed (${code}).`);
        }

        viewer.setTheme("dark-theme");
        viewerRef.current = viewer;

        const doc = await loadDocument(urn);

        // React/Next dev mode can unmount and remount this Viewer while the
        // Autodesk document request is still in flight. Never continue loading
        // a document node into a Viewer instance that has already been finished
        // by the effect cleanup; Autodesk then reaches an uninitialized render
        // scene internally (the intermittent `hasModels` null error).
        if (
          cancelled ||
          viewerRef.current !== viewer ||
          !containerRef.current ||
          !viewer?.impl
        ) {
          return;
        }

        documentRef.current = doc;

        const available = getViewables(doc);
        setViewables(available);

        const preferredIndex = Math.max(
          0,
          available.findIndex((item) => item.is3D)
        );

        const preferred = available[preferredIndex];

        if (!preferred) {
          throw new Error("No viewable geometry was found in this Autodesk model.");
        }

        if (
          cancelled ||
          viewerRef.current !== viewer ||
          !viewer?.impl ||
          !preferred?.node
        ) {
          return;
        }

        await viewer.loadDocumentNode(doc, preferred.node, {
          keepCurrentModels: false,
        });

        if (cancelled || viewerRef.current !== viewer || !viewer?.impl) {
          return;
        }

        sourceModelRef.current = viewer.model;
        viewer.fitToView();
        setActiveViewIndex(preferredIndex);

        const has3D = available.some((item) => item.is3D);

        setStatus("ready");
        setMessage(
          has3D
            ? "3D model ready. Select an object to inspect its properties."
            : "This source contains 2D viewable geometry only. The Viewer is ready, but a true 3D model requires an IFC/RVT/3D source or Ventra reconstruction."
        );

        if(!has3D){const check=dwgReconstructionReadiness(takeoffFromEffect(),urn);if(!check.ready)setMessage(`DWG source sheet loaded. ${check.reason}`);}

        selectionHandler = async (event) => {
          const dbId = event?.dbIdArray?.[0];

          if (dbId === null || dbId === undefined) {
            setSelectedObject(null);
            return;
          }

          const model = viewer.model;

          model.getProperties(
            dbId,
            (result) => {
              const properties = Array.isArray(result?.properties)
                ? result.properties
                    .filter(
                      (item) =>
                        item?.displayValue !== null &&
                        item?.displayValue !== undefined &&
                        String(item.displayValue).trim() !== ""
                    )
                    .slice(0, 24)
                : [];

              setSelectedObject({
                dbId,
                name: result?.name || `Object ${dbId}`,
                properties,
              });
            },
            () =>
              setSelectedObject({
                dbId,
                name: `Object ${dbId}`,
                properties: [],
              })
          );
        };

        viewer.addEventListener(
          window.Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          selectionHandler
        );

        console.log("[VENTRA MODEL VIEWER v2]", {
          urn: Boolean(urn),
          views: available.length,
          has3D,
          loadedView: preferred.name,
          role: preferred.role,
        });
      } catch (error) {
        if(cancelled)return;
        if(ownedViewer){try{ownedViewer.finish();}catch{}if(viewerRef.current===ownedViewer)viewerRef.current=null;ownedViewer=null;}
        console.error("[VENTRA MODEL VIEWER v2]", error);
        setStatus("error");
        setMessage(error?.message || "The project model could not be loaded.");
      }
    }

    boot();

    return () => {
      cancelled = true;
      surfaceAbort.abort();

      const viewer = ownedViewer;

      if (viewer && selectionHandler && window.Autodesk?.Viewing) {
        viewer.removeEventListener(
          window.Autodesk.Viewing.SELECTION_CHANGED_EVENT,
          selectionHandler
        );
      }

      if (schematicRendererRef.current) {
        furnitureCameraRef.current={key:dwgInteriorCameraKey(projectId,schematicScene),state:schematicRendererRef.current.getCameraState?.()};
        schematicRendererRef.current.dispose?.();
        schematicRendererRef.current = null;
      }

      if (viewer && viewerRef.current === viewer) {
        viewer.finish();
        viewerRef.current = null;
      }

      if (sourceContainer && !useSchematic && apsContainer) apsContainer.innerHTML = "";
    };
  }, [projectId,urn, schematicScene, active3DSource]);

  useEffect(()=>{
    const failed=event=>{if(event.detail?.projectId===projectId)setMessage(`3D cloud sync failed: ${event.detail.message}`);};
    window.addEventListener('ventra:3d-cloud-error',failed);
    return()=>window.removeEventListener('ventra:3d-cloud-error',failed);
  },[projectId]);

  useEffect(()=>{
    if(!projectId)return;
    let cancelled=false;
    (async()=>{
      const localScene=await readSchematic(projectId),localEngineering=await readPersistedTakeoff(projectId,'engineering');
      const {restoreCloud3DState}=await import('@/lib/cloud3DState.mjs');
      let cloud;
      try{cloud=await restoreCloud3DState(projectId);}catch(error){if(localScene||engineeringUrn(localEngineering)){window.dispatchEvent(new CustomEvent('ventra:3d-cloud-error',{detail:{projectId,message:error.message}}));return;}throw error;}
      if(cancelled)return;
      const {writeCloud3DState}=await import('@/lib/cloud3DState.mjs');
      // Migrate each missing source independently, without overwriting existing cloud data.
      if(!cloud.schematic&&localScene)await writeCloud3DState(projectId,'schematic',localScene);
      if(!cloud.engineering&&engineeringUrn(localEngineering))await writeCloud3DState(projectId,'engineering',localEngineering);
      if(!cloud.selection&&(localScene||engineeringUrn(localEngineering))){
        const selectedSource=await readActiveSource(projectId);
        if(selectedSource)await writeCloud3DState(projectId,'selection',{source:selectedSource});
      }
      if(cancelled)return;
      await restoreEngineeringSnapshot(projectId,cloud.engineering,{read:readPersistedTakeoff,persist:persistTakeoff});
      if(cloud.schematic)await saveSchematic(projectId,cloud.schematic,{preserveBase:false,syncCloud:false});
      if(cloud.selection?.source)await saveActiveSource(projectId,cloud.selection.source,{syncCloud:false});
    })().then(()=>Promise.all([readPersistedTakeoff(projectId),readPersistedTakeoff(projectId,'engineering'),readSchematic(projectId),readSchematic(projectId,'schematic3d-base'),readActiveSource(projectId)])).then(([latest,engineering,scene,base,source])=>{
      if(cancelled)return;
      const selectedEngineering=reconcileEngineering(engineering,latest);
      const resolvedUrn=engineeringUrn(selectedEngineering);
      const selectedSource=source || (resolvedUrn?'aps':scene?'schematic':'aps');
      const selected=selectedSource==='aps'||selectedSource==='dwg-interior'?selectedEngineering:latest;
      setTakeoff(selected || null);setUrn(resolvedUrn || '');
      const interior=selectedSource==='dwg-interior'?savedDwgInterior(selectedEngineering):null;
      setActive3DSource(selectedSource==='dwg-interior'&&!interior?'aps':selectedSource);setSchematicScene(interior||scene||null);
      if(interior)setInteriorView(true);
      schematicBaseSceneRef.current=interior||base||scene||null;
      setSchematicPreset(scene?.variant || 'classic');
      if(!resolvedUrn&&!scene){setStatus('missing');setMessage('No Autodesk model or image schematic is linked yet. Open Drawings and upload/analyze a supported drawing or JPG/PNG/WebP image.');}
      else if(selectedSource==='aps'&&!resolvedUrn){setStatus('missing');setMessage('No engineering model is saved for this project. Analyze the DWG in Drawings again to restore its Autodesk source and calibrated geometry.');}
    }).catch(error=>{if(!cancelled){setStatus('error');setMessage(`Could not load saved drawing geometry: ${error.message}`);}});
    return()=>{cancelled=true;};
  },[projectId]);

  useEffect(()=>{
    const updated=event=>{
      if(event.detail?.projectId!==projectId)return;
      const latest=reconcileEngineering(readTakeoffSync(projectId,'engineering'),readTakeoffSync(projectId));
      if(active3DSource==='aps'&&engineeringUrn(latest)){
        setTakeoff(latest);setUrn(engineeringUrn(latest));
      }
    };
    window.addEventListener('ventra:engineering-takeoff-updated',updated);
    return()=>window.removeEventListener('ventra:engineering-takeoff-updated',updated);
  },[projectId,active3DSource,urn]);

  useEffect(()=>{
    const viewer=viewerRef.current;
    if(status!=='ready'||active3DSource!=='aps'||!viewer||reconstruction||activeViewIndex<0||viewables[activeViewIndex]?.is3D)return;
    let cancelled=false;
    readPersistedTakeoff(projectId,'engineering').then(saved=>{
      if(cancelled||viewerRef.current!==viewer)return;
      const latest=chooseEngineeringTakeoff(takeoffFromEffect(),saved,urn),check=dwgReconstructionReadiness(latest,urn);
      if(!check.ready){setMessage(`DWG source sheet loaded. ${check.reason}`);return;}
      const fingerprint=JSON.stringify([urn,latest?.analyzed_at,check.meterFactor,check.geometry]);
      if(automaticDwgAttemptRef.current===fingerprint)return;
      automaticDwgAttemptRef.current=fingerprint;
      reconstructFromEffect();
    }).catch(error=>{if(!cancelled)setMessage(error.message);});
    return()=>{cancelled=true;};
  },[projectId,status,active3DSource,urn,activeViewIndex,viewables,takeoff,reconstruction]);

  useEffect(() => {
    if (schematicRendererRef.current) {
      schematicRendererRef.current.setControlMode?.(schematicNavMode);
    }
  }, [schematicNavMode]);

  async function repairFurnitureFromImage(event) {
    const file=event.target.files?.[0];event.target.value="";
    if(!file||!schematicScene||furnitureRepairBusy)return;
    const base=schematicScene;
    const key=`ventra:project-schematic3d:${projectId}`;
    const snapshot=readSchematicSync(projectId);
    setFurnitureRepairBusy(true);setMessage("Reading rejected furniture from the original plan; keeping current architecture…");
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),190000);
    try {
      if(file.size>20*1024*1024)throw new Error("Choose the original JPG/PNG under 20 MB.");
      const imageUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Could not read the image."));reader.readAsDataURL(file);});
      const response=await commercialFetch("/api/ai/design-3d-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"repair_furniture",projectId,imageUrl,scene:base}),signal:controller.signal});
      const payload=await response.json();if(!response.ok||!payload.scene)throw new Error(payload.error||"Furniture repair failed.");
      if(readSchematicSync(projectId)!==snapshot)throw new Error("The saved scene changed during repair. Result was not applied.");
      for(const field of ["footprint","holes","walls","rooms","openings","width","depth","height"]){if(JSON.stringify(base[field])!==JSON.stringify(payload.scene[field]))throw new Error("Architecture changed in the response; result was not applied.");}
      await saveSchematic(projectId,base,{kind:'furniture-repair-backup'});
      await persistSchematicScene(payload.scene);
      setSchematicScene(payload.scene);
      setMessage(`Furniture repair finished: ${payload.repairedCount||0} restored; ${payload.scene.furnishingReview?.rejected?.length||0} still need review. Architecture preserved.`);
    }catch(error){setMessage(error?.name==="AbortError"?"Furniture repair timed out. Current scene preserved.":error.message);}
    finally{clearTimeout(timer);setFurnitureRepairBusy(false);}
  }

  async function persistSchematicScene(nextScene, { preserveBase = true } = {}) {
    if (!projectId || !nextScene) return;
    if(nextScene.source==='dwg-engineering-interior'){
      let latest=await readPersistedTakeoff(projectId,'engineering');
      const next=updateDwgInterior(latest,applyDesignDefaults(nextScene));
      await persistTakeoff(projectId,next,{kind:'engineering'});
      const {writeCloud3DState}=await import('@/lib/cloud3DState.mjs');
      const saved=await writeCloud3DState(projectId,'engineering',next);
      setTakeoff(next);
      if(!saved.saved)throw new Error(`Interior saved locally; cloud sync failed: ${saved.error}`);
      return;
    }
    await saveSchematic(projectId,applyDesignDefaults(nextScene),{preserveBase});
    if (!preserveBase) schematicBaseSceneRef.current = ventraCloneScene(nextScene);
  }

  async function commitFurnitureScene(nextScene, expectedScene) {
    if(currentPromptSceneRef.current?.scene!==expectedScene||!isInteriorSource(currentPromptSceneRef.current?.source)||!currentSceneMatches(expectedScene))throw new Error('The drawing changed. Retry on the current scene. / نقشه تغییر کرد؛ دوباره امتحان کن.');
    for(const key of LOCKED_ARCHITECTURE)if(JSON.stringify(nextScene[key])!==JSON.stringify(expectedScene[key]))throw new Error(`Architecture is locked: ${key}`);
    setDesignBusy(true);
    try{await persistSchematicScene(nextScene,{preserveBase:true});rebuildStandaloneScene(nextScene);}
    finally{setDesignBusy(false);}
  }

  async function commitOpeningScene(nextScene,expectedScene){
    if(currentPromptSceneRef.current?.scene!==expectedScene||!isInteriorSource(currentPromptSceneRef.current?.source)||!currentSceneMatches(expectedScene))throw new Error('The drawing changed. Retry on the current floor. / طبقه یا نقشه تغییر کرده؛ دوباره روی طبقه فعلی امتحان کن.');
    assertOpeningOnlyEdit(expectedScene,nextScene);
    setDesignBusy(true);
    try{await persistSchematicScene(nextScene,{preserveBase:false});schematicBaseSceneRef.current=nextScene;rebuildStandaloneScene(nextScene);}
    finally{setDesignBusy(false);}
  }

  function rebuildStandaloneScene(nextScene, nextMessage = null) {
    if (!containerRef.current) throw new Error('Schematic 3D canvas is not ready.');
    setSchematicScene({...applyDesignDefaults(nextScene)});
    setActive3DSource(nextScene.source==='dwg-engineering-interior'?'dwg-interior':'schematic');
    if(nextMessage)setMessage(nextMessage);
    return {model:schematicRendererRef.current?.model||{}};
  }

  function runSchematicCameraAction(action) {
    const renderer = schematicRendererRef.current;
    if (!renderer) return;
    if (action === 'fit') renderer.fitView?.();
    else if (action === 'home' || action === 'iso') renderer.homeView?.();
    else if (['top','bottom','front','back','left','right'].includes(action)) renderer.setNamedView?.(action);
    else if (action === 'rotateLeft') renderer.orbitBy?.(Math.PI/4);
    else if (action === 'rotateRight') renderer.orbitBy?.(-Math.PI/4);
    else if (action === 'zoomIn') renderer.zoomIn?.();
    else if (action === 'zoomOut') renderer.zoomOut?.();
  }

  function orbitProject(yaw=0, view=null) {
    if(isInteriorSource(active3DSource)&&schematicRendererRef.current) {
      if(view)runSchematicCameraAction(view);else schematicRendererRef.current.orbitBy?.(yaw);return;
    }
    const viewer=viewerRef.current, nav=viewer?.navigation, THREE=getThree();
    const bounds=reconstruction?.bounds || schematicModel?.bounds || viewer?.model?.getBoundingBox?.();
    if(!nav||!THREE||!bounds?.min||!bounds?.max)return;
    const center=new THREE.Vector3((bounds.min.x+bounds.max.x)/2,(bounds.min.y+bounds.max.y)/2,(bounds.min.z+bounds.max.z)/2);
    let position;
    if(view){const camera=nav.getCamera?.();const size={x:Math.max(0.01,bounds.max.x-bounds.min.x),y:Math.max(0.01,bounds.max.y-bounds.min.y),z:Math.max(0.01,bounds.max.z-bounds.min.z)};
      const offset=namedCameraOffset(view,cameraFitDistance(size,camera?.fov||45,camera?.aspect||1));position=new THREE.Vector3(center.x+offset.x,center.y+offset.y,center.z+offset.z);
      nav.setCameraUpVector?.(new THREE.Vector3(0,view==='top'||view==='bottom'?1:0,view==='top'||view==='bottom'?0:1));
    }else{const current=nav.getPosition?.()||nav.getCamera?.()?.position;if(!current)return;const offset=orbitOffset({x:current.x-center.x,y:current.y-center.y,z:current.z-center.z},yaw);position=new THREE.Vector3(center.x+offset.x,center.y+offset.y,center.z+offset.z);nav.setCameraUpVector?.(new THREE.Vector3(0,0,1));}
    nav.toPerspective?.();nav.setPivotPoint?.(center);nav.setUsePivotAlways?.(true);nav.setView(position,center);viewer.setActiveNavigationTool?.('orbit');viewer.impl?.invalidate?.(true,true,true);
  }
  useEffect(()=>{
    if(!autoOrbit||status!=='ready')return;
    let frame,last=null;
    const step=time=>{if(last!==null)orbitFromEffect(Math.min(0.05,(time-last)/1000)*Math.PI/18);last=time;frame=requestAnimationFrame(step);};
    frame=requestAnimationFrame(step);
    const stop=()=>setAutoOrbit(false);
    const element=containerRef.current;element?.addEventListener('pointerdown',stop);element?.addEventListener('wheel',stop);
    return()=>{cancelAnimationFrame(frame);element?.removeEventListener('pointerdown',stop);element?.removeEventListener('wheel',stop);};
  },[autoOrbit,status,active3DSource,reconstruction,schematicModel]);

  async function applySchematicPreset(presetId) {
    if (
      !schematicScene ||
      !isInteriorSource(active3DSource)
    ) {
      setMessage("Schematic presets are available when a JPG/PNG/WebP 3D scene is active.");
      return;
    }

    try {
      const baseScene = schematicBaseSceneRef.current || schematicScene;
      const nextScene = {
        ...ventraRestyleSchematicScene(baseScene, presetId),
        projectId,
        source: baseScene.source === "dwg-engineering-interior" ? baseScene.source : "image-ai-schematic",
        variant: presetId,
        updatedAt: new Date().toISOString(),
      };

      await persistSchematicScene(nextScene, { preserveBase: true });
      const standalone = rebuildStandaloneScene(
        nextScene,
        `${presetId.replaceAll("_", " ")} preset applied instantly.`
      );

      setSchematicModel(standalone.model);
      setSchematicPreset(presetId);
      setDesignResult({
        source: "ventra-local-preset",
        prompt: presetId,
        schematic: true,
        design: { style: nextScene.style || presetId },
      });
    } catch (error) {
      console.error("[VENTRA SCHEMATIC PRESET]", error);
      setMessage(error?.message || "Could not apply the schematic preset.");
    }
  }

  async function restoreClassicSchematic() {
    if (!schematicBaseSceneRef.current) {
      setMessage('No base JPG schematic is saved for this project yet.');
      return;
    }
    try {
      const baseScene = ventraRestyleSchematicScene(schematicBaseSceneRef.current, 'classic');
      const nextScene = { ...baseScene, projectId, source: baseScene.source === 'dwg-engineering-interior' ? baseScene.source : 'image-ai-schematic', variant: 'classic', updatedAt: new Date().toISOString() };
      await persistSchematicScene(nextScene, { preserveBase: true });
      rebuildStandaloneScene(nextScene, 'Classic JPG schematic restored.');
      setDesignResult({ source: 'ventra-local-preset', prompt: 'classic', schematic: true, design: { style: 'classic' } });
      setSchematicPreset('classic');
    } catch (error) {
      setMessage(error?.message || 'Could not restore the classic schematic.');
    }
  }

  async function switchView(index) {
    const viewer = viewerRef.current;
    const doc = documentRef.current;
    const target = viewables[index];

    if (!viewer || !doc || !target) return;

    try {
      setStatus("loading");
      setMessage(`Opening ${target.name}…`);
      setSelectedObject(null);

      const models = viewer.getVisibleModels?.() || [];
      for (const model of models) {
        try {
          viewer.unloadModel(model);
        } catch {}
      }

      await viewer.loadDocumentNode(doc, target.node, {
        keepCurrentModels: false,
      });

      sourceModelRef.current = viewer.model;
      viewer.fitToView();
      setActiveViewIndex(index);
      setStatus("ready");
      setMessage(
        target.is3D
          ? "3D model ready. Orbit, pan, zoom and select objects."
          : "2D Autodesk view loaded."
      );
    } catch (error) {
      setStatus("error");
      setMessage(error?.message || "Could not switch Autodesk view.");
    }
  }

  function getFreshProjectTakeoff() {
    if (typeof window === "undefined" || !projectId) return takeoff;
    try {
      const fresh = readTakeoffSync(projectId);
      if (fresh && typeof fresh === "object") {
        const saved=readTakeoffSync(projectId,'engineering');
        return active3DSource==='aps'||active3DSource==='dwg-interior'?chooseEngineeringTakeoff(fresh,saved,urn):fresh;
      }
    } catch (error) {
      console.warn("[VENTRA 3D] Could not refresh takeoff from localStorage", error);
    }
    return takeoff;
  }

  async function reconstruct3D(region = dwgRegion) {
    const viewer = viewerRef.current;

    if (schematicScene && isInteriorSource(active3DSource)) {
      try {
        setReconstructing(true);
        const standalone = rebuildStandaloneScene(
          schematicScene,
          `Schematic 3D rebuilt with ${(schematicScene?.assets || []).length} furniture/fixture object(s).`
        );
        setSchematicModel(standalone.model);
      } catch (error) {
        setMessage(error?.message || "Schematic 3D reconstruction failed.");
      } finally {
        setReconstructing(false);
      }
      return;
    }

    if(!viewer){setMessage("The Autodesk model is not ready.");return;}
    const expectedModel=viewer.model;
    try {
      setReconstructing(true);
      // Await IndexedDB: synchronous localStorage data can contain only a pointer/summary.
      const reads=await Promise.allSettled([readPersistedTakeoff(projectId,'engineering'),readPersistedTakeoff(projectId)]);
      const [saved,latest]=reads.map(r=>r.status==='fulfilled'?r.value:null);
      if(viewerRef.current!==viewer||viewer.model!==expectedModel)return;
      const latestTakeoff=chooseEngineeringTakeoff(chooseEngineeringTakeoff(getFreshProjectTakeoff(),latest,urn),saved,urn);
      const storageFailure=reads.find(r=>r.status==='rejected');
      if(storageFailure&&!dwgReconstructionReadiness(latestTakeoff||{},urn).ready){setMessage(`Could not load full DWG geometry: ${storageFailure.reason?.message||'Drawing storage is unavailable.'}`);return;}
      if(!latestTakeoff){setMessage("No extracted engineering geometry matches this DWG. Open Drawings and extract the selected file.");return;}
      const readiness=dwgReconstructionReadiness(latestTakeoff,urn);
      setTakeoff(latestTakeoff);
      if(!readiness.ready){setMessage(readiness.reason);return;}

      if (!sourceModelRef.current) {
        sourceModelRef.current = viewer.model;
      }

      // Drawing Center can finish geometry extraction after this Viewer mounted.
      // Always reconstruct from the newest persisted takeoff instead of stale React state.
      setTakeoff(latestTakeoff);

      const result = buildReconstructionOverlay({
        viewer,
        takeoff: latestTakeoff,
        wallHeightMeters: /default/.test(String(latestTakeoff?.wall_height_source||'')) ? 3.2 : Number(latestTakeoff?.wall_height) || 3.2,
        wallThicknessMeters: 0.15,
        regionIndex: region,
      });

      setReconstruction({
        ...result,
        sourceViewIndex: activeViewIndex,
      });
      setDesignResult(null);
      setDwgFurnitureCount(0);
      if(latestTakeoff.geometry?.dwgPresentation?.furnished){try{renderDwgFurniture(viewer,result,latestTakeoff.geometry.dwgPresentation.roomUses||{});}catch(error){console.warn("[VENTRA DWG FURNITURE]",error.message);}}

      setMessage(
        `Ventra architectural 3D ready: ${result.wallCount} verified wall segment(s) rebuilt into ${result.wallPieceCount} wall piece(s), ${result.wallOpeningCutCount} single-parent opening cut(s), doors ${result.doorCount}/${result.expectedDoorCount}, windows ${result.windowCount}/${result.expectedWindowCount}, ${result.slabCount} slab(s), ${result.storeyCount} storey(s).`
      );

      console.log("[VENTRA ARCHITECTURAL 3D v43.4 SINGLE PARENT WALL]", result);
    } catch (error) {
      setReconstruction(null);
      setMessage(error?.message || "3D reconstruction failed.");

      console.error("[VENTRA ARCHITECTURAL 3D v43.4 SINGLE PARENT WALL]", error);
    } finally {
      setReconstructing(false);
    }
  }

  async function clear3D() {
    const viewer = viewerRef.current;

    clearReconstruction(viewer);

    const viewIndex = Number.isInteger(reconstruction?.sourceViewIndex)
      ? reconstruction.sourceViewIndex
      : activeViewIndex;

    const sourceView = viewables[viewIndex] || viewables[0] || null;

    const restored = await showAutodeskSourceModel(
      viewer,
      documentRef.current,
      sourceView,
      sourceModelRef.current,
      Boolean(reconstruction?.sourceModelUnloaded)
    );

    if (restored) {
      sourceModelRef.current = restored;
    }

    setReconstruction(null);
    setDesignResult(null);

    setMessage("Ventra reconstruction hidden. Autodesk source sheet restored.");
  }

  async function restoreRejectedDoors() {
    if (!schematicScene || designBusy) return;
    try {
      setDesignBusy(true);
      const doorRepair = repairObservedDoors(schematicScene);
      const {scene, restored: furnitureRestored} = restoreWallContactFurniture(doorRepair.scene);
      const {restored, removedPartitions = []} = doorRepair;
      if (!restored.length && !removedPartitions.length && !furnitureRestored.length) { setMessage("No evidence-backed geometry repair was found. / اصلاح هندسه با شواهد کافی پیدا نشد."); return; }
      await persistSchematicScene(scene, {preserveBase: true});
      rebuildStandaloneScene(scene);
      setPromptUndoScene({...schematicScene, projectId});
      setMessage(`Restored ${furnitureRestored.length} wall-contact cabinet(s) and ${restored.length} observed door(s); repaired ${removedPartitions.length} inferred wall(s). Room dimensions still require source review. / ${furnitureRestored.length} کابینت بازیابی شد؛ درها و دیوارهای استنباط‌شده اصلاح شدند؛ ابعاد اتاق‌ها هنوز نیاز به بررسی دارند.`);
    } catch (error) { setMessage(error.message); }
    finally { setDesignBusy(false); }
  }

  async function undoPromptEdit() {
    if (!promptUndoScene || designBusy) return;
    if (!isInteriorSource(active3DSource) || promptUndoScene.projectId !== projectId || promptUndoScene.documentId !== schematicScene?.documentId || promptUndoScene.dwgRegion !== schematicScene?.dwgRegion || !currentSceneMatches(promptUndoScene)) {
      setPromptUndoScene(null);
      setMessage("This undo belongs to a different drawing.");
      return;
    }
    try {
      setDesignBusy(true);
      await persistSchematicScene(promptUndoScene, {preserveBase: true});
      rebuildStandaloneScene(promptUndoScene);
      setPromptUndoScene(null);
      setDesignResult(null);
      setMessage("Last prompt undone. / آخرین تغییر پرامپت برگردانده شد.");
    } catch (error) { setMessage(error?.message || "Could not undo the edit."); }
    finally { setDesignBusy(false); }
  }

  async function applyDesignPrompt(promptOverride = null) {
    if (designBusy) return;
    const viewer = viewerRef.current;
    const prompt = String(promptOverride ?? designPrompt).trim();

    if (!prompt) {
      setMessage("Write a design prompt first.");
      return;
    }

    if (schematicScene && isInteriorSource(active3DSource)) {
      const originalScene = schematicScene;
      try {
        setDesignBusy(true);
        setMessage("AI is interpreting your request and checking furniture placement… / هوش مصنوعی در حال بررسی درخواست و جای وسایل است…");
        const result = await ventraFetchJson("/api/ai/scene-edit", {
          method: "POST",
          headers: await commercialHeaders({"Content-Type": "application/json"}),
          body: JSON.stringify({projectId, prompt, language: document.documentElement.lang, scene: originalScene}),
        }, 85000);
        if (!result?.scene || !result?.changes?.length) throw new Error("No executable change was returned; the model was kept unchanged.");
        for (const key of ["rooms","walls","openings","footprint","holes","width","depth","height"]) {
          if (JSON.stringify(result.scene[key]) !== JSON.stringify(originalScene[key])) throw new Error("The edit changed architecture and was rejected. / ویرایش هندسه را تغییر داد و رد شد.");
        }
        if (currentPromptSceneRef.current?.scene !== originalScene || !isInteriorSource(currentPromptSceneRef.current?.source) || !currentSceneMatches(originalScene)) {
          setMessage("The drawing changed while editing; the old response was discarded. / نقشه عوض شد؛ پاسخ قبلی اعمال نشد.");
          return;
        }
        const requestedPreset = result.scene.promptStyle;
        let nextScene = requestedPreset ? ventraRestyleSchematicScene(result.scene, requestedPreset) : result.scene;
        if (requestedPreset && result.appearance) {
          nextScene.palette = {...nextScene.palette, ...result.appearance.palette};
          nextScene.assets = nextScene.assets.map(asset => {
            const override = result.appearance.colors?.find(item => item.id === asset.id);
            return override ? {...asset, color: override.color} : asset;
          });
        }
        nextScene = {...nextScene, projectId, updatedAt: new Date().toISOString()};
        delete nextScene.promptStyle;
        await persistSchematicScene(nextScene, {preserveBase: true});
        rebuildStandaloneScene(nextScene);
        setPromptUndoScene({...originalScene, projectId});
        setDesignPrompt(prompt);
        setDesignResult({source: result.source, prompt, schematic: true, changes: result.changes});
        if (requestedPreset) setSchematicPreset(requestedPreset);
        setMessage(result.message || `Applied ${result.changes.length} change(s).`);
      } catch (error) {
        setMessage(error?.message || "Could not edit the model; no changes were saved.");
      } finally {
        setDesignBusy(false);
      }
      return;
    }

    if (!viewer) {
      setMessage("3D Viewer is not ready.");
      return;
    }

    if (!reconstruction) {
      setMessage("Reconstruct 3D before using Design Prompt.");
      return;
    }

    try {
      setDesignBusy(true);
      setMessage("Ventra AI is translating the design prompt into safe 3D design actions…");

      let payload = null;
      try {
        payload = await ventraFetchJson("/api/ai/design-3d", {
          method: "POST",
          headers: await commercialHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            prompt,
            projectId,
            context: {
              storeyCount: reconstruction.storeyCount,
              wallHeightMeters: reconstruction.wallHeightMeters,
              wallThicknessMeters: reconstruction.wallThicknessMeters,
              doorCount: reconstruction.doorCount,
              windowCount: reconstruction.windowCount,
            },
          }),
        });
      } catch (networkError) {
        console.warn("[VENTRA AI DESIGN MODE] API unavailable, using local safe design fallback", networkError);
        payload = { design: ventraLocalDesignFromPrompt(prompt), source: "local-fallback" };
      }
      if (!payload?.design) throw new Error("The design prompt could not be interpreted.");

      const visual = buildDesignOverlay({
        viewer,
        reconstruction,
        design: payload.design,
      });

      const nextResult = {
        ...visual,
        design: payload.design,
        source: payload.source || "design-controller",
        prompt,
      };
      setDesignResult(nextResult);
      setDesignPrompt(prompt);
      setMessage(
        `Design applied: ${payload.design.style || "custom"}. ${visual.floorFinishCount} floor finish layer(s), ${visual.baseboardCount} interior baseboard piece(s), ${visual.ceilingCount} ceiling layer(s), ${visual.facadeBandCount} facade accent band(s). AI design remains separate from BOQ/Estimate.`
      );
    } catch (error) {
      setMessage(error?.message || "Could not apply the 3D design prompt.");
      console.error("[VENTRA AI DESIGN MODE]", error);
    } finally {
      setDesignBusy(false);
    }
  }


  useEffect(()=>{setDwgRegion(null);setDwgFurnitureCount(0);},[projectId,urn]);
  useEffect(()=>{setDwgRoomUses(takeoff?.geometry?.dwgPresentation?.roomUses||{});},[takeoff?.geometry?.dwgPresentation]);

  async function openDwgInterior(region=null){
    if(dwgFurnitureBusyRef.current)return;
    dwgFurnitureBusyRef.current=true;setDwgFurnitureBusy(true);
    try{
      let latest=await readPersistedTakeoff(projectId,'engineering');
      if(engineeringUrn(latest)!==urn)throw new Error('The selected DWG changed. Reconstruct its current geometry first.');
      const presentation=latest.geometry?.dwgPresentation;
      const index=region??reconstruction?._runtime?.storeyFrames?.[0]?.sourceRegionIndex??presentation?.activeRegion??0;
      let scene=presentation?.interiorScenes?.[index];
      const runtime=buildDwgInteriorRuntime(latest);
      // A single-region engineering view must not limit the available interior floors.

      if(runtime?.storeyFrames?.length){
        const storey=runtime?.storeyFrames?.find(s=>(s.sourceRegionIndex??s.index)===index);
        if(!storey)throw new Error('Reconstruct this DWG region first, then open its interior.');
        for(const floor of runtime.storeyFrames){
          const stored=latest.geometry?.dwgPresentation?.interiorScenes?.[floor.sourceRegionIndex??floor.index];
          const input={runtime,storey:floor,projectId,documentId:latest.document_id,urn,roomUses:dwgRoomUses};
          const converted=stored?.dwgReview?.bindingVersion===82?repairDwgInterior(stored,input,latest):rebuildDwgInterior(stored,input);
          latest=updateDwgInterior(latest,converted);
          if((floor.sourceRegionIndex??floor.index)===index)scene=converted;
        }
        await persistTakeoff(projectId,latest,{kind:'engineering'});
      }
      scene=upgradeDwgInterior(scene,latest);
      await persistSchematicScene(scene);
      await saveActiveSource(projectId,'dwg-interior');
      schematicBaseSceneRef.current=scene;setSchematicScene(scene);setActive3DSource('dwg-interior');setInteriorView(true);
      setMessage(scene.dwgReview?.missingRooms?'DWG interior opened. Room boundaries are missing; automatic room furnishing is unavailable. You can place furniture manually.':'DWG floor interior opened. Furniture is a design proposal, excluded from BOQ.');
    }catch(error){setMessage(error.message);}
    finally{dwgFurnitureBusyRef.current=false;setDwgFurnitureBusy(false);}
  }

  async function assignInteriorRoomUse(roomId,type){
    if(active3DSource!=='dwg-interior'||!schematicScene)return;
    setDesignBusy(true);
    try{
      const scene=applyDesignDefaults({...schematicScene,designDefaults:undefined,
        rooms:schematicScene.rooms.map(room=>room.id===roomId?{...room,type,semanticType:type,roomUseSource:'user_confirmed',floorFinish:undefined}:room),
        assets:schematicScene.assets.filter(asset=>asset.roomId!==roomId||asset.placementSource!=='design_default_not_measured')
      },{force:true});
      await persistSchematicScene(scene);rebuildStandaloneScene(scene);
    }catch(error){setMessage(error.message);}
    finally{setDesignBusy(false);}
  }

  function renderDwgFurniture(viewer,result,roomUses) {
      const THREE=getThree(),runtime=result?._runtime;
      if(!viewer||!runtime)throw new Error("ابتدا DWG را با مقیاس تأییدشده بازسازی کنید / Reconstruct the calibrated DWG first / أعد بناء DWG بمقياس مؤكد");
      const scenes=runtime.storeyFrames.map((storey,index)=>dwgRoomScene({geometry:runtime.geometry,frame:storey.frame,factor:runtime.meterFactor,wallPieces:runtime.storeys[index].wallPieces,doors:runtime.doors.filter(d=>d.storey.index===storey.index),roomUses}));
      if(!scenes.some(s=>s.rooms.length))throw new Error("مرز اتاق‌ها استخراج نشده؛ در Drawings تحلیل هندسی را تکمیل کنید / No room boundaries extracted; complete geometry analysis in Drawings / أكمل تحليل حدود الغرف");
      clearDesignOverlay(viewer);viewer.impl.createOverlayScene(VENTRA_DESIGN_OVERLAY);
      let count=0,missing=0;
      scenes.forEach((scene,index)=>{
        missing+=scene.designDefaults?.warnings?.length||0;
        for(const room of scene.rooms){
          if(!room.floorFinish)continue;
          const polygon=room.polygon.map(p=>({x:p.x-scene.width/2,y:p.y-scene.depth/2}));
          const material=ventraCreateRoomFloorMaterial({THREE,room,polygon});
          const floor=buildFloorMesh({THREE,polygon,z:index*runtime.storeyHeightMeters+.015,material});
          if(floor?.mesh)viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY,floor.mesh);
        }
        for(const asset of scene.assets){
          const meshes=buildSchematicAssetMeshes({THREE,asset,palette:{},roomWidth:scene.width,roomDepth:scene.depth});
          for(const mesh of meshes){mesh.position.z+=index*runtime.storeyHeightMeters;viewer.impl.addOverlay(VENTRA_DESIGN_OVERLAY,mesh);}
          count++;
        }
      });
      viewer.impl.invalidate(true,true,true);setDwgFurnitureCount(count);
      setMessage(`مبلمان پیشنهادی: ${count}؛ موارد بدون فضای امن: ${missing}. نوع اتاق‌های بی‌نام را انتخاب کنید. / Proposed furniture: ${count}; no safe space: ${missing}. Assign uses to unnamed rooms. / أثاث مقترح: ${count}؛ حدد استخدام الغرف غير المسماة.`);
      return {count,missing};
  }
  async function furnishDwgRooms() {
    if(dwgFurnitureBusyRef.current)return;
    dwgFurnitureBusyRef.current=true;setDwgFurnitureBusy(true);
    try {
      const latest=await readPersistedTakeoff(projectId,'engineering');
      if(!latest||engineeringUrn(latest)!==urn)throw new Error("The selected DWG source changed. Reconstruct the current source first.");
      renderDwgFurniture(viewerRef.current,reconstruction,dwgRoomUses);
      const next=patchDwgPresentation(latest,{roomUses:dwgRoomUses,furnished:true});
      await persistTakeoff(projectId,next,{kind:'engineering'});
      const {writeCloud3DState}=await import('@/lib/cloud3DState.mjs');
      const cloud=await writeCloud3DState(projectId,'engineering',next);
      setTakeoff(next);
      if(!cloud.saved)setMessage(`چیدمان محلی ذخیره شد؛ همگام‌سازی ابری ناموفق / Saved locally; cloud sync failed: ${cloud.error}`);
    }catch(error){setMessage(error.message);}
    finally{dwgFurnitureBusyRef.current=false;setDwgFurnitureBusy(false);}
  }

  function applyDwgInteriorStyle() {
    try {
      const viewer=viewerRef.current;
      if(!viewer || !reconstruction?._runtime)throw new Error("Reconstruct the calibrated DWG first.");
      clearDesignOverlay(viewer);
      applyDwgInteriorMaterials(reconstruction);
      frameReconstruction(viewer,reconstruction.bounds);
      viewer.impl?.invalidate?.(true,true,true);
      setDesignResult({source:'local-dwg-interior',design:{style:'Warm interior',floorFinish:'Warm stone tone'},furnitureGenerated:false});
      setMessage("DWG interior materials applied. Geometry is unchanged. Automatic furnishing requires verified room boundaries and room uses; this style does not generate furniture.");
    } catch(error) {setMessage(error?.message || "Could not apply DWG interior materials.");}
  }

  function resetDesign() {
    const viewer = viewerRef.current;
    if (schematicScene && isInteriorSource(active3DSource)) {
      setDesignResult(null);
      setDesignPrompt("");
      restoreClassicSchematic();
      return;
    }
    clearDesignOverlay(viewer);
    resetDesignMaterials(reconstruction);
    viewer?.impl?.invalidate?.(true, true, true);
    setDesignResult(null);
    setMessage("AI design layer reset. Structural reconstruction is unchanged.");
  }


  async function captureCurrent3DJpeg() {
    return watermarkJpegCapture(await captureUnbranded3DJpeg());
  }

  async function captureUnbranded3DJpeg() {
    schematicRendererRef.current?.clearFurniturePreview?.();
    if (isInteriorSource(active3DSource)) {
      const standalone = schematicRendererRef.current;
      const canvas = schematicCanvasRef.current;

      if (!standalone || !canvas) {
        throw new Error("Schematic 3D is not ready.");
      }

      await standalone.ready?.();
      standalone.render?.();

      // Capture immediately after render. preserveDrawingBuffer keeps the
      // visible WebGL frame available for the 2D export copy.
      const exportCanvas =
        ventraCropCanvasToContent(
          standalone.captureCanvas?.() || canvas
        );

      return {
        blob:
          await ventraCanvasToJpegBlob(
            exportCanvas,
            0.97
          ),
        width:
          Math.max(
            1,
            exportCanvas.width
          ),
        height:
          Math.max(
            1,
            exportCanvas.height
          ),
      };
    }

    const viewer = viewerRef.current;

    if (viewer?.getScreenShot) {
      const width = Math.max(1600, containerRef.current?.clientWidth || 1600);
      const height = Math.max(900, containerRef.current?.clientHeight || 900);

      const dataUrl = await new Promise((resolve, reject) => {
        try {
          viewer.getScreenShot(width, height, (value) => {
            if (!value) reject(new Error("Autodesk screenshot failed."));
            else resolve(value);
          });
        } catch (error) {
          reject(error);
        }
      });

      return {
        blob: ventraDataUrlToBlob(dataUrl),
        width,
        height,
      };
    }

    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) throw new Error("3D canvas is unavailable.");

    const exportCanvas =
      ventraCropCanvasToContent(
        canvas
      );

    return {
      blob:
        await ventraCanvasToJpegBlob(
          exportCanvas,
          0.97
        ),
      width:
        Math.max(
          1,
          exportCanvas.width
        ),
      height:
        Math.max(
          1,
          exportCanvas.height
        ),
    };
  }

  async function saveCurrentViewAsJpg() {
    try {
      setExportBusy(true);
      const capture = await captureCurrent3DJpeg();
      ventraDownloadBlob(
        capture.blob,
        `${ventraSafeFileBase(projectId)}-3d-view.jpg`
      );
      setMessage("Current 3D view saved as JPG.");
    } catch (error) {
      console.error("[VENTRA SAVE JPG]", error);
      setMessage(error?.message || "Could not save JPG.");
    } finally {
      setExportBusy(false);
    }
  }

  async function saveCurrentViewAsPdf() {
    try {
      setExportBusy(true);
      const capture = await captureCurrent3DJpeg();
      const jpegBytes = new Uint8Array(await capture.blob.arrayBuffer());
      const title =
        schematicScene?.title ||
        takeoff?.project_name ||
        "Ventra 3D Model";

      const pdfBlob = ventraBuildSingleImagePdf(
        jpegBytes,
        capture.width,
        capture.height,
        title
      );

      ventraDownloadBlob(
        pdfBlob,
        `${ventraSafeFileBase(projectId)}-3d-view.pdf`
      );

      setMessage("Current 3D view saved as PDF.");
    } catch (error) {
      console.error("[VENTRA SAVE PDF]", error);
      setMessage(error?.message || "Could not save PDF.");
    } finally {
      setExportBusy(false);
    }
  }

  function saveSchematicAsCad() {
    try {
      if (!schematicScene || !isInteriorSource(active3DSource)) {
        setMessage(
          "CAD export for the JPG schematic is available as metric DXF. Original DWG files remain available from Drawings."
        );
        return;
      }

      const dxf = ventraSceneToMetricDxf(schematicScene);
      const blob = new Blob([dxf], {
        type: "application/dxf;charset=utf-8",
      });

      ventraDownloadBlob(
        blob,
        `${ventraSafeFileBase(projectId)}-autocad-plan.dxf`
      );

      setMessage(
        "AutoCAD-compatible metric DXF saved. Open it in AutoCAD and Save As DWG if a native DWG is required."
      );
    } catch (error) {
      console.error("[VENTRA SAVE CAD]", error);
      setMessage(error?.message || "Could not save CAD file.");
    }
  }

  function fitModel() {
    const viewer = viewerRef.current;

    if (schematicRendererRef.current && isInteriorSource(active3DSource)) {
      runSchematicCameraAction('fit');
      setMessage('Camera fitted to the JPG schematic scene.');
      return;
    }

    if ((reconstruction?.bounds || schematicModel?.bounds)) {
      const framed = frameReconstruction(
        viewer,
        reconstruction?.bounds || schematicModel?.bounds
      );

      if (framed) {
        setMessage('Camera fitted to Ventra 3D reconstruction.');
        return;
      }
    }

    viewer?.fitToView?.();
  }

  function homeView() {
    const viewer = viewerRef.current;

    if (schematicRendererRef.current && isInteriorSource(active3DSource)) {
      runSchematicCameraAction('home');
      return;
    }

    if ((reconstruction?.bounds || schematicModel?.bounds)) {
      frameReconstruction(
        viewer,
        reconstruction?.bounds || schematicModel?.bounds
      );
      return;
    }

    viewer?.navigation?.setRequestHomeView?.(true);
    viewer?.fitToView?.();
  }

  return (
    <LocalizedElement as="section" className="ventra-model-panel">
      <LocalizedElement as="header" className="ventra-model-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">PROJECT MODEL</LocalizedElement>
          <LocalizedElement as="h2">3D Model Viewer</LocalizedElement>
          <LocalizedElement as="p">
            Autodesk engineering models plus AI schematic 3D for JPG/PNG/WebP drawings.
          </LocalizedElement>
        </LocalizedElement>

        <LocalizedElement as="div" className={`ventra-model-status ventra-model-status-${status}`}>
          {status === "loading" ? "Loading" : status === "ready" ? "Ready" : status}
        </LocalizedElement>
      </LocalizedElement>

      <CloudSyncPanel key={`cloud:${projectId}`} projectId={projectId} />
      <ToolDrawer title="render"><PlanRenderPanel key={projectId} projectId={projectId} /></ToolDrawer>

      {schematicScene && active3DSource==='schematic' && (
        <LocalizedElement as="p" role="status" style={{ padding: "12px 16px", border: "1px solid #a58a36", borderRadius: 8 }}>
          {rasterReview?.report?.status === "analyzing"
            ? "Image analysis is still running. The model shown here is from an earlier analysis."
            : rasterReview?.report?.accepted === false
              ? "The latest image analysis was rejected. This is the previously saved model. Open Drawings for the error and analysis report."
              : schematicScene.geometryValidation?.pixelSupport !== "passed"
                ? "This saved model predates source-image alignment checks. Analyze the image in Drawings to validate it."
                : "Wall alignment and structural checks passed. Compare room labels, openings and completeness with the source drawing before using this schematic model."}
        </LocalizedElement>
      )}

      <LocalizedElement as="div" className="ventra-model-toolbar">
        <LocalizedElement as="button" type="button" aria-pressed={active3DSource==='aps'} onClick={()=>{void saveActiveSource(projectId,'aps').catch(error=>setMessage(error.message));refreshProject3DSourceFromStorage('aps');}}>DWG / Engineering</LocalizedElement>
        <LocalizedElement as="button" type="button" disabled={!readSchematicSync(projectId)} aria-pressed={active3DSource==='schematic'} onClick={()=>{void saveActiveSource(projectId,'schematic').catch(error=>setMessage(error.message));refreshProject3DSourceFromStorage('schematic');}}>JPG / Image</LocalizedElement>
        <LocalizedElement as="button" type="button" disabled={designBusy||dwgFurnitureBusy||(!reconstruction&&!dwgFloorIndices(takeoff).length)} aria-pressed={active3DSource==='dwg-interior'} onClick={()=>openDwgInterior()}>DWG Interior / داخل طبقه / داخل الطابق</LocalizedElement>
        <LocalizedElement as="button" type="button" onClick={fitModel} disabled={status !== "ready"}>
          Fit to View
        </LocalizedElement>
        <LocalizedElement as="button" type="button" onClick={homeView} disabled={status !== "ready"}>
          Home
        </LocalizedElement>
        <LocalizedElement as="button" type="button" onClick={saveCurrentViewAsJpg} disabled={exportBusy || status !== "ready"}>
          {exportBusy ? "Saving..." : "Save JPG"}
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          onClick={()=>reconstruct3D()}
          disabled={
            status !== "ready" ||
            reconstructing
          }
        >
          {reconstructing
            ? "Building 3D..."
            : reconstruction
              ? "Rebuild 3D"
              : schematicScene && isInteriorSource(active3DSource)
                ? "Rebuild Schematic"
                : "Reconstruct 3D"}
        </LocalizedElement>

        <ToolDrawer title="more" className="ventra-toolbar-drawer">
        <div className="ventra-drawer-actions">



        {schematicScene && isInteriorSource(active3DSource) && (
          <>
            <ToolDrawer title="styles">
            <div className="ventra-drawer-actions">
            <LocalizedElement as="span" className="ventra-toolbar-label">JPG Presets</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicPreset === 'classic' ? 'is-active' : ''} onClick={restoreClassicSchematic}>Classic</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicPreset === 'modern' ? 'is-active' : ''} onClick={() => applySchematicPreset('modern')}>Modern</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicPreset === 'minimal' ? 'is-active' : ''} onClick={() => applySchematicPreset('minimal')}>Minimal</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicPreset === 'luxury' ? 'is-active' : ''} onClick={() => applySchematicPreset('luxury')}>Luxury</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicPreset === 'facade' ? 'is-active' : ''} onClick={() => applySchematicPreset('facade')}>Facade</LocalizedElement>
            </div></ToolDrawer>
            <ToolDrawer title="navigation"><div className="ventra-drawer-actions">
            <LocalizedElement as="span" className="ventra-toolbar-label">Camera</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicNavMode === 'orbit' ? 'is-active' : ''} onClick={() => setSchematicNavMode('orbit')}>Orbit</LocalizedElement>
            <LocalizedElement as="button" type="button" className={schematicNavMode === 'pan' ? 'is-active' : ''} onClick={() => setSchematicNavMode('pan')}>Pan</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('zoomIn')}>Zoom +</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('zoomOut')}>Zoom -</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('iso')}>ISO</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('front')}>Front</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('left')}>Left</LocalizedElement>
            <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('top')}>Top</LocalizedElement>
            </div></ToolDrawer>
          </>
        )}


        <ToolDrawer title="camera"><LocalizedElement as="div" className="ventra-camera-dock" aria-label="Project camera controls">
          <LocalizedElement as="strong">View around project</LocalizedElement>
          {isInteriorSource(active3DSource) && <LocalizedElement as="button" type="button" aria-pressed={interiorView} onClick={()=>setInteriorView(value=>!value)}>{interiorView?'Show solid walls':'See through walls'}</LocalizedElement>}
          <LocalizedElement as="button" type="button" disabled={status!=='ready'} onClick={()=>{setAutoOrbit(false);orbitProject(Math.PI/4);}}>↶ Rotate 45°</LocalizedElement>
          <LocalizedElement as="button" type="button" disabled={status!=='ready'} onClick={()=>{setAutoOrbit(false);orbitProject(-Math.PI/4);}}>Rotate 45° ↷</LocalizedElement>
          <LocalizedElement as="button" type="button" disabled={status!=='ready'} aria-pressed={autoOrbit} onClick={()=>setAutoOrbit(value=>!value)}>{autoOrbit?'Stop rotation':'Auto 360°'}</LocalizedElement>
          {['front','back','left','right','top','bottom','iso'].map(view=><LocalizedElement as="button" type="button" key={view} disabled={status!=='ready'} onClick={()=>{setAutoOrbit(false);orbitProject(0,view);}}>{view.toUpperCase()}</LocalizedElement>)}
          <LocalizedElement as="button" type="button" disabled={status!=='ready'} onClick={()=>{setAutoOrbit(false);fitModel();}}>Center / Fit</LocalizedElement>
          <LocalizedElement as="small">Drag to orbit · right-drag / Shift to pan · scroll to zoom · touch: one finger rotates, two fingers pan/pinch</LocalizedElement>
        </LocalizedElement>
        </ToolDrawer>

        <ToolDrawer title="export"><div className="ventra-drawer-actions">
        <LocalizedElement as="span" className="ventra-toolbar-label">Export</LocalizedElement>
        {schematicScene && <LocalizedElement as="button" type="button" onClick={()=>{const report=schematicGeometryAudit(schematicScene);const url=URL.createObjectURL(new Blob([JSON.stringify({report,scene:schematicScene},null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`${projectId}-geometry-report.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Geometry report</LocalizedElement>}

        <LocalizedElement as="button"
          type="button"
          onClick={saveCurrentViewAsPdf}
          disabled={exportBusy || status !== "ready"}
        >
          Save PDF
        </LocalizedElement>

        <LocalizedElement as="button"
          type="button"
          onClick={saveSchematicAsCad}
          disabled={exportBusy || !schematicScene}
          title="Exports a metric AutoCAD DXF. Native DWG requires AutoCAD/ODA conversion."
        >
          Save DWG / CAD
        </LocalizedElement>
        </div></ToolDrawer>

        {schematicScene?.furnishingReview?.observations?.length > 0 && (
          <>
            <LocalizedElement as="input" ref={furnitureImageInput} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={repairFurnitureFromImage} />
            <LocalizedElement as="button" type="button" disabled={furnitureRepairBusy} onClick={()=>furnitureImageInput.current?.click()} title="Select the original plan image. Only rejected furniture is re-read; current walls and rooms are preserved.">
              {furnitureRepairBusy ? "Repairing furniture…" : "Repair Furniture Only"}
            </LocalizedElement>
          </>
        )}

        {reconstruction && (
          <LocalizedElement as="button"
            type="button"
            onClick={clear3D}
          >
            Hide Reconstruction
          </LocalizedElement>
        )}

        {viewables.length > 1 && (
          <LocalizedElement as="select"
            value={activeViewIndex}
            onChange={(event) => switchView(Number(event.target.value))}
          >
            {viewables.map((item, index) => (
              <LocalizedElement as="option" key={`${item.name}-${index}`} value={index}>
                {item.is3D ? "3D" : "2D"} · {item.name}
              </LocalizedElement>
            ))}
          </LocalizedElement>
        )}
        </div></ToolDrawer>
      </LocalizedElement>

      {message && (
        <LocalizedElement as="div" className="ventra-model-message">
          {message}
        </LocalizedElement>
      )}

      {schematicScene?.designDefaults && isInteriorSource(active3DSource) && (
        <div className="ventra-model-message" role="status">
          <LocalizedElement as="span">Design defaults are proposed furnishings, not measured quantities.</LocalizedElement>
          {!!schematicScene.designDefaults.warnings?.length && <span> · فضای امن کافی برای این وسایل پیدا نشد / No safe space / لا توجد مساحة آمنة: {schematicScene.designDefaults.warnings.map(w=>`${schematicScene.rooms?.find(r=>r.id===w.roomId)?.name||w.roomId}: ${w.type}`).join(" · ")}</span>}
        </div>
      )}
      {active3DSource === "aps" && <DwgFloorPanel reconstruction={reconstruction} region={dwgRegion} roomUses={dwgRoomUses} count={dwgFurnitureCount} busy={reconstructing||dwgFurnitureBusy} projectId={projectId} onReload={()=>reconstruct3D()} onRegion={i=>{setDwgRegion(i);reconstruct3D(i);}} onRoomUse={(id,value)=>setDwgRoomUses(v=>({...v,[id]:value}))} onFurnish={furnishDwgRooms} />}
      {active3DSource==='dwg-interior'&&<LocalizedElement as="div" className="ventra-model-message ventra-dwg-floor-panel">
        <LocalizedElement as="label">DWG floor / طبقه / الطابق <LocalizedElement as="select" value={schematicScene?.dwgRegion??0} disabled={designBusy||dwgFurnitureBusy} onChange={event=>openDwgInterior(Number(event.target.value))}>
          {dwgFloorIndices(takeoff).map(index=><LocalizedElement as="option" key={index} value={index}>Region {Number(index)+1}</LocalizedElement>)}
        </LocalizedElement></LocalizedElement>
        <div className="ventra-dwg-floor-buttons" role="group" aria-label="DWG floors">
          {dwgFloorIndices(takeoff).map(index=><LocalizedElement as="button" type="button" key={index} disabled={designBusy||dwgFurnitureBusy} aria-pressed={schematicScene?.dwgRegion===index} onClick={()=>openDwgInterior(index)}>Region {index+1}</LocalizedElement>)}
        </div>
        <LocalizedElement as="p">Available drawing regions: {dwgFloorIndices(takeoff).length}. Extracted room boundaries on this region: {schematicScene?.rooms.filter(room=>!room.scopeOnly).length||0}.</LocalizedElement>
        <LocalizedElement as="p">هر محدوده جدا در تراز صفر نمایش داده می‌شود؛ ترتیب طبقات را با نقشه بررسی کنید. / Each region is shown separately at floor level zero. Verify its floor order against the drawing.</LocalizedElement>
        {!!schematicScene?.dwgReview?.openingConflicts?.length&&<LocalizedElement as="p" role="status">{schematicScene.dwgReview.openingConflicts.length} uncertain opening bindings were excluded from this interior preview; their actual positions need review.</LocalizedElement>}
        {!schematicScene?.dwgReview?.roomRecovery&&<LocalizedElement as="p" role="status">CAD room labels are unavailable for boundary recovery. Open Drawings and analyze the current drawing to capture its text and geometry.</LocalizedElement>}
        {schematicScene?.dwgReview?.missingRooms&&<LocalizedElement as="p">مرز و نوع اتاق‌ها موجود نیست؛ مبلمان خودکار اضافه نشده است. از پنل Furniture برای چیدمان دستی استفاده کنید. / Room boundaries are missing; use Furniture for manual placement.</LocalizedElement>}
        {!schematicScene?.dwgReview?.missingRooms&&<LocalizedElement as="details"><LocalizedElement as="summary">Room uses / نوع اتاق‌ها / استخدام الغرف</LocalizedElement>
          {schematicScene?.rooms.filter(room=>!room.scopeOnly).map(room=><LocalizedElement as="label" key={room.id} style={{display:'block'}}>{room.name||room.id} <LocalizedElement as="select" value={room.semanticType||room.type||'unknown'} disabled={designBusy} onChange={event=>assignInteriorRoomUse(room.id,event.target.value)}>
            <LocalizedElement as="option" value="unknown">Unknown / نامشخص</LocalizedElement>
            {[['living','Living / نشیمن'],['kitchen','Kitchen / آشپزخانه'],['bedroom','Bedroom / اتاق خواب'],['bathroom','WC + Shower / سرویس و دوش'],['dining','Dining / ناهارخوری'],['terrace','Terrace / تراس']].map(([type,label])=><LocalizedElement as="option" key={type} value={type}>{label}</LocalizedElement>)}
          </LocalizedElement></LocalizedElement>)}
        </LocalizedElement>}
      </LocalizedElement>}

      {schematicModel && schematicScene && isInteriorSource(active3DSource) && (
        <ToolDrawer title="info">
        <LocalizedElement as="div" className="ventra-model-reconstruction-summary">
          <LocalizedElement as="strong">{active3DSource==='dwg-interior'?'DWG INTERIOR':'AI IMAGE SCHEMATIC 3D'}</LocalizedElement>
          <LocalizedElement as="span">{schematicScene.title || schematicScene.sceneType || "Room"}</LocalizedElement>
          <LocalizedElement as="span">Approx. {Number(schematicModel.width || 0).toFixed(2)} × {Number(schematicModel.depth || 0).toFixed(2)} m</LocalizedElement>
          <LocalizedElement as="span">Height {Number(schematicModel.height || 0).toFixed(2)} m</LocalizedElement>
          <LocalizedElement as="span">{schematicModel.assetCount || 0} furniture/fixture object(s)</LocalizedElement>
          {active3DSource!=='dwg-interior'&&schematicScene.furnishingMode === 'source_observed' && (
            <LocalizedElement as="span" role="status">
              Furniture traced from image: {sourcePresentationAssets(schematicScene).filter(a=>a.placementSource==='source_image_observation_v1').length} accepted;
              {' '}{schematicScene.furnishingReview?.rejected?.length || 0} need review. Verify against the original drawing.
              {!!schematicScene.furnishingReview?.missing?.length && ` Unconfirmed fixtures: ${schematicScene.furnishingReview.missing.map(item=>`${item.type} (${schematicScene.rooms?.find(room=>room.id===item.roomId)?.name||item.roomId})`).join(', ')}.`}
              {schematicScene.furnishingReview?.coverageReview?.status && schematicScene.furnishingReview.coverageReview.status !== 'completed' && ' Furniture verification did not complete; inspect the source plan.'}
            </LocalizedElement>
          )}
          <LocalizedElement as="span">{schematicModel.openingCount || 0} opening(s)</LocalizedElement>
          <LocalizedElement as="span">{schematicGeometryAudit(schematicScene).doorCount} doors · {schematicGeometryAudit(schematicScene).windowCount} windows · {schematicGeometryAudit(schematicScene).issues.length} opening geometry issue(s). Source comparison required.</LocalizedElement>
          <LocalizedElement as="span">Mode: schematic, not engineering BOQ</LocalizedElement>
        </LocalizedElement>
        </ToolDrawer>
      )}

      {reconstruction && (
        <ToolDrawer title="info">
        <LocalizedElement as="div" className="ventra-model-reconstruction-summary">
          <LocalizedElement as="strong">VENTRA RECONSTRUCTION</LocalizedElement>
          <LocalizedElement as="span">
            {reconstruction.wallCount} wall segments
          </LocalizedElement>
          <LocalizedElement as="span">
            {reconstruction.wallPieceCount || 0} wall pieces
          </LocalizedElement>
          <LocalizedElement as="span">
            {reconstruction.wallOpeningCutCount || 0} single-parent opening cuts
          </LocalizedElement>
          <LocalizedElement as="span">
            Doors {reconstruction.doorCount || 0}/{reconstruction.expectedDoorCount || 0}
          </LocalizedElement>
          <LocalizedElement as="span">
            Windows {reconstruction.windowCount || 0}/{reconstruction.expectedWindowCount || 0}
          </LocalizedElement>
          <LocalizedElement as="span">
            {reconstruction.slabCount || 0} slab(s)
          </LocalizedElement>
          <LocalizedElement as="span">
            Rejected opening objects {(reconstruction.rejectedDoorObjects || 0) + (reconstruction.rejectedWindowObjects || 0)}
          </LocalizedElement>
          {reconstruction.skippedFloorCount > 0 && (
            <LocalizedElement as="span">
              {reconstruction.skippedFloorCount} invalid floor polygon(s) skipped
            </LocalizedElement>
          )}
          <LocalizedElement as="span">
            Height {reconstruction.wallHeightMeters.toFixed(2)} m
          </LocalizedElement>
          <LocalizedElement as="span">
            Thickness {reconstruction.wallThicknessMeters.toFixed(2)} m
          </LocalizedElement>
          <LocalizedElement as="span">
            {reconstruction.storeyCount} storey(s)
          </LocalizedElement>
          <LocalizedElement as="span">
            Source sheet {reconstruction.sourceModelUnloaded ? "removed" : reconstruction.sourceModelHidden ? "hidden" : "visible"}
          </LocalizedElement>
          <LocalizedElement as="span">
            Storey height {Number(reconstruction.storeyHeightMeters || 0).toFixed(2)} m
          </LocalizedElement>
          <LocalizedElement as="span">
            Space {reconstruction.coordinateSpace}
          </LocalizedElement>
          <LocalizedElement as="span">
            Size {Number(reconstruction.geometryFrame?.widthMeters || 0).toFixed(2)} × {Number(reconstruction.geometryFrame?.depthMeters || 0).toFixed(2)} m
          </LocalizedElement>
          <LocalizedElement as="span">
            Wall source {reconstruction.wallLineSource}
          </LocalizedElement>
          <LocalizedElement as="span">
            Door source {reconstruction.doorSource}
          </LocalizedElement>
          <LocalizedElement as="span">
            Window source {reconstruction.windowSource}
          </LocalizedElement>
          <LocalizedElement as="span">
            Slab source provisional_convex_hull
          </LocalizedElement>
        </LocalizedElement>
        </ToolDrawer>
      )}


      {(reconstruction || (schematicScene && isInteriorSource(active3DSource))) && (
        <ToolDrawer title="prompt">
        <LocalizedElement as="section" className="ventra-design-studio">
          <LocalizedElement as="div" className="ventra-design-studio-heading">
            <LocalizedElement as="div">
              <LocalizedElement as="span">AI DESIGN STUDIO</LocalizedElement>
              <LocalizedElement as="h3">Interior + Facade Prompt</LocalizedElement>
              <LocalizedElement as="p">
                Prompt-edit materials and scene objects. Image schematic mode stays separate from BOQ/Estimate engineering quantities.
              </LocalizedElement>
            </LocalizedElement>
            {schematicScene && isInteriorSource(active3DSource) && (schematicScene.geometryValidation?.openings?.rejectedObservationIds?.length > 0 || schematicScene.furnishingReview?.rejected?.some(r => r.reason === "intersects_wall")) && (
              <LocalizedElement as="button" type="button" disabled={designBusy} onClick={restoreRejectedDoors}>Repair observed geometry</LocalizedElement>
            )}
            {promptUndoScene && promptUndoScene.projectId === projectId && promptUndoScene.documentId === schematicScene?.documentId && isInteriorSource(active3DSource) && (
              <LocalizedElement as="button" type="button" disabled={designBusy} onClick={undoPromptEdit}>Undo last prompt</LocalizedElement>
            )}
            {designResult && (
              <LocalizedElement as="div" className="ventra-design-source">
                {designResult.source === "openai" ? "OpenAI" : "Safe fallback"}
              </LocalizedElement>
            )}
          </LocalizedElement>

          <LocalizedElement as="textarea"
            value={designPrompt}
            onChange={(event) => setDesignPrompt(event.target.value)}
            placeholder="Example: Modern luxury interior with warm off-white walls, beige marble floors, dark walnut doors and a contemporary beige stone facade with black accents."
            rows={4}
          />

          <LocalizedElement as="div" className="ventra-design-actions">
            {reconstruction && !isInteriorSource(active3DSource) && (
              <LocalizedElement as="button" type="button" className="secondary" onClick={applyDwgInteriorStyle} disabled={designBusy}>
                DWG Interior Materials
              </LocalizedElement>
            )}
            <LocalizedElement as="button"
              type="button"
              onClick={() => applyDesignPrompt()}
              disabled={designBusy}
            >
              {designBusy ? "Designing…" : "Apply Prompt"}
            </LocalizedElement>
            <LocalizedElement as="button"
              type="button"
              className="secondary"
              onClick={() => (schematicScene && isInteriorSource(active3DSource)) ? applySchematicPreset("modern") : applyDesignPrompt("Modern interior with clean neutral walls, stone-look floor, contemporary furniture and dark metal accents.")}
              disabled={designBusy}
            >
              Modern
            </LocalizedElement>
            <LocalizedElement as="button"
              type="button"
              className="secondary"
              onClick={() => (schematicScene && isInteriorSource(active3DSource)) ? applySchematicPreset("minimal") : applyDesignPrompt("Warm minimal interior, light greige walls, natural oak floor, warm wood doors and simple neutral finishes.")}
              disabled={designBusy}
            >
              Minimal
            </LocalizedElement>
            <LocalizedElement as="button"
              type="button"
              className="secondary"
              onClick={() => (schematicScene && isInteriorSource(active3DSource)) ? applySchematicPreset("luxury") : applyDesignPrompt("Modern luxury interior, warm ivory walls, beige marble floor, walnut doors and refined bronze accents.")}
              disabled={designBusy}
            >
              Luxury
            </LocalizedElement>
            <LocalizedElement as="button"
              type="button"
              className="secondary"
              onClick={() => (schematicScene && isInteriorSource(active3DSource)) ? applySchematicPreset("facade") : applyDesignPrompt("Contemporary exterior facade with light limestone, charcoal accents, dark doors and blue-grey glass.")}
              disabled={designBusy}
            >
              Facade
            </LocalizedElement>
            {designResult && (
              <LocalizedElement as="button" type="button" className="danger" onClick={resetDesign}>
                Reset Design
              </LocalizedElement>
            )}
          </LocalizedElement>

          {designResult?.design && (
            <LocalizedElement as="div" className="ventra-design-summary">
              <LocalizedElement as="strong">{designResult.design.style || "Custom design"}</LocalizedElement>
              <LocalizedElement as="span">Floor: {designResult.design.floorFinish || "design finish"}</LocalizedElement>
              <LocalizedElement as="span">Facade: {designResult.design.facadeFinish || "design finish"}</LocalizedElement>
              <LocalizedElement as="span">BOQ impact: none</LocalizedElement>
            </LocalizedElement>
          )}
        </LocalizedElement>
        </ToolDrawer>
      )}

      <LocalizedElement as="div" className="ventra-model-layout">
        <LocalizedElement as="div" className="ventra-model-canvas-shell">
          {!urn && !schematicScene && status === "missing" ? (
            <LocalizedElement as="div" className="ventra-model-empty">
              <LocalizedElement as="strong">No APS model available</LocalizedElement>
              <LocalizedElement as="p">
                Open Drawings and analyze a DWG/DXF/IFC/RVT engineering file, or upload a JPG/PNG/WebP image for AI schematic 3D.
              </LocalizedElement>
            </LocalizedElement>
          ) : (
            <div ref={containerRef} className="ventra-model-canvas" dir="ltr">
              {/* The SDK host must not subscribe to UI translation context. */}
              <div ref={apsContainerRef} dir="ltr" translate="no" style={{width:"100%",height:"100%",display:isInteriorSource(active3DSource)?'none':'block'}} />
              {schematicScene && isInteriorSource(active3DSource) && (
                <>
                  <LocalizedElement as="canvas"
                    ref={schematicCanvasRef}
                    aria-label="Ventra schematic 3D canvas"
                    style={{ width: "100%", height: "100%", display: "block" }}
                  />
                  <LocalizedElement as="div" className="ventra-schematic-overlay-controls">
                    <LocalizedElement as="button" type="button" className={schematicNavMode === 'orbit' ? 'is-active' : ''} onClick={() => setSchematicNavMode('orbit')}>Orbit</LocalizedElement>
                    <LocalizedElement as="button" type="button" className={schematicNavMode === 'pan' ? 'is-active' : ''} onClick={() => setSchematicNavMode('pan')}>Pan</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('zoomIn')}>+</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('zoomOut')}>-</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('iso')}>Iso</LocalizedElement>
                    <ToolDrawer title="camera" className="ventra-overlay-drawer"><div className="ventra-drawer-actions">
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('top')}>Top</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('front')}>Front</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={() => runSchematicCameraAction('left')}>Left</LocalizedElement>
                    <LocalizedElement as="button" type="button" onClick={fitModel}>Fit</LocalizedElement>
                    </div></ToolDrawer>
                  </LocalizedElement>
                </>
              )}
            </div>
          )}
        </LocalizedElement>

        <aside className="ventra-model-sidebar">
          {schematicScene && isInteriorSource(active3DSource) && <FurnitureEditorPanel key={`${projectId}:${schematicScene.documentId}:${schematicScene.dwgRegion??"image"}:${active3DSource}`} scene={schematicScene} getRenderer={()=>schematicRendererRef.current} onCommit={commitFurnitureScene} onCommitOpenings={commitOpeningScene} disabled={designBusy||furnitureRepairBusy||status!=='ready'}/>}
        <ToolDrawer title="inspector">
        <LocalizedElement as="div" className="ventra-model-inspector">
          {schematicScene && isInteriorSource(active3DSource) ? (
            <>
              <LocalizedElement as="span">SCHEMATIC INSPECTOR</LocalizedElement>
              <LocalizedElement as="h3">{schematicScene.title || "JPG Schematic 3D"}</LocalizedElement>
              <LocalizedElement as="p">Standalone Three.js visualization. This mode is separate from Autodesk engineering quantities.</LocalizedElement>
              <LocalizedElement as="div" className="ventra-model-properties">
                <LocalizedElement as="div"><LocalizedElement as="small">Style</LocalizedElement><LocalizedElement as="strong">{schematicPreset || schematicScene.style || "classic"}</LocalizedElement></LocalizedElement>
                <LocalizedElement as="div"><LocalizedElement as="small">Room size</LocalizedElement><LocalizedElement as="strong">{Number(schematicModel?.width || 0).toFixed(2)} × {Number(schematicModel?.depth || 0).toFixed(2)} m</LocalizedElement></LocalizedElement>
                <LocalizedElement as="div"><LocalizedElement as="small">Height</LocalizedElement><LocalizedElement as="strong">{Number(schematicModel?.height || 0).toFixed(2)} m</LocalizedElement></LocalizedElement>
                <LocalizedElement as="div"><LocalizedElement as="small">Furniture / fixtures</LocalizedElement><LocalizedElement as="strong">{schematicModel?.assetCount || 0}</LocalizedElement></LocalizedElement>
                <LocalizedElement as="div"><LocalizedElement as="small">Openings</LocalizedElement><LocalizedElement as="strong">{schematicModel?.openingCount || 0}</LocalizedElement></LocalizedElement>
                <LocalizedElement as="div"><LocalizedElement as="small">Camera</LocalizedElement><LocalizedElement as="strong">{schematicNavMode === "pan" ? "Pan" : "Orbit"}</LocalizedElement></LocalizedElement>
              </LocalizedElement>
            </>
          ) : selectedObject ? (
            <>
              <LocalizedElement as="span">OBJECT INSPECTOR</LocalizedElement>
              <LocalizedElement as="h3"><OriginalText>{selectedObject.name}</OriginalText></LocalizedElement>
              <LocalizedElement as="p">dbId: {selectedObject.dbId}</LocalizedElement>

              <LocalizedElement as="div" className="ventra-model-properties">
                {selectedObject.properties.length > 0 ? (
                  selectedObject.properties.map((property, index) => (
                    <LocalizedElement as="div" key={`${property.displayName}-${index}`}>
                      <LocalizedElement as="small">{property.displayName || property.attributeName}</LocalizedElement>
                      <LocalizedElement as="strong">{String(property.displayValue)}</LocalizedElement>
                    </LocalizedElement>
                  ))
                ) : (
                  <LocalizedElement as="p">No displayable properties were returned for this object.</LocalizedElement>
                )}
              </LocalizedElement>
            </>
          ) : (
            <>
              <LocalizedElement as="span">OBJECT INSPECTOR</LocalizedElement>
              <LocalizedElement as="p">Select an object in the Viewer to inspect its Autodesk properties.</LocalizedElement>
            </>
          )}
        </LocalizedElement>
        </ToolDrawer>
        </aside>
      </LocalizedElement>
    </LocalizedElement>
  );
}
