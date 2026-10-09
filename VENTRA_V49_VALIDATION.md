# Ventra V49 validation

Authoritative base: ventra(20260913-102936).zip

Changed source files only:
- src/app/api/ai/design-3d/route.js
- src/app/projects/[id]/Project3DViewer.jsx
- src/app/projects/[id]/ProjectDrawingCenter.jsx

Raster pipeline (JPG/PNG/WebP):
1. Pass 1 reads stable topology constraints, printed overall dimensions, room labels and printed room dimensions.
2. Pass 2 traces footprint, room polygons, actual wall centerlines, openings and visible assets.
3. A verifier sees the same source image plus the first trace and may correct only image-contradicted coordinates/attachments.
4. Ventra scores both candidates against room-label anchors, room count, footprint containment, printed dimensions, aspect ratio and opening-wall attachment.
5. The better constrained candidate is selected. Deterministic wall-graph reconstruction is fallback-only when room polygons are not adequately anchored.
6. Metric compilation happens once after candidate selection. Rooms are never independently resized/recentered.
7. Concave image-traced footprints are preserved; a false rectangular plan-bounds fallback is no longer fabricated.
8. Furniture/fixtures remain image-grounded; wall snapping is limited to small corrections.

Engineering paths (DWG/DXF/IFC/RVT) were not modified.

Static validation performed:
- node --check src/app/api/ai/design-3d/route.js : PASS
- source diff against authoritative ZIP: only the three files listed above changed
- Viewer retains floor/real-hole render safety changes only
- DrawingCenter retains duplicate JPG request coalescing only

Not claimed:
- Live OpenAI vision end-to-end execution was not possible in this offline container because the user's API key/billing environment is not available here.
