# Ventra V12 Patch

What this patch fixes:
- visible full apartment base floor slab so there are no black holes / missing floor areas
- per-room procedural floor finishes (tile for wet areas, parquet for living/bedrooms, neutral stone elsewhere)
- better lighting in standalone schematic mode
- cleaner door display using an open 3D symbolic door leaf instead of ugly plan-style arcs or tiny bars
- taller and more readable cutaway walls
- upgraded procedural furniture shapes
- room labels are hidden by default unless `scene.showRoomLabels === true`

Important limitation:
Real GLB furniture loading inside the current schematic renderer should be implemented only after
migrating from the Autodesk embedded legacy THREE runtime to a modern standalone three.js runtime.
A placeholder folder for future GLB assets is included under `public/glb/furniture/`.
