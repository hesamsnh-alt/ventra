import {persistTakeoff,readPersistedTakeoff,clearPersistedTakeoff} from '@/lib/takeoffStorage.mjs';
import {rememberEngineeringTakeoff} from '@/lib/sceneStyle.mjs';
import {commercialFetch} from '@/lib/commercialFetch';
const TAKEOFF_STORAGE_PREFIX = "ventra:project-takeoff:";

function getStorageKey(projectId) {
  return `${TAKEOFF_STORAGE_PREFIX}${projectId}`;
}

async function saveTakeoffLocally(projectId,takeoff){
 if(typeof window==='undefined'||!projectId||!takeoff)return;
 return persistTakeoff(projectId,takeoff);
}

function getTakeoffTimestamp(takeoff) {
  return Math.max(0, ...[takeoff?.analyzed_at, takeoff?.analyzedAt, takeoff?.updated_at, takeoff?.updatedAt, takeoff?.created_at, takeoff?.createdAt].map(value => {
    const timestamp = new Date(value || 0).getTime(); return Number.isFinite(timestamp) ? timestamp : 0;
  }));
}

function isUsableTakeoff(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function countElectricalSubtypes(takeoff) {
  const candidates = [
    takeoff,
    takeoff?.advanced_takeoff,
    takeoff?.raw_result,
    takeoff?.result,
  ].filter(Boolean);

  const direct = (key) => {
    for (const source of candidates) {
      const value = Number(source?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  };

  let lighting = direct("lighting_points");
  let socket = direct("socket_points");
  let switches = direct("switches");
  let distributionBoard = direct("distribution_boards");
  let other = direct("other_electrical");

  // Legacy recovery: if subtype counters were not persisted at the root,
  // reconstruct them from the serialized APS MEP objects.
  if (
    lighting + socket + switches +
      distributionBoard + other ===
    0
  ) {
    const mep =
      candidates
        .map(
          (source) =>
            source
              ?.object_details
              ?.mep
        )
        .find(
          (items) =>
            Array.isArray(items) &&
            items.length
        ) || [];

    for (const item of mep) {
      if (
        item?.detectedType !==
        "electrical"
      ) {
        continue;
      }

      const subtype = String(
        item?.electricalSubtype ||
        ""
      ).toLowerCase();

      if (subtype === "lighting") lighting += 1;
      else if (subtype === "socket") socket += 1;
      else if (subtype === "switch") switches += 1;
      else if (
        subtype ===
        "distribution_board"
      ) {
        distributionBoard += 1;
      } else {
        other += 1;
      }
    }
  }

  return {
    lighting_points: lighting,
    socket_points: socket,
    switches,
    distribution_boards:
      distributionBoard,
    other_electrical: other,
  };
}

function hydrateTakeoff(takeoff) {
  if (!isUsableTakeoff(takeoff)) {
    return takeoff;
  }

  const electrical =
    countElectricalSubtypes(
      takeoff
    );

  const hydrated = {
    ...takeoff,
    ...electrical,
  };

  console.log(
    "[VENTRA ELECTRICAL PERSISTENCE v27]",
    {
      electrical_items:
        Number(
          hydrated
            .electrical_items
        ) || 0,
      ...electrical,
      recoveredTotal:
        Object.values(
          electrical
        ).reduce(
          (sum, value) =>
            sum +
            Number(value || 0),
          0
        ),
    }
  );

  return hydrated;
}

function readTakeoffLocally(projectId) {
  if (typeof window === "undefined" || !projectId) return null;

  const exactKey = getStorageKey(projectId);

  try {
    const exactValue = window.localStorage.getItem(exactKey);
    if (exactValue) {
      const parsed = JSON.parse(exactValue);
      if (isUsableTakeoff(parsed)) {
        const hydrated =
          hydrateTakeoff(parsed);
        saveTakeoffLocally(
          projectId,
          hydrated
        );
        return hydrated;
      }
    }

    // Older Drawing Center builds sometimes saved the takeoff under a route ID
    // while the workspace later used the database project ID. Recover the newest
    // valid Ventra takeoff and migrate it to the current project key.
    const candidates = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(TAKEOFF_STORAGE_PREFIX)) continue;

      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
        if (!isUsableTakeoff(parsed)) continue;

        const embeddedProjectId = String(
          parsed?.project_id || parsed?.projectId || ""
        );
        const keyProjectId = key.slice(TAKEOFF_STORAGE_PREFIX.length);
        const matchesProject =
          embeddedProjectId === String(projectId) ||
          keyProjectId === String(projectId);

        candidates.push({
          key,
          takeoff: parsed,
          matchesProject,
          timestamp: getTakeoffTimestamp(parsed),
        });
      } catch (candidateError) {
        console.warn("[Takeoff] Ignoring invalid local result:", key, candidateError);
      }
    }

    candidates.sort((left, right) => {
      if (left.matchesProject !== right.matchesProject) {
        return left.matchesProject ? -1 : 1;
      }
      return right.timestamp - left.timestamp;
    });

    const recovered = candidates[0]?.takeoff || null;
    if (recovered) {
      const migrated = {
        ...recovered,
        project_id: recovered?.project_id || projectId,
      };
      const hydrated =
        hydrateTakeoff(migrated);
      saveTakeoffLocally(
        projectId,
        hydrated
      );
      return hydrated;
    }

    return null;
  } catch (error) {
    console.warn("[Takeoff] Could not read local result:", error);
    window.localStorage.removeItem(exactKey);
    return null;
  }
}

