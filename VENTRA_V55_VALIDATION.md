# Ventra V55 validation

- Baseline: V54 full package.
- Geometry route unchanged.
- Viewer unchanged.
- Only `src/app/projects/[id]/ProjectDrawingCenter.jsx` changed.
- Fix: retry transient non-JSON 404/408/425/502/503/504 responses from Next/Turbopack during dev-server restart/recompile.
- Legitimate JSON API errors are not retried.
- Schematic request gets up to 5 transport attempts with bounded backoff.
- `src/app/api/ai/design-3d/route.js` passes `node --check` and is byte-identical to V54.
