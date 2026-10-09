# Ventra Interactive Preview V6 — Dimension Locked Topology

Build: `interactive-plan-scene-v6-20260919`

## Scope
This patch is built on top of V5 and changes **only**:

- `src/app/api/ai/design-3d-preview/route.js`

No changes were made to:

- Autodesk APS pipeline
- `Project3DViewer.jsx`
- `next.config.mjs`
- DWG/DXF/IFC/RVT processing
- Supabase/Auth/Database
- BOQ/Estimate/Quotation

## What changed

### 1. Shared dimension grid solver
Rectangular labelled rooms are no longer resized independently around their centres.
V6 clusters shared X/Y boundaries into a common architectural grid, then solves printed room dimensions as metric constraints against that shared grid.

This prevents the old failure mode where:
- Bedroom 1 is individually resized,
- Living is individually resized,
- Bath/Store are individually resized,
- shared walls no longer line up.

### 2. Robust constraint guards
The metric solver is rejected if it:
- creates meaningful room overlaps,
- moves a room centre excessively,
- produces an unstable axis solution,
- receives wildly inconsistent dimensions.

If rejected, Ventra falls back to the original semantic room geometry instead of corrupting the scene.

### 3. Partition snapping to solved room grid
AI partitions are snapped to nearby solved room boundary lines. This improves wall alignment after metric correction and reduces floating or near-miss partitions.

### 4. Existing V5 footprint repair preserved
The room-supported orthogonal footprint repair remains active. V6 applies dimension locking before footprint repair so the outer footprint is derived from better metric room geometry.

### 5. Diagnostics
The preview diagnostic now includes:

```json
"dimensionLock": {
  "applied": true,
  "reason": "printed_dimension_grid_lock",
  "xMeanError": 0.0,
  "yMeanError": 0.0,
  "xConstraintCount": 0,
  "yConstraintCount": 0
}
```

The exact values vary per plan.

## Expected V6 log/report marker

`interactive-plan-scene-v6-20260919`

## Validation performed

- `node --check src/app/api/ai/design-3d-preview/route.js` → PASS
- V5 → V6 directory diff → only `design-3d-preview/route.js` differs
- `Project3DViewer.jsx` SHA-256 matches V5 and original project
- `next.config.mjs` SHA-256 matches V5 and original project

A full Next production build was not run in the patch environment because `node_modules` is not bundled in the source ZIP.
