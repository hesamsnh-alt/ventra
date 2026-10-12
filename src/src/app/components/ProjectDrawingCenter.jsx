"use client";
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

  const floorArea =
    Number(
      result.floor_area ||
      result.room_area
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

  return `${number}${unit ? ` ${unit}` : ""}`;
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

  const sourceResponse = await fetch(url, {
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

  const response = await fetch(
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

async function startApsTranslation(urn) {
  const response = await fetch(
    "/api/aps/translate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        urn,
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
  const response = await fetch(
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
      return manifest;
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
  const fileInputRef = useRef(null);

  const importAiBoq = useBoqStore(
    (state) => state.importAiBoq
  );

  const [documents, setDocuments] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [uploading, setUploading] =
    useState(false);

  const [analyzing, setAnalyzing] =
    useState(false);
    const [generatingBoq, setGeneratingBoq] = useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [takeoffResult, setTakeoffResult] =
    useState(null);

  const [
    deletingDocumentId,
    setDeletingDocumentId,
  ] = useState(null);

  const [message, setMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

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
          setDocuments(
            documentsResult.documents || []
          );
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

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
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

      setMessage(
        `${file.name} uploaded successfully.`
      );
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
    if (documents.length === 0) {
      setErrorMessage(
        "Please upload a drawing first."
      );

      return;
    }

    const latestDocument = documents[0];
    const extension = getFileExtension(
      latestDocument.file_name
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

    try {
      setAnalyzing(true);
      clearMessages();

      if (isAiDrawing) {
        setMessage(
          extension === "pdf"
            ? "Analyzing the PDF page by page. Large drawing sets can take several minutes. Keep this page open."
            : "Analyzing the drawing. Keep this page open."
        );

        const { takeoff, error } =
          await analyzeProjectDrawing({
            projectId,
            document: latestDocument,
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
  Number(takeoff?.floor_area) ||
  Number(takeoff?.room_area) ||
  0;

const roomCount =
  Number(takeoff?.rooms) || 0;

const defaultWallHeight = 3;

let finalWallLength =
  originalWallLength;

let wallLengthEstimated = false;

if (
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
    : finalWallLength *
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

setTakeoffResult(
  finalTakeoff
);
window.localStorage.setItem(
  `ventra:project-takeoff:${projectId}`,
  JSON.stringify(finalTakeoff)
);

setMessage(
  "AI quantity takeoff completed successfully."
);
        return;
      }

      setMessage(
        "Uploading the CAD file to Autodesk APS..."
      );

      const uploadResult =
        await uploadDocumentToAps(
          latestDocument
        );

      setMessage(
        "Starting Autodesk model translation..."
      );

      await startApsTranslation(
        uploadResult.urn
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
          latestDocument.id || null,
        document_name:
          latestDocument.file_name,
        document_type:
          latestDocument.file_type || null,
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

      setTakeoffResult(apsResult);

      window.localStorage.setItem(
        `ventra:project-takeoff:${projectId}`,
        JSON.stringify(apsResult)
      );

      setMessage(
        "Autodesk translation completed. The model is ready for Viewer and geometry extraction."
      );
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

      setDocuments((current) =>
        current.filter((item) => item.id !== document.id)
      );

      setMessage("Drawing deleted successfully.");
    } catch (error) {
      setErrorMessage(
        error?.message || "Could not delete the file."
      );
    } finally {
      setDeletingDocumentId(null);
    }
  }

function handleApsGeometryExtracted(analysis) {
  if (!analysis) {
    return;
  }

  const {
    objects = [],
    properties = [],
    layers,
    ...geometry
  } = analysis;

  const generatedTakeoff =
    buildTakeoffFromAps({
      geometry,
      objects,
      properties,
      layers,
    });

  const diagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    geometry,
    layers: layers || null,
    objectsCount: objects.length,
    propertiesCount: properties.length,
    generatedTakeoff,
  };

  if (typeof window !== "undefined") {
    window.__VENTRA_APS_TAKEOFF__ = generatedTakeoff;
    window.__VENTRA_APS_DIAGNOSTIC__ = diagnosticSnapshot;
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

  setTakeoffResult((current) => {
    if (
      !current ||
      current.source !== "autodesk-aps"
    ) {
      return current;
    }

    const nextResult = {
      ...current,

      extraction_status:
        "advanced-takeoff-ready",

      geometry_status: "ready",

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
      lighting_points: generatedTakeoff.lighting_points,
      socket_points: generatedTakeoff.socket_points,
      switches: generatedTakeoff.switches,
      distribution_boards: generatedTakeoff.distribution_boards,
      other_electrical: generatedTakeoff.other_electrical,

      wall_length:
        generatedTakeoff.wall_length,

      wall_area:
        generatedTakeoff.wall_area,

      door_area:
        generatedTakeoff.door_area,

      window_area:
        generatedTakeoff.window_area,

      opening_area:
        generatedTakeoff.opening_area,

      door_area_source:
        generatedTakeoff.door_area_source,

      window_area_source:
        generatedTakeoff.window_area_source,

      opening_area_source:
        generatedTakeoff.opening_area_source,

      opening_dimensions_complete:
        generatedTakeoff.opening_dimensions_complete,

      opening_measurement_coverage:
        generatedTakeoff.opening_measurement_coverage,

      wall_volume:
        generatedTakeoff.wall_volume,

      room_area:
        generatedTakeoff.room_area,

      floor_area:
        generatedTakeoff.floor_area,

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
      window.localStorage.setItem(
        `ventra:project-takeoff:${projectId}`,
        JSON.stringify(nextResult)
      );
    } catch (storageError) {
      console.warn(
        "[Drawing Center] Could not save advanced APS takeoff:",
        storageError
      );
    }

    return nextResult;
  });

  setMessage(
    "Advanced architectural, structural and MEP takeoff completed successfully."
  );
}

 async function handleGenerateBoq() {
  if (!takeoffResult) {
    setErrorMessage(
      "Please analyze a drawing first."
    );
    return;
  }
  try {
    setGeneratingBoq(true);
    clearMessages();

    setMessage("Generating advanced BOQ...");

    const response = await fetch(
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
            lighting_points: Number(takeoffResult.lighting_points) || 0,
            socket_points: Number(takeoffResult.socket_points) || 0,
            switches: Number(takeoffResult.switches) || 0,
            distribution_boards: Number(takeoffResult.distribution_boards) || 0,
            other_electrical: Number(takeoffResult.other_electrical) || 0,

            wall_length:
              Number(
                takeoffResult.wall_length
              ) || 0,

            wall_area:
              Number(
                takeoffResult.wall_area
              ) || 0,

            door_area:
              Number(
                takeoffResult.door_area
              ) || 0,

            window_area:
              Number(
                takeoffResult.window_area
              ) || 0,

            opening_area:
              Number(
                takeoffResult.opening_area
              ) || 0,

            door_area_source:
              takeoffResult.door_area_source ||
              "unavailable",

            window_area_source:
              takeoffResult.window_area_source ||
              "unavailable",

            opening_area_source:
              takeoffResult.opening_area_source ||
              "unavailable",

            opening_dimensions_complete:
              takeoffResult.opening_dimensions_complete ===
              true,

            opening_measurement_coverage:
              takeoffResult.opening_measurement_coverage ||
              null,

            wall_volume:
              Number(
                takeoffResult.wall_volume
              ) || 0,

            room_area:
              Number(
                takeoffResult.room_area
              ) || 0,

            floor_area:
              Number(
                takeoffResult.floor_area
              ) || 0,

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
  disabled: generatingBoq,
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
    <section className="drawing-center">
      <div className="drawing-header">
        <span>
          AI CONSTRUCTION ENGINE
        </span>

        <h2>Drawing Center</h2>

        <p>
          Upload project drawings and
          prepare them for quantity
          takeoff, BOQ and cost analysis.
        </p>
      </div>

      {message && (
        <div className="drawing-message drawing-message-success">
          <CheckCircle2 size={18} />

          <span>{message}</span>
        </div>
      )}

      {errorMessage && (
        <div className="drawing-message drawing-message-error">
          <AlertCircle size={18} />

          <span>{errorMessage}</span>
        </div>
      )}

      <div
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
        <input
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

        <h3>
          {uploading
            ? "Uploading drawing..."
            : "Drop your drawing here"}
        </h3>

        <p>
          PDF, DWG, DXF, IFC, RVT, JPG,
          PNG or WEBP. Maximum size 100 MB.
        </p>

        <button
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
        </button>
      </div>

      <div className="drawing-grid">
        {aiTools.map((tool) => {
          const Icon = tool.icon;

          return (
            <article
              className={`drawing-card ${
                tool.disabled
                  ? "drawing-card-disabled"
                  : ""
              }`}
              key={tool.title}
            >
              <div className="drawing-icon">
                <Icon size={30} />
              </div>

              <h3>{tool.title}</h3>

              <p>{tool.text}</p>

              <button
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
              </button>
            </article>
          );
        })}
      </div>

      {takeoffResult && (
        <section className="takeoff-result">
          <div className="drawing-files-header">
            <div>
              <span>
                {takeoffResult.source ===
                "autodesk-aps"
                  ? "AUTODESK GEOMETRY RESULT"
                  : "AI ANALYSIS RESULT"}
              </span>

              <h3>
                {takeoffResult.source ===
                "autodesk-aps"
                  ? "Geometry Extraction Summary"
                  : "Quantity Takeoff Summary"}
              </h3>
            </div>

            <strong>
              {takeoffResult.source === "autodesk-aps"
                ? takeoffResult.geometry_status === "ready"
                  ? "Geometry ready"
                  : "APS model ready"
                : `${Number(takeoffResult.confidence) || 0}% confidence`}
            </strong>
          </div>

          {takeoffResult.source ===
          "autodesk-aps" ? (
            <div className="takeoff-result-grid takeoff-result-grid-geometry">
              <article>
                <span>Model Objects</span>
                <strong>
                  {takeoffResult.object_count ??
                    "Extracting..."}
                </strong>
              </article>

              <article>
                <span>Lines</span>
                <strong>
                  {takeoffResult.line_count ??
                    "Extracting..."}
                </strong>
              </article>

              <article>
                <span>Arcs</span>
                <strong>
                  {takeoffResult.arc_count ??
                    "Extracting..."}
                </strong>
              </article>

              <article>
                <span>Total Curve Length</span>
                <strong>
                  {takeoffResult.total_curve_length_m !==
                  null &&
                  takeoffResult.total_curve_length_m !==
                    undefined
                    ? `${formatGeometryNumber(
                        takeoffResult.total_curve_length_m
                      )} m`
                    : "Extracting..."}
                </strong>
              </article>

              <article>
                <span>Wall Length</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.wall_length,
                    "m"
                  )}
                </strong>
              </article>

              <article>
                <span>Wall Area</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.wall_area,
                    "m²"
                  )}
                </strong>
              </article>

              <article>
                <span>Floor Area</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.floor_area,
                    "m²"
                  )}
                </strong>
              </article>

              <article>
                <span>Rooms Detected</span>
                <strong>
                  {Number(takeoffResult.rooms) ||
                    Number(takeoffResult.geometry?.roomCount) ||
                    takeoffResult.object_details?.rooms?.length ||
                    0}
                </strong>
              </article>

              <article>
                <span>Total Room Area</span>
                <strong>
                  {formatQuantity(
                    Number(takeoffResult.room_area) ||
                      Number(takeoffResult.geometry?.roomArea) ||
                      0,
                    "m²"
                  )}
                </strong>
              </article>

              <article>
                <span>Largest Room</span>
                <strong>
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
                    return largest
                      ? `${formatGeometryNumber(Number(largest.area) || 0)} m²`
                      : "0 m²";
                  })()}
                </strong>
              </article>

              <article>
                <span>Model Unit</span>
                <strong>
                  {takeoffResult.model_unit
                    ? `${takeoffResult.model_unit} → m`
                    : "Detecting..."}
                </strong>
              </article>

              <article>
                <span>Geometry Status</span>
                <strong className="takeoff-ready-value">
                  {takeoffResult.geometry_status ===
                  "ready"
                    ? "READY"
                    : "PROCESSING"}
                </strong>
              </article>

              <article>
                <span>Detected Categories</span>
                <strong>
                  {takeoffResult.total_layers ??
                    "Detecting..."}
                </strong>
              </article>

              <article>
                <span>Walls Detected</span>
                <strong>
                  {takeoffResult.wall_layer_count ?? takeoffResult.wall_layers?.length ?? 0}
                </strong>
              </article>

              <article>
                <span>Doors Detected</span>
                <strong>
                  {takeoffResult.door_layer_count ?? takeoffResult.door_layers?.length ?? 0}
                </strong>
              </article>

              <article>
                <span>Windows Detected</span>
                <strong>
                  {takeoffResult.window_layer_count ?? takeoffResult.window_layers?.length ?? 0}
                </strong>
              </article>

              <article>
                <span>Slabs Detected</span>
                <strong>
                  {takeoffResult.slab_layer_count ?? takeoffResult.slab_layers?.length ?? 0}
                </strong>
              </article>

              <article>
                <span>Unknown Layers</span>
                <strong>
                  {takeoffResult.unknown_layers?.length ?? 0}
                </strong>
              </article>

              <article>
                <span>Layer Status</span>
                <strong className="takeoff-ready-value">
                  {takeoffResult.layer_status === "ready" ||
                  takeoffResult.layer_status === "ready-no-layers" ||
                  takeoffResult.layer_status === "ready-object-classification" ||
                  takeoffResult.layer_status === "ready-unclassified"
                    ? "READY"
                    : takeoffResult.layer_status === "failed"
                      ? "FAILED"
                      : "PROCESSING"}
                </strong>
              </article>
            </div>

           {takeoffResult.source === "autodesk-aps" ? (
  <>
    <div className="takeoff-result-grid takeoff-result-grid-geometry">
      ...
    </div>

    {Array.isArray(takeoffResult.object_details?.rooms) &&
      takeoffResult.object_details.rooms.length > 0 && (
        <div className="room-schedule">
          ...
        </div>
      )}
  </>
) : (
            <div className="takeoff-result-grid">
              <article>
                <span>Rooms</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.rooms
                  )}
                </strong>
              </article>

              <article>
                <span>Doors</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.doors
                  )}
                </strong>
              </article>

              <article>
                <span>Windows</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.windows
                  )}
                </strong>
              </article>

              <article>
                <span>Wall Length</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.wall_length,
                    "m"
                  )}
                </strong>
              </article>

              <article>
                <span>Wall Area</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.wall_area,
                    "m²"
                  )}
                </strong>
              </article>

              <article>
                <span>Floor Area</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.floor_area,
                    "m²"
                  )}
                </strong>
              </article>

              <article>
                <span>Ceiling Area</span>
                <strong>
                  {formatQuantity(
                    takeoffResult.ceiling_area,
                    "m²"
                  )}
                </strong>
              </article>
            </div>
          )}

        {takeoffResult.notes && (
            <p className="takeoff-result-notes">
              {takeoffResult.notes}
            </p>
          )}
        </section>
          )}

      {takeoffResult?.source === "autodesk-aps" &&
        takeoffResult?.aps_urn && (
          <ApsViewer
            urn={takeoffResult.aps_urn}
            title={
              takeoffResult.document_name ||
              "Autodesk Model Viewer"
            }
            onGeometryExtracted={
              handleApsGeometryExtracted
            }
          />
        )}
      <div className="drawing-files">
        <div className="drawing-files-header">
          <div>
            <span>PROJECT FILES</span>

            <h3>Uploaded Drawings</h3>
          </div>

          <strong>
            {documents.length}{" "}
            {documents.length === 1
              ? "file"
              : "files"}
          </strong>
        </div>

        {loading ? (
          <div className="drawing-files-state">
            <LoaderCircle
              size={28}
              className="drawing-spinner"
            />

            <p>
              Loading project files...
            </p>
          </div>
        ) : documents.length === 0 ? (
          <div className="drawing-files-state">
            <FileText size={36} />

            <h4>
              No drawings uploaded
            </h4>

            <p>
              Upload the first project
              drawing to start analysis.
            </p>
          </div>
        ) : (
          <div className="drawing-file-list">
            {documents.map(
              (document) => (
                <article
                  className="drawing-file-row"
                  key={document.id}
                >
                  <div className="drawing-file-icon">
                    <FileText size={24} />
                  </div>

                  <div className="drawing-file-info">
                    <strong>
                      {document.file_name}
                    </strong>

                    <span>
                      {formatFileSize(
                        document.file_size
                      )}
                      {" · "}
                      {formatDate(
                        document.created_at
                      )}
                    </span>
                  </div>

                  <span className="drawing-file-status">
                    {document.status ||
                      "uploaded"}
                  </span>

                  <div className="drawing-file-actions">
                    <button
                      type="button"
                      title="Download file"
                      onClick={() =>
                        handleDownload(
                          document
                        )
                      }
                    >
                      <Download size={18} />
                    </button>

                    <button
                      type="button"
                      title="Delete file"
                      className="drawing-file-delete"
                      disabled={
                        deletingDocumentId ===
                        document.id
                      }
                      onClick={() =>
                        handleDelete(
                          document
                        )
                      }
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
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}