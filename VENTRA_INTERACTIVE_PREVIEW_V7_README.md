# Ventra Interactive Preview V7

Build: `interactive-plan-scene-v7-20260919`

## Why V7 exists
V6 correctly locked printed room dimensions, but it then rebuilt the exterior footprint from the union of labeled rooms. That is geometrically wrong for architectural plans because unlabeled circulation, entrance zones, and open-plan connecting floor areas are still part of the building shell. The result was a shrunken, jagged outline with excessive wall count.

## V7 change
- Keeps the AI-traced exterior footprint as the authoritative outer contour.
- Applies only light collinear simplification to that contour.
- Keeps V6 printed-dimension room locking.
- Keeps local deterministic furniture placement.
- Keeps request coalescing/cache and one OpenAI generation.
- Does not modify APS, DWG engineering flow, `Project3DViewer.jsx`, or `next.config.mjs`.

## Expected diagnostic
- `build`: `interactive-plan-scene-v7-20260919`
- `dimensionLock.applied`: may remain `true`
- `footprintRepair.reason`: `model_outer_contour_preserved_v7`
- footprint point count should remain close to the model's outer contour rather than exploding into a room-union staircase.
