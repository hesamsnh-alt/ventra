VENTRA V38 - STABLE DERIVED FOOTPRINT

Changed file only:
src/app/api/ai/design-3d/route.js

Why:
Repeated 500 errors appeared after adding footprint/holes into the strict
structured-output schema.

V38 deliberately returns to the known-stable geometry schema:
- rooms
- walls
- openings
- plan bounds / dimensions

Footprint is NOT requested from OpenAI.
Holes are NOT requested from OpenAI.

Instead Ventra derives the base floor deterministically:
1. Try to build a closed loop from detected external walls.
2. If that is not possible, build a safe hull from room polygons + external wall endpoints.
3. No AI holes are accepted, so false black voids cannot be introduced by the API.

Preserved:
- V36.1 async API stability
- image preparation fallback
- current Viewer footprint rendering
- BOQ / Estimate / Quotation
- APS / DWG / DXF / IFC / RVT paths

Expected route version:
generic-floorplan-engine-v38-stable-derived-footprint

Expected logs:
[VENTRA JPG IMAGE PREP v36.1]
[VENTRA DERIVED FOOTPRINT v38]
[VENTRA JPG SCENE HEALTH v38]
[VENTRA GENERIC FLOORPLAN SUCCESS v38]

Install:
Replace only:
src/app/api/ai/design-3d/route.js

Then:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

Clear old schematic/base cache once and Analyze again.
