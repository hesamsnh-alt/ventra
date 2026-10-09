VENTRA V8 MINIMAL HOTFIX

This patch intentionally contains ONLY:
src/app/api/ai/design-3d-preview/route.js

It does NOT replace:
- src/app/projects/[id]/page.js
- ProjectDrawingCenter.jsx
- Project3DViewer.jsx
- next.config.mjs
- package.json
- APS / DWG / Supabase / BOQ / Auth code

Apply this over a known-good Ventra project where /projects/[id] already works.

Recommended after copying:
1) Stop npm dev server.
2) Delete .next
3) Run npm run dev
4) Open /dashboard first.
5) Open the project.
6) Test the same raster plan once.

Reason: the full V8 package had identical project route/viewer files, so the 404 is not caused by the V8 preview route itself. This minimal patch removes any risk of overwriting unrelated project files during extraction.
