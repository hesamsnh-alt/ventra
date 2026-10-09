VENTRA V36.2 - HOLE VALIDATOR FIX

Changed file only:
src/app/api/ai/design-3d/route.js

Purpose:
Prevent false AI holes/voids from deleting real interior floor areas.

Validation applied to every detected hole:
- must be inside the footprint
- must not overlap any detected room polygon
- must not contain a room centroid
- must not contain furniture/fixture asset centers
- oversized holes are rejected conservatively
- generic "opening" entries are never rendered as floor holes

Accepted size limits:
- shaft: max 5.5% of footprint
- void: max 6.5% of footprint
- courtyard: max 18% of footprint
- opening: rejected

Expected log:
[VENTRA JPG HOLE VALIDATOR v36.2]

Example:
{
  detected: 1,
  accepted: 0,
  rejected: 1,
  rejectedDetails: [...]
}

This keeps the V36.1 async/API stability fixes.

Install:
Replace only:
src/app/api/ai/design-3d/route.js

Then:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

Clear the old JPG schematic cache once and re-run Analyze.
