"use client";
import {commercialFetch} from "@/lib/commercialFetch";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";


import { useEffect, useRef, useState } from "react";
import {
  extract2DGeometry,
  getModelProperties,
} from "@/services/apsGeometryExtractor";
import { extractModelProperties } from "@/services/apsPropertyExtractor";
import { detectLayers } from "@/services/apsLayerDetector";
import "./ApsViewer.css";

const VIEWER_SCRIPT =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.108.0/viewer3D.min.js";

const VIEWER_STYLESHEET =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.108.0/style.min.css";

const VIEWER_WORKER =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.108.0/lmvworker.min.js";

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
      if (window.Autodesk?.Viewing) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", resolve, {
        once: true,
      });

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

async function installViewerWorkerCompatibility() {
  if (
    typeof window === "undefined" ||
    typeof window.Worker !== "function" ||
    typeof Blob === "undefined" ||
    !window.URL?.createObjectURL
  ) {
    return () => {};
  }

  const NativeWorker = window.Worker;
  let workerBlobUrl = null;

  try {
    const response = await commercialFetch(VIEWER_WORKER, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `Autodesk Viewer worker prefetch failed with HTTP ${response.status}.`
      );
    }

    const workerSource = await response.text();

    if (
      !workerSource ||
      workerSource.trim().startsWith("<!DOCTYPE") ||
      workerSource.trim().startsWith("<html")
    ) {
      throw new Error(
        "Autodesk Viewer worker returned an invalid JavaScript response."
      );
    }

    workerBlobUrl = window.URL.createObjectURL(
      new Blob([workerSource], {
        type: "text/javascript",
      })
    );

    class VentraViewerWorker extends NativeWorker {
      constructor(scriptURL, options) {
        const source = String(scriptURL || "");

        // Autodesk Viewer creates a tiny blob bootstrap whose only job is to
        // import lmvworker.min.js. On some Chromium/Windows setups that
        // cross-origin importScripts call fails even though the worker URL
        // itself is reachable. Use the exact same Autodesk-hosted worker code
        // that was prefetched above, but execute it from a blob URL instead.
        const resolvedURL =
          source.startsWith("blob:")
            ? workerBlobUrl
            : scriptURL;

        super(resolvedURL, options);
      }
    }

    Object.defineProperty(
      VentraViewerWorker,
      "name",
      {
        value: "Worker",
      }
    );

    window.Worker = VentraViewerWorker;

    console.log(
      "[VENTRA APS] Autodesk Viewer worker compatibility enabled",
      {
        version: "7.108.0",
        source: VIEWER_WORKER,
      }
    );

    return () => {
      if (window.Worker === VentraViewerWorker) {
        window.Worker = NativeWorker;
      }

      if (workerBlobUrl) {
        window.URL.revokeObjectURL(workerBlobUrl);
        workerBlobUrl = null;
      }
    };
  } catch (error) {
    console.warn(
      "[VENTRA APS] Viewer worker compatibility prefetch failed; using Autodesk default worker loading.",
      error
    );

    if (workerBlobUrl) {
      window.URL.revokeObjectURL(workerBlobUrl);
    }

    return () => {};
  }
}