async function ventraFetchWithTransientRetry(url, options = {}, { attempts = 3, label = "request" } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await commercialFetch(url, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const transient =
        error instanceof TypeError ||
        /failed to fetch|network error|network request failed|load failed/i.test(message);

      if (!transient || attempt >= attempts) throw error;

      const delayMs = attempt === 1 ? 1200 : 2500;
      console.warn("[VENTRA TAKEOFF NETWORK RETRY v54]", {
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

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || "The server returned an invalid response.");
  }
}

export async function analyzeProjectDrawing({ projectId, document }) {
  try {
    if (!projectId) throw new Error("Project ID is required.");
    if (!document?.file_path || !document?.file_name) {
      throw new Error("Drawing document information is incomplete.");
    }

    const { downloadProjectDocument } = await import("@/services/documentService");
    const { url, error: signedUrlError } = await downloadProjectDocument(document);

    if (signedUrlError || !url) {
      throw signedUrlError || new Error("Could not create a secure drawing URL.");
    }

    const requestId = `takeoff-${projectId}-${document.id || document.file_name}-${Date.now()}`;
    const response = await ventraFetchWithTransientRetry(
      "/api/ai/analyze-drawing",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Ventra-Request-Id": requestId,
        },
        body: JSON.stringify({
          projectId,
          fileUrl: url,
          fileName: document.file_name,
          fileType: document.file_type || "application/octet-stream",
          projectName: document.project_name || "",
          requestId,
        }),
        cache: "no-store",
      },
      { attempts: 3, label: "drawing-analysis" }
    );

    const payload = await parseJsonResponse(response);

    if (!response.ok || payload?.success !== true || !payload?.result) {
      throw new Error(
        payload?.error || payload?.message || `Drawing analysis failed with HTTP ${response.status}.`
      );
    }

    const takeoff = {
      ...payload.result,
      project_id: projectId,
      document_id: document.id || null,
      document_name: document.file_name,
      document_type: document.file_type || null,
      analyzed_at: new Date().toISOString(),
      raw_result: payload.result,
    };

    await saveTakeoffLocally(projectId, takeoff);
    return { takeoff, error: null };
  } catch (error) {
    console.error("[Takeoff] Analyze drawing failed:", error);
    return {
      takeoff: null,
      error: error instanceof Error ? error : new Error("Drawing analysis failed."),
    };
  }
}

export async function getLatestProjectTakeoff(projectId) {
  try {
    if (!projectId) throw new Error("Project ID is required.");
    return { takeoff: hydrateTakeoff(await readPersistedTakeoff(projectId)), error: null };
  } catch (error) {
    console.error("[Takeoff] Read latest result failed:", error);
    return { takeoff: null, error };
  }
}

export function clearLatestProjectTakeoff(projectId) {
  if (typeof window === "undefined" || !projectId) return;
  return clearPersistedTakeoff(projectId);
}
