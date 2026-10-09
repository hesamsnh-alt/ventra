# Ventra V47 validation

Base: ventra(20260913-102936).zip (authoritative project supplied by user)

Changed runtime files only:
- src/app/api/ai/design-3d/route.js
- src/app/projects/[id]/Project3DViewer.jsx (carried from stable image-grounded V42 renderer)
- src/app/projects/[id]/ProjectDrawingCenter.jsx (carried from stable V42 request coalescing/handoff)

Raster JPG/PNG/WebP pipeline:
1. Topology anchor pass: scale, plan bounds, real room identity + label centers.
2. Geometry pass: traces footprint, room polygons, walls, openings and assets against the SAME image while constrained by the anchor.
3. Deterministic compile: one shared image coordinate system -> metric scene.
4. Footprint fallback candidates are accepted only if they contain the detected rooms; a valid concave AI footprint is never replaced just because a wall loop/hull is tidier.
5. Health score is a warning for renderable scenes, not a geometry-replacement engine.

Removed from active raster analysis path:
- full-scene visual-audit replacement pass
- hard-coded apartment reference regression
- post-hoc per-room metric resizing/rectification
- synthetic furniture/fixture completion

Unchanged engineering routes/features:
DWG/DXF/IFC/RVT APS engineering reconstruction, BOQ, Estimate, Quotation, Supabase/Auth, APS token, Takeoff Engine, Geometry Extractor, Dashboard, persistence and export.

Checks performed:
- node --check src/app/api/ai/design-3d/route.js : PASS
- strict schema source review for topology + full geometry schemas : PASS
- no node_modules in supplied ZIP, so a truthful full Next.js build could not be executed in this sandbox.
