# Ventra Interactive Preview V2 Validation

Date: 2026-09-19

## Base and scope
This package was rebuilt from the user's original `ventra(20260919-135138).zip`.
It is not layered on the failed V1 preview package.

## Static checks performed
- `node --check src/app/api/ai/design-3d-preview/route.js`: PASS
- `Project3DViewer.jsx`: byte-for-byte identical to the original package.
- `/api/ai/design-3d/route.js`: byte-for-byte identical to the original package.
- All APS API route files: byte-for-byte identical to the original package.
- Exact changed-file audit: only the new preview route, the minimal image-preview hookup in ProjectDrawingCenter, and documentation files differ.

## API design correction
The failed V1 used `reasoning.effort=medium` and a schema that also asked the model for furniture. The observed failed call spent all 8000 output tokens on reasoning and returned no scene JSON.

V2 uses:
- GPT-5.1 `reasoning.effort=none`
- one paid request per Preview generation (no automatic retry)
- a reduced structured schema containing only footprint, rooms, partitions and openings
- local deterministic furnishing after geometry is returned
- the original Ventra Three.js schematic viewer for orbit/pan/zoom

## Build limitation
A full `npm ci`/Next production build could not be completed in the sandbox because dependency installation timed out. No claim of a successful production build is made. The new server route passed JavaScript syntax validation, and the client change is a small audited edit of the original file.
