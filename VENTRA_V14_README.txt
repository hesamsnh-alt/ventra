VENTRA INTERACTIVE 3D PREVIEW V14

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

CORE CHANGE
V13 used one global coordinate space, but still stretched X and Y independently.
V14 converts normalized source coordinates to REAL image pixels first, then applies
ONE metres-per-pixel scale to BOTH axes.

The scale source is chosen from X or Y based on which axis agrees better with the
printed room dimensions. For the current 2-bedroom test, X has historically been
far more trustworthy than Y, so V14 should choose X and preserve the source-image
aspect instead of vertically stretching/compressing the plan.

V14 diagnostics:
build: interactive-plan-scene-v14-20260921
sourceProjection.reason: single_uniform_pixel_aspect_transform_v14
sourceProjection.chosenAxis: x or y
sourceProjection.meterPerPixel
sourceProjection.projectedWidthMeters
sourceProjection.projectedDepthMeters
sourceProjection.xValidationMeanRelativeError
sourceProjection.yValidationMeanRelativeError

Topology:
topology.version: source_image_uniform_pixel_layout_v14
topology.maxShiftMeters: 0

Dimension lock:
dimensionLock.reason: validation_only_uniform_pixel_layout_v14

NOT TOUCHED
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- projects/[id]/page.js
- next.config.mjs
- APS / DWG
- Supabase/Auth
- BOQ/Estimate/Quotation

APPLY
1. Stop npm dev server
2. Replace this one route file
3. Delete .next
4. npm run dev
5. Test the same raster plan once
6. Export the new ventra-raster-report

Validation performed here:
- route.js passes node --check
- only the preview route is included in this patch
