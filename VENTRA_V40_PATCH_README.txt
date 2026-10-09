VENTRA V40 - JPG/PNG/WebP 3D TOPOLOGY + ASSET PIPELINE FIX
Base authoritative ZIP: ventra(20260913-102936).zip
Project ID: 3f30a007-1781-47cb-84c8-37b911ca393f

INSTALL
1) Stop npm run dev.
2) Back up the project.
3) Extract this ZIP directly over the Ventra project root.
4) Allow overwrite of:
   src/app/api/ai/design-3d/route.js
5) Restart: npm run dev
6) Delete the old stored schematic for the test image by regenerating it from Drawing Center. Existing localStorage scenes will not automatically gain the new topology.

WHAT THIS PATCH FIXES
- Fixes strict OpenAI Structured Outputs schema: required now includes footprint, holes and assets.
- Adds an internal strict-schema self-check so future missing-required regressions fail locally before an OpenAI 400 request.
- Uses one shared vision pass for geometry + furniture/fixtures, preventing two independent model passes from drifting into different coordinate frames.
- Adds a second image-grounded visual audit pass before finalizing a scene.
- Corrects the image coordinate conversion: vision Y is top-down, while Ventra 3D uses bottom-left / Y-up.
- Keeps footprint from the plan instead of discarding it; validates it and only falls back when invalid.
- Preserves true holes only when they are inside the footprint and outside detected room floor.
- Preserves door hinge/swing metadata through scene normalization.
- Corrects furniture rotation after the Y-axis flip.
- Keeps detected furniture and fills missing essential room furniture conservatively per room, using the existing room-lock/clearance logic.
- Raises schematic normalization width/depth cap from 40 m to 80 m to match the compiler and avoid silent large-plan distortion.

BOUNDARIES / UNCHANGED
Only this source file differs from the authoritative ZIP:
  src/app/api/ai/design-3d/route.js

No changes were made to:
- Project3DViewer.jsx
- ProjectDrawingCenter.jsx
- APS / DWG / DXF / IFC / RVT engineering path
- Geometry Extractor
- Takeoff / BOQ
- Estimate / Quotation
- Supabase / Auth
- Drawing Upload
- Dashboard / Persistence / Export

VALIDATION PERFORMED
- node --check src/app/api/ai/design-3d/route.js : PASS
- strict JSON-schema self-check harness : PASS
- top-left image -> bottom-left metric Y conversion harness : PASS
- targeted static assertions for footprint / holes / assets / V40 audit : PASS
- recursive diff against authoritative ZIP : only route.js differs
- hashes of Project3DViewer.jsx, ProjectDrawingCenter.jsx, apsGeometryExtractor.js and src/lib/boq/geometry.js match the authoritative ZIP

FULL npm build/lint was NOT claimed: dependency installation in the sandbox timed out, and the patch intentionally does not include node_modules.
