# Ventra Interactive 3D Preview V3 — 2026-09-19

This patch is based on the original 2026-09-19 project tree, not on the earlier experimental preview patch chain.

## Scope
Only the raster interactive 3D preview path was changed.

Changed:
- `src/app/api/ai/design-3d-preview/route.js` (new preview route, V3)
- `src/app/projects/[id]/ProjectDrawingCenter.jsx` (routes JPG/PNG/WebP preview to V3 and stops before the second takeoff AI call)

Intentionally unchanged:
- `src/app/projects/[id]/Project3DViewer.jsx`
- Autodesk APS viewer / translation / geometry pipeline
- Supabase / database / auth
- BOQ / estimate / quotation code
- `next.config.mjs`

## V3 changes
1. Preview generation is one paid OpenAI call only. Successful raster preview returns before `/api/ai/analyze-drawing`, avoiding the second ~80s AI call seen in the previous test.
2. The model is explicitly forbidden to redesign, simplify, mirror, rotate, invent corridors, or invent unlabeled rooms.
3. Rooms are label-grounded. `labelVisible` is part of the strict response schema; when multiple labeled rooms exist, unlabeled room candidates are discarded locally.
4. Visible room dimensions are returned as metric evidence (`printedWidthMeters`, `printedDepthMeters`). Axis-aligned rectangular room zones are corrected locally to those printed dimensions while preserving their center.
5. Deterministic dark-stroke guides from the existing `rasterImageEvidence.mjs` engine are supplied to the vision model as supporting wall/recess evidence. They guide layout but do not hard-reject the visual preview.
6. Footprint instructions explicitly require the true non-rectangular building outline, entrance notches, side setbacks and projections.
7. Furniture remains local/deterministic and is not generated in the model JSON.
8. Viewer code remains byte-for-byte identical to the original project, preserving APS source switching and orbit/pan/zoom behavior.

## Expected log
A successful run should show:
`POST /api/ai/design-3d-preview 200`

For JPG/PNG/WebP preview it should NOT immediately be followed by:
`POST /api/ai/analyze-drawing`

The returned diagnostic build should be:
`interactive-plan-scene-v3-20260919`

## Important
This is an interactive visual reconstruction path. APS remains authoritative for engineering/CAD sources and BOQ/takeoff remains a separate workflow.
