"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import { extractModelProperties } from "@/services/apsPropertyExtractor";
import { useEffect, useRef, useState } from "react";
import {
  extract2DGeometry,
  getModelProperties,
} from "@/services/apsGeometryExtractor";
import "./ApsViewer.css";

const VIEWER_SCRIPT =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";

const VIEWER_STYLESHEET =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";

let viewerSdkPromise = null;

function loadViewerSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Autodesk Viewer can only run in the browser.")
    );
  }

  if (window.Autodesk?.Viewing) {
    return Promise.resolve();
  }

  if (viewerSdkPromise) {
    return viewerSdkPromise;
  }

  viewerSdkPromise = new Promise((resolve, reject) => {
    if (
      !document.querySelector(
        `link[href="${VIEWER_STYLESHEET}"]`
      )
    ) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = VIEWER_STYLESHEET;
      document.head.appendChild(link);
    }

    const existingScript = document.querySelector(
      `script[src="${VIEWER_SCRIPT}"]`
    );

    if (existingScript) {
      existingScript.addEventListener(
        "load",
        resolve,
        { once: true }
      );

      existingScript.addEventListener(
        "error",
        () =>
          reject(
            new Error(
              "Autodesk Viewer SDK could not be loaded."
            )
          ),
        { once: true }
      );

      return;
    }

    const script = document.createElement("script");
    script.src = VIEWER_SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(
        new Error(
          "Autodesk Viewer SDK could not be loaded."
        )
      );

    document.body.appendChild(script);
  });

  return viewerSdkPromise;
}

async function requestViewerToken(url) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error ||
        `APS token endpoint failed with HTTP ${response.status}.`
    );
  }

  return payload;
}

async function fetchViewerToken(callback) {
  try {
    let payload;

    try {
      payload = await requestViewerToken("/api/aps/token");
    } catch (primaryError) {
      console.warn(
        "[APS Viewer Token] Primary token route failed; trying compatibility route.",
        primaryError
      );
      payload = await requestViewerToken("/api/aps/viewer-token");
    }

    callback(
      payload.access_token,
      Number(payload.expires_in) || 3599
    );
  } catch (error) {
    console.error("[APS Viewer Token]", error);
    callback("", 0);
  }
}

function loadDocument(viewer, urn) {
  return new Promise((resolve, reject) => {
    window.Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      async (viewerDocument) => {
        try {
          const defaultGeometry =
            viewerDocument
              .getRoot()
              .getDefaultGeometry();

          if (!defaultGeometry) {
            throw new Error(
              "The Autodesk model does not contain viewable geometry."
            );
          }

          const model =
            await viewer.loadDocumentNode(
              viewerDocument,
              defaultGeometry
            );

          const viewGuid =
            defaultGeometry?.guid?.() ||
            defaultGeometry?.data?.guid ||
            null;

          console.log(
            "[VENTRA APS VIEW] loaded",
            {
              viewGuid,
              viewName:
                defaultGeometry?.name?.() ||
                defaultGeometry?.data?.name ||
                null,
              role:
                defaultGeometry?.data?.role ||
                null,
            }
          );

          resolve({
            model,
            viewGuid,
          });
        } catch (error) {
          reject(error);
        }
      },
      (code, message, errors) => {
        console.error(
          "[APS Document Load]",
          {
            code,
            message,
            errors,
          }
        );

        reject(
          new Error(
            message ||
              `Autodesk document loading failed with code ${code}.`
          )
        );
      }
    );
  });
}


function ventraCollectDbIds(model) {
  try {
    const tree = model?.getInstanceTree?.();
    if (!tree) return [];

    const rootId = tree.getRootId();
    const ids = [];
    const seen = new Set();

    const visit = (dbId) => {
      if (seen.has(dbId)) return;
      seen.add(dbId);
      ids.push(dbId);

      tree.enumNodeChildren(
        dbId,
        (childId) => visit(childId),
        false
      );
    };

    visit(rootId);
    return ids;
  } catch {
    return [];
  }
}

