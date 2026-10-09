VENTRA V37.1 - SAFE TOPOLOGY AUDIT

Changed file only:
src/app/api/ai/design-3d/route.js

Fixes the V37 500 regression:
- Rebuilt from stable V36.1 API route.
- Keeps V36.1 async error handling.
- Fixes the generic geometry schema: holes was required but missing from properties.
- Adds a second topology audit only when the first scene health is weak.
- Audit uses the exact same valid strict schema as pass 1.
- Audit is isolated inside try/catch.
- Audit failure/timeout can NEVER fail the main Analyze request.
- Existing geometry repair remains as a third safety layer.
- No Viewer changes.

Expected route version:
generic-floorplan-engine-v37.1-safe-topology-audit

Expected logs:
[VENTRA JPG IMAGE PREP v36.1]
[VENTRA JPG SCENE HEALTH v37.1]
[VENTRA JPG SAFE TOPOLOGY AUDIT v37.1]
[VENTRA JPG GEOMETRY REPAIR v37.1]   only if still needed
[VENTRA GENERIC FLOORPLAN SUCCESS v37.1]

Install:
Replace only:
src/app/api/ai/design-3d/route.js

Then:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

Clear old schematic/base cache once and Analyze again.
