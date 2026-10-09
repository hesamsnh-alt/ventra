# Ventra V54 transient network recovery

Base: V53 single-flight/timeout-resilient build.

Changed only:
- `src/app/projects/[id]/ProjectDrawingCenter.jsx`
- `src/services/takeoffService.js`

Purpose:
- Recover from transient browser `TypeError: Failed to fetch` caused by a dev-server restart/HMR/network interruption.
- Retry only transport-level failures, not HTTP 4xx/5xx application responses.
- Preserve V53 geometry, pixel-wall extraction, OpenAI time budgets, Viewer, APS and engineering routes unchanged.

Behavior:
- schematic 3D POST retries up to 3 total attempts with 1.2s / 2.5s backoff.
- takeoff analyze POST uses the same transport-only retry policy.
- each logical request has an `X-Ventra-Request-Id` and body requestId for diagnostics.

Validation performed:
- `node --check src/services/takeoffService.js`: PASS.
- Verified Viewer and design-3d route are byte-identical to V53.
- Verified only the two files above differ from V53 under `src/`.
