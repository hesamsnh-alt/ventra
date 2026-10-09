VENTRA INTERACTIVE 3D PREVIEW V14.1 HOTFIX

MINIMAL REGRESSION FIX

Root cause:
V14 called normalizedPointBounds() from the new uniform-pixel projection code,
but the helper function was accidentally omitted. The request therefore completed
the OpenAI call and then crashed locally with:
  ReferenceError: normalizedPointBounds is not defined

This hotfix:
- restores normalizedPointBounds()
- preserves the V14 uniform metres-per-pixel projection
- bumps the build tag to interactive-plan-scene-v14.1-20260921

Only this file is replaced:
src/app/api/ai/design-3d-preview/route.js

Untouched:
Project3DViewer.jsx
ProjectDrawingCenter.jsx
projects/[id]/page.js
next.config.mjs
APS / DWG
Supabase/Auth
BOQ/Estimate/Quotation

Validation:
node --check: PASS
normalizedPointBounds references: 3
normalizedPointBounds definitions: 1

Apply:
1) Stop dev server
2) Replace only the route file
3) Delete .next
4) npm run dev
5) Test once
6) Confirm build tag: interactive-plan-scene-v14.1-20260921
