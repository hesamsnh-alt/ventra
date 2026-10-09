VENTRA INTERACTIVE 3D PREVIEW V12

MINIMAL PATCH
Replaces only:
src/app/api/ai/design-3d-preview/route.js

Why V12 exists:
V11 actually moved rooms, but it moved some of them far too much.
The diagnostic showed maxShiftMeters around 3.77m and topology residual still around 1.10m.
Visually that damaged the layout even though the graph solver looked 'more active'.

V12 changes:
- removes large graph propagation
- keeps every room anchored close to the source-image observation
- living / kitchen-dining have the tightest movement budget
- bedrooms have a moderate movement budget
- bathroom / storage rooms can move a little more
- relationship corrections are local only
- relationships with >1.15m initial gap are treated as suspicious and do not drag rooms
- cross-axis repair only happens when rooms already nearly touch
- printed dimension locking remains intact
- furnishing and material zoning remain intact

Expected:
build: interactive-plan-scene-v12-20260919
topology.version: source_anchored_room_topology_v12
topology.maxShiftMeters should stay under ~0.8m
topology.sourceAnchorMeanShift should stay small

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
2) Replace this route file
3) Delete .next
4) npm run dev
5) Test the same raster plan once
6) Export the new ventra-raster-report
