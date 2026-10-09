# Ventra Interactive 3D Preview Patch — 2026-09-19

## Scope
This patch changes only the JPG/PNG/WebP **3D preview path** and the structured 3D viewer presentation. Engineering/CAD/APS/BOQ/Auth/Database paths are not modified.

## Architecture change
The previous raster route attempted exact pixel wall tracing and rejected the whole 3D scene when `TRACE_IMAGE_MISMATCH` / `CONFLICTING_SCALE` fired. That is appropriate for engineering takeoff, but it is the wrong acceptance contract for a customer-facing interactive 3D preview.

The image preview path now calls:

`POST /api/ai/design-3d-preview`

It asks the multimodal model for a **metric semantic scene** (overall dimensions, true concave footprint, rooms, real partitions, openings, visible major furniture) and then deterministically normalizes that scene before it reaches Three.js.

Pipeline:

`Plan image -> semantic plan reconstruction -> deterministic metric normalization -> external footprint wall cycle -> opening snap -> furniture completion -> existing interactive Three.js viewer`

The strict raster engineering route `/api/ai/design-3d` remains in the project and is not deleted.

## What changed
1. Added `src/app/api/ai/design-3d-preview/route.js`.
   - One OpenAI request per preview.
   - No automatic paid geometry retry loop.
   - Metric coordinates instead of brittle exact pixel wall coordinates.
   - Explicit prompt to preserve recesses/notches and open-plan boundaries.
   - Printed dimensions are treated as metric anchors.
   - If the model returns an oversimplified 4-point footprint but its external wall graph contains a closed detailed cycle, the server uses the detailed external cycle.
   - External walls are rebuilt from the final footprint so floor and wall topology cannot drift apart.
   - Doors/windows are snapped deterministically to the nearest real wall.
   - Missing room furniture is completed locally and never changes geometry.
   - Request timeout aborts the OpenAI request instead of leaving it running.

2. Updated `src/app/projects/[id]/ProjectDrawingCenter.jsx`.
   - Raster images use `/api/ai/design-3d-preview` for the 3D scene.
   - The old saved scene is removed before a new image preview run, so a failed request cannot masquerade as the new result.
   - The generated scene is marked `image-interactive-preview`.

3. Updated `src/app/projects/[id]/Project3DViewer.jsx`.
   - Keeps the existing orbit/pan/zoom/top/front/left/iso camera system.
   - Interactive semantic previews use a dark exterior-wall material and light interior partitions for a more architectural dollhouse look.
   - Existing room floor textures, doors, windows, furniture meshes, shadows and interactive camera remain active.

## Environment knobs
Optional `.env.local` settings:

- `OPENAI_3D_PREVIEW_MODEL` — defaults to `OPENAI_FLOORPLAN_GEOMETRY_MODEL`, then `gpt-5.1`.
- `VENTRA_3D_PREVIEW_REASONING` — defaults to `medium`.
- `VENTRA_3D_PREVIEW_MAX_OUTPUT_TOKENS` — defaults to `8000`.
- `VENTRA_3D_PREVIEW_TIMEOUT_MS` — defaults to `120000`.

## Validation performed here
- New API route passes `node --check`.
- Scene normalizer was executed against a concave/notched fixture and produced a non-rectangular footprint, walls, opening attachment and furniture.
- Diff audit against the supplied baseline shows only the intended 3 code files plus this note changed.

A full Next.js production build could not be completed in this environment because dependency installation stalled; run `npm ci` and `npm run build` on the project machine before deployment.
