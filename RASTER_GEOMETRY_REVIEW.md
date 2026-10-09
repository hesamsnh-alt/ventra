# Ventra raster consensus and trace repair — 2026-09-16

Build: raster-bounded-correction-20260916
Status: tested against the user's latest downloaded trace; live commercial accuracy is not certified.

## Install
Stop the development server and make a backup. Extract this ZIP into the existing `ventra` folder beside `package.json`, replacing included files. Keep your current `.env.local`. Run `npm run dev`; no earlier patch is needed.

### Windows dev-server restart

If the terminal shows `GET /projects/<id> 404` immediately after replacing the files, stop every running dev server, clear only the generated development cache, and start from the application directory:

```powershell
Set-Location 'C:\Users\hesam\OneDrive\Documents\vintra site\ventra'
if (Test-Path -LiteralPath '.next') {
  Rename-Item -LiteralPath '.next' -NewName ('.next-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
npm run dev
```

Wait for `Ready`, then refresh the project URL. A clean build registers both `/projects/[id]` and `/api/ai/design-3d`; the project page itself does not call `notFound()`. Do not start `npm run dev` from the parent `vintra site` folder.

## What changed
- Dimension fitting uses a weighted per-axis consensus. Short, inconsistent dimension endpoints are retained in the review report as rejected evidence and cannot distort the overall scale. Material disagreements still reject the scene.
- A completed trace that fails a geometry-only validator can receive one bounded correction pass. Timeouts, provider failures and billing errors are not retried; an accepted scene is returned only after the compiler passes.
- Vision's uncalibrated self-confidence no longer rejects an otherwise structurally valid trace; only an out-of-range confidence value fails.
- Orthogonal polygons with a repeated collinear boundary segment are polygonized from their traced segments. Proper crossings remain rejected. No template or reference-plan coordinates are used.
- Room face boundaries allow a bounded wall-centerline inset derived from the image scale. A gap in the middle of a boundary still fails.
- An uncertain door/window is omitted with its original wall ID, endpoints and reason (`OPENING_OFF_WALL`, `OPENING_OUTSIDE_WALL` or `OVERLAPPING_OPENINGS`). It is never moved, projected onto another wall or invented. The review panel reports the omission.
- The latest user report (35-second completed Vision response) replays to a scene with 7 named rooms, an 8-point notched footprint, 17 walls and 3 geometrically attached openings; 6 uncertain openings are explicitly omitted. This is a structural compile result, not proof that every AI trace matches pixels.

## Verification
36 raster tests passed, including the latest trace fixture, strict schemas, pixel conversion, weighted scale consensus, bounded correction policy, collinear boundary handling, room topology, opening omission, request streaming/cancellation, report persistence and React report rendering. Three.js r71 checks passed with 24 legacy comparisons. Next.js compile-mode build passed and registered `/api/ai/design-3d`.

Run:
    node --test tests/raster-*.test.mjs
    node scripts/verify-raster-renderer.mjs path/to/three.js path/to/untouched-baseline
    node scripts/replay-raster-report.mjs path/to/report.json

## Scope and limits
Only the raster design route, drawing controller and schematic viewer are modified among existing files. Added modules and fixtures are raster-only. Supabase, authentication, database, APS/CAD/BIM, uploads, takeoff, BOQ, estimates, pricing, environment configuration and source switching are unchanged.

The AI still may trace a wall or room incorrectly while satisfying structural checks. The next accepted scene must be compared with the source image before use. Wall thickness, unannotated heights and fixture data remain schematic assumptions; furniture/assets remain empty during validation.
