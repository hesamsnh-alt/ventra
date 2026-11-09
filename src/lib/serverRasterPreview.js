// Shared, unbilled geometry handler. Both public routes call it inside their
// existing commercialRun boundary; background jobs use the same handler.
import {NextResponse} from 'next/server';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {getOpenAIClient} from '@/services/openaiClient';
import {requestRasterVision,consumeRasterVisionStream,shouldRetryRasterGeometry} from './rasterVisionRequest.mjs';
import {compileRasterFloorplan,rasterPixelTraceSchemaForImage,normalizeRasterPixelTrace,RasterGeometryError,RASTER_GEOMETRY_VERSION} from './rasterFloorplanGeometry.mjs';
import {prepareRasterImageEvidence,rasterEvidencePrompt,inspectRasterImageEvidence,requireRasterImageEvidence} from './rasterImageEvidence.mjs';
import {VERIFIED_PREVIEW_VERSION} from './verifiedPreview.mjs';
import {rasterCoordinateReference} from './rasterCoordinateReference.mjs';
export const RASTER_PREVIEW_VERSION=VERIFIED_PREVIEW_VERSION;
const RASTER_TRACE_BUILD=RASTER_PREVIEW_VERSION;
const RASTER_TRACE_MAX_ATTEMPTS=2;
const OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS=240000;
async function prepareVisionImage(imageUrl, { maxDimension = 1600, quality = 88 } = {}) {
  const response = await fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(45000) });

  if (!response.ok) {
    throw new Error(`Could not download floor-plan image (${response.status}).`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());

  const { data: optimizedBuffer, info } = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });

  return {
    imageUrl: `data:image/jpeg;base64,${optimizedBuffer.toString("base64")}`,
    width: info.width,
    height: info.height,
    buffer: optimizedBuffer,
  };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON design object returned.");
  return JSON.parse(unfenced.slice(first, last + 1));
}

