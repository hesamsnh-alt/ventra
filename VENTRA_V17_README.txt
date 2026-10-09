VENTRA INTERACTIVE 3D PREVIEW V17

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

WHY V17
V16's wall-aware furnishing became too strict. The latest real test completed
successfully, but only 11 assets survived for 7 rooms. The scene therefore looked
emptier and less useful even though the geometry pipeline remained stable.

V17 changes are GENERAL, not plan-specific:
- relaxes room-edge vs real-wall support matching to tolerate wall thickness/offset
- fixes bedroom bed-depth orientation bug (V16 referenced a non-existent side.axis)
- reduces overly aggressive collision and door-clearance rejection
- retries kitchen counter placement across multiple valid wall runs
- places living coffee table from multiple candidates
- keeps bed/wardrobe/sofa/TV/counter placement aligned to actual room edges
- preserves V15 global affine geometry, room polygons, materials and APS separation
- adds furnishing diagnostics by asset type and by room so missing essentials are visible

Expected:
build: interactive-plan-scene-v17-20260921
furnishing.version: essential_wall_aware_furnishing_v17
furnishing.byType: object
furnishing.byRoom: array

Validation:
node --check: PASS

Not touched:
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- projects/[id]/page.js
- next.config.mjs
- APS / DWG
- Supabase/Auth
- BOQ/Estimate/Quotation

Apply:
1) Stop dev server
2) Replace only the route file
3) Delete .next
4) npm run dev
5) Test the same plan once
6) Export the new ventra-raster-report
