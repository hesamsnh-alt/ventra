# Ventra Clean Release Audit

Date: 2026-10-02

## 2026-10-05 Furniture Gate Fix

- Added a deterministic furniture validation/completion gate to `/api/ai/design-3d-preview`.
- The gate does not modify footprint, room polygons, walls, partitions, or openings.
- It rejects furniture that falls outside its room, collides with accepted furniture, or blocks a door clearance zone.
- It completes missing essentials per room type, including bedroom bed/wardrobe, living sofa/coffee table/TV, kitchen counter/sink/stove/fridge, and bathroom toilet/sink/shower.
- Geometry validation now reports `collisionAware: true` and `doorClearanceAware: true` for preview furnishings.
- Package versions are aligned with the user-verified Windows build: `next@16.3.8`, `eslint-config-next@16.3.8`, and `sharp@0.35.5`.

## What This Package Fixes

- Adds `next.config.mjs` with an explicit Turbopack project root.
- Adds `eslint.config.mjs` for ESLint 9 / Next 16.
- Removes duplicate legacy source tree `src/src/**` from this clean package.
- Removes unused broken legacy component `src/app/components/ProjectDrawingCenter.jsx` from this clean package.
- Excludes `node_modules`, `.next`, and historical zip artifacts from the deliverable.

## Active Product Paths

- Image/JPG/PNG/WebP visual 3D preview:
  - `src/app/api/ai/design-3d-preview/route.js`
  - `src/app/projects/[id]/ProjectDrawingCenter.jsx`
  - `src/app/projects/[id]/Project3DViewer.jsx`
- Legacy/heavier image geometry route:
  - `src/app/api/ai/design-3d/route.js`
- DWG/DXF/IFC/RVT engineering route:
  - Autodesk APS upload/translation/viewer services under `src/app/api/aps/**` and `src/services/aps*.js`
- BOQ/estimate/quotation:
  - `src/app/api/ai/generate-boq/route.js`
  - `src/app/projects/[id]/ProjectBOQ.jsx`
  - `src/app/projects/[id]/ProjectEstimate.jsx`
  - `src/app/projects/[id]/ProjectQuotation.jsx`

## Verification Run

`npm run lint` was executed against this clean package with temporary dependencies linked for validation.

Result: lint still fails with 13 errors and 13 warnings.

The remaining errors are mainly React Compiler / ESLint strictness issues:

- `Project3DViewer.jsx`: state update inside effect.
- `ProjectDrawingCenter.jsx`: `Date.now()` / `Math.random()` usage in component scope or functions flagged by purity rules, window debug globals, ref access during render.
- `ProjectEstimate.jsx`: state updates inside effects.
- `ProjectQuotation.jsx`: state updates inside effects.
- `EditableCell.jsx`: state update inside effect.

These are not the same as the removed legacy parse error. The source is now structurally cleaner, but it is not yet lint-clean.

## Critical Product Risks

1. There are still too many sources of truth: Supabase, localStorage, APS, OpenAI output, and renderer state.
2. Important project outputs are stored heavily in browser `localStorage`. A paid SaaS should persist 3D scenes, BOQ, estimates, and quotations in database/storage with version history.
3. JPG preview and DWG/APS routes are separate but not governed by one canonical scene schema.
4. Debug logging is excessive for production and can expose internals or slow the app.
5. The 3D preview is visual and should not be treated as engineering quantity truth. APS/takeoff must remain authoritative for BOQ.

## Next Required Repairs

1. Persist generated 3D scenes server-side per project/document/version.
2. Create one canonical scene schema shared by JPG preview, DWG/APS reconstruction, and renderer.
3. Replace duplicate localStorage-only state with database-backed project artifacts.
4. Clean React Compiler lint errors without disabling quality rules blindly.
5. Add test fixtures for:
   - JPG floor plan to 3D preview.
   - DWG/APS upload to viewer/takeoff.
   - BOQ generation from takeoff.
   - Quotation generation from BOQ/estimate.
