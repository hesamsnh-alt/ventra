VENTRA 3D FINAL CANDIDATE — 2026-09-21

This is a clean consolidation, not another patch chain.

Replaces exactly:
1) src/app/api/ai/design-3d-preview/route.js
2) src/app/projects/[id]/Project3DViewer.jsx

What changed:
- source-image guide snapping is restricted to footprint/partitions
- room polygons and door/window centers are no longer over-snapped
- compact contained fallbacks finish storage, bathroom and kitchen essentials
- furniture/material contrast is stronger and closer to the target architectural cutaway
- camera is more top-down
- external walls remain charcoal; internal walls warm off-white
- bedrooms use oak, main open-plan areas warm light stone, bathrooms gray ceramic
- stable image-content cache remains enabled

Expected:
build: interactive-plan-scene-final-candidate-20260921
presentation.version: ventra_architectural_cutaway_final
presentation.guideSnapScope: footprint_and_partitions_only

Validation:
route.js node --check: PASS

Not touched:
APS/DWG
Supabase/Auth
BOQ/Estimate/Quotation
Dashboard
