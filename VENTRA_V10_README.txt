VENTRA INTERACTIVE 3D PREVIEW V10

MINIMAL PATCH:
Replaces only:
src/app/api/ai/design-3d-preview/route.js

V10 changes:
- printed dimensions keep controlling room sizes
- topology graph now actively controls room positions
- open/wall/door relationships solve toward physical adjacency
- lower-priority rooms move more than the living/open-plan core
- cross-axis repair prevents corner-only touching
- diagnostics now include relationshipResidualMean and maxShiftMeters
- V9 furnishing and material zoning logic is preserved

Untouched:
Project3DViewer.jsx
ProjectDrawingCenter.jsx
projects/[id]/page.js
next.config.mjs
APS / DWG
Supabase/Auth
BOQ/Estimate/Quotation

After copying:
1) Stop the dev server
2) Delete .next
3) Run npm run dev
4) Test one raster plan
5) Export the new ventra-raster-report

Expected:
build: interactive-plan-scene-v10-20260919
topology.version: enforced_relationship_room_graph_v10
