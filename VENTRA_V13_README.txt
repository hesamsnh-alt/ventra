VENTRA INTERACTIVE 3D PREVIEW V13

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

Core architectural change:
- AI returns geometry in normalized SOURCE-IMAGE coordinates (0..1)
- Ventra applies ONE global image-to-metre transform to the whole plan
- rooms are no longer independently resized or translated
- printed room dimensions remain validation evidence, not per-room distortion commands
- outer footprint, rooms, partitions, doors and windows all share the same transform
- furnishing/material logic remains local after geometry

Why:
V10/V11/V12 proved that post-hoc room graph movement either moved rooms too far
or did nothing. V13 preserves the visual topology directly from the source image.

Expected diagnostics:
build: interactive-plan-scene-v13-20260919
sourceProjection.applied: true
sourceProjection.reason: single_global_image_to_metric_transform
topology.version: source_image_rigid_layout_v13
topology.maxShiftMeters: 0
dimensionLock.reason: validation_only_source_image_layout_v13

Untouched:
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
5) Test the raster plan once
6) Export the new ventra-raster-report
