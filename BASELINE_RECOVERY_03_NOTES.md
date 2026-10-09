# Ventra Baseline Recovery 03

Source: VENTRA_BASELINE_RECOVERY_02_FULL.zip

## Scope
Only `src/app/api/ai/design-3d/route.js` changed.

## Fix
- Raster single-pass Vision reasoning effort reduced from `high` to `low`.
- Raster trace timeout increased from 150,000 ms to 240,000 ms.
- Added BR03 diagnostic fields/log labels.
- No multi-pass verifier/recovery pipeline reintroduced.
- No changes to Project3DViewer, DrawingCenter, APS, DWG/DXF/IFC/RVT, BOQ, Estimate, Supabase/Auth or takeoff services.

## Why
BR02 reached the OpenAI raster request but timed out. This patch reduces server-side reasoning latency while keeping the same strict image-grounded schema and gives the single pass more transport/runtime headroom.

## Validation
- `node --check src/app/api/ai/design-3d/route.js`: PASS.
- Directory hash comparison against BR02: only the route above changed (plus this notes file).
- Live OpenAI call was not run in the build container because user credentials/runtime are not available here.
