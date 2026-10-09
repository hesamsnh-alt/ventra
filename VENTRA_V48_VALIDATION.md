# Ventra V48 deterministic planar graph

Base: V47 full project, itself built from the authoritative ventra(20260913-102936).zip.

Changed source file only:
- src/app/api/ai/design-3d/route.js

Raster pipeline:
1. Vision pass 1 reads metric scale, plan bounds, and room label anchors.
2. Vision pass 2 detects wall centerline evidence, openings, and visible assets.
3. Ventra snaps near-horizontal/vertical wall evidence, closes small T/corner gaps, splits intersections, builds a half-edge planar graph, extracts bounded faces, matches room labels to faces, and derives the exterior loop.
4. Existing metric compiler/render scene path receives deterministic polygons.

Not changed:
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- DWG/DXF/IFC/RVT engineering path
- APS, BOQ, Estimate, Quotation, Supabase/Auth, Takeoff, Geometry Extractor, Dashboard, Persistence, Export

Validation performed:
- node --check src/app/api/ai/design-3d/route.js : PASS
- source diff against V47: only route.js changed (plus this note)
- no hardcoded reference-plan geometry added

Limit: live OpenAI vision calls cannot be executed in this offline build environment, so image-level reconstruction must be regression-tested locally with the reference PNG.
