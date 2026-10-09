VENTRA INTERACTIVE 3D PREVIEW V15

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

Core change:
V14.1 proved the source raster cannot be calibrated with one identical
metres-per-pixel value on X and Y: the 12.50m width projected correctly,
but the 9.50m overall depth projected to about 8.285m.

V15 therefore uses one GLOBAL AFFINE transform:
- one X scale for the entire scene
- one Y scale for the entire scene
- NO per-room resizing
- NO room translation solver
- footprint / rooms / partitions / openings all share exactly the same transform
- printed overall width/depth are authoritative when both are available

This preserves source topology while correcting raster/display anisotropy.

Expected diagnostic:
build: interactive-plan-scene-v15-20260921
sourceProjection.reason: single_global_two_axis_affine_transform_v15
sourceProjection.calibrationMode: two_axis_global_affine
sourceProjection.projectedWidthMeters ~= printed overall width
sourceProjection.projectedDepthMeters ~= printed overall depth
topology.version: source_image_global_affine_layout_v15
topology.maxShiftMeters: 0

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
5) Test once
6) Export the new ventra-raster-report
