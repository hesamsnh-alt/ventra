VENTRA INTERACTIVE 3D PREVIEW V16

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

WHY V16
V15 proved the overall metric calibration is no longer the main problem:
the global width/depth are correct, while the visible room/wall geometry is still wrong.
That means free-form AI polygons are the remaining weak link.

V16 architecture:
AI = semantic observer
Ventra = geometric grounder

Before metric projection, V16:
- takes the AI's normalized footprint / room polygons / partitions
- compares each axis-aligned edge with deterministic dark-stroke guides extracted
  from the SAME source plan image
- snaps an edge only when a real guide is close enough AND overlaps enough of the edge
- uses stricter thresholds for the outer footprint than for room boundaries
- keeps unmatched edges untouched rather than inventing geometry
- then applies the existing V15 global affine calibration
- furniture/material generation happens only afterward

This is generic; it is not hard-coded to the current 2-bedroom plan.

New diagnostic:
build: interactive-plan-scene-v16-20260921

geometryValidation.sourceGeometrySnap:
  applied
  reason = semantic_geometry_snapped_to_detected_wall_strokes_v16
  guideCount
  footprintSnappedEdges
  roomSnappedEdges
  partitionSnaps

topology.version:
  pixel_grounded_global_affine_layout_v16

IMPORTANT:
The pixel guides are NOT blindly treated as walls. A guide must be near the AI semantic
edge and overlap a substantial portion of it before snapping. This reduces the risk of
furniture/text strokes becoming architecture.

Validation performed:
node --check: PASS

NOT TOUCHED
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- projects/[id]/page.js
- next.config.mjs
- APS / DWG
- Supabase/Auth
- BOQ/Estimate/Quotation

APPLY
1) Stop npm dev server
2) Replace only the route file
3) Delete .next
4) npm run dev
5) Test the same raster plan once
6) Export the new ventra-raster-report
