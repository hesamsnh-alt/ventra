# Ventra Baseline Recovery 04

Source: VENTRA_BASELINE_RECOVERY_03_FULL.zip

## Scope
Only `src/app/api/ai/design-3d/route.js` changed. Engineering/APS/DWG/DXF/IFC/RVT paths, ProjectDrawingCenter and Project3DViewer are unchanged.

## Raster Stage 1 changes
- Keeps the single OpenAI structured vision pass from BR03.
- Adds a deterministic shared-axis constraint layer for orthogonal floor plans.
- Near-horizontal/vertical wall evidence is clustered into common axes.
- Room, footprint and hole vertices snap only to nearby shared wall axes.
- No room is independently resized or recentered.
- Furniture/assets are disabled for Stage 1 so geometry can be judged cleanly.
- Prompt explicitly prioritizes printed dimensions, shared walls, T-junctions and structural topology.

## Validation performed
- `node --check src/app/api/ai/design-3d/route.js`: PASS.
- No live OpenAI request was run in this environment.

## Regression target
Reference plan is 12.50m x 9.50m with seven named spaces. This target is used for evaluation only; no plan-specific coordinates or room template are hardcoded into the engine.
