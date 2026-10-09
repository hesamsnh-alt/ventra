# Ventra 3D recovery patch — 2026-09-19

Authoritative input: `ventra(20260919-135138).zip`.

## Scope
Only the 3D pipeline was changed:
- `src/app/api/ai/design-3d/route.js`
- `src/app/projects/[id]/Project3DViewer.jsx`

No database, Supabase, auth, BOQ, estimate, quotation, dashboard, persistence schema, APS token flow, or upload flow was intentionally changed.

## Root causes found
1. Raster/JPG geometry prompt explicitly forbids furniture/fixtures and `compileRasterFloorplan()` returns `assets: []`. The UI nevertheless describes the result as a furnished schematic scene.
2. DWG reconstruction creates each slab from a convex hull of wall endpoints. Concave footprints, recesses and notches are therefore flattened whenever APS already had a valid closed floor polygon.
3. The raster test suite is not wired to `npm test`, and the current authoritative package already contains pre-existing failing tests (scale/opening/persistence harness). Do not treat previous `VALIDATION` notes as proof that the current package has a fully green suite.

## Patch
### Raster / JPG / PNG / WebP
- Structural image trace is still accepted/rejected by the existing strict geometry compiler.
- After structural acceptance, a new **non-structural room-program furnishing layer** is generated.
- Furniture never changes room polygons, walls, openings, dimensions or engineering quantities.
- Bedroom/living/dining/kitchen/office/laundry programs receive appropriate schematic assets.
- Bathroom fixtures use the existing collision-aware interior-completeness placement logic.
- Result is marked `furnishingMode: room_program_non_structural`.

This is intentionally a visualization/design layer. If furniture is not explicitly drawn in the source plan, it is not claimed as measured engineering evidence.

### DWG / APS reconstruction
- Slabs now prefer `geometry.floorPolygons` from the APS closed exterior wall-loop extraction.
- Those polygons are already metric geometry from the engineering extractor and are converted into the active storey-local frame.
- The old convex-hull slab remains only as a fallback when no valid APS floor polygon is available.
- This preserves concave footprint geometry instead of filling notches/recesses with fake floor area.

## Validation performed
- `node --check src/app/api/ai/design-3d/route.js`: PASS.
- Raster geometry suite executed directly: 20 pass / 5 fail. The five failures reproduce on the original baseline and are pre-existing test/compiler or test-harness issues, not introduced by this patch.
- Full Next build could not be completed in the isolated environment because dependency installation timed out and left `node_modules` incomplete. The package intentionally excludes that partial `node_modules` directory.

## Important next verification on the user's machine
Run from the project directory:

```bash
npm ci
npm run build
node --test tests/*.test.mjs
npm run dev
```

Then verify one known JPG plan and one known DWG plan against their source drawings. For JPG, geometry must match before judging the furnishing layer. For DWG, inspect concave/recessed floor edges and door/window cuts.
