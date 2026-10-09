# Ventra Interactive 3D Preview V5 — 2026-09-19

This patch is based on V4 and targets the remaining visible geometry problem from the real 2-bedroom test.

## What V4 proved
- API route completes successfully with GPT-5.6 Sol.
- 7 labeled rooms are preserved.
- Footprint is no longer forced to 4 points.
- Preview remains interactive in the existing viewer.
- APS viewer files are untouched.

## V5 changes
1. Adds deterministic room-supported footprint repair for predominantly orthogonal plans.
   - Builds a fine occupancy grid from the labeled room polygons.
   - Expands only enough to connect real circulation between labeled spaces.
   - Intersects the result with the AI outer footprint.
   - Extracts the largest connected orthogonal boundary.
   - Refuses the repair if it would discard too much area, lose a labeled room, or appears non-orthogonal.
   - Purpose: remove large hallucinated exterior lobes such as the lower-left filled area seen in the V4 2-bedroom output.
2. Drops internal partitions that cut through the interior of the same labeled room on both sides.
   - Purpose: prevent invented walls through visibly open rooms.
3. Reports `geometryValidation.footprintRepair` and diagnostic `footprintRepair` for the next real test.

## Intentionally unchanged
- Project3DViewer.jsx
- APS / Autodesk routes and tokens
- DWG/DXF/IFC/RVT engineering pipeline
- Supabase/Auth/BOQ/Estimate/Quotation/Dashboard
- Existing V4 network coalescing/cache behavior

## Expected next diagnostic
`build: interactive-plan-scene-v5-20260919`

Look at `footprintRepair` in the report. A successful deterministic correction should show:
`{ repaired: true, reason: "room_supported_orthogonal_union" }`
