# Room Summary Mapping Fix

This build fixes the data hand-off between APS geometry extraction and the Geometry Extraction Summary.

Changes:
- Room count no longer becomes zero only because `roomPolygons` is empty.
- Aggregate `geometry.roomCount`, `statistics.detectedRooms`, and closed-face counts are used as supported fallbacks.
- Total room area now preserves aggregate `geometry.roomArea` results.
- Existing polygon-based room schedules remain the highest-priority source.
- No room count or room area is invented when every source is empty.
