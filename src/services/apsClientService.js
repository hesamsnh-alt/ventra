import {commercialFetch} from '@/lib/commercialFetch';
const CAD_EXTENSIONS = ["dwg", "dxf", "ifc", "rvt"];

function getExtension(fileName = "") {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

async function readJsonResponse(response) {
  const text = await response.text();

  console.log("APS response:", {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    body: text,
  });

  if (!response.ok) {
    throw new Error(
      `APS request failed (${response.status}): ${
        text || response.statusText
      }`
    );
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `The server returned an invalid response:\n\n${text.substring(0, 500)}`
    );
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function isApsSupportedFile(fileName) {
  return CAD_EXTENSIONS.includes(getExtension(fileName));
}

export async function uploadDocumentToAps(document) {
  if (!document?.file_name) {
    throw new Error("Document information is incomplete.");
  }

  const { downloadProjectDocument } = await import(
    "@/services/documentService"
  );

  const { url, error } = await downloadProjectDocument(document);

  if (error || !url) {
    throw error || new Error("Could not create a secure file URL.");
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

  const file = new File([blob], document.file_name, {
    type:
      document.file_type ||
      blob.type ||
      "application/octet-stream",
  });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId",document.project_id);

  const response = await commercialFetch("/api/aps/upload", {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  const payload = await readJsonResponse(response);

  if (payload?.success !== true) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `APS upload failed with HTTP ${response.status}.`
    );
  }

  return payload;
}

export async function startApsTranslation({
  urn,
  fileName,projectId,
}) {
  if (!urn) {
    throw new Error("APS URN is missing.");
  }

  const response = await commercialFetch("/api/aps/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      urn,projectId,
      rootFilename: "",
      fileName,
    }),
    cache: "no-store",
  });

  const payload = await readJsonResponse(response);

  if (payload?.success !== true) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `APS translation failed with HTTP ${response.status}.`
    );
  }

  return payload;
}

export async function getApsTranslationStatus(urn) {
  if (!urn) {
    throw new Error("APS URN is missing.");
  }

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

  const payload = await readJsonResponse(response);

  if (payload?.success !== true) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `Could not read APS status. HTTP ${response.status}.`
    );
  }

  return payload;
}

export async function waitForApsTranslation(
  urn,
  {
    interval = 5000,
    timeout = 10 * 60 * 1000,
    onProgress,
  } = {}
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const payload = await getApsTranslationStatus(urn);

    const manifest = payload.manifest || payload;

    const status = String(
      manifest?.status || ""
    ).toLowerCase();

    const progress = manifest?.progress || "";

    onProgress?.({
      status,
      progress,
      manifest,
    });

    if (status === "success") {
      return manifest;
    }

    if (status === "failed" || status === "timeout") {
      const derivativeError =
        manifest?.derivatives?.[0]?.messages?.[0]?.message;

      throw new Error(
        derivativeError ||
          "Autodesk could not translate this file."
      );
    }

    await wait(interval);
  }

  throw new Error(
    "Autodesk translation timed out. Try checking the status again later."
  );
}

export async function processDocumentWithAps({
  document,
  onProgress,
}) {
  if (!isApsSupportedFile(document?.file_name)) {
    throw new Error(
      "This file type is not supported by Autodesk APS."
    );
  }

  onProgress?.({
    stage: "uploading",
    message: "Uploading the CAD file to Autodesk APS...",
  });

  const uploadResult = await uploadDocumentToAps(document);

  const urn =
    uploadResult.urn ||
    uploadResult.result?.urn;

  if (!urn) {
    throw new Error(
      "Autodesk upload completed but no URN was returned."
    );
  }

  onProgress?.({
    stage: "translating",
    message: "Starting Autodesk model translation...",
    urn,
  });

  await startApsTranslation({
    urn,
    fileName: document.file_name,projectId:document.project_id,
  });

  const manifest = await waitForApsTranslation(urn, {
    onProgress: ({ status, progress }) => {
      onProgress?.({
        stage: "translating",
        message: `Autodesk translation: ${
          progress || status || "in progress"
        }`,
        status,
        progress,
        urn,
      });
    },
  });

  onProgress?.({
    stage: "ready",
    message: "Autodesk model is ready.",
    urn,
  });

  return {
    success: true,
    urn,
    upload: uploadResult,
    manifest,
  };
}