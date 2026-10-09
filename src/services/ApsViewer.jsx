"use client";
import {
  buildApsDiagnostic,
  applyDiagnosticFallbacks,
} from "@/lib/aps/apsDiagnostic";
import { useEffect, useRef, useState } from "react";
import {
  extract2DGeometry,
  getModelProperties,
} from "@/services/apsGeometryExtractor";
import { detectLayers } from "@/services/apsLayerDetector";
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

  if (window.Autodesk?.Viewing) return Promise.resolve();
  if (viewerSdkPromise) return viewerSdkPromise;

  viewerSdkPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${VIEWER_STYLESHEET}"]`)) {
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

      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Autodesk Viewer SDK could not be loaded.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = VIEWER_SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("Autodesk Viewer SDK could not be loaded."));
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
          const geometryNode = viewerDocument
            .getRoot()
            .getDefaultGeometry();

          if (!geometryNode) {
            throw new Error(
              "The Autodesk model does not contain viewable geometry."
            );
          }

          const model = await viewer.loadDocumentNode(
            viewerDocument,
            geometryNode
          );
          resolve(model);
        } catch (error) {
          reject(error);
        }
      },
      (code, message, errors) => {
        console.error("[APS Document Load]", { code, message, errors });
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

export default function ApsViewer({
  urn,
  title = "Autodesk Model Viewer",
  onGeometryExtracted,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const callbackRef = useRef(onGeometryExtracted);

  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [objectCount, setObjectCount] = useState(null);
  const [geometryResult, setGeometryResult] = useState(null);

  useEffect(() => {
    callbackRef.current = onGeometryExtracted;
  }, [onGeometryExtracted]);

  useEffect(() => {
    let cancelled = false;

    async function startViewer() {
      if (!urn || !containerRef.current) return;

      try {
        setStatus("loading");
        setErrorMessage("");
        setObjectCount(null);
        setGeometryResult(null);

        await loadViewerSdk();
        if (cancelled || !containerRef.current) return;

        await new Promise((resolve, reject) => {
          window.Autodesk.Viewing.Initializer(
            {
              env: "AutodeskProduction2",
              api: "streamingV2_EU",
              getAccessToken: fetchViewerToken,
            },
            resolve,
            reject
          );
        });

        if (cancelled || !containerRef.current) return;

        if (viewerRef.current) {
          viewerRef.current.finish();
          viewerRef.current = null;
          containerRef.current.innerHTML = "";
        }

        const viewer = new window.Autodesk.Viewing.GuiViewer3D(
          containerRef.current,
          { extensions: ["Autodesk.DocumentBrowser"] }
        );

        const startCode = viewer.start();
        if (startCode > 0) {
          throw new Error(
            `Autodesk Viewer could not start. Error code: ${startCode}`
          );
        }

        viewerRef.current = viewer;
        viewer.setTheme("dark-theme");

        const model = await loadDocument(viewer, urn);
        if (cancelled) return;

        viewer.fitToView();

        const objects = await getModelProperties(model);

        // Kept intentionally for diagnostics. No Console command is needed.
        window.__ventraViewer = viewer;
        window.__ventraModel = model;
       window.__ventraObjects =
  normalizedObjects;

window.__ventraDiagnostic =
  diagnostic;

        console.log("[Ventra APS Model Objects]", objects);
        console.log("[Ventra APS First Object]", objects?.[0] || null);
        console.log(
          "[Ventra APS First Object Properties]",
          objects?.[0]?.properties || []
        );

        const geometry = await extract2DGeometry(viewer, model, objects);
        const layerResult = await detectLayers({ viewer, model, objects });

       const diagnostic =
  buildApsDiagnostic(objects);

const normalizedObjects =
  applyDiagnosticFallbacks(
    objects
  );

const analysisResult = {
  ...geometry,

  objectCount:
    Number(
      geometry?.objectCount
    ) ||
    normalizedObjects.length,

  objects:
    normalizedObjects,

  properties:
    normalizedObjects,

  layers: layerResult,

  diagnostic,
};

        window.__ventraAnalysis = analysisResult;

        console.log("[Ventra APS Geometry Result]", geometry);
        console.log("[Ventra APS Layer Result]", layerResult);
        console.log("[Ventra APS Complete Analysis]", analysisResult);

        if (cancelled) return;

        setObjectCount(objects.length);
        setGeometryResult(analysisResult);
        setStatus("ready");
        callbackRef.current?.(analysisResult);
      } catch (error) {
        console.error("[APS Viewer]", error);

        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            error?.message || "Could not display the Autodesk model."
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

  if (!urn) return null;

  const arcCount = geometryResult
    ? Number(geometryResult.circularArcCount || 0) +
      Number(geometryResult.ellipticalArcCount || 0)
    : 0;

  const formattedLength =
    geometryResult &&
    Number.isFinite(Number(geometryResult.totalLengthMeters))
      ? `${Number(geometryResult.totalLengthMeters).toFixed(2)} m`
      : null;

  const layerCount = Number(geometryResult?.layers?.totalLayers) || 0;
  const layerStatus = geometryResult?.layers?.status;

  return (
    <section className="aps-viewer-card">
      <div className="aps-viewer-header">
        <div>
          <span>AUTODESK APS</span>
          <h3>{title}</h3>

          {objectCount !== null && (
            <p>{objectCount} model objects detected</p>
          )}

          {geometryResult && (
            <div className="aps-geometry-summary">
              <p>
                Lines: <strong>{geometryResult.lineCount || 0}</strong>
              </p>
              <p>
                Arcs: <strong>{arcCount}</strong>
              </p>
              <p>
                Total curve length:{" "}
                <strong>
                  {formattedLength ||
                    `${Number(
                      geometryResult.totalCurveLength || 0
                    ).toFixed(2)} ${geometryResult.unit || "model units"}`}
                </strong>
              </p>
              <p>
                Layers: <strong>{layerCount}</strong>
              </p>
              {layerStatus === "ready-no-layers" && (
                <p>
                  APS did not expose explicit layer metadata for this
                  derivative.
                </p>
              )}
            </div>
          )}
        </div>

        <strong
          className={`aps-viewer-status aps-viewer-status-${status}`}
        >
          {status === "ready"
            ? "Ready"
            : status === "error"
              ? "Error"
              : "Loading"}
        </strong>
      </div>

      <div className="aps-viewer-shell">
        {status === "loading" && (
          <div className="aps-viewer-overlay">
            Loading Autodesk model and extracting geometry...
          </div>
        )}

        {status === "error" && (
          <div className="aps-viewer-overlay aps-viewer-overlay-error">
            {errorMessage}
          </div>
        )}

        <div ref={containerRef} className="aps-viewer-container" />
      </div>
    </section>
  );
}