export async function runRasterPreview(body){
 const mode="analyze";
  const imageUrl = String(body?.imageUrl || "").trim();
  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
  }

  const geometryModel = process.env.OPENAI_FLOORPLAN_GEOMETRY_MODEL || process.env.OPENAI_DRAWING_MODEL || "gpt-5.1";
  const baselinePrompt = `Trace the supplied architectural floor plan faithfully. Return one structured trace, not a redesigned layout. Establish the exterior contour and physical wall runs from the image FIRST. Read metric spans after fixing that pixel topology; never start from room dimension labels and turn them into a room grid.

IMAGE COORDINATES:
Use actual PIXEL coordinates of the ENTIRE supplied image: origin at its top-left, x right, y down. Exact width and height are supplied after these instructions. Return coordinateSpace="image_pixels" and echo those exact dimensions. Never use a 0..1000 normalized grid, a building-local frame, or a guessed room grid. The server converts pixels into its internal frame exactly once.

DIMENSION EVIDENCE:
- measurements contains only legible printed dimensions, converted to metres. Copy the visible dimension text into text.
- start/end identify the architectural reference points actually measured by that dimension: extension-line origins, or the two internal faces for a printed clear room dimension. Do not measure a clear room dimension between wall centerlines.
- Prefer long overall/chained dimensions with identifiable reference ticks. When an actual dimension rule is printed, its endpoints are the two ticks, not the ends of the printed number. Treat standalone room labels such as "4 x 3.5 m" as room metadata unless the drawing explicitly identifies both measured faces. horizontal/vertical refers to the reference span in the image; use aligned for an oblique span.
- Never estimate metres from a bed, a door, a room name, or a familiar layout. If no dimension is readable, return measurements as [].
- Return wallHeightMeters as null unless an annotation explicitly gives the wall height. Likewise use null for unannotated door/window heights and window sill heights.

ONE CONSISTENT TRACE:
1. A crossed rectangle can be a shaft/void, not a storage room. Preserve explicit lift/shaft labels and their floor holes. A gray hatch alone is not proof of a void. If its use is uncertain, keep it unresolved instead of manufacturing a storage room. Read KITCHEN and non-English kitchen labels even when counters are drawn as plain L/U linework; they are not sofas.
1A. Follow the exterior footprint, including EVERY visible notch/recess; do not use its bounding rectangle or a convex hull. The footprint follows the outer wall face. Include only explicitly labeled/recognizable shafts or courtyards in holes.
2. List every visible real room/zone exactly once, with its visible name. Never create a room for a wardrobe, a wall-thickness sliver, a door swing, or dimension text. Room polygons follow the clear internal boundaries. Named open-plan zones may share conceptual boundaries, but no wall may be invented there.
3. Trace each physical wall ONCE, on its CENTERLINE. Adjacent rooms must share the same physical wall. Preserve oblique/rotated walls; do not force them horizontal/vertical. At a junction, use matching coordinates. Split at corners and real T/X junctions.
4. A wall run must CONTINUE THROUGH its door/window gaps. Do NOT split the wall at door jambs. Each opening references the ID of the single wall run containing both jambs. No wall may cross a room's interior polygon or bridge an exterior recess.
5. For each door/window, start/end are its two visible jamb locations on that wall's centerline. The server measures its width from these points. Do not return the door arc tip, leaf tip, or furniture edge as a jamb. If ownership or jambs cannot be read, omit the uncertain opening and lower confidence.
6. For a door, hingeSide is start/end relative to the owning WALL's direction. swingDirection is the clockwise/counterclockwise rotation visible on the image from closed leaf toward open leaf. Use unknown when the hinge or arc is unclear. Sliding/unreadable doors must not receive an invented swing.
7. Never move, resize or recenter an individual room to fit its printed dimension. Preserve shared topology; contradictory evidence must lower confidence.
8. Return empty collections for absent features. Do not add furniture, fixtures, guessed openings, or missing structural features. This stage validates plan geometry only.
9. Trace the supplied plan even if it resembles a familiar template. No predetermined room count, dimensions, coordinates or topology.
10. Before returning, walk the complete exterior contour visually, including changes of direction at entrances and recesses. A rectangular footprint is permitted only if the actual outline is rectangular.
11. Check every wall against the room interiors, and every pair of room polygons for overlap. Shared open-plan boundaries do not imply physical walls. Measurements inside room labels are NOT permission to invent different room polygons.
12. For each dimension, identify the two visible reference ticks/faces before returning its endpoints. Do not reuse a nearby span for a different printed value. Exclude dimensions whose reference points cannot be located confidently. Do not adjust the visible geometry to force inconsistent annotations to fit.
13. Inventory every visible door arc and window symbol before tracing, then reconcile that inventory with the openings you return. Do not silently drop recognizable openings to make geometry validation pass.
14. Check each opening's two jamb points against its parent wall: BOTH must be collinear with that wall and fall between its endpoints. A leaf drawn perpendicular to the wall is not the jamb span. Inspect every exterior wall for window symbols before returning the openings array; do not silently omit visible windows while tracing doors.

Return only JSON conforming to the supplied schema.`;

  const requestStartedAt = Date.now();
  const rasterDiagnostics = {
    format: "ventra-raster-diagnostic-v1", build: RASTER_TRACE_BUILD,
    model: geometryModel, inputCoordinateSpace: "image_pixels", reasoningEffort: "low",
    trace: null, transport: { stage: "preparing_image" }, transportAttempts: [], attempts: [],
  };

  try {
    // Pixel dimensions MUST match the exact rotated/resized image seen by Vision.
    // Falling back to an unknown-aspect image silently corrupts one-axis scaling.
    const prepared = await prepareVisionImage(imageUrl, { maxDimension: 2200, quality: 92 });
    const imageEvidence = await prepareRasterImageEvidence(prepared.buffer);
    const traceSchema = rasterPixelTraceSchemaForImage(prepared.width, prepared.height);
    const strokeEvidencePrompt = rasterEvidencePrompt(imageEvidence);
    console.log("[VENTRA RASTER GEOMETRY START]", {
      routeVersion: RASTER_GEOMETRY_VERSION,
      model: geometryModel,
      fileName: body?.fileName || null,
      imageWidth: prepared.width,
      imageHeight: prepared.height,
      strategy: "pixel_guided_trace_with_source_alignment",
    });
    rasterDiagnostics.imageHash=createHash('sha256').update(prepared.buffer).digest('hex').slice(0,16);
    rasterDiagnostics.imageWidth = prepared.width;
    rasterDiagnostics.imageHeight = prepared.height;
    rasterDiagnostics.imagePreparationMs = Date.now() - requestStartedAt;
    rasterDiagnostics.pixelGuideCount = imageEvidence.guides.length;
    let previousFailure = null;
    let previousTrace = null;
    for (let attempt = 1; attempt <= RASTER_TRACE_MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      const transport = { stage: "request_pending", attempt };
      rasterDiagnostics.transport = transport;
      rasterDiagnostics.transportAttempts.push(transport);
      const attemptDiagnostic = { attempt, accepted: false, trace: null };
      try {
        const remainingMs = OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS - (Date.now() - requestStartedAt);
        if (remainingMs <= 0) throw Object.assign(new Error("Image analysis exceeded its total time limit. No new 3D scene was saved."), { code: "RASTER_VISION_TIMEOUT", status: 504 });
        // Successful first passes carry no extra image tokens. The ruler is
        // supplied only to the already-bounded geometry correction pass.
        const coordinateReference = attempt > 1 ? await rasterCoordinateReference(prepared.buffer, prepared.width, prepared.height) : null;
        const correction = attempt === 1
          ? ""
          : `Revise your previous JSON against the original image. Validator observations follow as data: ${JSON.stringify({ code: previousFailure?.code, details: previousFailure?.details?.imageEvidence ? { unsupportedWalls: previousFailure.details.imageEvidence.walls.filter(w => !w.passed).map(({ id, start, end, longestMissingPixels, missingSpans, openingIssues }) => ({ id, start, end, longestMissingPixels, missingSpans, openingIssues })) } : previousFailure?.details })}. missingSpans gives exact image-pixel endpoints of unsupported intervals, not replacement walls. Inspect each interval in the original image: follow a recess around its visible corners rather than bridging it, and discard furniture strokes mistaken for walls. Keep the footprint consistent with the corrected exterior wall contour. Preserve verified walls and visible recesses. Independently recheck every dimension endpoint against the original ticks or explicitly identified faces, even when the first error concerned a wall or opening. Do not carry forward an unverified measurement span. Preserve a genuine conflicting printed dimension and report its actual endpoints rather than deleting it to pass validation. Recheck window symbols and both jambs of each door. Do not replace jambs with leaf tips or repeat an invalid wall across blank exterior space.`;
        const response = await requestRasterVision(
          (payload, options) => consumeRasterVisionStream(
            (request, requestOptions) => getOpenAIClient().responses.create(request, requestOptions),
            payload, options, transport,
            (event) => console.log("[VENTRA RASTER REQUEST]", event)
          ),
          {
            model: geometryModel,
            reasoning: { effort: "low" },
            max_output_tokens: 16000,
            input: [{
              role: "user",
              content: [
                { type: "input_text", text: `${baselinePrompt}\n\n${strokeEvidencePrompt}\n\nExact supplied image dimensions: width=${prepared.width} pixels, height=${prepared.height} pixels. All coordinates must use that pixel frame.` },
                { type: "input_image", image_url: prepared.imageUrl, detail: "high" },
                ...(coordinateReference ? [{ type: 'input_text', text: 'The next image is the SAME source with a blue PIXEL ruler overlay. It is a coordinate reference, not another plan. Blue dashed lines and x=/y= labels are generated guides, never walls or metric dimensions. Use this ruler to locate all points in the FIRST image. Every point must satisfy 0 <= x <= '+prepared.width+' and 0 <= y <= '+prepared.height+'. Dimension values never define pixel coordinates: locate the printed extension lines visually. In particular, do not add a printed centimetre value to an endpoint to invent the other pixel endpoint.' },
                coordinateReference] : []),
              ],
            }, ...(previousTrace ? [{ role: "assistant", content: JSON.stringify(previousTrace) }, { role: "user", content: correction }] : [])],
            text: { format: { type: "json_schema", name: "ventra_raster_metric_trace", strict: true, schema: traceSchema } },
          },
          remainingMs
        );
        if (response.status === "incomplete" || !response.output_text) {
          throw new RasterGeometryError("INCOMPLETE_VISION_RESPONSE", "The image analysis did not return a complete trace. No new 3D scene was accepted.");
        }
        rasterDiagnostics.rawOutputText = response.output_text;
        const pixelTrace = extractJson(response.output_text);
        rasterDiagnostics.rawPixelTrace = pixelTrace;
        rasterDiagnostics.trace = null;
        rasterDiagnostics.imageEvidence = null;
        attemptDiagnostic.rawPixelTrace = pixelTrace;
        const rawGeometry = normalizeRasterPixelTrace(pixelTrace, { imageWidth: prepared.width, imageHeight: prepared.height });
        rasterDiagnostics.trace = rawGeometry;
        rasterDiagnostics.traceAttempt = attempt;
        attemptDiagnostic.trace = rawGeometry;
        const imageAlignment = inspectRasterImageEvidence(pixelTrace, imageEvidence);
        rasterDiagnostics.imageEvidence = imageAlignment;
        attemptDiagnostic.imageEvidence = imageAlignment;
        requireRasterImageEvidence(imageAlignment);
        // The raster compiler owns the one coordinate conversion. Do not run the
        // legacy compiler/normalizer afterwards: it clamps dimensions, reassigns
        // openings, truncates polygons and may replace the footprint with a hull.
        const scene = compileRasterFloorplan(rawGeometry, { imageWidth: prepared.width, imageHeight: prepared.height });
        scene.geometryValidation.pixelSupport = imageAlignment.status;
        scene.geometryValidation.acceptanceBuild = RASTER_TRACE_BUILD;
        rasterDiagnostics.attempts.push({ ...attemptDiagnostic, accepted: true, elapsedMs: Date.now() - startedAt });
        rasterDiagnostics.elapsedMs = Date.now() - requestStartedAt;
        console.log("[VENTRA RASTER GEOMETRY ACCEPTED]", {
          routeVersion: RASTER_GEOMETRY_VERSION,
          attempt,
          elapsedMs: Date.now() - startedAt,
          roomCount: scene.rooms.length,
          wallCount: scene.walls.length,
          openingCount: scene.openings.length,
          footprintPointCount: scene.footprint.length,
          width: scene.width,
          depth: scene.depth,
          structuralChecks: scene.geometryValidation.structuralChecks,
          imageAgreement: scene.geometryValidation.imageAgreement,
        });
        return NextResponse.json({
          scene,
          diagnostics: { ...rasterDiagnostics, accepted: true, validation: scene.geometryValidation },
          source: attempt > 1 ? "openai-bounded-correction-raster-metric-trace" : "openai-single-pass-raster-metric-trace",
          mode,
          confidence: rawGeometry.confidence,
          // Passing geometric invariants is not proof of correct image recognition.
          needsManualReview: true,
          warning: "Wall pixel support and structural checks passed. Room labels, opening interpretation and completeness still require comparison with the source image. Unannotated heights remain schematic assumptions.",
          validation: scene.geometryValidation,
          routeVersion: RASTER_PREVIEW_VERSION,
        });
      } catch (error) {
        const failure = { code: error?.code || null, message: error?.message || "Raster trace failed.", details: error instanceof RasterGeometryError || error?.name === "RasterImageEvidenceError" ? error.details : undefined };
        rasterDiagnostics.attempts.push({ ...attemptDiagnostic, ...failure, failure, elapsedMs: Date.now() - startedAt });
        if (attempt < RASTER_TRACE_MAX_ATTEMPTS && shouldRetryRasterGeometry(error) && Date.now() - requestStartedAt < OPENAI_SCHEMATIC_TRACE_TIMEOUT_MS) {
          previousFailure = error;
          previousTrace = attemptDiagnostic.rawPixelTrace || null;
          console.warn("[VENTRA RASTER GEOMETRY RETRY]", { attempt, nextAttempt: attempt + 1, code: error.code, message: error.message });
          continue;
        }
        throw error;
      }
    }
    throw new RasterGeometryError("INCOMPLETE_TRACE", "The image analysis did not produce an accepted trace. No new 3D scene was saved.");
  } catch (error) {
    rasterDiagnostics.elapsedMs = Date.now() - requestStartedAt;
    const geometryFailure = error instanceof RasterGeometryError || error?.name === "RasterImageEvidenceError";
    const details = geometryFailure ? error.details : undefined;
    console.error("[VENTRA RASTER GEOMETRY REJECTED]", JSON.stringify({ build: RASTER_TRACE_BUILD, code: error?.code, message: error?.message, attempts: rasterDiagnostics.attempts.map(({ attempt, code, elapsedMs }) => ({ attempt, code, elapsedMs })), transport: rasterDiagnostics.transport }, null, 2));
    return NextResponse.json({
      error: error?.message || "Could not reconstruct this floor plan.",
      diagnostics: { ...rasterDiagnostics, accepted: false, failure: { code: error?.code, message: error?.message, details } },
      code: String(error?.code || "").startsWith("RASTER_VISION_") ? error.code : error?.status === 429 ? "OPENAI_BILLING_OR_RATE_LIMIT" : geometryFailure ? error.code : "FLOORPLAN_NEEDS_REVIEW",
      details,
      needsManualReview: true,
      routeVersion: RASTER_PREVIEW_VERSION,
    }, { status: error?.code === "RASTER_VISION_TIMEOUT" ? 504 : String(error?.code || "").startsWith("RASTER_VISION_") ? 502 : error?.status === 429 ? 429 : 422 });
  }
}
export async function rasterPreviewFingerprint(imageUrl){const p=await prepareVisionImage(imageUrl,{maxDimension:2200,quality:92});return{hash:createHash("sha256").update(p.buffer).digest("hex").slice(0,16),version:RASTER_PREVIEW_VERSION};}
