# Room Matching Coordinate Fix

- Matches room labels to closed room polygons even when APS text bounds and geometry extraction use different coordinate origins or scales.
- Uses direct point-in-polygon matching first.
- Falls back to normalized one-to-one spatial assignment across the drawing.
- Prevents one polygon from being assigned to multiple labels.
- Preserves real polygon area and perimeter in the Room Schedule.
