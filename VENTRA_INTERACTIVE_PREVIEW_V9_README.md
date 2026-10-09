# Ventra Interactive Preview V9

This is a **minimal preview-engine patch**. It intentionally changes only:

- `src/app/api/ai/design-3d-preview/route.js`

It does not replace the project page, Drawing Center, Project3DViewer, next.config, APS/DWG pipeline, Supabase/Auth, BOQ, Estimate, or Dashboard.

## V9 changes

- Adds model-provided labeled-room relationships (`wall`, `open`, `door`, `separate`).
- Builds a conservative relationship graph after dimension locking.
- Preserves room dimensions while translating adjacent rooms to close small gaps/overlaps.
- Treats X and Y dimension locks independently and reports `xApplied` / `yApplied`.
- Removes physical partitions between explicit open-plan room pairs.
- Can restore a missing shared wall when two labeled rooms are explicitly related by wall/door and share a real boundary.
- Uses living-style wood flooring for dining / kitchen+dining dry open-plan zones so they do not render like wet/service tile.
- Adds conservative service-room overlap cleanup to stop bathroom/storage floor zones bleeding into neighboring rooms.
- Adds minimum furnishing profiles after collision-aware placement: bedrooms get wardrobe fallback, living gets TV fallback, kitchen+dining gets table fallback, compact bathrooms get toilet/basin fallback.
- Furniture is still generated locally, not by the model.

## Expected diagnostics

- `build: interactive-plan-scene-v9-20260919`
- `dimensionLock.xApplied` and `dimensionLock.yApplied`
- `topology.version: relationship_room_graph_v9`
- `topology.relationshipCount`
- `topology.removedOpenPlanPartitions`
- `topology.addedRelationshipWalls`
- `topology.serviceOverlapAdjustments`
- `furnishing.version: rule_grounded_furnishing_v9`
- `materialZoning.version: room_polygon_material_zoning_v9`

## Validation performed

- `node --check src/app/api/ai/design-3d-preview/route.js` passes.
- Patch package contains no Viewer, project-page, config, APS, database, or BOQ files.
