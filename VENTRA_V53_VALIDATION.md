# Ventra V53 validation

Base: Ventra V52 full package.

Purpose: fix duplicate raster schematic requests and preserve V52 geometry/timeouts.

Changed source files only:
- src/app/api/ai/design-3d/route.js
- src/app/projects/[id]/ProjectDrawingCenter.jsx

Behavioral changes:
- JPG/PNG/WebP upload no longer automatically starts a paid 3D Vision request.
- Analyze owns schematic generation.
- In-flight schematic request registry is stored on window so React remounts do not create duplicate API calls.
- Existing V52 120s topology / 150s trace / 70s optional budgets are preserved.
- Geometry, pixel-wall scoring, viewer and engineering routes are unchanged.

Validation performed:
- node --check src/app/api/ai/design-3d/route.js : PASS
- Source diff against V52 reviewed.
- Project3DViewer.jsx unchanged from V52.
- DWG/DXF/IFC/RVT and APS code not modified.

Expected logs:
- generic-floorplan-engine-v53-single-flight-timeout-resilient
- [VENTRA JPG ANALYSIS BUDGET v53]
- [VENTRA JPG 3D REQUEST COALESCED v53] only if a duplicate Analyze attempt occurs while the first is still running.

The sandbox does not contain node_modules, so a full Next.js build was not claimed.
