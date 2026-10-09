# Ventra Interactive Preview V8

Build: `interactive-plan-scene-v8-20260919`

## Goal
Generalize the interactive JPG/PNG 3D preview engine so it behaves logically across common floor plans rather than being tuned to one 2-bedroom sample.

## What changed
- Rule-grounded furnishing by room type: bedroom, living, kitchen, kitchen+dining, dining, bathroom, storage, office.
- Furniture containment checks use the full asset footprint, not just its center point.
- Furniture collision checks prevent overlapping assets.
- Door-clearance checks keep furniture away from door approach zones.
- Wardrobes avoid walls that contain doors or windows whenever a clean wall is available.
- Kitchen sink and stove stay on the counter run.
- Bathroom fixtures use a compact perimeter layout instead of floating at room center.
- Material zoning metadata is assigned per room type. Integrated kitchen+dining is treated as dry open-plan flooring instead of bathroom-like tile.
- Room polygons that slightly escape the building footprint are pulled back inside to stop floor-finish bleed outside walls.
- V6 dimension lock and V7 outer-contour preservation remain in place.

## Deliberately untouched
- Autodesk APS / DWG / IFC engineering pipeline
- `Project3DViewer.jsx` (byte-identical to V7)
- `ProjectDrawingCenter.jsx`
- `next.config.mjs`
- Supabase/Auth/BOQ/Estimate/Quotation

## Important
This is still the visual interactive preview pipeline. APS/takeoff remains authoritative for engineering quantities.
