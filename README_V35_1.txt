VENTRA V35.1 - API ROUTE RESTORE

Fixes:
POST /api/ai/design-3d 404
POST /api/ai/analyze-drawing 404

Restored files:
- src/app/api/ai/design-3d/route.js
- src/app/api/ai/analyze-drawing/route.js

design-3d is the V35 footprint-first engine.
analyze-drawing is restored from the latest full user project source.

IMPORTANT INSTALL:
Extract into the PROJECT ROOT and MERGE folders.
Do NOT delete or replace the entire src/app/api/ai folder.

After replacement:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

Expected after Analyze:
POST /api/ai/design-3d 200
POST /api/ai/analyze-drawing 200
