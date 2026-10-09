VENTRA JPG READABLE DOLLHOUSE V8

Fixes visual readability of structured JPG floor plans only.

Changes:
- much smaller room labels
- labels sit close to the floor instead of floating over walls/furniture
- internal walls lowered to ~0.56m
- external cutaway walls lowered to ~0.92m
- default camera changed to near-top dollhouse / orthographic when available
- room/furniture layout becomes readable at a glance

Only file changed:
src/app/projects/[id]/Project3DViewer.jsx

Does NOT modify:
- design-3d route / V6 vision
- Drawing Center / V7 dedupe
- DWG / APS
- BOQ / Estimate / Quotation

After replacing:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

No JPG re-analysis is required for this visual-only patch.
