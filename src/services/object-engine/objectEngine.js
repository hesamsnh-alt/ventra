// src/services/object-engine/objectEngine.js

import { detectWalls } from "./wallDetector";
import { detectDoors } from "./doorDetector";
import { detectWindows } from "./windowDetector";
import { detectColumns } from "./columnDetector";
import { detectBeams } from "./beamDetector";
import { detectSlabs } from "./slabDetector";

export async function buildBuildingModel(geometryData = {}) {
  const geometry = geometryData.geometry || geometryData;

  const walls = detectWalls(geometry);
  const doors = detectDoors(geometry);
  const windows = detectWindows(geometry);
  const columns = detectColumns(geometry);
  const beams = detectBeams(geometry);
  const slabs = detectSlabs(geometry);

  return {
    status: "READY",

    metadata: {
      generatedAt: new Date().toISOString(),
      units: geometryData.model_unit || "m",
      source: geometryData.source || "APS",
      objectCount: geometryData.object_count || 0,
      lineCount: geometryData.line_count || 0,
      arcCount: geometryData.arc_count || 0,
    },

    summary: {
      totalWalls: walls.length,
      totalDoors: doors.length,
      totalWindows: windows.length,
      totalColumns: columns.length,
      totalBeams: beams.length,
      totalSlabs: slabs.length,
      totalObjects:
        walls.length +
        doors.length +
        windows.length +
        columns.length +
        beams.length +
        slabs.length,
    },

    walls,
    doors,
    windows,
    columns,
    beams,
    slabs,
  };
}

export default buildBuildingModel;