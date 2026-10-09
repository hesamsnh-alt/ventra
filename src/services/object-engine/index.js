// src/services/object-engine/index.js

import { buildBuildingModel } from "./objectEngine";

import { detectWalls } from "./wallDetector";
import { detectDoors } from "./doorDetector";
import { detectWindows } from "./windowDetector";
import { detectColumns } from "./columnDetector";
import { detectBeams } from "./beamDetector";
import { detectSlabs } from "./slabDetector";

export {
  buildBuildingModel,

  detectWalls,
  detectDoors,
  detectWindows,
  detectColumns,
  detectBeams,
  detectSlabs,
};

export default buildBuildingModel;