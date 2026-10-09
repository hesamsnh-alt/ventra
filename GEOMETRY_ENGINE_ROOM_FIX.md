# Geometry Engine Room Fix

- Added a bounded all-line closed-face pass for 2D DWG room candidates when the wall-only graph returns only a few large faces.
- Preserved the wall-only pass for gross floor-area calculations.
- Room labels now match against expanded internal room candidates.
- Nested containing faces prefer the smallest meaningful polygon instead of the whole-floor outline.
- Semantic room labels are no longer silently discarded when a closed face cannot be matched; unmatched labels remain visible without invented measurements.
- The expanded pass is capped at 12,000 line segments to avoid freezing large drawings.
