# Ventra JPG Complete Visible 3D V13

This patch addresses the actual current failure mode:

- Vision can still timeout, so the deterministic fallback is expanded.
- White blowout is reduced.
- Floor is always present.
- Floors use strong room-specific colors + geometric patterns without relying on fragile canvas textures.
- Bathrooms include toilet + sink + shower + mirror.
- Kitchen includes counters + refrigerator + stove + sink.
- Living includes sofa + armchairs + coffee table + TV unit.
- Bedrooms include bed + wardrobe + nightstands.
- Store includes cabinet + washing machine.
- Door leaves remain 3D symbolic and readable.
- Existing DWG/APS/BOQ/Estimate/Quotation code is not intentionally changed.

Replace:
- src/app/projects/[id]/Project3DViewer.jsx
- src/app/api/ai/design-3d/route.js

Then restart and Analyze the JPG once so the richer fallback scene is stored.
