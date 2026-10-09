VENTRA INTERACTIVE 3D PREVIEW V11

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

Why V11 exists:
V10 diagnostics showed topology.version=enforced_relationship_room_graph_v10
but topology.applied=false, snappedPairs=0, relationshipResidualMean=5.8333,
maxShiftMeters=0. The solver was rejecting relationships that started more
than ~2.2m apart, so the topology graph was never actually applied.

V11 changes:
- removes the large-gap rejection gate
- uses a graph-anchored topology solve
- anchors each connected component on the highest-priority room
- places adjacent rooms edge-to-edge using left/right/above/below relationships
- preserves printed room sizes from dimension lock
- then performs a small multi-pass relaxation
- reports graphPlacedRooms, graphComponentCount, relationshipResidualMean,
  and maxShiftMeters

Expected:
build: interactive-plan-scene-v11-20260919
topology.version: graph_anchored_room_topology_v11

Untouched:
Project3DViewer.jsx
ProjectDrawingCenter.jsx
projects/[id]/page.js
next.config.mjs
APS / DWG
Supabase/Auth
BOQ/Estimate/Quotation

Apply:
1) Stop dev server
2) Replace this one route file
3) Delete .next
4) npm run dev
5) Test one raster plan and export the report
