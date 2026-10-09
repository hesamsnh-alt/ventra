# Ventra Interactive Preview V4 - 2026-09-19

## Scope
Only the raster/JPG/PNG interactive preview path was changed.
APS/DWG viewer and next.config.mjs remain byte-identical to the original 2026-09-19 project baseline.

## Changes
- Preview model default upgraded to gpt-5.6-sol (env override remains OPENAI_3D_PREVIEW_MODEL).
- reasoning effort set to none.
- max preview output default reduced to 6000 tokens.
- Stronger footprint rules: 4-point footprint only when all exterior sides are truly straight and continuous.
- Stronger opening rules: count and return all visible doors and windows.
- Client preview request gets one safe transient retry (2 total fetch attempts).
- Server coalesces identical requestId calls and caches the completed response for 2 minutes, so retrying the same request does not trigger a second OpenAI generation.
- Existing APS/Project3DViewer left untouched.

## Validation
- `node --check src/app/api/ai/design-3d-preview/route.js` PASSED.
- Project3DViewer.jsx SHA-256 equals original baseline.
- next.config.mjs SHA-256 equals original baseline.
- Full `next build` could not be executed in the sandbox because the provided node_modules installation is incomplete/missing the Next CLI. This is explicitly not claimed as a passed build.

## Expected runtime markers
- routeVersion/build: interactive-plan-scene-v4-20260919
- transient reconnect can log: [VENTRA PREVIEW REQUEST COALESCED v4] or [VENTRA PREVIEW RESPONSE CACHE HIT v4]
- a browser transport retry must reuse the same X-Ventra-Request-Id and must not create a second OpenAI call.
