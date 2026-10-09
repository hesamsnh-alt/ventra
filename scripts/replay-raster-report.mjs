// No API calls, storage writes, or reference-template coordinates.
// node scripts/replay-raster-report.mjs /path/to/ventra-raster-report.json
import { readFileSync } from "node:fs";
import { compileRasterFloorplan, normalizeRasterPixelTrace } from "../src/lib/rasterFloorplanGeometry.mjs";
if (!process.argv[2]) throw new Error("Pass the downloaded raster analysis report JSON.");
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (report.format !== "ventra-raster-diagnostic-v1") throw new Error("Unsupported report format.");
try {
  if (!report.trace && !report.rawPixelTrace) {
    console.log(JSON.stringify({ accepted: false, failure: report.failure, transport: report.transport, message: "No complete trace was received; geometry replay is unavailable." }, null, 2));
    process.exit(1);
  }
  const trace = report.trace || normalizeRasterPixelTrace(report.rawPixelTrace, report);
  const scene = compileRasterFloorplan(trace, report);
  console.log(JSON.stringify({ accepted: true, validation: scene.geometryValidation, scene }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ accepted: false, code: error.code, message: error.message, details: error.details }, null, 2));
  process.exitCode = 1;
}
