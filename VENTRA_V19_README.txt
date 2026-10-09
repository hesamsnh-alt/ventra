VENTRA INTERACTIVE 3D PREVIEW V19

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

WHY V19
V18 improved furnishing substantially, but repeated runs of the same plan still
showed geometry drift. The remaining problem is not furniture. It is that the
vision model may place a wall/room corner a little differently on every run.

V19 adds a deterministic SOURCE-PIXEL wall-guide snap:
- AI still understands labels, room semantics, relationships, doors and windows
- Ventra still uses the V15 global affine calibration
- BUT normalized footprint/room/partition/opening coordinates are now snapped
  only when they are already close to long dark source-image wall strokes
- no new wall is invented from a pixel guide
- distant coordinates are never dragged toward a guide
- guide extents are respected, reducing accidental snaps to text/furniture
- near-duplicate wall-face guides are clustered before snapping

This is general for raster floor plans and does not encode this 2-bedroom plan.

Expected:
build: interactive-plan-scene-v19-20260921
guideSnap.reason: nearby_source_pixel_wall_guide_snap_v19
guideSnap.pointsSnapped > 0 on drawings with usable wall strokes

Validation:
node --check: PASS

NOT TOUCHED:
Project3DViewer.jsx
ProjectDrawingCenter.jsx
projects/[id]/page.js
next.config.mjs
APS / DWG
Supabase/Auth
BOQ/Estimate/Quotation
