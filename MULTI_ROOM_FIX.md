# Multi-room geometry fix

Updated `src/services/apsFloorAreaCalculator.js`.

## What changed
- Line segments are now split at true geometric intersections, not only at existing endpoints.
- Collinear overlapping DWG segments are split safely at overlap endpoints.
- The planar graph can now discover multiple enclosed faces separated by internal walls.
- Tiny drafting loops and narrow wall-thickness strips are filtered from the Room Schedule.
- Geometry diagnostics now include input segment, planar segment, detected face, and bounded face counts.

## Validation
- JavaScript syntax checks passed for the modified floor-area calculator and takeoff builder.
- A synthetic 10 m × 8 m plan divided by an internal wall was tested and returned two rooms of 40 m² each, totaling 80 m².
- Full `npm run build` could not be executed because the configured package registry returned 404 for `zustand@5.0.14` during dependency installation.