function ventraGetProperties(model, dbId) {
  return new Promise((resolve) => {
    try {
      model.getProperties(
        dbId,
        (item) => resolve(item || null),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

function ventraGetBulkTextProperties(model, dbIds) {
  return new Promise((resolve) => {
    try {
      // Autodesk getBulkProperties expects a property filter as its second
      // argument. Passing an empty object (the previous Ventra behavior) can
      // return no useful properties for 2D DWG text objects.
      const textPropertyNames = [
        "Text",
        "Contents",
        "Content",
        "Value",
        "Name",
        "Text String",
        "String",
        "MText",
        "MTEXT",
        "Entity",
        "Entity Type",
        "Object Type",
        "Layer",
      ];

      model.getBulkProperties(
        dbIds,
        textPropertyNames,
        (items) =>
          resolve(
            Array.isArray(items)
              ? items
              : []
          ),
        () => resolve([])
      );
    } catch {
      resolve([]);
    }
  });
}

async function ventraMapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] =
          await mapper(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length || 1) },
      () => worker()
    )
  );

  return results;
}

function ventraNormalizeCadText(value) {
  return String(value ?? "")
    .replace(/\\P/gi, " ")
    .replace(/\\~+/g, " ")
    .replace(/\{\\[^;{}]+;/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%[A-Z0-9]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function ventraClassifyRoomText(value) {
  const text = ventraNormalizeCadText(value);

  if (!text || text.length > 80) {
    return null;
  }

  const rules = [
    [/MASTER\s+BED\s*ROOM|MASTER\s+BEDROOM/, "master_bedroom", "Master Bedroom"],
    [/\bBED\s*ROOM\b|\bBEDROOM\b|\bBED\s*[0-9]+\b/, "bedroom", "Bedroom"],
    [/\bLIVING\s+ROOM\b|\bLIVING\s+RM\b|\bLIVING\b/, "living_room", "Living Room"],
    [/\bFAMILY\s+ROOM\b/, "family_room", "Family Room"],
    [/\bDINING\s+ROOM\b|\bDINING\b/, "dining_room", "Dining Room"],
    [/\bKITCHEN\b|\bKIT\.?(?:CHEN)?\b/, "kitchen", "Kitchen"],
    [/\bPANTRY\b/, "pantry", "Pantry"],
    [/\bLAUNDRY\b|\bL['’]?DRY\b/, "laundry", "Laundry"],
    [/\bBATH\s*ROOM\b|\bBATHROOM\b|\bBATH\b/, "bathroom", "Bathroom"],
    [/\bTOILET\b|\bW\.?\s*C\.?\b/, "toilet", "Toilet"],
    [/\bPOWDER\s+ROOM\b|\bPOWDER\b/, "powder_room", "Powder Room"],
    [/\bSTUDY\b/, "study", "Study"],
    [/\bOFFICE\b/, "office", "Office"],
    [/\bCORRIDOR\b|\bCORR\.?(?:IDOR)?\b/, "corridor", "Corridor"],
    [/\bFOYER\b/, "foyer", "Foyer"],
    [/\bHALL\b/, "hall", "Hall"],
    [/\bWALK[\s-]*IN\s+CLOSET\b|\bWIC\b/, "walk_in_closet", "Walk-in Closet"],
    [/\bCLOSET\b/, "closet", "Closet"],
    [/\bSTORE\b|\bSTORAGE\b/, "store", "Store"],
    [/\bBALCONY\b/, "balcony", "Balcony"],
    [/\bTERRACE\b/, "terrace", "Terrace"],
    [/\bGARAGE\b/, "garage", "Garage"],
  ];

  for (const [pattern, roomType, label] of rules) {
    if (pattern.test(text)) {
      return {
        roomType,
        label,
        rawLabel: text,
      };
    }
  }

  return null;
}

function ventraExtractStringsFromPropertyItem(item) {
  const values = [];

  if (item?.name) {
    values.push(item.name);
  }

  for (
    const property of Array.isArray(item?.properties)
      ? item.properties
      : []
  ) {
    if (property?.displayValue !== undefined) {
      values.push(property.displayValue);
    }

    // Some DWG derivatives expose the text in the property name rather than
    // displayValue. Include it as a fallback, while room classification keeps
    // the accepted vocabulary deliberately narrow.
    if (property?.displayName) {
      values.push(property.displayName);
    }
  }

  return values;
}

function ventraGetNodeWorldBounds(model, dbId) {
  try {
    const tree = model?.getInstanceTree?.();
    const fragList = model?.getFragmentList?.();
    const THREE =
      window?.THREE ||
      window?.Autodesk?.Viewing?.Private?.THREE;

    if (!tree || !THREE?.Box3) {
      return null;
    }

    const box = new THREE.Box3();
    let hasBounds = false;

    if (fragList) {
      tree.enumNodeFragments(
        dbId,
        (fragId) => {
          try {
            const fragBox = new THREE.Box3();
            fragList.getWorldBounds(
              fragId,
              fragBox
            );

            if (
              Number.isFinite(fragBox?.min?.x) &&
              Number.isFinite(fragBox?.min?.y) &&
              Number.isFinite(fragBox?.max?.x) &&
              Number.isFinite(fragBox?.max?.y)
            ) {
              if (!hasBounds) {
                box.copy(fragBox);
                hasBounds = true;
              } else {
                box.union(fragBox);
              }
            }
          } catch {}
        },
        true
      );
    }

    // 2D text nodes occasionally have no directly enumerable fragment. The
    // InstanceTree node box is a useful fallback for those objects.
    if (!hasBounds && typeof tree.getNodeBox === "function") {
      try {
        const nodeBox = new Float32Array(6);
        tree.getNodeBox(dbId, nodeBox);

        if (
          [...nodeBox].every((value) =>
            Number.isFinite(Number(value))
          )
        ) {
          box.min.set(
            Number(nodeBox[0]),
            Number(nodeBox[1]),
            Number(nodeBox[2])
          );
          box.max.set(
            Number(nodeBox[3]),
            Number(nodeBox[4]),
            Number(nodeBox[5])
          );
          hasBounds = true;
        }
      } catch {}
    }

    if (!hasBounds) {
      return null;
    }

    const center = box.getCenter(
      new THREE.Vector3()
    );

    return {
      min: {
        x: box.min.x,
        y: box.min.y,
        z: box.min.z,
      },
      max: {
        x: box.max.x,
        y: box.max.y,
        z: box.max.z,
      },
      centroid: {
        x: center.x,
        y: center.y,
        z: center.z,
      },
    };
  } catch {
    return null;
  }
}

async function ventraGetServerRoomCandidates(
  urn,
  viewGuid = null
) {
  if (!urn) return [];

  try {
    const response = await fetch(
      "/api/aps/room-metadata",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urn,
          viewGuid,
        }),
      }
    );

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload?.candidates)
      ? payload.candidates
      : [];
  } catch (error) {
    console.warn(
      "[VENTRA ROOM META] server metadata lookup failed",
      error
    );
    return [];
  }
}

async function ventraExtractRoomLabelsFromViewer(
  viewer,
  model,
  meterFactor = 1,
  urn = "",
  viewGuid = null
) {
  const tree = model?.getInstanceTree?.();
  const allDbIds = ventraCollectDbIds(model);
  const scale =
    Number.isFinite(Number(meterFactor)) &&
    Number(meterFactor) > 0
      ? Number(meterFactor)
      : 1;

  const candidatesByDbId = new Map();

  const addCandidate = (
    dbId,
    classification,
    source
  ) => {
    if (
      dbId === null ||
      dbId === undefined ||
      !classification
    ) {
      return;
    }

    const key = String(dbId);
    const existing = candidatesByDbId.get(key);

    // Prefer actual property text over a tree-node-name match when both are
    // available for the same dbId.
    if (
      !existing ||
      source !== "aps_tree_node_name"
    ) {
      candidatesByDbId.set(key, {
        dbId,
        ...classification,
        textSource: source,
      });
    }
  };

  // Pass 0: query Autodesk Model Derivative properties on the server.
  // This does not depend on the Viewer's client-side property index and is
  // considerably more reliable for 2D DWG MTEXT/ATTRIB entities.
  const serverCandidates =
    await ventraGetServerRoomCandidates(
      urn,
      viewGuid
    );

  for (const candidate of serverCandidates) {
    const rawMetadataLabel =
      String(
        candidate?.rawLabel ||
        candidate?.label ||
        ""
      ).trim();

    // Model Derivative often exposes component/block names such as
    // "Bathroom - Plan" or "Toilet [13330]". They prove that bathroom/toilet
    // objects exist, but they are NOT necessarily the printed room label.
    // Never attach these component names directly to a room polygon.
    const looksLikeComponentName =
      /\s-\s*Plan\b/i.test(
        rawMetadataLabel
      ) ||
      /\[[0-9A-F]+\]/i.test(
        rawMetadataLabel
      );

    if (looksLikeComponentName) {
      console.log(
        "[VENTRA ROOM META] evidence-only component",
        {
          dbId:
            candidate?.dbId,
          rawLabel:
            rawMetadataLabel,
          roomType:
            candidate?.roomType,
        }
      );
      continue;
    }

    addCandidate(
      candidate?.dbId,
      candidate?.roomType
        ? {
            roomType: candidate.roomType,
            label: candidate.label,
            rawLabel: candidate.rawLabel,
          }
        : null,
      "aps_model_derivative_properties"
    );
  }

  console.log(
    "[VENTRA ROOM META] server candidates",
    {
      count: serverCandidates.length,
      labels: serverCandidates.map(
        (item) => item.label
      ),
    }
  );

  // Pass 1: node names are free and often contain AutoCAD MTEXT values.
  if (tree) {
    for (const dbId of allDbIds) {
      try {
        const nodeName = tree.getNodeName?.(dbId);
        addCandidate(
          dbId,
          ventraClassifyRoomText(nodeName),
          "aps_tree_node_name"
        );
      } catch {}
    }
  }

  // Pass 2: use getBulkProperties correctly with an explicit property filter.
  const chunkSize = 400;
  for (
    let index = 0;
    index < allDbIds.length;
    index += chunkSize
  ) {
    const items =
      await ventraGetBulkTextProperties(
        model,
        allDbIds.slice(
          index,
          index + chunkSize
        )
      );

    for (const item of items) {
      for (const value of
        ventraExtractStringsFromPropertyItem(item)) {
        const classification =
          ventraClassifyRoomText(value);

        if (classification) {
          addCandidate(
            item?.dbId,
            classification,
            "aps_bulk_property"
          );
          break;
        }
      }
    }
  }

  // Pass 3: if the derivative did not expose enough room text through bulk
  // properties, fetch all properties per dbId. This is slower but deterministic
  // and is only used as the APS-native fallback before any Vision OCR.
  if (candidatesByDbId.size < 3) {
    const propertyItems =
      await ventraMapLimit(
        allDbIds,
        24,
        (dbId) =>
          ventraGetProperties(
            model,
            dbId
          )
      );

    for (const item of propertyItems) {
      if (!item) continue;

      for (const value of
        ventraExtractStringsFromPropertyItem(item)) {
        const classification =
          ventraClassifyRoomText(value);

        if (classification) {
          addCandidate(
            item?.dbId,
            classification,
            "aps_get_properties"
          );
          break;
        }
      }
    }
  }

  const results = [];

  for (const candidate of
    candidatesByDbId.values()) {
    const bounds =
      ventraGetNodeWorldBounds(
        model,
        candidate.dbId
      );

    // Never manufacture a room label with guessed coordinates. If APS text has
    // no spatial bounds, let the existing Vision fallback handle it instead.
    if (!bounds?.centroid) {
      continue;
    }

    results.push({
      dbId: candidate.dbId,
      label: candidate.label,
      rawLabel: candidate.rawLabel,
      roomType: candidate.roomType,
      centroid: {
        x:
          Number(bounds.centroid.x) *
          scale,
        y:
          Number(bounds.centroid.y) *
          scale,
      },
      boundingBox: {
        min: {
          x:
            Number(bounds.min.x) *
            scale,
          y:
            Number(bounds.min.y) *
            scale,
        },
        max: {
          x:
            Number(bounds.max.x) *
            scale,
          y:
            Number(bounds.max.y) *
            scale,
        },
      },
      source:
        "aps_direct_text_world_bounds",
      textSource:
        candidate.textSource,
      confidence: 100,
    });
  }

  console.log(
    "[VENTRA ROOM META] scanned",
    {
      dbIds: allDbIds.length,
      textCandidates:
        candidatesByDbId.size,
      spatialLabels: results.length,
    }
  );

  console.log(
    "[VENTRA ROOM META] labels",
    results.map((item) => ({
      dbId: item.dbId,
      label: item.label,
      roomType: item.roomType,
      centroid: item.centroid,
      rawLabel: item.rawLabel,
      textSource: item.textSource,
    }))
  );

  return results;
}

export default function ApsViewer({
  urn,
  title = "Autodesk Model Viewer",
  onGeometryExtracted,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  const [status, setStatus] =
    useState("loading");

  const [errorMessage, setErrorMessage] =
    useState("");

  const [objectCount, setObjectCount] =
    useState(null);

  const [geometryResult, setGeometryResult] =
    useState(null);

  useEffect(() => {
    let cancelled = false;

    async function startViewer() {
      if (!urn || !containerRef.current) {
        return;
      }

      try {
        setStatus("loading");
        setErrorMessage("");
        setObjectCount(null);
        setGeometryResult(null);

        await loadViewerSdk();

        if (
          cancelled ||
          !containerRef.current
        ) {
          return;
        }

        await new Promise(
          (resolve, reject) => {
            window.Autodesk.Viewing.Initializer(
              {
                env: "AutodeskProduction2",
                api: "streamingV2_EU",
                getAccessToken:
                  fetchViewerToken,
              },
              resolve,
              reject
            );
          }
        );

        if (
          cancelled ||
          !containerRef.current
        ) {
          return;
        }

        if (viewerRef.current) {
          viewerRef.current.finish();
          viewerRef.current = null;
          containerRef.current.innerHTML =
            "";
        }

        const viewer =
          new window.Autodesk.Viewing.GuiViewer3D(
            containerRef.current,
            {
              extensions: [
                "Autodesk.DocumentBrowser",
              ],
            }
          );

        const startCode = viewer.start();

        if (startCode > 0) {
          throw new Error(
            `Autodesk Viewer could not start. Error code: ${startCode}`
          );
        }

        viewerRef.current = viewer;
        viewer.setTheme("dark-theme");

        const {
          model,
          viewGuid,
        } =
          await loadDocument(
            viewer,
            urn
          );

        if (cancelled) {
          return;
        }

        viewer.fitToView();

       const objects =
  await getModelProperties(model);

console.log(
  "[Ventra APS Model Objects]",
  objects
);

window.__ventraObjects = objects;

console.log(
  "[VENTRA FIRST APS OBJECT]",
  objects?.[0]
);

console.log(
  "[VENTRA FIRST OBJECT PROPERTIES]",
  objects?.[0]?.properties
);





let properties;

try {
  properties = await extractModelProperties(viewer);
  
  console.log("[VENTRA EXTRACTED MODEL PROPERTIES]", properties);
} catch (err) {
  console.error("PROPERTY EXTRACTION FAILED:", err);
  throw err;
}


console.log(
  "[VENTRA EXTRACTED MODEL PROPERTIES]",
  properties
);

window.__ventraModelProperties =
  properties;

if (cancelled) {
  return;
}

const geometry =
  await extract2DGeometry(
    viewer,
    model,
    objects
  );

setObjectCount(objects.length);
setGeometryResult(geometry);
setStatus("ready");

let roomVisionImage = null;
try {
  const width = Math.max(1200, viewer?.container?.clientWidth || containerRef.current?.clientWidth || 1200);
  const height = Math.max(800, viewer?.container?.clientHeight || containerRef.current?.clientHeight || 800);

  const imageSourceToDataUrl = async (source) => {
    if (!source) return null;

    if (typeof source === "string" && source.startsWith("data:image/")) {
      return source;
    }

    if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
      try {
        const value = source.toDataURL("image/png");
        return value?.startsWith("data:image/") ? value : null;
      } catch {
        return null;
      }
    }

    if (typeof Blob !== "undefined" && source instanceof Blob) {
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(
          typeof reader.result === "string" && reader.result.startsWith("data:image/")
            ? reader.result
            : null
        );
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(source);
      });
    }

    if (typeof source !== "string") return null;

    // Autodesk Viewer normally returns a blob URL. Load that URL into an Image
    // and redraw it into our own canvas. This avoids browser differences around
    // fetch(blob:...) and gives the Vision endpoint a real data:image/png URL.
    return await new Promise((resolve) => {
      const image = new Image();
      const timeout = window.setTimeout(() => resolve(null), 7000);
      image.onload = () => {
        window.clearTimeout(timeout);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || width;
          canvas.height = image.naturalHeight || height;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(null);
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const value = canvas.toDataURL("image/png");
          resolve(value?.startsWith("data:image/") ? value : null);
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        resolve(null);
      };
      image.src = source;
    });
  };

  const captureWithViewer = async () =>
    await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value || null);
      };
      const timer = window.setTimeout(() => done(null), 8000);
      try {
        viewer.getScreenShot(width, height, async (source) => {
          done(await imageSourceToDataUrl(source));
        });
      } catch (error) {
        console.warn("[VENTRA ROOM VISION] viewer.getScreenShot failed", error);
        done(null);
      }
    });

  const captureWithStaticApi = async () => {
    const ScreenShot = window.Autodesk?.Viewing?.ScreenShot;
    if (!ScreenShot?.getScreenShot) return null;

    return await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value || null);
      };
      const timer = window.setTimeout(() => done(null), 8000);
      try {
        ScreenShot.getScreenShot(
          width,
          height,
          async (source) => done(await imageSourceToDataUrl(source)),
          { fullPage: true, margin: 0 },
          viewer.impl
        );
      } catch (error) {
        console.warn("[VENTRA ROOM VISION] Autodesk.Viewing.ScreenShot failed", error);
        done(null);
      }
    });
  };

  viewer.resize?.();
  viewer.fitToView?.();
  viewer.impl?.invalidate?.(true, true, true);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => window.setTimeout(resolve, 500));

  roomVisionImage = await captureWithViewer();
  if (!roomVisionImage) {
    roomVisionImage = await captureWithStaticApi();
  }

  if (!roomVisionImage) {
    try {
      const canvas = viewer.impl?.canvas || viewer?.container?.querySelector?.("canvas") || containerRef.current?.querySelector?.("canvas");
      roomVisionImage = await imageSourceToDataUrl(canvas);
    } catch (canvasError) {
      console.warn("[VENTRA ROOM VISION] canvas fallback failed", canvasError);
    }
  }

  console.log("[VENTRA ROOM VISION] screenshot", {
    captured: Boolean(roomVisionImage),
    length: roomVisionImage?.length || 0,
    prefix: roomVisionImage?.slice?.(0, 30) || null,
    width,
    height,
  });
} catch (screenshotError) {
  console.warn("[VENTRA ROOM VISION] Viewer screenshot unavailable", screenshotError);
}

