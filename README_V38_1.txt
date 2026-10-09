VENTRA V38.1 - STRICT SCHEMA HOTFIX

Changed file only:
src/app/api/ai/design-3d/route.js

Exact error fixed:
400 Invalid schema for response_format 'ventra_floorplan_geometry_v15':
'required' must include every key in properties. Missing 'footprint'.

Root cause:
V38 removed "footprint" from the required array but accidentally left the
footprint property inside the strict geometry schema.

Fix:
- footprint property is now completely removed from genericFloorPlanGeometrySchema.
- Geometry structured output contains only the stable fields:
  title, confidence, widthMeters, depthMeters, planBounds, rooms, walls, openings.
- Ventra continues deriving footprint internally from external walls / room geometry.
- No OpenAI hole/footprint structured-output dependency.
- Node syntax check PASS.

Expected route version:
generic-floorplan-engine-v38.1-schema-hotfix

Install:
Replace only:
src/app/api/ai/design-3d/route.js

Then:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

Then re-run Analyze.
