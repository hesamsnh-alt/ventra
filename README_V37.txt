VENTRA V37 - DUAL-PASS TOPOLOGY AUDIT

Changed file only:
src/app/api/ai/design-3d/route.js

Main fixes:
- Fixes strict geometry schema: holes was required but missing from properties.
- Adds printedWidthMeters / printedDepthMeters to rooms.
- Low-confidence holes are rejected.
- Scene health now checks printed room dimensions.
- Every raster plan gets an independent second geometry audit pass.
- Audit checks room labels/count, dimensions, adjacency, footprint, holes,
  walls, doors/windows and circulation.
- First pass and audit are scored; stronger geometry is selected.
- Existing repair pass remains as a third safety layer.
- Repair thresholds are stricter.

Expected route version:
generic-floorplan-engine-v37-dual-pass-topology-audit

Expected logs:
[VENTRA JPG TOPOLOGY AUDIT v37]
[VENTRA JPG HOLE VALIDATOR v37]
[VENTRA JPG SCENE HEALTH v37]
[VENTRA JPG GEOMETRY REPAIR v37]  (only if needed)
[VENTRA GENERIC FLOORPLAN SUCCESS v37]

Install:
Replace only src/app/api/ai/design-3d/route.js
Clear .next, restart, clear old schematic cache once, then Analyze again.