async function requestViewerToken(url, { signal } = {}) {
  const response = await commercialFetch(url, {
    method: "GET",
    cache: "no-store",
    signal,
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

function createViewerTokenProvider({
  isCancelled,
  signal,
  onTokenError,
}) {
  return async function fetchViewerToken(callback) {
    if (isCancelled()) {
      return;
    }

    try {
      const payload = await requestViewerToken(
        "/api/aps/token",
        { signal }
      );

      if (isCancelled() || signal?.aborted) {
        return;
      }

      const token = String(
        payload?.access_token || ""
      );

      const expiresIn =
        Number(payload?.expires_in) || 3599;

      if (!token) {
        throw new Error(
          "APS token endpoint returned an empty access token."
        );
      }

      callback(token, expiresIn);
    } catch (error) {
      if (
        isCancelled() ||
        signal?.aborted ||
        error?.name === "AbortError"
      ) {
        console.log(
          "[VENTRA APS TOKEN] cancelled with inactive viewer"
        );
        return;
      }

      console.warn(
        "[VENTRA APS TOKEN] request failed",
        error
      );

      onTokenError?.(error);
    }
  };
}

function initializeViewer(getAccessToken) {
  return new Promise((resolve, reject) => {
    window.Autodesk.Viewing.Initializer(
      {
        env: "AutodeskProduction2",
        api: "streamingV2_EU",
        getAccessToken,
      },
      resolve,
      reject
    );
  });
}

function loadDocument(viewer, urn, isCancelled) {
  return new Promise((resolve, reject) => {
    window.Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      async (viewerDocument) => {
        try {
          if (
            isCancelled() ||
            !viewer ||
            !viewer.impl ||
            !viewerDocument
          ) {
            resolve(null);
            return;
          }

          const root = viewerDocument.getRoot();

          if (!root) {
            throw new Error(
              "Autodesk document root is unavailable."
            );
          }

          const geometryNode = root.getDefaultGeometry();

          if (!geometryNode) {
            throw new Error(
              "The Autodesk model does not contain viewable geometry."
            );
          }

          const model = await viewer.loadDocumentNode(
            viewerDocument,
            geometryNode
          );

          if (
            isCancelled() ||
            !viewer.impl ||
            !model
          ) {
            resolve(null);
            return;
          }

          const viewGuid =
            geometryNode?.guid?.() ||
            geometryNode?.data?.guid ||
            null;

          const viewName =
            geometryNode?.name?.() ||
            geometryNode?.data?.name ||
            null;

          console.log(
            "[VENTRA CURRENT APS VIEW v22]",
            {
              viewGuid,
              viewName,
              role:
                geometryNode?.data?.role ||
                null,
            }
          );

          resolve({
            model,
            viewGuid,
            viewName,
          });
        } catch (error) {
          reject(error);
        }
      },
      (code, message, errors) => {
        console.error("[APS Document Load]", {
          code,
          message,
          errors,
        });

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

async function waitForViewerContainer(containerRef, isCancelled) {
  const maxFrames = 120;
  const requiredStableFrames = 3;
  let stableFrames = 0;
  let lastSize = null;

  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (isCancelled()) {
      return null;
    }

    const container = containerRef.current;

    if (container && container.isConnected) {
      const rect = container.getBoundingClientRect?.();
      const width = Number(rect?.width ?? container.clientWidth ?? 0);
      const height = Number(rect?.height ?? container.clientHeight ?? 0);

      const visibleEnough =
        width >= 80 &&
        height >= 80;

      const nearlySameAsLast =
        lastSize &&
        Math.abs(lastSize.width - width) < 1 &&
        Math.abs(lastSize.height - height) < 1;

      if (visibleEnough) {
        stableFrames =
          nearlySameAsLast
            ? stableFrames + 1
            : 1;

        lastSize = { width, height };

        if (stableFrames >= requiredStableFrames) {
          return container;
        }
      } else {
        stableFrames = 0;
        lastSize = null;
      }
    } else {
      stableFrames = 0;
      lastSize = null;
    }

    await new Promise((resolve) => {
      window.requestAnimationFrame(resolve);
    });
  }

  console.warn(
    "[VENTRA VIEWER LIFECYCLE] Autodesk viewer container never reached a stable visible size."
  );

  return null;
}


function getViewerContainerSize(
  viewer
) {
  const container =
    viewer?.container ||
    viewer?.impl?.canvas
      ?.parentElement ||
    null;

  if (
    !container ||
    !container.isConnected
  ) {
    return {
      width: 0,
      height: 0,
      valid: false,
    };
  }

  const rect =
    container
      .getBoundingClientRect?.();

  const width =
    Number(
      rect?.width ??
      container.clientWidth ??
      0
    );

  const height =
    Number(
      rect?.height ??
      container.clientHeight ??
      0
    );

  return {
    width,
    height,
    valid:
      width > 1 &&
      height > 1,
  };
}

function viewerCanRender(
  viewer
) {
  return Boolean(
    viewer &&
    !viewer.__ventraFinished &&
    viewer.impl &&
    getViewerContainerSize(
      viewer
    ).valid
  );
}

function safelyFinishViewer(viewer) {
  if (
    !viewer ||
    viewer.__ventraFinished
  ) {
    return;
  }

  viewer.__ventraFinished =
    true;

  try {
    if (viewer.impl) {
      viewer.finish();
    }
  } catch (error) {
    const message =
      String(
        error?.message ||
          error ||
          ""
      ).toLowerCase();

    if (
      !message.includes(
        "unloaded"
      )
    ) {
      console.warn(
        "[APS Viewer Cleanup]",
        error
      );
    }
  }
}


async function captureAuthoritativeViewerImage(
  viewer
) {
  if (!viewer?.impl) {
    return null;
  }

  const width = 2600;
  const height = 1800;

  const sourceToDataUrl =
    async (source) => {
      if (!source) {
        return null;
      }

      if (
        typeof source === "string" &&
        source.startsWith("data:image/")
      ) {
        return source;
      }

      if (
        typeof Blob !== "undefined" &&
        source instanceof Blob
      ) {
        return await new Promise(
          (resolve) => {
            const reader =
              new FileReader();
            reader.onload = () =>
              resolve(
                typeof reader.result === "string"
                  ? reader.result
                  : null
              );
            reader.onerror = () =>
              resolve(null);
            reader.readAsDataURL(source);
          }
        );
      }

      if (typeof source !== "string") {
        return null;
      }

      return await new Promise(
        (resolve) => {
          const image =
            new Image();
          const timer =
            window.setTimeout(
              () => resolve(null),
              10000
            );

          image.onload = () => {
            window.clearTimeout(timer);

            try {
              const canvas =
                document.createElement(
                  "canvas"
                );

              canvas.width =
                image.naturalWidth ||
                width;
              canvas.height =
                image.naturalHeight ||
                height;

              const context =
                canvas.getContext("2d");

              if (!context) {
                resolve(null);
                return;
              }

              context.fillStyle =
                "#ffffff";
              context.fillRect(
                0,
                0,
                canvas.width,
                canvas.height
              );

              context.drawImage(
                image,
                0,
                0,
                canvas.width,
                canvas.height
              );

              resolve(
                canvas.toDataURL(
                  "image/png"
                )
              );
            } catch {
              resolve(null);
            }
          };

          image.onerror = () => {
            window.clearTimeout(timer);
            resolve(null);
          };

          image.src = source;
        }
      );
    };

  try {
    const initialSize =
      getViewerContainerSize(
        viewer
      );

    if (
      !viewerCanRender(viewer)
    ) {
      console.log(
        "[VENTRA VIEWER LIFECYCLE v20] capture skipped for zero/detached container",
        initialSize
      );

      return null;
    }

    viewer.resize?.();
    viewer.fitToView?.();
    viewer.impl.invalidate?.(
      true,
      true,
      true
    );

    await new Promise(
      (resolve) =>
        requestAnimationFrame(
          () =>
            requestAnimationFrame(
              resolve
            )
        )
    );

    await new Promise(
      (resolve) =>
        window.setTimeout(
          resolve,
          900
        )
    );

    if (
      !viewerCanRender(viewer)
    ) {
      console.log(
        "[VENTRA VIEWER LIFECYCLE v20] screenshot skipped after container became unavailable",
        getViewerContainerSize(
          viewer
        )
      );

      return null;
    }

    const value =
      await new Promise(
        (resolve) => {
          let settled = false;

          const finish =
            (result) => {
              if (settled) {
                return;
              }

              settled = true;
              window.clearTimeout(
                timer
              );
              resolve(
                result || null
              );
            };

          const timer =
            window.setTimeout(
              () => finish(null),
              12000
            );

          try {
            viewer.getScreenShot(
              width,
              height,
              async (source) =>
                finish(
                  await sourceToDataUrl(
                    source
                  )
                )
            );
          } catch {
            finish(null);
          }
        }
      );

    console.log(
      "[VENTRA ANALYZER] real Viewer capture",
      {
        captured:
          Boolean(value),
        width,
        height,
        length:
          value?.length || 0,
      }
    );

    return value;
  } catch (error) {
    console.warn(
      "[VENTRA ANALYZER] real Viewer capture failed",
      error
    );

    return null;
  }
}


function ventraNormalizeRoomText(value) {
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
  const text =
    ventraNormalizeRoomText(
      value
    );

  if (
    !text ||
    text.length > 80
  ) {
    return null;
  }

  // Block/component names such as "Bathroom - Plan" are evidence that a
  // bathroom block exists, not proof that the printed room label is there.
  if (
    /\s-\s*PLAN\b/i.test(text) ||
    /\[[0-9A-F]+\]/i.test(text)
  ) {
    return null;
  }

  const rules = [
    [
      /MASTER\s+BED\s*ROOM|MASTER\s+BEDROOM/,
      "master_bedroom",
      "Master Bedroom",
    ],
    [
      /\bBED\s*ROOM\b|\bBEDROOM\b|\bBED\s*[0-9]+\b/,
      "bedroom",
      "Bedroom",
    ],
    [
      /\bLIVING\s+ROOM\b|\bLIVING\s+RM\b|\bLIVING\b/,
      "living_room",
      "Living Room",
    ],
    [
      /\bFAMILY\s+ROOM\b/,
      "family_room",
      "Family Room",
    ],
    [
      /\bDINING\s+ROOM\b|\bDINING\b|\bDINNING\s+ROOM\b|\bDINNING\b/,
      "dining_room",
      "Dining Room",
    ],
    [
      /\bKITCHEN\b|\bKIT\.?(?:CHEN)?\b/,
      "kitchen",
      "Kitchen",
    ],
    [
      /\bPANTRY\b/,
      "pantry",
      "Pantry",
    ],
    [
      /\bLAUNDRY\b|\bL['’]?DRY\b/,
      "laundry",
      "Laundry",
    ],
    [
      /\bBATH\s*ROOM\b|\bBATHROOM\b|\bBATH\b/,
      "bathroom",
      "Bathroom",
    ],
    [
      /\bTOILET\b|\bW\.?\s*C\.?\b/,
      "toilet",
      "Toilet",
    ],
    [
      /\bPOWDER\s+ROOM\b|\bPOWDER\b/,
      "powder_room",
      "Powder Room",
    ],
    [
      /\bSTUDY\b/,
      "study",
      "Study",
    ],
    [
      /\bOFFICE\b/,
      "office",
      "Office",
    ],
    [
      /\bCORRIDOR\b|\bCORR\.?(?:IDOR)?\b/,
      "corridor",
      "Corridor",
    ],
    [
      /\bFOYER\b/,
      "foyer",
      "Foyer",
    ],
    [
      /\bHALL\b/,
      "hall",
      "Hall",
    ],
    [
      /\bWALK[\s-]*IN\s+CLOSET\b|\bWIC\b/,
      "walk_in_closet",
      "Walk-in Closet",
    ],
    [
      /\bCLOSET\b/,
      "closet",
      "Closet",
    ],
    [
      /\bSTORE\b|\bSTORAGE\b/,
      "store",
      "Store",
    ],
    [
      /\bBALCONY\b/,
      "balcony",
      "Balcony",
    ],
    [
      /\bTERRACE\b/,
      "terrace",
      "Terrace",
    ],
    [
      /\bGARAGE\b/,
      "garage",
      "Garage",
    ],
  ];

  for (
    const [
      pattern,
      roomType,
      label,
    ] of rules
  ) {
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

function ventraRoomStrings(item) {
  const values = [];

  for (const value of [
    item?.name,
    item?.label,
    item?.text,
    item?.value,
    item?.family,
    item?.type,
  ]) {
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim()
    ) {
      values.push(value);
    }
  }

  for (
    const property of
      Array.isArray(
        item?.properties
      )
        ? item.properties
        : []
  ) {
    for (const value of [
      property?.displayValue,
      property?.displayName,
      property?.value,
      property?.name,
    ]) {
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim()
      ) {
        values.push(value);
      }
    }
  }

  return values;
}

function ventraNodeWorldBounds(
  model,
  dbId
) {
  try {
    const tree =
      model?.getInstanceTree?.();
    const fragList =
      model?.getFragmentList?.();
    const THREE =
      window?.THREE ||
      window?.Autodesk
        ?.Viewing
        ?.Private
        ?.THREE;

    if (
      !tree ||
      !THREE?.Box3
    ) {
      return null;
    }

    const box =
      new THREE.Box3();
    let hasBounds = false;

    if (fragList) {
      tree.enumNodeFragments(
        dbId,
        (fragId) => {
          try {
            const fragBox =
              new THREE.Box3();

            fragList.getWorldBounds(
              fragId,
              fragBox
            );

            if (
              Number.isFinite(
                fragBox?.min?.x
              ) &&
              Number.isFinite(
                fragBox?.min?.y
              ) &&
              Number.isFinite(
                fragBox?.max?.x
              ) &&
              Number.isFinite(
                fragBox?.max?.y
              )
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

    if (
      !hasBounds &&
      typeof tree.getNodeBox ===
        "function"
    ) {
      try {
        const nodeBox =
          new Float32Array(6);

        tree.getNodeBox(
          dbId,
          nodeBox
        );

        if (
          [...nodeBox].every(
            (value) =>
              Number.isFinite(
                Number(value)
              )
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

    const center =
      box.getCenter(
        new THREE.Vector3()
      );

    return {
      centroid: {
        x: center.x,
        y: center.y,
      },
      min: {
        x: box.min.x,
        y: box.min.y,
      },
      max: {
        x: box.max.x,
        y: box.max.y,
      },
    };
  } catch {
    return null;
  }
}


async function ventraFetchServerRoomCandidates(
  urn,
  viewGuid = null, viewName = null, viewRole = null
) {
  if (!urn) {
    return [];
  }

  try {
    const response =
      await commercialFetch(
        "/api/aps/room-metadata",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              urn,
              viewGuid, viewName, viewRole,
            }),
        }
      );

    if (!response.ok) {
      console.warn(
        "[VENTRA ROOM META BRIDGE v21] metadata endpoint returned non-200",
        {
          status:
            response.status,
        }
      );

      return [];
    }

    const payload =
      await response.json();

    const candidates =
      Array.isArray(
        payload?.candidates
      )
        ? payload.candidates
        : [];

    console.log(
      "[VENTRA ROOM META BRIDGE v21] server candidates",
      {
        count:
          candidates.length,
        labels:
          candidates.map(
            (item) => ({
              dbId:
                item?.dbId ??
                null,
              label:
                item?.label ||
                null,
              rawLabel:
                item?.rawLabel ||
                null,
              view:
                item?.viewName ||
                null,
            })
          ),
      }
    );

    return candidates;
  } catch (error) {
    console.warn(
      "[VENTRA ROOM META BRIDGE v21] request failed",
      error
    );

    return [];
  }
}


function ventraCollectCurrentViewDbIds(
  model
) {
  try {
    const tree =
      model?.getInstanceTree?.();

    if (!tree) {
      return [];
    }

    const rootId =
      tree.getRootId();

    const ids = [];
    const seen =
      new Set();

    const visit =
      (dbId) => {
        if (
          seen.has(dbId)
        ) {
          return;
        }

        seen.add(dbId);
        ids.push(dbId);

        tree.enumNodeChildren(
          dbId,
          (childId) =>
            visit(childId),
          false
        );
      };

    visit(rootId);

    return ids;
  } catch {
    return [];
  }
}

function ventraGetBulkCurrentViewText(
  model,
  dbIds
) {
  return new Promise(
    (resolve) => {
      try {
        const filters = [
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
          filters,
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
    }
  );
}

function ventraGetCurrentViewProperties(
  model,
  dbId
) {
  return new Promise(
    (resolve) => {
      try {
        model.getProperties(
          dbId,
          (item) =>
            resolve(
              item || null
            ),
          () =>
            resolve(null)
        );
      } catch {
        resolve(null);
      }
    }
  );
}

async function ventraScanCurrentViewRoomText(
  model
) {
  const dbIds =
    ventraCollectCurrentViewDbIds(
      model
    );

  const results =
    new Map();

  const add =
    (
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

      const key =
        String(dbId);

      const existing =
        results.get(key);

      if (
        !existing ||
        source !==
          "aps_tree_node_name"
      ) {
        results.set(
          key,
          {
            dbId,
            ...classification,
            textSource:
              source,
          }
        );
      }
    };

  const tree =
    model?.getInstanceTree?.();

  if (tree) {
    for (
      const dbId of
        dbIds
    ) {
      try {
        add(
          dbId,
          ventraClassifyRoomText(
            tree.getNodeName?.(
              dbId
            )
          ),
          "aps_tree_node_name"
        );
      } catch {}
    }
  }

  const chunkSize = 350;

  for (
    let index = 0;
    index < dbIds.length;
    index += chunkSize
  ) {
    const items =
      await ventraGetBulkCurrentViewText(
        model,
        dbIds.slice(
          index,
          index +
            chunkSize
        )
      );

    for (
      const item of items
    ) {
      for (
        const value of
          ventraRoomStrings(
            item
          )
      ) {
        const classification =
          ventraClassifyRoomText(
            value
          );

        if (
          classification
        ) {
          add(
            item?.dbId,
            classification,
            "aps_bulk_property"
          );
          break;
        }
      }
    }
  }

  // Only use the slower per-dbId fallback when the cheap passes failed to
  // find a useful room set. With ~500 objects this is still bounded.
  if (
    results.size < 6
  ) {
    const concurrency = 20;
    let cursor = 0;

    const workers =
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              dbIds.length ||
                1
            ),
        },
        async () => {
          while (
            cursor <
            dbIds.length
          ) {
            const index =
              cursor++;

            const dbId =
              dbIds[index];

            const item =
              await ventraGetCurrentViewProperties(
                model,
                dbId
              );

            if (!item) {
              continue;
            }

            for (
              const value of
                ventraRoomStrings(
                  item
                )
            ) {
              const classification =
                ventraClassifyRoomText(
                  value
                );

              if (
                classification
              ) {
                add(
                  dbId,
                  classification,
                  "aps_get_properties"
                );
                break;
              }
            }
          }
        }
      );

    await Promise.all(
      workers
    );
  }

  console.log(
    "[VENTRA CURRENT VIEW ROOM TEXT v22]",
    {
      dbIds:
        dbIds.length,
      candidates:
        results.size,
      labels:
        [...results.values()]
          .map(
            (item) => ({
              dbId:
                item.dbId,
              label:
                item.label,
              roomType:
                item.roomType,
              source:
                item.textSource,
            })
          ),
    }
  );

  return results;
}

async function ventraExtractApsRoomLabels({
  model,
  objects,
  properties,
  geometry,
  urn,
  viewGuid = null, viewName = null, viewRole = null,
}) {
  const byDbId =
    new Map();

  const addItems = (
    items,
    source
  ) => {
    for (
      const item of
        Array.isArray(items)
          ? items
          : []
    ) {
      const dbId =
        item?.dbId;

      if (
        dbId === null ||
        dbId === undefined
      ) {
        continue;
      }

      let classification =
        null;

      for (
        const value of
          ventraRoomStrings(item)
      ) {
        classification =
          ventraClassifyRoomText(
            value
          );

        if (classification) {
          break;
        }
      }

      if (!classification) {
        continue;
      }

      const key =
        String(dbId);

      // Prefer richer extracted model properties over the leaf-object list.
      if (
        byDbId.has(key) &&
        source ===
          "aps_model_objects"
      ) {
        continue;
      }

      byDbId.set(key, {
        dbId,
        ...classification,
        textSource: source,
      });
    }
  };

  addItems(
    objects,
    "aps_model_objects"
  );

  addItems(
    properties,
    "aps_extracted_properties"
  );

  const currentViewCandidates =
    await ventraScanCurrentViewRoomText(
      model
    );

  for (
    const candidate of
      currentViewCandidates.values()
  ) {
    byDbId.set(
      String(
        candidate.dbId
      ),
      candidate
    );
  }

  const serverCandidates =
    await ventraFetchServerRoomCandidates(
      urn,
      viewGuid, viewName, viewRole
    );

  for (
    const candidate of
      serverCandidates
  ) {
    const dbId =
      candidate?.dbId;

    if (
      dbId === null ||
      dbId === undefined
    ) {
      continue;
    }

    const rawLabel =
      String(
        candidate?.rawLabel ||
        candidate?.label ||
        ""
      ).trim();

    // Component/block names are not printed room labels.
    if (
      /\s-\s*Plan\b/i.test(
        rawLabel
      ) ||
      /\[[0-9A-F]+\]/i.test(
        rawLabel
      )
    ) {
      continue;
    }

    const classification =
      candidate?.roomType &&
      candidate?.label
        ? {
            roomType:
              candidate.roomType,
            label:
              candidate.label,
            rawLabel:
              candidate.rawLabel ||
              candidate.label,
          }
        : ventraClassifyRoomText(
            rawLabel
          );

    if (!classification) {
      continue;
    }

    // Server Model Derivative properties are richer than client node names,
    // so they are authoritative for text. Spatial coordinates still come
    // only from the current loaded model by dbId.
    byDbId.set(
      String(dbId),
      {
        dbId,
        ...classification,
        textSource:
          "aps_model_derivative_properties",
        sourceViewGuid:
          candidate?.guid ||
          null,
        sourceViewName:
          candidate?.viewName ||
          null,
      }
    );
  }

  const geometryCentroids =
    geometry
      ?.objectGeometryCentroids &&
    typeof geometry
      .objectGeometryCentroids ===
      "object"
      ? geometry
          .objectGeometryCentroids
      : {};

  const scale =
    Number.isFinite(
      Number(
        geometry?.meterFactor
      )
    ) &&
    Number(
      geometry?.meterFactor
    ) > 0
      ? Number(
          geometry.meterFactor
        )
      : 1;

  const results = [];

  for (
    const candidate of
      byDbId.values()
  ) {
    const geometryPoint =
      geometryCentroids[
        String(
          candidate.dbId
        )
      ] ||
      geometryCentroids[
        candidate.dbId
      ] ||
      null;

    let centroid = null;
    let boundingBox = null;
    let spatialSource = null;

    if (
      geometryPoint &&
      Number.isFinite(
        Number(
          geometryPoint.x
        )
      ) &&
      Number.isFinite(
        Number(
          geometryPoint.y
        )
      )
    ) {
      const x =
        Number(
          geometryPoint.x
        );
      const y =
        Number(
          geometryPoint.y
        );
      const width =
        Math.abs(
          Number(
            geometryPoint.width
          ) || 0
        );
      const height =
        Math.abs(
          Number(
            geometryPoint.height
          ) || 0
        );

      centroid = {
        x,
        y,
      };

      if (
        width > 0 ||
        height > 0
      ) {
        boundingBox = {
          min: {
            x:
              x - width / 2,
            y:
              y - height / 2,
          },
          max: {
            x:
              x + width / 2,
            y:
              y + height / 2,
          },
        };
      }

      spatialSource =
        "aps_dbid_geometry_bounds";
    } else {
      const bounds =
        ventraNodeWorldBounds(
          model,
          candidate.dbId
        );

      if (
        bounds?.centroid &&
        Number.isFinite(
          Number(
            bounds.centroid.x
          )
        ) &&
        Number.isFinite(
          Number(
            bounds.centroid.y
          )
        )
      ) {
        centroid = {
          x:
            Number(
              bounds.centroid.x
            ) * scale,
          y:
            Number(
              bounds.centroid.y
            ) * scale,
        };

        boundingBox = {
          min: {
            x:
              Number(
                bounds.min.x
              ) * scale,
            y:
              Number(
                bounds.min.y
              ) * scale,
          },
          max: {
            x:
              Number(
                bounds.max.x
              ) * scale,
            y:
              Number(
                bounds.max.y
              ) * scale,
          },
        };

        spatialSource =
          "aps_node_world_bounds";
      }
    }

    if (!centroid) {
      continue;
    }

    results.push({
      dbId:
        candidate.dbId,
      label:
        candidate.label,
      rawLabel:
        candidate.rawLabel,
      roomType:
        candidate.roomType,
      centroid,
      boundingBox,
      source:
        spatialSource,
      textSource:
        candidate.textSource,
      confidence: 100,
    });
  }

  console.log(
    "[VENTRA ACTUAL VIEWER ROOM EXTRACTION v19]",
    {
      textCandidates:
        byDbId.size,
      currentViewCandidates:
        currentViewCandidates.size,
      serverCandidates:
        serverCandidates.length,
      viewGuid,
      spatialLabels:
        results.length,
      labels:
        results.map(
          (room) => ({
            dbId:
              room.dbId,
            label:
              room.label,
            roomType:
              room.roomType,
            centroid:
              room.centroid,
            source:
              room.source,
            textSource:
              room.textSource,
          })
        ),
    }
  );

  return results;
}

export default function ApsViewer({
  urn,
  title = "Autodesk Model Viewer",
  onGeometryCalibrated,
  onGeometryExtracted,
  analysisRunId = null,
  confirmedUnit = null,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const calibrationCallbackRef = useRef(
    onGeometryCalibrated
  );
  const callbackRef = useRef(onGeometryExtracted);

  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [objectCount, setObjectCount] = useState(null);
  const [geometryResult, setGeometryResult] =
    useState(null);

  function downloadDiagnosticReport() {
    if (!geometryResult || typeof window === "undefined") {
      return;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      urn,
      viewer: {
        status,
        objectCount,
      },
      geometry: {
        objectCount: geometryResult.objectCount ?? null,
        lineCount: geometryResult.lineCount ?? 0,
        circularArcCount: geometryResult.circularArcCount ?? 0,
        ellipticalArcCount: geometryResult.ellipticalArcCount ?? 0,
        totalCurveLength: geometryResult.totalCurveLength ?? 0,
        totalLengthMeters: geometryResult.totalLengthMeters ?? 0,
        unit: geometryResult.unit ?? null,
        meterFactor: geometryResult.meterFactor ?? null,
      },
      layers: geometryResult.layers ?? null,
      objects: Array.isArray(geometryResult.objects)
        ? geometryResult.objects
        : [],
      properties: Array.isArray(geometryResult.properties)
        ? geometryResult.properties
        : [],
      takeoff: window.__VENTRA_APS_TAKEOFF__ ?? null,
    };

    console.group("[VENTRA APS DIAGNOSTIC]");
    console.log(report);
    console.groupEnd();

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ventra-aps-diagnostic-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    calibrationCallbackRef.current =
      onGeometryCalibrated;
  }, [onGeometryCalibrated]);

  useEffect(() => {
    callbackRef.current = onGeometryExtracted;
  }, [onGeometryExtracted]);

  useEffect(() => {
    let cancelled = false;
    let ownedViewer = null;
    const tokenAbortController =
      new AbortController();

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

        if (cancelled || !containerRef.current) {
          return;
        }

        const getAccessToken =
          createViewerTokenProvider({
            isCancelled: () => cancelled,
            signal:
              tokenAbortController.signal,
            onTokenError: (error) => {
              if (cancelled) {
                return;
              }

              setStatus("error");
              setErrorMessage(
                error?.message ||
                  "Could not obtain Autodesk viewer access token."
              );
            },
          });

        await initializeViewer(
          getAccessToken
        );

        if (cancelled || !containerRef.current) {
          return;
        }

        const readyContainer = await waitForViewerContainer(
          containerRef,
          () => cancelled
        );

        if (cancelled || !readyContainer) {
          return;
        }

        const previousViewer = viewerRef.current;
        viewerRef.current = null;

        if (previousViewer) {
          safelyFinishViewer(previousViewer);

          if (containerRef.current?.isConnected) {
            containerRef.current.innerHTML = "";
          }
        }

        const viewerContainer = await waitForViewerContainer(
          containerRef,
          () => cancelled
        );

        if (cancelled || !viewerContainer) {
          return;
        }

        const restoreViewerWorker =
          await installViewerWorkerCompatibility();

        let viewer;
        let model;

        try {
          const finalRect =
            viewerContainer.getBoundingClientRect?.();

          const finalWidth =
            Number(
              finalRect?.width ??
              viewerContainer.clientWidth ??
              0
            );

          const finalHeight =
            Number(
              finalRect?.height ??
              viewerContainer.clientHeight ??
              0
            );

          if (
            finalWidth < 80 ||
            finalHeight < 80 ||
            !viewerContainer.isConnected
          ) {
            console.log(
              "[VENTRA VIEWER LIFECYCLE] skipped Autodesk start because container is hidden/zero-size",
              {
                width: finalWidth,
                height: finalHeight,
                connected:
                  Boolean(
                    viewerContainer.isConnected
                  ),
              }
            );
            return;
          }

          viewer =
            new window.Autodesk.Viewing.GuiViewer3D(
              viewerContainer,
              {
                extensions: ["Autodesk.DocumentBrowser"],
            // Avoid Hyperlink property queries after a model is unloaded.
            disabledExtensions: { hyperlink: true },
              }
            );

          ownedViewer =
            viewer;

          const startCode = viewer.start();

          if (startCode > 0) {
            throw new Error(
              `Autodesk Viewer could not start. Error code: ${startCode}`
            );
          }

          viewerRef.current = viewer;
          viewer.setTheme("light-theme");

          const loadedDocument =
            await loadDocument(
              viewer,
              urn,
              () => cancelled
            );

          model =
            loadedDocument?.model ||
            null;

          var currentViewGuid =
            loadedDocument?.viewGuid ||
            null;

          var currentViewName =
            loadedDocument?.viewName ||
            null;
        } finally {
          restoreViewerWorker();
        }

        if (
          cancelled ||
          !viewer.impl ||
          !model
        ) {
          return;
        }

        if (
          !viewerCanRender(
            viewer
          )
        ) {
          console.log(
            "[VENTRA VIEWER LIFECYCLE v20] abandoned stale/zero-size viewer before extraction",
            getViewerContainerSize(
              viewer
            )
          );

          safelyFinishViewer(
            viewer
          );

          if (
            viewerRef.current ===
            viewer
          ) {
            viewerRef.current =
              null;
          }

          return;
        }

        viewer.resize?.();
        viewer.fitToView?.();

        const objects = await getModelProperties(model);

        if (cancelled || !viewer.impl) {
          return;
        }

        const properties =
          await extractModelProperties(viewer);

        if (cancelled || !viewer.impl) {
          return;
        }

        const geometry = await extract2DGeometry(
          viewer,
          model,
          objects,
          confirmedUnit
        );

        if (cancelled || !viewer.impl) {
          return;
        }

        console.log(
          "[VENTRA APS CALIBRATION EXTRACTED]",
          {
            meterFactor:
              geometry?.meterFactor ??
              null,
            sourceMeterFactor:
              geometry
                ?.sourceMeterFactor ??
              null,
            unit:
              geometry?.unit ??
              null,
            totalCurveLength:
              geometry
                ?.totalCurveLength ??
              null,
            totalLengthMeters:
              geometry
                ?.totalLengthMeters ??
              null,
          }
        );

        calibrationCallbackRef.current?.({
          ...geometry,
          geometry,
          apsUrn: urn,
          apsViewGuid:
            currentViewGuid,
          apsViewName:
            currentViewName,
        });

        const layers = await detectLayers({
          viewer,
          model,
          objects:
            Array.isArray(properties) && properties.length > 0
              ? properties
              : objects,
        });

        if (cancelled || !viewer.impl) {
          return;
        }

        const roomVisionImage =
          await captureAuthoritativeViewerImage(
            viewer
          );

        const viewerRoomLabels =
          await ventraExtractApsRoomLabels({
            model,
            objects,
            properties,
            geometry,
            urn,
            viewGuid:
              currentViewGuid,
            viewName: currentViewName,
            viewRole: model.is2d?.() ? "2d" : "3d",
          });

        const spatialDiagnostics = {
          propertyObjects:
            Array.isArray(properties)
              ? properties.length
              : 0,
          objectsWithCentroid:
            Array.isArray(properties)
              ? properties.filter(
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
                ).length
              : 0,
          objectsWithBoundingBox:
            Array.isArray(properties)
              ? properties.filter(
                  (object) =>
                    Boolean(
                      object?.boundingBox
                    )
                ).length
              : 0,
        };

        console.log(
          "[VENTRA APS SPATIAL DIAGNOSTICS]",
          spatialDiagnostics
        );

        const completeAnalysis = {
          ...geometry,
          objects: Array.isArray(objects) ? objects : [],
          properties: Array.isArray(properties)
            ? properties
            : [],
          layers,
          roomVisionImage,
          apsUrn: urn,
          apsViewGuid:
            currentViewGuid,
          apsViewName:
            currentViewName,
          viewerRoomLabels,
          spatialDiagnostics: {
            ...spatialDiagnostics,
            viewerRoomLabels:
              viewerRoomLabels.length,
          },
        };

        // React Strict Mode can tear down the first Viewer effect while its
        // async extraction is still finishing. Never publish geometry from a
        // cancelled Viewer instance, otherwise semantic analysis can run twice.
        if (cancelled) {
          console.log(
            "[VENTRA ANALYZER] ignored cancelled Viewer geometry callback",
            { apsUrn: Boolean(urn) }
          );
          return;
        }

        setObjectCount(completeAnalysis.objects.length);
        setGeometryResult(completeAnalysis);
        setStatus("ready");

        console.log(
          "[VENTRA ANALYZER] geometry callback",
          {
            hasHighResImage:
              Boolean(roomVisionImage),
            apsUrn:
              Boolean(urn),
            viewerRoomLabels:
              viewerRoomLabels.length,
          }
        );

        callbackRef.current?.(completeAnalysis);
      } catch (error) {
        console.error("[APS Viewer]", error);

        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not display the Autodesk model."
          );
        }
      }
    }

    startViewer();

    return () => {
      cancelled = true;
      tokenAbortController.abort();

      const viewer =
        ownedViewer;

      if (
        viewerRef.current ===
        viewer
      ) {
        viewerRef.current =
          null;
      }

      safelyFinishViewer(
        viewer
      );

      console.log(
        "[VENTRA VIEWER LIFECYCLE v20] effect cleanup",
        {
          ownedViewer:
            Boolean(viewer),
          activeViewerPreserved:
            Boolean(
              viewerRef.current &&
              viewerRef.current !==
                viewer
            ),
        }
      );
    };
  }, [urn, analysisRunId, confirmedUnit]);

  if (!urn) {
    return null;
  }

  const arcCount = geometryResult
    ? Number(geometryResult.circularArcCount || 0) +
      Number(geometryResult.ellipticalArcCount || 0)
    : 0;

  const formattedLength =
    geometryResult &&
    Number.isFinite(
      Number(geometryResult.totalLengthMeters)
    )
      ? `${Number(
          geometryResult.totalLengthMeters
        ).toFixed(2)} m`
      : null;

  const layerCount =
    Number(geometryResult?.layers?.totalLayers) || 0;

  const layerStatus = geometryResult?.layers?.status;

  return (
    <LocalizedElement as="section" className="aps-viewer-card">
      <LocalizedElement as="div" className="aps-viewer-header">
        <LocalizedElement as="div">
          <LocalizedElement as="span">AUTODESK APS</LocalizedElement>
          <LocalizedElement as="h3">{title}</LocalizedElement>

          {objectCount !== null && (
            <LocalizedElement as="p">{objectCount} model objects detected</LocalizedElement>
          )}

          {geometryResult && (
            <>
              <LocalizedElement as="button"
                type="button"
                className="aps-diagnostic-button"
                onClick={downloadDiagnosticReport}
              >
                Download APS Diagnostic
              </LocalizedElement>

              <LocalizedElement as="div" className="aps-geometry-summary">
              <LocalizedElement as="p">
                Lines:{" "}
                <LocalizedElement as="strong">
                  {geometryResult.lineCount || 0}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="p">
                Arcs: <LocalizedElement as="strong">{arcCount}</LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="p">
                Total curve length:{" "}
                <LocalizedElement as="strong">
                  {formattedLength ||
                    `${Number(
                      geometryResult.totalCurveLength || 0
                    ).toFixed(2)} ${
                      geometryResult.unit || "model units"
                    }`}
                </LocalizedElement>
              </LocalizedElement>

              <LocalizedElement as="p">
                Layers: <LocalizedElement as="strong">{layerCount}</LocalizedElement>
              </LocalizedElement>

              {layerStatus === "ready-no-layers" && (
                <LocalizedElement as="p">
                  APS did not expose explicit layer metadata
                  for this derivative.
                </LocalizedElement>
              )}
              </LocalizedElement>
            </>
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
            Loading Autodesk model and extracting geometry...
          </LocalizedElement>
        )}

        {status === "error" && (
          <LocalizedElement as="div" className="aps-viewer-overlay aps-viewer-overlay-error">
            {errorMessage}
          </LocalizedElement>
        )}

        {/* Autodesk owns this DOM subtree. Keep its coordinate/UI direction
            stable while the surrounding Ventra labels change language. */}
        <div
          ref={containerRef}
          className="aps-viewer-container"
          dir="ltr"
          translate="no"
        />
      </LocalizedElement>
    </LocalizedElement>
  );
}