const viewerRoomLabels =
  await ventraExtractRoomLabelsFromViewer(
    viewer,
    model,
    geometry?.meterFactor,
    urn,
    viewGuid
  );

onGeometryExtracted?.({
  ...geometry,
  objects,
  properties,
  roomVisionImage,
  apsUrn: urn,
  viewerRoomLabels,
});
      } catch (error) {
        console.error(
          "[APS Viewer]",
          error
        );

        if (!cancelled) {
          setStatus("error");

          setErrorMessage(
            error?.message ||
              "Could not display the Autodesk model."
          );
        }
      }
    }

    startViewer();

    return () => {
      cancelled = true;

      if (viewerRef.current) {
        viewerRef.current.finish();
        viewerRef.current = null;
      }
    };
  }, [urn]);

  if (!urn) {
    return null;
  }

  const arcCount = geometryResult
    ? Number(
        geometryResult.circularArcCount ||
          0
      ) +
      Number(
        geometryResult.ellipticalArcCount ||
          0
      )
    : 0;

  const formattedLength =
    geometryResult &&
    Number.isFinite(
      Number(
        geometryResult.totalLengthMeters
      )
    )
      ? `${Number(
          geometryResult.totalLengthMeters
        ).toFixed(2)} m`
      : null;

  return (
    <LocalizedElement as="section" className="aps-viewer-card">
      <LocalizedElement as="div" className="aps-viewer-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">AUTODESK APS</LocalizedElement>
          <LocalizedElement as="h3">{title}</LocalizedElement>

          {objectCount !== null && (
            <LocalizedElement as="p">
              {objectCount} model objects
              detected
            </LocalizedElement>
          )}

          {geometryResult && (
            <LocalizedElement as="div" className="aps-geometry-summary">
              <LocalizedElement as="p">
                Lines:{" "}
                <LocalizedElement as="strong">
                  {geometryResult.lineCount ||
                    0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="p">
                Arcs:{" "}
                <LocalizedElement as="strong">{arcCount}</LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="p">
                Total curve length:{" "}
                <LocalizedElement as="strong">
                  {formattedLength ||
                    `${Number(
                      geometryResult.totalCurveLength ||
                        0
                    ).toFixed(2)} ${
                      geometryResult.unit ||
                      "model units"
                    }`}
                </LocalizedElement>
              </LocalizedElement>
            </LocalizedElement>
          )}
        </LocalizedElement>

        <LocalizedElement as="strong"
          className={`aps-viewer-status aps-viewer-status-${status}`}
        >
          {status === "ready"
            ? "Ready"
            : status === "error"
              ? "Error"
              : "Loading"}
        </LocalizedElement>
      </LocalizedElement>

      <LocalizedElement as="div" className="aps-viewer-shell">
        {status === "loading" && (
          <LocalizedElement as="div" className="aps-viewer-overlay">
            Loading Autodesk model...
          </LocalizedElement>
        )}

        {status === "error" && (
          <LocalizedElement as="div" className="aps-viewer-overlay aps-viewer-overlay-error">
            {errorMessage}
          </LocalizedElement>
        )}

        <LocalizedElement as="div"
          ref={containerRef}
          className="aps-viewer-container"
        />
      </LocalizedElement>
    </LocalizedElement>
  );
}